var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/var \[varExpanded, setVarExpanded\] = useState\(false\)/.test(r),'variance panel collapsed by default');
ok(/if \(!varExpanded\) \{[\s\S]{0,400}Reconciliation Variance —/.test(r),'collapsed status bar with variance one-liner');
ok(/Expand ▾/.test(r)&&/Collapse ▴/.test(r),'Expand + Collapse controls');
ok(/async function submitReceipt\(\) \{\s*setVarExpanded\(true\)/.test(r),'auto-expand on Submit');
ok(/onClick=\{function \(\) \{ setVarExpanded\(true\); saveReceipt\(\); \}\}/.test(r),'auto-expand on Save Draft');
ok(/function vtxt\(v, dec\)/.test(r),'variance delta formatter for status bar');
// calculations untouched: computeVariance still drives the cards
ok(/var rec = computeVariance\(header, lines\)/.test(r),'computeVariance still drives panel (math untouched)');
ok(/Actual: \{rec\.actual\.rolls\}/.test(r)&&/Expected: \{header\.expected_total_rolls/.test(r),'expanded grid cards intact');
ok(/version: 'v55\.83-BO'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BO');
console.log('\nv55.83-BO variance collapse: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
