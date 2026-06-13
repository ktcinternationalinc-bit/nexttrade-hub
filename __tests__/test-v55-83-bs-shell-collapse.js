var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/var \[shellCollapsed, setShellCollapsed\] = useState\(false\)/.test(r),'shell collapse state default expanded');
ok(/setShellCollapsed\(!shellCollapsed\)/.test(r)&&/shellCollapsed \? 'Expand ▾' : 'Collapse ▴'/.test(r),'shell collapse toggle');
ok(/shellCollapsed && \([\s\S]{0,200}Expected: \{header\.expected_total_rolls/.test(r),'collapsed shell shows one-line summary');
ok(/<div style=\{shellCollapsed \? \{ display: 'none' \} : undefined\}>/.test(r),'shell body hidden when collapsed');
ok(/var rec = computeVariance\(header, lines\)/.test(r),'reconciliation untouched');
ok(/var \[collapsedLines/.test(r)&&/includeTemplates/.test(r),'A2 + B5 still present');
ok(/version: 'v55\.83-BS'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BS');
console.log('\nv55.83-BS shell collapse: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
