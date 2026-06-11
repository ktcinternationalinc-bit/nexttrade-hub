// v55.83-Y — Phase 1 hardening: RLS, business_id, audit, credit flagging.
const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const sql=p('sql/v55-83-y-phase1-hardening.sql');
const lib=p('src/lib/bank-ingest.js');
const route=p('src/app/api/plaid/transactions/route.js');

// RLS (Item 1) — business-scoped, no more USING(true), delete locked (Item 6)
ok(/CREATE TABLE IF NOT EXISTS businesses/.test(sql),'businesses table');
ok(/CREATE TABLE IF NOT EXISTS user_business_memberships/.test(sql),'membership table');
ok(/FUNCTION app_user_business_ids\(\)/.test(sql)&&/SECURITY DEFINER/.test(sql),'business-access helper (security definer)');
ok(/USING \(business_id IN \(SELECT app_user_business_ids\(\)\)\)/.test(sql),'SELECT scoped to user business');
ok(!/FOR SELECT TO authenticated USING \(true\)/.test(sql),'no dev-open USING(true) SELECT remains in -Y');
ok(/bt_del ON bank_transactions FOR DELETE TO authenticated USING \(false\)/.test(sql),'client deletion disabled (Item 6)');
ok(/bts_del ON bank_transaction_splits FOR DELETE TO authenticated USING \(false\)/.test(sql),'splits deletion disabled');

// business_id backfill (Item 2)
ok(/UPDATE bank_connections\s+SET business_id = \(SELECT id FROM businesses/.test(sql),'connections business_id backfilled');
ok(/UPDATE bank_transactions\s+SET business_id = \(SELECT id FROM businesses/.test(sql),'transactions business_id backfilled');
ok(/INSERT INTO user_business_memberships[\s\S]*FROM users u/.test(sql),'existing users seeded into business');

// audit (Item 3)
ok(/ADD COLUMN IF NOT EXISTS created_by/.test(sql)&&/ADD COLUMN IF NOT EXISTS updated_by/.test(sql),'created_by + updated_by added');
ok(/FUNCTION set_updated_at\(\)/.test(sql)&&/TRIGGER trg_bank_txn_updated BEFORE UPDATE/.test(sql),'updated_at trigger installed');
ok(/created_at|reviewed_by/.test(p('sql/v55-83-x-phase1-bank-ingestion.sql')),'reviewed_by/at present from -X');

// credit handling (Item 5)
ok(/ADD COLUMN IF NOT EXISTS unsupported_account/.test(sql),'unsupported_account column');
ok(/export function deriveAccountInfo/.test(lib),'mapper derives account info');
ok(/type !== 'depository'/.test(lib),'non-depository accounts flagged unsupported');
ok(/accountsById/.test(route)&&/data\.accounts/.test(route),'route passes account types to mapper');

ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page.jsx stamped (current build)');
ok(/version: 'v55\.83-Y'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew has v55.83-Y');

console.log('\nv55.83-Y phase1 hardening: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
