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
import WorkAssignmentsPanel from './WorkAssignmentsPanel'; // v55.83-AAH — admin / super admin pick who owns each task
import { canAssign, COST_ENTRY_PERMISSION, taskOf } from '../lib/work-feed-tasks';
import { COST_FEED_KEYS } from '../lib/profitability-work-feed';
import CostEntryForm from './CostEntryForm';

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
  var canCosts = boss || m[COST_ENTRY_PERMISSION] === true;
  return { perms: perms, canBills: canBills, canWires: canWires, canInvoices: canInvoices, canCosts: canCosts, any: canBills || canWires || canInvoices || canCosts };
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
  var s9 = useState(null); var asg = s9[0]; var setAsg = s9[1]; // v55.83-AAH — { tasks, names } from /api/work-feed/assignments (null = none / not readable)
  var s10 = useState(false); var asgOpen = s10[0]; var setAsgOpen = s10[1];
  var [costTask, setCostTask] = useState(null);
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
    Promise.all([acc.canBills ? post('/api/accounting/bills', { action: 'list' }) : Promise.resolve(null), acc.canWires ? post('/api/accounting/wire-packages', { action: 'list' }) : Promise.resolve(null), acc.canCosts ? post('/api/accounting/profitability', { action: 'cost_work_feed' }) : Promise.resolve(null)]).then(function (r) {
      if (seqRef.current !== mySeq) { return; }
      var e = [];
      if (r[0] && !r[0].ok) { e.push('Bills: ' + (r[0].error || 'not loaded')); }
      if (r[1] && !r[1].ok) { e.push('Wires: ' + (r[1].error || 'not loaded')); }
      var othersOk = !e.length;
      var costsOk = !!(r[2] && r[2].ok && Array.isArray(r[2].tasks));
      if (acc.canCosts && !costsOk) { e.push('Cost entry: ' + (r[2]?.error || 'not loaded')); }
      setErrs(e);
      var w = (acc.canBills || acc.canWires) ? waitingFor({ bills: (r[0] && r[0].ok && r[0].bills) || [], wires: (r[1] && r[1].ok && r[1].packages) || [], funding: (r[1] && r[1].ok && r[1].funding_open) || [], perms: acc.perms, userId: me }) : null;
      // Codex AAA-02: the home screen's invoices count only when the page says they loaded (invoicesStatus.ok); otherwise the last good
      // invoice group is kept as it was and is left out of the Resolved comparison (an empty list after a failed load is not "resolved").
      var invOk = invoicesReady(props.invoicesStatus);
      // v55.83-AAG (Codex AAA-03): after a failed reload the page KEEPS its last good invoice list, so the tasks are rebuilt from it (also
      // after the feed was re-mounted by Back, when there is no on-screen copy); if the page has none, the copy taken when the person left the
      // feed (same person) or the on-screen copy is used. Either way the group is marked not-refreshed and is never compared.
      var invFailed = !!(props.invoicesStatus && props.invoicesStatus.ok === false);
      var jumpCopy = lastJump && lastJump.user === me ? lastJump.before : null;
      var f = buildFeed({ waiting: w, invoices: acc.canInvoices && (invOk || invFailed) ? (props.invoices || []) : null, costTasks: costsOk ? r[2].tasks : [] });
      if (acc.canInvoices && invFailed) { f = keepLastGoodInvoices(f, prevRef.current || jumpCopy); }
      if (acc.canCosts && !costsOk) {
        var keptCosts = ((prevRef.current || jumpCopy)?.groups || []).filter(function (g) { return COST_FEED_KEYS.includes(g.key); });
        f = tally(f.groups.concat(keptCosts.map(function (g) { return Object.assign({}, g, { stale: true }); })));
      }
      var stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Which feed to compare with: the one from before the jump (only right after the Back button: backN moved on by one; a home
      // visit through the menu is a fresh start), else the one on screen when ↻ Refresh was pressed.
      var base = null; var openedKey = null; var openedTitle = '';
      if (lastJump) { var j = lastJump; lastJump = null; if (Number(props.backN || 0) === j.backN + 1) { base = j.before; openedKey = j.key; openedTitle = j.title || ''; setView(j.view || 'todo'); setTimeout(function () { try { window.scrollTo(0, j.y || 0); } catch (e1) {} }, 60); } }
      if (!base && prev) { base = prev; }
      // A source that failed to load must never make its items look resolved: only compare when everything loaded.
      if (base && !e.length) {
        var c = compareFeed(invOk ? base : dropGroup(base, 'invoice_bank'), invOk ? f : dropGroup(f, 'invoice_bank'), null);
        var nextR = addResolved(resolvedMem.list, c.fixed, f, stamp);
        resolvedMem.list = nextR; setResolved(nextR);
      } else {
        var keepR = addResolved(resolvedMem.list, [], f, ''); resolvedMem.list = keepR; setResolved(keepR); // a reopened item leaves Resolved
      }
      setSince(openedKey ? backVerdict(openedKey, openedTitle, f, { invoicesOk: invOk, othersOk: othersOk, costsOk: costsOk }) : null);
      if (seqRef.current !== mySeq) { return; } // a newer load (other person / other switches) started meanwhile: drop this answer
      prevRef.current = f; setFeed(f);
      setAt(stamp);
    }).finally(function () { if (seqRef.current === mySeq) { setBusy(false); } });
  }
  // Codex AAA-01: on a normal sign-in the page shows before the person and their switches are known. Load when they are ready, and
  // again whenever the signed-in person or their effective access changes (a new person starts with an empty feed and no comparison).
  var accessKey = (me || '') + '|' + [acc.canBills, acc.canWires, acc.canInvoices, acc.canCosts, acc.perms.bills, acc.perms.prepare, acc.perms.signoff, acc.perms.send].map(function (b) { return b ? 1 : 0; }).join('');
  useEffect(function () {
    setCostTask(null);
    if (!me || !acc.any) { seqRef.current++; prevRef.current = null; setFeed(null); setErrs([]); setSince(null); setBusy(false); return; }
    if (userRef.current !== me) { userRef.current = me; prevRef.current = null; setFeed(null); setSince(null); if (lastJump && lastJump.user !== me) { lastJump = null; } }
    load(null);
  }, [accessKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // v55.83-AAH — who owns each task. Read for every signed-in person (names only); a failed read = today's behaviour (no owner tags).
  function loadAssignments() {
    if (!me) { setAsg(null); return; }
    hubFetch('/api/work-feed/assignments', { method: 'GET' }).then(function (r) { return r.json(); }).then(function (j) { setAsg(j && j.ok ? { tasks: j.tasks || {}, names: j.names || {} } : null); }).catch(function () { setAsg(null); });
  }
  useEffect(function () { loadAssignments(); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  // Codex AAA-02: the invoices on the home screen load and change on their own (a bank match changes an AMOUNT, not the count). Watch
  // their content; a change re-builds the invoice group and moves what left it to Resolved — only when the page says they loaded.
  var invSig = invoiceSignature(props.invoices, props.invoicesStatus);
  useEffect(function () {
    var f0 = prevRef.current; if (!f0 || !acc.canInvoices) { return; }
    // v55.83-AAG — a failed reload while the feed is open: keep the invoice tasks, mark them not refreshed, compare nothing
    if (props.invoicesStatus && props.invoicesStatus.ok === false) { var fs0 = keepLastGoodInvoices(f0, f0); prevRef.current = fs0; setFeed(fs0); return; }
    if (!invoicesReady(props.invoicesStatus)) { return; }
    var f1 = mergeInvoices(f0, props.invoices);
    var c = compareFeed(onlyGroup(f0, 'invoice_bank'), onlyGroup(f1, 'invoice_bank'), null);
    var nr = addResolved(resolvedMem.list, c.fixed, f1, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); resolvedMem.list = nr; setResolved(nr); // also: an invoice that is a task again leaves Resolved
    prevRef.current = f1; setFeed(f1);
  }, [invSig]); // eslint-disable-line react-hooks/exhaustive-deps

  function openIt(item) {
    if (item.target?.kind === 'cost_entry') { setCostTask(item.key); return; }
    var y0 = 0; try { y0 = window.scrollY || 0; } catch (e0) {}
    lastJump = { user: me, before: feed, key: item.key, title: item.title, y: y0, backN: Number(props.backN || 0), view: view };
    if (props.onOpen) { props.onOpen(item.target, { title: item.title, todo: item.todo }); }
  }

  var editor = canAssign(userProfile && userProfile.role);
  var mine = myAssignments(asg, me); // { taskKey: 'primary' | 'backup' }
  var blocked = Object.keys(mine).filter(function (k) { return !feedShowsTask(acc, k); }); // assigned to me, but my switches do not show it
  if (!acc.any && !editor && !blocked.length) { return null; }
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
      {editor && <button onClick={function () { setAsgOpen(!asgOpen); }} className="px-3 py-1.5 text-[11px] font-extrabold" style={Object.assign({}, btnGhost, asgOpen ? { background: INK, color: '#000000' } : {})} data-testid="open-work-assignments">⚙ Work assignments</button>}
      <button onClick={function () { load(feed); loadAssignments(); }} disabled={busy} className="px-3 py-1.5 text-[11px] font-extrabold" style={btnGhost}>{busy ? 'Loading…' : '↻ Refresh'}</button>
      <button onClick={function () { setShut(!shut); }} className="px-3 py-1.5 text-[11px] font-extrabold" style={btnGhost}>{shut ? '▼ Show' : '▲ Hide'}</button>
    </div>
    {!shut && <div className="px-4 py-3">
      {editor && asgOpen && <WorkAssignmentsPanel userProfile={userProfile} onSaved={loadAssignments} onClose={function () { setAsgOpen(false); }} />}
      {blocked.length > 0 && <div className="px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#1c1300', color: '#fde68a', border: '1px solid ' + AMBER }} data-testid="feed-assigned-not-visible">{'You are assigned: ' + blocked.map(function (k) { var t = taskOf(k); return t ? t.label + (t.live ? '' : ' (its feed items come in a later build)') : k; }).join(' · ') + '. ' + (blocked.some(function (k) { var t = taskOf(k); return t && t.live; }) ? 'Your account does not have the switch to see some of these (' + blocked.map(function (k) { var t = taskOf(k); return t && t.live ? t.needsWords : null; }).filter(Boolean).join(', ') + ') — ask the super admin. Being assigned does not open them.' : '')}</div>}
      {!acc.any && <div className="text-[12px] mb-2" style={{ color: SUB }}>No feed items for your switches. Use ⚙ Work assignments to choose who owns each task.</div>}
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
      {since && since.openedKey && since.unverified && <div className="px-3 py-2 mb-3 flex items-center gap-2 flex-wrap" style={{ background: '#1c1300', border: '1px solid ' + AMBER }} data-testid="feed-back-unverified">
        <span className="px-2 py-0.5 text-[11px] font-extrabold" style={{ background: AMBER, color: '#000000' }}>COULD NOT VERIFY</span>
        <span className="text-[12px] font-bold" style={{ color: INK }}>{since.openedTitle + ': its list could not be loaded, so the Hub cannot tell whether it is done. It still needs review — it stays in To do until the list loads again.'}</span>
      </div>}
      {since && since.openedKey && !since.unverified && <div className="px-3 py-2 mb-3 flex items-center gap-2 flex-wrap" style={{ background: since.openedStillOpen ? '#1c1300' : '#052e16', border: '1px solid ' + (since.openedStillOpen ? AMBER : GREEN) }} data-testid={since.openedStillOpen ? 'feed-back-still-open' : 'feed-back-resolved'}>
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
        {feed && sortMineFirst(feed.groups.filter(function (g) { return (g.lane || 'main') === lane; }), mine).map(function (g) {
          var own = ownerLine(asg, g.key, me);
          return <section key={g.key} className="mb-6" aria-labelledby={'work-feed-heading-' + g.key}>
            <header className="mb-2 px-4 py-3 sm:px-5" style={{ background: '#151a23', border: '1px solid #475569', borderLeft: '4px solid #93c5fd' }}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {g.area && <span className="px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider" style={{ background: '#26364d', color: '#dbeafe' }}>{g.area}</span>}
                <h3 id={'work-feed-heading-' + g.key} className="min-w-0 break-words text-lg font-extrabold leading-tight sm:text-xl" style={{ color: INK }}>{g.title}</h3>
                <span className="min-w-8 px-2 py-0.5 text-center text-sm font-extrabold tabular-nums" style={{ background: '#e2e8f0', color: '#0f172a' }}>{g.items.length}</span>
                {mine[g.key] && <span className="px-2 py-1 text-[11px] font-extrabold tracking-wide" style={{ background: mine[g.key] === 'primary' ? '#dbeafe' : '#fde68a', color: '#111827' }} data-testid="feed-group-mine">{mine[g.key] === 'primary' ? 'YOURS' : 'YOU ARE BACKUP'}</span>}
                {g.stale && <span className="px-2 py-1 text-[11px] font-extrabold" style={{ background: AMBER, color: '#000000' }} data-testid="feed-group-stale">NOT REFRESHED — last good list</span>}
              </div>
              {own && <p className="mt-2 break-words text-[13px] font-semibold" style={{ color: '#e2e8f0' }} data-testid="feed-group-owner">{own}</p>}
            </header>
            {g.items.slice(0, 15).map(function (x) {
              var opened = since && since.openedKey === x.key && (since.openedStillOpen || since.unverified);
              var edge = x.stuck ? RED : opened ? AMBER : '#525252';
              return <div key={x.key} className="mb-2 flex flex-wrap" style={{ background: opened ? '#140e00' : PANEL, border: '1px solid ' + (opened ? AMBER : LINE), borderLeft: '4px solid ' + edge }} data-feed-item={x.key}>
                <div className="px-3 py-2.5" style={{ flex: '1 1 340px', minWidth: 0 }}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span style={LABEL}>The issue</span>
                    {x.stuck && <span className="px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 900, background: RED, color: '#ffffff' }}>STUCK</span>}
                    {opened && <span className="px-1.5 py-0.5" style={{ fontSize: 10, fontWeight: 900, background: AMBER, color: '#000000' }}>{since.unverified ? 'NEEDS REVIEW' : 'STILL OPEN'}</span>}
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
                  <button onClick={function () { openIt(x); }} title={x.entry ? 'Open cost entry here' : 'Takes you to the exact place. A Back button there brings you back to this feed.'} className="px-4 py-2.5 text-[13px] font-extrabold" style={Object.assign({ background: INK, color: '#000000', border: '1px solid ' + INK, whiteSpace: 'nowrap' }, sq)}>{x.entry ? 'Enter ' + (x.entry.kind === 'unit' ? 'unit' : 'cost') : 'Go resolve →'}</button>
                </div>
                {acc.canCosts && x.entry && costTask === x.key && <CostEntryForm key={x.key} task={x} userId={me} onCancel={() => setCostTask(null)} onSaved={() => { setCostTask(null); load(feed); }} />}
              </div>;
            })}
            {g.items.length > 15 && <div className="px-3 py-2 text-[12px] font-bold" style={{ color: SUB }}>{'+ ' + (g.items.length - 15) + ' more of these — resolve the ones above and the next ones move up.'}</div>}
          </section>;
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
// v55.83-AAH — assignments in the feed. They only LABEL and ORDER what the person's switches already show; they never add a task.
export function myAssignments(asg, me) {
  var out = {}; if (!asg || !asg.tasks || !me) { return out; }
  Object.keys(asg.tasks).forEach(function (k) { var a = asg.tasks[k] || {}; if (a.primary === me) { out[k] = 'primary'; } else if (a.backup === me) { out[k] = 'backup'; } });
  return out;
}
// which task types this person's feed can show today (the same switches as feedAccess)
export function feedShowsTask(acc, key) {
  var p = (acc && acc.perms) || {};
  if (key === 'bill_flags' || key === 'bill_validate') { return !!p.bills; }
  if (key === 'bill_ready' || key === 'wire_fix' || key === 'transfer_unused') { return !!p.prepare; }
  if (key === 'wire_sign') { return !!p.signoff; }
  if (key === 'wire_send' || key === 'wire_bank' || key === 'wire_proof') { return !!p.send; }
  if (key === 'invoice_bank') { return !!(acc && acc.canInvoices); }
  if (COST_FEED_KEYS.includes(key)) { return !!acc?.canCosts; }
  return false; // a task whose feed items are not built yet
}
export function ownerLine(asg, key, me) {
  var a = asg && asg.tasks ? asg.tasks[key] : null; var nm = (asg && asg.names) || {};
  if (!a || (!a.primary && !a.backup)) { return asg ? 'Owner: not assigned' : ''; }
  function who(id) { return id === me ? 'you' : (nm[id] || 'someone'); }
  return 'Owner: ' + (a.primary ? who(a.primary) : 'not assigned') + (a.backup ? ' · backup: ' + who(a.backup) : '');
}
// the person's own tasks first (owner, then backup), the rest in their usual order
export function sortMineFirst(groups, mine) {
  function rank(g) { return mine[g.key] === 'primary' ? 0 : mine[g.key] === 'backup' ? 1 : 2; }
  return (groups || []).map(function (g, i) { return { g: g, i: i }; }).sort(function (a, b) { return rank(a.g) - rank(b.g) || a.i - b.i; }).map(function (x) { return x.g; });
}
// v55.83-AAG (Codex AAA-03) — the invoice tasks after a failed reload: the page's retained list when it has tasks, else the last good copy
// (on screen, or taken when the person left the feed). Marked stale: shown, never compared, never resolved.
export function keepLastGoodInvoices(f, lastGood) {
  var have = (f.groups || []).filter(function (g) { return g.key === 'invoice_bank'; })[0];
  var copy = have || (lastGood ? (lastGood.groups || []).filter(function (g) { return g.key === 'invoice_bank'; })[0] : null);
  var others = (f.groups || []).filter(function (g) { return g.key !== 'invoice_bank'; });
  return tally(copy ? others.concat([Object.assign({}, copy, { stale: true })]) : others);
}
// v55.83-AAG (Codex AAA-03) — what Back says about the item the person opened. Only when that item's OWN list loaded can it say Resolved /
// Still open; otherwise: could not verify, still needs review.
export function backVerdict(openedKey, openedTitle, f, ok) {
  var isInvoice = String(openedKey || '').indexOf('invoice_bank:') === 0;
  var isCost = COST_FEED_KEYS.some(function (key) { return String(openedKey || '').startsWith(key + ':'); });
  var sourceOk = !!(isInvoice ? ok?.invoicesOk : isCost ? ok?.costsOk : ok?.othersOk);
  if (!sourceOk) { return { openedKey: openedKey, openedTitle: openedTitle || '', unverified: true, openedStillOpen: false }; }
  var there = false; ((f && f.groups) || []).forEach(function (g) { g.items.forEach(function (x) { if (x.key === openedKey) { there = true; } }); });
  return { openedKey: openedKey, openedTitle: openedTitle || '', unverified: false, openedStillOpen: there };
}
export function dropGroup(f, key) { return f ? tally(f.groups.filter(function (g) { return g.key !== key; })) : f; }
export function onlyGroup(f, key) { return f ? tally(f.groups.filter(function (g) { return g.key === key; })) : f; }

// Replace only the invoices group (the home screen's invoices load separately from the feed's own requests)
export function mergeInvoices(f0, invoices) {
  if (!f0) { return f0; }
  var fresh = buildFeed({ waiting: null, invoices: invoices || [] });
  return tally(f0.groups.filter(function (g) { return g.key !== 'invoice_bank'; }).concat(fresh.groups));
}
