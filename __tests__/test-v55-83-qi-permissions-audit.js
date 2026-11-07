// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QI — Max's permission spec (Nov 7 12:33–12:39) + the email scanner
// (12:34):
//  "accounting view is the USA side to see — if not permissioned does not
//   even show up"; one permission that blocks top-card totals TOTALLY;
//  another that blocks totals but lets you click a card and see underneath;
//  "should be audit of whoever changes or matches or creates or validates
//   etc.. separate audit record also permissioning"; connecting banks its
//  own permission (QB); "permissioning to see filters beyond just the
//  default or update the filters of time besides the default";
//  "filter to any emails looking for key words then download the attached
//   bill and update to the hub".
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QI — permission tiers + audit trail + email scanner');

var pg = R('src/app/page.jsx');
ok('1: no accounting grant → the Accounting entry does NOT even show in the sidebar (driven by the accounting OR-list, not the generic Bank module)',
  /if \(t\.id === 'accounting'\) \{\n        return modulePerms\['accounting\.view'\] === true/.test(pg) &&
  /modulePerms\['accounting\.company_profile\.view'\] === true;\n      \}/.test(pg));

var bills = R('src/app/api/accounting/bills/route.js');
ok('2a: THREE visibility tiers resolved once server-side — canTotals (see numbers), canRows (••• but rows), canDates (move the time filters); super admin passes all',
  /var canTotals = !!visT\.ok;/.test(bills) && /'accounting\.view_underlying', req\)/.test(bills) &&
  /'accounting\.change_dates', req\)/.test(bills));
ok('2b: period_stats, cashflow AND forecast are MASKED server-side when totals are not granted — numbers become null (rendered •••), row arrays survive only with the underlying grant',
  /if \(!canTotals\) \{ psPayload = maskVis\(psPayload, false\); \}/.test(bills) &&
  /if \(!canTotals\) \{ cfPayload = maskVis\(cfPayload, false\); \}/.test(bills) &&
  /if \(!canTotals\) \{ fcPayload = maskVis\(fcPayload, false\); \}/.test(bills) &&
  /if \(!inRows && !canRows\) \{ return \[\]; \}/.test(bills));
ok('2c: the protected bank-balance grant is UNTOUCHED by the tier system (balance decided by its own gate, attached after masking)',
  /fcPayload\.bank_balance = balF; \/\/ its own PROTECTED grant decided this above/.test(bills));
ok('2d: date clamps server-side without accounting.change_dates — period_stats/cashflow floor 2026-06-01, All Transactions floor 2026-01-01, all capped at today, flagged date_filters_locked',
  /if \(pFrom < '2026-06-01'\) \{ pFrom = '2026-06-01'; pLocked = true; \}/.test(bills) &&
  /if \(fromD < '2026-06-01'\) \{ fromD = '2026-06-01'; cfLocked = true; \}/.test(bills) &&
  /if \(fA < '2026-01-01'\) \{ fA = '2026-01-01'; atLocked = true; \}/.test(R('src/app/api/accounting/expense-rules/route.js')));
ok('2e: the client SAYS when it is masked/locked instead of showing zeros — fmt(null) renders ••• in Stats, Books and Forecast; banners explain which permission unlocks; tax pack refuses when masked',
  /return '•••'/.test(R('src/components/PeriodStatsTab.jsx')) &&
  /return '•••'/.test(R('src/components/BooksHomeTab.jsx')) &&
  /return '•••'/.test(R('src/components/CashForecastTab.jsx')) &&
  /Accounting: See Money Totals" permission — totals are hidden/.test(R('src/components/PeriodStatsTab.jsx')) &&
  /You CAN still click any card and work with the underlying rows\./.test(R('src/components/BooksHomeTab.jsx')));

var sqlQ = R('sql/v55-83-QI-audit-log.sql');
ok('3a: the audit table is APPEND-ONLY by construction — insert policy only, no update/delete policy anywhere in the SQL',
  /CREATE TABLE IF NOT EXISTS hub_audit_log/.test(sqlQ) && /FOR INSERT TO authenticated/.test(sqlQ) &&
  !/FOR UPDATE/.test(sqlQ) && !/FOR DELETE/.test(sqlQ));
ok('3b: every money-touching server action writes an audit row (fail-soft) — classify, match, split, reverse, bulk, verify, pair/unpair, bill create/update/payment/validate, RTM + advance flags, file import, statement import',
  /'bank_classify'/.test(R('src/app/api/accounting/bank-write/route.js')) &&
  /'deposit_matched_to_invoice'/.test(R('src/app/api/accounting/bank-write/route.js')) &&
  /'match_reversed'/.test(R('src/app/api/accounting/bank-write/route.js')) &&
  /'bulk_categorized'/.test(R('src/app/api/accounting/expense-rules/route.js')) &&
  /'transfer_paired'/.test(R('src/app/api/accounting/expense-rules/route.js')) &&
  /'bill_payment_recorded'/.test(bills) && /'bill_validated'/.test(bills) &&
  /'rtm_payment_flagged'/.test(bills) && /'advance_flagged'/.test(bills) &&
  /'statement_rows_imported'/.test(R('src/app/api/accounting/statement-import/route.js')) &&
  /fail-soft by design/.test(R('src/lib/audit-server.js')));
ok('3c: the 🧾 Audit Trail tab — own permission audit.view, merges the hub log with the bill event trail, resolves names, searchable; read-only (the route has NO write action)',
  /'audit\.view', req\)/.test(R('src/app/api/accounting/audit/route.js')) &&
  /source: 'bill_events'/.test(R('src/app/api/accounting/audit/route.js')) &&
  !/\.insert\(|\.update\(|\.delete\(/.test(R('src/app/api/accounting/audit/route.js').split('// resolve actor names')[0].split("if (body.action !== 'list')")[1] || '') &&
  /\['audit', '🧾 Audit Trail'\]/.test(R('src/components/AccountingTab.jsx')) &&
  /t\[0\] !== 'audit' \|\| isSuper \|\| mp\['audit\.view'\] === true/.test(R('src/components/AccountingTab.jsx')));
ok('3d: new catalog keys exist — Open Cards (rows only), Audit: View Trail, Change Date Filters',
  /key: 'accounting\.view_underlying'/.test(R('src/components/SettingsTab.jsx')) &&
  /key: 'audit\.view'/.test(R('src/components/SettingsTab.jsx')) &&
  /key: 'accounting\.change_dates'/.test(R('src/components/SettingsTab.jsx')));

var es = R('src/app/api/accounting/bills/email-scan/route.js');
ok('4a: the EMAIL SCANNER — the hub signs into the mailbox itself (IMAP, Google App Password, never the main password), searches 14 days for YOUR keywords (subject OR body), downloads PDF/image attachments',
  /new ImapFlow\(\{ host: host, port: 993, secure: true/.test(es) &&
  /or: \[\{ subject: kws\[k2\] \}, \{ body: kws\[k2\] \}\]/.test(es) &&
  /BILLS_IMAP_APP_PASSWORD/.test(es));
ok('4b (QK superseded the flat 25 cap with an 8-new-per-pass budget): READ-ONLY on the mailbox; processed messages remembered by Message-ID; 4 attachments/message, 10MB cap',
  /mailboxOpen\('INBOX', \{ readOnly: true \}\)/.test(es) &&
  /eq\('action', 'email_scan_message'\)\.eq\('entity_id', mid\)/.test(es) &&
  /var NEW_PER_PASS = 8;/.test(es) && /pi < parts\.length && pi < 4/.test(es));
ok('4c: every bill it creates goes through the SAME doors — extraction that never guesses, the wide duplicate radar, PENDING validation, document stored privately; cron hourly + manual needs bills.manage',
  /billDupVerdict\(db, \{ vendor_name: d\.vendor_name/.test(es) &&
  /validation_status: 'pending'/.test(es) && /'pv\/scan-'/.test(es) &&
  /'bills\.manage', req\)/.test(es) &&
  /"path": "\/api\/accounting\/bills\/email-scan"/.test(R('vercel.json')));

console.log('');
console.log('QI: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
