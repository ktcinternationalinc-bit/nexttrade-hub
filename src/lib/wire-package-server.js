// v55.83-RH — server helpers for prepared wires (packages). Everything the
// audit needs about a set of bills: the bills, EVERY payment ever made on them,
// other bills sharing a release / reference number, releases known from the
// orders and invoices, and which bills already sit on another open package.
import { normRef, packageLabel } from './wire-audit';

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function chunk(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) { out.push(arr.slice(i, i + n)); } return out; }
export async function inChunks(db, table, cols, col, ids) {
  var out = [];
  var parts = chunk(ids, 200);
  for (var i = 0; i < parts.length; i++) {
    var r = await db.from(table).select(cols).in(col, parts[i]);
    // v55.83-RJ (review gap 13) — never treat a failed lookup as "nothing found" (a paid bill would look open)
    if (r.error) { throw new Error('Could not read ' + table + ': ' + r.error.message); }
    if (r.data) { out = out.concat(r.data); }
  }
  return out;
}

// pkgLines = [{ id, bill_id, amount, ... }] of ONE package
export async function packageContext(db, pkgId, pkgLines) {
  var billIds = []; (pkgLines || []).forEach(function (l) { if (billIds.indexOf(l.bill_id) < 0) { billIds.push(l.bill_id); } });
  var bills = billIds.length ? await inChunks(db, 'vendor_bills', '*', 'id', billIds) : [];
  var billBy = {}; bills.forEach(function (b) { billBy[b.id] = b; });
  // every payment ever made on these bills = "paid previously"
  var pays = billIds.length ? await inChunks(db, 'vendor_bill_payments', 'id, bill_id, amount, paid_date, bank_transaction_id, method, voided', 'bill_id', billIds) : [];
  pays = pays.filter(function (p) { return p.voided !== true; });
  var txIds = []; pays.forEach(function (p) { if (p.bank_transaction_id && txIds.indexOf(p.bank_transaction_id) < 0) { txIds.push(p.bank_transaction_id); } });
  var txLabel = {};
  if (txIds.length) {
    var tx = await inChunks(db, 'bank_transactions', 'id, date, posted_date, name, merchant_name', 'id', txIds);
    tx.forEach(function (t) { txLabel[t.id] = 'bank ' + (t.posted_date || t.date) + ' ' + String(t.merchant_name || t.name || '').substring(0, 40); });
  }
  var rels = []; var nums = [];
  bills.forEach(function (b) {
    var rl = normRef(b.release_number); if (rl && rels.indexOf(rl) < 0) { rels.push(rl); }
    var nm = String(b.bill_number || '').trim(); if (nm && nums.indexOf(nm) < 0) { nums.push(nm); }
  });
  var sameRelease = {}; var sameNumber = {};
  if (rels.length) {
    var rb = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, release_number, record_status, total_amount, bill_date', 'release_number', rels);
    rb.forEach(function (b) { if (b.record_status !== 'active') { return; } var k = normRef(b.release_number); (sameRelease[k] = sameRelease[k] || []).push({ bill_id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, total_amount: b.total_amount, bill_date: b.bill_date || null }); });
  }
  if (nums.length) {
    var nb = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, record_status, bill_date, total_amount, release_number', 'bill_number', nums);
    nb.forEach(function (b) { if (b.record_status !== 'active') { return; } var k = normRef(b.bill_number); (sameNumber[k] = sameNumber[k] || []).push({ bill_id: b.id, vendor_name: b.vendor_name, bill_date: b.bill_date || null, total_amount: b.total_amount, release_number: b.release_number || null }); });
  }
  // v55.83-RK (Max 11:38 "...no duplicates...previously paid") — how much of each OTHER bill sharing a release / reference was already paid
  // v55.83-RL — other bills sharing the OTHER reference (BOL / PO / container…), when that column exists
  var sameOther = {};
  var orefs = []; bills.forEach(function (b) { var o0 = normRef(b.other_reference); if (o0 && orefs.indexOf(o0) < 0) { orefs.push(o0); } });
  if (orefs.length) {
    try {
      var ob = await inChunks(db, 'vendor_bills', 'id, vendor_name, bill_number, record_status, bill_date, total_amount, other_reference', 'other_reference', orefs);
      ob.forEach(function (b) { if (b.record_status !== 'active') { return; } var k = normRef(b.other_reference); (sameOther[k] = sameOther[k] || []).push({ bill_id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date || null, total_amount: b.total_amount }); });
    } catch (eOr) { sameOther = {}; }
  }
  var otherIds = [];
  Object.keys(sameOther).forEach(function (k) { sameOther[k].forEach(function (o) { if (billIds.indexOf(o.bill_id) < 0 && otherIds.indexOf(o.bill_id) < 0) { otherIds.push(o.bill_id); } }); });
  Object.keys(sameRelease).forEach(function (k) { sameRelease[k].forEach(function (o) { if (billIds.indexOf(o.bill_id) < 0 && otherIds.indexOf(o.bill_id) < 0) { otherIds.push(o.bill_id); } }); });
  Object.keys(sameNumber).forEach(function (k) { sameNumber[k].forEach(function (o) { if (billIds.indexOf(o.bill_id) < 0 && otherIds.indexOf(o.bill_id) < 0) { otherIds.push(o.bill_id); } }); });
  if (otherIds.length) {
    var op = await inChunks(db, 'vendor_bill_payments', 'bill_id, amount, voided', 'bill_id', otherIds);
    var opBy = {}; op.forEach(function (p) { if (p.voided !== true) { opBy[p.bill_id] = r2((opBy[p.bill_id] || 0) + (Number(p.amount) || 0)); } });
    Object.keys(sameRelease).forEach(function (k) { sameRelease[k].forEach(function (o) { o.paid_total = opBy[o.bill_id] || 0; }); });
    Object.keys(sameNumber).forEach(function (k) { sameNumber[k].forEach(function (o) { o.paid_total = opBy[o.bill_id] || 0; }); });
    Object.keys(sameOther).forEach(function (k) { sameOther[k].forEach(function (o) { o.paid_total = opBy[o.bill_id] || 0; }); });
  }
  var known = [];
  if (rels.length) {
    try { (await inChunks(db, 'nexttrade_orders', 'release_number', 'release_number', rels)).forEach(function (x) { known.push(x.release_number); }); } catch (eO) { /* fail-soft: only feeds a warning */ }
    try { (await inChunks(db, 'accounting_invoices', 'release_number', 'release_number', rels)).forEach(function (x) { known.push(x.release_number); }); } catch (eI) { /* fail-soft */ }
  }
  // the same bill on ANOTHER open package
  var otherOpen = {};
  if (billIds.length) {
    var ol = await inChunks(db, 'wire_package_lines', 'package_id, bill_id, is_open', 'bill_id', billIds);
    var otherPk = []; ol.forEach(function (l) { if (l.is_open && l.package_id !== pkgId && otherPk.indexOf(l.package_id) < 0) { otherPk.push(l.package_id); } });
    var pk = otherPk.length ? await inChunks(db, 'wire_packages', 'id, seq, status', 'id', otherPk) : [];
    var lab = {}; pk.forEach(function (p) { if (p.status !== 'cancelled') { lab[p.id] = packageLabel(p); } });
    ol.forEach(function (l) { if (l.is_open && l.package_id !== pkgId && lab[l.package_id]) { otherOpen[l.bill_id] = lab[l.package_id]; } });
  }
  var lines = (pkgLines || []).map(function (l) {
    var others = pays.filter(function (p) { return p.bill_id === l.bill_id && p.id !== l.payment_id; }).map(function (p) {
      return { amount: r2(p.amount), paid_date: p.paid_date, bank_transaction_id: p.bank_transaction_id || null,
        label: p.bank_transaction_id ? (txLabel[p.bank_transaction_id] || 'another bank payment') : (p.method ? 'recorded ' + p.method : 'recorded payment') };
    });
    return { line_id: l.id, payment_id: l.payment_id || null, bill_id: l.bill_id, amount: r2(l.amount), bill: billBy[l.bill_id] || {}, other_payments: others, will_mark: l.marked_paid_via === true,
      rtm: { paid_date: l.rtm_paid_date || null, reference: l.rtm_reference || null, file_id: l.rtm_file_id || null, confirmed_by: l.rtm_confirmed_by || null, confirmed_at: l.rtm_confirmed_at || null } };
  });
  return { lines: lines, sameRelease: sameRelease, sameNumber: sameNumber, sameOther: sameOther, knownReleases: known, otherOpen: otherOpen, billBy: billBy };
}

// Paid-through companies (RTM Capital, NextTrade Industries) — same source as Bills.
var PARTY_DEFAULTS = [{ name: 'RTM Capital', kind: 'service_provider' }, { name: 'NextTrade Industries', kind: 'affiliate' }];
export async function loadPayParties(db) {
  try {
    var pr = await db.from('paid_through_parties').select('name, kind, active, sort').eq('active', true).order('sort');
    if (!pr.error && pr.data && pr.data.length) { return pr.data.map(function (p) { return { name: p.name, kind: p.kind }; }); }
  } catch (eP) { /* fail-soft */ }
  return PARTY_DEFAULTS;
}

// AI review of a prepared wire, BEFORE the money leaves. Server-side key only;
// unavailable → said plainly (never faked), and the signers must then write
// what they verified.
export async function aiReviewPackage(pkg, lines, rules, ctxAll) {
  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) { return { ok: null, text: 'AI review unavailable — ANTHROPIC_API_KEY is not set. The rule checks above still ran.' }; }
  var others = [];
  var oc = ctxAll || {}; // packageContext(): sameRelease / sameNumber with dates + already-paid amounts
  ['sameRelease', 'sameNumber', 'sameOther'].forEach(function (key) { var m = oc[key] || {}; Object.keys(m).forEach(function (k) { m[k].forEach(function (o) {
    if (lines.some(function (l) { return l.bill_id === o.bill_id; })) { return; }
    others.push({ shares: key === 'sameRelease' ? 'release ' + k : key === 'sameOther' ? 'other reference ' + k : 'reference ' + k, vendor: o.vendor_name, bill_number: o.bill_number || null, bill_date: o.bill_date || null, total: o.total_amount == null ? null : o.total_amount, already_paid: o.paid_total || 0 });
  }); }); });
  var compact = { pay_to: pkg.payee_name, pay_to_kind: pkg.payee_kind, fee: Number(pkg.fee_amount) || 0, fee_note: pkg.fee_note || null, memo: pkg.memo || null,
    other_bills_sharing_a_release_or_reference: others.slice(0, 60),
    bills: lines.map(function (l) {
      var b = l.bill || {};
      return { vendor: b.vendor_name, bill_number: b.bill_number, direction: b.shipment_direction || null, bill_type: b.bill_type || null, other_reference: b.other_reference || null, release: b.release_number, bill_date: b.bill_date, due: b.due_date, total: b.total_amount,
        paying_now: l.amount, paid_before: l.other_payments, paid_via: b.paid_via || null, category: b.category, notes: String(b.notes || '').substring(0, 200), validation: b.validation_status };
    }), rule_results: rules.checks };
  var prompt = 'You are the first reviewer of an outgoing WIRE a trading company is ABOUT TO SEND. It goes either to RTM Capital (a service company that then pays the ' +
    'vendors listed and may charge a fee), to NextTrade Industries (a related company, bills only), or straight to a vendor. The company requires: no bill paid twice, ' +
    // v55.83-RX (Max, Nov 9 23:41: "this is not true unless it is for outbound!! otherwise inbound needs a reference and a billing number ... every outbound bill needs a release")
    'every bill has a bill number and a bill date; an OUTBOUND bill (direction "outbound") must have a release number; an INBOUND bill (direction "inbound") does NOT need a release — ' +
    'it needs its reference (other_reference) and its bill number instead (release = null on an inbound bill is NORMAL, never mention it); bills paid to NextTrade Industries do not need a release either; ' +
    'no bill was paid before, and NO DUPLICATES — a duplicate is the same vendor with the same release number AND the same bill date, or the same ' +
    'reference (bill number) AND the same date; the same release on a DIFFERENT date is a normal separate charge. other_bills_sharing_a_release_or_reference lists the other bills ' +
    'in the books that share a release or reference with these bills (with their dates and how much was already paid) — check each one against this rule and say clearly if any ' +
    'bill on this wire looks like a duplicate or was already paid. Automatic rule checks already ran (rule_results). Also look for ' +
    'anything ELSE a careful accountant would question before releasing the money: a fee that looks large against the bills, very old or future-dated bills, amounts that look ' +
    'like typos, the same document billed under two vendors, a release whose bills look inconsistent. Never invent facts that are not in the data. Reply in plain text: the ' +
    'FIRST line is exactly OK or CONCERNS, then at most 6 short lines, each one concern or confirmation.\n\nDATA:\n' + JSON.stringify(compact).substring(0, 24000);
  var models = ['claude-sonnet-4-6', 'claude-haiku-4-5']; var lastErr = null;
  for (var mi = 0; mi < models.length; mi++) {
    if (lastErr && lastErr.name === 'AbortError') { break; } // timed out once — do not spend another 20 s
    try {
      // v55.83-RJ (review gap 9) — 20 seconds at most, so a save never runs past the server's 60-second limit
      var ctl = new AbortController(); var tmr = setTimeout(function () { ctl.abort(); }, 20000);
      var resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: models[mi], max_tokens: 500, messages: [{ role: 'user', content: prompt }] }) });
      var aj = await resp.json(); clearTimeout(tmr);
      if (aj && aj.error) { throw new Error(aj.error.message || 'model error'); }
      var txt = ((aj && aj.content) || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('\n').trim();
      if (!txt) { throw new Error('empty answer'); }
      return { ok: txt.split('\n')[0].trim().toUpperCase().indexOf('OK') === 0, text: txt.substring(0, 2000) };
    } catch (e) { lastErr = e; }
  }
  return { ok: null, text: 'AI review unavailable — ' + ((lastErr && lastErr.message) || 'no answer') + '. The rule checks above still ran.' };
}
