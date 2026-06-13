// v55.83-CF — per-business dedupe/update lock for Wave import.
// Behavioral simulation mirrors the route logic + source assertions bind it to real code.
var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}

// --- Behavioral model of the SCOPED dedupe + update, exactly as routes now do it ---
// fetchAllMap(rows, col, businessId): only rows of THIS business enter the map.
function scopedMap(rows, col, businessId) {
  var map = {};
  rows.forEach(function (r) {
    if (r[col] == null) { return; }
    if (businessId && r.wave_business_id !== businessId) { return; } // <-- the lock
    map[r[col]] = r.id;
  });
  return map;
}
// scoped update: physically refuses to touch a row from another business.
function scopedUpdate(rows, id, businessId) {
  var hit = null; rows.forEach(function (r) { if (r.id === id && r.wave_business_id === businessId) hit = r; });
  return hit; // null => update is a no-op (cannot cross business)
}

var REAL='real_ktc', TEST='ktc_hub_test';
// Pathological case: same Wave ID present under BOTH businesses (cannot happen for real,
// but proves the lock holds even if it did).
var customers=[
  {id:'c_real', wave_customer_id:'WC1', wave_business_id:REAL},
  {id:'c_test', wave_customer_id:'WC1', wave_business_id:TEST},
  {id:'c_legacy', wave_customer_id:'WC9', wave_business_id:null}
];
var invoices=[
  {id:'i_real', wave_invoice_id:'WI1', wave_business_id:REAL},
  {id:'i_test', wave_invoice_id:'WI1', wave_business_id:TEST}
];

// 1) Real KTC record CANNOT be updated during a TEST import.
var tMapC=scopedMap(customers,'wave_customer_id',TEST);
ok(tMapC['WC1']==='c_test','TEST import customer map resolves to the TEST row, not real');
ok(scopedUpdate(customers, tMapC['WC1'], TEST).id==='c_test','TEST update touches c_test only');
ok(scopedUpdate(customers, 'c_real', TEST)===null,'1: real KTC customer CANNOT be updated under TEST import');
var tMapI=scopedMap(invoices,'wave_invoice_id',TEST);
ok(tMapI['WI1']==='i_test' && scopedUpdate(invoices,'i_real',TEST)===null,'1: real KTC invoice CANNOT be updated under TEST import');

// 2) TEST record cannot appear in the REAL import/update path.
var rMapC=scopedMap(customers,'wave_customer_id',REAL);
ok(rMapC['WC1']==='c_real','REAL import map resolves to real row');
ok(scopedUpdate(customers,'c_test',REAL)===null,'2: test customer CANNOT be updated under REAL import');
var rMapI=scopedMap(invoices,'wave_invoice_id',REAL);
ok(rMapI['WI1']==='i_real' && scopedUpdate(invoices,'i_test',REAL)===null,'2: test invoice invisible to REAL update path');

// 3) Same business re-import dedupes/updates correctly (no duplicate).
ok(rMapI['WI1']==='i_real','3: re-importing REAL finds the existing REAL invoice (update, not insert)');
ok(scopedUpdate(invoices,rMapI['WI1'],REAL).id==='i_real','3: re-import updates the same REAL row');

// 4) Import into a different business creates/separates (incoming WI1 for TEST is not in REAL map).
ok(scopedMap(invoices,'wave_invoice_id',REAL)['WI2']===undefined,'4: a brand-new id is absent from map => insert path (new, separated record)');
ok(scopedMap([],'wave_invoice_id',TEST)['WI1']===undefined,'4: empty TEST business => everything created fresh & tagged TEST');

// 5) Legacy NULL records block a second import (gate lives in WaveImportTab).
var wit=p('src/components/WaveImportTab.jsx');
ok(/legacyNulls > 0/.test(wit) && /backfill/i.test(wit),'5: legacy-NULL records block import until backfilled');

// --- Source assertions: the REAL routes carry the scoping (binds model to code) ---
var inv=p('src/app/api/wave/import-invoices/route.js');
ok(/function fetchAllMap\(admin, table, col, businessId\)/.test(inv),'invoices: fetchAllMap takes businessId');
ok(/if \(businessId\) \{ q = q\.eq\('wave_business_id', businessId\); \}/.test(inv),'invoices: dedupe map scoped by wave_business_id');
ok(/fetchAllMap\(admin, 'accounting_customers', 'wave_customer_id', businessId\)/.test(inv),'invoices: custMap scoped');
ok(/fetchAllMap\(admin, 'accounting_invoices', 'wave_invoice_id', businessId\)/.test(inv),'invoices: invMap scoped');
ok(/\.eq\('id', invMap\[n\.id\]\)\.eq\('wave_business_id', businessId\)/.test(inv),'invoices: UPDATE physically locked to business');
var cus=p('src/app/api/wave/import-customers/route.js');
ok(/\.not\('wave_customer_id', 'is', null\)\.eq\('wave_business_id', businessId\)/.test(cus),'customers: dedupe map scoped by wave_business_id');
ok(/\.eq\('id', existing\[n\.id\]\)\.eq\('wave_business_id', businessId\)/.test(cus),'customers: UPDATE physically locked to business');
// placeholder customer in invoice route uses the scoped custMap (cannot reuse another business' customer)
ok(/wave_business_id: businessId, created_by: userId/.test(inv),'placeholder customer stamped with this business');

console.log('\nv55.83-CF per-business dedupe lock: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
