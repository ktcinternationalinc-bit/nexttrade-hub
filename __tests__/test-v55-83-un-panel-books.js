// v55.83-UN (Codex 21:25) — the Banking & Accounting Access page must show each book exactly as the server decides it. Runs the ACTUAL
// has(), legacyOn() and summary() extracted from BankingAccessPanel.jsx against the shared rule, and compares with the real server resolver.
var path = require('path'); var fs = require('fs'); var vm = require('vm');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var PA = require(path.join(root, 'src/lib/permission-aliases.js'));
var SP = require(path.join(root, 'src/lib/server-permissions.js'));
var pass = 0, failN = 0;
function check(l, c, x) { if (c) { pass++; } else { failN++; } console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : '  ' + JSON.stringify(x === undefined ? '' : x).substring(0, 400))); }
var src = fs.readFileSync(path.join(root, 'src/components/BankingAccessPanel.jsx'), 'utf8');
function grab(sig) { var a = src.indexOf(sig); var i = src.indexOf('{', a); var d = 0, j = i; for (; j < src.length; j++) { if (src[j] === '{') { d++; } else if (src[j] === '}') { d--; if (d === 0) { break; } } } return src.slice(a, j + 1); }
var code = [grab('function has(u, key)'), grab('function legacyOn(x)'), grab('function summary(x)')].join('\n') + '\nmodule.exports = { has: has, legacyOn: legacyOn, summary: summary };';
function panel(perms) {
  var ctx = { module: {}, permissions: perms, effectiveSwitch: PA.effectiveSwitch, BANKING_KEYS: ['accounting.view'], grantFor: function () { return null; }, Object: Object };
  vm.runInNewContext(code, ctx); return ctx.module.exports;
}
function server(perms, perm) { var mp = {}, deny = {}; Object.keys(perms.u).forEach(function (k) { (perms.u[k] ? mp : deny)[k] = true; }); return SP.userHasPermission({ role: 'staff', isSuperAdmin: false, mp: mp, deny: deny }, perm); }
var U = { id: 'u', role: 'staff' };
var CB = 'accounting.clickbooks.access', WV = 'accounting.wavehub.access', OLD = 'accounting.view';
var cases = [
  { name: 'ClickBooks ON, Wave OFF, old switch OFF', p: { [CB]: true, [WV]: false, [OLD]: false }, sum: 'ClickBooks', legacy: false },
  { name: 'Wave ON, ClickBooks OFF, old switch OFF', p: { [WV]: true, [CB]: false, [OLD]: false }, sum: 'Wave', legacy: false },
  { name: 'ClickBooks ON only (nothing else stored)', p: { [CB]: true }, sum: 'ClickBooks', legacy: false },
  { name: 'both books OFF', p: { [CB]: false, [WV]: false }, sum: 'no books', legacy: false },
  { name: 'old both-hubs switch ON only', p: { [OLD]: true }, sum: 'ClickBooks · Wave', legacy: true },
  { name: 'old switch ON but Wave turned OFF', p: { [OLD]: true, [WV]: false }, sum: 'ClickBooks', legacy: true }
];
console.log('UN — the access page shows each book as the server decides it');
cases.forEach(function (c) {
  var P = panel({ u: c.p });
  var pageCB = P.has(U, CB), pageWV = P.has(U, WV);
  check(c.name + ': summary "' + c.sum + '", page and server agree on each book, old-switch banner ' + (c.legacy ? 'shown' : 'hidden'),
    P.summary(U) === c.sum && pageCB === server({ u: c.p }, CB) && pageWV === server({ u: c.p }, WV) && P.legacyOn(U) === c.legacy,
    { summary: P.summary(U), pageCB: pageCB, srvCB: server({ u: c.p }, CB), pageWV: pageWV, srvWV: server({ u: c.p }, WV), legacy: P.legacyOn(U) });
});
check('ClickBooks-only + old OFF: Accounting entry is ON on the server (the UN fix) while Wave stays closed', server({ u: { [CB]: true, [OLD]: false } }, OLD) === true && server({ u: { [CB]: true, [WV]: false, [OLD]: false } }, WV) === false);
var P2 = panel({ u: { [CB]: true, [OLD]: true } }); var P3 = panel({ u: { [CB]: true, [OLD]: false } });
check('retiring the old switch: banner shown while it is stored ON, gone after it is turned OFF (and ClickBooks still shows)', P2.legacyOn(U) === true && P3.legacyOn(U) === false && P3.summary(U) === 'ClickBooks');
check('the prerequisites use each book by itself (no OR with the combined Accounting entry)', /var ktc = u && \(boss \|\| has\(u, 'accounting\.clickbooks\.access'\)\);/.test(src) && !/has\(u, 'accounting\.view'\)/.test(src));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
