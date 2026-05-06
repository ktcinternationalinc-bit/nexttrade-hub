// ============================================================
// v55.51 — Customs Phase 1 regression test
//
// What this guards against:
//   - SQL migration file missing or malformed
//   - CustomsTab no longer renders the new clearance form
//   - Calculation formulas broken
//   - CustomsRateLibrary not mounted into Settings
//   - fxRate prop not passed to CustomsTab
//   - Snapshot fields (vat_pct, advance_income_tax_pct, bank_commission_pct)
//     not stored on save (would let historical rows drift if rates change)
//   - Sub-tabs lost (Clearances / Shipments)
// ============================================================

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var customsTab = fs.readFileSync(path.join(REPO, 'src/components/CustomsTab.jsx'), 'utf8');
var customsLib = fs.readFileSync(path.join(REPO, 'src/components/CustomsRateLibrary.jsx'), 'utf8');
var settingsTab = fs.readFileSync(path.join(REPO, 'src/components/SettingsTab.jsx'), 'utf8');
var page = fs.readFileSync(path.join(REPO, 'src/app/page.jsx'), 'utf8');
var sql = fs.readFileSync(path.join(REPO, 'supabase/customs-phase-1.sql'), 'utf8');

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log('✓ ' + label); passed++; }
  else { console.log('✗ ' + label); failed++; }
}

console.log('============================================================');
console.log('v55.51 — Customs Phase 1 regression suite');
console.log('============================================================\n');

// ---------- A: SQL migration file ----------
console.log('A. SQL migration file');
check('A.1 customs_rates CREATE TABLE present',
  /CREATE TABLE IF NOT EXISTS customs_rates/.test(sql));
check('A.2 customs_settings CREATE TABLE present',
  /CREATE TABLE IF NOT EXISTS customs_settings/.test(sql));
check('A.3 customs_clearances CREATE TABLE present',
  /CREATE TABLE IF NOT EXISTS customs_clearances/.test(sql));
check('A.4 customs_settings has singleton constraint (CHECK id = 1)',
  /CHECK \(id = 1\)/.test(sql));
check('A.5 customs_settings has default rates (14, 1, 10) seeded',
  /INSERT INTO customs_settings.*VALUES \(1, 14\.0, 1\.0, 10\.0\)/s.test(sql));
check('A.6 customs_clearances stores fx_rate per row (FX snapshot)',
  /fx_rate NUMERIC/.test(sql));
check('A.7 customs_clearances stores government rate snapshots',
  /vat_pct NUMERIC/.test(sql) && /advance_income_tax_pct NUMERIC/.test(sql) && /bank_commission_pct NUMERIC/.test(sql));
check('A.8 customs_clearances has 8 fixed-fee columns matching invoice 1676',
  /permit_withdrawal_egp/.test(sql) && /unloading_egp/.test(sql) && /cranes_loading_egp/.test(sql)
    && /storage_egp/.test(sql) && /road_fees_egp/.test(sql) && /pricing_committee_egp/.test(sql)
    && /misc_clearance_egp/.test(sql) && /transport_egp/.test(sql));
check('A.9 customs_clearances has total_clearance_egp grand-total column',
  /total_clearance_egp NUMERIC/.test(sql));
check('A.10 RLS enabled on all three tables',
  (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length >= 3);

// ---------- B: CustomsTab structure ----------
console.log('\nB. CustomsTab — sub-tabs and form');
check('B.1 has subTab state with default "clearances"',
  /var \[subTab, setSubTab\] = useState\('clearances'\)/.test(customsTab));
check('B.2 sub-tab buttons render both Clearances and Shipments',
  /Clearances \/ تخليص جمركي/.test(customsTab) && /Shipments \/ الشحنات/.test(customsTab));
check('B.3 fxRate is accepted as a prop',
  /export default function CustomsTab\(\{ customers, user, fxRate \}\)/.test(customsTab));
check('B.4 New Clearance form has all 8 fixed-fee inputs',
  /permit_withdrawal_egp/.test(customsTab) && /unloading_egp/.test(customsTab)
    && /cranes_loading_egp/.test(customsTab) && /storage_egp/.test(customsTab)
    && /road_fees_egp/.test(customsTab) && /pricing_committee_egp/.test(customsTab)
    && /misc_clearance_egp/.test(customsTab) && /transport_egp/.test(customsTab));
check('B.5 productList loaded from customs_rates table',
  /supabase\.from\('customs_rates'\)/.test(customsTab));
check('B.6 govRates loaded from customs_settings (id=1) singleton',
  /supabase\.from\('customs_settings'\)\.select.*\.eq\('id', 1\)/.test(customsTab));
check('B.7 friendly amber banner when tables missing',
  /tablesReady/.test(customsTab) && /Customs tables not yet created/.test(customsTab));

// ---------- C: Calculation formulas ----------
console.log('\nC. Calculation formulas match invoice 1676');
check('C.1 totalUsd = usdPerKg * qtyKg',
  /var totalUsd = usdPerKg \* qtyKg/.test(customsTab));
check('C.2 totalEgp = totalUsd * fx',
  /var totalEgp = totalUsd \* fx/.test(customsTab));
check('C.3 customsDutyEgp = totalEgp * customsPct/100',
  /var customsDutyEgp = totalEgp \* \(customsPct \/ 100\)/.test(customsTab));
check('C.4 vatEgp = (totalEgp + customsDutyEgp) * vatPct/100',
  /var vatEgp = \(totalEgp \+ customsDutyEgp\) \* \(vatPct \/ 100\)/.test(customsTab));
check('C.5 advance income tax = (totalEgp + customsDutyEgp) * 1%',
  /var aitEgp = \(totalEgp \+ customsDutyEgp\) \* \(aitPct \/ 100\)/.test(customsTab));
check('C.6 bank commission = aitEgp * bcPct/100 (% of income tax, not raw value)',
  /var bcEgp = aitEgp \* \(bcPct \/ 100\)/.test(customsTab));
check('C.7 grand total includes all four taxes + 8 fixed fees',
  /var totalClearance = customsDutyEgp \+ vatEgp \+ aitEgp \+ bcEgp \+ fixedSum/.test(customsTab));

// ---------- D: Snapshot on save ----------
console.log('\nD. Snapshot on save (so historical rows don\'t drift)');
check('D.1 vat_pct snapshotted on insert',
  /vat_pct: calcs\.vatPct/.test(customsTab));
check('D.2 advance_income_tax_pct snapshotted on insert',
  /advance_income_tax_pct: calcs\.aitPct/.test(customsTab));
check('D.3 bank_commission_pct snapshotted on insert',
  /bank_commission_pct: calcs\.bcPct/.test(customsTab));
check('D.4 customs_duty_pct snapshotted on insert (not just FK to customs_rates)',
  /customs_duty_pct: Number\(form\.customs_duty_pct\)/.test(customsTab));
check('D.5 fx_rate snapshotted on insert',
  /fx_rate: Number\(form\.fx_rate\)/.test(customsTab));

// ---------- E: CustomsRateLibrary ----------
console.log('\nE. CustomsRateLibrary in Settings');
check('E.1 SettingsTab imports CustomsRateLibrary',
  /import CustomsRateLibrary from '\.\/CustomsRateLibrary'/.test(settingsTab));
check('E.2 SettingsTab nav includes "Customs Rates"',
  /\['customs', '🛃 Customs Rates'\]/.test(settingsTab));
check('E.3 CustomsRateLibrary rendered when section === customs',
  /section === 'customs'/.test(settingsTab) && /<CustomsRateLibrary/.test(settingsTab));
check('E.4 library upserts to customs_settings (singleton update)',
  /supabase\.from\('customs_settings'\)\.upsert/.test(customsLib));
check('E.5 library inserts/updates/deletes customs_rates',
  /supabase\.from\('customs_rates'\)\.insert/.test(customsLib)
    && /supabase\.from\('customs_rates'\)\.update/.test(customsLib)
    && /supabase\.from\('customs_rates'\)\.delete/.test(customsLib));
check('E.6 library catches "table does not exist" with friendly hint',
  /relation\.\*customs/.test(customsLib) || /does not exist/.test(customsLib));

// ---------- F: page.jsx wiring ----------
console.log('\nF. page.jsx wires fxRate prop to CustomsTab');
check('F.1 CustomsTab receives fxRate prop',
  /<CustomsTab[^/]*fxRate=\{fxRate\}/.test(page));

// ---------- G: Build stamp ----------
console.log('\nG. Build stamp current');
check('G.1 header pill at v55.51 or later',
  />v55\.(5[1-9]|[6-9]\d)</.test(page));
var anyBuildLabel = page.match(/BUILD v55\.\d+-/g);
check('G.2 build modal stamp version is at least v55.51',
  anyBuildLabel && anyBuildLabel.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 51;
  }));

// ---------- H: Earlier session fixes still intact ----------
console.log('\nH. Earlier session fixes still intact (no regression)');
check('H.1 v55.50 cancelEventRemindersBulk import still present',
  /import \{[^}]*cancelEventRemindersBulk[^}]*\} from '\.\.\/lib\/reminders'/.test(fs.readFileSync(path.join(REPO, 'src/components/CalendarTab.jsx'), 'utf8')));
check('H.2 v55.49 form-modal hide gate still present',
  /\{showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm && \(/.test(page));
check('H.3 v55.47 inline validation banner still present',
  /treasuryFormErrors\.length > 0 && \(/.test(page));
check('H.4 existing shipments tracker preserved in CustomsTab',
  /handleAddShipment/.test(customsTab) && /SHIP_STATUSES/.test(customsTab));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate the v55.51 customs Phase 1 has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.51 customs Phase 1 tests passed.\n');
