'use client';
// v55.83-AAA — 📋 My work feed (Max, 27 Nov): FIRST on the home screen, one list per person of what needs updating or correcting.
// Max: "professional work feed - sharp and clear and user friendly with EXACT issues. How to resolve section and button that takes you
// there to resolve and then when resolved it goes to resolved grouping. User friendly is the KEY".
// Each item = THE ISSUE (one exact sentence) + HOW TO RESOLVE (numbered steps) + ONE "Go resolve →" button to the exact place, where a
// Back button returns here. What leaves the feed moves to the ✓ Resolved group. Build 1 = what the Hub already computes:
// 🔔 Waiting for me (bills + wires) and invoices awaiting bank confirmation. READ-ONLY: it calls the same requests those screens call,
// with the person's own sign-in, so the server's existing permission / visibility-window / payroll checks decide what comes back.
// A section is only asked for when the person's switches would open that screen. Look: the approved sharp black style (25 Nov).
import React, { useEffect, useRef, useState } from 'react';
import { waitingFor } from '../lib/waiting-list';
import { buildFeed, compareFeed, addResolved, tally } from '../lib/work-feed';
import { acctAccess, screenHub } from '../lib/accounting-access';
import { hubFetch } from '../lib/hub-fetch';

// Kept only in this open page (never stored): the feed as it was when the person pressed a button (so Back can tell Resolved / Still
// open), and the Resolved group of this person while the page is open.
var lastJump = null; // { before, key, y, backN } | null
var resolvedMem = { user: null, list: [] };

export function feedAccess(isSuper, mp, role) {
  var m = mp || {}; var boss = isSuper === true;
  var v = acctAccess(boss, m, role);
  function hubOk(k) { var h = screenHub(k); return h === 'ktc' ? v.ktc : h === 'wave' ? v.wave : v.access; }
  var revenueOk = boss || m['pnl.view_revenue'] !== false; // v55.83-XK — a researcher sees only Profitability / P&L
  var perms = { bills: boss || m['bills.manage'] === true, prepare: boss || m['wires.prepare'] === true, signoff: boss || m['wires.signoff'] === true, send: boss || m['wires.send'] === true };
  var canBills = revenueOk && hubOk('bills') && (boss || m['bills.view'] === true || m['bills.manage'] === true);
  var canWires = revenueOk && hubOk('wires') && (boss || m['wires.view'] === true || perms.prepare || perms.signoff || perms.send);
  if (!canBills) { perms.bills = false; }
  if (!canWires) { perms.prepare = false; perms.signoff = false; perms.send = false; }
  // same gate as the home screen's "awaiting bank confirmation" card (PendingBankConfirmationsWidget)
  var canInvoices = boss || m['Treasury'] === true || m['View Financial Reports'] === true;
  return { perms: perms, canBills: canBills, canWires: canWires, canInvoices: canInvoices, any: canBills || canWires || canInvoices };
}

var BG = '#000000'; var PANEL = '#0b0b0b'; var LINE = '#2a2a2a'; var INK = '#fafafa'; var SUB = '#a3a3a3'; var GREEN = '#22c55e'; var RED = '#dc2626'; var AMBER = '#f59e0b';
var LABEL = { fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: SUB };

export default function WorkFeed(props) {
  var userProfile = props.userProfile; var me = (userProfile && userProfile.id) || null;
  var isSuper = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var acc = feedAccess(isSuper, props.modulePerms, userProfile && userProfile.role);
  if (resolvedMem.user !== me) { resolvedMem = { user: me, list: [] }; } // never show one person's Resolved to another
  var s1 = useState(null); var feed = s1[0]; var setFeed = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState([]); var errs = s3[0]; var setErrs = s3[1];
  var s4 = useState(''); var at = s4[0]; var setAt = s4[1];
  var s5 = useState(null); var since = s5[0]; var setSince = s5[1]; // { openedKey, openedStillOpen, openedTitle } after Back
  var s6 = useState(false); var shut = s6[0]; var setShut = s6[1];
  var s7 = useState(resolvedMem.list); var resolved = s7[0]; var setResolved = s7[1];
  var s8 = useState('todo'); var view = s8[0]; var setView = s8[1];
  var prevRef = useRef(null); // the feed now on screen (also read by the invoice watcher)
  var seqRef = useRef(0); var userRef = useRef(null); // which load is the newest; whose feed this is

  function post(url, payload) {
    return hubFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ user_id: me }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'the server did not answer properly (HTTP ' + r.status + ')' }; }); })
      .catch(function (e) { return { ok: false, error: 'could not reach the server (' + ((e && e.message) || 'network') + ')' }; });
  }
  function load(prev) {
    seqRef.current++; var mySeq = seqRef.current;
    setBusy(true);
    Promise.all([acc.canBills ? post('/api/accounting/bills', { action: 'list' }) : Promise.resolve(null), acc.canWires ? post('/api/accounting/wire-packages', { action: 'list' }) : Promise.resolve(null)]).then(function (r) {
      var e = [];
      if (r[0] && !r[0].ok) { e.push('Bills: ' + (r[0].error || 'not loaded')); }
      if (r[1] && !r[1].ok) { e.push('Wires: ' + (r[1].error || 'not loaded')); }
      setErrs(e);
      var w = (acc.canBills || acc.canWires) ? waitingFor({ bills: (r[0] && r[0].ok && r[0].bills) || [], wires: (r[1] && r[1].ok && r[1].packages) || [], funding: (r[1] && r[1].ok && r[1].funding_open) || [], perms: acc.perms, userId: me }) : null;
      // Codex AAA-02: the home screen's invoices count only when the page says they loaded (invoicesStatus.ok); otherwise the last good
      // invoice group is kept as it was and is left out of the Resolved comparison (an empty list after a failed load is not "resolved").
      var invOk = invoicesReady(props.invoicesStatus);
      var f = buildFeed({ waiting: w, invoices: acc.canInvoices && invOk ? (props.invoices || []) : null });
      if (acc.canInvoices && !invOk && prevRef.current) { f = tally(f.groups.concat(prevRef.current.groups.filter(function (g) { return g.key === 'invoice_bank'; }))); }
      var stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Which feed to compare with: the one from before the jump (only right after the Back button: backN moved on by one; a home
      // visit through the menu is a fresh start), else the one on screen when ↻ Refresh was pressed.
      var base = null; var openedKey = null; var openedTitle = '';
      if (lastJump) { var j = lastJump; lastJump = null; if (Number(props.backN || 0) === j.backN + 1) { base = j.before; openedKey = j.key; openedTitle = j.title || ''; setView(j.view || 'todo'); setTimeout(function () { try { window.scrollTo(0, j.y || 0); } catch (e1) {} }, 60); } }
      if (!base && prev) { base = prev; }
      // A source that failed to load must never make its items look resolved: only compare when everything loaded.
      if (base && !e.length) {
        var c = compareFeed(invOk ? base : dropGroup(base, 'invoice_bank'), invOk ? f : dropGroup(f, 'invoice_bank'), openedKey);
        var nextR = addResolved(resolvedMem.list, c.fixed, f, stamp);
        resolvedMem.list = nextR; setResolved(nextR);
        setSince(openedKey ? { openedKey: openedKey, openedStillOpen: c.openedStillOpen, openedTitle: openedTitle } : null);
      } else {
        var keepR = addResolved(resolvedMem.list, [], f, ''); resolvedMem.list = keepR; setResolved(keepR); // a reopened item leaves Resolved
        setSince(null);
      }
      if (seqRef.current !== mySeq) { return; } // a newer load (other person / other switches) started meanwhile: drop this answer
      prevRef.current = f; setFeed(f);
      setAt(stamp);
    }).finally(function () { if (seqRef.current === mySeq) { setBusy(false); } });
  }
  // Codex AAA-01: on a normal sign-in the page shows before the person and their switches are known. Load when they are ready, and
  // again whenever the signed-in person or their effective access changes (a new person starts with an empty feed and no comparison).
  var accessKey = (me || '') + '|' + [acc.canBills, acc.canWires, acc.canInvoices, acc.perms.bills, acc.perms.prepare, acc.perms.signoff, acc.perms.send].map(function (b) { return b ? 1 : 0; }).join('');
  useEffect(function () {
    if (!me || !acc.any) { seqRef.current++; prevRef.current = null; setFeed(null); setErrs([]); setSince(null); setBusy(false); return; }
    if (userRef.current !== me) { userRef.current = me; prevRef.current = null; setFeed(null); setSince(null); if (lastJump && lastJump.user !== me) { lastJump = null; } }
    load(null);
  }, [accessKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Codex AAA-02: the invoices on the home screen load and change on their own (a bank match changes an AMOUNT, not the count). Watch
  // their content; a change re-builds the invoice group and moves what left it to Resolved — only when the page says they loaded.
  var invSig = invoiceSignature(props.invoices, props.invoicesStatus);
  useEffect(function () {
    var f0 = prevRef.current; if (!f0 || !acc.canInvoices || !invoicesReady(props.invoicesStatus)) { return; }
    var f1 = mergeInvoices(f0, props.invoices);
    var c = compareFeed(onlyGroup(f0, 'invoice_bank'), onlyGroup(f1, 'invoice_bank'), null);
    var nr = addResolved(resolvedMem.list, c.fixed, f1, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); resolvedMem.list = nr; setResolved(nr); // also: an invoice that is a task again leaves Resolved
    prevRef.current = f1; setFeed(f1);
  }, [invSig]); // eslint-disable-line react-hooks/exhaustive-deps

  function openIt(item) {
    var y0 = 0; try { y0 = window.scrollY || 0; } catch (e0) {}
    lastJump = { user: me, before: feed, key: item.key, title: item.title, y: y0, backN: Number(props.backN || 0), view: view };
    if (props.onOpen) { props.onOpen(item.target, { title: item.title, todo: item.todo }); }
  }

  if (!acc.any) { return null; }
  var sq = { borderRadius: 0 };
  var btnGhost = Object.assign({ background: 'transparent', color: INK, border: '1px solid #525252' }, sq);
  var total = feed ? feed.total : 0; var stuckN = feed ? feed.stuck : 0; var payN = feed ? (feed.payTotal || 0) : 0;
  var lane = view === 'pay' ? 'pay' : 'main';
  function stat(label, n, color, onClick, active) {
    return <button onClick={onClick} className="px-4 py-2 text-left" style={Object.assign({ background: active ? '#171717' : 'transparent', border: '1px solid ' + (active ? INK : LINE), minWidth: 110, cursor: onClick ? 'pointer' : 'default' }, sq)}>
      <div style={LABEL}>{label}</div>
      <div className="tabular-nums" style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1, color: color }}>{n}</div>
    </button>;
  }
  return <div className="mb-3" style={Object.assign({ background: BG, border: '1px solid ' + LINE, color: INK }, sq)} data-testid="work-feed">
    {/* header */}
    <div className="flex items-center gap-3 flex-wrap px-4 py-3" style={{ borderBottom: '1px solid ' + LINE }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '0.08em' }}>📋 MY WORK FEED</div>
        <div className="text-[11px]" style={{ color: SUB }}>{'What needs you, from the screens you can open' + (at ? ' · updated ' + at : '')}</div>
      </div>
      <div className="flex-1" />
      <button onClick={function () { load(feed); }} disabled={busy} className="px-3 py-1.5 text-[11px] font-extrabold" style={btnGhost}>{busy ? 'Loading…' : '↻ Refresh'}</button>
      <button onClick={function () { setShut(!shut); }} className="px-3 py-1.5 text-[11px] font-extrabold" style={btnGhost}>{shut ? '▼ Show' : '▲ Hide'}</button>
    </div>
    {!shut && <div className="px-4 py-3">
      {/* counts = the two groups */}
      <div className="flex gap-2 flex-wrap mb-3">
        {stat('To do', feed ? total : '…', total ? INK : GREEN, function () { setView('todo'); }, view === 'todo')}
        {stat('Stuck', feed ? stuckN : '…', stuckN ? RED : SUB, function () { setView('todo'); }, false)}
        {stat('💸 Bills not paid', feed ? payN : '…', payN ? '#fbbf24' : SUB, function () { setView('pay'); }, view === 'pay')}
        {stat('✓ Resolved', resolved.length, resolved.length ? GREEN : SUB, function () { setView('resolved'); }, view === 'resolved')}
      </div>
      {errs.map(function (e, ix) { return <div key={ix} className="px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#450a0a', color: '#fecaca', border: '1px solid ' + RED }}>{'⛔ ' + e + ' — its items are not shown right now, and nothing moves to Resolved until it loads. Press ↻ Refresh.'}</div>; })}
      {/* v55.83-AAA rev4 (Codex HOLD) — the home screen's invoice list failed to load: say so; the last good invoice tasks stay, nothing resolves */}
      {acc.canInvoices && props.invoicesStatus && props.invoicesStatus.ok === false && <div className="px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#450a0a', color: '#fecaca', border: '1px solid ' + RED }} data-testid="feed-invoices-unavailable">{'⛔ Invoices: unavailable — the invoice list could not be loaded. The invoice tasks shown are from the last good load, and none of them is marked resolved until the list loads again. Reload the page to try again.'}</div>}
      {/* what happened to the item just opened */}
      {since && since.openedKey && <div className="px-3 py-2 mb-3 flex items-center gap-2 flex-wrap" style={{ background: since.openedStillOpen ? '#1c1300' : '#052e16', border: '1px solid ' + (since.openedStillOpen ? AMBER : GREEN) }}>
        <span className="px-2 py-0.5 text-[11px] font-extrabold" style={{ background: since.openedStillOpen ? AMBER : GREEN, color: '#000000' }}>{since.openedStillOpen ? 'STILL OPEN' : '✓ RESOLVED'}</span>
        <span className="text-[12px] font-bold" style={{ color: INK }}>{since.openedStillOpen ? since.openedTitle + ' still needs something — it is marked below. Read its How to resolve steps.' : since.openedTitle + ' is done and moved to Resolved.'}</span>
      </div>}

      {(view === 'todo' || view === 'pay') && <div>
        {view === 'pay' && <div className="text-[12px] mb-2" style={{ color: SUB }}>Validated bills that are due within 7 days or already late and are not on any wire yet. Kept apart from your main feed — open this group when you are planning payments.</div>}
        {!feed && busy && <div className="text-[13px] py-4" style={{ color: SUB }}>Loading your feed…</div>}
        {feed && view === 'pay' && !payN && !errs.length && <div className="px-4 py-6 text-center" style={{ background: PANEL, border: '1px solid ' + LINE }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: GREEN }}>✓ No unpaid bills due</div>
          <div className="text-[12px] mt-1" style={{ color: SUB }}>Every validated bill due within 7 days is already on a wire.</div></div>}
        {feed && view === 'todo' && !total && !errs.length && <div className="px-4 py-6 text-center" style={{ background: PANEL, border: '1px solid ' + LINE }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: GREEN }}>✓ You are all caught up</div>
          <div className="text-[12px] mt-1" style={{ color: SUB }}>Nothing is waiting for you on the screens you can open.</div></div>}
        {feed && feed.groups.filter(function (g) { return (g.lane || 'main') === lane; }).map(function (g) {
          return <div key={g.key} className="mb-4">
            <div className="flex items-center gap-2 flex-wrap pb-1.5 mb-2" style={{ borderBottom: '1px solid ' + LINE }}>
              <span className="px-1.5 py-0.5" style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.12em', background: '#262626', color: SUB }}>{(g.area || '').toUpperCase()}</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: INK }}>{g.title}</span>
              <span className="tabular-nums" style={{ fontSize: 12, fontWeight: 900, color: SUB }}>{g.items.length}</span>
            </div>
            {g.items.slice(0, 15).map(function (x) {
              var opened = since && since.openedKey === x.key && since.openedStillOpen;
              var edge = x.stuck ? RED : opened ? AMBER : '#525252';
              return <div key={x.key} className="mb-2 flex flex-wrap" style={{ background: opened ? '#140e00' : PANEL, border: '1px solid ' + (opened ? AMBER : LINE), borderLeft: '4px solid ' + edge }} data-feed-item={x.key}>
                <div className="px-3 py-2.5" style={{ flex: '1 1 340px', minWidth: 0 }}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span style={LABEL}>The issue</span>
                    {x.stuck && <span className="px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 900, background: RED, color: '#ffffff' }}>STUCK</span>}
                    {opened && <span className="px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 900, background: AMBER, color: '#000000' }}>STILL OPEN</span>}
                    <span style={{ fontSize: 11, color: SUB }}>{x.chip ? x.chip : (x.age == null ? '' : x.age === 0 ? 'since today' : 'waiting ' + x.age + ' day' + (x.age === 1 ? '' : 's'))}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: INK, lineHeight: 1.35 }}>{x.issue}</div>
                  <div className="mt-2 px-3 py-2" style={{ background: '#000000', border: '1px solid ' + LINE }}>
                    <div style={Object.assign({}, LABEL, { color: '#fcd34d', marginBottom: 2 })}>How to resolve</div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#e5e5e5', lineHeight: 1.5, listStyle: 'decimal' }}>
                      {(x.steps || []).map(function (st, k) { return <li key={k}>{st}</li>; })}
                    </ol>
                  </div>
                </div>
                <div className="px-3 py-2.5 flex flex-col items-end justify-center gap-2" style={{ flex: '0 0 auto', borderLeft: '1px solid ' + LINE, minWidth: 170 }}>
                  {x.amount && <div className="tabular-nums" style={{ fontSize: 15, fontWeight: 900, color: INK }}>{x.amount}</div>}
                  <button onClick={function () { openIt(x); }} title="Takes you to the exact place. A Back button there brings you back to this feed." className="px-4 py-2.5 text-[13px] font-extrabold" style={Object.assign({ background: INK, color: '#000000', border: '1px solid ' + INK, whiteSpace: 'nowrap' }, sq)}>Go resolve →</button>
                </div>
              </div>;
            })}
            {g.items.length > 15 && <div className="px-3 py-2 text-[12px] font-bold" style={{ color: SUB }}>{'+ ' + (g.items.length - 15) + ' more of these — resolve the ones above and the next ones move up.'}</div>}
          </div>;
        })}
      </div>}

      {view === 'resolved' && <div>
        {!resolved.length && <div className="px-4 py-6 text-center" style={{ background: PANEL, border: '1px solid ' + LINE }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: INK }}>Nothing resolved yet</div>
          <div className="text-[12px] mt-1" style={{ color: SUB }}>When you resolve an item it moves here. This list covers this visit (it starts empty when the Hub is reopened).</div></div>}
        {resolved.map(function (r) {
          return <div key={'r' + r.key} className="mb-2 px-3 py-2 flex items-center gap-3 flex-wrap" style={{ background: PANEL, border: '1px solid ' + LINE, borderLeft: '4px solid ' + GREEN }}>
            <span className="px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 900, background: GREEN, color: '#000000' }}>✓ RESOLVED</span>
            <div style={{ flex: '1 1 300px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>{r.title}</div>
              <div style={{ fontSize: 11, color: SUB }}>{(r.area ? r.area + ' · ' : '') + r.groupTitle + (r.issue ? ' · was: ' + r.issue : '')}</div>
            </div>
            {r.at && <span className="tabular-nums" style={{ fontSize: 11, color: SUB }}>{r.at}</span>}
          </div>;
        })}
      </div>}
    </div>}
  </div>;
}

// v55.83-AAA rev3 (Codex AAA-02) — the page says whether its invoice list loaded: { ok: true|false, n }. No status yet = not known yet.
export function invoicesReady(st) { return !!(st && st.ok === true); }
// what the feed needs to notice: each invoice with money waiting for bank confirmation, and its amount (not just how many invoices)
export function invoiceSignature(invoices, st) {
  var parts = []; (invoices || []).forEach(function (v) { if (v && v.id && Number(v.total_pending_bank || 0) > 0) { parts.push(v.id + ':' + Number(v.total_pending_bank)); } });
  return (st && st.ok === true ? 'ok' : st && st.ok === false ? 'failed' : 'unknown') + '|' + (st && st.n || 0) + '|' + parts.sort().join(',');
}
export function dropGroup(f, key) { return f ? tally(f.groups.filter(function (g) { return g.key !== key; })) : f; }
export function onlyGroup(f, key) { return f ? tally(f.groups.filter(function (g) { return g.key === key; })) : f; }

// Replace only the invoices group (the home screen's invoices load separately from the feed's own requests)
export function mergeInvoices(f0, invoices) {
  if (!f0) { return f0; }
  var fresh = buildFeed({ waiting: null, invoices: invoices || [] });
  return tally(f0.groups.filter(function (g) { return g.key !== 'invoice_bank'; }).concat(fresh.groups));
}
