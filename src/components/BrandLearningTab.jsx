import React, { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';

// ============================================================
// Brand Learning Engine
// Upload catalogs / spec sheets / product photos, or add website
// URLs. The AI reads each source and extracts structured product
// knowledge. You review and approve. Approved knowledge feeds the
// Social Content Studio so posts cite your real products.
// ============================================================

var BUCKET_NAME = 'attachments';

function sanitizePath(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 120);
}
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default function BrandLearningTab(props) {
  var toast = props.toast || function () {};
  var user = props.user || {};

  var [sources, setSources] = useState([]);
  var [knowledge, setKnowledge] = useState([]);
  var [loading, setLoading] = useState(true);
  var [uploading, setUploading] = useState(false);
  var [urlInput, setUrlInput] = useState('');
  var [urlLabel, setUrlLabel] = useState('');
  var [learningId, setLearningId] = useState(null); // sourceId currently being extracted

  useEffect(function () { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      var sRes = await supabase.from('brand_sources').select('*').order('created_at', { ascending: false }).limit(200);
      var kRes = await supabase.from('brand_knowledge').select('*').order('created_at', { ascending: false }).limit(200);
      setSources(sRes.data || []);
      setKnowledge(kRes.data || []);
    } catch (e) {
      toast('Could not load brand knowledge', 'error');
    }
    setLoading(false);
  }

  function knowledgeForSource(sourceId) {
    for (var i = 0; i < knowledge.length; i++) if (knowledge[i].source_id === sourceId) return knowledge[i];
    return null;
  }

  // ---- Upload a file as a source --------------------------------
  async function handleFileUpload(e) {
    var files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var timestamp = Date.now();
        var safeName = sanitizePath(file.name);
        var storagePath = 'brand/' + (user.id || 'anon') + '/' + timestamp + '-' + safeName;
        var up = await supabase.storage.from(BUCKET_NAME).upload(storagePath, file, {
          cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream',
        });
        if (up.error) {
          var em = (up.error && up.error.message) || String(up.error);
          if (/bucket.*not found|does not exist/i.test(em)) {
            toast('Storage bucket "attachments" missing — create it in Supabase Storage', 'error');
          } else {
            toast('Upload failed: ' + em, 'error');
          }
          continue;
        }
        var urlRes = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
        var publicUrl = (urlRes && urlRes.data && urlRes.data.publicUrl) || '';
        await dbInsert('brand_sources', {
          tenant_id: 'ktc',
          source_type: 'file',
          label: file.name,
          file_name: file.name,
          mime_type: file.type || null,
          storage_path: storagePath,
          public_url: publicUrl,
          status: 'pending',
          created_by: user.id || null,
        }, user.id);
      } catch (err) {
        toast('Upload error: ' + (err.message || ''), 'error');
      }
    }
    setUploading(false);
    e.target.value = '';
    toast('Uploaded — now click Learn on each source', 'success');
    loadAll();
  }

  // ---- Add a website URL as a source ----------------------------
  async function addUrl() {
    var u = urlInput.trim();
    if (!u) { toast('Enter a URL', 'error'); return; }
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      await dbInsert('brand_sources', {
        tenant_id: 'ktc',
        source_type: 'url',
        label: urlLabel.trim() || u,
        public_url: u,
        status: 'pending',
        created_by: user.id || null,
      }, user.id);
      setUrlInput(''); setUrlLabel('');
      toast('Website added — click Learn to analyze it', 'success');
      loadAll();
    } catch (e) {
      toast('Could not add URL: ' + (e.message || ''), 'error');
    }
  }

  // ---- Trigger extraction for a source --------------------------
  async function learn(source) {
    setLearningId(source.id);
    try {
      var resp = await fetch('/api/brand-learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.id }),
      });
      var data = await resp.json();
      if (!resp.ok || data.error) {
        toast(data.error || 'Learning failed', 'error');
      } else {
        toast('Learned from ' + (source.label || 'source'), 'success');
      }
    } catch (e) {
      toast('Learning error', 'error');
    }
    setLearningId(null);
    loadAll();
  }

  async function approveKnowledge(k, approved) {
    try {
      await dbUpdate('brand_knowledge', k.id, { approved: approved }, user.id);
      loadAll();
    } catch (e) {
      toast('Update failed', 'error');
    }
  }

  async function updateKnowledgeField(k, field, value) {
    try {
      var changes = {}; changes[field] = value; changes.edited_by_user = true;
      await dbUpdate('brand_knowledge', k.id, changes, user.id);
      loadAll();
    } catch (e) {
      toast('Save failed', 'error');
    }
  }

  async function removeSource(source) {
    if (!confirm('Remove this source and what the AI learned from it?')) return;
    try {
      if (source.storage_path) {
        try { await supabase.storage.from(BUCKET_NAME).remove([source.storage_path]); } catch (_) {}
      }
      await dbDelete('brand_sources', source.id, user.id); // cascade removes knowledge
      loadAll();
    } catch (e) {
      toast('Delete failed', 'error');
    }
  }

  var approvedCount = knowledge.filter(function (k) { return k.approved; }).length;

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-slate-900">🧠 Brand Learning Engine</h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload catalogs, spec sheets, and product photos — or add your website — and the AI learns your real products.
          Review what it learned and approve it. Approved knowledge powers the Social Content Studio so posts cite your actual specs.
        </p>
        {approvedCount > 0 && (
          <div className="mt-2 inline-block px-3 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold">
            ✓ {approvedCount} knowledge {approvedCount === 1 ? 'source' : 'sources'} approved and feeding content
          </div>
        )}
      </div>

      {/* ── Add sources ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-2">📄 Upload files</h2>
          <p className="text-xs text-slate-600 mb-3">PDF catalogs, spec sheets, price lists, or product photos.</p>
          <label className={'inline-block px-4 py-2 rounded-lg text-sm font-bold cursor-pointer transition ' + (uploading ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700')}>
            {uploading ? 'Uploading…' : '+ Choose files'}
            <input type="file" multiple accept=".pdf,image/*,.txt" onChange={handleFileUpload} disabled={uploading} className="hidden" />
          </label>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800 mb-2">🌐 Add a website</h2>
          <p className="text-xs text-slate-600 mb-3">Your site or a product page. Add multiple if you have them.</p>
          <input type="text" value={urlLabel} onChange={function (e) { setUrlLabel(e.target.value); }}
            placeholder="Label (optional, e.g. NextTrade homepage)"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-2" />
          <div className="flex gap-2">
            <input type="text" value={urlInput} onChange={function (e) { setUrlInput(e.target.value); }}
              placeholder="https://yoursite.com/products"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            <button onClick={addUrl} className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-bold hover:bg-slate-800">Add</button>
          </div>
        </div>
      </div>

      {/* ── Sources + what was learned ──────────────────────── */}
      <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide mb-3">Sources &amp; Knowledge</h2>
      {loading ? (
        <div className="text-center text-slate-500 py-10 bg-slate-50 rounded-xl border border-slate-200">Loading…</div>
      ) : sources.length === 0 ? (
        <div className="text-center text-slate-600 py-10 bg-slate-50 rounded-xl border border-slate-200">
          No sources yet. Upload a catalog or add your website above to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {sources.map(function (s) {
            var k = knowledgeForSource(s.id);
            var statusBadge = s.status === 'learned' ? 'bg-emerald-100 text-emerald-800'
              : s.status === 'processing' ? 'bg-amber-100 text-amber-800'
              : s.status === 'failed' ? 'bg-red-100 text-red-700'
              : 'bg-slate-200 text-slate-700';
            return (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg">{s.source_type === 'url' ? '🌐' : (/image/i.test(s.mime_type || '') ? '🖼️' : '📄')}</span>
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-slate-800 truncate">{s.label || s.file_name || s.public_url}</div>
                      <div className="text-[11px] text-slate-500 truncate">{s.source_type === 'url' ? s.public_url : (s.mime_type || '')}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={'px-2 py-0.5 rounded-full text-[10px] font-bold ' + statusBadge}>{s.status}</span>
                    {s.status !== 'learned' && (
                      <button onClick={function () { learn(s); }} disabled={learningId === s.id}
                        className={'px-3 py-1 rounded-lg text-xs font-bold ' + (learningId === s.id ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700')}>
                        {learningId === s.id ? '🧠 Learning…' : '🧠 Learn'}
                      </button>
                    )}
                    {s.status === 'learned' && (
                      <button onClick={function () { learn(s); }} disabled={learningId === s.id}
                        className="px-2 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200" title="Re-analyze">↻</button>
                    )}
                    <button onClick={function () { removeSource(s); }}
                      className="px-2 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200">🗑️</button>
                  </div>
                </div>

                {s.status === 'failed' && s.error_msg && (
                  <div className="px-4 py-2 text-xs text-red-700 bg-red-50">{s.error_msg}</div>
                )}

                {k && (
                  <div className={'px-4 py-3 ' + (k.approved ? 'bg-emerald-50/40' : '')}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">What the AI learned {k.edited_by_user ? '(edited)' : ''}</span>
                      <div className="flex gap-1.5">
                        {k.approved ? (
                          <button onClick={function () { approveKnowledge(k, false); }}
                            className="px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700">✓ Approved (click to unapprove)</button>
                        ) : (
                          <button onClick={function () { approveKnowledge(k, true); }}
                            className="px-2.5 py-1 rounded text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700">✓ Approve for use</button>
                        )}
                      </div>
                    </div>

                    <label className="block text-[10px] font-bold text-slate-600 mb-1">Summary</label>
                    <textarea defaultValue={k.summary} rows={2}
                      onBlur={function (e) { if (e.target.value !== k.summary) updateKnowledgeField(k, 'summary', e.target.value); }}
                      className="w-full text-sm border border-slate-200 rounded-lg p-2 mb-2 resize-y" />

                    {Array.isArray(k.products) && k.products.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] font-bold text-slate-600 mb-1">Products ({k.products.length})</div>
                        <div className="flex flex-wrap gap-1.5">
                          {k.products.map(function (p, idx) {
                            return (
                              <span key={idx} className="px-2 py-1 rounded bg-slate-100 text-slate-700 text-[11px] font-semibold" title={(p.features || []).join(', ')}>
                                {p.name}{p.category ? ' · ' + p.category : ''}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {Array.isArray(k.keywords) && k.keywords.length > 0 && (
                      <div className="mb-1">
                        <div className="text-[10px] font-bold text-slate-600 mb-1">Keywords</div>
                        <div className="text-xs text-blue-700 font-mono">{k.keywords.join(' · ')}</div>
                      </div>
                    )}

                    {k.target_customers && (
                      <div className="text-[11px] text-slate-600 mt-1"><span className="font-bold">Target:</span> {k.target_customers}</div>
                    )}
                    {k.brand_voice && (
                      <div className="text-[11px] text-slate-600 mt-1"><span className="font-bold">Voice:</span> {k.brand_voice}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
