// ═══════════════════════════════════════════════════════════════════════════
// v55.83-WV — Max, 21 Nov: "i need to enter the actual date of the wire which may not be the same day as today. Also be able to
// edit that field in the previous wires i created." + "it should be able to read the pdf or screenshot to update the reference and
// the screenshot and the sent on dates" + "a column ... wire creation (in system) and a column when it was actually sent".
// Runs the REAL wire-packages route on an in-memory database (private file storage and the AI answer stubbed): the wire date on a
// signed wire (signatures stay), refusals, the sent-date change rules, reading a confirmation (PDF and screenshot), mark-as-sent
// keeping what was read, one Eastern business date late in the evening, and the screen's answer-merging rules.
// Fixture names / amounts are made up.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var B1 = 'b0000000-0000-0000-0000-0000000000a1'; var B2 = 'b0000000-0000-0000-0000-0000000000a2'; var B3 = 'b0000000-0000-0000-0000-0000000000a3';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true }, { id: 'u2', name: 'Checker', role: 'staff', active: true }, { id: 'u3', name: 'Viewer', role: 'staff', active: true }],
  module_permissions: [].concat(
    ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.view'].map(function (k) { return { user_id: 'u3', module_name: k, has_access: true }; })),
  vendor_bills: [
    { id: B1, vendor_name: 'Acme Freight', bill_number: 'AF-1', release_number: '1002-001', total_amount: 600, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-06-01', shipment_direction: 'outbound' },
    { id: B3, vendor_name: 'Acme Freight', bill_number: 'AF-3', release_number: '1002-003', total_amount: 250, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-06-03', shipment_direction: 'outbound' },
    { id: B2, vendor_name: 'Acme Freight', bill_number: 'AF-2', release_number: '1002-002', total_amount: 400, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-06-02', shipment_direction: 'outbound' },
  ],
  vendor_bill_payments: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], hub_audit_log: [], paid_through_parties: [], bank_transactions: [],
});
// like the database lock (RH/SP wpkg_lock): a sent date changes only while the wire is 'sent'
db.hooks = { wire_packages: { update: function (row, p) { if (p.sent_date !== undefined && p.sent_date !== row.sent_date && row.status !== 'sent' && row.status !== 'draft') { return 'WIRE_PACKAGE_LOCKED: the sent date can only be corrected before the bank line is attached'; } } } };
// the private bucket: what the screen uploaded
var files = {};
db.storage = { from: function (bucket) { return { download: function (p) { var f = files[bucket + '/' + p]; return Promise.resolve(f ? { data: f, error: null } : { data: null, error: { message: 'Object not found' } }); } }; } };
function fakeFile(type, n) { var buf = Buffer.alloc(n || 400, 7); return { type: type, size: buf.length, arrayBuffer: function () { return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); } }; }
// the AI: answers what the next test wants; every request is kept to check what was sent
var aiAnswer = null; var aiCalls = [];
global.fetch = function (url, init) {
  aiCalls.push({ url: url, body: JSON.parse(init.body), headers: init.headers });
  var a = typeof aiAnswer === 'function' ? aiAnswer(aiCalls.length) : aiAnswer;
  return Promise.resolve({ json: function () { return Promise.resolve(a); } });
};
function aiText(obj) { return { content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' }; }
var orig = Module._resolveFilename;
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  return orig.apply(this, arguments);
};
global.__db = db;
db.rpcs = Object.assign({}, db.rpcs || {}, { hub_payment_guards_installed: function () { return true; } });
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var WC = require(path.join(root, 'src/lib/wire-confirmation.js'));
var ET = require(path.join(root, 'src/lib/et-time.js'));
async function callRaw(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
async function call(user, body) {
  if (body && body.action === 'signoff') { var g = await callRaw(user, { action: 'get', id: body.id }); if (g && g.ok) { for (var i = 0; i < g.lines.length; i++) { await callRaw(user, { action: 'review_bill', id: body.id, bill_id: g.lines[i].bill_id }); } } }
  return callRaw(user, body);
}
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; process.exitCode = 1; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
function pk(id) { return db.t.wire_packages.filter(function (x) { return x.id === id; })[0]; }
function auditOf(action, id) { return db.t.hub_audit_log.filter(function (a) { return a.action === action && String(a.entity_id) === String(id); }); }
function dayAdd(iso, n) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().substring(0, 10); }
// freeze "now" for one block (late evening in the US: Eastern still the 21st, UTC already the 22nd)
var RealDate = Date;
function freeze(iso) { var t = new RealDate(iso).getTime(); global.Date = class extends RealDate { constructor() { if (arguments.length) { super(...arguments); } else { super(t); } } static now() { return t; } }; }
function unfreeze() { global.Date = RealDate; }

console.log('WV — the real wire date, editing it on past wires, reading the bank confirmation');
(async function () {
  // ── a vendor wire prepared with its real (past) wire date, then signed by two people
  var sv = await call('u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', planned_send_date: '2026-07-10', lines: [{ bill_id: B1, amount: '600' }, { bill_id: B2, amount: '400' }] });
  check('prepare: a vendor wire is saved WITH its wire date (it used to be requests only)', sv.ok && pk(sv.id) && pk(sv.id).planned_send_date === '2026-07-10', sv);
  var id = sv.id;
  var badPrep = await call('u1', { action: 'save_draft', id: id, payee_kind: 'vendor', payee_name: '', planned_send_date: '2026-02-30', lines: [{ bill_id: B1, amount: '600' }, { bill_id: B2, amount: '400' }] });
  check('prepare: a date that does not exist (30 Feb) is refused with a plain sentence', !badPrep.ok && /not a real date/.test(badPrep.error), badPrep);
  var s1 = await call('u2', { action: 'signoff', id: id, note: 'checked both bills' });
  var s2 = await call('u1', { action: 'signoff', id: id, note: 'verified totals' });
  var g0 = await call('u1', { action: 'get', id: id });
  check('two signatures → ready to send, the wire date shows on the wire', s1.ok && s2.ok && s2.approved === true && g0.package.status === 'ready_to_send' && g0.package.planned_send_date === '2026-07-10' && !!g0.package.created_at, [s1, s2, g0.package && g0.package.status]);

  // ── editing the wire date of a wire already signed (Max's WP-0008…0014 case)
  var wd = await call('u1', { action: 'set_wire_date', id: id, wire_date: '2026-07-13', reason: 'bank sent it on the 13th' });
  var g1 = await call('u1', { action: 'get', id: id });
  check('set_wire_date on a SIGNED wire: saved, and it is STILL ready to send (the date is not part of what was signed)', wd.ok && wd.from === '2026-07-10' && wd.to === '2026-07-13' && g1.package.status === 'ready_to_send' && g1.package.planned_send_date === '2026-07-13' && g1.audit.signoff1 && g1.audit.signoff1.valid && g1.audit.signoff2 && g1.audit.signoff2.valid, [wd, g1.package && g1.package.status]);
  var aw = auditOf('wire_date_changed', id);
  check('… audited: old and new date, that it was signed, the reason, who', aw.length === 1 && aw[0].details.from === '2026-07-10' && aw[0].details.to === '2026-07-13' && aw[0].details.signed === true && /13th/.test(aw[0].details.reason) && aw[0].actor_id === 'u1', aw);
  var same = await call('u1', { action: 'set_wire_date', id: id, wire_date: '2026-07-13' });
  check('the same date again → "nothing to change", no second audit row', !same.ok && /already 2026-07-13/.test(same.error) && auditOf('wire_date_changed', id).length === 1, same);
  var bad = await call('u1', { action: 'set_wire_date', id: id, wire_date: '2026-13-01' });
  check('a date that does not exist → refused, nothing changed', !bad.ok && /not a real date/.test(bad.error) && pk(id).planned_send_date === '2026-07-13', bad);
  var noPerm = await call('u3', { action: 'set_wire_date', id: id, wire_date: '2026-07-14' });
  check('someone with "Wires: View" only → 403, plain words naming the switch, nothing changed', !noPerm.ok && noPerm._status === 403 && /Wires: Prepare/.test(noPerm.error) && pk(id).planned_send_date === '2026-07-13', noPerm);
  var notSentYet = await call('u1', { action: 'set_sent_date', id: id, sent_date: '2026-07-13', reason: 'trying the wrong button' });
  check('a wire not marked sent: "change the sent date" says to use the wire date instead (409)', !notSentYet.ok && notSentYet._status === 409 && /not marked sent yet/.test(notSentYet.error), notSentYet);
  var lst = await call('u1', { action: 'list' });
  var row = (lst.packages || []).filter(function (p) { return p.id === id; })[0];
  check('the list carries BOTH dates apart: created in the Hub, and (not sent yet) only the planned wire date — no sent date', row && !!row.created_at && row.planned_send_date === '2026-07-13' && !row.sent_date, row);

  // ── WQ (verified identity) covers the new actions too: without a valid sign-in both are refused before anything runs
  var nt1 = await callRaw('u1', { action: 'set_wire_date', id: id, wire_date: '2026-07-20', _no_token: true });
  var nt2 = await callRaw('u1', { action: 'read_confirmation', id: id, proof_path: 'pv/wire-' + id + '-1-confirmation.pdf', _no_token: true });
  check('no valid sign-in → set_wire_date and read_confirmation refused (401), nothing changed, the AI not called', nt1._status === 401 && nt2._status === 401 && pk(id).planned_send_date === '2026-07-13' && aiCalls.length === 0, [nt1, nt2]);
  // ── reading the bank's confirmation
  var today = ET.todayET();
  var pathPdf = 'pv/wire-' + id + '-1-confirmation.pdf';
  files['bills-private/' + pathPdf] = fakeFile('application/pdf');
  var off = await call('u1', { action: 'read_confirmation', id: id, proof_path: pathPdf });
  check('AI not switched on → a plain sentence; typing by hand still works', !off.ok && off._status === 503 && /type the reference and pick the date yourself/.test(off.error), off);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  var rdNoPerm = await call('u2', { action: 'read_confirmation', id: id, proof_path: pathPdf });
  check('reading needs "Wires: Send" (a signer without it → 403), the AI is not called', !rdNoPerm.ok && rdNoPerm._status === 403 && aiCalls.length === 0, rdNoPerm);
  var wrong = await call('u1', { action: 'read_confirmation', id: id, proof_path: 'pv/wire-someother-1-x.pdf' });
  var wrong2 = await call('u1', { action: 'read_confirmation', id: id, proof_path: 'pv/wire-' + id + '-../../secret.pdf' });
  check('a file that is not this wire\'s upload (other wire, or a path trick) → refused before anything is read', !wrong.ok && !wrong2.ok && /not a confirmation attached to this wire/.test(wrong.error) && aiCalls.length === 0, [wrong, wrong2]);
  var missing = await call('u1', { action: 'read_confirmation', id: id, proof_path: 'pv/wire-' + id + '-9-gone.pdf' });
  check('a file that is not in storage → "attach it again"', !missing.ok && /attach it again/.test(missing.error), missing);
  var before = JSON.stringify(pk(id)); var filesBefore = db.t.wire_package_files.length;
  aiAnswer = aiText({ is_wire_confirmation: true, reference: '00012345', transaction_number: '98765432100', status: 'Sent', sent_date: '2026-07-13', amount: 1000, currency: 'USD', beneficiary: 'ACME FREIGHT CORPORATION' });
  var rd = await call('u1', { action: 'read_confirmation', id: id, proof_path: pathPdf });
  var req1 = aiCalls[aiCalls.length - 1];
  check('a PDF confirmation is read: reference (+ transaction number), wire date, amount, recipient', rd.ok && rd.read.reference === '00012345' && rd.read.transaction_number === '98765432100' && rd.read.sent_date === '2026-07-13' && rd.read.amount === 1000 && rd.read.beneficiary === 'ACME FREIGHT CORPORATION', rd);
  check('… the boxes to fill: reference keeps leading zeros and the transaction number; the sent date; NO warning (amount and payee match)', rd.fill.reference === '00012345 / txn 98765432100' && rd.fill.sent_date === '2026-07-13' && rd.warnings.length === 0, rd);
  check('… the file went to the AI as a PDF document block, from the private file (not from the request)', req1 && req1.body.messages[0].content[0].type === 'document' && req1.body.messages[0].content[0].source.media_type === 'application/pdf' && req1.body.messages[0].content[0].source.data.length > 100 && /Wire date/.test(req1.body.messages[0].content[1].text), req1 && req1.body.messages[0].content[0].type);
  check('… reading never touches the wire: the wire, its files and its status are unchanged', JSON.stringify(pk(id)) === before && db.t.wire_package_files.length === filesBefore && pk(id).status === 'draft', null);
  var ar = auditOf('wire_confirmation_read', id);
  check('… what the SERVER read is kept in the audit (path + read + what was filled) — the only write', ar.length === 1 && ar[0].details.path === pathPdf && ar[0].details.read.reference === '00012345' && ar[0].details.fill.sent_date === '2026-07-13', ar);
  var pathPng = 'pv/wire-' + id + '-2-screenshot.png';
  files['bills-private/' + pathPng] = fakeFile('', 400); // the bucket gave no type: the file name decides
  aiAnswer = aiText({ is_wire_confirmation: true, reference: '00012345', status: 'Pending', sent_date: dayAdd(today, 2), amount: '1,250.00', currency: 'USD', beneficiary: 'Someone Else Ltd' });
  var rd2 = await call('u1', { action: 'read_confirmation', id: id, proof_path: pathPng });
  var req2 = aiCalls[aiCalls.length - 1];
  check('a screenshot (PNG) goes as an image block', req2.body.messages[0].content[0].type === 'image' && req2.body.messages[0].content[0].source.media_type === 'image/png', req2.body.messages[0].content[0].type);
  check('mismatches are SHOWN, not filled: a future date is not filled; different amount, other recipient, "Pending" are warned', rd2.ok && !rd2.fill.sent_date && rd2.fill.reference === '00012345'
    && rd2.warnings.some(function (w) { return /in the future/.test(w); }) && rd2.warnings.some(function (w) { return /\$1250\.00 but this wire is \$1000\.00/.test(w); })
    && rd2.warnings.some(function (w) { return /Someone Else Ltd/.test(w); }) && rd2.warnings.some(function (w) { return /Pending/.test(w); }), rd2);
  aiAnswer = aiText({ is_wire_confirmation: true, reference: 'EU-777', sent_date: '2026-07-13', amount: 1000, currency: 'EUR', beneficiary: 'Acme Freight' });
  var rd3 = await call('u1', { action: 'read_confirmation', id: id, proof_path: pathPdf });
  check('another currency: the same number is NOT called a match — "cannot be compared", check by hand', rd3.ok && rd3.warnings.some(function (w) { return /EUR, not USD — its amount cannot be compared/.test(w); }) && !rd3.warnings.some(function (w) { return /but this wire is/.test(w); }), rd3);
  aiAnswer = function (n) { return n % 2 === 1 ? { error: { message: 'overloaded' } } : aiText({ is_wire_confirmation: false, reference: null, sent_date: null, amount: null }); };
  var rd4 = await call('u1', { action: 'read_confirmation', id: id, proof_path: pathPdf });
  check('first model fails → the second answers; "not a wire confirmation" and nothing readable are said plainly', rd4.ok && rd4.warnings.some(function (w) { return /does not look like a bank wire confirmation/.test(w); }) && rd4.warnings.some(function (w) { return /No wire reference/.test(w); }) && !rd4.fill.reference && !rd4.fill.sent_date, rd4);
  aiAnswer = { content: [{ type: 'text', text: 'I cannot help with that.' }], stop_reason: 'end_turn' };
  var rd5 = await call('u1', { action: 'read_confirmation', id: id, proof_path: pathPdf });
  check('an answer that is not the JSON asked for → refused (422), typing by hand still offered', !rd5.ok && rd5._status === 422 && /type the reference/i.test(rd5.error), rd5);

  // ── marking sent: one Eastern business date, and what was read kept with it
  var fut = await call('u1', { action: 'mark_sent', id: id, sent_date: dayAdd(today, 1), bank_reference: '00012345', proof_path: pathPdf, proof_name: 'c.pdf' });
  check('mark sent with tomorrow (Eastern) → refused, still not sent', !fut.ok && /in the future/.test(fut.error) && pk(id).status === 'draft', fut);
  freeze('2026-11-22T02:30:00Z'); // 9:30 pm on 21 Nov in New York, already 22 Nov in UTC
  var lateFut = await call('u1', { action: 'mark_sent', id: id, sent_date: '2026-11-22', bank_reference: '00012345', proof_path: pathPdf, proof_name: 'c.pdf' });
  unfreeze();
  check('late evening (21 Nov 9:30 pm Eastern = 22 Nov UTC): "22 Nov" is refused as the future — the server uses the SAME Eastern day as the screen', !lateFut.ok && /in the future/.test(lateFut.error) && pk(id).status === 'draft', lateFut);
  aiAnswer = aiText({ is_wire_confirmation: true, reference: '00012345', transaction_number: '98765432100', status: 'Sent', sent_date: '2026-07-13', amount: 1000, currency: 'USD', beneficiary: 'ACME FREIGHT CORPORATION' });
  var reread = await call('u1', { action: 'read_confirmation', id: id, proof_path: pathPdf }); // the last read of this file is a good one again
  var sent = await call('u1', { action: 'mark_sent', id: id, sent_date: '2026-07-13', bank_reference: '00012345 / txn 98765432100', proof_path: pathPdf, proof_name: 'c.pdf', confirmation_read: { reference: 'FORGED', sent_date: '2026-07-13', amount: 1 } });
  var as = auditOf('wire_package_sent', id);
  check('marked SENT with the date read from the confirmation; the same uploaded file is the proof', sent.ok && pk(id).status === 'sent' && pk(id).sent_date === '2026-07-13' && db.t.wire_package_files.filter(function (f) { return f.package_id === id && f.path === pathPdf; }).length === 1, sent);
  check('… the sending is audited with what the SERVER read from this exact file (what the screen sent, "FORGED", is ignored): date and reference as read, the wire date', reread.ok && as.length === 1 && as[0].details.server_read && as[0].details.server_read.reference === '00012345 / txn 98765432100' && as[0].details.server_read.sent_date === '2026-07-13' && as[0].details.date_as_read === true && as[0].details.reference_as_read === true && as[0].details.wire_date === '2026-07-13' && JSON.stringify(as[0].details).indexOf('FORGED') < 0 && as[0].details.read_from_confirmation === undefined, as);
  var lst2 = await call('u1', { action: 'list' });
  var row2 = (lst2.packages || []).filter(function (p) { return p.id === id; })[0];
  check('the list now shows the SENT date (per the confirmation) next to the created date', row2 && row2.sent_date === '2026-07-13' && !!row2.created_at, row2);

  // ── a wire already marked sent: its wire date no longer changes; its SENT date does, by the rules
  var wdSent = await call('u1', { action: 'set_wire_date', id: id, wire_date: '2026-07-12' });
  check('set_wire_date on a SENT wire → 409 pointing to "change the sent date"', !wdSent.ok && wdSent._status === 409 && /change its sent date instead/.test(wdSent.error), wdSent);
  var sdFut = await call('u1', { action: 'set_sent_date', id: id, sent_date: dayAdd(today, 1), reason: 'typo in the date' });
  var sdSame = await call('u1', { action: 'set_sent_date', id: id, sent_date: '2026-07-13', reason: 'typo in the date' });
  var sdBad = await call('u1', { action: 'set_sent_date', id: id, sent_date: '2026-06-31', reason: 'typo in the date' });
  var sdNoWhy = await call('u1', { action: 'set_sent_date', id: id, sent_date: '2026-07-14', reason: '' });
  var sdNoPerm = await call('u2', { action: 'set_sent_date', id: id, sent_date: '2026-07-14', reason: 'typo in the date' });
  check('sent date: future, same date, 31 June, no reason, no "Wires: Send" → each refused with its own sentence; date unchanged',
    !sdFut.ok && /in the future/.test(sdFut.error) && !sdSame.ok && /nothing to change/.test(sdSame.error) && !sdBad.ok && /Pick the date/.test(sdBad.error)
    && !sdNoWhy.ok && /Say why/.test(sdNoWhy.error) && !sdNoPerm.ok && sdNoPerm._status === 403 && pk(id).sent_date === '2026-07-13', [sdFut, sdSame, sdBad, sdNoWhy, sdNoPerm]);
  var sdOk = await call('u1', { action: 'set_sent_date', id: id, sent_date: '2026-07-14', reason: 'the bank executed it on the 14th' });
  var asd = auditOf('wire_sent_date_changed', id);
  check('a real correction: saved, audited old → new with the reason', sdOk.ok && pk(id).sent_date === '2026-07-14' && asd.length === 1 && asd[0].details.from === '2026-07-13' && asd[0].details.to === '2026-07-14' && /14th/.test(asd[0].details.reason), [sdOk, asd]);
  pk(id).status = 'attached';
  var sdAtt = await call('u1', { action: 'set_sent_date', id: id, sent_date: '2026-07-15', reason: 'trying after attach' });
  check('once its bank line is attached → 409 "the wire\'s date is now the bank line\'s date"', !sdAtt.ok && sdAtt._status === 409 && /bank line is already attached/.test(sdAtt.error) && pk(id).sent_date === '2026-07-14', sdAtt);
  pk(id).funding_txn_id = '70000000-0000-0000-0000-0000000000f1';
  var sdReq = await call('u1', { action: 'set_sent_date', id: id, sent_date: '2026-07-15', reason: 'trying on a request' });
  check('a request already sent (drawn from a transfer) → 409 with its own reason', !sdReq.ok && sdReq._status === 409 && /recorded paid on the date of the transfer/.test(sdReq.error), sdReq);
  pk(id).funding_txn_id = null;
  var wdAtt = await call('u1', { action: 'set_wire_date', id: id, wire_date: '2026-07-15' });
  check('set_wire_date on a complete wire → 409 "can no longer change"', !wdAtt.ok && wdAtt._status === 409 && /can no longer change/.test(wdAtt.error), wdAtt);

  // ── clearing the wire date on a draft (a second wire)
  var sv2 = await call('u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', lines: [{ bill_id: B3, amount: '100' }] });
  var noDate = await call('u1', { action: 'set_wire_date', id: sv2.id, wire_date: '' });
  var setD = await call('u1', { action: 'set_wire_date', id: sv2.id, wire_date: '2026-12-01' });
  var clr = await call('u1', { action: 'set_wire_date', id: sv2.id, wire_date: null });
  check('a draft with no wire date: "nothing to clear"; a future date is allowed while not sent (a plan); then cleared, audited to none', sv2.ok && !noDate.ok && /nothing to clear/.test(noDate.error) && setD.ok && clr.ok && clr.to === null && pk(sv2.id).planned_send_date === null && auditOf('wire_date_changed', sv2.id).length === 2, [sv2, noDate, setD, clr]);
  var stale = await callRaw('u1', { action: 'set_wire_date', id: sv2.id, wire_date: '2026-12-02' });
  check('(control) a normal change after that still works', stale.ok, stale);

  // ── the parser and the screen's answer rules (pure)
  var p1 = WC.parseWireConfirmation('Here you go:\n```json\n{"is_wire_confirmation": true, "reference": "  00557000 ", "sent_date": "2026-07-13", "amount": "$1,234.50", "currency": "usd", "beneficiary": "X Co"}\n```');
  check('parser: JSON inside text / code fence, money with $ and commas, currency upper-cased, reference trimmed with its zeros', p1.read && p1.read.reference === '00557000' && p1.read.amount === 1234.5 && p1.read.currency === 'USD', p1);
  var p2 = WC.parseWireConfirmation('{"reference": "Not available", "transaction_number": "5555", "sent_date": "07/13/2026", "amount": "about 5k"}');
  check('parser: "Not available" is no reference (the transaction number takes its place), a US-style date and a vague amount are left empty', p2.read && p2.read.reference === '5555' && p2.read.sent_date === null && p2.read.amount === null, p2);
  check('parser: no JSON at all → error', !!WC.parseWireConfirmation('no idea').error && !!WC.parseWireConfirmation('[1,2]').error, null);
  check('isRealDate: 2026-02-28 yes; 2026-02-30, 2026-13-01, 26-07-13 no', WC.isRealDate('2026-02-28') && !WC.isRealDate('2026-02-30') && !WC.isRealDate('2026-13-01') && !WC.isRealDate('26-07-13'), null);
  var fileA = { name: 'a.pdf' }; var fileB = { name: 'b.png' };
  var st0 = { pkgId: 'P1', file: fileA, date: '2026-11-21', ref: '', typed: {}, reading: true };
  var ans = { ok: true, fill: { reference: 'R-1', sent_date: '2026-07-13' }, read: {}, warnings: [] };
  var stA = WC.applyConfirmationAnswer(st0, fileA, 'P1', ans);
  check('screen: an answer fills Reference and Sent on, and stops "reading"', stA.ref === 'R-1' && stA.date === '2026-07-13' && stA.reading === false, stA);
  var stT = WC.applyConfirmationAnswer(Object.assign({}, st0, { ref: 'MY-REF', typed: { ref: true } }), fileA, 'P1', ans);
  check('screen: a box the person typed in WHILE it was reading is kept (only the other box is filled)', stT.ref === 'MY-REF' && stT.date === '2026-07-13', stT);
  var stF = WC.applyConfirmationAnswer(Object.assign({}, st0, { file: fileB }), fileA, 'P1', ans);
  check('screen: another file picked since → the old answer changes nothing', stF.ref === '' && stF.date === '2026-11-21' && stF.reading === true, stF);
  var stW = WC.applyConfirmationAnswer(Object.assign({}, st0, { pkgId: 'P2' }), fileA, 'P1', ans);
  check('screen: another wire opened since → the old answer changes nothing', stW.ref === '' && stW.pkgId === 'P2', stW);
  var stE = WC.applyConfirmationAnswer(st0, fileA, 'P1', { ok: false, error: 'AI off' });
  check('screen: a failed read leaves the boxes for typing and says why', stE.ref === '' && stE.date === '2026-11-21' && stE.read.error === 'AI off' && stE.reading === false, stE);

  // ── unknown currency (Codex 09:09 minor): the amount is called unverified, never an unqualified match
  var cu1 = WC.compareWireConfirmation({ reference: 'R-1', sent_date: '2026-07-13', amount: 1000, currency: null }, { total: 1000, payee_name: 'Acme Freight' }, '2026-11-21');
  var cu2 = WC.compareWireConfirmation({ reference: 'R-1', sent_date: '2026-07-13', amount: 900, currency: null }, { total: 1000, payee_name: 'Acme Freight' }, '2026-11-21');
  var cu3 = WC.compareWireConfirmation({ reference: 'R-1', sent_date: '2026-07-13', amount: 1000, currency: 'USD' }, { total: 1000, payee_name: 'Acme Freight' }, '2026-11-21');
  check('no currency read: same number → "unverified … only if it is in US dollars"; different number → also said; USD + same number → no warning', cu1.warnings.length === 1 && /unverified: it matches this \$1000\.00 wire only if it is in US dollars/.test(cu1.warnings[0]) && /also a different number/.test(cu2.warnings.join(' ')) && cu3.warnings.length === 0, [cu1, cu2, cu3]);

  // ── Codex 09:09 P2 — the ACTUAL pickConfirmation + sendIt from the screen file, run on a stand-in screen state
  var panelSrc = fs.readFileSync(path.join(root, 'src/components/WirePackagesPanel.jsx'), 'utf8').replace(/\r\n/g, '\n');
  function grab(name) { var a0 = panelSrc.indexOf('  function ' + name + '('); var b0 = panelSrc.indexOf('\n  }\n', a0); if (a0 < 0 || b0 < 0) { throw new Error('not found: ' + name); } return panelSrc.substring(a0, b0 + 4); }
  function screen(answers, pkgId) {
    var env = { sendF: { pkgId: pkgId || 'PKG1', date: '2026-11-21', ref: '', file: null, path: null, read: null, reading: false, typed: {} }, toasts: [], acts: [], pending: {} };
    env.det = { package: { id: pkgId || 'PKG1', planned_send_date: null } };
    env.setSendF = function (v) { env.sendF = typeof v === 'function' ? v(env.sendF) : v; };
    env.setBusy = function () {}; env.toast = { error: function (m) { env.toasts.push(m); } };
    env.localToday = function () { return '2026-11-21'; }; env.sendDateFor = function () { return '2026-11-21'; };
    env.upload = function (file, pk0) { return Promise.resolve({ path: 'pv/wire-' + pk0 + '-' + file.name, name: file.name }); };
    env.api = function (p) { var key = p.proof_path.split('-').pop(); var a = answers[key]; if (a && a.defer) { return new Promise(function (res) { env.pending[key] = function () { res(a.answer); }; }); } return Promise.resolve(a || { ok: false, error: 'unreadable' }); };
    env.act = function (p) { env.acts.push(p); return Promise.resolve({ ok: true }); };
    env.applyConfirmationAnswer = WC.applyConfirmationAnswer; env.startConfirmationFile = WC.startConfirmationFile; env.confirmationSendProblem = WC.confirmationSendProblem;
    var fns = new Function('env', 'with (env) { ' + grab('pickConfirmation') + '\n' + grab('sendIt') + '\n return { pickConfirmation: pickConfirmation, sendIt: sendIt }; }')(env);
    env.pick = fns.pickConfirmation; env.send = fns.sendIt; return env;
  }
  function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }
  var okA = { ok: true, read: { reference: 'OLD-REFERENCE' }, fill: { reference: 'OLD-REFERENCE', sent_date: '2026-10-01' }, warnings: [] };
  var okB = { ok: true, read: { reference: 'NEW-REF' }, fill: { reference: 'NEW-REF', sent_date: '2026-10-05' }, warnings: [] };
  var fA = { name: 'old.pdf' }; var fB = { name: 'new.pdf' };
  var e1 = screen({ 'old.pdf': okA, 'new.pdf': { ok: false, error: 'unreadable' } });
  e1.pick(fA); await tick();
  check('handler: file A read → its reference and date are filled', e1.sendF.ref === 'OLD-REFERENCE' && e1.sendF.date === '2026-10-01', e1.sendF);
  e1.pick(fB); await tick(); e1.send(); await tick();
  check('Codex scenario: A read, B picked and UNREADABLE, send pressed → refused; A\'s reference is gone, the date is back to the default, NOTHING sent', e1.acts.length === 0 && e1.sendF.ref === '' && e1.sendF.date === '2026-11-21' && /reference/.test(e1.toasts.join(' ')), [e1.sendF, e1.toasts, e1.acts]);
  e1.setSendF(Object.assign({}, e1.sendF, { ref: 'TYPED-B', typed: { ref: true } })); e1.send(); await tick();
  check('… manual entry still works: type the reference for B and send → mark_sent with B\'s file and the typed reference, never A\'s values', e1.acts.length === 1 && e1.acts[0].bank_reference === 'TYPED-B' && e1.acts[0].sent_date === '2026-11-21' && e1.acts[0].proof_path === 'pv/wire-PKG1-new.pdf' && e1.acts[0].confirmation_read === undefined, e1.acts);
  var e2 = screen({ 'old.pdf': okA, 'new.pdf': { ok: true, read: {}, fill: { reference: 'NEW-REF' }, warnings: ['No sent date could be read — pick it yourself.'] } });
  e2.pick(fA); await tick(); e2.pick(fB); await tick();
  check('partial B (reference only): B\'s reference, the date back to the default — A\'s date never stays', e2.sendF.ref === 'NEW-REF' && e2.sendF.date === '2026-11-21', e2.sendF);
  var e3 = screen({ 'old.pdf': okA, 'new.pdf': { ok: false, error: 'unreadable' } });
  e3.setSendF(Object.assign({}, e3.sendF, { ref: 'MY-REF', date: '2026-09-30', typed: { ref: true, date: true } }));
  e3.pick(fA); await tick(); e3.pick(fB); await tick(); e3.send(); await tick();
  check('values the person TYPED survive replacing the file (and are sent with B)', e3.sendF.ref === 'MY-REF' && e3.sendF.date === '2026-09-30' && e3.acts.length === 1 && e3.acts[0].bank_reference === 'MY-REF' && e3.acts[0].proof_path === 'pv/wire-PKG1-new.pdf', [e3.sendF, e3.acts]);
  var e4 = screen({ 'old.pdf': okA, 'new.pdf': okB });
  e4.pick(fA); await tick(); e4.pick(fB); await tick(); e4.send(); await tick();
  check('a successful B replaces A: B\'s reference and date are sent with B\'s file', e4.acts.length === 1 && e4.acts[0].bank_reference === 'NEW-REF' && e4.acts[0].sent_date === '2026-10-05' && e4.acts[0].proof_path === 'pv/wire-PKG1-new.pdf', e4.acts);
  var e5 = screen({ 'old.pdf': { defer: true, answer: okA }, 'new.pdf': okB });
  e5.pick(fA); await tick(); e5.pick(fB); await tick(); e5.pending['old.pdf'](); await tick();
  check('a DELAYED answer for A arriving after B was read changes nothing', e5.sendF.ref === 'NEW-REF' && e5.sendF.date === '2026-10-05' && e5.sendF.file === fB, e5.sendF);
  var e6 = screen({ 'old.pdf': { defer: true, answer: okA } });
  e6.pick(fA); await tick(); e6.setSendF(Object.assign({}, e6.sendF, { ref: 'TYPED', typed: { ref: true } })); e6.send(); await tick();
  check('send pressed while the file is still being read → "still reading", nothing sent', e6.acts.length === 0 && /Still reading/.test(e6.toasts.join(' ')), [e6.toasts, e6.acts]);
  check('library guard: a box filled from an EARLIER file can never go with a later one', /earlier file/.test(WC.confirmationSendProblem({ file: fB, pkgId: 'P', ref: 'R-1', date: '2026-10-01', filledFrom: fA }, 'P', '2026-11-21') || ''), null);

  // ── the screen code (static pins: what the in-memory route cannot see)
  var panel = fs.readFileSync(path.join(root, 'src/components/WirePackagesPanel.jsx'), 'utf8');
  check('screen: "today" is the Eastern business day (todayET), not the UTC toISOString day', /function localToday\(\) \{ return todayET\(\); \}/.test(panel) && panel.indexOf("useState({ date: new Date().toISOString()") < 0, null);
  check('screen: opening a wire resets the send boxes to ITS date (wire date if not in the future, else today)', /setSendF\(\{ pkgId: j\.package\.id, date: sendDateFor\(j\.package\)/.test(panel) && /return w && w <= t \? w : t;/.test(panel), null);
  check('screen: the read file is reused as proof only for the same wire', /sendF\.path && sendF\.pkgId === det\.package\.id && sendF\.path\.indexOf\('pv\/wire-' \+ det\.package\.id \+ '-'\) === 0/.test(panel), null);
  check('screen: the list has "Created in the Hub" and "Sent (bank confirmation)" columns; a not-sent wire shows "planned … · not sent"', /Created in the Hub<\/th>/.test(panel) && /Sent \(bank confirmation\)<\/th>/.test(panel) && /'planned ' \+ p\.planned_send_date \+ ' · not sent'/.test(panel), null);
  check('screen: wire calls go through hubFetch (the signed-in person\'s token)', /return hubFetch\('\/api\/accounting\/wire-packages'/.test(panel) && /import \{ hubFetch \} from '\.\.\/lib\/hub-fetch'/.test(panel), null);
  check('screen: requests say "Date funds used" (no wire leaves our bank)', /Date funds used/.test(panel), null);

  console.log('\nWV wire date: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
