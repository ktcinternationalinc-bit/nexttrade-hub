// ============================================================
// v55.83-JX — Bank connect / silo assignment mess (Max live + Codex FAIL):
//  - "Could not find the 'assigned_at' column of plaid_accounts" broke Set & repair → schema-safe fallback.
//  - New accounts connected under a chosen silo showed Unassigned / wrong silo → exchange stamps them.
//  - Duplicate Chase groups for the same silo → connection-level assign + archive (one group per silo cleanup).
// ============================================================
var fs = require('fs');
var path = require('path');
var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/accounting/bank-write/route.js');
var exch = rd('src/app/api/plaid/exchange/route.js');
var bank = rd('src/components/BankTab.jsx');

// 1. assign_account_silo no longer fails on the missing audit columns
ok('1: assign_account_silo falls back to wave_business_id-only when assigned_at/assigned_by/source are missing',
  /assigned_at\|assigned_by\|assignment_source\|schema cache/.test(route) &&
  /update\(\{ wave_business_id: newBiz \}\)\.eq\('plaid_account_id', pacct\)/.test(route));
ok('2: assign_account_silo reports a real 0-row failure (no silent success)',
  /not found in plaid_accounts \(0 rows updated\)/.test(route));

// 3. exchange stamps the connection's chosen silo onto its still-unassigned accounts
ok('3: exchange stamps new accounts to the chosen silo (only null ones, preserving deliberate picks)',
  /from\('plaid_accounts'\)\.update\(\{ wave_business_id \}\)\.eq\('connection_id', conn\.id\)\.is\('wave_business_id', null\)/.test(exch));

// 4. connection-level assign + archive service actions exist (RLS-proof, schema-safe)
ok('4: assign_connection_silo action stamps connection + restamps its transactions (no audit columns)',
  /action === 'assign_connection_silo'/.test(route) &&
  /from\('bank_connections'\)\.update\(\{ wave_business_id: cBiz \}\)\.eq\('id', cid\)/.test(route) &&
  /from\('bank_transactions'\)\.update\(\{ wave_business_id: cBiz, updated_by: by \}\)\.eq\('connection_id', cid\)/.test(route));
ok('5: archive_connection action hides a duplicate connection (status=archived), data kept',
  /action === 'archive_connection'/.test(route) && /update\(\{ status: 'archived' \}\)\.eq\('id', acid\)/.test(route));

// 6. BankTab wiring
ok('6: assignConnection routes through the service action (not the old browser write with assigned_at)',
  /action: 'assign_connection_silo'/.test(bank) &&
  !/bank_connections'\)\.update\(\{ wave_business_id: bizId, assigned_by/.test(bank));
ok('7: archiveConnection wired + duplicate-archive control present + archived filtered from the active list',
  /action: 'archive_connection'/.test(bank) && /Archive duplicate/.test(bank) && /filter\(c => c\.status !== 'archived'\)/.test(bank));

console.log('');
if (failures.length === 0) { console.log('✅ All v55.83-JX bank-connect-silo tests passed'); process.exit(0); }
else { console.log('❌ ' + failures.length + ' FAILED:'); failures.forEach(function (f) { console.log('   - ' + f); }); process.exit(1); }
