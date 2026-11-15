// v55.83-I — "Delete Shipping Rates" permission for single-rate deletion.
var fs = require('fs'); var path = require('path');
function read(rel){return fs.readFileSync([path.join(__dirname,'..',rel),'/home/claude/hub/'+rel].find(function(p){try{return fs.existsSync(p);}catch(e){return false;}}),'utf8');}
var fails=0; function ok(n,c){ if(c) console.log('\u2713 '+n); else { console.log('\u2717 '+n); fails++; } }

console.log('\n== permission registered in admin grid ==');
var set = read('src/components/SettingsTab.jsx');
ok("ACTION_PERMS has 'Delete Shipping Rates'", /key: 'Delete Shipping Rates'/.test(set));

console.log('\n== ShippingRatesTab wiring ==');
var sr = read('src/components/ShippingRatesTab.jsx');
ok('accepts canDeleteRates prop', /function ShippingRatesTab\(\{[^}]*canDeleteRates[^}]*\}\)/.test(sr));
ok('computes canDeleteRate with isAdmin fallback', /const canDeleteRate = canDeleteRates !== undefined \? !!canDeleteRates : !!isAdmin;/.test(sr));
ok('Del button gated on canDeleteRate (not isAdmin)', /\{canDeleteRate && <button onClick=\{\(\) => handleDeleteRate\(r\)\}/.test(sr));
ok('Del button no longer gated on bare isAdmin', !/\{isAdmin && <button onClick=\{\(\) => handleDeleteRate\(r\)\}/.test(sr));

console.log('\n== page.jsx passes the prop ==');
var pg = read('src/app/page.jsx');
ok('passes canDeleteRates = admin OR permission', /canDeleteRates=\{isAdmin \|\| \(modulePerms && modulePerms\['Delete Shipping Rates'\] === true\)\}/.test(pg));

console.log('\n== behavioral: gate logic ==');
function gate(canDeleteRates, isAdmin){ return canDeleteRates !== undefined ? !!canDeleteRates : !!isAdmin; }
ok('non-admin WITH permission can delete', gate(true, false) === true);
ok('non-admin WITHOUT permission cannot', gate(false, false) === false);
ok('admin still can (prop true via isAdmin||perm)', gate(true, true) === true);
ok('prop undefined falls back to isAdmin (back-compat)', gate(undefined, true) === true && gate(undefined, false) === false);

console.log('\n'+(fails===0?'ALL PASS':(fails+' FAILED')));
process.exit(fails===0?0:1);
