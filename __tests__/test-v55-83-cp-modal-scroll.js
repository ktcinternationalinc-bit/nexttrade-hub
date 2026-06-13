var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var m=p('src/components/InventoryProductMaster.jsx');
ok(/flex items-start justify-center/.test(m) && !/z-\[200\] bg-black\/70 backdrop-blur-sm overflow-y-auto/.test(m),'overlay no longer self-scrolls (centers modal)');
ok(/maxHeight: 'calc\(100vh - 32px\)', display: 'flex', flexDirection: 'column'/.test(m),'container is viewport-capped flex column');
ok(/background: '#3730a3', padding: '14px 20px', flexShrink: 0/.test(m),'header flex-none (stays visible)');
ok(/padding: 20, overflowY: 'auto', flex: '1 1 auto', minHeight: 0/.test(m),'body scrolls within remaining space');
ok(/padding: '12px 20px', flexShrink: 0/.test(m),'footer flex-none (Save/Cancel always reachable)');
ok(!/maxHeight: 'calc\(100vh - 140px\)'/.test(m),'old fixed-body maxHeight removed');
ok(/document\.body\.style\.overflow = 'hidden'/.test(m) && /document\.body\.style\.overflow = prev/.test(m),'background scroll locked while open, restored on close');
ok(/\}, \[modalMode\]\);/.test(m),'scroll lock tied to modalMode (covers New/Edit/Copy)');
ok(/version: 'v55\.83-CP'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CP');
console.log('\nv55.83-CP modal scroll: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
