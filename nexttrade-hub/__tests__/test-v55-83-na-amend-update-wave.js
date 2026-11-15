// v55.83-NA — Amend a pushed invoice and update it in Wave.
//
// Max (Aug 11 2026): "we created an invoice such as America 1714. I want to
// amend this invoice as there was a mistake. currently we cannot amend. I need
// to be able to amend then push it through again so it updates wave without
// affecting anything else."
//
// WHY IT WAS IMPOSSIBLE
// Reopen+edit already existed, but push-invoice-v2 hard-blocks any record with
// a wave_invoice_id ("Invoice already exists in Wave") — correctly, to prevent
// duplicates. And Wave's public API has NO invoiceUpdate mutation. The only
// amend path is: delete the old Wave copy, recreate from current Hub data.
//
// THE SHAPE OF THE FIX (and what this file protects):
//   /api/wave/replace-invoice does ONLY the delete + unlink half; the recreate
//   goes through the EXISTING push-invoice-v2. One source of truth for invoice
//   creation (Wave PERMANENT RULE), and a failed re-push leaves a truthful
//   pending_sync state — never two copies, never a phantom link.
//
// THE LINES THAT MUST NEVER MOVE:
//   - payments already in Wave block the replace (money is never auto-deleted)
//   - Wave-imported invoices are never deleted by the Hub
//   - the Hub unlinks IMMEDIATELY after a confirmed delete

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var route = read('src/app/api/wave/replace-invoice/route.js');
var tab   = read('src/components/AccountingInvoicesTab.jsx');
var push  = read('src/app/api/wave/push-invoice-v2/route.js');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — The route exists and does only its half of the job
// ══════════════════════════════════════════════════════════════════

ok('A1: replace route exists with the standard permission gate',
  /assertPermission\(db, by, 'wave\.invoices\.push', req\)/.test(route));
ok('A2: it requires the Wave copy to EXIST (inverse of the push guard)',
  /if \(!record\.wave_invoice_id\)[\s\S]{0,140}no Wave copy to replace/.test(route));
ok('A3: it performs invoiceDelete, and NEVER invoiceCreate',
  /invoiceDelete\(input:\$input\)/.test(route) && route.indexOf('invoiceCreate') === -1);
ok('A4: the recreate is delegated to push-invoice-v2 (single source of truth)',
  /push-invoice-v2/.test(route) && /duplicating all of that here/.test(route));
ok('A5: an explicit confirm_replace flag is required for the real run',
  /body\.confirm_replace !== true/.test(route));
ok('A6: dry-run is supported and does not touch Wave',
  /if \(dryRun\) \{[\s\S]{0,400}would_do/.test(route) &&
  route.indexOf('would_do') < route.indexOf('var delMut'));

// ══════════════════════════════════════════════════════════════════
// PART B — The safety gates (mirror of push, plus the replace-only ones)
// ══════════════════════════════════════════════════════════════════

ok('B1: production lock is enforced exactly like push',
  /production_push_unlocked === true/.test(route) &&
  /Production push is locked/.test(route));
ok('B2: writes_enabled and allow_invoice_push both required',
  /writes_enabled !== true/.test(route) && /allow_invoice_push !== true/.test(route));
ok('B3: cross-silo replace is refused',
  /record\.wave_business_id !== waveBusinessId/.test(route));
ok('B4: Wave-imported / historical invoices can NEVER be deleted by the Hub',
  /source === 'wave_import' \|\| record\.is_historical === true/.test(route) &&
  /will not delete a Wave-authored invoice/.test(route));
ok('B5: the amended invoice must be approved in the Hub first',
  /approval_status !== 'approved'[\s\S]{0,140}Approve the amended invoice/.test(route));
ok('B6: placeholder silos are named as the blocker',
  /isPlaceholderWaveBusiness\(waveBusinessId\)/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART C — PAYMENT GUARD (money line — must never be crossed)
// ══════════════════════════════════════════════════════════════════

ok('C1: payments already pushed to Wave are looked up before any delete',
  /accounting_invoice_payments[\s\S]{0,200}\.not\('wave_payment_id', 'is', null\)/.test(route));
ok('C2: any such payment BLOCKS the replace',
  /wavePays\.length > 0/.test(route) && /reason: 'wave_payments_exist'/.test(route));
ok('C3: the block happens BEFORE the Wave delete call',
  route.indexOf("wave_payments_exist") < route.indexOf('var delMut'));
ok('C4: the message says the Hub will never delete payments',
  /the Hub will never delete payments for you/.test(route));
ok('C5: each blocking payment is named (date + amount) so Max knows what to fix',
  /payment_date \|\| '\?'\) \+ ' for '/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART D — State transitions are truthful at every step
// ══════════════════════════════════════════════════════════════════

ok('D1: a failed Wave delete changes NOTHING (old copy + link both intact)',
  /nothing was changed; the Wave invoice and the Hub link are both intact/.test(route));
ok('D2: a confirmed delete IMMEDIATELY unlinks the Hub row',
  /update\(\{ wave_invoice_id: null, wave_status: null, wave_sync_status: 'pending_sync' \}\)/.test(route));
ok('D3: the unlink is guarded against a concurrent relink',
  /\.eq\('wave_invoice_id', oldWaveId\)/.test(route));
ok('D4: delete-succeeded-but-unlink-failed is reported as its own loud state',
  /Do NOT create the invoice manually in Wave/.test(route));
ok('D5: Wave\'s real refusal reason is surfaced (errors[] + inputErrors[])',
  /inputErrors\.length/.test(route) && /_parts\.join\(' \| '\)/.test(route));
ok('D6: every path writes to wave_sync_log with action replace_delete',
  (route.match(/action: 'replace_delete'/g) || []).length >= 4);
ok('D7: log rows carry the invoice number + amount context (MT convention)',
  /invLogCtx = \{ invoice_number: inv\.invoice_number/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART E — The UI flow (approve → replace → re-push, in that order)
// ══════════════════════════════════════════════════════════════════

ok('E1: an updateInWave handler exists in the Accounting invoices tab',
  /function updateInWave\(row\)/.test(tab));
ok('E2: step order is approve, then replace, then push',
  (function () {
    var h = tab.slice(tab.indexOf('function updateInWave'), tab.indexOf('function reopenInvoice'));
    var a = h.indexOf("action: 'set_approval'");
    var r = h.indexOf('/api/wave/replace-invoice');
    var p2 = h.indexOf('/api/wave/push-invoice-v2');
    return a > -1 && r > a && p2 > r;
  })());
ok('E3: the user is told the Wave copy will be DELETED before anything runs',
  /old Wave copy will be DELETED/.test(tab) && /window\.confirm/.test(tab));
ok('E4: replace failure STOPS the chain (no push after a refused delete)',
  /rj\.ok !== true[\s\S]{0,160}throw new Error/.test(tab));
ok('E5: re-push failure names the recovery path (Pending Sync)',
  /the invoice is in Pending Sync; push it from the Sync Center/.test(tab));
ok('E6: DRAFT-stuck and currency-mismatch results are read like the Sync Center does',
  /draftStuck/.test(tab) && /currencyBad/.test(tab) &&
  /never[\s\S]{0,30}treat a bare wave_invoice_id as success/i.test(tab));
ok('E7: the button only shows for a synced-then-reopened Hub invoice',
  /canUpdateWave: isInv && \(mayApprove \|\| isSuperAdmin\)[\s\S]{0,300}wave_sync_status === 'pending_sync'/.test(tab));
ok('E8: Wave-imported rows never get the button',
  /row\.source !== 'wave_import'/.test(tab));
ok('E9: the button exists in both the row and the viewing modal',
  (tab.match(/🔁 Update in Wave/g) || []).length === 2);
ok('E10: the action is written to the activity log',
  /Updated invoice[\s\S]{0,60}in Wave \(delete \+ recreate\)/.test(tab));

// ══════════════════════════════════════════════════════════════════
// PART F — The push guard we rely on is still standing
// ══════════════════════════════════════════════════════════════════

ok('F1: push-invoice-v2 still refuses records that HAVE a wave_invoice_id',
  /if \(record\.wave_invoice_id\)[\s\S]{0,120}already exists in Wave/.test(push));
ok('F2: replace route is SWC-safe (no template literals in the route)',
  route.indexOf('`') === -1);
ok('F3: replace route uses var, not let/const, in function bodies',
  !/\n\s+(let|const) /.test(route.split('export async function POST')[1]));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NA amend + update in Wave');
}
