// v55.83-TH — Max, Nov 16: "both approved so status should be wire ready not remain as pre-wire check it".
// The wires LIST loaded each bill without validation_status, so every bill read as NOT-VALIDATED in the list's fingerprint and
// a fully signed wire showed "PRE-WIRE · Check it". Run: node __tests__/test-v55-83-th-wire-list-status.js
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var W = require(path.join(root, 'src/lib/wire-audit.js'));
var pass = 0; var failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

// a full bill row, as the detail view loads it (select *)
var full = { id: 'b1', vendor_name: 'NexPac Corporation', bill_number: '14352', release_number: '1001-1567', total_amount: 14256.84, record_status: 'active', validation_status: 'validated', other_reference: '80207445', shipment_direction: 'inbound', bill_date: '2026-06-03', category: 'x', paid_via: 'RTM Capital' };
var pkg = { id: 'p6', seq: 6, payee_kind: 'service_provider', payee_name: 'RTM Capital', fee_amount: 0 };
var lines = [{ bill_id: 'b1', amount: 14256.84, bill: full }];
var signedHash = W.packageFingerprint(pkg, lines);
var signedPkg = Object.assign({}, pkg, { status: 'draft', checked_at: '2026-11-16T16:45:00Z', check_hash: signedHash, check_pass: true, signoff1_by: 'u1', signoff1_hash: signedHash, signoff2_by: 'u2', signoff2_hash: signedHash });

// what the list now loads: only the fingerprint fields
var listed = {}; W.WIRE_FINGERPRINT_BILL_FIELDS.split(',').forEach(function (f) { f = f.trim(); listed[f] = full[f]; });
var listHash = W.packageFingerprint(pkg, [{ bill_id: 'b1', amount: 14256.84, bill: listed }]);
check('list fingerprint = signed fingerprint', listHash === signedHash, { listHash: listHash, signedHash: signedHash });
check('both signed → list shows READY TO SEND (not PRE-WIRE · Check it)', W.packageStatus(signedPkg, listHash, 0) === 'ready_to_send', W.packageStatus(signedPkg, listHash, 0));

// the old list query (the bug): no validation_status / other_reference / direction
var old = { id: 'b1', vendor_name: full.vendor_name, bill_number: full.bill_number, release_number: full.release_number, total_amount: full.total_amount, record_status: 'active' };
var oldHash = W.packageFingerprint(pkg, [{ bill_id: 'b1', amount: 14256.84, bill: old }]);
check('(the bug, reproduced) the old list fields gave a different fingerprint → "needs check"', oldHash !== signedHash && W.packageStatus(signedPkg, oldHash, 0) === 'needs_check');

// a real change after signing still clears the signatures (the safety stays)
var changed = Object.assign({}, listed, { validation_status: 'pending' });
check('a bill whose validation is reopened after signing → signatures no longer count', W.packageStatus(signedPkg, W.packageFingerprint(pkg, [{ bill_id: 'b1', amount: 14256.84, bill: changed }]), 0) === 'needs_check');
var edited = Object.assign({}, listed, { total_amount: 15000 });
check('a bill amount edited after signing → signatures no longer count', W.packageStatus(signedPkg, W.packageFingerprint(pkg, [{ bill_id: 'b1', amount: 14256.84, bill: edited }]), 0) === 'needs_check');

// every field the fingerprint reads is in the shared list
var src = fs.readFileSync(path.join(root, 'src/lib/wire-audit.js'), 'utf8');
var fpBody = src.slice(src.indexOf('export function wireFingerprint'), src.indexOf('export function auditWire'));
var used = {}; (fpBody.match(/\bb\.([a-z_]+)/g) || []).forEach(function (m) { used[m.slice(2)] = true; });
var listedF = W.WIRE_FINGERPRINT_BILL_FIELDS.split(',').map(function (x) { return x.trim(); });
var missing = Object.keys(used).filter(function (f) { return listedF.indexOf(f) < 0; });
check('every bill field the fingerprint reads is in WIRE_FINGERPRINT_BILL_FIELDS', missing.length === 0, missing);
var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/wire-packages/route.js'), 'utf8');
check('the wires list query uses that shared field list', /inChunks\(db, 'vendor_bills', WIRE_FINGERPRINT_BILL_FIELDS, 'id', bIds\)/.test(route));

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
