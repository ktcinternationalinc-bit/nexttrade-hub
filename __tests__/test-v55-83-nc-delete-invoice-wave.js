// v55.83-NC — Delete an invoice from Accounting AND from Wave.
//
// Max (Aug 11 2026): "Can we actually delete an invoice from the accounting
// side that will then delete from wave"
//
// Before: record-lifecycle blocks hard delete for any invoice with a
// wave_invoice_id — correct, because a Hub-only delete would orphan a live
// Wave invoice billing a customer. That blocker STAYS. The new path deletes
// the Wave copy FIRST, then the Hub record.
//
// THE ORDERING INVARIANT THIS FILE PROTECTS
// Wave first, Hub second. If Wave refuses, NOTHING is deleted anywhere. The
// worst crash outcome is a Hub invoice with no Wave copy (finishable with the
// normal Delete) — never a live Wave invoice with no Hub owner.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var route = read('src/app/api/wave/delete-invoice/route.js');
var tab   = read('src/components/AccountingInvoicesTab.jsx');
var lc    = read('src/lib/record-lifecycle.js');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Ordering: Wave first, Hub second, refusal stops everything
// ══════════════════════════════════════════════════════════════════

// v55.83-UM realign (Codex 21:35): the Hub part now runs in the locked database step AFTER the Wave delete
ok('A1: the Wave invoiceDelete happens BEFORE any Hub deletion',
  route.indexOf('invoiceDelete(input:$input)') > -1 &&
  route.indexOf('invoiceDelete(input:$input)') < route.lastIndexOf("after_wave_delete: true } })") && // the real Hub step (last call)
  route.indexOf('check_only: true } })') < route.indexOf('invoiceDelete(input:$input)')); // the change-nothing check comes BEFORE Wave
ok('A2: a Wave refusal returns with nothing deleted anywhere',
  /nothing was deleted anywhere/.test(route));
ok('A3: after a confirmed Wave delete the Hub row is unlinked IMMEDIATELY',
  /update\(\{ wave_invoice_id: null, wave_status: null, wave_sync_status: null \}\)[\s\S]{0,120}\.eq\('wave_invoice_id', oldWaveId\)/.test(route));
ok('A4: the ordering rationale is written into the route',
  /If it ran the other way/.test(route) && /orphan/.test(route));
// v55.83-UM realign: payments are NEVER deleted; items + invoice go in ONE locked database step (all or nothing)
ok('A5: the Hub part is one locked step (items + invoice), payments never deleted',
  route.indexOf(".from('accounting_invoice_payments').delete()") < 0 &&
  route.indexOf(".from('accounting_invoices').delete()") < 0 &&
  /db\.rpc\('hub_invoice_lifecycle', \{ p: \{ kind: 'invoice', action: 'delete', id: hubId, actor: by, is_super: _ctxD\.isSuperAdmin === true, after_wave_delete: true \} \}\)/.test(route));
ok('A6: a Hub-delete failure after a Wave delete names the exact partial state',
  /Its Wave copy WAS already deleted/.test(route) && /void or archive it there/.test(route) /* v55.83-UM realign (Codex 21:50): truthful recovery words */);
ok('A7: an invoice with NO Wave copy skips Wave and just cascades in the Hub',
  /if \(oldWaveId\) \{/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART B — Money and authorship guards
// ══════════════════════════════════════════════════════════════════

ok('B1: payments pushed to Wave hard-block the delete',
  /\.not\('wave_payment_id', 'is', null\)/.test(route) &&
  /reason: 'wave_payments_exist'/.test(route));
ok('B2: the block happens before ANY delete call (Wave or Hub)',
  route.indexOf("wave_payments_exist") < route.indexOf('invoiceDelete(input:$input)'));
ok('B3: the Hub never deletes payments in Wave — stated in the message',
  /the Hub will never delete payments for you/.test(route));
// v55.83-UM realign (Max: never delete data): Hub payment records block the delete — no acknowledgement path any more
ok('B4: Hub payment records block the delete before anything is sent to Wave (void or archive instead)',
  route.indexOf('acknowledge_hub_payments') < 0 &&
  /reason: 'hub_payments_block'/.test(route) &&
  route.indexOf("reason: 'hub_payments_block'") < route.indexOf('invoiceDelete(input:$input)'));
ok('B5: Wave-imported / historical invoices are refused',
  /source === 'wave_import' \|\| inv\.is_historical === true/.test(route) &&
  /Delete it inside Wave itself/.test(route));
ok('B6: confirm_delete:true is required for the destructive run',
  /body\.confirm_delete !== true/.test(route));
ok('B7: full registry gate ladder applies (writes, push flag, production locks, silo)',
  /writes_enabled !== true/.test(route) && /allow_invoice_push !== true/.test(route) &&
  /production_push_unlocked/.test(route) && /different silo/.test(route));
ok('B8: standard permission gate on the route',
  /assertPermission\(db, by, 'wave\.invoices\.push', req\)/.test(route));
ok('B9: every outcome is logged to wave_sync_log with action delete',
  (route.match(/action: 'delete'/g) || []).length >= 5);

// ══════════════════════════════════════════════════════════════════
// PART C — The UI path
// ══════════════════════════════════════════════════════════════════

ok('C1: a deleteWithWave handler exists',
  /function deleteWithWave\(row, ackHubPayments\)/.test(tab));
ok('C2: it warns the delete is permanent and Wave-first before running',
  /PERMANENTLY delete invoice/.test(tab) && /Wave copy will be deleted FIRST/.test(tab));
// v55.83-UM realign: no "delete the payments too?" question — payments are never deleted
ok('C3: no payment-deletion acknowledgement on screen',
  tab.indexOf('hub_payments_need_ack') < 0 && tab.indexOf('deleteWithWave(row, true)') < 0);
ok('C4: nothing is changed on screen before the server answers (no early bank-match release)',
  tab.substring(tab.indexOf('function deleteWithWave'), tab.indexOf('function deleteWithWave') + 2500).indexOf('releaseBankMatches(') < 0);
ok('C5: the button appears exactly where the old blocker message sat',
  /!lc\.canHardDelete && isInvoice\(\) && !!editing\.wave_invoice_id/.test(tab));
ok('C6: Wave-imported rows never get the button',
  /editing\.source !== 'wave_import'/.test(tab));
// v55.83-UM realign: the Wave delete uses the invoice-delete rule (super admin / Accounting Manager role / the 🔒 switch), not approver roles
ok('C7: only people allowed to delete invoices (UM rule)',
  /editing\.source !== 'wave_import' && mayLifecycle &&/.test(tab) && /if \(!mayLifecycle\) \{ toast\.error\(INVOICE_DELETE_DENIED\)/.test(tab));
ok('C8: the deletion is written to the activity log',
  /'Deleted invoice ' \+ \(row\.invoice_number \|\| row\.id\)/.test(tab));
// v55.83-UM realign: the success message says where it was deleted and how many bank lines went back to review (payments never deleted)
ok('C9: success toast reports what was actually removed (Wave? bank lines back to review?)',
  /deleted_in_wave \? ' from Wave and the Hub' : ' from the Hub'/.test(tab) &&
  /released_bank_lines/.test(tab));

// ══════════════════════════════════════════════════════════════════
// PART D — The old safety blocker still stands
// ══════════════════════════════════════════════════════════════════

ok('D1: record-lifecycle STILL blocks plain hard delete for Wave-linked invoices',
  /canHardDelete: roleOk && !syncedToWave && !historical && !hasPayments && !archived && !voided/.test(lc));
ok('D2: route is SWC-safe (no template literals)',
  route.indexOf('`') === -1);
ok('D3: route uses var only in the handler body',
  !/\n\s+(let|const) /.test(route.split('export async function POST')[1]));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NC delete invoice incl. Wave');
}
