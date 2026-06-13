var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/🅰 CONTAINER SHELL/.test(r),'Section A container label');
ok(/🅱 PRODUCTS RECEIVED/.test(r),'Section B products label');
ok(/bg-slate-800\/50 border border-violet-500\/40/.test(r),'shell uses lighter distinct shade');
ok(/bg-slate-950\/50 border-t-2 border-indigo-500\/30/.test(r),'products region is a darker panel');
ok(/var rec = computeVariance\(header, lines\)/.test(r),'reconciliation logic untouched');
ok(/var \[collapsedLines, setCollapsedLines\]/.test(r),'A2 collapse still present');
ok(/version: 'v55\.83-BQ'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BQ');
console.log('\nv55.83-BQ section separation: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
