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

  var [items, setItems] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [uploading, setUploading] = useState(false);
  var [uploadProgress, setUploadProgress] = useState('');
  var [dragOver, setDragOver] = useState(false);
  var [users, setUsers] = useState([]); // for displaying uploader names

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
          setItems(res.data || []);
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
      if (!res.error) setItems(res.data || []);
    } catch (e) { console.error('[attachments] reload failed:', e); }
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
    setUploading(true);
    setUploadProgress('Uploading ' + file.name + ' (' + fmtSize(file.size) + ')...');
    try {
      // Storage path: parent_type/parent_id/timestamp-filename
      var timestamp = Date.now();
      var safeName = sanitizePath(file.name);
      var storagePath = parentType + '/' + parentId + '/' + timestamp + '-' + safeName;

      // Upload to Supabase Storage
      var uploadRes = await supabase.storage.from(BUCKET_NAME).upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (uploadRes.error) {
        var em = (uploadRes.error && uploadRes.error.message) || String(uploadRes.error);
        if (/bucket.*not found|bucket.*does not exist/i.test(em)) {
          throw new Error('Storage bucket "attachments" does not exist. Create it in Supabase Dashboard → Storage → New bucket (public, 100 MB).');
        }
        throw uploadRes.error;
      }

      // Get public URL
      var urlRes = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
      var publicUrl = (urlRes && urlRes.data && urlRes.data.publicUrl) || '';

      // Insert metadata row
      var insRes = await supabase.from('attachments').insert({
        parent_type: parentType,
        parent_id: parentId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
        storage_path: storagePath,
        public_url: publicUrl,
        uploaded_by: currentUserId || null,
      });
      if (insRes.error) {
        // Try to clean up the storage file since metadata insert failed
        try { await supabase.storage.from(BUCKET_NAME).remove([storagePath]); } catch (_) {}
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
        var rmRes = await supabase.storage.from(BUCKET_NAME).remove([att.storage_path]);
        if (rmRes.error) {
          console.warn('[attachments] storage remove failed (proceeding to delete metadata):', rmRes.error.message);
        }
      } catch (e) { console.warn('[attachments] storage remove threw:', e); }

      // 2. Delete the metadata row
      var delRes = await supabase.from('attachments').delete().eq('id', att.id);
      if (delRes.error) throw delRes.error;

      // 3. Log to audit_log (best-effort)
      try {
        await supabase.from('audit_log').insert({
          table_name: 'attachments',
          record_id: att.id,
          action: 'DELETE',
          changed_by: currentUserId || null,
          field_changes: {
            file_name: att.file_name,
            parent_type: att.parent_type,
            parent_id: att.parent_id,
            file_size: att.file_size,
          },
        });
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
        📎 ATTACHMENTS ({items.length})
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
                Drag files here or click to pick / اسحب الملفات أو اضغط للاختيار
              </div>
              <div className="text-[10px] text-slate-500 mb-2">Max 100 MB per file · any type</div>
              <label className="inline-block cursor-pointer">
                <input
                  type="file"
                  multiple
                  onChange={handleFileInput}
                  disabled={uploading}
                  className="hidden"
                />
                <span className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded inline-block">
                  📤 Choose File(s)
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
            return (
              <div
                key={att.id}
                className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2 hover:bg-slate-50"
              >
                <div className="text-2xl">{fileIcon(att.file_name, att.mime_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate" title={att.file_name}>
                    {att.file_name}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {fmtSize(att.file_size)} · uploaded by {uploaderName(att.uploaded_by)} · {fmtDate(att.uploaded_at)}
                  </div>
                </div>
                {isImage && att.public_url && (
                  <a
                    href={att.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-10 h-10 rounded overflow-hidden bg-slate-200 flex-shrink-0"
                    title="Preview image"
                  >
                    <img src={att.public_url} alt={att.file_name} className="w-full h-full object-cover" />
                  </a>
                )}
                <a
                  href={att.public_url}
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
