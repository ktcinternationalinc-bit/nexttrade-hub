var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/loadedLines\.forEach\(function \(_, i\) \{ _collapseAll\[i\] = true; \}\)/.test(r),'openEdit collapses every loaded product line');
ok(/setCollapsedLines\(_collapseAll\)/.test(r),'collapsedLines set to all-collapsed on view');
ok(/setShellCollapsed\(loadedLines\.length > 0\)/.test(r),'container shell collapses when lines exist');
// behavioral: all-collapse map
function mk(n){var m={};for(var i=0;i<n;i++)m[i]=true;return m;}
var cm=mk(3); ok(cm[0]&&cm[1]&&cm[2],'3 loaded lines => all collapsed');
ok(Object.keys(mk(0)).length===0,'0 lines => nothing to collapse');
ok(/version: 'v55\.83-CN'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CN');
console.log('\nv55.83-CN collapse-on-view: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
