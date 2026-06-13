var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryProductMaster.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/import \{ createPortal \} from 'react-dom'/.test(r),'createPortal imported');
ok(/modalMode && typeof document !== 'undefined' && createPortal\(\(/.test(r),'modal rendered via portal to escape transformed ancestors');
ok(/\), document\.body\)\}/.test(r),'portal targets document.body');
ok(/maxHeight: 'calc\(100vh - 32px\)', display: 'flex', flexDirection: 'column'/.test(r),'container clamps to viewport height, flex column');
ok(/padding: 20, overflowY: 'auto', flex: '1 1 auto', minHeight: 0/.test(r),'body scrolls');
ok(/flexShrink: 0[^]*?Add Product|Save Changes/.test(r) || /border-t border-slate-200 bg-slate-50 rounded-b-2xl[^]*?flexShrink: 0/.test(r),'footer pinned (flexShrink 0)');
ok(/document\.body\.style\.overflow = 'hidden'/.test(r),'body scroll-lock retained');
ok(/version: 'v55\.83-DN'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DN');
console.log('\nv55.83-DN modal portal: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
