var fs=require('fs');
var s=fs.readFileSync('src/components/InventoryReceiving.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }

// UoM dropdown now has kg
ok('expected UOM dropdown includes kg', /<option value="kg">kg<\/option>/.test(s));

// actual totals read from line fields
ok('rolls actual from line roll_count', /Number\(L\.roll_count \|\| 0\)/.test(s));
ok('gross actual from line quantity_kg', /Number\(L\.quantity_kg \|\| 0\)/.test(s));
ok('uom actual from line quantity', /totals\.uom \+= Number\(L\.quantity \|\| 0\)/.test(s));
ok('still adds per-roll details as fallback (max of typed vs added)', /Math\.max\(lineRolls, addedRolls\)/.test(s) && /Math\.max\(lineGross, addedGross\)/.test(s));

// net removed everywhere it would break
ok('computeActualTotals has no net key', !/var totals = \{ rolls: 0, gross: 0, net: 0/.test(s));
ok('variance object has no net', !/net:   expectedNet/.test(s));
ok('no actual.net / variance.net display refs', !/rec\.actual\.net/.test(s) && !/rec\.variance\.net/.test(s));
ok('Net kg summary box removed', !/uppercase">Net kg<\/div>/.test(s));
ok('variance_net_kg payload nulled (not referencing removed field)', /variance_net_kg   = null;/.test(s));

// no API-route rules apply here (component), but keep style sane: balanced braces
var o=(s.match(/\(/g)||[]).length,c=(s.match(/\)/g)||[]).length,a=(s.match(/\{/g)||[]).length,b=(s.match(/\}/g)||[]).length;
ok('braces/parens balanced', o===c && a===b);

if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — receiving reconciliation (kg dropdown + line-based actuals + net removed) '+11+' checks');
