import React, { useState, useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete } from '../lib/supabase';

// ============================================================
// Social Content Studio
// Generate per-platform marketing posts for NextTrade / KTC,
// edit them, save to a content calendar, mark approved/posted.
// Round one: generate + calendar + copy. Direct publishing to
// Meta / LinkedIn is a later phase once content quality is proven.
// ============================================================

var PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn', icon: '💼', color: '#0a66c2' },
  { id: 'instagram', label: 'Instagram', icon: '📸', color: '#c13584' },
  { id: 'facebook', label: 'Facebook', icon: '👍', color: '#1877f2' },
];

var GOALS = [
  { id: 'announce', label: 'Announce', hint: 'New product, capability, milestone' },
  { id: 'educate', label: 'Educate', hint: 'Teach something, build authority' },
  { id: 'promote', label: 'Promote', hint: 'Drive inquiries, soft call to action' },
  { id: 'authority', label: 'Authority', hint: 'Thought leadership, expertise' },
];

var TONES = ['professional', 'confident', 'friendly', 'bold', 'technical'];

function platformMeta(id) {
  for (var i = 0; i < PLATFORMS.length; i++) if (PLATFORMS[i].id === id) return PLATFORMS[i];
  return { id: id, label: id, icon: '•', color: '#64748b' };
}

export default function SocialContentTab(props) {
  var toast = props.toast || function () {};
  var user = props.user || {};

  var [topic, setTopic] = useState('');
  var [goal, setGoal] = useState('promote');
  var [tone, setTone] = useState('professional');
  var [selectedPlatforms, setSelectedPlatforms] = useState(['linkedin', 'instagram', 'facebook']);
  var [notes, setNotes] = useState('');
  var [bilingual, setBilingual] = useState(false);
  var [generating, setGenerating] = useState(false);
  var [drafts, setDrafts] = useState([]);   // freshly generated, not yet saved
  var [saved, setSaved] = useState([]);      // from social_posts table
  var [loadingSaved, setLoadingSaved] = useState(true);
  var [filterStatus, setFilterStatus] = useState('all');
  // Image -> content mode
  var [imageData, setImageData] = useState(null);   // base64 (no prefix)
  var [imageMime, setImageMime] = useState('');
  var [imagePreview, setImagePreview] = useState(''); // data URL for <img>
  var [wantReel, setWantReel] = useState(true);
  var [reelScript, setReelScript] = useState([]);
  var [productRead, setProductRead] = useState(null);

  useEffect(function () { loadSaved(); }, []);

  async function loadSaved() {
    setLoadingSaved(true);
    try {
      var res = await supabase
        .from('social_posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      setSaved(res.data || []);
    } catch (e) {
      toast('Could not load saved posts', 'error');
    }
    setLoadingSaved(false);
  }

  function togglePlatform(id) {
    setSelectedPlatforms(function (prev) {
      return prev.indexOf(id) >= 0 ? prev.filter(function (p) { return p !== id; }) : prev.concat([id]);
    });
  }

  async function generate() {
    if (!topic.trim()) { toast('Enter a topic first', 'error'); return; }
    if (selectedPlatforms.length === 0) { toast('Pick at least one platform', 'error'); return; }
    setGenerating(true);
    setDrafts([]);
    try {
      var resp = await fetch('/api/social-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic, goal: goal, tone: tone,
          platforms: selectedPlatforms, notes: notes, bilingual: bilingual,
        }),
      });
      var data = await resp.json();
      if (!resp.ok || data.error) {
        toast(data.error || 'Generation failed', 'error');
        setGenerating(false);
        return;
      }
      // Attach an editable id + the request context to each draft
      var withIds = (data.posts || []).map(function (p, i) {
        return {
          _localId: 'd' + Date.now() + '_' + i,
          platform: p.platform,
          caption: p.caption || '',
          hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
          imageIdea: p.imageIdea || '',
          topic: topic, goal: goal, tone: tone,
        };
      });
      setDrafts(withIds);
      toast('Generated ' + withIds.length + ' posts', 'success');
    } catch (e) {
      toast('Generation error', 'error');
    }
    setGenerating(false);
  }

  // ---- Image -> content -----------------------------------------
  function handleImagePick(e) {
    var file = (e.target.files || [])[0];
    if (!file) return;
    if (!/^image\//i.test(file.type)) { toast('Pick an image file', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('Image too large (max 8 MB)', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var result = String(reader.result || '');
      setImagePreview(result);
      // strip the data: prefix for the API
      var comma = result.indexOf(',');
      setImageData(comma >= 0 ? result.substring(comma + 1) : result);
      setImageMime(file.type);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function clearImage() {
    setImageData(null); setImageMime(''); setImagePreview('');
    setReelScript([]); setProductRead(null);
  }

  async function generateFromImage() {
    if (!imageData) { toast('Upload a product photo first', 'error'); return; }
    if (selectedPlatforms.length === 0) { toast('Pick at least one platform', 'error'); return; }
    setGenerating(true);
    setDrafts([]); setReelScript([]); setProductRead(null);
    try {
      var resp = await fetch('/api/image-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: imageData, mimeType: imageMime,
          platforms: selectedPlatforms, tone: tone, notes: notes,
          reel: wantReel, bilingual: bilingual,
        }),
      });
      var data = await resp.json();
      if (!resp.ok || data.error) {
        toast(data.error || 'Generation failed', 'error');
        setGenerating(false);
        return;
      }
      var withIds = (data.posts || []).map(function (p, i) {
        return {
          _localId: 'img' + Date.now() + '_' + i,
          platform: p.platform,
          caption: p.caption || '',
          hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
          imageIdea: '',
          topic: 'Product photo', goal: 'promote', tone: tone,
        };
      });
      setDrafts(withIds);
      setReelScript(data.reelScript || []);
      setProductRead(data.productRead || null);
      toast('Generated from photo', 'success');
    } catch (e) {
      toast('Generation error', 'error');
    }
    setGenerating(false);
  }

  function updateDraft(localId, field, value) {
    setDrafts(function (prev) {
      return prev.map(function (d) {
        if (d._localId !== localId) return d;
        var copy = Object.assign({}, d);
        copy[field] = value;
        return copy;
      });
    });
  }

  async function saveDraft(draft, status) {
    try {
      await dbInsert('social_posts', {
        tenant_id: 'ktc',
        topic: draft.topic,
        goal: draft.goal,
        tone: draft.tone,
        platform: draft.platform,
        caption: draft.caption,
        hashtags: draft.hashtags,
        image_idea: draft.imageIdea,
        status: status || 'draft',
        created_by: user.id || null,
      }, user.id);
      toast('Saved to calendar', 'success');
      setDrafts(function (prev) { return prev.filter(function (d) { return d._localId !== draft._localId; }); });
      loadSaved();
    } catch (e) {
      toast('Save failed: ' + (e.message || ''), 'error');
    }
  }

  async function setStatus(post, status) {
    try {
      var changes = { status: status };
      if (status === 'posted') changes.posted_at = new Date().toISOString();
      await dbUpdate('social_posts', post.id, changes, user.id);
      loadSaved();
    } catch (e) {
      toast('Update failed', 'error');
    }
  }

  async function removePost(post) {
    if (!confirm('Delete this post from the calendar?')) return;
    try {
      await dbDelete('social_posts', post.id, user.id);
      loadSaved();
    } catch (e) {
      toast('Delete failed', 'error');
    }
  }

  function copyPost(caption, hashtags) {
    var text = caption + (hashtags && hashtags.length ? '\n\n' + hashtags.join(' ') : '');
    try {
      navigator.clipboard.writeText(text);
      toast('Copied to clipboard', 'success');
    } catch (e) {
      toast('Copy failed — select and copy manually', 'error');
    }
  }

  var visibleSaved = filterStatus === 'all'
    ? saved
    : saved.filter(function (p) { return p.status === filterStatus; });

  var statusCounts = {
    all: saved.length,
    draft: saved.filter(function (p) { return p.status === 'draft'; }).length,
    approved: saved.filter(function (p) { return p.status === 'approved'; }).length,
    posted: saved.filter(function (p) { return p.status === 'posted'; }).length,
  };

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-slate-900">📣 Social Content Studio</h1>
        <p className="text-sm text-slate-600 mt-1">Generate on-brand posts for LinkedIn, Instagram, and Facebook. Edit, save to your calendar, approve, and mark as posted.</p>
      </div>

      {/* ── Generator panel ─────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-6">

        {/* Photo → content */}
        <div className="mb-4 pb-4 border-b border-slate-100">
          <label className="block text-xs font-bold text-slate-700 mb-2">📸 Generate from a product photo (optional)</label>
          {!imagePreview ? (
            <label className="inline-block px-4 py-2 rounded-lg text-sm font-bold cursor-pointer bg-slate-100 text-slate-700 hover:bg-slate-200 transition">
              + Upload product photo
              <input type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
            </label>
          ) : (
            <div className="flex items-start gap-3">
              <img src={imagePreview} alt="product" className="w-28 h-28 object-cover rounded-lg border border-slate-200" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={wantReel} onChange={function (e) { setWantReel(e.target.checked); }} />
                    Include a Reel/video script
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={generateFromImage} disabled={generating}
                    className={'px-4 py-2 rounded-lg text-sm font-bold ' + (generating ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-purple-600 text-white hover:bg-purple-700')}>
                    {generating ? '✨ Reading photo…' : '✨ Generate from photo'}
                  </button>
                  <button onClick={clearImage} className="px-3 py-2 rounded-lg text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">Clear</button>
                </div>
                <div className="text-[11px] text-slate-500 mt-1.5">Uses Tone + Platforms selected below. Posts appear in the review area.</div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Topic / Product</label>
            <input
              type="text" value={topic}
              onChange={function (e) { setTopic(e.target.value); }}
              placeholder="e.g. PVC automotive leather, 180cm roll width advantage"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Goal</label>
            <div className="grid grid-cols-2 gap-1.5">
              {GOALS.map(function (g) {
                var active = goal === g.id;
                return (
                  <button key={g.id} onClick={function () { setGoal(g.id); }}
                    title={g.hint}
                    className={'px-2 py-1.5 rounded-lg text-xs font-bold transition ' + (active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Tone</label>
            <select value={tone} onChange={function (e) { setTone(e.target.value); }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm capitalize">
              {TONES.map(function (t) { return <option key={t} value={t} className="capitalize">{t}</option>; })}
            </select>
            <div className="mt-2 flex items-center gap-2">
              <input id="bilingual-chk" type="checkbox" checked={bilingual}
                onChange={function (e) { setBilingual(e.target.checked); }} />
              <label htmlFor="bilingual-chk" className="text-xs font-semibold text-slate-700">Also generate Arabic version</label>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Platforms</label>
            <div className="flex gap-2 flex-wrap">
              {PLATFORMS.map(function (p) {
                var active = selectedPlatforms.indexOf(p.id) >= 0;
                return (
                  <button key={p.id} onClick={function () { togglePlatform(p.id); }}
                    className={'px-3 py-1.5 rounded-lg text-xs font-bold transition border ' + (active ? 'text-white border-transparent' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200')}
                    style={active ? { background: p.color } : {}}>
                    {p.icon} {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 mb-1">Additional notes (optional)</label>
            <input type="text" value={notes}
              onChange={function (e) { setNotes(e.target.value); }}
              placeholder="e.g. mention our new Canada warehouse, or a specific promotion"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={generate} disabled={generating}
            className={'px-5 py-2.5 rounded-lg font-bold text-sm transition ' + (generating ? 'bg-slate-300 text-slate-500 cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700 shadow')}>
            {generating ? '✨ Generating…' : '✨ Generate Posts'}
          </button>
        </div>
      </div>

      {/* ── Freshly generated drafts ────────────────────────── */}
      {drafts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-extrabold text-slate-900 mb-3 uppercase tracking-wide">Generated — review &amp; save</h2>

          {productRead && (productRead.type || (productRead.useCases && productRead.useCases.length)) && (
            <div className="mb-4 bg-purple-50 border border-purple-200 rounded-xl p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-purple-700 mb-1">📸 What the AI saw in the photo</div>
              {productRead.type && <div className="text-sm text-slate-800"><span className="font-bold">Product:</span> {productRead.type}{productRead.materials ? ' · ' + productRead.materials : ''}{productRead.colors ? ' · ' + productRead.colors : ''}</div>}
              {Array.isArray(productRead.useCases) && productRead.useCases.length > 0 && (
                <div className="text-xs text-slate-600 mt-1"><span className="font-bold">Use cases:</span> {productRead.useCases.join(', ')}</div>
              )}
              {Array.isArray(productRead.marketingAngles) && productRead.marketingAngles.length > 0 && (
                <div className="text-xs text-slate-600 mt-1"><span className="font-bold">Angles:</span> {productRead.marketingAngles.join(' · ')}</div>
              )}
            </div>
          )}

          {reelScript && reelScript.length > 0 && (
            <div className="mb-4 bg-slate-900 text-white rounded-xl p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-purple-300 mb-2">🎬 Reel / Video Script</div>
              <div className="space-y-2">
                {reelScript.map(function (sc, i) {
                  return (
                    <div key={i} className="flex gap-3 text-sm">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <div>
                        <div className="text-slate-300 text-xs italic">{sc.scene}</div>
                        <div className="text-white">{sc.voiceover}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={function () { try { navigator.clipboard.writeText(reelScript.map(function (s, i) { return (i + 1) + '. [' + s.scene + '] ' + s.voiceover; }).join('\n')); toast('Script copied', 'success'); } catch (e) {} }}
                className="mt-3 px-2.5 py-1 rounded text-[11px] font-bold bg-white/10 text-white hover:bg-white/20">📋 Copy script</button>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {drafts.map(function (d) {
              var pm = platformMeta(d.platform);
              return (
                <div key={d._localId} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
                  <div className="px-3 py-2 flex items-center gap-2 text-white font-bold text-xs" style={{ background: pm.color }}>
                    <span>{pm.icon}</span><span>{pm.label}</span>
                  </div>
                  <div className="p-3 flex-1 flex flex-col gap-2">
                    <textarea value={d.caption}
                      onChange={function (e) { updateDraft(d._localId, 'caption', e.target.value); }}
                      rows={7}
                      className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-y focus:ring-2 focus:ring-blue-400" />
                    <input type="text" value={(d.hashtags || []).join(' ')}
                      onChange={function (e) { updateDraft(d._localId, 'hashtags', e.target.value.split(/\s+/).filter(Boolean)); }}
                      className="w-full text-xs text-blue-700 border border-slate-200 rounded-lg p-2 font-mono"
                      placeholder="#hashtags" />
                    {d.imageIdea && (
                      <div className="text-[11px] text-slate-500 italic bg-slate-50 rounded p-2 border border-slate-100">
                        🖼️ {d.imageIdea}
                      </div>
                    )}
                  </div>
                  <div className="px-3 py-2 border-t border-slate-100 flex gap-1.5 flex-wrap">
                    <button onClick={function () { copyPost(d.caption, d.hashtags); }}
                      className="px-2.5 py-1 rounded text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">📋 Copy</button>
                    <button onClick={function () { saveDraft(d, 'draft'); }}
                      className="px-2.5 py-1 rounded text-[11px] font-bold bg-slate-700 text-white hover:bg-slate-800">💾 Save Draft</button>
                    <button onClick={function () { saveDraft(d, 'approved'); }}
                      className="px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700">✓ Approve</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Content calendar (saved posts) ──────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">Content Calendar</h2>
          <div className="flex gap-1.5">
            {['all', 'draft', 'approved', 'posted'].map(function (s) {
              var active = filterStatus === s;
              return (
                <button key={s} onClick={function () { setFilterStatus(s); }}
                  className={'px-3 py-1.5 rounded-lg text-xs font-bold transition capitalize ' + (active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                  {s} ({statusCounts[s]})
                </button>
              );
            })}
          </div>
        </div>

        {loadingSaved ? (
          <div className="text-center text-slate-500 py-10 bg-slate-50 rounded-xl border border-slate-200">Loading…</div>
        ) : visibleSaved.length === 0 ? (
          <div className="text-center text-slate-600 py-10 bg-slate-50 rounded-xl border border-slate-200">
            No posts {filterStatus !== 'all' ? 'with status "' + filterStatus + '"' : 'yet'}. Generate some above.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {visibleSaved.map(function (p) {
              var pm = platformMeta(p.platform);
              var statusColor = p.status === 'posted' ? 'bg-emerald-100 text-emerald-800'
                : p.status === 'approved' ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-200 text-slate-700';
              return (
                <div key={p.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
                  <div className="px-3 py-2 flex items-center justify-between text-white text-xs font-bold" style={{ background: pm.color }}>
                    <span>{pm.icon} {pm.label}</span>
                    <span className={'px-2 py-0.5 rounded-full text-[10px] font-bold ' + statusColor}>{p.status}</span>
                  </div>
                  <div className="p-3 flex-1 flex flex-col gap-2">
                    <div className="text-[11px] text-slate-500 font-semibold">{p.topic}</div>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap">{p.caption}</div>
                    {p.hashtags && p.hashtags.length > 0 && (
                      <div className="text-xs text-blue-700 font-mono">{p.hashtags.join(' ')}</div>
                    )}
                    {p.image_idea && (
                      <div className="text-[11px] text-slate-500 italic bg-slate-50 rounded p-2 border border-slate-100">🖼️ {p.image_idea}</div>
                    )}
                  </div>
                  <div className="px-3 py-2 border-t border-slate-100 flex gap-1.5 flex-wrap">
                    <button onClick={function () { copyPost(p.caption, p.hashtags); }}
                      className="px-2.5 py-1 rounded text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200">📋 Copy</button>
                    {p.status !== 'approved' && p.status !== 'posted' && (
                      <button onClick={function () { setStatus(p, 'approved'); }}
                        className="px-2.5 py-1 rounded text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700">✓ Approve</button>
                    )}
                    {p.status !== 'posted' && (
                      <button onClick={function () { setStatus(p, 'posted'); }}
                        className="px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700">📤 Mark Posted</button>
                    )}
                    <button onClick={function () { removePost(p); }}
                      className="px-2.5 py-1 rounded text-[11px] font-bold bg-red-100 text-red-700 hover:bg-red-200">🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
