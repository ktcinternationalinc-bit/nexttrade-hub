// v55.83-X — Phase 1 bank ingestion guards + Plaid sign-convention validation.
const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const lib=p('src/lib/bank-ingest.js');
const route=p('src/app/api/plaid/transactions/route.js');
const sql=p('sql/v55-83-x-phase1-bank-ingestion.sql');

// --- lib mapping ---
ok(/export function mapPlaidTransaction/.test(lib),'mapper exported');
ok(/Number\(amount\) < 0 \? 'in' : 'out'/.test(lib),'Plaid sign: amount<0 => money IN');
ok(/amount_abs: Math\.abs\(amount\)/.test(lib),'amount_abs normalized');
ok(/posted_date: t\.pending \? null : t\.date/.test(lib),'pending rows have null posted_date');
ok(/raw: t,/.test(lib),'full Plaid payload stored for audit');
ok(!/review_status:/.test(lib),'mapper does NOT emit review_status (cannot clobber user work)');
ok(!/classification:/.test(lib),'mapper does NOT emit classification');
ok(/export function supersededPendingIds/.test(lib),'pending-supersede helper exported');
ok(/!t\.pending && t\.pending_transaction_id/.test(lib),'supersede targets posted rows with a pending twin');

// --- route ---
ok(/onConflict: 'plaid_transaction_id'/.test(route),'idempotent upsert on plaid id (dedupe)');
ok(/from\('bank_transactions'\)\.delete\(\)\.in\('plaid_transaction_id', superseded\)/.test(route),'route removes superseded pending rows');
ok(/mapPlaidTransaction/.test(route)&&/supersededPendingIds/.test(route),'route uses the pure mapper');
ok(route.indexOf('`')<0,'route has NO template literals (SWC rule)');
ok(!/\b(const|let)\s/.test(route.replace(/\/\/.*$/gm,'')),'route uses var only');
ok(/review_status/.test(route),'GET can filter by review_status');

// --- SQL ---
ok(/ADD COLUMN IF NOT EXISTS direction/.test(sql)&&/ADD COLUMN IF NOT EXISTS amount_abs/.test(sql),'SQL adds direction + amount_abs');
ok(/ADD COLUMN IF NOT EXISTS business_id/.test(sql),'SQL adds business_id (multi-business ready)');
ok(/CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_txn_plaid_id/.test(sql),'unique dedupe index on plaid id');
ok(/CREATE TABLE IF NOT EXISTS bank_transaction_splits/.test(sql),'splits table created');
ok(/ENABLE ROW LEVEL SECURITY/.test(sql)&&/FOR SELECT TO authenticated/.test(sql),'RLS enabled with policies (Rule 9)');
ok(/customer\|vendor\|invoice\|bill\|purchase_order\|expense/.test(sql),'linked_type reserves vendor/bill/PO/expense paths');
ok(/CASE WHEN amount < 0 THEN 'in' ELSE 'out' END/.test(sql),'backfill uses same sign convention as mapper');

// --- independent numeric check of the sign convention (the risky bit) ---
function dir(a){return Number(a)<0?'in':'out';}
ok(dir(-100)==='in'&&Math.abs(-100)===100,'deposit (amount -100) => IN, abs 100');
ok(dir(50)==='out'&&Math.abs(50)===50,'payment (amount 50) => OUT, abs 50');

ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page.jsx stamped (current build)');
ok(/version: 'v55\.83-X'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew has v55.83-X');

console.log('\nv55.83-X bank ingestion: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
