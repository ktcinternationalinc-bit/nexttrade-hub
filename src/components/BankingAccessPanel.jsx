'use client';
// v55.83-RI (Max, Nov 9 10:36–10:38): "i need to know where all of the
// permissioning for the banking section as we described??" · "i need all of
// the banking permissions in one box and easy to understand and use"
//
// ONE box: pick a person → every banking / accounting switch for them, in six
// plain groups, each saying what it unlocks; a warning when a switch cannot
// work yet (e.g. money totals without opening the books). Same keys and the
// same storage as before — the server rules did not change, only where you set
// them. Bank Balances + the company financial overview stay super-admin grants
// (their own protected table), shown here in the same box.
import React, { useState, useEffect } from 'react';
import { effectiveSwitch } from '../lib/permission-aliases'; // v55.83-UG
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';
import { useBankVisibility, refreshBankVisibility } from '../lib/use-bank-visibility';

var INK = '#0f172a'; var SUB = '#334155'; var MUTED = '#64748b';
export var BANKING_GROUPS = [
  { title: '1 · Which books can they open?', note: 'Nothing below works until at least one of these is ON.', items: [
    { key: 'accounting.clickbooks.access', label: 'ClickBooks (KTC Hub)', desc: 'Books, Bills, Wires, Stats, Forecast, Financial Reports. Shows what is due and overdue.' },
    { key: 'accounting.wavehub.access', label: 'Wave Hub', desc: 'Wave dashboard, invoices, customers, bank review & matching, order reconciliation.' },
  ] },
  { title: '2 · Which money can they see?', items: [
    { key: 'accounting.view_totals', label: 'Money totals', desc: 'Came In, Went Out, Sales, Net Moved, Projected Net. Without it these show “Restricted”.', needsBooks: true },
    { key: 'pnl.view', label: 'P&L and Profitability', desc: 'Profitability, Sales P&L and Inventory P&L screens: revenue and cost of goods per product, customer and invoice.', needsBooks: true },
    { key: 'pnl.view_margin', label: 'Profit & margin 🔒', desc: 'The PROFIT and MARGIN numbers on those screens. Without it they show 🔒. Only the super admin can switch this on.', needsBooks: true, sensitive: true },
    { key: 'pnl.edit_costs', label: 'Edit product costs', desc: 'Type or change product costs (with the date they start). The most sensitive accounting change.', needsBooks: true },
    { key: 'accounting.view_invoicing', label: 'Invoices & collections', desc: 'Invoiced, Paid, Still Open, Collected — and the invoices behind them.', needsBooks: true },
    { special: 'canViewBankBalances', label: 'Bank balances', desc: 'Account balances, trial balance, general ledger, cash flow, bank reconciliation. Super admin grants only.' },
    { special: 'canViewFullDashboard', label: 'Company financial overview & ClickBooks reports', desc: 'The company-wide financial dashboard and the ClickBooks Financial Reports tab. Super admin grants only.' },
  ] },
  { title: '3 · Bank work', items: [
    { key: 'bank.view', label: 'See bank transactions', desc: 'Names and dates of bank lines (Bank Review & Matching).' },
    { key: 'bank.see_amounts', label: 'See transaction amounts', desc: 'Without it, amounts on bank lines are hidden.' },
    { key: 'bank.view_all_accounts', label: 'See every bank account', desc: 'Switch between accounts and see “All accounts”.' },
    { key: 'bank.classify', label: 'Categorize transactions', desc: 'Needed for ClickBooks → All Transactions and Categories & Rules.' },
    { key: 'bank.view_private', label: 'See private accounts 🔒', desc: 'Bank accounts the super admin marked private (Bank → account → 🔒 Make private). Only the super admin can switch this on.', sensitive: true },
    { key: 'bank.add_transactions', label: 'Add transactions by hand 🔒', desc: 'All Transactions → ➕ Add transaction, when the bank or a statement does not have it. Only the super admin can switch this on.', sensitive: true },
    { key: 'bank.connections', label: 'Connect / reconnect banks', desc: 'Plaid connections, re-pull history, archive duplicates.' },
  ] },
  { title: '3b · Invoices, customers & payments', note: 'Needs Wave Hub (or ClickBooks) in group 1.', items: [
    { key: 'invoice.view', label: 'See invoices', desc: 'Invoices and proformas, read only.', needsBooks: true },
    { key: 'invoice.create', label: 'Create / edit invoices', desc: 'Make and change invoices and proformas.', needsBooks: true },
    { key: 'accounting.customers.view', label: 'See customers', desc: 'Accounting customers (not the CRM).', needsBooks: true },
    { key: 'accounting.customers.edit', label: 'Add / change customers', desc: 'Create, edit and archive accounting customers.', needsBooks: true },
    { key: 'payments.match', label: 'Match payments to invoices', desc: 'Match a bank deposit to a customer invoice.', needsBooks: true },
    { key: 'payments.unmatch', label: 'Undo a payment match', desc: 'Reverse a match. Recorded with the name.', needsBooks: true },
    { key: 'payments.mark_manual_done', label: 'Mark a payment entered in Wave by hand', desc: 'Clears a queued payment already typed into Wave.', needsBooks: true },
    { key: 'ar.send_reminders', label: 'Send payment reminders', desc: 'Email customers about what they owe.', needsBooks: true },
    { key: 'ar.manage_overdue_dashboard', label: 'Manage the overdue list', desc: 'Ignore / un-ignore items on the overdue dashboard.', needsBooks: true },
    { key: 'accounting.change_dates', label: 'Look beyond the default dates', desc: 'Move the date filters past the defaults. Without it the server limits the range.', needsBooks: true },
  ] },
  { title: '4 · Bills (what we owe)', note: 'Needs ClickBooks (KTC Hub) in group 1.', items: [ // v55.83-SA — Bills is a ClickBooks screen
    { key: 'bills.view', label: 'See bills', desc: 'Vendor bills and what is due.', needsKtc: true },
    { key: 'bills.manage', label: 'Add / change bills', desc: 'Add, edit, void bills and record payments.', needsKtc: true },
    { key: 'bills.price_rules', label: 'Set price rules', desc: 'Enter the expected prices of products and services (and the NexPac 12.5% commission) the Hub checks every bill against.', needsKtc: true },
  ] },
  { title: '5 · Wires', note: 'Needs ClickBooks (KTC Hub) in group 1.', items: [
    { key: 'wires.view', label: 'See wires', desc: 'See every wire, its checks and the bills it paid.', needsKtc: true },
    { key: 'wires.prepare', label: 'Prepare wires', desc: 'Make a wire: who gets the money and which bills it pays.', needsKtc: true },
    { key: 'wires.signoff', label: 'Sign wires (one of the 2)', desc: 'Verify and sign before it is sent. Nobody can sign the same wire twice.', needsKtc: true },
    { key: 'wires.send', label: 'Send wires', desc: 'Mark it sent with the bank confirmation, attach the bank line, add RTM proof.', needsKtc: true },
    { key: 'wires.override', label: 'Override wire checks', desc: 'Let a wire go ahead despite a problem a person can judge (e.g. a missing release on an overhead bill) — the reason is kept with this person\'s name.', needsKtc: true },
  ] },
  { title: '5b · Journal entries', note: 'Needs ClickBooks (KTC Hub) in group 1. Two different people: one writes, one approves.', items: [ // v55.83-SL
    { key: 'journals.prepare', label: 'Write journal entries', desc: 'Write an adjusting entry (accrual, correction, re-class) and send it for approval.', needsKtc: true },
    { key: 'journals.approve', label: 'Approve journal entries', desc: 'Approve or reject an entry someone else wrote. Approving posts it to the ledger.', needsKtc: true },
  ] },
  { title: '6 · Orders & order reconciliation', items: [
    { key: 'orders.monitor', label: 'See orders', desc: 'Orders — stage and what is missing, invoice and deposit status, the 30-hour deadline.' },
    { key: 'orders.manage', label: 'Work orders', desc: 'Match a deposit to an order, override, close an order — each with a reason and the name.' },
    { key: 'recon.signoff', label: 'Reconcile & approve', desc: 'Resolve saved reconciliation lines, mark reconciled, or approve (a different person approves).' },
  ] },
  { title: '7 · Nextrade & RTM books', note: 'Their own books — separate from KTC.', items: [
    { key: 'company.nextrade.view', label: 'See Nextrade books', desc: 'Nextrade’s own bank and card lines, categories and totals.' },
    { key: 'company.nextrade.manage', label: 'Work Nextrade books', desc: 'Categorize Nextrade lines (an expense makes a KTC bill), rules.' },
    { key: 'company.rtm.view', label: 'See RTM books', desc: 'RTM’s own bank lines, categories and totals.' },
    { key: 'company.rtm.manage', label: 'Work RTM books', desc: 'Categorize RTM lines, rules.' },
    { key: 'advances.manage', label: 'Advances & fees 🔒', desc: 'Split a payment to NextTrade / RTM into fee and advance; use advances on bills. Only the super admin can switch this on.', sensitive: true },
  ] },
  { title: '8 · Sourcing desk', note: 'Buying: supplier research and supplier emails.', items: [
    { key: 'commercial.access', label: 'Use the Sourcing desk', desc: 'See and work sourcing requests and suppliers.' },
    { key: 'commercial.research', label: 'Start web research', desc: 'Each search is a paid lookup.' },
    { key: 'commercial.approve', label: 'Approve outgoing emails', desc: 'Nothing goes to a supplier until approved.' },
  ] },
];
export var BANKING_KEYS = (function () { var k = ['accounting.view']; BANKING_GROUPS.forEach(function (g) { g.items.forEach(function (i) { if (i.key) { k.push(i.key); } }); }); return k; })();

function Switch(p) {
  return <button type="button" role="switch" aria-checked={p.on} onClick={p.onClick} disabled={p.disabled} title={p.title}
    className="rounded-full font-extrabold text-[12px] disabled:opacity-50" style={{ minWidth: 64, padding: '5px 12px', background: p.on ? '#047857' : '#ffffff', color: p.on ? '#ffffff' : SUB, border: '2px solid ' + (p.on ? '#047857' : '#cbd5e1') }}>{p.label || (p.on ? 'ON' : 'OFF')}</button>;
}

export default function BankingAccessPanel(props) {
  var users = props.users || []; var permissions = props.permissions || {}; var toggle = props.togglePermission;
  var vis = useBankVisibility(); var superV = vis.isVerifiedSuperAdmin === true;
  var s1 = useState(users.length ? users[0].id : null); var sel = s1[0]; var setSel = s1[1];
  var s2 = useState([]); var grants = s2[0]; var setGrants = s2[1];
  var s3 = useState(''); var gErr = s3[0]; var setGErr = s3[1];
  var s4 = useState(null); var saving = s4[0]; var setSaving = s4[1];
  var s5 = useState(0); var ver = s5[0]; var setVer = s5[1];
  var s6 = useState(''); var q = s6[0]; var setQ = s6[1];

  useEffect(function () {
    if (!superV) { setGrants([]); return; }
    var alive = true;
    (async function () {
      try {
        var h = await bankSessionHeaders(supabase, false);
        var r = await fetch('/api/bank-visibility?scope=grants', { headers: h, cache: 'no-store' });
        var j = await r.json();
        if (!alive) { return; }
        if (!r.ok || j.ok !== true || !Array.isArray(j.grants)) { throw new Error(j.error || 'Bank balance grants could not be loaded.'); }
        setGrants(j.grants); setGErr('');
      } catch (e) { if (alive) { setGErr(e.message); } }
    })();
    return function () { alive = false; };
  }, [superV, ver]);
  useEffect(function () { if (!sel && users.length) { setSel(users[0].id); } }, [users.length]); // eslint-disable-line

  function grantFor(u) {
    var em = String((u && u.email) || '').toLowerCase(); var nm = String((u && u.name) || '').toLowerCase();
    var hit = null;
    grants.forEach(function (g) { if (!hit && em && String(g.email || '').toLowerCase() === em) { hit = g; } });
    if (!hit) { grants.forEach(function (g) { if (!hit && nm && String(g.name || '').toLowerCase() === nm) { hit = g; } }); }
    return hit;
  }
  async function flipSpecial(g, cap) {
    if (!superV || !g || !g.authUserId || saving) { return; }
    setSaving(cap);
    try {
      var h = await bankSessionHeaders(supabase, true);
      var body = { profileId: g.profileId }; body[cap] = !g[cap];
      var r = await fetch('/api/bank-visibility', { method: 'PUT', headers: h, cache: 'no-store', body: JSON.stringify(body) });
      var j = await r.json();
      if (!r.ok || j.ok !== true) { throw new Error(j.error || 'Could not save.'); }
      refreshBankVisibility(); setVer(function (v) { return v + 1; });
    } catch (e) { setGErr(e.message); } finally { setSaving(null); }
  }
  // v55.83-UG (Codex QA 18:06) — show what the server will actually allow, counting every name of the switch
  function has(u, key) { var m = permissions[u.id] || {}; var on = {}, off = {}; Object.keys(m).forEach(function (k) { if (m[k] === true) { on[k] = true; } else if (m[k] === false) { off[k] = true; } }); return effectiveSwitch(on, off, key) === true; }
  var shownUsers = users.filter(function (u) { var t = (String(u.name || '') + ' ' + String(u.email || '') + ' ' + String(u.role || '')).toLowerCase(); return !q.trim() || t.indexOf(q.trim().toLowerCase()) >= 0; });
  var u = users.filter(function (x) { return x.id === sel; })[0] || null;
  var boss = !!(u && u.role === 'super_admin'); // v55.83-UG (Max, Nov 18) — only the super admin has everything; admins / owners use their switches
  var g = u ? grantFor(u) : null;
  var books = u && (boss || has(u, 'accounting.clickbooks.access') || has(u, 'accounting.wavehub.access') || has(u, 'accounting.view'));
  var ktc = u && (boss || has(u, 'accounting.clickbooks.access') || has(u, 'accounting.view'));

  function summary(x) {
    if (x.role === 'super_admin') { return 'everything (super admin)'; }
    var on = []; var cnt = 0;
    if (has(x, 'accounting.clickbooks.access') || has(x, 'accounting.view')) { on.push('ClickBooks'); }
    if (has(x, 'accounting.wavehub.access') || has(x, 'accounting.view')) { on.push('Wave'); }
    BANKING_KEYS.forEach(function (k) { if (k.indexOf('accounting.') !== 0 && has(x, k)) { cnt += 1; } });
    if (has(x, 'accounting.view_totals')) { on.push('totals'); }
    var gx = grantFor(x); if (gx && gx.canViewBankBalances) { on.push('balances'); }
    return (on.length ? on.join(' · ') : 'no books') + (cnt ? ' · ' + cnt + ' more' : '');
  }

  return <section className="nt-paper rounded-xl p-4 mb-5" style={{ border: '2px solid #1e293b' }} aria-label="Banking and accounting access">
    <div className="text-[17px] font-extrabold" style={{ color: INK }}>🏦 Banking & Accounting Access — everything in one place</div>
    <div className="text-[12px] mt-1 mb-3" style={{ color: SUB }}>Pick a person on the left, switch what they need on the right. Only the super admin has everything — everyone else, admins and owners included, has exactly what is switched ON here. 🔒 switches only the super admin can turn on. A change reaches the person within about 2 minutes (or as soon as they come back to the Hub) — no sign-out needed.</div>
    {users.length === 0 ? <div style={{ color: MUTED }}>No team members yet.</div> :
    <div className="flex gap-4 flex-wrap items-start">
      {/* people */}
      <div style={{ flex: '0 0 250px', maxWidth: '100%' }}>
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="🔎 find a person" className="w-full px-2 py-1.5 rounded-lg border text-[12px] nt-light mb-2" style={{ color: INK, background: '#ffffff', borderColor: '#cbd5e1' }} />
        <div className="rounded-lg overflow-auto" style={{ maxHeight: 560, border: '1px solid #e2e8f0' }}>
          {shownUsers.map(function (x) {
            var on = x.id === sel;
            return <button key={x.id} onClick={function () { setSel(x.id); }} className="w-full text-left px-3 py-2" style={{ background: on ? '#1e293b' : '#ffffff', color: on ? '#ffffff' : INK, borderBottom: '1px solid #f1f5f9' }}>
              <div className="text-[13px] font-extrabold">{x.name || x.email}</div>
              <div className="text-[10px]" style={{ color: on ? '#cbd5e1' : MUTED }}>{summary(x)}</div></button>;
          })}
        </div>
      </div>
      {/* switches */}
      {u && <div style={{ flex: '1 1 480px', minWidth: 0 }}>
        {(props.staleUsers || {})[u.id] && <div className="rounded-lg px-3 py-2 mb-2 text-[12px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d', border: '1px solid #fca5a5' }}>⚠ Some of this person’s switches may be only partly saved, so what you see here may not be right. Reload the page before changing them.</div>}
        <div className="text-[15px] font-extrabold mb-2" style={{ color: INK }}>{u.name || u.email}<span className="text-[11px] font-bold ml-2" style={{ color: MUTED }}>{u.role}</span></div>
        {boss && <div className="rounded-lg p-2 mb-3 text-[12px] font-bold" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46' }}>{'As ' + u.role + ', ' + (u.name || 'they') + ' already has every switch below (except Bank balances / the financial overview, which are super-admin grants).'}</div>}
        {!boss && !books && <div className="rounded-lg p-2 mb-3 text-[12px] font-bold" style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#78350f' }}>⚠ Turn on ClickBooks or Wave Hub in group 1 first — the other switches do nothing until then.</div>}
        {!boss && has(u, 'accounting.view') && <div className="rounded-lg p-2 mb-3 text-[12px]" style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: SUB }}>
          They still have the old “Accounting Access (both hubs)” switch, which counts as BOTH books. Turn ClickBooks / Wave on above as needed, then <Switch on={true} label="turn the old one off" onClick={function () { toggle(u.id, 'accounting.view', true); }} /></div>}
        {BANKING_GROUPS.map(function (grp) {
          return <div key={grp.title} className="rounded-xl p-3 mb-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div className="text-[13px] font-extrabold" style={{ color: INK }}>{grp.title}</div>
            {grp.note && <div className="text-[11px] mb-1" style={{ color: MUTED }}>{grp.note}</div>}
            {grp.items.map(function (it) {
              var on; var ctl; var warn = '';
              if (it.special) {
                on = !!(g && g[it.special]);
                ctl = !superV ? <span className="text-[11px] font-bold" style={{ color: MUTED }}>{on ? 'ON' : 'OFF'} · only a super admin can change</span>
                  : !g ? <span className="text-[11px] font-bold" style={{ color: '#9a3412' }}>needs a verified sign-in first</span>
                  : g.isVerifiedSuperAdmin ? <span className="text-[11px] font-bold" style={{ color: '#065f46' }}>always (super admin)</span>
                  : <Switch on={on} disabled={!!saving} onClick={function () { flipSpecial(g, it.special); }} />;
              } else {
                on = boss || has(u, it.key);
                ctl = boss ? <span className="text-[11px] font-bold" style={{ color: '#065f46' }}>always ({u.role})</span>
                  : <Switch on={has(u, it.key)} onClick={function () { toggle(u.id, it.key, has(u, it.key)); }} />;
                if (!boss && has(u, it.key) && it.needsKtc && !ktc) { warn = 'Not working yet — turn on ClickBooks (KTC Hub) in group 1.'; }
                else if (!boss && has(u, it.key) && it.needsBooks && !books) { warn = 'Not working yet — turn on ClickBooks or Wave Hub in group 1.'; }
              }
              return <div key={it.key || it.special} className="flex gap-3 items-center py-2" style={{ borderTop: '1px solid #e2e8f0' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-[13px] font-extrabold" style={{ color: INK }}>{it.label}</div>
                  <div className="text-[11px]" style={{ color: SUB }}>{it.desc}</div>
                  {warn && <div className="text-[11px] font-bold mt-0.5" style={{ color: '#b45309' }}>⚠ {warn}</div>}
                </div>
                <div>{ctl}</div>
              </div>;
            })}
          </div>;
        })}
        {gErr && <div className="text-[11px] rounded p-2 mt-1" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{gErr}</div>}
      </div>}
    </div>}
  </section>;
}
