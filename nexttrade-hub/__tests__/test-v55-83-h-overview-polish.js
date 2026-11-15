// v55.83-H — Inventory Overview visual polish (restyle only; no logic).
var fs = require('fs'); var path = require('path');
var ov = fs.readFileSync([path.join(__dirname,'..','src/components/InventoryOverview.jsx'),'/home/claude/hub/src/components/InventoryOverview.jsx'].find(function(p){try{return fs.existsSync(p);}catch(e){return false;}}),'utf8');
var fails=0; function ok(n,c){ if(c) console.log('\u2713 '+n); else { console.log('\u2717 '+n); fails++; } }

ok('more breathing room (space-y-5)', /<div className="space-y-5">/.test(ov));
ok('header is borderless (no slate-900 banner box)', !/bg-slate-900 text-white rounded-lg px-4 py-3 border border-slate-700\/50/.test(ov));
ok('header has a description line', /Stock, landed cost, and profitability across warehouses\./.test(ov));
ok('KPI cards unified to dark theme (no bg-white card)', !/bg-white border border-slate-300 rounded-lg px-3 py-2\.5 shadow-sm/.test(ov));
ok('KPI cards high-contrast dark', /bg-slate-900\/70 border border-slate-700\/60 rounded-xl px-4 py-3\.5/.test(ov));
ok('toolbar unified to dark', !/bg-white border-2 border-slate-300 rounded-lg p-3 flex flex-wrap/.test(ov));
ok('search input readable on dark', /bg-slate-800 text-slate-100 placeholder-slate-500/.test(ov));
ok('classification filters collapsed by default (open only when active)', /<details[^>]*open=\{activeFilterCount > 0\}>/.test(ov));
ok('single consolidated Stock Summary card', /Stock Summary — v55\.83-H polish/.test(ov));
ok('stock summary is one table (Unit/Current/Original/Sold)', /Stock Summary<\/span>[\s\S]{0,400}>Unit<[\s\S]{0,200}>Current<[\s\S]{0,200}>Original<[\s\S]{0,200}>Sold</.test(ov));
ok('old separate per-unit blocks removed', !/available for sale in \{unitLabel/.test(ov));
ok('financial footer inside the card (seeCosts)', /divide-x divide-slate-800 border-t border-slate-700\/60/.test(ov) && /text-amber-300">Revenue/.test(ov) && /text-orange-300">COGS/.test(ov) && /Gross Profit<\/div>/.test(ov));
ok('NOT using ghost/low-opacity for numbers (contrast kept)', !/text-slate-300 opacity-60/.test(ov));

console.log('\n'+(fails===0?'ALL PASS':(fails+' FAILED')));
process.exit(fails===0?0:1);
