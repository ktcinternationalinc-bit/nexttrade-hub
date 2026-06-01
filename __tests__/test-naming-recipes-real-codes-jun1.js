var fs=require('fs');
var pm=fs.readFileSync('src/components/InventoryProductMaster.jsx','utf8');
var ip=fs.readFileSync('src/components/InventoryImportProducts.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }
ok('PM L = 6-field backing-before-color', /'L':\s*\[1, 2, 3, 4, 5, 6\]/.test(pm));
ok('PM T = 6-field', /'T':\s*\[1, 2, 3, 4, 5, 6\]/.test(pm));
ok('PM P = 8-field color-before-backing', /'P':\s*\[1, 2, 3, 4, 6, 5, 7, 8\]/.test(pm));
ok('PM B = 8-field', /'B':\s*\[1, 2, 3, 4, 6, 5, 7, 8\]/.test(pm));
ok('IP L = 6-field', /'L':\s*\[1, 2, 3, 4, 5, 6\]/.test(ip));
ok('IP P = 8-field', /'P':\s*\[1, 2, 3, 4, 6, 5, 7, 8\]/.test(ip));
ok('prefix-match guarded to 2+ chars', /k\.length >= 2 && familyCode\.indexOf\(k\) === 0/.test(pm));
ok('no stale [2, 3, 6, 5]', !/\[2, 3, 6, 5\]/.test(pm) && !/\[2, 3, 6, 5\]/.test(ip));
if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — naming recipes on real codes ('+8+' checks)');
