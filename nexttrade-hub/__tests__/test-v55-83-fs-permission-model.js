var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
function ex(f){try{fs.accessSync(path.join(__dirname,'..',f));return true;}catch(e){return false;}}
var sp=p('src/lib/server-permissions.js');var bp=p('src/lib/bank-permissions.js');var dash=p('src/components/AccountingDashboard.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// server permission helper
ok(ex('src/lib/server-permissions.js'),'server-permissions helper exists');
ok(/export async function assertPermission/.test(sp),'assertPermission exported');
ok(/export async function loadUserPermissions/.test(sp),'loadUserPermissions exported');
ok(/isSuperAdmin === true/.test(sp),'super_admin gets all permissions');
ok(/PERMISSION_ALIASES/.test(sp) && /ROLE_DEFAULTS/.test(sp),'alias + role-default maps present');
ok(/CRON_ALLOWED_PERMS = \{ 'wave.import.run': 1, 'wave.categories.pull': 1 \}/.test(sp),'CRON bypass scoped to scheduled perms only');
ok(!/\bconst \b/.test(sp) && !/=>/.test(sp),'helper SWC-safe');
// each route uses granular perm (not super_admin-only)
var map={'push-customer':'wave.customers.push','push-invoice':'wave.invoices.push','push-invoice-v2':'wave.invoices.push','push-payment':'wave.payments.push','import-customers':'wave.import.run','import-invoices':'wave.import.run','reconcile':'wave.import.run','sync-categories':'wave.categories.pull','product-setup':'wave.settings.manage','payment-account-setup':'wave.settings.manage'};
Object.keys(map).forEach(function(r){
  var s=p('src/app/api/wave/'+r+'/route.js');
  ok(/assertPermission/.test(s) && new RegExp("'"+map[r].replace(/\./g,'\\.')+"'").test(s),r+' -> '+map[r]);
  ok(!/only a super admin can/.test(s),r+' no super_admin-only message');
});
// AR first-class permissions
ok(/canViewArSummary/.test(bp) && /canViewArCustomerBalances/.test(bp) && /canViewArInvoiceBalances/.test(bp),'AR permission helpers added');
ok(/'Payments: Match', 'payments.match'/.test(bp.match(/canViewArInvoiceBalances[\s\S]*?\}/)[0]),'invoice-balance allows payment matchers (per design)');
ok(/var seeTotals = canViewArSummary/.test(dash),'dashboard AR totals use ar.view_summary');
ok(/seeCustBalances = canViewArCustomerBalances/.test(dash),'customer balances use ar.view_customer_balances');
ok(/You don't have permission to view customer balances/.test(dash),'customer balances hidden without permission');
console.log('\nv55.83-FS permission model: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
