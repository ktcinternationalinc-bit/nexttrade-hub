var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var t=p('src/components/AccountingDashboard.jsx');var sql=p('sql/v55-83-bg-overdue-ignore.sql');
ok(/A · Receivables summary/.test(t)&&/B · Upcoming due/.test(t)&&/C · Overdue aging/.test(t)&&/D · Bank review/.test(t)&&/E · Wave sync/.test(t),'sections A-E present');
ok(/function toggleIgnore/.test(t)&&/overdue_dashboard_ignored: true/.test(t)&&/overdue_dashboard_ignored_by/.test(t)&&/overdue_dashboard_ignored_at/.test(t),'ignore sets flag + by + at');
ok(/overdue_dashboard_ignored: false, overdue_dashboard_ignored_by: null/.test(t),'ignore is reversible (un-ignore clears fields)');
ok(/logActivity\(userProfile && userProfile\.id, \(ignore \? 'Ignored' : 'Un-ignored'\)/.test(t),'ignore/un-ignore is logged');
ok(/var OVERDUE_MIN = 200/.test(t)&&/!r\.ignored && r\.balance >= OVERDUE_MIN/.test(t),'default hides <$200 and ignored');
ok(/showSmall \? d\.overdueRows : d\.overdueRows\.filter/.test(t),'toggle shows small + ignored');
ok(/overdueTotal = r2\(shownOverdue\.reduce/.test(t),'overdue total uses filtered set (ignored excluded by default)');
ok(/function openView/.test(t)&&/accounting_invoice_items'\)\.select/.test(t),'overdue View opens read-only invoice');
ok(/onClick=\{function \(\) \{ openView\(t\); \}\}/.test(t)&&/toggleIgnore\(t, true\)/.test(t),'each overdue row has View + Ignore');
ok(/Number\(i\.total_amount\) \|\| 0\) - \(Number\(i\.wave_imported_paid\) \|\| 0\) - \(payByInv\[i\.id\] \|\| 0\)/.test(t),'AR formula unchanged');
ok(/st !== 'void' && st !== 'cancelled' && st !== 'archived' && st !== 'deleted'/.test(t),'excludes void/cancelled/archived/deleted');
ok(/ws\.pending/.test(t)&&/wave_sync_log/.test(t),'Wave sync section from status + log');
ok(/overdue_dashboard_ignored\s+boolean DEFAULT false/.test(sql)&&/overdue_dashboard_ignore_note text/.test(sql),'SQL adds 4 ignore fields');
ok(/import \{ fetchAllRows \} from '\.\.\/lib\/fetch-all-rows'/.test(t),'dashboard imports fetchAllRows (regression guard)');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page version stamp');
ok(/version: 'v55\.83-BG'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BG');
console.log('\nv55.83-BG dashboard overdue: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
