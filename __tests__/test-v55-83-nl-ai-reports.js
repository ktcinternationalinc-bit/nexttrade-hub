// v55.83-NL — AI Reports: tool-based data Q&A.
//
// Max (Sep 7 2026): "list all of the opened shipments or invoices created in
// the last months or 3 months or custom period.. list me all of the
// outstanding balances for each and or list also the payments for each.. a
// summary for a customer.. it must be able to create the report for me and/or
// actually answer specific questions.. IT NEEDS PERMISSIONING."
//
// THE TWO INVARIANTS THAT MUST NEVER SLIP
//   1. Numbers come from the database, not the model. Totals are computed
//      server-side over the COMPLETE filtered set (paginated reads) — the old
//      /api/ask context-dump caps at 500 invoices and lets the model do
//      arithmetic; this engine exists precisely because that is disqualifying
//      for money questions.
//   2. Permission mirroring is server-side per tool, and a denial is returned
//      AS the tool result so the model says "you need permission X" instead of
//      pretending the data is empty.

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var route = read('src/app/api/ai/reports/route.js');
var ui    = read('src/components/AIAssistant.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Numbers from the database, complete sets
// ══════════════════════════════════════════════════════════════════

ok('A1: fetchAll paginates the FULL filtered set (no 500-row context dump)',
  /function fetchAll\(buildQ\)/.test(route) && /\.range\(from, from \+ PAGE - 1\)/.test(route) &&
  /if \(rows\.length < PAGE\) \{ break; \}/.test(route));
ok('A2: a hard safety cap exists and is generous (20k rows)',
  /MAX_ROWS = 20000/.test(route));
ok('A3: invoice totals (amount/collected/outstanding) summed server-side',
  /tA \+= Number\(r\.total_amount \|\| 0\); tC \+= Number\(r\.total_collected \|\| 0\); tO \+= Number\(r\.outstanding \|\| 0\);/.test(route));
ok('A4: the system prompt forbids the model doing its own arithmetic',
  /never from memory, never computed by you across rows; use the totals fields/.test(route));
ok('A5: display rows may be sliced but the tool result SAYS so, and totals cover all rows',
  /rows_truncated_for_display/.test(route) &&
  /totals cover ALL rows/.test(ui));
ok('A6: every tool result carries a human-readable source line and the route returns sources[]',
  /source: 'invoices'/.test(route) && /sources\.push\(out\.source\)/.test(route));
ok('A7: empty results must be reported as empty, not invented',
  /If a result is empty, say so/.test(route));
ok('A8: relative periods are resolved against today\'s real date',
  /Today is ' \+ todayStr/.test(route) && /last 3 months/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART B — Max's question types are all covered
// ══════════════════════════════════════════════════════════════════

ok('B1: invoices by period/state/customer with outstanding balances',
  /name: 'list_invoices'/.test(route) && /state === 'open'/.test(route) &&
  /Number\(r\.outstanding \|\| 0\) > 0\.009/.test(route));
ok('B2: payments listing (treasury cash-in) by period/customer/order',
  /name: 'list_payments'/.test(route) && /\.gt\('cash_in', 0\)/.test(route));
ok('B3: customer statement: invoices + payments + checks + totals in one tool',
  /name: 'customer_statement'/.test(route) && /outstanding_balance: r2\(sO\)/.test(route) &&
  /pending_checks: r2\(pend\)/.test(route));
ok('B4: checks and shipments are queryable',
  /name: 'list_checks'/.test(route) && /name: 'list_shipments'/.test(route) &&
  /from\('shipments'\)/.test(route));
ok('B5: Arabic and English both handled, answer follows the asker\'s language',
  /English or Arabic/.test(route) && /answer in the language they asked in/.test(route));
ok('B6: customer name matching covers Arabic and English name columns',
  /customer_name\.ilike\.%.*customer_name_en\.ilike\.%/.test(route));
ok('B7: follow-up questions work (conversation history passes through)',
  /history\.slice\(-10\)/.test(route) || /body\.history/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART C — Permissioning (Max: "it needs permissioning")
// ══════════════════════════════════════════════════════════════════

ok('C1: every tool has a permission key and it is asserted server-side per call',
  /TOOL_PERMISSION = \{/.test(route) &&
  /assertPermission\(db, userId, permKey, req\)/.test(route));
ok('C2: balance-bearing tools require AR balance permissions',
  /list_invoices: 'ar\.view_invoice_balances'/.test(route) &&
  /customer_statement: 'ar\.view_customer_balances'/.test(route) &&
  /list_payments: 'ar\.view_customer_balances'/.test(route));
ok('C3: a denial is returned AS the tool result with instructions to say so plainly',
  /permission_denied: true, needed: permKey/.test(route) &&
  /do NOT guess any figures/.test(route));
ok('C4: the model is instructed to stop on denial, not work around it',
  /tell the user which permission is missing and stop/.test(route));
ok('C5: the route requires the asking user\'s id (no anonymous data questions)',
  /if \(!userId\) \{ return NextResponse\.json\(\{ error: 'user_id required' \}/.test(route));

// ══════════════════════════════════════════════════════════════════
// PART D — The engine and UI plumbing
// ══════════════════════════════════════════════════════════════════

ok('D1: agentic loop with a round cap and honest overflow message',
  /MAX_ROUNDS = 4/.test(route) && /safety limit on data lookups/.test(route));
ok('D2: model fallback sonnet -> haiku',
  /\['claude-sonnet-4-6', 'claude-haiku-4-5'\]/.test(route));
ok('D3: the route is read-only',
  route.indexOf('.insert(') === -1 && route.indexOf('.update(') === -1 && route.indexOf('.delete(') === -1);
ok('D4: UI has a Chat / Reports mode toggle and reports mode calls the new engine',
  /aiMode, setAiMode/.test(ui) && /aiMode === 'reports'/.test(ui) &&
  /fetch\('\/api\/ai\/reports'/.test(ui));
ok('D5: history roles are mapped for the API (ai -> assistant)',
  /m\.role === 'ai' \? 'assistant' : 'user'/.test(ui));
ok('D6: tables render with per-table CSV download (BOM for Arabic Excel)',
  ui.indexOf("'\\ufeff' + lines.join") > -1 && /⬇ CSV/.test(ui));
ok('D7: database-computed totals shown under each table',
  /Totals \(database-computed, full set\)/.test(ui));
ok('D8: the source line is shown to the user under the answer',
  /Source: \{m\.sources\.join/.test(ui));
ok('D9: the model must not re-type tables into its text answer',
  /do NOT reproduce whole tables in text/.test(route));

console.log('');
if (failures.length) {
  console.log('FAILED (' + failures.length + '):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED — v55.83-NL AI reports engine');
}

// ══════════════════════════════════════════════════════════════════
// v55.83-NR ADDENDUM — no-toggle auto-routing (Max: "waiting for this").
// Data-sounding questions reach the Reports engine even in Chat mode; the
// toggle flips visibly so the user always sees which engine answered.
// ══════════════════════════════════════════════════════════════════
(function () {
  var fsr = require('fs'); var pr = require('path');
  var ui2 = fsr.readFileSync(pr.join(__dirname, '..', 'src/components/AIAssistant.jsx'), 'utf8');
  var f = [];
  function okR(l, c) { if (c) console.log('✓ ' + l); else { f.push(l); console.log('✗ ' + l); } }

  okR('NR1: data-question detector covers English AND Arabic money terms',
    /invoice\|payment\|balance/.test(ui2) && /فاتورة/.test(ui2) && /رصيد/.test(ui2) && /شيك/.test(ui2));
  okR('NR2: detection routes to the Reports engine regardless of the active mode',
    /var routeReports = aiMode === 'reports' \|\| DATA_RX\.test\(question\);/.test(ui2) &&
    /if \(routeReports\) \{/.test(ui2));
  okR('NR3: the toggle flips visibly when auto-routed (no silent engine switch)',
    /if \(routeReports && aiMode !== 'reports'\) \{ setAiMode\('reports'\); \}/.test(ui2));
  okR('NR4: Chat mode remains for everything else (the /api/ask path still exists)',
    /fetch\('\/api\/ask'/.test(ui2));

  if (f.length) { console.log('NR FAILED: ' + f.join(' | ')); process.exit(1); }
  else { console.log('ALL NR ADDENDUM CHECKS PASSED'); }
})();
