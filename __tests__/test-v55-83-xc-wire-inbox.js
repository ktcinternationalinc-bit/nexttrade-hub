// ═══════════════════════════════════════════════════════════════════════════
// v55.83-XC — Max, 21 Nov: "i also need a place to enter screenshots for wires in one place and the hub able to sort them out and
// put them in the proper wire for confirmation. If there is a discrepancy somewhere it must create a note and send to emails for all
// those that are permissioned for accounting and keep an audit". Recipients: "all people with clickbook permissioning".
// Runs the REAL wire-packages route on an in-memory database (private storage, the AI answer and the mail sender stubbed): adding
// many files (server fingerprint, no duplicates), reading + proposing the wire, a person attaching it (file on the wire, NOT marked
// sent), discrepancy notes (once each, e-mailed without amounts), set aside, the locks, "Mark as sent" with the inbox file, and the
// "sent wire with no confirmation" check. Fixture names / amounts are made up.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
delete process.env.ANTHROPIC_API_KEY;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var B1 = 'b0000000-0000-0000-0000-0000000000c1'; var B2 = 'b0000000-0000-0000-0000-0000000000c2'; var B3 = 'b0000000-0000-0000-0000-0000000000c3';
var db = new MemDB({
  users: [{ id: 'u1', name: 'Preparer', role: 'staff', active: true, email: 'u1@example.test' }, { id: 'u2', name: 'Checker', role: 'staff', active: true, email: 'u2@example.test' },
    { id: 'u3', name: 'Viewer', role: 'staff', active: true, email: 'u3@example.test' }, { id: 'u4', name: 'Warehouse', role: 'staff', active: true, email: 'u4@example.test' },
    { id: 'u5', name: 'Gone', role: 'staff', active: false, email: 'u5@example.test' }],
  module_permissions: [].concat(
    ['accounting.clickbooks.access', 'wires.prepare', 'wires.signoff', 'wires.send'].map(function (k) { return { user_id: 'u1', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.signoff'].map(function (k) { return { user_id: 'u2', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access', 'wires.view'].map(function (k) { return { user_id: 'u3', module_name: k, has_access: true }; }),
    ['accounting.clickbooks.access'].map(function (k) { return { user_id: 'u5', module_name: k, has_access: true }; })),
  vendor_bills: [
    { id: B1, vendor_name: 'Acme Freight', bill_number: 'AF-1', release_number: '1002-101', total_amount: 600, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-06-01', shipment_direction: 'outbound' },
    { id: B2, vendor_name: 'Acme Freight', bill_number: 'AF-2', release_number: '1002-102', total_amount: 400, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-06-02', shipment_direction: 'outbound' },
    { id: B3, vendor_name: 'Bolt Cartage', bill_number: 'BC-3', release_number: '1002-103', total_amount: 250, record_status: 'active', paid_via: null, validation_status: 'validated', bill_date: '2026-06-03', shipment_direction: 'outbound' },
  ],
  vendor_bill_payments: [], wire_packages: [], wire_package_lines: [], wire_package_files: [], hub_audit_log: [], paid_through_parties: [], bank_transactions: [],
  wire_confirmation_inbox: [], wire_discrepancy_notices: [],
});
var OPEN = ['new', 'read', 'unreadable', 'proposed', 'several', 'no_wire'];
// like the database (sql/v55-83-XC): a decided confirmation is final, the file never changes; one note per dedupe key
db.hooks = {
  wire_confirmation_inbox: {
    insert: function (r) { if (db.t.wire_confirmation_inbox.some(function (x) { return x.path === r.path || (r.file_sha256 && x.file_sha256 === r.file_sha256); })) { return 'duplicate key value violates unique constraint "uq_wci_sha"'; } r.uploaded_at = r.uploaded_at || new Date().toISOString(); },
    update: function (row, p) {
      if ((p.path !== undefined && p.path !== row.path) || (p.file_sha256 !== undefined && p.file_sha256 !== row.file_sha256)) { return 'WIRE_INBOX_LOCKED: the file of a bank confirmation cannot change'; }
      if (OPEN.indexOf(row.status) < 0 && p.status !== undefined && p.status !== row.status) { return 'WIRE_INBOX_LOCKED: this bank confirmation is already ' + row.status; }
    },
  },
  wire_discrepancy_notices: {
    insert: function (r) { if (db.t.wire_discrepancy_notices.some(function (x) { return x.dedupe_key === r.dedupe_key; })) { return 'duplicate key value violates unique constraint "uq_wdn_dedupe"'; } },
    update: function (row, p) { if ((row.mail_status === 'sent' || row.mail_status === 'partly_sent') && p.mail_status !== undefined && p.mail_status !== row.mail_status) { return 'WIRE_NOTICE_LOCKED: this note was already e-mailed'; } },
  },
};
var files = {};
db.storage = { from: function (bucket) { return { download: function (p) { var f = files[bucket + '/' + p]; return Promise.resolve(f ? { data: f, error: null } : { data: null, error: { message: 'Object not found' } }); } }; } };
function fakeFile(type, fill, n) { var buf = Buffer.alloc(n || 400, fill || 7); return { type: type, size: buf.length, arrayBuffer: function () { return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); } }; }
var aiAnswer = null; var aiCalls = 0;
global.fetch = function () { aiCalls++; var a = aiAnswer; return Promise.resolve({ json: function () { return Promise.resolve(a); } }); };
function aiText(obj) { return { content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn' }; }
var orig = Module._resolveFilename;
var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
Module._resolveFilename = function (req, parent) {
  if (req === '@supabase/supabase-js') { return mockPath; }
  if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); }
  if (/(^|[\/])notify-server(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-notify-server.js'); }
  return orig.apply(this, arguments);
};
global.__db = db; global.__mails = []; global.__mailMode = 'ok';
db.rpcs = Object.assign({}, db.rpcs || {}, { hub_payment_guards_installed: function () { return true; } });
var route = require(path.join(root, 'src/app/api/accounting/wire-packages/route.js'));
var XS = require(path.join(root, 'src/lib/wire-inbox-server.js'));
var XI = require(path.join(root, 'src/lib/wire-inbox.js'));
async function callRaw(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
async function call(user, body) {
  if (body && body.action === 'signoff') { var g = await callRaw(user, { action: 'get', id: body.id }); if (g && g.ok) { for (var i = 0; i < g.lines.length; i++) { await callRaw(user, { action: 'review_bill', id: body.id, bill_id: g.lines[i].bill_id }); } } }
  return callRaw(user, body);
}
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; process.exitCode = 1; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
function pk(id) { return db.t.wire_packages.filter(function (x) { return x.id === id; })[0]; }
function ib(id) { return db.t.wire_confirmation_inbox.filter(function (x) { return x.id === id; })[0]; }
function auditOf(action, id) { return db.t.hub_audit_log.filter(function (a) { return a.action === action && (id === undefined || String(a.entity_id) === String(id)); }); }
function filesOf(pid) { return db.t.wire_package_files.filter(function (f) { return f.package_id === pid; }); }
var n = 0; function upload(name, fill) { n++; var p = 'pv/wire-inbox-' + n + '0000000-aaaa-bbbb-cccc-' + String(n).padStart(12, '0') + '-' + name; files['bills-private/' + p] = fakeFile(/\.pdf$/.test(name) ? 'application/pdf' : 'image/png', fill); return { path: p, file_name: name }; }

console.log('XC — the bank-confirmation inbox');
(async function () {
  // ── two wires: W1 Acme $1,000 signed (ready to send), W2 Bolt $250 (draft, not signed)
  var w1 = await call('u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', planned_send_date: '2026-07-10', lines: [{ bill_id: B1, amount: '600' }, { bill_id: B2, amount: '400' }] });
  await call('u2', { action: 'signoff', id: w1.id, note: 'checked both bills' }); await call('u1', { action: 'signoff', id: w1.id, note: 'verified totals' });
  var w2 = await call('u1', { action: 'save_draft', payee_kind: 'vendor', payee_name: '', planned_send_date: '2026-07-11', lines: [{ bill_id: B3, amount: '250' }] });
  var g0 = await call('u1', { action: 'get', id: w1.id });
  check('setup: W1 ready to send, W2 a draft', w1.ok && w2.ok && g0.package.status === 'ready_to_send', [w1, w2, g0.package && g0.package.status]);

  // ── the list: who can see, who can act
  var l0 = await call('u3', { action: 'inbox_list' });
  check('Wires: View can open the inbox (read only: can_send false); both wires are offered to pick from', l0.ok && l0.can_send === false && l0.wires.length === 2 && l0.rows.length === 0, l0);
  var a0 = await call('u3', { action: 'inbox_add', files: [upload('a.pdf', 1)] });
  var a0b = await call('u2', { action: 'inbox_read', inbox_id: '00000000-0000-0000-0000-000000000000' });
  check('adding / reading needs "Wires: Send" (view-only and signer-only → 403, plain words)', !a0.ok && a0._status === 403 && /Wires: Send/.test(a0.error) && !a0b.ok && a0b._status === 403 && db.t.wire_confirmation_inbox.length === 0, [a0, a0b]);
  var nt = await callRaw('u1', { action: 'inbox_list', _no_token: true });
  check('no valid sign-in → refused (401) before the inbox is touched', nt._status === 401, nt);

  // ── adding many files at once
  var fA = upload('acme-wire.pdf', 11); var fB = upload('mystery.png', 22); var fC = upload('bolt-wire.png', 33); var fU = upload('blurry.png', 44);
  var bad = { path: 'pv/wire-' + w1.id + '-1-x.pdf', file_name: 'x.pdf' }; var trick = { path: 'pv/wire-inbox-../../secret.pdf', file_name: 'y.pdf' }; var gone = { path: 'pv/wire-inbox-99-gone.pdf', file_name: 'gone.pdf' };
  var add = await call('u1', { action: 'inbox_add', files: [fA, fB, fC, fU, bad, trick, gone] });
  check('4 files added in one go; a path outside the inbox, a path trick and a file that never arrived are refused, each with a reason', add.ok && add.added.length === 4 && add.refused.length === 3 && /not an inbox upload/.test(add.refused[0].why) && /not an inbox upload/.test(add.refused[1].why) && /did not arrive/.test(add.refused[2].why), add);
  var shaA = require('crypto').createHash('sha256').update(Buffer.alloc(400, 11)).digest('hex');
  var rowA = db.t.wire_confirmation_inbox.filter(function (r) { return r.path === fA.path; })[0];
  check('… the SERVER fingerprints the file it stored (not a value from the screen), status "new", who added it', rowA && rowA.file_sha256 === shaA && rowA.status === 'new' && rowA.uploaded_by === 'u1' && auditOf('wire_inbox_added', rowA.id).length === 1, rowA);
  var again = await call('u1', { action: 'inbox_add', files: [Object.assign(upload('acme-wire-copy.pdf', 11), { sha256: 'made-up' })] });
  check('the same file again (other name, made-up fingerprint from the screen) → refused "already in the inbox", nothing added', again.ok && again.added.length === 0 && /already in the inbox/.test(again.refused[0].why) && db.t.wire_confirmation_inbox.length === 4, again);
  var tooMany = await call('u1', { action: 'inbox_add', files: new Array(21).fill(fA) });
  check('more than 20 at a time → refused', !tooMany.ok && /At most 20/.test(tooMany.error), tooMany);
  var ids = {}; add.added.forEach(function (a) { ids[a.file_name] = a.id; });

  // ── reading: the AI off → "could not be read", no note, no mail
  var r0 = await call('u1', { action: 'inbox_read', inbox_id: ids['blurry.png'] });
  check('AI not switched on → the file is marked "could not be read" with the reason; no note, no e-mail', r0.ok && r0.status === 'unreadable' && /not switched on/.test(ib(ids['blurry.png']).read_error) && db.t.wire_discrepancy_notices.length === 0 && global.__mails.length === 0, r0);
  process.env.ANTHROPIC_API_KEY = 'test-key';

  // ── reading A: it is W1 → PROPOSED (a person still confirms)
  aiAnswer = aiText({ is_wire_confirmation: true, reference: 'FW00012345', status: 'Completed', sent_date: '2026-07-13', amount: 1000, currency: 'USD', beneficiary: 'ACME FREIGHT CORPORATION' });
  var rA = await call('u1', { action: 'inbox_read', inbox_id: ids['acme-wire.pdf'] });
  check('a confirmation that fits one wire → "Wire found — confirm it": W1 proposed (same amount, same recipient, date within 3 days)', rA.ok && rA.status === 'proposed' && rA.proposed === w1.id && rA.candidates[0].reasons.indexOf('same amount') >= 0 && rA.candidates[0].reasons.indexOf('same recipient') >= 0, rA);
  check('… nothing attached yet: W1 has no file, is not sent, no note', filesOf(w1.id).length === 0 && pk(w1.id).status === 'draft' && db.t.wire_discrepancy_notices.length === 0 && auditOf('wire_inbox_read', ids['acme-wire.pdf']).length === 1, filesOf(w1.id));

  // ── reading B: matches no wire → a note + one e-mail to every ACTIVE person with ClickBooks access, no amounts in the mail
  aiAnswer = aiText({ is_wire_confirmation: true, reference: 'ZZ998877', status: 'Sent', sent_date: '2026-07-01', amount: 77777.77, currency: 'USD', beneficiary: 'NOBODY WE KNOW LTD' });
  var rB = await call('u1', { action: 'inbox_read', inbox_id: ids['mystery.png'] });
  var nB = db.t.wire_discrepancy_notices.filter(function (x) { return x.inbox_id === ids['mystery.png']; });
  check('no wire fits → "No matching wire", ONE note (kind no_wire) saying what was read', rB.ok && rB.status === 'no_wire' && nB.length === 1 && nB[0].kind === 'no_wire' && /77777.77/.test(nB[0].note) && /NOBODY WE KNOW/.test(nB[0].note), [rB, nB]);
  var m1 = global.__mails[0] || {};
  check('… e-mailed ONCE to the active people with ClickBooks access (u1, u2, u3 — not the inactive one, not the one without access)', global.__mails.length === 1 && m1.ids.slice().sort().join(',') === 'u1,u2,u3' && m1.type === 'wire_discrepancy', m1);
  check('… the e-mail says what kind of problem and where to look — no amount, no recipient, no reference', /no matching wire/.test(m1.subject) && !/77777|NOBODY|ZZ998877/.test(m1.subject + m1.body) && /Bank confirmations/.test(m1.body), m1);
  check('… the note records the e-mail result truthfully: sent to 3, with the time; audited', nB[0].mail_status === 'sent' && nB[0].mail_sent === 3 && !!nB[0].mail_at && auditOf('wire_discrepancy_noted').length === 1, nB[0]);
  await call('u1', { action: 'inbox_read', inbox_id: ids['mystery.png'] });
  check('reading the same file again → still one note, still one e-mail (never twice for the same problem)', db.t.wire_discrepancy_notices.length === 1 && global.__mails.length === 1, db.t.wire_discrepancy_notices.length);

  // ── a person attaches A to W1 (the proposal): the file goes on the wire, the wire is NOT marked sent
  var lk = await call('u1', { action: 'inbox_link', inbox_id: ids['acme-wire.pdf'], package_id: w1.id });
  var fW1 = filesOf(w1.id);
  check('attach (the proposed wire): the file is now W1\'s bank confirmation; the inbox row says who / when / which wire', lk.ok && lk.wire === 'WP-' + String(pk(w1.id).seq).padStart(4, '0') && fW1.length === 1 && fW1[0].kind === 'bank_confirmation' && fW1[0].path === fA.path && ib(ids['acme-wire.pdf']).status === 'linked' && ib(ids['acme-wire.pdf']).linked_by === 'u1' && ib(ids['acme-wire.pdf']).linked_package_id === w1.id, [lk, fW1]);
  check('… attaching does NOT mark the wire sent (still draft, no sent date); no difference → no note, no e-mail', pk(w1.id).status === 'draft' && !pk(w1.id).sent_date && lk.notes.length === 0 && global.__mails.length === 1 && /Mark as sent/.test(lk.next), [pk(w1.id).status, lk]);
  var hl = auditOf('wire_inbox_linked', w1.id);
  check('… in W1\'s own history: who attached which file, that it followed the Hub\'s proposal', hl.length === 1 && hl[0].actor_id === 'u1' && hl[0].details.followed_proposal === true && hl[0].details.path === fA.path, hl);
  var lk2 = await call('u1', { action: 'inbox_link', inbox_id: ids['acme-wire.pdf'], package_id: w2.id });
  var ds2 = await call('u1', { action: 'inbox_dismiss', inbox_id: ids['acme-wire.pdf'], reason: 'changed my mind' });
  check('an attached confirmation is final: attaching it elsewhere or setting it aside → 409, nothing changed', !lk2.ok && lk2._status === 409 && !ds2.ok && ds2._status === 409 && ib(ids['acme-wire.pdf']).linked_package_id === w1.id && filesOf(w2.id).length === 0, [lk2, ds2]);

  // ── opening W1: "Mark as sent" can use that file, already read
  var g1 = await call('u1', { action: 'get', id: w1.id });
  check('opening W1: the inbox confirmation is offered with what the server read (reference + date ready to fill, no warning)', g1.ok && g1.inbox_confirmation && g1.inbox_confirmation.path === fA.path && /FW00012345/.test(g1.inbox_confirmation.fill.reference) && g1.inbox_confirmation.fill.sent_date === '2026-07-13' && g1.inbox_confirmation.warnings.length === 0, g1.inbox_confirmation);
  var g2 = await call('u1', { action: 'get', id: w2.id });
  check('… another wire does not get it', g2.ok && g2.inbox_confirmation === null, g2.inbox_confirmation);
  var wrongMs = await call('u1', { action: 'mark_sent', id: w1.id, sent_date: '2026-07-13', bank_reference: 'FW00012345', proof_path: fB.path, proof_name: 'mystery.png' });
  check('Mark as sent with an inbox file NOT attached to this wire → refused (409), W1 not sent', !wrongMs.ok && wrongMs._status === 409 && /not attached to this wire/.test(wrongMs.error) && pk(w1.id).status === 'draft', wrongMs);
  var ms = await call('u1', { action: 'mark_sent', id: w1.id, sent_date: '2026-07-13', bank_reference: g1.inbox_confirmation.fill.reference, proof_path: fA.path, proof_name: 'acme-wire.pdf' });
  var sentA = auditOf('wire_package_sent', w1.id)[0];
  check('Mark as sent with the attached inbox file → sent; the file is listed ONCE (not added a second time)', ms.ok && pk(w1.id).status === 'sent' && filesOf(w1.id).length === 1, [ms, filesOf(w1.id).length]);
  check('… the sent record says the date and reference ARE the ones the server read from that file', sentA && sentA.details.server_read && sentA.details.date_as_read === true && sentA.details.reference_as_read === true, sentA && sentA.details);

  // ── reading C (Bolt, but $300 and another name) → no wire fits; a person attaches it to W2 anyway → 2 differences noted + e-mailed
  aiAnswer = aiText({ is_wire_confirmation: true, reference: 'BC555', status: 'Pending', sent_date: '2026-07-11', amount: 300, currency: 'USD', beneficiary: 'Other Hauling Co' });
  var rC = await call('u1', { action: 'inbox_read', inbox_id: ids['bolt-wire.png'] });
  var mailsBefore = global.__mails.length;
  var lkC = await call('u1', { action: 'inbox_link', inbox_id: ids['bolt-wire.png'], package_id: w2.id });
  var kinds = lkC.notes ? lkC.notes.map(function (x) { return x.kind; }).sort().join(',') : '';
  check('attached by a person although it differs: amount, recipient and bank status are each noted', rC.ok && lkC.ok && kinds === 'amount,recipient,status' && /300.00/.test(ib(ids['bolt-wire.png']).note), [rC.status, lkC]);
  var nC = db.t.wire_discrepancy_notices.filter(function (x) { return x.package_id === w2.id; });
  check('… one note per difference, each tied to W2 and the file, each e-mailed (3 e-mails), no amounts in them', nC.length === 3 && nC.every(function (x) { return x.inbox_id === ids['bolt-wire.png'] && x.mail_status === 'sent'; }) && global.__mails.length === mailsBefore + 3 && global.__mails.slice(mailsBefore).every(function (m) { return !/300|250|Other Hauling/.test(m.subject + m.body); }), nC);

  // ── set aside: reason required, kept forever
  var dsBad = await call('u1', { action: 'inbox_dismiss', inbox_id: ids['mystery.png'], reason: 'no' });
  var ds = await call('u1', { action: 'inbox_dismiss', inbox_id: ids['mystery.png'], reason: 'not our wire - a customer sent it' });
  check('set aside: a reason of 5+ characters is required; then it is kept with who and why (never deleted)', !dsBad.ok && ds.ok && ib(ids['mystery.png']).status === 'dismissed' && ib(ids['mystery.png']).dismissed_by === 'u1' && /customer/.test(ib(ids['mystery.png']).dismiss_reason) && db.t.wire_confirmation_inbox.length === 4 && auditOf('wire_inbox_dismissed', ids['mystery.png']).length === 1, [dsBad, ds]);

  // ── the list shows it all
  var l1 = await call('u3', { action: 'inbox_list' });
  var rowL = (l1.rows || []).filter(function (r) { return r.id === ids['acme-wire.pdf']; })[0];
  check('the inbox list: 4 files, names of who added / attached, the wire label, 5 notes (the Bolt file also got its own "no matching wire" note when it was read)', l1.ok && l1.rows.length === 4 && rowL.uploaded_by_name === 'Preparer' && rowL.linked_by_name === 'Preparer' && /^WP-/.test(rowL.linked_label) && l1.notices.length === 5, [l1.notices && l1.notices.length, rowL && rowL.uploaded_by_name, rowL && rowL.linked_by_name, rowL && rowL.linked_label]);

  // ── mail service off: the note says NOT e-mailed (never "sent")
  global.__mailMode = 'off';
  var off = await XS.raiseNotice(db, { dedupe_key: 'test:off', kind: 'amount', note: 'test' }, 'u1', {});
  check('mail service not set up → note kept, mail_status "not_sent" with the reason, no sent time', off.created && off.mail.mail_status === 'not_sent' && off.mail.mail_sent === 0 && !off.mail.mail_at && /did not send/.test(off.mail.mail_error), off.mail);
  global.__mailMode = 'throw';
  var thr = await XS.raiseNotice(db, { dedupe_key: 'test:throw', kind: 'amount', note: 'test' }, 'u1', {});
  check('mail service fails → "not_sent" with its error, the note is still kept', thr.created && thr.mail.mail_status === 'not_sent' && /mail service down/.test(thr.mail.mail_error), thr.mail);
  global.__mailMode = 'ok';

  // ── a sent wire with no bank confirmation (3 days later): one note each, ever; old / after-the-fact wires are not nagged
  db.t.wire_packages.push({ id: 'p0000000-0000-0000-0000-0000000000d1', seq: 91, status: 'sent', sent_date: '2026-11-25', funding_txn_id: null, payee_name: 'X' });
  db.t.wire_packages.push({ id: 'p0000000-0000-0000-0000-0000000000d2', seq: 92, status: 'sent', sent_date: '2026-11-02', funding_txn_id: null, payee_name: 'Y' });
  db.t.wire_packages.push({ id: 'p0000000-0000-0000-0000-0000000000d3', seq: 93, status: 'attached', sent_date: '2026-11-25', funding_txn_id: null, after_the_fact: true, payee_name: 'Z' });
  db.t.wire_packages.push({ id: 'p0000000-0000-0000-0000-0000000000d4', seq: 94, status: 'sent', sent_date: '2026-11-30', funding_txn_id: null, payee_name: 'W' });
  var mc = await XS.checkMissingConfirmations(db, 'u1', '2026-12-01', {});
  var mcN = db.t.wire_discrepancy_notices.filter(function (x) { return x.kind === 'missing_confirmation'; });
  check('missing confirmation: only WP-0091 (sent 25 Nov, 6 days, no file) — not before the inbox existed, not after-the-fact, not the 1-day-old one', mc.raised === 1 && mcN.length === 1 && /WP-0091/.test(mcN[0].note), [mc, mcN.map(function (x) { return x.note; })]);
  var mc2 = await XS.checkMissingConfirmations(db, 'u1', '2026-12-05', {});
  check('… checked again later → no second note for WP-0091 (only WP-0094 now old enough)', mc2.raised === 1 && db.t.wire_discrepancy_notices.filter(function (x) { return x.package_id === 'p0000000-0000-0000-0000-0000000000d1'; }).length === 1, mc2);

  // ── the database step not run yet → a plain sentence, never a crash
  var noTbl = { from: function () { var q = { select: function () { return q; }, order: function () { return q; }, limit: function () { return Promise.resolve({ data: null, error: { message: 'relation "public.wire_confirmation_inbox" does not exist' } }); } }; return q; } };
  var nt2 = await XS.handleInbox(noTbl, 'u1', 'inbox_list', {}, { canSend: false });
  check('inbox SQL not run → 503 with the file to run, nothing else attempted', nt2.status === 503 && /v55-83-XC-wire-confirmation-inbox\.sql/.test(nt2.json.error), nt2);

  // ── the pure rules
  var W = [{ id: 'a', label: 'WP-1', payee_name: 'Acme Freight', total: 1000, status: 'draft', planned_send_date: '2026-07-10' }, { id: 'b', label: 'WP-2', payee_name: 'Acme Freight', total: 1000, status: 'draft', planned_send_date: '2026-07-10' },
    { id: 'c', label: 'WP-3', payee_name: 'Acme Freight', total: 1000, status: 'sent', bank_reference: 'FW777', sent_date: '2026-07-10' }, { id: 'd', label: 'WP-4', payee_name: 'RTM Capital', total: 1000, status: 'draft', funding_txn_id: 't1' }];
  var two = XI.matchCandidates({ amount: 1000, beneficiary: 'Acme Freight Corp', sent_date: '2026-07-10' }, W.slice(0, 2).concat([W[3]]));
  check('two wires fit equally → "Several wires fit — pick one" (no guess); a request drawn from a transfer is never a candidate', two.status === 'several' && two.proposed === null && two.candidates.length === 2 && two.candidates.every(function (c) { return c.id !== 'd'; }), two);
  var byRef = XI.matchCandidates({ reference: 'FW777', amount: 1000, beneficiary: 'Acme', sent_date: '2026-07-10' }, W);
  check('the same bank reference decides between equal wires', byRef.status === 'proposed' && byRef.proposed === 'c', byRef);
  var eur = XI.matchCandidates({ amount: 1000, currency: 'EUR', beneficiary: 'Acme Freight' }, W.slice(0, 1));
  check('another currency never counts as "same amount"', eur.status === 'no_wire', eur);
  check('discrepancies: a different sent date on a sent wire is noted; a matching one is not', XI.discrepanciesFor({ sent_date: '2026-07-12', amount: 1000 }, { total: 1000, sent_date: '2026-07-10' }).map(function (x) { return x.kind; }).join() === 'date' && XI.discrepanciesFor({ sent_date: '2026-07-10', amount: 1000, status: 'Completed' }, { total: 1000, sent_date: '2026-07-10' }).length === 0, null);
  check('inbox paths: only pv/wire-inbox-…, no ".."', XI.inboxPathOk('pv/wire-inbox-1-a.pdf') && !XI.inboxPathOk('pv/wire-1-a.pdf') && !XI.inboxPathOk('pv/wire-inbox-../x') && !XI.inboxPathOk(''), null);

  // ── the screen
  var panel = fs.readFileSync(path.join(root, 'src/components/WireInboxPanel.jsx'), 'utf8');
  var wp = fs.readFileSync(path.join(root, 'src/components/WirePackagesPanel.jsx'), 'utf8');
  check('screen: 🏦 Wires has the 📥 Bank confirmations button and shows the inbox', /import WireInboxPanel from '.\/WireInboxPanel'/.test(wp) && /📥 Bank confirmations/.test(wp) && /<WireInboxPanel /.test(wp), null);
  check('screen: the inbox uploads to the PRIVATE bucket under pv/wire-inbox-, adds, reads, attaches, sets aside', /from\('bills-private'\)\.upload\(path/.test(panel) && /'pv\/wire-inbox-'/.test(panel) && ['inbox_add', 'inbox_read', 'inbox_link', 'inbox_dismiss', 'inbox_list'].every(function (a) { return panel.indexOf("'" + a + "'") >= 0; }), null);
  check('screen: "Mark as sent" offers the inbox file and sends its path without uploading again', /📥 Use the confirmation from the inbox/.test(wp) && /sendF\.file\.inbox === true/.test(wp), null);

  console.log('XC inbox: ' + pass + ' passed, ' + failN + ' failed');
})().catch(function (e) { console.log('  ✗ CRASH ' + (e && e.stack)); failN++; process.exitCode = 1; console.log('XC inbox: ' + pass + ' passed, ' + failN + ' failed'); });
