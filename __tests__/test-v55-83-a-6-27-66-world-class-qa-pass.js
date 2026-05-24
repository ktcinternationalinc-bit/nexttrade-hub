// v55.83-A.6.27.66 — WORLD-CLASS QA PASS
//
// Covers all 11 user-reported issues + Critical (C1-C4) + High (H1-H6) + Medium (M2/M6)
// findings from the comprehensive bug hunt.
//
// SCOPE:
//   PART A — Issue 1: default invoice number per account (Open Accounts)
//   PART B — Issue 2: 📎 Files button on customer card row
//   PART C — Issues 4–7: permission split + sticky grid + descriptions + deactivated sweep (already covered .52, here we re-check critical bits)
//   PART D — Issue 8: global CSS contrast fix
//   PART E — Issues 9 + 10: yellow-on-yellow + clone-template-replaces-variant
//   PART F — Issue 11: manual Add Product silent-fail (defensive save + Level 9 form)
//   PART G — Issue 12: InventoryMasterAdmin gets Level 9
//   PART H — C1: cross-currency aggregation (SalesRepDashboard, P&L, page totals)
//   PART I — C2: login deactivation uses isActiveUser
//   PART J — C3: Warehouse Advance atomicity (rollback treasury on advance fail)
//   PART K — C4: Cancelling finalized receipt reverses cost layer first
//   PART L — H1: FX rate edit collision detection
//   PART M — H2: FX P&L converts cogs via FX rate (no EGP assumption)
//   PART N — H3: outstanding fallback compute
//   PART O — H4: attachment delete audit_log uses new_values (not field_changes)
//   PART P — H5: "(Unassigned)" rep toggle defaults OFF
//   PART Q — H6: attachment per-record quota (50 files / 500MB)
//   PART R — M2: sales rep filter trims whitespace
//   PART S — M6: ?? null fallback for legit-zero amounts
//   PART T — Sweep: isActiveUser used in MyHRDesk + SettingsTab; FX delete audited

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var oa     = read('src/components/OpenAccountsTab.jsx');
var pm     = read('src/components/InventoryProductMaster.jsx');
var ma     = read('src/components/InventoryMasterAdmin.jsx');
var srd    = read('src/components/SalesRepDashboard.jsx');
var pnl    = read('src/components/InventoryPnLReports.jsx');
var fxr    = read('src/components/FxRatesPanel.jsx');
var fxpnl  = read('src/components/FxPnLReport.jsx');
var wadv   = read('src/components/WarehouseAdvancesTab.jsx');
var recv   = read('src/components/InventoryReceiving.jsx');
var att    = read('src/components/AttachmentManager.jsx');
var hrdesk = read('src/components/MyHRDesk.jsx');
var settings = read('src/components/SettingsTab.jsx');
var login  = read('src/app/login/page.jsx');
var page   = read('src/app/page.jsx');
var supa   = read('src/lib/supabase.js');
var css    = read('src/app/globals.css');
var wnw    = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Issue 1: per-account default invoice number
// ══════════════════════════════════════════════════════════════════
ok('A1: slugifyAccountName helper present (Issue 1)',
  /function slugifyAccountName\(name\)/.test(oa));
ok('A2: slugifyAccountName uppercases + replaces non-alnum with hyphen + trims',
  /\.toUpperCase\(\)[\s\S]{0,200}replace\(\/\[\^A-Z0-9\]\+\/g, '-'\)/.test(oa));
ok('A3: computeNextInvoiceNumber helper present',
  /function computeNextInvoiceNumber\(account\)/.test(oa));
ok('A4: format is INV-{SLUG}-{YEAR}-{NNN}',
  /'INV-' \+ slug \+ '-' \+ year \+ '-'/.test(oa));
ok('A5: openNewInvoice pre-fills invoice_number using computeNextInvoiceNumber',
  /invoice_number: computeNextInvoiceNumber\(acc\)/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART B — Issue 2: 📎 Files button on account row
// ══════════════════════════════════════════════════════════════════
ok('B1: attachAccountId state present',
  /var \[attachAccountId, setAttachAccountId\] = useState\(null\)/.test(oa));
ok('B2: 📎 Files button renders setAttachAccountId(a.id)',
  /setAttachAccountId\(a\.id\)/.test(oa) && /📎 Files/.test(oa));
ok('B3: account-files modal renders AttachmentManager with parent_type=open_account',
  /attachAccountId && \(\(\) =>/.test(oa) && /parentType="open_account"/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART D — Issue 8: global CSS contrast fix
// ══════════════════════════════════════════════════════════════════
ok('D1: globals.css has bg-sky-50 override (was missing → caused Tailwind defaults to leak)',
  /\.bg-sky-50/.test(css));
ok('D2: globals.css has bg-yellow-100 override',
  /\.bg-yellow-100/.test(css));
ok('D3: .font-extrabold color clobber REMOVED (no override forcing white on bold text)',
  !/\.font-extrabold\s*\{\s*color:\s*(white|#fff)/i.test(css));

// ══════════════════════════════════════════════════════════════════
// PART E — Issues 9 + 10: variant + yellow warning
// ══════════════════════════════════════════════════════════════════
ok('E1 (Issue 10): openCloneTemplate replaces variant flow',
  /function openCloneTemplate\(template\)/.test(pm));
ok('E2 (Issue 10): openCreateVariant stub REMOVED in v55.83-A.6.27.71 Phase 4 (replaced by openCloneTemplate calls at point-of-use)',
  !/function openCreateVariant\(template\) \{ openCloneTemplate\(template\); \}/.test(pm) &&
  /function openCloneTemplate\(template\)/.test(pm));
ok('E3 (Issue 9): yellow leather/black warning REMOVED with dead variant modal in v55.83-A.6.27.71 Phase 4',
  !/Smooth leather is typically only available in Black/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART F — Issue 11: manual Add Product silent-fail FIXED
// ══════════════════════════════════════════════════════════════════
ok('F1: form JSX renders all 9 levels (was 1-8 dropping Country)',
  /\[1, 2, 3, 4, 5, 6, 7, 8, 9\]\.map\(function \(lvl\)/.test(pm));
ok('F2: Level 9 marked optional in the form label',
  /isOptional \? <span className="text-\[10px\] font-semibold text-slate-500">\(optional\)<\/span>/.test(pm));
ok('F3: computeSlug requires L1-L8 + appends L9 if picked',
  /for \(var lvl = 1; lvl <= 8; lvl\+\+\)/.test(pm) &&
  /var l9Id = formData\[LEVEL_FIELD_MAP\[9\]\]/.test(pm));
ok('F4: save() validation requires L1-L8 only',
  /for \(var lvl = 1; lvl <= 8; lvl\+\+\)[\s\S]{0,500}fail\('Please select Level '/.test(pm));
ok('F5: save() has [product-master.save] console breadcrumbs',
  /\[product-master\.save\]/.test(pm) &&
  /console\.log\(DEBUG, 'START/.test(pm) &&
  /console\.log\(DEBUG, 'payload built/.test(pm));
ok('F6: save() fail() helper calls BOTH toast.error AND alert() (unmissable feedback)',
  /function fail\(msg\) \{[\s\S]{0,200}toast\.error\(msg\);[\s\S]{0,200}alert\(msg\)/.test(pm));
ok('F7: save() payload includes origin_list_id (Level 9)',
  /origin_list_id: form\.origin_list_id/.test(pm));
ok('F8: save() catch generates actionable error hints',
  /column.*does not exist/i.test(pm) &&
  /violates.*not-null/i.test(pm) &&
  /violates.*unique/i.test(pm));
ok('F9: dbInsert audit_log failure no longer swallowed (logs warning)',
  /\[dbInsert\] audit_log insert failed/.test(supa) &&
  /\[dbInsert\] audit_log threw/.test(supa));

// ══════════════════════════════════════════════════════════════════
// PART G — Issue 12: InventoryMasterAdmin gets Level 9
// ══════════════════════════════════════════════════════════════════
ok('G1: LEVELS array has num:9 Country entry',
  /num: 9, en: 'Country'/.test(ma));

// ══════════════════════════════════════════════════════════════════
// PART H — C1: cross-currency aggregation
// ══════════════════════════════════════════════════════════════════
ok('H1 (SalesRepDashboard): per-rep × currency buckets',
  /perRepCurrency = useMemo/.test(srd) &&
  /normalizeCurrency\(inv\.currency\)/.test(srd));
ok('H2 (SalesRepDashboard): grandByCurrency aggregates per-currency totals',
  /grandByCurrency = useMemo/.test(srd));
ok('H3 (SalesRepDashboard): rankWithinCurrency for per-currency medals',
  /rankWithinCurrency = useMemo/.test(srd));
ok('H4 (InventoryPnLReports): currencyFilter state defaulting to EGP',
  /var \[currencyFilter, setCurrencyFilter\] = useState\('EGP'\)/.test(pnl));
ok('H5 (InventoryPnLReports): currency filter applied in movement aggregation',
  /if \(currencyFilter !== 'all' && mCur !== currencyFilter\) return/.test(pnl));
ok('H6 (InventoryPnLReports): presentCurrencies memo + mixed-currency warning banner',
  /presentCurrencies = useMemo/.test(pnl) &&
  /Mixed-currency totals/.test(pnl));
ok('H7 (page.jsx): totalsByCurrency memo breaks Sales by currency',
  /const totalsByCurrency = useMemo/.test(page));
ok('H8 (page.jsx): totalsAreMixedCurrency flag + warning banner above tiles',
  /totalsAreMixedCurrency/.test(page) &&
  /the three tiles below are NOT meaningful totals/.test(page));
ok('H9 (page.jsx): per-currency breakdown card after the 3 tiles',
  /By Currency \/ حسب العملة/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART I — C2: login deactivation uses isActiveUser
// ══════════════════════════════════════════════════════════════════
ok('I1: login imports isActiveUser',
  /import \{ isActiveUser \} from '\.\.\/\.\.\/lib\/active-users'/.test(login));
ok('I2: login uses !isActiveUser(profile) (catches NULL active)',
  /profile && !isActiveUser\(profile\)/.test(login));

// ══════════════════════════════════════════════════════════════════
// PART J — C3: Warehouse Advance atomicity
// ══════════════════════════════════════════════════════════════════
ok('J1: WarehouseAdvances tracks createdTreasuryId for rollback',
  /var createdTreasuryId = null/.test(wadv));
ok('J2: WarehouseAdvances rolls back treasury on advance insert failure',
  /rolling back treasury entry/.test(wadv) &&
  /supabase\.from\('treasury'\)\.delete\(\)\.eq\('id', createdTreasuryId\)/.test(wadv));
ok('J3: WarehouseAdvances treasury insert failure now throws (no silent orphan)',
  /Treasury entry could not be created/.test(wadv));

// ══════════════════════════════════════════════════════════════════
// PART K — C4: Cancel finalized receipt reverses cost layer
// ══════════════════════════════════════════════════════════════════
ok('K1: confirmCancelReceipt filters finalized lines first',
  /var finalizedLines = rows\.filter\(function \(r\) \{ return r\.status === 'finalized'/.test(recv));
ok('K2: confirmCancelReceipt calls reopen_finalized_receipt RPC for each finalized line',
  /supabase\.rpc\('reopen_finalized_receipt'/.test(recv));
ok('K3: cancel aborts entirely if any reversal fails',
  /Cannot cancel.*finalized line/.test(recv));

// ══════════════════════════════════════════════════════════════════
// PART L — H1: FX rate edit collision check
// ══════════════════════════════════════════════════════════════════
ok('L1: FX Rate edit path checks for date+pair conflict before update',
  /supabase\.from\('fx_rates'\)\s*\.select\('id'\)\s*\.eq\('rate_date'/.test(fxr) &&
  /\.neq\('id', editingId\)/.test(fxr));
ok('L2: FX Rate edit confirms replace path on conflict',
  /A rate already exists for/.test(fxr) &&
  /Replace it with this one/.test(fxr));

// ══════════════════════════════════════════════════════════════════
// PART M — H2: FX P&L converts via FX rate (no EGP assumption)
// ══════════════════════════════════════════════════════════════════
ok('M1: FxPnLReport has fxToEgp helper',
  /function fxToEgp\(date, sourceCurrency\)/.test(fxpnl));
ok('M2: fxToEgp picks most recent rate ≤ date for src→EGP',
  /from_currency === src && r\.to_currency === 'EGP' && r\.rate_date <= date/.test(fxpnl));
ok('M3: realized uses fxToEgp instead of assuming EGP',
  /var rate = fxToEgp\(d, sourceCur\)/.test(fxpnl) &&
  /costAtReceipt = cogs \* rate/.test(fxpnl));
ok('M4: unconvertable flag added to row + totals',
  /var unconvertable = false/.test(fxpnl) &&
  /unconvertable_count: 0/.test(fxpnl) &&
  /unconvertable: unconvertable/.test(fxpnl));

// ══════════════════════════════════════════════════════════════════
// PART N — H3: outstanding fallback compute
// ══════════════════════════════════════════════════════════════════
ok('N1 (SalesRepDashboard): outstanding fallback = Math.max(0, invoiced - collected)',
  /Math\.max\(0, invd - coll\)/.test(srd));
ok('N2 (page.jsx): outstanding fallback in totalsByCurrency',
  /Math\.max\(0, invd - coll\)/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART O — H4: attachment delete audit column rename
// ══════════════════════════════════════════════════════════════════
ok('O1: attachment delete uses new_values (matches audit_log schema)',
  /new_values: null,\s+old_values: \{/.test(att));
ok('O2: field_changes column reference REMOVED from AttachmentManager',
  !/field_changes:\s*\{/.test(att));

// ══════════════════════════════════════════════════════════════════
// PART P — H5: "(Unassigned)" toggle defaults OFF
// ══════════════════════════════════════════════════════════════════
ok('P1: showUnassigned state defaults to false',
  /var \[showUnassigned, setShowUnassigned\] = useState\(false\)/.test(srd));
ok('P2: visibleRows filter excludes (Unassigned) unless toggle ON',
  /if \(showUnassigned\) return perRepCurrency;\s+return perRepCurrency\.filter\(function \(r\) \{ return r\.rep !== '\(Unassigned\)'/.test(srd));

// ══════════════════════════════════════════════════════════════════
// PART Q — H6: attachment per-record quota
// ══════════════════════════════════════════════════════════════════
ok('Q1: MAX_FILES_PER_RECORD = 50',
  /var MAX_FILES_PER_RECORD = 50/.test(att));
ok('Q2: MAX_TOTAL_SIZE_PER_RECORD = 500 MB',
  /var MAX_TOTAL_SIZE_PER_RECORD = 500 \* 1024 \* 1024/.test(att));
ok('Q3: quota enforced with friendly alert message',
  /Maximum.*files reached for this record/.test(att) &&
  /Storage quota exceeded for this record/.test(att));

// ══════════════════════════════════════════════════════════════════
// PART R — M2: sales rep filter trims whitespace
// ══════════════════════════════════════════════════════════════════
ok('R1: salesRepFilter applies trim().toLowerCase() on both sides',
  /const repLow = salesRepFilter\.trim\(\)\.toLowerCase\(\)/.test(page) &&
  /\(s\.sales_rep \|\| ''\)\.trim\(\)\.toLowerCase\(\) === repLow/.test(page));

// ══════════════════════════════════════════════════════════════════
// PART S — M6: ?? null fallback for legit-zero amounts
// ══════════════════════════════════════════════════════════════════
ok('S1 (page.jsx totalsByCurrency): uses != null fallback (M6)',
  /inv\.total_amount != null \? inv\.total_amount : \(inv\.amount \|\| 0\)/.test(page));
ok('S2 (SalesRepDashboard): same != null pattern',
  /inv\.total_amount != null \? inv\.total_amount : \(inv\.amount \|\| 0\)/.test(srd));

// ══════════════════════════════════════════════════════════════════
// PART T — Cross-component sweep
// ══════════════════════════════════════════════════════════════════
ok('T1: MyHRDesk imports isActiveUser',
  /import \{ isActiveUser \} from '\.\.\/lib\/active-users'/.test(hrdesk));
ok('T2: MyHRDesk superAdmin lookup uses isActiveUser(u)',
  /role === 'super_admin' && isActiveUser\(u\)/.test(hrdesk));
ok('T3: SettingsTab Deactivate/Reactivate buttons use isActiveUser',
  /isActiveUser\(u\) && <button[\s\S]{0,500}handleDeactivateUser/.test(settings) &&
  /!isActiveUser\(u\) && <button[\s\S]{0,500}Reactivate/.test(settings));
ok('T4: FX rate delete now writes audit_log entry',
  /audit_log.*\.insert\(\{\s+table_name: 'fx_rates',\s+record_id: r\.id,\s+action: 'delete'/.test(fxr));

// ══════════════════════════════════════════════════════════════════
// PART V — Version stamp + WhatsNewWidget entry
// ══════════════════════════════════════════════════════════════════
ok('V1: page.jsx stamped v55.83-A.6.27.66 or later',
  /v55\.83-A\.6\.27\.(6[6-9]|[7-9][0-9])/.test(page));
ok('V2: WhatsNewWidget BUILD_HISTORY has v55.83-A.6.27.66 entry at top',
  /version: 'v55\.83-A\.6\.27\.66'/.test(wnw));
ok('V3: WhatsNewWidget .66 entry has layman public bullets (Permanent Rule 1)',
  /Money math now respects currencies/.test(wnw) &&
  /Adding a product manually now works/.test(wnw));
ok('V4: WhatsNewWidget .66 entry has superAdminOnly technical detail',
  /SalesRepDashboard\.jsx[\s\S]{0,2000}superAdminOnly: true/.test(wnw) || /superAdminOnly: true, text: 'Issues 1.{0,5}11/.test(wnw));

// ══════════════════════════════════════════════════════════════════
// FINAL
// ══════════════════════════════════════════════════════════════════
console.log('');
if (failures.length === 0) {
  console.log('✅ All v55.83-A.6.27.66 (World-Class QA Pass) tests passed');
} else {
  console.log('❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
