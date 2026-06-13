var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryTab.jsx');
// admin group
ok(/{ id: 'masterlists',     group: 'admin',/.test(r),'Master Lists moved to admin group');
ok(/{ id: 'importproducts',  group: 'admin',/.test(r),'Import Products moved to admin group');
ok(/{ key: 'admin',     label: 'Administration',/.test(r),'admin group added');
ok(/icon: '⚙️'/.test(r)&&/icon: '📦'/.test(r),'group icons added');
// card nav
ok(/grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3/.test(r),'responsive card grid');
ok(/bg-white border border-slate-200 rounded-lg p-3 shadow-sm/.test(r),'each group is a card');
ok(/\{grp\.icon\}/.test(r),'group header shows icon');
ok(/<span>\{st\.label\}<\/span>/.test(r),'buttons use icon label');
ok(/bg-indigo-600 text-white shadow-md ring-2 ring-indigo-300/.test(r),'stronger active state');
// ERP header
ok(/📦 Inventory Management/.test(r),'ERP header title');
ok(/Last Inventory Cutoff/.test(r)&&/cutoffDate \? cutoffDate : 'Not Set'/.test(r),'cutoff status shown');
ok(/Set Cutoff/.test(r)&&/setCutoffPanelOpen\(true\)/.test(r),'Set Cutoff button opens panel');
// permission gating preserved
ok(/function visFor\(st\)/.test(r)&&/Manage Inventory Master/.test(r),'visFor permission gating preserved');
ok(/version: 'v55\.83-BT'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BT');
console.log('\nv55.83-BT menu redesign: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
