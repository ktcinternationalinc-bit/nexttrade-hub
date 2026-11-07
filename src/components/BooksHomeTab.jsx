'use client';
// v55.83-PB — Accounting > 🏦 Books (Max, Nov 5): "something useful where all
// of these things are being matched in the background for expenses and i am
// easily matching items to invoices... see how money will move in and out".
// One home screen: money in/out for a period, expected-in vs bills-due, and
// WORK QUEUES — deposits to match, expenses to categorize (one click, with
// background rule proposals), bills due. All US business.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { US_WAVE_BUSINESS_ID } from '../lib/business-of';
import { CLASSIFICATIONS } from '../lib/bank-permissions';
import { bestRule } from '../lib/expense-rules'; // v55.83-PI — suggest from learned rules
import { bankSessionHeaders } from '../lib/bank-visibility-client';

function nd(x) { return (x === null || x === undefined) ? '—' : '$' + (Number(x) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } // v55.83-PO
function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function iso(d) { return d.toISOString().substring(0, 10); }
function agoDays(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
var TODAY = iso(new Date());

export default function BooksHomeTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var toast = props.toast || { success: function () {}, error: function () {} };
  var onGo = props.onGo || function () {};

  var s1 = useState('2026-06-01'); var from = s1[0]; var setFrom = s1[1]; // v55.83-PO (Max 04:31): "should default to june 1st when first showing page"
  var s2 = useState(''); var to = s2[0]; var setTo = s2[1];
  var s3 = useState(null); var cf = s3[0]; var setCf = s3[1];
  var s4 = useState({ in_unmatched: 0, out_unreviewed: 0 }); var qCounts = s4[0]; var setQCounts = s4[1];
  var s5 = useState([]); var outQueue = s5[0]; var setOutQueue = s5[1];
  var s6 = useState({}); var clsDraft = s6[0]; var setClsDraft = s6[1];
  var sCat = useState(null); var dynCats = sCat[0]; var setDynCats = sCat[1]; // v55.83-PI custom categories
  var sRul = useState([]); var hubRules = sRul[0]; var setHubRules = sRul[1]; // v55.83-PI learned/manual rules
  var s7 = useState([]); var proposals = s7[0]; var setProposals = s7[1];
  var s8 = useState(false); var busy = s8[0]; var setBusy = s8[1];
  var s9 = useState('Jun 1 →'); var preset = s9[0]; var setPreset = s9[1];
  var s10 = useState(null); var late = s10[0]; var setLate = s10[1];
  var s11 = useState(null); var drift = s11[0]; var setDrift = s11[1];
  var s12 = useState({}); var remTone = s12[0]; var setRemTone = s12[1];
  var s13 = useState(null); var fc = s13[0]; var setFc = s13[1]; // aging forecast strip
  var s14b = useState(null); var fcDrill = s14b[0]; var setFcDrill = s14b[1]; // v55.83-PK {bucket, kind} — the rows behind a strip number
  var s15b = useState(null); var cfDrill = s15b[0]; var setCfDrill = s15b[1]; // v55.83-PL {keys:[{key,sign}], title} — the rows behind a period card
  var s16b = useState(null); var ps = s16b[0]; var setPs = s16b[1]; // v55.83-PN — sales with ACTUAL invoices for the period (same engine as the Stats tab)

  var PRESETS = [
    ['Jun 1 →', '2026-06-01', ''], // v55.83-PK (Max): "something from june 1st as selection next to month year etc"
    ['This year', TODAY.substring(0, 4) + '-01-01', ''],
    ['Nov 1 →', '2026-11-01', ''],
    ['Last 30 days', agoDays(30), ''],
    ['Last 7 days', agoDays(7), ''],
    ['This month', TODAY.substring(0, 8) + '01', ''],
  ];

  function billsApi(payload) {
    return fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json(); });
  }

  function loadCashflow(f, t) {
    billsApi({ action: 'cashflow', from: f, to: t || TODAY }).then(function (j) {
      if (j && j.ok) { setCf(j); }
      else { setCf({ denied: true, error: (j && j.error) || 'Could not load.' }); } // PG: never a stuck spinner
    }).catch(function () { setCf({ denied: true, error: 'Could not load.' }); });
  }
  function loadQueues() {
    // Deposits waiting to be matched to invoices (money in, unreviewed, unlinked)
    supabase.from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'in').eq('review_status', 'unreviewed')
      .is('matched_invoice_id', null).neq('pending', true)
      .then(function (r) { setQCounts(function (q) { return Object.assign({}, q, { in_unmatched: r.count || 0 }); }); });
    // Expenses waiting for a category (money out, unreviewed) — inline queue
    supabase.from('bank_transactions')
      .select('id, date, posted_date, amount_abs, name, merchant_name, classification, review_status, pending')
      .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').eq('review_status', 'unreviewed')
      .neq('pending', true).order('date', { ascending: false }).limit(8)
      .then(function (r) { setOutQueue(r.data || []); prefillSuggestions(r.data || [], hubRules); });
    supabase.from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out').eq('review_status', 'unreviewed').neq('pending', true)
      .then(function (r) { setQCounts(function (q) { return Object.assign({}, q, { out_unreviewed: r.count || 0 }); }); });
  }
  function loadCatalog() {
    // v55.83-PI — Max: "create categories to mark expenses... automatically
    // remember previous selections for the future and use them". Fail-soft:
    // until the PI SQL runs, the built-in list keeps working.
    supabase.from('expense_categories').select('key, label, active, sort').eq('active', true).order('sort')
      .then(function (r) { if (!r.error && r.data && r.data.length) { setDynCats(r.data); } })
      .catch(function () {});
    supabase.from('us_expense_rules').select('id, match_text, classification, auto_apply, active').eq('active', true).limit(1000)
      .then(function (r) { if (!r.error && r.data) { setHubRules(r.data); prefillSuggestions(outQueue, r.data); } })
      .catch(function () {});
  }
  function prefillSuggestions(queue, rulesList) {
    if (!queue || !queue.length || !rulesList || !rulesList.length) { return; }
    setClsDraft(function (d) {
      var nd = Object.assign({}, d);
      queue.forEach(function (t) {
        if (nd[t.id]) { return; } // never stomp a human's draft
        var r = bestRule(rulesList, (t.merchant_name || '') + ' ' + (t.name || ''));
        if (r) { nd[t.id] = r.classification; }
      });
      return nd;
    });
  }
  function loadProposals() {
    // Background rule engine suggestions (super admin / rules operators; hidden otherwise)
    bankSessionHeaders(supabase, false).then(function (h) {
      return fetch('/api/accounting/clickbooks-us/rules', { headers: h });
    }).then(function (r) { return r.json(); }).then(function (j) {
      var list = (j && j.ok && j.data && j.data.proposals) || [];
      setProposals(list.filter(function (p) { return p && p.state === 'proposed' && p.stale !== true; }).slice(0, 8));
    }).catch(function () { setProposals([]); });
  }
  function loadLate() {
    fetch('/api/accounting/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'suggest', min_days: 30, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) { setLate(j); }
        else { setLate({ rows: [], total_late: 0, total_open: 0, denied: true, error: (j && j.error) || '' }); } // PG: degrade, don't hang
      }).catch(function () { setLate({ rows: [], total_late: 0, total_open: 0, denied: true }); });
  }
  function loadForecastStrip() {
    billsApi({ action: 'forecast' }).then(function (j) {
      if (j && j.ok) { setFc(j); } else { setFc({ denied: true }); }
    }).catch(function () { setFc({ denied: true }); });
  }
  function loadDrift() {
    billsApi({ action: 'drift_status' }).then(function (j) {
      if (j && j.ok && j.available && j.drift && Number(j.drift.count) > 0) { setDrift(j.drift); }
    }).catch(function () {});
  }
  function remind(r, channel) {
    var key = r.invoice_id + channel;
    var tone = remTone[r.invoice_id] || 'gentle';
    fetch('/api/accounting/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', invoice_id: r.invoice_id, channel: channel, tone: tone, lang: 'en', user_id: userProfile && userProfile.id }) })
      .then(function (x) { return x.json(); }).then(function (j) {
        if (j && j.ok && j.channel === 'email') { toast.success('Reminder emailed to ' + j.to + ' — logged on the invoice.'); loadLate(); }
        else if (j && j.ok && j.wa_link) { toast.success('WhatsApp opened with the message ready — logged.'); window.open(j.wa_link, '_blank'); loadLate(); }
        else { toast.error((j && j.error) || 'Could not send.'); }
      });
  }
  useEffect(function () { loadCashflow(from, to); loadPeriodStats(from, to); loadQueues(); loadCatalog(); loadProposals(); loadLate(); loadDrift(); loadForecastStrip(); }, []);
  useEffect(function () { prefillSuggestions(outQueue, hubRules); }, [outQueue, hubRules]); // eslint-disable-line // eslint-disable-line

  function applyPeriod(f, t, label) { setFrom(f); setTo(t); setPreset(label); loadCashflow(f, t); loadPeriodStats(f, t); }
  function loadPeriodStats(f, t) {
    // v55.83-PN (Max, 04:16): "also need to see sales (with actual invoices)
    // as part of in and out section. add a new set of rows with this data."
    // Same period_stats engine as the 📉 Stats tab — one source of truth.
    billsApi({ action: 'period_stats', from: f, to: t || TODAY }).then(function (j) {
      if (j && j.ok) { setPs(j); } else { setPs(null); }
    }).catch(function () { setPs(null); });
  }

  function classify(t, cls) {
    if (!cls) { return; }
    setBusy(true);
    var patch = { classification: cls, review_status: 'reviewed', category_status: 'pending_wave_sync', category_source: 'classification' };
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/bank-write', { method: 'POST', headers: h,
        body: JSON.stringify({ action: 'classify', bank_transaction_id: t.id, patch: patch, user_id: userProfile && userProfile.id }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && (j.ok || j.success)) { toast.success('Categorized.'); loadQueues(); }
      else { toast.error((j && j.error) || 'Could not categorize.'); }
    }).catch(function (e) { toast.error('Could not categorize: ' + ((e && e.message) || 'network')); })
      .finally(function () { setBusy(false); });
  }
  function decideProposal(p, accept) {
    setBusy(true);
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/clickbooks-us/rules', { method: 'POST', headers: h,
        body: JSON.stringify({ action: 'decide_proposal', payload: { id: p.id, accept: accept, reason: accept ? 'Accepted from Books home by owner' : 'Dismissed from Books home by owner' } }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { toast.success(accept ? 'Applied.' : 'Dismissed.'); loadProposals(); loadQueues(); }
      else { toast.error((j && j.error) || 'Could not save the decision.'); }
    }).finally(function () { setBusy(false); });
  }

  var sum = (cf && cf.summary) || null;
  function Card(p2) {
    // v55.83-PL — cards are buttons: the rows that support the number open below
    var inner = <React.Fragment>
      <div className="text-[10px] font-extrabold" style={{ color: p2.fg, opacity: 0.75 }}>{p2.label}</div>
      <div className="text-lg font-extrabold tabular-nums" style={{ color: p2.fg }}>{p2.value}</div>
      {p2.sub && <div className="text-[10px] font-semibold" style={{ color: p2.fg, opacity: 0.75 }}>{p2.sub}</div>}
    </React.Fragment>;
    if (p2.onClick) {
      return <button onClick={p2.onClick} title="Show the rows behind this number" className="rounded-xl p-3 text-left"
        style={{ background: p2.bg, border: '1px solid ' + p2.border, minWidth: 150, cursor: 'pointer' }}>{inner}</button>;
    }
    return <div className="rounded-xl p-3" style={{ background: p2.bg, border: '1px solid ' + p2.border, minWidth: 150 }}>{inner}</div>;
  }

  return <div className="flex flex-col gap-3">
    {/* ── Period + cash flow ── */}
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold text-slate-900 mr-1">🏦 Books — money in & out (US)</div>
        {PRESETS.map(function (p2) {
          return <button key={p2[0]} onClick={function () { applyPeriod(p2[1], p2[2], p2[0]); }}
            className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={preset === p2[0] ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{p2[0]}</button>;
        })}
        <span className="text-[10px] font-bold text-slate-500">custom:</span>
        <input type="date" className="px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={from} onChange={function (e) { applyPeriod(e.target.value, to, 'custom'); }} />
        <span className="text-[10px] text-slate-500">→</span>
        <input type="date" className="px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white" value={to} onChange={function (e) { applyPeriod(from, e.target.value, 'custom'); }} />
      </div>
      {cf && cf.denied ? <div className="text-[11px]" style={{ color: '#92400e' }}>{cf.error || 'The money view needs the Bills: View permission — ask an admin in Settings → Permissions.'}</div> :
       !sum ? <div className="text-[11px] text-slate-500">Loading cash flow…</div> :
        <div className="flex gap-2 flex-wrap">
          <Card label={'CAME IN (' + sum.actual_in_count + ' bank txns)'} value={'$' + fmt(sum.actual_in)} bg="#d1fae5" border="#a7f3d0" fg="#065f46" sub="settled deposits"
            onClick={function () { setCfDrill({ title: 'Came in — settled bank deposits', keys: [{ key: 'came_in', sign: 1 }] }); }} />
          <Card label={'SALES RECEIVED (' + (cf.sales_in_count || 0) + ')'} value={'$' + fmt(cf.sales_in || 0)} bg="#ecfdf5" border="#6ee7b7" fg="#064e3b" sub="deposits matched to invoices / customer payments"
            onClick={function () { setCfDrill({ title: 'Sales received — deposits matched to invoices or categorized customer payment', keys: [{ key: 'sales_in', sign: 1 }] }); }} />
          <Card label={'WENT OUT (' + sum.actual_out_count + ')'} value={'$' + fmt(sum.actual_out)} bg="#fee2e2" border="#fecaca" fg="#7f1d1d" sub="settled spending"
            onClick={function () { setCfDrill({ title: 'Went out — settled bank spending', keys: [{ key: 'went_out', sign: -1 }] }); }} />
          <Card label="NET MOVED" value={(sum.actual_net >= 0 ? '+$' : '−$') + fmt(Math.abs(sum.actual_net))} bg="#e0e7ff" border="#c7d2fe" fg="#312e81" sub="in − out, bank reality"
            onClick={function () { setCfDrill({ title: 'Net moved — every settled bank transaction (in +, out −)', keys: [{ key: 'came_in', sign: 1 }, { key: 'went_out', sign: -1 }] }); }} />
          <Card label={'EXPECTED IN (' + sum.expected_in_count + ' invoices due)'} value={'$' + fmt(sum.expected_in)} bg="#ecfeff" border="#a5f3fc" fg="#155e75" sub="open invoices due in period"
            onClick={function () { setCfDrill({ title: 'Expected in — open invoices due in this period', keys: [{ key: 'expected_in', sign: 1 }] }); }} />
          <Card label={'BILLS DUE (' + sum.due_out_count + ')'} value={'$' + fmt(sum.due_out)} bg="#ffedd5" border="#fed7aa" fg="#431407" sub={sum.overdue_out > 0 ? ('⚠ $' + fmt(sum.overdue_out) + ' already overdue') : 'nothing overdue'}
            onClick={function () { setCfDrill({ title: 'Bills due in this period', keys: [{ key: 'bills_due', sign: -1 }] }); }} />
          <Card label="PROJECTED NET" value={(sum.projected_net >= 0 ? '+$' : '−$') + fmt(Math.abs(sum.projected_net))} bg={sum.projected_net >= 0 ? '#d1fae5' : '#fee2e2'} border={sum.projected_net >= 0 ? '#a7f3d0' : '#fecaca'} fg={sum.projected_net >= 0 ? '#065f46' : '#7f1d1d'} sub="expected in − bills due"
            onClick={function () { setCfDrill({ title: 'Projected net — expected in (+) vs bills due (−)', keys: [{ key: 'expected_in', sign: 1 }, { key: 'bills_due', sign: -1 }] }); }} />
        </div>}
      {ps && ps.invoices && <div className="mt-2">
        <div className="text-[10px] font-extrabold mb-1" style={{ color: '#64748b' }}>🧾 SALES — ACTUAL INVOICES IN THIS PERIOD (click for the invoices)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <Card label={'INVOICED (' + (ps.invoices.count || 0) + ' invoices)'} value={'$' + fmt(ps.invoices.invoiced)} bg="#eef2ff" border="#c7d2fe" fg="#312e81" sub="invoices issued in the period"
            onClick={function () { setCfDrill({ src: 'ps', title: 'Invoiced — actual invoices issued in this period', keys: [{ key: 'invoiced', sign: 1 }] }); }} />
          <Card label={'COLLECTED (' + (ps.invoices.collected_count || 0) + ' payments)'} value={'$' + fmt(ps.invoices.collected)} bg="#ecfdf5" border="#6ee7b7" fg="#064e3b" sub="payments recorded on invoices in the period"
            onClick={function () { setCfDrill({ src: 'ps', title: 'Collected — payments recorded on invoices in this period', keys: [{ key: 'collected', sign: 1 }] }); }} />
          <Card label="STILL OPEN (from these invoices)" value={'$' + fmt(ps.invoices.still_open_from_period)} bg="#fffbeb" border="#fcd34d" fg="#78350f" sub="invoiced in period, not yet paid"
            onClick={function () { setCfDrill({ src: 'ps', title: 'Still open — invoiced in this period, not yet paid', keys: [{ key: 'open_invoices', sign: 1 }] }); }} />
        </div>
      </div>}
      {cfDrill && cfDrill.src === 'ps' && !ps && <div className="mt-2 text-[11px] font-bold" style={{ color: '#431407', background: '#ffedd5', borderRadius: 8, padding: 8 }}>Could not load the invoice data for this period — check your Bills/AR permission.</div>}
      {cfDrill && (cfDrill.src === 'ps' ? (ps && ps.drills) : (cf && cf.drills)) && (function () {
        var srcMap = cf && cf.drills;
        if (cfDrill.src === 'ps') {
          var inv2 = ps.invoices || {};
          srcMap = {
            invoiced: { count: inv2.count || 0, sum: inv2.invoiced || 0, rows: (ps.drills && ps.drills.invoiced) || [] },
            collected: { count: inv2.collected_count || 0, sum: inv2.collected || 0, rows: (ps.drills && ps.drills.collected) || [] },
            open_invoices: { count: ((ps.drills && ps.drills.open_invoices) || []).length, sum: inv2.still_open_from_period || 0, rows: (ps.drills && ps.drills.open_invoices) || [] },
          };
        }
        return (function () {
        var merged = []; var total = 0; var fullCount = 0; var capped = false;
        cfDrill.keys.forEach(function (k) {
          var d3 = srcMap[k.key]; if (!d3) { return; }
          total += k.sign * d3.sum; fullCount += d3.count;
          if (d3.count > (d3.rows || []).length) { capped = true; }
          (d3.rows || []).forEach(function (r5) { merged.push({ ref: r5.ref, who: r5.who, date: r5.date, due: r5.due, total: r5.total, paid: r5.paid, amount: r5.amount, sign: k.sign, source: r5.source }); });
        });
        merged.sort(function (a3, b5) { return b5.amount - a3.amount; });
        var shown2 = merged.slice(0, 300);
        return <div className="mt-2 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="flex gap-2 items-center mb-1 flex-wrap">
            <div className="text-[11px] font-extrabold" style={{ color: '#0f172a' }}>
              {cfDrill.title} — {fullCount} row(s), Σ {(total >= 0 ? '+$' : '−$') + fmt(Math.abs(Math.round(total * 100) / 100))} (equals the card to the cent)</div>
            <div className="flex-1" />
            <button onClick={function () { setCfDrill(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: 320, overflowY: 'auto' }}><table className="w-full text-[10px]">
            <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
              <th className="py-1 pr-2 text-left font-semibold">Ref</th><th className="py-1 pr-2 text-left font-semibold">Who / description</th>
              <th className="py-1 pr-2 text-left font-semibold">Date</th><th className="py-1 pr-2 text-left font-semibold">Due</th>
              <th className="py-1 pr-2 text-right font-semibold">Original</th><th className="py-1 pr-2 text-right font-semibold">Paid</th>
              <th className="py-1 pr-2 text-right font-semibold">Amount</th><th className="py-1 text-left font-semibold">Where from</th></tr></thead>
            <tbody style={{ color: '#0f172a' }}>
              {shown2.map(function (r6, i2) {
                return <tr key={i2} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td className="py-0.5 pr-2 whitespace-nowrap">{r6.ref}</td>
                  <td className="py-0.5 pr-2 font-semibold">{String(r6.who || '').substring(0, 48)}</td>
                  <td className="py-0.5 pr-2 whitespace-nowrap">{r6.date || '—'}</td>
                  <td className="py-0.5 pr-2 whitespace-nowrap" style={{ color: '#7f1d1d' }}>{r6.due || '—'}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{nd(r6.total)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{nd(r6.paid)}</td>
                  <td className="py-0.5 pr-2 text-right font-extrabold tabular-nums" style={{ color: r6.sign < 0 ? '#7f1d1d' : '#065f46' }}>{(r6.sign < 0 ? '−$' : '+$') + fmt(r6.amount)}</td>
                  <td className="py-0.5" style={{ color: '#64748b' }}>{r6.source}</td></tr>;
              })}
            </tbody>
          </table></div>
          {(capped || merged.length > shown2.length) && <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>Biggest rows shown ({shown2.length} of {fullCount}) — the Σ above still covers ALL of them. Narrow the period for the full list.</div>}
        </div>;
      })();
      })()}
      {cfDrill && cfDrill.src !== 'ps' && cf && !cf.drills && <div className="mt-2 text-[11px] font-bold" style={{ color: '#431407', background: '#ffedd5', borderRadius: 8, padding: 8 }}>Deploy v55.83-PL to get the rows behind the cards — then click again.</div>}
      {cf && cf.bills_due && cf.bills_due.length > 0 && <div className="mt-2 text-[11px]" style={{ color: '#431407' }}>
        <b>Due in this period:</b> {cf.bills_due.map(function (b) { return b.vendor_name + ' $' + fmt(b.open) + (b.due_date ? ' (' + b.due_date + ')' : ''); }).join(' · ')}
      </div>}
    </div>

    {/* ── Aging forecast strip (Max: the dashboard should show late 1-30/31-60/61-90/90+ and upcoming, in AND out, with shortage forecasting) ── */}
    {fc && !fc.denied && fc.buckets && <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 items-center mb-2">
        <div className="text-xs font-extrabold" style={{ color: '#0f172a' }}>📈 Late & upcoming — in vs out</div>
        <div className="flex-1" />
        {(function () {
          var order = fc.bucket_order || []; var firstShort = null;
          order.forEach(function (b) { if (firstShort === null && fc.buckets[b] && fc.buckets[b].running < -0.005) { firstShort = b; } });
          var L = { 'L90+': '90+ late', 'L61-90': '61–90 late', 'L31-60': '31–60 late', 'L1-30': '1–30 late', 'D0-30': 'due ≤30d', 'D31-60': 'due 31–60', 'D61-90': 'due 61–90', 'D90+': 'due 90+' };
          return firstShort
            ? <span className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>⚠ projected shortage from "{L[firstShort] || firstShort}" window</span>
            : <span className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#d1fae5', color: '#065f46' }}>bills covered by expected collections ✓</span>;
        })()}
        <button onClick={function () { onGo('forecast'); }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>full forecast →</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-[11px]" style={{ minWidth: 700 }}>
        <thead>
          {/* v55.83-PO (Max 04:30): "should be really based on invoices that are
              late or on time" — it IS: these group headers now say so. */}
          <tr style={{ color: '#475569' }}>
            <th className="py-0.5 pr-2">&nbsp;</th>
            <th colSpan={4} className="py-0.5 px-1 text-center font-extrabold" style={{ color: '#7f1d1d', background: '#fff1f2', borderRadius: 6 }}>⚠ ALREADY LATE — past the due date, aged by days late</th>
            <th colSpan={4} className="py-0.5 px-1 text-center font-extrabold" style={{ color: '#065f46', background: '#f0fdf4', borderRadius: 6 }}>ON TIME — not due yet, by when it comes due</th>
          </tr>
          <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
          <th className="py-1 pr-2 text-left font-semibold">&nbsp;</th>
          {(fc.bucket_order || []).map(function (b) {
            var L = { 'L90+': '90+ days late', 'L61-90': '61–90 late', 'L31-60': '31–60 late', 'L1-30': '1–30 late', 'D0-30': 'due ≤30d', 'D31-60': 'due 31–60d', 'D61-90': 'due 61–90d', 'D90+': 'due 90d+' };
            return <th key={b} className="py-1 px-1 text-right font-semibold" style={String(b).charAt(0) === 'L' ? { color: '#7f1d1d' } : {}}>{L[b] || b}</th>;
          })}
        </tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          <tr><td className="py-1 pr-2 font-bold whitespace-nowrap" style={{ color: '#065f46' }}>In — open invoices<div className="text-[9px] font-semibold" style={{ color: '#64748b' }}>what customers owe us</div></td>
            {(fc.bucket_order || []).map(function (b) {
              return <td key={b} className="py-0.5 px-0.5 text-right">
                <button onClick={function () { setFcDrill({ bucket: b, kind: 'in' }); }} title="Show the invoices behind this number"
                  className="w-full rounded px-1 py-0.5 text-right tabular-nums font-semibold"
                  style={{ background: '#d1fae5', color: '#065f46', border: '1px solid #a7f3d0' }}>${fmt(fc.buckets[b].ar)}<div className="text-[8px] font-bold" style={{ opacity: 0.75 }}>{fc.buckets[b].ar_count} invoice(s)</div></button></td>;
            })}</tr>
          <tr><td className="py-1 pr-2 font-bold whitespace-nowrap" style={{ color: '#7f1d1d' }}>Out — open bills<div className="text-[9px] font-semibold" style={{ color: '#64748b' }}>what we owe vendors</div></td>
            {(fc.bucket_order || []).map(function (b) {
              return <td key={b} className="py-0.5 px-0.5 text-right">
                <button onClick={function () { setFcDrill({ bucket: b, kind: 'out' }); }} title="Show the bills behind this number"
                  className="w-full rounded px-1 py-0.5 text-right tabular-nums font-semibold"
                  style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fecaca' }}>${fmt(fc.buckets[b].ap)}<div className="text-[8px] font-bold" style={{ opacity: 0.75 }}>{fc.buckets[b].ap_count} bill(s)</div></button></td>;
            })}</tr>
          <tr style={{ borderTop: '1px solid #e2e8f0' }}><td className="py-1 pr-2 font-bold" style={{ color: '#334155' }}>Position</td>
            {(fc.bucket_order || []).map(function (b) {
              var pos = fc.buckets[b].running >= 0;
              return <td key={b} className="py-1 px-1 text-right font-extrabold tabular-nums" style={{ color: pos ? '#065f46' : '#7f1d1d', background: pos ? '#f0fdf4' : '#fff1f2' }}>{(pos ? '+' : '−') + '$' + fmt(Math.abs(fc.buckets[b].running))}</td>;
            })}</tr>
        </tbody>
      </table></div>
      <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>Every number here is real invoices/bills by DUE DATE — nothing else. ⚠ side = already late (aged by how long). Green side = on time, by when it comes due. Position = running in − out; where it turns red is where cash runs short. Click any number for the exact invoices/bills behind it.</div>
      {fcDrill && (function () {
        var L2 = { 'L90+': '⚠ 90+ days late', 'L61-90': '⚠ 61–90 late', 'L31-60': '⚠ 31–60 late', 'L1-30': '⚠ 1–30 late', 'D0-30': 'Due ≤30 days', 'D31-60': 'Due 31–60', 'D61-90': 'Due 61–90', 'D90+': 'Due 90+' };
        var all = (fc.rows || []).filter(function (r) { return r.bucket === fcDrill.bucket && r.kind === fcDrill.kind; })
          .sort(function (a, b) { return b.amount - a.amount; });
        var sum = 0; all.forEach(function (r) { sum += r.amount; });
        var shown = all.slice(0, 80);
        return <div className="mt-2 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="flex gap-2 items-center mb-1">
            <div className="text-[11px] font-extrabold" style={{ color: '#0f172a' }}>
              {(fcDrill.kind === 'in' ? 'Coming in · ' : 'Going out · ') + (L2[fcDrill.bucket] || fcDrill.bucket)} — {all.length} row(s), Σ ${fmt(sum)} (equals the number above to the cent)</div>
            <div className="flex-1" />
            <button onClick={function () { setFcDrill(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ close</button>
          </div>
          <table className="w-full text-[10px]">
            <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
              <th className="py-1 pr-2 text-left font-semibold">Reference</th><th className="py-1 pr-2 text-left font-semibold">{fcDrill.kind === 'in' ? 'Customer' : 'Vendor'}</th>
              <th className="py-1 pr-2 text-left font-semibold">Date</th><th className="py-1 pr-2 text-left font-semibold">Due</th>
              <th className="py-1 pr-2 text-right font-semibold">Original</th><th className="py-1 pr-2 text-right font-semibold">Paid</th>
              <th className="py-1 pr-2 text-right font-semibold">Open</th><th className="py-1 text-left font-semibold">Where from</th></tr></thead>
            <tbody style={{ color: '#0f172a' }}>
              {shown.map(function (r, i) {
                return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td className="py-0.5 pr-2 font-semibold">{r.ref}</td><td className="py-0.5 pr-2">{r.who}</td>
                  <td className="py-0.5 pr-2 whitespace-nowrap">{r.date || '—'}</td>
                  <td className="py-0.5 pr-2 whitespace-nowrap" style={{ color: '#7f1d1d' }}>{r.due || '—'}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{nd(r.total)}</td>
                  <td className="py-0.5 pr-2 text-right tabular-nums">{nd(r.paid)}</td>
                  <td className="py-0.5 pr-2 text-right font-extrabold tabular-nums">${fmt(r.amount)}</td>
                  <td className="py-0.5" style={{ color: '#64748b' }}>{r.source}</td></tr>;
              })}
            </tbody>
          </table>
          {all.length > shown.length && <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>Showing the biggest {shown.length} of {all.length} — the 📈 Forecast tab has the full list + CSV.</div>}
        </div>;
      })()}
    </div>}

    {/* ── Work queues ── */}
    <div className="grid md:grid-cols-2 gap-3">
      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="text-xs font-extrabold text-slate-900 mb-1">📥 Deposits to match to invoices</div>
        <div className="text-2xl font-extrabold tabular-nums" style={{ color: qCounts.in_unmatched > 0 ? '#1d4ed8' : '#065f46' }}>{qCounts.in_unmatched}</div>
        <div className="text-[11px] text-slate-600 mb-2">{qCounts.in_unmatched > 0 ? 'money-in transactions waiting to be connected to an invoice' : 'all caught up ✓'}</div>
        {qCounts.in_unmatched > 0 && <button onClick={function () { onGo('review'); }} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>Open matching →</button>}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <div className="text-xs font-extrabold text-slate-900 mb-1">🏷️ Expenses to categorize <span className="font-semibold text-slate-500">({qCounts.out_unreviewed} waiting)</span></div>
        {outQueue.length === 0 ? <div className="text-[11px]" style={{ color: '#065f46' }}>all caught up ✓</div> :
          outQueue.map(function (t) {
            return <div key={t.id} className="flex gap-2 items-center py-1" style={{ borderBottom: '1px solid #f1f5f9' }}>
              <span className="text-[10px] text-slate-500 whitespace-nowrap">{t.posted_date || t.date}</span>
              <span className="text-[11px] font-semibold text-slate-800 flex-1 truncate" title={t.merchant_name || t.name}>{String(t.merchant_name || t.name || '').substring(0, 42)}</span>
              <span className="text-[11px] font-extrabold tabular-nums" style={{ color: '#7f1d1d' }}>-${fmt(t.amount_abs)}</span>
              <select className="px-1 py-0.5 rounded border border-slate-300 text-[10px] text-slate-900 bg-white" value={clsDraft[t.id] || ''} onChange={function (e) { var d = {}; d[t.id] = e.target.value; setClsDraft(Object.assign({}, clsDraft, d)); }}>
                <option value="">category…</option>
                {(dynCats || CLASSIFICATIONS.map(function (c) { return { key: c, label: c }; })).map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
              </select>
              <button onClick={function () { classify(t, clsDraft[t.id]); }} disabled={busy || !clsDraft[t.id]} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || !clsDraft[t.id]) ? 0.5 : 1 }}>✓</button>
            </div>;
          })}
        {qCounts.out_unreviewed > outQueue.length && <button onClick={function () { onGo('review'); }} className="mt-2 px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>See all {qCounts.out_unreviewed} in Bank Review →</button>}
      </div>
    </div>

    {/* ── Background suggestions (rules engine) ── */}
    {proposals.length > 0 && <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-xs font-extrabold text-slate-900 mb-1">🤖 Suggested by your rules (background) — one click to apply</div>
      {proposals.map(function (p2) {
        var oc = p2.outcome || {};
        var ocLabel = oc.category || oc.classification || (oc.splits && oc.splits.length ? oc.splits.length + '-way split' : 'rule outcome');
        return <div key={p2.id} className="flex gap-2 items-center py-1" style={{ borderBottom: '1px solid #f1f5f9' }}>
          <span className="text-[11px] text-slate-800 flex-1 truncate">{(p2.description || 'Bank transaction') + (p2.date ? ' · ' + p2.date : '') + (p2.amount ? ' · $' + fmt(p2.amount) : '')} → <b>{ocLabel}</b></span>
          <button onClick={function () { decideProposal(p2, true); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Apply</button>
          <button onClick={function () { decideProposal(p2, false); }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>Dismiss</button>
        </div>;
      })}
      <div className="text-[10px] text-slate-500 mt-1">Rules are created in ClickBooks Admin → Rules; new bank expenses get proposals automatically every 15 minutes.</div>
    </div>}

    {/* v55.83-PF — drift alarm (QA critical #1): hub vs ledger divergence, never silent */}
    {drift && <div className="bg-white rounded-xl p-3" style={{ border: '2px solid #dc2626' }}>
      <div className="text-xs font-extrabold" style={{ color: '#7f1d1d' }}>⚠ Ledger drift: {drift.count} posted expense(s) whose category changed afterwards</div>
      <div className="text-[11px] mt-1" style={{ color: '#334155' }}>
        {(drift.items || []).slice(0, 5).map(function (d, i) {
          return <div key={i}>{(d.date || '') + ' · ' + String(d.description || '').substring(0, 40) + ' · $' + fmt(d.amount) + ' — posted to "' + (d.posted_to_account || '?') + '", now reads "' + (d.current_classification || 'unclassified') + '"'}</div>;
        })}
      </div>
      <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>The books and Bank Review disagree on these. Tell Claude — fixing is a deliberate reverse-and-repost, never automatic.</div>
    </div>}

    {/* v55.83-PF — "if something's late... a quick button" */}
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-xs font-extrabold text-slate-900 mb-1">⏰ Late customers (30+ days)
        {late && <span className="font-semibold text-slate-500"> — {late.total_late} invoice(s), ${fmt(late.total_open)} open</span>}</div>
      {!late ? <div className="text-[11px] text-slate-500">Loading…</div> :
        late.denied ? <div className="text-[11px]" style={{ color: '#92400e' }}>{late.error || 'Needs the AR balances permission.'}</div> :
        (late.rows || []).length === 0 ? <div className="text-[11px]" style={{ color: '#065f46' }}>nobody is 30+ days late ✓</div> :
        (late.rows || []).slice(0, 8).map(function (r) {
          return <div key={r.invoice_id} className="flex gap-2 items-center py-1 flex-wrap" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <span className="text-[11px] font-semibold text-slate-800 flex-1 truncate" title={r.customer}>{r.customer}</span>
            <span className="text-[10px] text-slate-500">{r.invoice_number}</span>
            <span className="text-[11px] font-extrabold tabular-nums" style={{ color: '#7f1d1d' }}>${fmt(r.open)}</span>
            <span className="text-[10px] font-bold" style={{ color: '#b45309' }}>{r.days_late}d late</span>
            {r.last_reminder && <span className="text-[9px] text-slate-400" title={'Last reminded ' + r.last_reminder.at}>↩ {String(r.last_reminder.at).substring(0, 10)}</span>}
            <select className="px-1 py-0.5 rounded border border-slate-300 text-[10px] text-slate-900 bg-white" value={remTone[r.invoice_id] || 'gentle'}
              onChange={function (e) { var d2 = {}; d2[r.invoice_id] = e.target.value; setRemTone(Object.assign({}, remTone, d2)); }}>
              <option value="gentle">gentle</option><option value="firm">firm</option></select>
            <button onClick={function () { remind(r, 'email'); }} disabled={!r.email} title={r.email || 'no email on customer'}
              className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: r.email ? '#1d4ed8' : '#e2e8f0', color: r.email ? '#ffffff' : '#94a3b8' }}>✉ Email</button>
            <button onClick={function () { remind(r, 'whatsapp'); }} disabled={!r.phone} title={r.phone || 'no phone on customer'}
              className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: r.phone ? '#047857' : '#e2e8f0', color: r.phone ? '#ffffff' : '#94a3b8' }}>🟢 WhatsApp</button>
          </div>;
        })}
      <div className="text-[10px] text-slate-500 mt-1">Email sends instantly; WhatsApp opens with the message ready to tap. Every reminder is logged on the invoice.</div>
    </div>
  </div>;
}
