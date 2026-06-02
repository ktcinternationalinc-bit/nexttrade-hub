var fs=require('fs');
var s=fs.readFileSync('src/components/InventoryReceiving.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }
ok('dropdown z raised to z-[90]', /absolute z-\[90\] left-0 right-0/.test(s));
ok('container elevated while open', /relative ' \+ \(line\.showSuggestions && suggestions\.length > 0 \? 'z-\[80\]'/.test(s));
ok('line card no longer overflow-hidden (dropdown not clipped)', !/rounded-xl mb-4 shadow-md overflow-hidden/.test(s));
ok('header keeps rounded top', /from-indigo-600 to-indigo-700 rounded-t-xl/.test(s));
ok('old z-10 dropdown gone', !/absolute z-10 left-0 right-0 mt-1 bg-white border-2 border-indigo-300/.test(s));
if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — search dropdown renders in front, not clipped ('+5+' checks)');
