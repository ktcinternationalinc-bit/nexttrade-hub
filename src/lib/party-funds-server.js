// v55.83-VY — the records the shared funds calculation (party-funds.js) needs, read from the database in ONE place so the
// reading itself can be run in a test (Codex 13:37: "Execute the route with a mocked DB for these cases").
// Read-only: select only. var + concat (it is used by an API route).
//
// WHICH WIRE PACKAGES COUNT (Codex 13:37): a package belongs to a company's transfer either because the transfer FUNDS it
// (funding_txn_id — a funded request) or because the package is ATTACHED to that bank line (bank_transaction_id with
// funding_txn_id empty — an ordinary wire: the supported older case). Both are fetched, a package returned by both is taken
// once, and:
//   • attached  → its fee is an explicit service fee on that transfer (funding id, else the attached bank line)
//   • not sent yet and FUNDED → it reserves money on the funding transfer (the helper's own rule)
//   • not sent yet and NOT funded (an ordinary wire being prepared) → nothing: it reserves no held funds
import { partyFundsBreakdown, FUNDING_DESTINATIONS, fundingIdentity } from './party-funds';

// o: { fetchAll(buildQuery) → rows, businessId, parties, pays, bills (by id), entries, from, to }
// Returns { funds: partyFundsBreakdown(...) result, lines: the company bank lines found, requests: what was handed to the helper }.
export async function loadPartyFunds(db, o) {
  var fetchAll = o.fetchAll; var biz = o.businessId;
  var sel = 'id, date, posted_date, amount_abs, classification, third_party_payer, name, merchant_name, direction, transfer_group_id';
  var marked = await fetchAll(function () { return db.from('bank_transactions').select(sel).eq('wave_business_id', biz).eq('direction', 'out').not('third_party_payer', 'is', null).neq('pending', true).neq('review_status', 'duplicate').order('id', { ascending: true }); });
  var destOr = FUNDING_DESTINATIONS.map(function (d) { return 'name.ilike.%' + d.suffix + '%,merchant_name.ilike.%' + d.suffix + '%'; }).join(',');
  var byText = await fetchAll(function () { return db.from('bank_transactions').select(sel).eq('wave_business_id', biz).eq('direction', 'out').is('third_party_payer', null).neq('pending', true).neq('review_status', 'duplicate').or(destOr).order('id', { ascending: true }); });
  var lines = []; var seen = {};
  (marked || []).concat(byText || []).forEach(function (t) {
    if (seen[t.id]) { return; }
    if (!t.third_party_payer && t.transfer_group_id) { return; } // a paired transfer between KTC's own accounts is never money sent to a company
    var line = { id: t.id, date: t.posted_date || t.date, amount_abs: t.amount_abs, third_party_payer: t.third_party_payer, name: (t.name || '') + (t.merchant_name && t.merchant_name !== t.name ? ' ' + t.merchant_name : ''), direction: 'out', classification: t.classification };
    if (!fundingIdentity(line)) { return; } // the text query is wide (any "9909"); only the shared identity rule decides
    seen[t.id] = true; lines.push(line);
  });
  var ids = lines.map(function (x) { return x.id; }); var isLine = {}; ids.forEach(function (id) { isLine[id] = true; });
  var pkById = {};
  for (var i = 0; i < ids.length; i += 200) {
    var part = ids.slice(i, i + 200);
    var a = await db.from('wire_packages').select('*').in('funding_txn_id', part);
    if (!a.error) { (a.data || []).forEach(function (w) { pkById[w.id] = w; }); }
    var b = await db.from('wire_packages').select('*').in('bank_transaction_id', part);
    if (!b.error) { (b.data || []).forEach(function (w) { pkById[w.id] = w; }); }
  }
  var pkIds = Object.keys(pkById); var pkLines = [];
  for (var j = 0; j < pkIds.length; j += 200) {
    var l = await db.from('wire_package_lines').select('package_id, bill_id, amount, is_open').in('package_id', pkIds.slice(j, j + 200));
    if (!l.error) { pkLines = pkLines.concat(l.data || []); }
  }
  var requests = [];
  pkIds.forEach(function (id) {
    var w = pkById[id]; var funded = w.funding_txn_id && isLine[w.funding_txn_id] ? w.funding_txn_id : null;
    var attachedTo = w.bank_transaction_id && isLine[w.bank_transaction_id] ? w.bank_transaction_id : null;
    var source = funded || (w.status === 'attached' ? attachedTo : null);
    if (!source) { return; } // an ordinary wire that is not sent yet reserves nothing; a package of another line is not ours
    requests.push({ id: w.id, status: w.status, funding_txn_id: source, fee_amount: w.fee_amount, sent_date: w.sent_date || w.sent_at || w.attached_at || null, lines: pkLines.filter(function (x) { return String(x.package_id) === String(w.id); }) });
  });
  var funds = partyFundsBreakdown({ parties: o.parties, bankLines: lines, pays: o.pays || [], bills: o.bills || {}, requests: requests, entries: o.entries || [], from: o.from, to: o.to });
  return { funds: funds, lines: lines, requests: requests };
}
