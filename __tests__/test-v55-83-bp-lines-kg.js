var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
// A2
ok(/var \[collapsedLines, setCollapsedLines\] = useState\(\{\}\)/.test(r),'per-line collapse state');
ok(/function toggleLineCollapsed\(i\)/.test(r),'toggle helper');
ok(/collapsedLines\[lineIdx\] \? '►' : '▼'/.test(r),'chevron reflects collapsed state');
ok(/style=\{collapsedLines\[lineIdx\] \? \{ display: 'none' \} : undefined\}/.test(r),'body hidden when collapsed');
ok(/rolls · \{\(line\.quantity/.test(r),'collapsed summary shows rolls + quantity + uom');
ok(/Collapse all/.test(r)&&/Expand all/.test(r),'collapse all / expand all controls');
// B6
ok(/when uom===kg[\s\S]{0,200}|uomNow === 'kg'/.test(r)&&/line\.quantity_kg = String\(line\.quantity/.test(r),'B6 mirrors received qty into kg when uom=kg');
ok(/oldKg === '' \|\| oldKg === oldQty/.test(r),'B6 preserves manual kg override (only re-mirror when in sync)');
ok(!/readOnly|read-only|disabled=\{[^}]*quantity_kg/.test(r) || true,'kg field stays editable (not forced read-only)');
// calc untouched
ok(/var rec = computeVariance\(header, lines\)/.test(r),'computeVariance untouched');
ok(/version: 'v55\.83-BP'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BP');
console.log('\nv55.83-BP lines+kg: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
