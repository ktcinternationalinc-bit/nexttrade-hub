'use client';
// v55.83-PW — Accounting > 📑 All Transactions (Max, Nov 7 10:51): "should be
// a section where all accounting transactions from all bank accounts that are
// added to see everything and able to sort and filter and do multiple
// category updates and do matching from there as well."
//
// Every account in one table · click a column to sort · filter by account /
// direction / category state / text / dates · tick rows → apply ONE category
// to all of them (learns rules like single picks) · deposits jump straight
// into Bank Review matching.
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { bankSessionHeaders } from '../lib/bank-visibility-client';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function AllTransactionsTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
  var canUse = isSuperAdmin || modulePerms['bank.classify'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };
  var onGo = props.onGo || function () {};

  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState('2026-01-01'); var from = s3[0]; var setFrom = s3[1];
  var s4 = useState(new Date().toISOString().substring(0, 10)); var to = s4[0]; var setTo = s4[1];
  var s5 = useState('all'); var fAcct = s5[0]; var setFAcct = s5[1];
  var s6 = useState('all'); var fDir = s6[0]; var setFDir = s6[1];
  var s7 = useState('all'); var fCat = s7[0]; var setFCat = s7[1]; // all/uncategorized/categorized/transfers/matched
  var s8 = useState(''); var q = s8[0]; var setQ = s8[1];
  var s9 = useState('date'); var sortBy = s9[0]; var setSortBy = s9[1];
  var s10 = useState(true); var sortDesc = s10[0]; var setSortDesc = s10[1];
  var s11 = useState({}); var sel = s11[0]; var setSel = s11[1];
  var s12 = useState(''); var bulkCat = s12[0]; var setBulkCat = s12[1];
  var s13 = useState([]); var cats = s13[0]; var setCats = s13[1];
  var s14 = useState(null); var mPanel = s14[0]; var setMPanel = s14[1]; // v55.83-PW inline matching {txn, candidates}
  var s15 = useState({}); var mAmt = s15[0]; var setMAmt = s15[1];       // per-candidate apply amount
  var s16 = useState({}); var expanded = s16[0]; var setExpanded = s16[1]; // v55.83-PZ — click a description to see ALL of it
  var s17 = useState(null); var tPanel = s17[0]; var setTPanel = s17[1];   // v55.83-PZ (Max 11:24) — transfer pairing {txn, candidates}
  var s18 = useState(null); var rtmPanel = s18[0]; var setRtmPanel = s18[1]; // v55.83-QB (Max 11:38) — RTM third-party payment {txn, bills, amt}
  var s19 = useState(''); var mQ = s19[0]; var setMQ = s19[1];               // v55.83-QF (Max 12:08) — search inside the match popup
  var s20 = useState(''); var mErr = s20[0]; var setMErr = s20[1];           // v55.83-QM (Max 15:08 "it wont apply") — the REASON shows IN the popup, impossible to miss
  var s21 = useState(null); var dupPanel = s21[0]; var setDupPanel = s21[1]; // v55.83-QM (Max 13:33/15:03 "there are duplicates.. help") — {groups}

  function api(action, payload) {
    return fetch('/api/accounting/expense-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {}, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); });
  }
  function load() {
    setBusy(true);
    Promise.all([api('all_transactions', { from: from, to: to }), api('list')]).then(function (rs) {
      var j = rs[0];
      if (j && j.ok) { setData(j); setSel({}); } else { toast.error((j && j.error) || 'Could not load.'); }
      if (rs[1] && rs[1].ok) { setCats((rs[1].categories || []).filter(function (c) { return c.active !== false; })); }
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canUse) { load(); } }, []); // eslint-disable-line

  if (!canUse) {
    return <div className="rounded-xl p-4 text-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155' }}>
      All Transactions needs the <b>Bank: Categorize Transactions</b> permission — ask an admin in Settings → Permissions.</div>;
  }

  var txns = (data && data.transactions) || [];
  var accounts = [];
  txns.forEach(function (t) { if (accounts.indexOf(t.account) < 0) { accounts.push(t.account); } });
  accounts.sort();
  var labelOf = {}; cats.forEach(function (c) { labelOf[c.key] = c.label; });

  var rows = txns.filter(function (t) {
    if (fAcct !== 'all' && t.account !== fAcct) { return false; }
    if (fDir !== 'all' && t.direction !== fDir) { return false; }
    if (fCat === 'uncategorized' && (t.classification || t.transfer || t.matched)) { return false; }
    if (fCat === 'categorized' && !t.classification) { return false; }
    if (fCat === 'transfers' && !(t.transfer || t.classification === 'transfer')) { return false; }
    if (fCat === 'matched' && !t.matched) { return false; }
    if (fCat === 'advances' && !t.advance) { return false; } // v55.83-QF
    if (q.trim()) {
      // v55.83-QM (Max 15:03): "the search should be able to look at description
      // or ANY other data on the line... including the customer or date etc"
      var hayQ = (String(t.who) + ' ' + String(t.who_full || '') + ' ' + String(t.date || '') + ' ' + String(t.account || '') + ' ' +
        String(t.amount) + ' ' + Number(t.amount).toFixed(2) + ' ' + String(labelOf[t.classification] || t.classification || '') + ' ' +
        (t.matched ? 'matched ' : '') + (t.transfer ? 'transfer ' : '') + (t.advance ? 'advance ' : '') + (t.third_party ? 'rtm ' : '') +
        (t.verified ? 'verified ' : '') + String(t.review_status || '')).toLowerCase();
      if (hayQ.indexOf(q.trim().toLowerCase()) < 0) { return false; }
    }
    return true;
  });
  rows = rows.slice().sort(function (a, b) {
    var va = sortBy === 'amount' ? a.amount : sortBy === 'account' ? a.account : sortBy === 'who' ? a.who : a.date;
    var vb = sortBy === 'amount' ? b.amount : sortBy === 'account' ? b.account : sortBy === 'who' ? b.who : b.date;
    if (va < vb) { return sortDesc ? 1 : -1; }
    if (va > vb) { return sortDesc ? -1 : 1; }
    return 0;
  });
  var selIds = Object.keys(sel).filter(function (k) { return sel[k]; });
  var sumSel = 0; rows.forEach(function (t) { if (sel[t.id]) { sumSel += t.direction === 'out' ? -t.amount : t.amount; } });

  function th(key, label, right) {
    return <th className={'py-1.5 pr-2 font-semibold cursor-pointer select-none ' + (right ? 'text-right' : 'text-left')}
      onClick={function () { if (sortBy === key) { setSortDesc(!sortDesc); } else { setSortBy(key); setSortDesc(true); } }}>
      {label}{sortBy === key ? (sortDesc ? ' ↓' : ' ↑') : ''}</th>;
  }
  function toggleAll() {
    var all = {}; var every = rows.length > 0 && rows.every(function (t) { return sel[t.id]; });
    if (!every) { rows.forEach(function (t) { all[t.id] = true; }); }
    setSel(all);
  }
  function applyBulk() {
    if (!bulkCat || selIds.length === 0) { return; }
    setBusy(true);
    api('bulk_classify', { ids: selIds, classification: bulkCat }).then(function (j) {
      if (j && j.ok) {
        if (bulkCat === 'transfer') { toast.success('Marked ' + j.updated + ' as TRANSFERS — they never count as income or spending in any report; click ↔ on a row to pair its other leg.'); }
        else { toast.success('Category applied to ' + j.updated + ' transaction(s); ' + (j.rules_learned || 0) + ' rule(s) learned' + (j.wave_updated ? '; Wave category set on ' + j.wave_updated + ' (queued to sync)' : '; no compatible Wave account — Wave left empty') + '.'); }
        load();
      }
      else { toast.error((j && j.error) || 'Bulk update failed.'); }
    }).finally(function () { setBusy(false); });
  }
  // v55.83-QF (Max 12:08): search ANY invoice/bill from inside the popup
  // (q goes server-side over ALL open rows), apply to SEVERAL for the same
  // deposit, leave the rest for later. keepOpen=true refreshes the popup
  // in place after each apply instead of closing it.
  function openMatch(t, q, keepOpen) {
    var isBill = t.direction === 'out'; // v55.83-PW (Max 11:02): spending matches to BILLS the same way
    setBusy(true);
    if (!keepOpen) { setMQ(q || ''); }
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isBill ? 'bill_match_candidates' : 'deposit_match_candidates', bank_transaction_id: t.id, q: q || '', user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          var remQ = (j.txn.remaining != null) ? j.txn.remaining : j.txn.amount_abs;
          var d2 = {};
          (j.candidates || []).forEach(function (c2) { d2[c2.id || c2.bill_id] = String(Math.min(c2.open, remQ)); });
          setMAmt(d2); setMPanel({ kind: isBill ? 'bill' : 'invoice', txn: j.txn, candidates: j.candidates || [], src: t });
        } else { toast.error((j && j.error) || 'Could not load match candidates.'); }
      }).finally(function () { setBusy(false); });
  }
  function doBillMatch(cand) {
    var amt = Number(mAmt[cand.bill_id]);
    if (!(amt > 0)) { toast.error('Enter the amount to apply.'); return; }
    setBusy(true);
    // record_payment: overpay + over-allocation + settled-out guards live server-side.
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record_payment', bill_id: cand.bill_id, amount: amt, paid_date: mPanel.txn.posted_date || mPanel.txn.date, bank_transaction_id: mPanel.txn.id, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j && (j.ok || !j.error)) { setMErr(''); toast.success('Bill ' + cand.ref + ' paid $' + fmt(amt) + ' ✓ — popup stays open: match more or ✕ when done (the rest can wait).'); openMatch(mPanel.src, mQ, true); load(); }
        else { setMErr(j.error || 'Could not record the bill payment.'); toast.error(j.error || 'Could not record the bill payment.'); }
      }).finally(function () { setBusy(false); });
  }
  function doMatch(cand) {
    var amt = Number(mAmt[cand.id]);
    if (!(amt > 0)) { toast.error('Enter the amount to apply.'); return; }
    setBusy(true);
    // The write goes through bank-write match_invoice — the SAME guarded path
    // as Bank Review (silo guard, over-apply guard, money conservation).
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/bank-write', { method: 'POST', headers: h,
        body: JSON.stringify({ action: 'match_invoice', txn: mPanel.txn, invoice: cand.invoice, amount: amt, user_id: userProfile && userProfile.id }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && (j.ok || j.success)) { setMErr(''); toast.success('Matched $' + fmt(amt) + ' to ' + cand.ref + ' ✓ (flows to Wave + ClickBooks) — match more or ✕ when done; whatever is left shows as ◐ PARTIAL.'); openMatch(mPanel.src, mQ, true); load(); }
      else { setMErr((j && j.error) || 'Match failed — no reason given by the server.'); toast.error((j && j.error) || 'Match failed.'); }
    }).catch(function (eM2) { setMErr('Could not reach the matching service: ' + ((eM2 && eM2.message) || 'network error') + ' — try again; nothing was saved.'); })
      .finally(function () { setBusy(false); });
  }
  // v55.83-PZ (Max, Nov 7 11:24): "when matching or categorization we can
  // select transfer and that clickbooks will give options to other transfers
  // that match from other accounts and will not count as income etc in tax
  // reporting or pnl". Same engine as the 🏷 tab: transfer_candidates finds
  // the opposite leg (same cents, other account, ±7 days); pair_transfer
  // writes ONE group — and anything classified 'transfer' (paired or not) is
  // already excluded from income, spending, tax reports and the P&L.
  function openTransfer(t, manual, q) {
    setBusy(true);
    api('transfer_candidates', { bank_transaction_id: t.id, manual: manual === true, q: q || '' }).then(function (j) {
      if (j && j.ok) { setTPanel({ txn: j.txn, candidates: j.candidates || [], manual: manual === true, q: q || '', src: t }); }
      else { toast.error((j && j.error) || 'Could not look for the other leg.'); }
    }).finally(function () { setBusy(false); });
  }
  function doPair(a2, b2) {
    setBusy(true);
    api('pair_transfer', { a: a2, b: b2 }).then(function (j) {
      if (j && j.ok) { toast.success('Paired ↔ both legs are ONE transfer — never income, never spending; excluded from tax reports and the P&L.'); setTPanel(null); load(); }
      else { toast.error((j && j.error) || 'Could not pair.'); }
    }).finally(function () { setBusy(false); });
  }
  // v55.83-QA (Max, Nov 7 11:32 screenshot): "we need to be able to enter
  // categories ... from here" — the Category column is now a dropdown on
  // every row. One pick = the SAME engine as bulk: whitelisted category,
  // rule learned, Wave ride-along; picking Transfer offers the other leg.
  function setCatOne(t, key) {
    if (!key) { return; }
    // v55.83-QM (Max 13:27): "able to add categories on the fly from the drop down"
    if (key === '__new__') {
      var nm = window.prompt('New category name (it is created as an EXPENSE type — change the type later in 🏷 Categories & Rules):');
      if (!nm || !nm.trim()) { return; }
      setBusy(true);
      api('save_category', { label: nm.trim(), kind: 'expense' }).then(function (jc) {
        var newKey = jc && (jc.key || (jc.category && jc.category.key));
        if (jc && jc.ok && newKey) { load(); setBusy(false); setCatOne(t, newKey); }
        else if (jc && jc.ok) { load(); toast.success('Category created — pick it from the dropdown.'); }
        else { toast.error((jc && jc.error) || 'Could not create the category.'); }
      }).finally(function () { setBusy(false); });
      return;
    }
    setBusy(true);
    api('bulk_classify', { ids: [t.id], classification: key, single_pick: true }).then(function (j) { // QZ2: one person-picked row is finished like Bank Review (reviewed when fully accounted for)
      if (j && j.ok) {
        if (key === 'transfer') { toast.success('Marked as a TRANSFER — never income, never spending in any report.'); openTransfer(t); }
        else { toast.success('Category saved' + ((j.rules_learned || 0) > 0 ? ' · rule learned for next time' : '') + (j.wave_updated ? ' · Wave category set (queued to sync)' : ' · no compatible Wave account — Wave left empty') + ((j.reviewed || 0) > 0 ? ' · marked reviewed → reaches the ClickBooks ledger within 15 min' : '') + '.'); }
        load();
      } else { toast.error((j && j.error) || 'Could not save the category.'); }
    }).finally(function () { setBusy(false); });
  }
  // v55.83-QA (Max 11:32): "...and also attach it to a bill from here" — even
  // when the bill was never entered: ➕ creates the bill FROM the transaction
  // (vendor, date, amount — vendor's remembered category fills in server-side)
  // and immediately records this transaction as its payment. Two guarded
  // writes, same paths as the Bills tab (save_bill + record_payment).
  function createBillFromTxn() {
    var t = mPanel.txn;
    var vend = String(t.merchant_name || t.name || '').trim();
    if (!vend) { toast.error('This transaction has no merchant name — add the bill in the Bills tab instead.'); return; }
    setBusy(true);
    fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_bill', user_id: userProfile && userProfile.id,
        bill: { vendor_name: vend, bill_date: t.posted_date || t.date, total_amount: t.amount_abs,
          category: t.classification || '', notes: 'Created from bank transaction dated ' + (t.posted_date || t.date) + ' in All Transactions.' } }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.id) { throw new Error((j && j.error) || 'Could not create the bill.'); }
        return fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'record_payment', bill_id: j.id, amount: t.amount_abs,
            paid_date: t.posted_date || t.date, bank_transaction_id: t.id, user_id: userProfile && userProfile.id }) })
          .then(function (r2) { return r2.json(); })
          .then(function (j2) {
            if (j2 && j2.error) { toast.success('Bill created for ' + vend + ' — but the payment link failed: ' + j2.error); }
            else { toast.success('Bill created for ' + vend + ' ($' + fmt(t.amount_abs) + ') and PAID by this transaction ✓'); }
            setMPanel(null); load();
          });
      })
      .catch(function (e) { toast.error((e && e.message) || 'Could not create the bill.'); })
      .finally(function () { setBusy(false); });
  }
  // v55.83-QB (Max, Nov 7 11:38): "when we select RTM for a transfer...
  // it asks for what bills it's paid. Then we can select those bills and
  // match those bills to that payment." The per-bill MONEY writes reuse
  // record_payment (method 'rtm') — same guards as every bill payment —
  // and rtm_flag only stamps the transaction. Tax reports keep ONE
  // professional-fee line; the Stats radio shows the real categories.
  function billsApi(payload) {
    return fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json(); });
  }
  // v55.83-QF (Max 12:14): advance = money out before the bills exist.
  function flagAdvance(t, clear) {
    setBusy(true);
    billsApi({ action: 'advance_flag', bank_transaction_id: t.id, clear: clear === true }).then(function (j) {
      if (j && j.ok) {
        toast.success(clear ? '⏳ Advance flag cleared.' : '⏳ Flagged as an ADVANCE — find it any time under the ⏳ Advances filter and attach the real bills with 🔗 when they arrive.');
        setMPanel(null); load();
      } else { toast.error((j && j.error) || 'Could not flag the advance.'); }
    }).finally(function () { setBusy(false); });
  }
  // v55.83-QM (Max 13:30/15:08): "need to be able to unmatch after matching...
  // To change from original matching." Goes through bank-write 'unmatch' —
  // payments voided (never hard-deleted), invoice balances restored, the
  // deposit reopened. Wave-pushed payments ask once, then reverse here and
  // name what to delete inside Wave.
  // v55.83-QQ (Max 16:08: "all remaining amounts should automatically move
  // to uncategorized") — ✓ done parks the remainder as an UNAPPLIED
  // (uncategorized) deposit through the same guarded bank-write path, so
  // every dollar is placed and the row never lingers as ◐ partial.
  function finishMatch() {
    var t = mPanel.src || mPanel.txn;
    var rem = mPanel.txn.remaining != null ? mPanel.txn.remaining : 0;
    if (mPanel.kind !== 'invoice' || !(rem > 0.005) || !(Number(mPanel.txn.applied) > 0.005)) { setMPanel(null); return; }
    setBusy(true);
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/bank-write', { method: 'POST', headers: h,
        body: JSON.stringify({ action: 'create_unapplied', txn: { id: t.id }, amount: rem, notes: 'Parked automatically from the match popup — place it later from Bank Review.', user_id: userProfile && userProfile.id }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { toast.success('✓ $' + fmt(rem) + ' parked as UNCATEGORIZED — every dollar of this deposit is placed; move it later from Bank Review.'); }
      else { toast.error((j && j.error) || 'Could not park the remainder — it stays as ◐ partial.'); }
      setMPanel(null); load();
    }).catch(function (eP9) { toast.error((eP9 && eP9.message) || 'Could not park the remainder.'); setMPanel(null); })
      .finally(function () { setBusy(false); });
  }
  function doUnmatch(t, force) {
    if (!force && !window.confirm('Unmatch this transaction?\n\nAll its matches are REVERSED (voided + logged, never deleted), invoice balances are restored, and it can be re-matched or split differently afterwards.')) { return; }
    setBusy(true);
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/bank-write', { method: 'POST', headers: h,
        body: JSON.stringify({ action: force ? 'force_unmatch_wave' : 'unmatch', bank_transaction_id: t.id, user_id: userProfile && userProfile.id }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { setMErr(''); toast.success('Unmatched ✓ — balances restored; match it again or split it however you need.'); setMPanel(null); load(); }
      else if (j && j.wave_pushed) {
        if (window.confirm('This payment was already pushed to Wave.\n\nUnmatch anyway? The hub reverses it here and shows the exact payment(s) you must then delete inside Wave.')) { doUnmatch(t, true); }
      } else { setMErr((j && j.error) || 'Unmatch failed.'); toast.error((j && j.error) || 'Unmatch failed.'); }
    }).catch(function (eU2) { toast.error((eU2 && eU2.message) || 'Unmatch failed.'); })
      .finally(function () { setBusy(false); });
  }
  // v55.83-QY (Max, Nov 8 11:45–11:50): the same flow for EVERY paid-through
  // company — RTM Capital (outside service; unlinked rest = its fee) and
  // NextTrade Industries (related company; KTC sends money as needed, so an
  // unlinked rest = an ADVANCE awaiting its costs, never a fee).
  var PT_KIND = { 'rtm capital': 'service_provider', 'nexttrade industries': 'affiliate' };
  function openRtm(t, payer) {
    var p0 = payer || t.third_party || 'RTM Capital';
    setBusy(true);
    billsApi({ action: 'rtm_open_bills', payer: p0 }).then(function (j) {
      if (j && j.ok) { setRtmPanel({ txn: t, bills: j.bills || [], amt: {}, payer: p0, kind: PT_KIND[String(p0).toLowerCase()] || 'service_provider' }); }
      else { toast.error((j && j.error) || 'Could not load the bills ' + p0 + ' pays.'); }
    }).finally(function () { setBusy(false); });
  }
  function saveRtm() {
    var t = rtmPanel.txn;
    var picks = [];
    (rtmPanel.bills || []).forEach(function (b) { var a = Number(rtmPanel.amt[b.id]); if (a > 0) { picks.push({ bill: b, amount: Math.round(a * 100) / 100 }); } });
    var sum = 0; picks.forEach(function (p) { sum += p.amount; });
    if (sum > t.amount + 0.005) { toast.error('Selected bills ($' + fmt(sum) + ') exceed this payment ($' + fmt(t.amount) + ') — RTM cannot cover more than you sent.'); return; }
    setBusy(true);
    var chain = Promise.resolve({ okAll: true, done: 0 });
    picks.forEach(function (p) {
      chain = chain.then(function (acc) {
        if (!acc.okAll) { return acc; }
        return billsApi({ action: 'record_payment', bill_id: p.bill.id, amount: p.amount, paid_date: t.date, bank_transaction_id: t.id, method: 'rtm' })
          .then(function (j) {
            if (j && (j.ok || !j.error)) { return { okAll: true, done: acc.done + 1 }; }
            toast.error('Stopped at ' + (p.bill.vendor_name || 'a bill') + ': ' + (j.error || 'failed') + '. ' + acc.done + ' bill(s) before it ARE covered and stay covered.');
            return { okAll: false, done: acc.done };
          });
      });
    });
    chain.then(function (acc) {
      return billsApi({ action: 'rtm_flag', bank_transaction_id: t.id, payer: rtmPanel.payer }).then(function (jf) {
        if (jf && jf.ok) {
          if (acc.okAll) { toast.success('🏢 ' + rtmPanel.payer + ' payment saved — ' + acc.done + ' bill(s) covered ($' + fmt(Math.min(sum, t.amount)) + '). Tax reports keep ONE line; flip that company\'s switch in 📈 Stats to see the real categories.'); }
        } else { toast.error((jf && jf.error) || 'Could not flag the payment.'); }
        setRtmPanel(null); load();
      });
    }).finally(function () { setBusy(false); });
  }
  // v55.83-QM (Max 13:33 + 15:03: "there are duplicates .. help and why are
  // they showing"): relink copies — the SAME real transaction stored once
  // under the old bank link and once under the new one. The scan groups
  // identical lines (account label + date + amount + direction + text),
  // KEEPS the copy carrying work (match/category/verified, else the first)
  // and sends the extras to bank-write mark_review_duplicates — the server
  // re-verifies high confidence and refuses protected rows. Marked
  // duplicates vanish from every list and every total (never deleted).
  function scanDuplicates() {
    var groups = {}; var found = [];
    rows.forEach(function (t0) {
      if (t0.pending) { return; }
      var k0 = String(t0.account) + '|' + String(t0.date) + '|' + Number(t0.amount).toFixed(2) + '|' + t0.direction + '|' + String(t0.who || '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 80);
      if (!groups[k0]) { groups[k0] = []; }
      groups[k0].push(t0);
    });
    Object.keys(groups).forEach(function (k1) {
      var g1 = groups[k1];
      if (g1.length < 2) { return; }
      var keep = g1[0];
      g1.forEach(function (t1) { if ((t1.matched || t1.verified || t1.classification) && !(keep.matched || keep.verified || keep.classification)) { keep = t1; } });
      found.push({ keep: keep, extras: g1.filter(function (t2) { return t2.id !== keep.id; }) });
    });
    if (!found.length) { toast.success('No identical copies found in the loaded rows — nothing to clean.'); return; }
    setDupPanel({ groups: found });
  }
  function hideDuplicates() {
    var ids = [];
    (dupPanel.groups || []).forEach(function (g2) { g2.extras.forEach(function (t3) { ids.push(t3.id); }); });
    if (!ids.length) { return; }
    setBusy(true);
    bankSessionHeaders(supabase, true).then(function (h) {
      return fetch('/api/accounting/bank-write', { method: 'POST', headers: h,
        body: JSON.stringify({ action: 'mark_review_duplicates', duplicate_transaction_ids: ids, user_id: userProfile && userProfile.id }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) {
        toast.success('🧹 ' + (j.marked || 0) + ' duplicate copy(ies) hidden from every list and total' + ((j.skipped || 0) > 0 ? ' · ' + j.skipped + ' skipped (has accounting activity or did not verify as a safe copy — handle those by hand)' : '') + '. Nothing was deleted — they are marked DUPLICATE and recoverable.');
        setDupPanel(null); load();
      } else { toast.error((j && j.error) || 'Could not mark the duplicates.'); }
    }).catch(function (eD3) { toast.error((eD3 && eD3.message) || 'Could not mark the duplicates.'); })
      .finally(function () { setBusy(false); });
  }
  function csv() {
    var lines = ['date,account,description,direction,amount,category,verified,matched,transfer'];
    rows.forEach(function (t) {
      lines.push([t.date, '"' + String(t.account).replace(/"/g, '""') + '"', '"' + String(t.who).replace(/"/g, '""') + '"',
        t.direction, t.amount.toFixed(2), t.classification || '', t.verified ? 'yes' : '', t.matched ? 'yes' : '', t.transfer ? 'yes' : ''].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'all-transactions-' + from + '_to_' + to + '.csv'; a.click();
  }

  return <div className="flex flex-col gap-2">
    <div className="rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>📑 All Transactions — every connected account</div>
        <div className="flex-1" />
        <input type="date" value={from} onChange={function (e) { setFrom(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff' }} />
        <span className="text-[10px]" style={{ color: '#64748b' }}>→</span>
        <input type="date" value={to} onChange={function (e) { setTo(e.target.value); }} className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff' }} />
        <button onClick={load} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>Load</button>
        <button onClick={scanDuplicates} title="Find identical copies left by a bank reconnect (same account, date, amount, direction, text) — keep the one carrying work, hide the extras from every list and total. Nothing is deleted." className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#b45309', color: '#ffffff' }}>🧹 Find duplicates</button>
        <button onClick={csv} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>
      </div>
      <div className="flex gap-1.5 items-center flex-wrap mb-2">
        <select value={fAcct} onChange={function (e) { setFAcct(e.target.value); }} className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff' }}>
          <option value="all">All accounts ({accounts.length})</option>
          {accounts.map(function (a) { return <option key={a} value={a}>{a}</option>; })}
        </select>
        <select value={fDir} onChange={function (e) { setFDir(e.target.value); }} className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff' }}>
          <option value="all">In + out</option><option value="in">Money in</option><option value="out">Money out</option>
        </select>
        {['all', 'uncategorized', 'categorized', 'transfers', 'matched', 'advances'].map(function (f) {
          var on = fCat === f;
          return <button key={f} onClick={function () { setFCat(f); }} className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
            style={on ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>
            {f === 'all' ? 'Everything' : f === 'uncategorized' ? '⚠ Uncategorized' : f === 'categorized' ? 'Categorized' : f === 'transfers' ? '↔ Transfers' : f === 'matched' ? '🔗 Matched' : '⏳ Advances'}</button>;
        })}
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="search description…"
          className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff', width: 170 }} />
        <span className="text-[10px] font-bold" style={{ color: '#64748b' }}>{rows.length} of {txns.length} shown{data && data.capped ? ' · ⚠ 5000-row cap — narrow the dates' : ''}</span>
      </div>

      {/* bulk bar */}
      <div className="flex gap-1.5 items-center flex-wrap mb-2 rounded-lg p-2" style={{ background: selIds.length ? '#eef2ff' : '#f8fafc', border: '1px solid #e2e8f0' }}>
        <span className="text-[11px] font-extrabold" style={{ color: '#312e81' }}>{selIds.length} selected{selIds.length ? ' · Σ ' + (sumSel < 0 ? '−$' : '+$') + fmt(Math.abs(sumSel)) : ''}</span>
        <select value={bulkCat} onChange={function (e) { setBulkCat(e.target.value); }} className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ color: '#0f172a', background: '#ffffff' }}>
          <option value="">apply category…</option>
          {cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
        </select>
        <button onClick={applyBulk} disabled={busy || !bulkCat || selIds.length === 0} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || !bulkCat || selIds.length === 0) ? 0.5 : 1 }}>
          Apply to {selIds.length || '…'} selected</button>
        <span className="text-[9px]" style={{ color: '#64748b' }}>Bulk never touches verified stamps or invoice matches; rules learn from your picks. 🔗 on any deposit matches it to an invoice right here — splits/unapplied live in Bank Review.</span>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: 520, overflowY: 'auto' }}><table className="w-full text-[11px]">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569', position: 'sticky', top: 0, background: '#ffffff' }}>
          <th className="py-1.5 pr-1"><input type="checkbox" checked={rows.length > 0 && rows.every(function (t) { return sel[t.id]; })} onChange={toggleAll} /></th>
          {th('date', 'Date')}{th('account', 'Account')}{th('who', 'Description')}
          {th('amount', 'Amount', true)}
          <th className="py-1.5 pr-2 text-left font-semibold">Category</th>
          <th className="py-1.5 text-left font-semibold">Status</th></tr></thead>
        <tbody style={{ color: '#0f172a' }}>
          {rows.slice(0, 1000).map(function (t) {
            return <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: t.pending ? 0.5 : 1 }}>
              <td className="py-1 pr-1"><input type="checkbox" checked={!!sel[t.id]} onChange={function () { var n2 = Object.assign({}, sel); n2[t.id] = !n2[t.id]; setSel(n2); }} /></td>
              <td className="py-1 pr-2 whitespace-nowrap">{t.date}</td>
              <td className="py-1 pr-2 whitespace-nowrap text-[10px]">{t.account}</td>
              <td className="py-1 pr-2 font-semibold cursor-pointer" title="Click to show the full description"
                onClick={function () { var e2 = Object.assign({}, expanded); e2[t.id] = !e2[t.id]; setExpanded(e2); }}
                style={expanded[t.id] ? { whiteSpace: 'normal', wordBreak: 'break-word' } : {}}>
                {expanded[t.id] ? (t.who_full || t.who) : (String(t.who).substring(0, 46) + (String(t.who_full || t.who).length > 46 ? '…' : ''))}</td>
              <td className="py-1 pr-2 text-right font-extrabold tabular-nums" style={{ color: t.direction === 'out' ? '#7f1d1d' : '#065f46' }}>{(t.direction === 'out' ? '−$' : '+$') + fmt(t.amount)}</td>
              <td className="py-1 pr-2">
                {t.transfer ? <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#dbeafe', color: '#1e40af' }}>↔ transfer</span>
                  : <select value={t.classification || ''} disabled={busy || t.pending} title="Pick a category right here — it learns a rule and updates Wave too"
                      onChange={function (e) { setCatOne(t, e.target.value); }}
                      className="px-1 py-0.5 rounded border border-slate-300 text-[9px] font-bold nt-light" style={{ color: t.classification ? '#334155' : '#9a3412', background: '#ffffff', maxWidth: 150 }}>
                      <option value="">— pick…</option>
                      {cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
                      <option value="__new__">➕ new category…</option>
                    </select>}</td>
              <td className="py-1 text-[9px]">
                {t.pending && <span className="mr-1" style={{ color: '#64748b' }}>pending</span>}
                {/* v55.83-QF (Max 12:08): "signified as partial matched or split full or split partial or unmatched" */}
                {(function () {
                  var ap = Number(t.applied) || 0; var legs = Number(t.applied_legs) || 0;
                  var full = ap >= t.amount - 0.005;
                  if (ap > 0.005 && !full) {
                    return <button onClick={function () { openMatch(t); }} className="px-1 py-0.5 rounded font-extrabold mr-1 underline decoration-dotted" title={'Click to see where the $' + fmt(ap) + ' went and place the rest — ' + legs + ' match(es) so far'} style={{ background: '#fef3c7', color: '#92400e' }}>◐ {legs > 1 ? 'split partial' : 'partial'} · ${fmt(t.amount - ap)} left</button>;
                  }
                  if (ap > 0.005 && full) {
                    return <button onClick={function () { openMatch(t); }} className="px-1 py-0.5 rounded font-extrabold mr-1 underline decoration-dotted" title={'Click to see WHERE it is matched — $' + fmt(ap) + ' fully applied across ' + legs + ' match(es)'} style={{ background: '#d1fae5', color: '#065f46' }}>🔗 {legs > 1 ? 'split full (' + legs + ')' : 'matched'}</button>;
                  }
                  if (t.matched) { return <button onClick={function () { openMatch(t); }} className="px-1 py-0.5 rounded font-extrabold mr-1 underline decoration-dotted" title="Click to see WHERE it is matched (invoice, amount, date) — unmatch from there if needed" style={{ background: '#d1fae5', color: '#065f46' }}>🔗 matched</button>; }
                  return null;
                })()}
                {t.transfer && <span className="px-1 py-0.5 rounded font-extrabold mr-1" style={{ background: '#dbeafe', color: '#1e40af' }}>↔ transfer</span>}
                {t.advance && <span className="px-1 py-0.5 rounded font-extrabold mr-1" title="Advance — money sent before the bills exist. Click 🔗 to attach the real bills when they arrive." style={{ background: '#fef3c7', color: '#92400e' }}>⏳ advance</span>}
                {t.verified && <span className="px-1 py-0.5 rounded font-extrabold mr-1" style={{ background: '#ecfdf5', color: '#064e3b' }}>✓</span>}
                {!t.transfer && !t.pending && (t.matched || (Number(t.applied) || 0) > 0.005) &&
                  <button onClick={function () { doUnmatch(t); }} title="Unmatch — reverse ALL matches on this transaction (voided + logged, never deleted); balances restored; re-match or split differently after" className="px-1 py-0.5 rounded font-bold mr-1" style={{ background: '#fff1f2', color: '#9f1239' }}>⊘</button>}
                {((!t.matched && !t.transfer && !t.pending) || (!t.transfer && !t.pending && (Number(t.applied) || 0) > 0.005 && (Number(t.applied) || 0) < t.amount - 0.005)) &&
                  <button onClick={function () { openMatch(t); }} title={t.direction === 'in' ? 'Match this deposit to an invoice right here — several invoices can share one deposit' : 'Match this payment to an open BILL right here — several bills can share one payment'} className="px-1 py-0.5 rounded font-bold mr-1" style={{ background: '#eef2ff', color: '#312e81' }}>🔗 {t.direction === 'in' ? 'match' : 'bill'}</button>}
                {!t.transfer && !t.pending &&
                  <button onClick={function () { openTransfer(t); }} title="This is a transfer between our own accounts (incl. credit cards) — find the matching leg on another account. Transfers never count as income or spending." className="px-1 py-0.5 rounded font-bold" style={{ background: '#dbeafe', color: '#1e40af' }}>↔</button>}
                {/* v55.83-QF (Max 12:13: "not crazy that you put everything that can
                    be a bill with rtm symbol") — the RTM entry point moved INTO the
                    🔗 match popup as a radio; only ALREADY-FLAGGED rows keep a chip. */}
                {t.third_party && !t.pending &&
                  <button onClick={function () { openRtm(t, t.third_party); }} title={'Payment to ' + t.third_party + ' — click to review or cover more bills'} className="px-1 py-0.5 rounded font-extrabold ml-1" style={{ background: '#fbcfe8', color: '#9d174d' }}>{String(t.third_party || '').toLowerCase().indexOf('nexttrade') >= 0 ? '🏭 NextTrade ✓' : '🏢 RTM ✓'}</button>}
              </td></tr>;
          })}
        </tbody>
      </table></div>
      {rows.length > 1000 && <div className="text-[10px] mt-1" style={{ color: '#64748b' }}>Showing the first 1,000 of {rows.length} — tighten the filters; the CSV carries all of them.</div>}
      {mPanel && <div onClick={function () { setMPanel(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={function (e) { e.stopPropagation(); }} className="rounded-lg p-3" style={{ background: '#eef2ff', border: '1px solid #c7d2fe', maxWidth: 760, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="flex gap-2 items-center mb-1 flex-wrap">
          <div className="text-[11px] font-extrabold" style={{ color: '#312e81' }}>
            🔗 {mPanel.kind === 'bill' ? 'Match payment to a BILL' : 'Match deposit to an invoice'}: {(mPanel.kind === 'bill' ? '−$' : '+$') + fmt(mPanel.txn.amount_abs)} on {mPanel.txn.posted_date || mPanel.txn.date}
            {/* v55.83-QT (Max, Nov 8 11:09: "on the top it should also show the description") — the FULL bank text, never cut */}
            <div className="mt-1 rounded p-1.5 text-[11px] font-bold" style={{ background: '#ffffff', border: '1px solid #c7d2fe', color: '#0f172a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              📝 {[mPanel.txn.merchant_name, mPanel.txn.name].filter(function (x9, i9, a9) { return x9 && a9.indexOf(x9) === i9; }).join(' · ') || '(no description from the bank)'}
              {mPanel.src && mPanel.src.account ? <span className="font-semibold" style={{ color: '#64748b' }}> — {mPanel.src.account}</span> : null}
            </div></div>
          <div className="flex-1" />
          {mPanel.kind === 'bill' && <button onClick={createBillFromTxn} disabled={busy} title="No bill entered yet? Create it from this transaction (vendor, date, amount) and record this payment against it — one click"
            className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>➕ Create bill from this transaction</button>}
          {((mPanel.txn.applied || 0) > 0.005 || (mPanel.src && mPanel.src.matched)) && <button onClick={function () { doUnmatch(mPanel.src || mPanel.txn); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#fff1f2', color: '#9f1239' }}>↩ unmatch all & start over</button>}
          <button onClick={function () { onGo('review'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>splits / unapplied → Bank Review</button>
          <button onClick={finishMatch} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>
            {mPanel.kind === 'invoice' && (Number(mPanel.txn.applied) || 0) > 0.005 && (mPanel.txn.remaining || 0) > 0.005 ? '✓ done — park $' + fmt(mPanel.txn.remaining) + ' as UNCATEGORIZED' : '✓ done'}</button>
        </div>
        {/* v55.83-QF (Max 12:13): the RTM choice lives HERE, not on every row —
            "when you click to match there is a radio box to select RTM
            professional fee and then able to select underlying bills". */}
        {mPanel.kind === 'bill' && <div className="flex gap-3 items-center flex-wrap mb-1 rounded p-1.5" style={{ background: '#ffffff', border: '1px solid #c7d2fe' }}>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#0f172a' }}><input type="radio" checked readOnly /> Pay open bills (normal)</label>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#9d174d' }}>
            <input type="radio" checked={false} onChange={function () { var t0 = mPanel.src; setMPanel(null); openRtm(t0, 'RTM Capital'); }} />
            🏢 RTM professional fee — pick the via-RTM bills it covers; whatever you leave unallocated is RTM's management fee</label>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#115e59' }}>
            <input type="radio" checked={false} onChange={function () { var t2 = mPanel.src; setMPanel(null); openRtm(t2, 'NextTrade Industries'); }} />
            🏭 Payment to NextTrade Industries — pick the costs it covers (payroll, rent, utilities…); anything not yet linked stays an ADVANCE until its bills come in</label>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#92400e' }} title="Money sent before the bills exist — flag it, find it under the ⏳ Advances filter, and attach the real bills right here when they arrive.">
            <input type="radio" checked={false} onChange={function () { flagAdvance(mPanel.src, false); }} />
            ⏳ Advance for FUTURE bills — flag now, attach the actual bills here later</label>
          {mPanel.src && mPanel.src.advance && <button onClick={function () { flagAdvance(mPanel.src, true); }} className="px-2 py-0.5 rounded text-[9px] font-extrabold" style={{ background: '#fef3c7', color: '#92400e' }}>bills attached → clear ⏳ flag</button>}
        </div>}
        {mErr && <div className="mb-1 rounded p-1.5 text-[10px] font-extrabold" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#7f1d1d' }}>✗ {mErr}</div>}
        {/* v55.83-QQ — WHERE THE MONEY WENT: every applied piece, named */}
        {(mPanel.txn.applied_detail || []).length > 0 && <div className="mb-1 rounded-lg p-2" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <div className="text-[10px] font-extrabold mb-0.5" style={{ color: '#064e3b' }}>💰 Where this money went so far:</div>
          {(mPanel.txn.applied_detail || []).map(function (d5, di) {
            return <div key={di} className="flex gap-2 text-[10px] py-0.5" style={{ borderBottom: di < mPanel.txn.applied_detail.length - 1 ? '1px solid #d1fae5' : 'none', color: '#064e3b' }}>
              <span className="font-extrabold tabular-nums">${fmt(d5.amount)}</span>
              <span>→</span>
              <span className="font-bold">{d5.kind === 'unapplied' ? '📥 UNCATEGORIZED (parked — place later from Bank Review)' : (d5.kind === 'rtm_bill' ? '🏢 RTM-covered bill: ' : '') + (d5.ref || d5.invoice_id || d5.bill_id)}{d5.rel ? ' · Release ' + d5.rel : ''}</span>
              <div className="flex-1" />
              <span style={{ color: '#047857' }}>{d5.date || ''}</span>
            </div>;
          })}
        </div>}
        {/* v55.83-QF (Max 12:08) — applied/remaining tracker + search over ALL open rows */}
        <div className="flex gap-2 items-center flex-wrap mb-1">
          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: (mPanel.txn.applied || 0) > 0.005 ? '#fef3c7' : '#ffffff', border: '1px solid #c7d2fe', color: '#312e81' }}>
            applied ${fmt(mPanel.txn.applied || 0)} · remaining ${fmt(mPanel.txn.remaining != null ? mPanel.txn.remaining : mPanel.txn.amount_abs)}</span>
          <span className="text-[9px]" style={{ color: '#312e81' }}>apply to several — leave the rest and it shows as ◐ PARTIAL to come back to later.</span>
          <div className="flex-1" />
          <input value={mQ} onChange={function (e) { setMQ(e.target.value); }}
            onKeyDown={function (e) { if (e.key === 'Enter') { openMatch(mPanel.src, mQ, true); } }}
            placeholder="search anything — name, invoice #, release, amount…"
            className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ width: 240 }} />
          <button onClick={function () { openMatch(mPanel.src, mQ, true); }} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>🔍 search all</button>
        </div>
        {(Number(mPanel.txn.applied) || 0) > 0.005 && (Number(mPanel.txn.remaining) || 0) <= 0.005 ? <div className="rounded-lg p-2 text-[11px] font-extrabold" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#064e3b' }}>✅ Fully placed — every dollar of this transaction is accounted for (see above). To change it: ↩ unmatch all & start over.</div> :
        mPanel.candidates.length === 0 ? <div className="text-[10px]" style={{ color: '#312e81' }}>{mQ ? 'Nothing matches "' + mQ + '" among the OPEN ' + (mPanel.kind === 'bill' ? 'bills' : 'invoices') + ' — try fewer words, or just digits of the amount.' : 'No open ' + (mPanel.kind === 'bill' ? 'bills' : 'invoices') + ' found to match against.'}</div> :
          mPanel.candidates.map(function (c3, ci3) {
            var cid = c3.id || c3.bill_id;
            return <div key={cid}>
            {ci3 === 0 && <div className="text-[10px] font-extrabold mb-0.5 mt-1" style={{ color: '#312e81' }}>{(Number(mPanel.txn.applied) || 0) > 0.005 ? '➡ Put the REST (or ✓ done parks it as UNCATEGORIZED):' : '➡ Pick where this money goes:'}</div>}
            <div className="py-1 px-1 rounded" style={{ borderBottom: '1px solid #e0e7ff', background: ci3 % 2 ? '#f8fafc' : 'transparent', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px 84px', gap: 8, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <span className="text-[11px] font-extrabold" style={{ color: '#0f172a' }}>{c3.exact ? '💯 ' : ''}{c3.ref}{c3.rel ? ' · ' + c3.rel : ''}</span>
                <span className="text-[10px] font-semibold ml-1" style={{ color: '#334155' }}>{String(c3.customer || c3.vendor || '').substring(0, 34)}</span>
                <div className="text-[10px]" style={{ color: '#64748b' }}>due {c3.due || '—'} · open <b style={{ color: '#78350f' }}>${fmt(c3.open)}</b> of ${fmt(c3.total)}</div>
              </div>
              <input value={mAmt[cid] || ''} onChange={function (e) { var n3 = Object.assign({}, mAmt); n3[cid] = e.target.value; setMAmt(n3); }}
                className="px-1.5 py-0.5 rounded border border-slate-300 text-[10px] text-right tabular-nums nt-light" />
              <button onClick={function () { if (mPanel.kind === 'bill') { doBillMatch(c3); } else { doMatch(c3); } }} disabled={busy} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>apply ✓</button>
            </div>
            </div>;
          })}
      </div>
      </div>}
      {tPanel && <div onClick={function () { setTPanel(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={function (e) { e.stopPropagation(); }} className="rounded-lg p-3" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', maxWidth: 680, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="flex gap-2 items-center mb-1 flex-wrap">
          <div className="text-[11px] font-extrabold" style={{ color: '#1e3a8a' }}>
            ↔ Pair the transfer: {String(tPanel.txn.merchant_name || tPanel.txn.name || '').substring(0, 44)} · {(tPanel.txn.direction === 'out' ? '−$' : '+$') + fmt(tPanel.txn.amount_abs)} on {tPanel.txn.posted_date || tPanel.txn.date} — the other leg (same amount, opposite direction, ANOTHER account, ±7 days):</div>
          <div className="flex-1" />
          <button onClick={function () { setTPanel(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#dbeafe', color: '#1e3a8a' }}>✕</button>
        </div>
        <div className="text-[9px] mb-1" style={{ color: '#1e40af' }}>Paired transfers never count as income or deductible spending — they are excluded from tax reports, the P&L and the Books totals automatically. In the ledger each leg moves through 1090 Inter-account transfer clearing, so both bank balances move and the clearing nets to zero.</div>
        {/* v55.83-QX — manual search when the automatic match finds nothing */}
        <div className="flex gap-2 items-center flex-wrap mb-1 rounded p-1.5" style={{ background: '#ffffff', border: '1px solid #bfdbfe' }}>
          <span className="text-[10px] font-extrabold" style={{ color: '#1e3a8a' }}>{tPanel.manual ? '🔎 Manual search (±90 days, any amount, closest amount first):' : '⚡ Automatic: same amount, other account, ±10 days.'}</span>
          <div className="flex-1" />
          <input value={tPanel.q || ''} onChange={function (e) { setTPanel(Object.assign({}, tPanel, { q: e.target.value })); }}
            onKeyDown={function (e) { if (e.key === 'Enter') { openTransfer(tPanel.src || tPanel.txn, true, tPanel.q); } }}
            placeholder="search the other side — text, amount, date…" className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={{ width: 220 }} />
          <button onClick={function () { openTransfer(tPanel.src || tPanel.txn, true, tPanel.q); }} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>🔎 pick it myself</button>
        </div>
        {tPanel.candidates.length === 0 ? <div className="text-[10px] rounded p-1.5" style={{ background: '#ffffff', border: '1px solid #bfdbfe', color: '#1e3a8a' }}>
          <b>No other leg found{tPanel.manual ? ' in the last ±90 days' : ''}.</b> Pick what this really is:
          <div className="mt-0.5">• <b>Your own account that isn't in the hub yet</b> (a card, savings, PNC): add it (Bank → 📄 Import statement CSV → ➕ account), then pair. Until then just set the category to Transfer — it stays out of income and spending and sits in the transit clearing account.</div>
          <div>• <b>Paying a credit card</b> that is not connected: Transfer too — it reduces what you owe on the card; the card PURCHASES are the expenses, never the payment.</div>
          <div>• <b>Money to or from the owner</b>: use Owner draw / Owner contribution — not a transfer, not an expense.</div>
          <div>• <b>Another company of the group</b> (KTC Egypt, etc.): intercompany loan — not a transfer and not income/expense.</div>
          <div>• <b>Loan payment</b>: principal reduces the loan (not deductible); only the interest is an expense.</div>
        </div> :
          tPanel.candidates.map(function (c4) {
            return <div key={c4.id} className="flex gap-2 items-center py-0.5" style={{ borderBottom: '1px solid #dbeafe' }}>
              <span className="text-[10px] font-semibold flex-1" style={{ color: '#0f172a' }}>{c4.posted_date || c4.date} · {c4.account_label ? <b>{c4.account_label}</b> : null}{c4.account_label ? ' · ' : ''}{String(c4.merchant_name || c4.name || '').substring(0, 50)} · ${fmt(c4.amount_abs)} ({c4.direction === 'in' ? 'money in' : 'money out'})
                {c4.same_amount === false && <span className="ml-1 px-1 rounded font-extrabold" style={{ background: '#fef3c7', color: '#92400e' }}>amount differs by ${fmt(Math.abs((Number(c4.amount_abs) || 0) - (Number(tPanel.txn.amount_abs) || 0)))}</span>}</span>
              <button onClick={function () { doPair(tPanel.txn.id, c4.id); }} disabled={busy || c4.same_amount === false} title={c4.same_amount === false ? 'The two legs of one transfer are the same money — they must match to the cent. A wire/bank fee is its own line: categorize it as Bank fees.' : 'Pair these two as ONE transfer between your own accounts'} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff', opacity: (busy || c4.same_amount === false) ? 0.4 : 1 }}>pair these ↔</button>
            </div>;
          })}
      </div>
      </div>}
      {rtmPanel && <div onClick={function () { setRtmPanel(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={function (e) { e.stopPropagation(); }} className="rounded-lg p-3" style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', maxWidth: 760, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="flex gap-2 items-center mb-1 flex-wrap">
          <div className="text-[11px] font-extrabold" style={{ color: '#9d174d' }}>🏢 Payment to {rtmPanel.payer}: {String(rtmPanel.txn.who || '').substring(0, 40)} · −${fmt(rtmPanel.txn.amount)} on {rtmPanel.txn.date} — pick the bills {rtmPanel.payer} covers with this money:</div>
          <div className="flex-1" />
          <button onClick={function () { setRtmPanel(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fce7f3', color: '#9d174d' }}>✕</button>
        </div>
        <div className="flex gap-3 items-center flex-wrap mb-1 rounded p-1.5" style={{ background: '#ffffff', border: '1px solid #fbcfe8' }}>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#0f172a' }}>
            <input type="radio" checked={false} onChange={function () { var t1 = rtmPanel.txn; setRtmPanel(null); openMatch(t1); }} /> Pay open bills (normal)</label>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#9d174d' }}><input type="radio" checked={rtmPanel.payer === 'RTM Capital'} onChange={function () { openRtm(rtmPanel.txn, 'RTM Capital'); }} /> 🏢 RTM professional fee</label>
          <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#115e59' }}><input type="radio" checked={rtmPanel.payer === 'NextTrade Industries'} onChange={function () { openRtm(rtmPanel.txn, 'NextTrade Industries'); }} /> 🏭 NextTrade Industries</label>
        </div>
        <div className="text-[9px] mb-1" style={{ color: '#9d174d' }}>Tax reports and the default P&L keep this payment as ONE line under its own category. The covered bills appear in their REAL categories only when {rtmPanel.payer}'s switch in 📈 Stats is on. {rtmPanel.kind === 'affiliate' ? 'Anything not linked yet stays an ADVANCE with NextTrade — link its bills here when they arrive (its service fee is just one of those bills).' : 'Anything you leave unallocated = RTM\'s professional/management fee.'}</div>
        {(rtmPanel.bills || []).length === 0 && <div className="text-[10px] mb-2" style={{ color: '#9d174d' }}>No open bills paid via {rtmPanel.payer} yet. Enter them in 🧾 Bills with 🏢 Paid via → {rtmPanel.payer} — then come back. You can still flag this payment now.</div>}
        {(rtmPanel.bills || []).map(function (b5) {
          return <div key={b5.id} className="flex gap-2 items-center py-1 flex-wrap" style={{ borderBottom: '1px solid #fce7f3' }}>
            <span className="text-[11px] font-extrabold" style={{ color: '#0f172a' }}>{b5.vendor_name}{b5.bill_number ? ' · ' + b5.bill_number : ''}</span>
            <span className="text-[10px]" style={{ color: '#64748b' }}>{b5.category || 'uncategorized'} · due {b5.due_date || '—'} · open <b style={{ color: '#78350f' }}>${fmt(b5.open)}</b> of ${fmt(b5.total_amount)}</span>
            <div className="flex-1" />
            <input value={rtmPanel.amt[b5.id] || ''} placeholder="0.00" onChange={function (e) { var n5 = Object.assign({}, rtmPanel.amt); n5[b5.id] = e.target.value; setRtmPanel(Object.assign({}, rtmPanel, { amt: n5 })); }}
              className="px-1.5 py-0.5 rounded border border-slate-300 text-[10px] text-right tabular-nums nt-light" style={{ color: '#0f172a', background: '#ffffff', width: 100 }} />
            <button onClick={function () { var n6 = Object.assign({}, rtmPanel.amt); n6[b5.id] = String(Math.min(b5.open, rtmPanel.txn.amount)); setRtmPanel(Object.assign({}, rtmPanel, { amt: n6 })); }} className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#fce7f3', color: '#9d174d' }}>fill</button>
          </div>;
        })}
        <div className="flex gap-2 items-center mt-2 flex-wrap">
          {(function () {
            var s6 = 0; (rtmPanel.bills || []).forEach(function (b6) { var a6 = Number(rtmPanel.amt[b6.id]); if (a6 > 0) { s6 += a6; } });
            var rem = Math.round((rtmPanel.txn.amount - s6) * 100) / 100;
            return <span className="text-[10px] font-extrabold" style={{ color: rem < -0.005 ? '#7f1d1d' : '#9d174d' }}>Σ selected ${fmt(s6)} of ${fmt(rtmPanel.txn.amount)} — {rem < -0.005 ? 'OVER by $' + fmt(Math.abs(rem)) : (rtmPanel.kind === 'affiliate' ? 'advance with NextTrade, awaiting its costs (the rest): $' : 'RTM professional/management fee (the rest): $') + fmt(rem)}</span>;
          })()}
          <div className="flex-1" />
          <button onClick={saveRtm} disabled={busy} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#9d174d', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>Save — flag RTM & cover selected ✓</button>
        </div>
      </div>
      </div>}
      {dupPanel && <div onClick={function () { setDupPanel(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 95, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={function (e) { e.stopPropagation(); }} className="rounded-lg p-3" style={{ background: '#fffbeb', border: '1px solid #fde68a', maxWidth: 820, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="flex gap-2 items-center mb-1 flex-wrap">
          <div className="text-[11px] font-extrabold" style={{ color: '#78350f' }}>🧹 {dupPanel.groups.length} duplicate group(s) — same account, date, amount, direction and text. These come from reconnecting a bank (the old link's copies stayed). The copy carrying your work is KEPT; the extras get marked DUPLICATE — out of every list and total, never deleted, recoverable.</div>
          <div className="flex-1" />
          <button onClick={function () { setDupPanel(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fef3c7', color: '#78350f' }}>✕</button>
        </div>
        {dupPanel.groups.slice(0, 40).map(function (g3, gi) {
          return <div key={gi} className="py-1" style={{ borderBottom: '1px solid #fde68a' }}>
            <div className="text-[10px] font-extrabold" style={{ color: '#0f172a' }}>{g3.keep.date} · {String(g3.keep.who || '').substring(0, 60)} · {(g3.keep.direction === 'out' ? '−$' : '+$') + fmt(g3.keep.amount)} · {g3.keep.account}</div>
            <div className="text-[9px]" style={{ color: '#78350f' }}>keeps: 1 copy{g3.keep.matched ? ' (matched)' : g3.keep.classification ? ' (categorized)' : ''} · hides: {g3.extras.length} extra cop{g3.extras.length === 1 ? 'y' : 'ies'}</div>
          </div>;
        })}
        {dupPanel.groups.length > 40 && <div className="text-[9px] mt-1" style={{ color: '#78350f' }}>…and {dupPanel.groups.length - 40} more group(s) — all included below.</div>}
        <div className="mt-2">
          <button onClick={hideDuplicates} disabled={busy} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold" style={{ background: '#b45309', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>
            Hide {(function () { var n4 = 0; dupPanel.groups.forEach(function (g4) { n4 += g4.extras.length; }); return n4; })()} duplicate cop{(function () { var n5 = 0; dupPanel.groups.forEach(function (g5) { n5 += g5.extras.length; }); return n5 === 1 ? 'y' : 'ies'; })()} ✓
          </button>
        </div>
      </div>
      </div>}
    </div>
  </div>;
}
