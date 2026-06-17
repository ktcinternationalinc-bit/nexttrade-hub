'use client';
// v55.83-A.6.27.61 — AttachmentManager: reusable upload + list + delete component.
//
// WHAT IT DOES (plain English):
//   • Shows all files attached to a specific record (invoice / ticket / ledger entry)
//   • Lets users drag-drop a file OR click to pick — uploads to Supabase Storage
//   • Displays each file with: filename, size, who uploaded, date, download link
//   • Super_admin can delete attachments (logs to audit_log)
//   • Errors gracefully if Storage bucket missing or attachments table not migrated
//
// USAGE:
//   <AttachmentManager
//     parentType="open_account_invoice"   // or "system_ticket" or "open_account_entry"
//     parentId={invoice.id}
//     currentUserId={userProfile?.id}
//     isSuperAdmin={userProfile?.role === 'super_admin'}
//     canEdit={true}                       // whether user can upload/delete
//   />
//
// SUPABASE PREREQUISITES (Max sets up once):
//   1. Storage bucket named "attachments" (public, 100 MB limit)
//   2. SQL migration v55.83-A.6.27.61 run

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

var MAX_FILE_SIZE = 104857600; // 100 MB in bytes
var BUCKET_NAME = 'attachments';

// Format bytes → human readable (3.2 MB, 124 KB, etc.)
function fmtSize(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

// Format date → short readable (May 22)
function fmtDate(s) {
  if (!s) return '';
  try {
    var d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return ''; }
}

// Get a file-type icon based on mime/extension
function fileIcon(fileName, mimeType) {
  var ext = ((fileName || '').split('.').pop() || '').toLowerCase();
  if (mimeType && mimeType.startsWith('image/')) return '🖼️';
  if (ext === 'pdf') return '📄';
  if (['doc', 'docx'].indexOf(ext) >= 0) return '📝';
  if (['xls', 'xlsx', 'csv'].indexOf(ext) >= 0) return '📊';
  if (['zip', 'rar', '7z', 'tar', 'gz'].indexOf(ext) >= 0) return '🗜️';
  if (['mp3', 'wav', 'ogg', 'm4a'].indexOf(ext) >= 0) return '🎵';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].indexOf(ext) >= 0) return '🎬';
  if (['txt', 'log'].indexOf(ext) >= 0) return '📃';
  return '📎';
}

// Sanitize filename to safe storage path component
function sanitizePath(name) {
  return (name || '').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200);
}

export function AttachmentManager(props) {
  var parentType = props.parentType;
  var parentId = props.parentId;
  var currentUserId = props.currentUserId;
  var isSuperAdmin = !!props.isSuperAdmin;
  var canEdit = props.canEdit !== false; // default true

  // v55.83-II — internal-only product photos. Optional modes (all default OFF
  // so existing public invoice/ticket attachments are unchanged):
  //   bucketName   — which Storage bucket to use (default 'attachments')
  //   isPrivate    — bucket is PRIVATE; display/download via short-lived SIGNED
  //                  URLs (no public_url stored). For internal-only assets.
  //   imageOnly    — only accept image/* files; render as a thumbnail gallery
  //   enablePrimary— allow marking one attachment as the primary/cover image
  //   title        — override the section header label
  var bucket = props.bucketName || BUCKET_NAME;
  var isPrivate = !!props.isPrivate;
  var imageOnly = !!props.imageOnly;
  var enablePrimary = !!props.enablePrimary;

  var [items, setItems] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [uploading, setUploading] = useState(false);
  var [uploadProgress, setUploadProgress] = useState('');
  var [dragOver, setDragOver] = useState(false);
  var [users, setUsers] = useState([]); // for displaying uploader names
  var [signedUrls, setSignedUrls] = useState({}); // storage_path -> signed URL (private mode)

  useEffect(function () {
    if (!parentType || !parentId) { setLoading(false); return; }
    var cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        var res = await supabase
          .from('attachments')
          .select('*')
          .eq('parent_type', parentType)
          .eq('parent_id', parentId)
          .order('uploaded_at', { ascending: false });
        if (cancelled) return;
        if (res.error) {
          var msg = (res.error && res.error.message) || String(res.error);
          if (/relation.*attachments.*does not exist/i.test(msg)) {
            setError('Attachments not set up yet. Ask the admin to run SQL migration v55.83-A.6.27.61 in Supabase.');
          } else {
            setError(msg);
          }
          setItems([]);
        } else {
          setItems(sortItems(res.data || []));
        }
        // Best-effort load users for uploader display
        try {
          var ures = await supabase.from('users').select('id, name, email');
          if (!cancelled && !ures.error) setUsers(ures.data || []);
        } catch (_) {}
      } catch (e) {
        if (!cancelled) {
          console.error('[attachments] load failed:', e);
          setError((e && e.message) || String(e));
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return function () { cancelled = true; };
  }, [parentType, parentId]);

  // Primary first, then sort_order, then newest. (sort_order/is_primary only
  // exist when the product-photo migration ran; missing values sort as 0/false.)
  function sortItems(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var ap = a.is_primary ? 0 : 1, bp = b.is_primary ? 0 : 1;
      if (ap !== bp) return ap - bp;
      var ao = Number(a.sort_order) || 0, bo = Number(b.sort_order) || 0;
      if (ao !== bo) return ao - bo;
      return String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || ''));
    });
  }

  // Private bucket → mint short-lived signed URLs for display/download whenever
  // the item list changes. Public buckets use the stored public_url directly.
  useEffect(function () {
    if (!isPrivate) return;
    var paths = (items || []).map(function (x) { return x.storage_path; }).filter(Boolean);
    if (!paths.length) { setSignedUrls({}); return; }
    var cancelled = false;
    (async function () {
      try {
        var res = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
        if (cancelled || !res || res.error || !res.data) return;
        var map = {};
        res.data.forEach(function (row) {
          if (row && row.path && row.signedUrl) map[row.path] = row.signedUrl;
        });
        setSignedUrls(map);
      } catch (e) { console.warn('[attachments] signed-url mint failed:', e); }
    })();
    return function () { cancelled = true; };
  }, [items, isPrivate, bucket]);

  // Resolve the display/download URL for an attachment (signed in private mode).
  function urlFor(att) {
    if (isPrivate) return signedUrls[att.storage_path] || '';
    return att.public_url || '';
  }

  function uploaderName(userId) {
    if (!userId) return 'Unknown';
    var u = users.find(function (x) { return x.id === userId; });
    return u ? (u.name || u.email || 'User') : 'User';
  }

  async function reload() {
    try {
      var res = await supabase
        .from('attachments')
        .select('*')
        .eq('parent_type', parentType)
        .eq('parent_id', parentId)
        .order('uploaded_at', { ascending: false });
      if (!res.error) setItems(sortItems(res.data || []));
    } catch (e) { console.error('[attachments] reload failed:', e); }
  }

  // Mark one attachment as the primary/cover image (clears the flag on siblings).
  async function setPrimary(att) {
    if (!enablePrimary || !att) return;
    try {
      var clr = await supabase.from('attachments').update({ is_primary: false })
        .eq('parent_type', parentType).eq('parent_id', parentId);
      if (clr && clr.error) throw clr.error;
      var setRes = await supabase.from('attachments').update({ is_primary: true }).eq('id', att.id);
      if (setRes && setRes.error) throw setRes.error;
      await reload();
    } catch (e) {
      console.error('[attachments] setPrimary failed:', e);
      alert('Could not set primary photo: ' + ((e && e.message) || String(e)));
    }
  }

  async function uploadFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert('File too large: ' + fmtSize(file.size) + ' (max 100 MB)');
      return;
    }
    if (file.size <= 0) {
      alert('Empty file — cannot upload.');
      return;
    }
    if (imageOnly && !(file.type && file.type.indexOf('image/') === 0)) {
      alert('Only image files (JPG, PNG, WEBP, etc.) can be uploaded here.');
      return;
    }
    // v55.83-A.6.27.66 (H6, Max May 23 2026) — per-record attachment quota.
    // Caps: max 50 files per parent record, max 500 MB total size. Prevents
    // runaway uploads (whether accidental, buggy, or malicious) from racking
    // up Supabase Storage bills. The 100 MB per-file cap above doesn't help
    // if 200 files are uploaded.
    var MAX_FILES_PER_RECORD = 50;
    var MAX_TOTAL_SIZE_PER_RECORD = 500 * 1024 * 1024;  // 500 MB
    if (items.length >= MAX_FILES_PER_RECORD) {
      alert('Maximum ' + MAX_FILES_PER_RECORD + ' files reached for this record.\n\nDelete some attachments before uploading more.');
      return;
    }
    var currentTotal = items.reduce(function (a, x) { return a + (Number(x.file_size) || 0); }, 0);
    if ((currentTotal + file.size) > MAX_TOTAL_SIZE_PER_RECORD) {
      alert('Storage quota exceeded for this record.\n\nCurrent: ' + fmtSize(currentTotal) +
        '\nThis file: ' + fmtSize(file.size) +
        '\nLimit: ' + fmtSize(MAX_TOTAL_SIZE_PER_RECORD) +
        '\n\nDelete some attachments first or compress the file.');
      return;
    }
    setUploading(true);
    setUploadProgress('Uploading ' + file.name + ' (' + fmtSize(file.size) + ')...');
    try {
      // Storage path: parent_type/parent_id/timestamp-filename
      var timestamp = Date.now();
      var safeName = sanitizePath(file.name);
      var storagePath = parentType + '/' + parentId + '/' + timestamp + '-' + safeName;

      // Upload to Supabase Storage
      var uploadRes = await supabase.storage.from(bucket).upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (uploadRes.error) {
        var em = (uploadRes.error && uploadRes.error.message) || String(uploadRes.error);
        if (/bucket.*not found|bucket.*does not exist/i.test(em)) {
          throw new Error('Storage bucket "' + bucket + '" does not exist. Create it in Supabase Dashboard → Storage → New bucket' + (isPrivate ? ' (PRIVATE, 100 MB).' : ' (public, 100 MB).'));
        }
        // v55.83-A.6.27.72 HOTFIX 5 — clearer hint when storage.objects RLS blocks upload
        if (/row-level security|row level security|new row violates/i.test(em)) {
          throw new Error(
            'Upload blocked by Supabase storage policy. The "' + bucket + '" storage bucket needs RLS policies for authenticated users.\n\n' +
            'Fix: run the SQL for this bucket (' + (isPrivate ? '/sql/v55-83-II-product-photos.sql' : '/sql/v55-83-a-6-27-61-attachments.sql') + ') in Supabase SQL Editor. ' +
            'It creates 4 policies on storage.objects (INSERT/SELECT/UPDATE/DELETE) scoped to bucket_id=\'' + bucket + '\'.'
          );
        }
        throw uploadRes.error;
      }

      // Public bucket → store a stable public URL. Private bucket → no public
      // URL is stored; display/download use short-lived signed URLs at render.
      var publicUrl = '';
      if (!isPrivate) {
        var urlRes = supabase.storage.from(bucket).getPublicUrl(storagePath);
        publicUrl = (urlRes && urlRes.data && urlRes.data.publicUrl) || '';
      }

      // Insert metadata row. The is_private/is_primary/sort_order/caption
      // columns only exist after the product-photo migration — include them
      // only in the private/primary modes that depend on that migration, so
      // legacy public attachments never reference columns that aren't there.
      var metaRow = {
        parent_type: parentType,
        parent_id: parentId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        storage_path: storagePath,
        public_url: publicUrl,
        uploaded_by: currentUserId || null,
      };
      if (isPrivate) metaRow.is_private = true;
      if (enablePrimary) {
        metaRow.is_primary = items.length === 0; // first photo becomes primary
        metaRow.sort_order = items.length;
      }
      var insRes = await supabase.from('attachments').insert(metaRow);
      if (insRes.error) {
        // Try to clean up the storage file since metadata insert failed
        try { await supabase.storage.from(bucket).remove([storagePath]); } catch (_) {}
        throw insRes.error;
      }

      setUploadProgress('');
      await reload();
    } catch (e) {
      console.error('[attachments] upload failed:', e);
      var msg = (e && e.message) || String(e);
      alert('Upload failed: ' + msg);
      setUploadProgress('');
    } finally {
      setUploading(false);
    }
  }

  async function handleFileInput(e) {
    var files = e.target.files;
    if (!files || !files.length) return;
    // Upload sequentially — keeps UI responsive + clear progress
    for (var i = 0; i < files.length; i++) {
      await uploadFile(files[i]);
    }
    // Clear input so same file can be re-selected if needed
    try { e.target.value = ''; } catch (_) {}
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!canEdit) return;
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    for (var i = 0; i < files.length; i++) {
      await uploadFile(files[i]);
    }
  }

  async function deleteAttachment(att) {
    if (!att) return;
    if (!isSuperAdmin) {
      alert('Only super admin can delete attachments.');
      return;
    }
    var confirmMsg = 'Permanently delete this attachment?\n\n' +
      '"' + att.file_name + '" (' + fmtSize(att.file_size) + ')\n\n' +
      'This cannot be undone.';
    if (!confirm(confirmMsg)) return;
    try {
      // 1. Delete the file from Storage
      try {
        var rmRes = await supabase.storage.from(bucket).remove([att.storage_path]);
        if (rmRes.error) {
          console.warn('[attachments] storage remove failed (proceeding to delete metadata):', rmRes.error.message);
        }
      } catch (e) { console.warn('[attachments] storage remove threw:', e); }

      // 2. Delete the metadata row
      var delRes = await supabase.from('attachments').delete().eq('id', att.id);
      if (delRes.error) throw delRes.error;

      // 3. Log to audit_log (best-effort)
      // v55.83-A.6.27.66 (H4, Max May 23 2026) — the column name was wrong.
      // Everywhere else in the codebase (dbInsert in supabase.js, audit_log
      // schema) uses `new_values` / `old_values`. This block was using
      // `field_changes`, which doesn't exist — so every attachment delete
      // silently failed its audit log write. The whole block is in a try/
      // catch that swallows the error, so the symptom was: no audit trail
      // for attachment deletions, no error in the UI either. Now fixed.
      try {
        var auditRes = await supabase.from('audit_log').insert({
          table_name: 'attachments',
          record_id: att.id,
          action: 'delete',
          changed_by: currentUserId || null,
          new_values: null,
          old_values: {
            file_name: att.file_name,
            parent_type: att.parent_type,
            parent_id: att.parent_id,
            file_size: att.file_size,
            storage_path: att.storage_path,
          },
        });
        if (auditRes && auditRes.error) {
          console.warn('[attachments] audit_log insert failed:', auditRes.error.message);
        }
      } catch (_) {}

      await reload();
    } catch (e) {
      console.error('[attachments] delete failed:', e);
      alert('Delete failed: ' + ((e && e.message) || String(e)));
    }
  }

  if (!parentType || !parentId) {
    return null; // Defensive — nothing to render if not configured
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="text-xs font-extrabold text-slate-700 tracking-wider mb-2">
        {(props.title || (imageOnly ? '🖼️ PHOTOS' : '📎 ATTACHMENTS'))} ({items.length})
        {isPrivate && <span className="ml-2 text-[9px] font-bold text-amber-700">🔒 INTERNAL — not public</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800 font-semibold mb-2">
          ⚠️ {error}
        </div>
      )}

      {/* Upload zone */}
      {canEdit && !error && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={
            'border-2 border-dashed rounded-lg p-3 text-center transition-colors ' +
            (dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-400')
          }
        >
          {uploading ? (
            <div className="text-xs font-bold text-blue-800">
              ⏳ {uploadProgress || 'Uploading...'}
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-700 font-semibold mb-1">
                {imageOnly
                  ? 'Drag photos here or click to pick / اسحب الصور أو اضغط للاختيار'
                  : 'Drag files here or click to pick / اسحب الملفات أو اضغط للاختيار'}
              </div>
              <div className="text-[10px] text-slate-500 mb-2">
                Max 100 MB per file · {imageOnly ? 'images only (JPG, PNG, WEBP)' : 'any type'}
              </div>
              <label className="inline-block cursor-pointer">
                <input
                  type="file"
                  multiple
                  accept={imageOnly ? 'image/*' : undefined}
                  onChange={handleFileInput}
                  disabled={uploading}
                  className="hidden"
                />
                <span className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded inline-block">
                  {imageOnly ? '📷 Choose Photo(s)' : '📤 Choose File(s)'}
                </span>
              </label>
            </>
          )}
        </div>
      )}

      {/* List of attachments */}
      {loading ? (
        <div className="text-xs text-slate-600 italic mt-2 text-center py-2">Loading attachments...</div>
      ) : items.length === 0 && !error ? (
        <div className="text-xs text-slate-500 italic mt-2 text-center py-2">No attachments yet.</div>
      ) : (
        <div className="mt-2 space-y-1">
          {items.map(function (att) {
            var isImage = att.mime_type && att.mime_type.startsWith('image/');
            var url = urlFor(att);
            return (
              <div
                key={att.id}
                className={
                  'bg-white border rounded p-2 flex items-center gap-2 hover:bg-slate-50 ' +
                  (att.is_primary ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200')
                }
              >
                {isImage && url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-12 h-12 rounded overflow-hidden bg-slate-200 flex-shrink-0"
                    title="Open full image"
                  >
                    <img src={url} alt={att.file_name} className="w-full h-full object-cover" />
                  </a>
                ) : (
                  <div className="text-2xl">{fileIcon(att.file_name, att.mime_type)}</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate" title={att.file_name}>
                    {att.is_primary && <span className="text-amber-600 mr-1" title="Primary photo">★</span>}
                    {att.file_name}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {fmtSize(att.file_size)} · uploaded by {uploaderName(att.uploaded_by)} · {fmtDate(att.uploaded_at)}
                  </div>
                </div>
                {enablePrimary && canEdit && !att.is_primary && (
                  <button
                    onClick={function () { setPrimary(att); }}
                    className="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-extrabold rounded"
                    title="Make this the primary/cover photo"
                  >
                    ☆ Set primary
                  </button>
                )}
                <a
                  href={url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-800 text-white text-[10px] font-extrabold rounded"
                  download={att.file_name}
                >
                  ⬇ Download
                </a>
                {isSuperAdmin && (
                  <button
                    onClick={function () { deleteAttachment(att); }}
                    className="px-2 py-1 bg-red-700 hover:bg-red-800 text-white text-[10px] font-extrabold rounded"
                    title="Permanently delete this attachment (super admin only)"
                  >
                    🗑
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AttachmentManager;
