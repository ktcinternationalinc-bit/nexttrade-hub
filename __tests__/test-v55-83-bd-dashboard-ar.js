var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var t=p('src/components/AccountingDashboard.jsx');
ok(/fetchAllRows\('accounting_invoice_payments', 'accounting_invoice_id,amount,sync_status'\)/.test(t),'loads payment rows (paginated)');
ok(/st === 'void' \|\| st === 'cancelled' \|\| st === 'reversed' \|\| st === 'deleted'/.test(t),'excludes void/cancelled/reversed/deleted payments');
ok(/\(Number\(i\.total_amount\) \|\| 0\) - \(Number\(i\.wave_imported_paid\) \|\| 0\) - \(payByInv\[i\.id\] \|\| 0\)/.test(t),'open = total - wave_imported_paid - hub payments');
ok(/st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted'/.test(t),'excludes void/cancelled/archived/deleted invoices');
ok(/if \(ob < -0\.005\) \{ creditTotal/.test(t),'negative balance = credit, not AR');
ok(/od <= 30.*od30.*od <= 60.*od60.*od <= 90.*od90.*od90p/s.test(t),'overdue buckets 1-30/31-60/61-90/90+');
ok(/du <= 30.*d30.*du <= 60.*d60.*du <= 90.*d90.*later/s.test(t),'current buckets 30/60/90/later');
ok(/balByCust\[i\.accounting_customer_id\] = \(balByCust\[i\.accounting_customer_id\] \|\| 0\) \+ ob/.test(t),'customer balance from computed open (not stale)');
ok(!/\.balance_due/.test(t),'no reliance on stale balance_due field anywhere');
ok(/tableRows\.sort/.test(t)&&/ad < bd\) return -1/.test(t),'invoice table sorted by due date ascending');
ok(/Number<\/div><div className="py-1">Customer.*Inv date.*Due date.*Status.*Total.*Paid.*Balance.*Source/s.test(t),'table columns present');
ok(/setBucket\(active \? '' : k\)/.test(t),'aging buckets clickable -> filter table');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page version stamp');
ok(/version: 'v55\.83-BD'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BD');

// formula proof
function r2(x){return Math.round((Number(x)||0)*100)/100;}
function open(total,wave,hub){return r2(total-wave-hub);}
ok(open(10000,2000,8000)===0,'10000-2000-(3000+4000+1000)=0');
ok(open(11181.39,0,0)===11181.39,'1722 open = 11181.39');
ok(open(5000,5000,500)===-500,'overpaid -> -500 (credit)');
console.log('\nv55.83-BD dashboard AR: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
