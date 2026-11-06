// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PE — BILLS REGISTER: validation with teeth, disputes with tickets,
// due-through-any-date answers, append-only audit trail, private documents.
//
// Max (Nov 6, verbatim priorities): "a dedicated validation section showing
// whether the bill has been verified, who verified it, when, and exactly how
// ... every validation must have supporting documentation. These records will
// be audited ... every disputed bill must have a ticket ... If I ask how much
// we owe on bills due through September 15 or September 30, I should
// immediately receive a complete and accurate list ... broken down by vendor,
// with the total ... without double-counting ... agent friendly."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PE — bills register');

var br = R('src/app/api/accounting/bills/route.js');
var bt = R('src/components/BillsTab.jsx');
var sql = R('sql/v55-83-PE-bills-register.sql');
var ai = R('src/app/api/ai/reports/route.js');

// ── 1. Validation has teeth
ok('1a: validation REFUSED unless all three checks are explicitly true (matches records, goods received, charges accurate)',
  /ck\.matches_records !== true \|\| ck\.goods_received !== true \|\| ck\.charges_accurate !== true/.test(br) &&
  /Validation is not a formality/.test(br));
ok('1b: validation requires a real how-I-verified note (min length) and records who/when on the bill',
  /vNotes\.length < 10/.test(br) && /validated_by: userId, validated_at:/.test(br));
ok('1c: every validation and reopen lands on the append-only audit trail with details',
  /kind: 'validated', actor_id: userId/.test(br) && /kind: 'validation_reopened'/.test(br));
ok('1d: audit trail is append-only in the database — authenticated can only SELECT, service only SELECT+INSERT, nobody UPDATE/DELETE',
  /GRANT SELECT ON public\.vendor_bill_events TO authenticated/.test(sql) &&
  /GRANT SELECT, INSERT ON public\.vendor_bill_events TO service_role/.test(sql) &&
  !/UPDATE ON public\.vendor_bill_events/.test(sql) && !/DELETE ON public\.vendor_bill_events/.test(sql));
ok('1e: UI shows a Validation column (✓ VALIDATED with who/when on hover, PENDING otherwise) and the three mandatory checkboxes',
  /✓ VALIDATED/.test(bt) && /PENDING/.test(bt) && /goods or services were actually received/.test(bt) &&
  /charges are accurate and legitimate/.test(bt));

// ── 2. Disputes: no ticket, no dispute
ok('2a: disputing requires a real reason and CREATES a High hub ticket with follow-up date',
  /dReason\.length < 10/.test(br) && /'BILL-' \+ new Date\(\)/.test(br) &&
  /priority: 'high', status: 'New'/.test(br) && /Follow-up due: /.test(br));
ok('2b: disputed bills leave payable totals everywhere (totals, cashflow, forecast, due-through) via one isPayable rule',
  /function isPayable\(b\) \{ return b\.record_status === 'active' && b\.disputed !== true/.test(br) &&
  (br.match(/isPayable/g) || []).length >= 5);
ok('2c: resolving requires a written resolution, reopens payability, closes the ticket, and logs the trail',
  /resNote\.length < 10/.test(br) && /kind: 'dispute_resolved'/.test(br) && /status: 'Resolved'/.test(br));
ok('2d: UI: Dispute button with reason+follow-up, DISPUTED chip, disputed filter, Resolve flow',
  /Dispute \+ ticket/.test(bt) && /DISPUTED: \['#ede9fe', '#5b21b6'\]/.test(bt) && /'disputed', 'void', 'all'/.test(bt));

// ── 3. "What do we owe through <date>" — instant, complete, no double-counting
ok('3a: due_through returns total, per-vendor breakdown, per-bill rows with validation status, and the disputed list separately',
  /action === 'due_through'/.test(br) && /by_vendor: Object\.values\(byVendor\)/.test(br) &&
  /validated_open: validatedOpen, pending_validation_open: pendingOpen/.test(br) && /disputed_excluded:/.test(br));
ok('3b: cumulative by construction — one filtered set (due_date <= through), each bill counted once, open = amount − non-void payments',
  /\(b\.due_date \|\| b\.bill_date\) <= thru/.test(br));
ok('3c: UI answer bar: pick a date → total + validated/pending split + by-vendor + CSV',
  /What do we owe through…/.test(bt) && /TOTAL through \{dueThru\.through\}/.test(bt) && /bills-due-through-/.test(bt));

// ── 4. Agent friendly: Nadia can answer it
ok('4: bills_due_through tool registered in the AI assistant with executor (disputed excluded, totals in DB terms)',
  /name: 'bills_due_through'/.test(ai) && /if \(name === 'bills_due_through'\)/.test(ai) &&
  /disputed_excluded_from_total/.test(ai));

// ── 5. Private documents (QA critical #2)
ok('5a: new bill files upload to the PRIVATE bills-private bucket, never the public one',
  /storage\.from\('bills-private'\)\.upload/.test(bt) && !/storage\.from\('attachments'\)\.upload/.test(bt));
ok('5b: files open through 1-hour signed URLs; legacy public paths still work',
  /createSignedUrl\(path, 3600\)/.test(bt) && /getPublicUrl\(path\)/.test(bt));
ok('5c: SQL creates the private bucket (public=false) with authenticated-only read/write policies',
  /VALUES \('bills-private','bills-private', false\)/.test(sql) && /bucket_id = 'bills-private'/.test(sql));

// ── 6. Register columns and gates
ok('6a: PE SQL adds validation + dispute columns additively (IF NOT EXISTS only)',
  /ADD COLUMN IF NOT EXISTS validation_status/.test(sql) && /ADD COLUMN IF NOT EXISTS dispute_ticket_id/.test(sql) &&
  !/DROP TABLE|DROP COLUMN/i.test(sql));
ok('6b: all new write actions behind bills.manage',
  /validate_bill: 1, reopen_validation: 1, dispute_bill: 1, resolve_dispute: 1/.test(br));
ok('6c: DISPUTED status overrides payment label on decorated bills',
  /if \(b\.disputed === true && st !== 'VOID'\) \{ st = 'DISPUTED'; \}/.test(br));

console.log('');
console.log('PE: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
