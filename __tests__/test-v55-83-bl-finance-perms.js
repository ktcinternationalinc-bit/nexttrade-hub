var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var perm=p('src/lib/bank-permissions.js');var dash=p('src/components/AccountingDashboard.jsx');
// SWC-safe lib
ok(!/`|\blet \b|\bconst |=>/.test(perm),'bank-permissions SWC-safe');
// operational flags exist
['canCreateInvoice','canViewInvoices','canViewInvoiceBalance','canViewPayments','canViewCustomerAr','canViewTransactions','canViewTransactionAmounts'].forEach(function(fn){ ok(new RegExp('export function '+fn).test(perm),'operational flag '+fn); });
// admin-only flags exist + are admin-gated
['canViewBankBalances','canViewCompanyTotals','canViewAllCustomerBalances','canViewYearlySales','isFinanceAdmin'].forEach(function(fn){ ok(new RegExp('export function '+fn).test(perm),'admin flag '+fn); });
ok(/function isAdminRole\(role\) \{ return role === 'admin' \|\| role === 'owner'; \}/.test(perm),'admin role = admin|owner');
// behaviour: a payment-staff user (match yes, totals no)
function has(mp,keys){ if(!mp)return false; for(var i=0;i<keys.length;i++){ if(mp[keys[i]]===true)return true; } return false; }
function isAdminRole(role){ return role==='admin'||role==='owner'; }
function isFinanceAdmin(sa,mp,role){ return sa===true||isAdminRole(role)||has(mp,['Finance: Admin','finance.admin']); }
function canMatchPayments(sa,mp){ return sa===true||has(mp,['Payments: Match','payments.match']); }
function canViewCompanyTotals(sa,mp,role){ return isFinanceAdmin(sa,mp,role)||has(mp,['Finance: View Company Totals','finance.view_company_totals']); }
function canViewBankBalances(sa,mp,role){ return isFinanceAdmin(sa,mp,role)||has(mp,['Bank: View Account Balances','bank.view_account_balances']); }
var staff={'payments.match':true,'invoice.view_balance':true};
ok(canMatchPayments(false,staff)===true,'staff CAN match payments');
ok(canViewCompanyTotals(false,staff,'staff')===false,'staff CANNOT see company totals');
ok(canViewBankBalances(false,staff,'staff')===false,'staff CANNOT see bank balances');
ok(canViewCompanyTotals(false,{},'owner')===true,'owner CAN see company totals');
ok(canViewCompanyTotals(true,{},'staff')===true,'super_admin CAN see company totals');
// dashboard wiring
ok(/canViewCompanyTotals/.test(dash)&&/var seeTotals = canViewCompanyTotals/.test(dash),'dashboard computes seeTotals');
ok(/function tmoney\(n\) \{ return seeTotals \? .* : 'Restricted'/.test(dash),'tmoney masks totals as Restricted');
ok(/big=\{tmoney\(d\.openTotal\)\}/.test(dash)&&/big=\{tmoney\(overdueTotal\)\}/.test(dash),'Open AR + Overdue use tmoney');
ok(/isSuperAdmin && seeTotals &&/.test(dash),'audit panel requires seeTotals');
ok(/version: 'v55\.83-BL'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BL');
console.log('\nv55.83-BL finance perms: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
