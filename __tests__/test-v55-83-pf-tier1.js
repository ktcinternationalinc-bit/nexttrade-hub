// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PF — TIER 1: reminders · drift detector · email-in bills · warehouse hook
//
// Max (Nov 6): "if something's late... send an email automatically... or
// connected to WhatsApp... a quick button" · "eventually linked to an email
// where you check for any bills that come in and automatically put it into
// the system... make sure it's been human validated... the actual documents
// saved in that line item" · "the warehouse system... maybe build the
// underlying thing for now."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PF — tier 1');

var rr = R('src/app/api/accounting/reminders/route.js');
var ir = R('src/app/api/accounting/bills/inbound/route.js');
var br = R('src/app/api/accounting/bills/route.js');
var bh = R('src/components/BooksHomeTab.jsx');
var bt = R('src/components/BillsTab.jsx');
var sql = R('sql/v55-83-PF-tier1.sql');

// ── 1. FUNCTIONAL: reminder message composition (run the real function)
var names = [];
var src = rr;
var fnSrc = src.substring(src.indexOf('function composeMessage'), src.indexOf('async function loadLate'));
/* eslint-disable no-new-func */
var composeMessage = new Function('return (' + fnSrc.replace('function composeMessage', 'function') + ')')();
var en = composeMessage({ customer: 'ANAEL SARL', number: '1003-050', date: '2026-09-24', open: 66186.4, days: 43, tone: 'gentle', lang: 'en' });
var enF = composeMessage({ customer: 'ANAEL SARL', number: '1003-050', date: '2026-09-24', open: 66186.4, days: 43, tone: 'firm', lang: 'en' });
var ar = composeMessage({ customer: 'ANAEL SARL', number: '1003-050', date: '2026-09-24', open: 66186.4, days: 43, tone: 'gentle', lang: 'ar' });
ok('1a: EN gentle reminder carries invoice number, exact open amount, days late, and KTC signature',
  en.indexOf('1003-050') >= 0 && en.indexOf('$66,186.40') >= 0 && en.indexOf('43 days') >= 0 && en.indexOf('KTC International Enterprises LLC') >= 0);
ok('1b: firm tone escalates (5 business days) and differs from gentle',
  enF.indexOf('5 business days') >= 0 && enF !== en);
ok('1c: Arabic version is real Arabic with the same figures',
  ar.indexOf('الفاتورة') >= 0 && ar.indexOf('$66,186.40') >= 0);

// ── 2. Reminders route discipline
ok('2a: suggest behind ar.view_invoice_balances, send behind ar.send_reminders; key grantable in Settings',
  /action === 'send' \? 'ar\.send_reminders' : 'ar\.view_invoice_balances'/.test(rr) &&
  R('src/components/SettingsTab.jsx').indexOf("'ar.send_reminders'") >= 0);
ok('2b: canonical AR math (isArEligible + businessOfInvoice + wave_imported_paid), US + USD only',
  /isArEligible/.test(rr) && /businessOfInvoice/.test(rr) && /wave_imported_paid/.test(rr));
ok('2c: every reminder logged (channel, to, tone, exact body, sent_by); WhatsApp = wa.me handoff, never a fake "sent"',
  /invoice_reminders'\)\.insert\(\{ invoice_id: row\.invoice_id, channel: 'email'/.test(rr) &&
  /status: 'handoff'/.test(rr) && /wa\.me\//.test(rr) && /sent: false, channel: 'whatsapp'/.test(rr));
ok('2d: email goes through the hub\'s existing Resend setup and fails loud when unconfigured',
  /api\.resend\.com\/emails/.test(rr) && /RESEND_API_KEY/.test(rr) && /Email sending is not configured/.test(rr));
ok('2e: Books home has the Late customers panel with per-row Email/WhatsApp buttons, tone select, last-reminded marker',
  /⏰ Late customers \(30\+ days\)/.test(bh) && /✉ Email/.test(bh) && /🟢 WhatsApp/.test(bh) && /last_reminder/.test(bh));

// ── 3. Email-in bills: automated entry, NEVER auto-validated
ok('3a: endpoint refuses without a >=24-char shared token; constant-time-ish header check',
  /token\.length < 24/.test(ir) && /x-inbound-token/.test(ir));
ok('3b: every ingested bill enters as PENDING validation with the original document stored privately on the line item',
  /validation_status: 'pending'/.test(ir) && /bills-private'\)\.upload/.test(ir) && !/validation_status: 'validated'/.test(ir));
ok('3c (QH moved the guard into the shared radar lib): duplicate guard (same vendor + bill number active) skips and reports instead of double-entering',
  /billDupVerdict/.test(ir) && /verdict2\.skip\) \{ skipped\.push/.test(ir) &&
  /Duplicate of an existing active bill/.test(R('src/lib/bill-dup-server.js')));
ok('3d: reader flags and sender context land in the bill notes + audit event',
  /READER FLAGS/.test(ir) && /kind: 'email_ingested'/.test(ir) && /reader_flags: rd\.problems/.test(ir));
ok('3e: shared reading engine — one lib behind 📷 and the inbox',
  /bill-extract-server/.test(ir) && /bill-extract-server/.test(br));

// ── 4. Drift detector wired end to end
ok('4a: SQL detector compares posted bridge journals against CURRENT classification + map (read-only, service-only facade)',
  /classification_drift\(\)/.test(sql) && /m\.account_id <> l\.account_id/.test(sql) &&
  /grant execute on function public\.clickbooks_us_classification_drift_job\(\) to service_role/.test(sql));
ok('4b: Books home shows a red drift alarm when count > 0 and says fixing is a deliberate operator step',
  /Ledger drift/.test(bh) && /never automatic/.test(bh) && /drift_status/.test(br));

// ── 5. Warehouse hook (the future NextTrade link, underlying built now)
ok('5a: match_reference searches warehouse orders AND inv_shipments (real receiving ledger columns)',
  /action === 'match_reference'/.test(br) && /nexttrade_orders/.test(br) && /inv_shipments/.test(br) && /shipment_ref, status, supplier_name/.test(br));
ok('5b: validation panel has the Check-warehouse lookup and the result + reference land on the audit event',
  /🔎 Check warehouse/.test(bt) && /system_match: validating\.system_match/.test(bt) &&
  /warehouse_reference: vPatch\.warehouse_reference \|\| null, system_match: body\.system_match \|\| null/.test(br));

// ── 6. PG addendum — QA pass: Books home never hangs for staff without
// financial permissions; both panels degrade to a plain explanation.
ok('6 PG: cashflow + late panels degrade on permission denial instead of spinning forever',
  /denied: true, error: \(j && j\.error\)/.test(bh.replace(/[\n]/g, ' ')) ||
  (/cf && cf\.denied \?/.test(R('src/components/BooksHomeTab.jsx')) && /late\.denied \?/.test(R('src/components/BooksHomeTab.jsx'))));

console.log('');
console.log('PF: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
