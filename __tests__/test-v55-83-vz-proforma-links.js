// v55.83-VZ (Max, 20 Nov 2026: "Proforma invoices need to be linked to invoices and that we need to upload a signed proforma
// that is saved and archived with them.") — the REAL /api/accounting/proforma-links handler and the REAL invoice-lifecycle
// handler, run against an in-memory database and an in-memory file store. Permissions (server-permissions), the history window
// (visibility-window-server) and the audit writer are the real modules; only the sign-in check and the Supabase client are
// stand-ins. Plus the pure rules in src/lib/proforma-links.js and a few wiring pins on the screen.
var path = require('path'); var fs = require('fs'); var crypto = require('crypto');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('VZ — proforma ↔ invoice links + signed proforma');

var LINKS = 'accounting_proforma_invoice_links', FILES = 'accounting_proforma_signed_files';
var state = { db: null, who: { userId: 'u' }, store: null, ops: [], beforeInsert: {} };
function stub(rel, exportsObj) { var p = require.resolve(path.join(root, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj }; }
stub('src/lib/verified-caller.js', { verifiedCaller: function () { return Promise.resolve(state.who); } });
var supa = require.resolve('@supabase/supabase-js', { paths: [root] });
require.cache[supa] = { id: supa, filename: supa, loaded: true, exports: { createClient: function () { return state.db; } } };
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
var R = require(path.join(root, 'src/app/api/accounting/proforma-links/route.js'));
var LIFE = require(path.join(root, 'src/app/api/accounting/invoice-lifecycle/route.js'));
var L = require(path.join(root, 'src/lib/proforma-links.js'));
function post(handler, body) { return handler.POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer t' } })).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }); }
function call(who, body) { state.who = who === null ? { error: 'Sign in again.', status: 401 } : { userId: who }; return post(R, body); }

// an in-memory file store that behaves like the private store: tickets, download, short links — and RECORDS every call
function FakeStore() {
  var self = this; self.objects = {}; self.calls = []; self.bucketExists = true;
  self.put = function (bucket, p, buf) { self.objects[bucket + '/' + p] = buf; };
  self.from = function (bucket) {
    function log(name, p) { self.calls.push(name + ' ' + bucket + '/' + p); }
    return {
      createSignedUploadUrl: function (p) { log('createSignedUploadUrl', p); if (!self.bucketExists) { return Promise.resolve({ data: null, error: { message: 'Bucket not found' } }); } return Promise.resolve({ data: { path: p, token: 'tok-' + crypto.randomBytes(4).toString('hex'), signedUrl: 'https://store/upload/' + p }, error: null }); },
      download: function (p) { log('download', p); var b = self.objects[bucket + '/' + p]; return Promise.resolve(b ? { data: new Blob([b]), error: null } : { data: null, error: { message: 'Object not found' } }); },
      createSignedUrl: function (p, secs, opts) { log('createSignedUrl', p); return Promise.resolve({ data: { signedUrl: 'https://store/read/' + bucket + '/' + p + '?valid=' + secs + (opts && opts.download ? '&download=' + opts.download : '') }, error: null }); },
      upload: function (p) { log('UPLOAD', p); return Promise.resolve({ data: null, error: null }); },
      update: function (p) { log('UPDATE', p); return Promise.resolve({ data: null, error: null }); },
      remove: function (p) { log('REMOVE', p); return Promise.resolve({ data: null, error: null }); },
      move: function (p) { log('MOVE', p); return Promise.resolve({ data: null, error: null }); },
      copy: function (p) { log('COPY', p); return Promise.resolve({ data: null, error: null }); },
    };
  };
}
var U = function (n) { return '00000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); };
var PF1 = U(101), PF2 = U(102), PF_OLD = U(103), PF_B = U(104), PF_W = U(105), PF_EMPTY = U(106);
var INV1 = U(201), INV2 = U(202), INV3 = U(203), INV_OLD = U(204), INV_B = U(205), INV_W = U(206), INV4 = U(207);
var SUPER = U(1), VIEW = U(2), EDIT = U(3), EDIT2 = U(4), NONE = U(5), ADMIN = U(6), AM = U(7), DEL = U(8);
function fresh() {
  var db = new FakeDb({});
  db.uniques[LINKS] = [{ cols: ['invoice_id'], where: function (r) { return r.removed_at == null; } }];
  db.uniques[FILES] = [['proforma_id', 'version'], ['storage_path'], ['proforma_id', 'sha256']];
  var rawFrom = db.from; state.ops = []; state.beforeInsert = {};
  db.from = function (t) {
    var q = rawFrom(t); var ins = q.insert, upd = q.update, del = q.delete;
    q.insert = function (row) { state.ops.push({ t: t, op: 'insert', row: row }); if (state.beforeInsert[t]) { var fn = state.beforeInsert[t]; state.beforeInsert[t] = null; fn(db, rawFrom); } var dflt = { id: crypto.randomUUID() }; if (t === FILES) { dflt.uploaded_at = new Date().toISOString(); } if (t === LINKS) { dflt.linked_at = new Date().toISOString(); dflt.removed_at = null; } /* the database defaults */ return ins.call(q, Object.assign(dflt, row)); };
    q.update = function (p) { state.ops.push({ t: t, op: 'update', patch: p }); return upd.call(q, p); };
    q.delete = function () { state.ops.push({ t: t, op: 'delete' }); return del.call(q); };
    return q;
  };
  state.store = new FakeStore(); db.storage = state.store; state.db = db;
  db.t.users = [{ id: SUPER, role: 'super_admin', name: 'Max' }, { id: VIEW, role: 'staff', name: 'Vera Viewer' }, { id: EDIT, role: 'staff', name: 'Eddie Editor' }, { id: EDIT2, role: 'staff', name: 'Ella Edit' },
    { id: NONE, role: 'staff', name: 'Nobody' }, { id: ADMIN, role: 'admin', name: 'Admin No Switch' }, { id: AM, role: 'accounting_manager', name: 'Amy' }, { id: DEL, role: 'staff', name: 'Del' }];
  db.t.module_permissions = [{ user_id: VIEW, module_name: 'invoice.view', has_access: true }, { user_id: EDIT, module_name: 'invoice.create', has_access: true }, { user_id: EDIT2, module_name: 'Invoice: Edit', has_access: true },
    { user_id: DEL, module_name: 'invoice.delete', has_access: true }, { user_id: DEL, module_name: 'invoice.view', has_access: true }];
  db.t.app_settings = [{ id: 's1', key: 'accounting_visibility_window', value: { window: 'custom', customFrom: '2026-06-01', customDays: null } }];
  db.t.accounting_proformas = [
    { id: PF1, proforma_number: 'PF-1', proforma_date: '2026-10-01', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 1000, status: 'sent', created_at: '2026-10-01' },
    { id: PF2, proforma_number: 'PF-2', proforma_date: '2026-10-02', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 500, status: 'converted', converted_invoice_id: INV3, created_at: '2026-10-02' },
    { id: PF_OLD, proforma_number: 'PF-OLD', proforma_date: '2026-01-10', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 9, created_at: '2026-01-10' },
    { id: PF_B, proforma_number: 'PF-B', proforma_date: '2026-10-03', accounting_customer_id: 'cB', business_id: 'b1', wave_business_id: 'w1', total_amount: 70, created_at: '2026-10-03' },
    { id: PF_W, proforma_number: 'PF-W', proforma_date: '2026-10-03', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w2', total_amount: 70, created_at: '2026-10-03' },
    { id: PF_EMPTY, proforma_number: 'PF-E', proforma_date: '2026-10-04', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 1, created_at: '2026-10-04' }];
  db.t.accounting_invoices = [
    { id: INV1, invoice_number: 'INV-1', invoice_date: '2026-10-05', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 1000 },
    { id: INV2, invoice_number: 'INV-2', invoice_date: '2026-10-06', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 400 },
    { id: INV3, invoice_number: 'INV-3', invoice_date: '2026-10-07', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 500 },
    { id: INV_OLD, invoice_number: 'INV-OLD', invoice_date: '2026-02-01', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 9 },
    { id: INV_B, invoice_number: 'INV-B', invoice_date: '2026-10-08', accounting_customer_id: 'cB', business_id: 'b1', wave_business_id: 'w1', total_amount: 70 },
    { id: INV_W, invoice_number: 'INV-W', invoice_date: '2026-10-08', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w2', total_amount: 70 },
    { id: INV4, invoice_number: 'INV-4', invoice_date: '2026-10-09', accounting_customer_id: 'cA', business_id: 'b1', wave_business_id: 'w1', total_amount: 40 }];
  return db;
}
function rows(t) { return (state.db.t[t] || []); }
function audits(action) { return rows('hub_audit_log').filter(function (a) { return a.action === action; }); }
var PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(300)]);
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);
var JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]);
var EXE = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(200)]);
async function sendFile(who, pf, name, bytes, extra) {
  var st = await call(who, Object.assign({ action: 'upload_start', proforma_id: pf, file_name: name, size: bytes.length, content_type: 'application/pdf' }, extra || {}));
  if (st.status !== 200) { return { start: st }; }
  if (bytes.length || (extra && extra._putEmpty)) { state.store.put(st.j.bucket, st.j.path, bytes); }
  var fin = await call(who, { action: 'upload_finish', proforma_id: pf, path: st.j.path, file_name: name, note: (extra && extra.note) || '' });
  return { start: st, finish: fin };
}

(async function () {
  // ── the pure rules
  check('rule: the real kind of a file comes from its first bytes (PDF, JPG, PNG, WEBP); anything else is nothing', L.sniffSignedFile(PDF) === 'application/pdf' && L.sniffSignedFile(JPG) === 'image/jpeg' && L.sniffSignedFile(PNG) === 'image/png' && L.sniffSignedFile(Buffer.from('RIFF1234WEBPVP8 ')) === 'image/webp' && L.sniffSignedFile(EXE) === null && L.sniffSignedFile(Buffer.from('<html>')) === null && L.sniffSignedFile(Buffer.alloc(0)) === null);
  check('rule: a file name is made safe for a path (no folders, no odd characters, never empty, at most 80)', L.safeFileName('..\\..\\evil/../Signed PF #12 (final).PDF') === 'Signed_PF_12_final_.PDF' && L.safeFileName('') === 'signed-proforma' && L.safeFileName('../../..') === 'signed-proforma' && L.safeFileName(new Array(200).join('a') + '.pdf').length === 80 && /\.pdf$/.test(L.safeFileName(new Array(200).join('a') + '.pdf')));
  var goodPath = L.signedPathFor(PF1, 1763640000000, 'a1b2c3d4e5f60718', 'my scan.pdf');
  check('rule: a signed-file path belongs to exactly one proforma', goodPath === 'pf/' + PF1 + '/1763640000000-a1b2c3d4e5f60718-my_scan.pdf' && L.isSignedPathOf(goodPath, PF1) && !L.isSignedPathOf(goodPath, PF2) && !L.isSignedPathOf('pf/' + PF1 + '/../' + PF2 + '/1763640000000-a1b2c3d4e5f60718-x.pdf', PF1) && !L.isSignedPathOf('pf/' + PF1 + '/x.pdf', PF1) && !L.isSignedPathOf('pv/' + goodPath, PF1) && !L.isSignedPathOf(goodPath, 'not-an-id'));
  check('rule: the next version is one more than the highest on file', L.nextVersion([]) === 1 && L.nextVersion([{ version: 1 }, { version: 4 }, { version: 2 }]) === 5);
  check('rule: the history window — on or after the first allowed day; no date = not shown; no window = everything', L.insideWindow('2026-06-01', '2026-06-01') && !L.insideWindow('2026-05-31', '2026-06-01') && !L.insideWindow(null, '2026-06-01') && L.insideWindow(null, null) && L.insideWindow('2020-01-01', null));
  check('rule: the browser-side courtesy check (size, kind)', L.signedFileProblem({ size: 0, type: 'application/pdf' }) !== '' && L.signedFileProblem({ size: 16 * 1048576, type: 'application/pdf' }) !== '' && L.signedFileProblem({ size: 10, type: 'application/zip' }) !== '' && L.signedFileProblem({ size: 10, type: 'image/png' }) === '');
  check('rule: same customer links; another customer needs a yes; another business never links', L.linkProblem({ accounting_customer_id: 'a' }, { accounting_customer_id: 'a' }).ok && L.linkProblem({ accounting_customer_id: 'a' }, { accounting_customer_id: 'b' }).code === 'other_customer' && L.linkProblem({ accounting_customer_id: 'a' }, { accounting_customer_id: 'b' }, true).ok && L.linkProblem({ wave_business_id: 'x' }, { wave_business_id: 'y' }, true).code === 'other_business' && L.linkProblem({ business_id: 'x' }, { business_id: 'y' }, true).code === 'other_business');

  // ── who may do what
  fresh();
  var n0 = await call(null, { action: 'get', kind: 'invoice', id: INV1, user_id: SUPER });
  check('no verified sign-in (even with the super admin\'s id in the request) → 401', n0.status === 401, n0);
  for (var w of [NONE, ADMIN]) {
    var deniedAll = true;
    for (var b of [{ action: 'get', kind: 'invoice', id: INV1 }, { action: 'get', kind: 'proforma', id: PF1 }, { action: 'map' }, { action: 'file_url', file_id: U(999) }, { action: 'link', proforma_id: PF1, invoice_id: INV1 }, { action: 'upload_start', proforma_id: PF1, file_name: 'a.pdf', size: 5 }]) { var rr = await call(w, b); if (rr.status !== 403) { deniedAll = false; } }
    check((w === NONE ? 'a person with no invoice switch' : 'an admin with no invoice switch (the role alone gives nothing)') + ' → 403 on every action, read or write', deniedAll);
  }
  check('… and nothing at all was written or fetched for them', state.ops.length === 0 && state.store.calls.length === 0, [state.ops, state.store.calls]);
  var v1 = await call(VIEW, { action: 'get', kind: 'proforma', id: PF1 });
  check('Invoices: View only → may read; the answer says "cannot edit"', v1.status === 200 && v1.j.ok && v1.j.can_edit === false, v1);
  var vDenied = [];
  for (var wb of [{ action: 'link', proforma_id: PF1, invoice_id: INV1 }, { action: 'unlink', link_id: U(999) }, { action: 'upload_start', proforma_id: PF1, file_name: 'a.pdf', size: 5 }, { action: 'upload_finish', proforma_id: PF1, path: goodPath }]) { vDenied.push((await call(VIEW, wb)).status); }
  check('Invoices: View only → link, unlink, start upload, finish upload all 403; nothing written', vDenied.join() === '403,403,403,403' && state.ops.length === 0 && state.store.calls.length === 0, [vDenied, state.ops]);
  var bad = [await call(EDIT, { action: 'erase' }), await call(EDIT, { action: 'get', kind: 'invoice', id: 'x' }), await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: 'nope' }), await call(EDIT, { action: 'unlink', link_id: '1' }), await call(EDIT, { action: 'file_url', file_id: 'a' })];
  check('unknown action / ids that are not ids → 400', bad.every(function (x) { return x.status === 400; }), bad.map(function (x) { return x.status; }));
  check('there is no delete / remove / replace action in the route at all', ['delete', 'remove', 'replace', 'delete_file', 'remove_file', 'replace_file', 'delete_link'].every(function (a) { return !/'\s*:\s*1/.test("'" + a + "': 1") || !new RegExp("\\b" + a + ": 1").test(fs.readFileSync(path.join(root, 'src/app/api/accounting/proforma-links/route.js'), 'utf8')); }) && (await call(SUPER, { action: 'delete_file', file_id: U(1) })).status === 400);

  // ── linking
  fresh();
  var l1 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV1 });
  var row1 = rows(LINKS)[0] || {};
  check('Invoice: Create may link an existing invoice to an existing proforma; the row says who', l1.status === 200 && rows(LINKS).length === 1 && row1.proforma_id === PF1 && row1.invoice_id === INV1 && row1.linked_by === EDIT && row1.linked_by_name === 'Eddie Editor' && row1.invoice_number === 'INV-1' && row1.other_customer_confirmed === false, [l1, row1]);
  var a1 = audits('proforma_invoice_linked')[0] || {};
  check('… and the audit trail records it under the verified person', a1.actor_id === EDIT && a1.entity === 'accounting_proformas' && a1.entity_id === PF1 && a1.details.invoice_id === INV1 && a1.details.link_id === l1.j.link_id, a1);
  var gI = await call(VIEW, { action: 'get', kind: 'invoice', id: INV1 }); var gP = await call(VIEW, { action: 'get', kind: 'proforma', id: PF1 });
  check('the invoice shows the proforma it came from; the proforma shows that invoice', gI.j.proforma && gI.j.proforma.id === PF1 && gI.j.proforma.proforma_number === 'PF-1' && gI.j.proforma.via === 'link' && gI.j.proforma.linked_by_name === 'Eddie Editor' && gP.j.invoices.length === 1 && gP.j.invoices[0].id === INV1 && gP.j.invoices[0].invoice_number === 'INV-1', [gI.j, gP.j]);
  var l2 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV1 }); var l3 = await call(EDIT, { action: 'link', proforma_id: PF_EMPTY, invoice_id: INV1 });
  check('linking the same two again → 409 "already linked"; the invoice to a second proforma → 409 naming the first; still one row', l2.status === 409 && l2.j.code === 'already' && l3.status === 409 && l3.j.code === 'taken' && /PF-1/.test(l3.j.error) && rows(LINKS).length === 1, [l2, l3]);
  var l4 = await call(EDIT2, { action: 'link', proforma_id: PF1, invoice_id: INV2 });
  var gP2 = await call(VIEW, { action: 'get', kind: 'proforma', id: PF1 });
  check('Invoice: Edit may link too; one proforma shows several invoices', l4.status === 200 && gP2.j.invoices.length === 2 && rows(LINKS)[1].linked_by_name === 'Ella Edit', [l4, gP2.j.invoices]);
  var am = await call(AM, { action: 'link', proforma_id: PF_EMPTY, invoice_id: INV4 });
  check('an Accounting Manager (role default: create / edit invoices) may link', am.status === 200, am);
  var gC = await call(VIEW, { action: 'get', kind: 'invoice', id: INV3 }); var gCP = await call(VIEW, { action: 'get', kind: 'proforma', id: PF2 });
  check('an invoice made by Convert shows its proforma (and the proforma shows it) with no link row needed', gC.j.proforma && gC.j.proforma.id === PF2 && gC.j.proforma.via === 'convert' && gC.j.proforma.link_id === null && gCP.j.invoices.length === 1 && gCP.j.invoices[0].id === INV3 && gCP.j.invoices[0].via === 'convert', [gC.j, gCP.j]);
  var l5 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV3 }); var l6 = await call(EDIT, { action: 'link', proforma_id: PF2, invoice_id: INV3 });
  check('a converted invoice cannot be linked to another proforma (409, names PF-2), nor a second time to its own', l5.status === 409 && l5.j.code === 'taken' && /PF-2/.test(l5.j.error) && l6.status === 409 && l6.j.code === 'already', [l5, l6]);
  var before = rows(LINKS).length;
  var l7 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV_B });
  check('a different customer → 409 asking first; nothing written', l7.status === 409 && l7.j.code === 'other_customer' && rows(LINKS).length === before, l7);
  var l8 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV_B, confirm_other_customer: true });
  var lastA = audits('proforma_invoice_linked').slice(-1)[0];
  check('… after the person says yes it is linked, and both the row and the audit say "different customer, confirmed"', l8.status === 200 && rows(LINKS).slice(-1)[0].other_customer_confirmed === true && lastA.details.different_customer_confirmed === true, [l8, lastA]);
  var l9 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV_W, confirm_other_customer: true });
  check('a different Wave business → 409 even with a yes', l9.status === 409 && l9.j.code === 'other_business', l9);
  var l10 = await call(EDIT, { action: 'link', proforma_id: U(777), invoice_id: INV2 }); var l11 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: U(778) });
  check('a proforma or invoice that is not there → 404', l10.status === 404 && l11.status === 404, [l10, l11]);
  var mp = await call(VIEW, { action: 'map' });
  check('the list marks: each linked invoice → its proforma; each proforma → how many invoices', mp.status === 200 && mp.j.by_invoice[INV1].proforma_id === PF1 && mp.j.by_invoice[INV3].proforma_number === 'PF-2' && mp.j.by_proforma[PF1].invoices === 3 && mp.j.by_proforma[PF2].invoices === 1 && mp.j.by_proforma[PF_EMPTY].invoices === 1, mp.j);

  // ── unlinking keeps the record
  var linkId = l1.j.link_id; var nBefore = rows(LINKS).length;
  var u1 = await call(EDIT, { action: 'unlink', link_id: linkId, reason: '  linked the wrong one  ' });
  var kept = rows(LINKS).filter(function (x) { return x.id === linkId; })[0] || {};
  check('unlink: the row is stamped (who, when, why) and KEPT', u1.status === 200 && rows(LINKS).length === nBefore && !!kept.removed_at && kept.removed_by === EDIT && kept.removed_by_name === 'Eddie Editor' && kept.removed_reason === 'linked the wrong one' && kept.linked_by === EDIT, [u1, kept]);
  var a2 = audits('proforma_invoice_unlinked')[0] || {};
  check('… audited under the person, with the reason', a2.actor_id === EDIT && a2.entity_id === PF1 && a2.details.invoice_id === INV1 && a2.details.reason === 'linked the wrong one', a2);
  var gI2 = await call(VIEW, { action: 'get', kind: 'invoice', id: INV1 }); var gP3 = await call(VIEW, { action: 'get', kind: 'proforma', id: PF1 });
  check('after unlinking: the invoice shows no proforma; the proforma lists it under "earlier links" with both names', gI2.j.proforma === null && gP3.j.invoices.every(function (x) { return x.id !== INV1; }) && gP3.j.earlier_links.length === 1 && gP3.j.earlier_links[0].invoice_number === 'INV-1' && gP3.j.earlier_links[0].removed_by_name === 'Eddie Editor', [gI2.j, gP3.j]);
  var u2 = await call(EDIT, { action: 'unlink', link_id: linkId }); var u3 = await call(EDIT, { action: 'unlink', link_id: U(555) });
  check('unlinking twice → 409; an unknown link → 404', u2.status === 409 && u3.status === 404, [u2, u3]);
  var l12 = await call(EDIT, { action: 'link', proforma_id: PF_EMPTY, invoice_id: INV1 });
  check('the unlinked invoice can then be linked to another proforma (a NEW row; the old one stays)', l12.status === 200 && rows(LINKS).filter(function (x) { return x.invoice_id === INV1; }).length === 2, l12);
  check('no link row was ever deleted, and the only change to one was the unlink stamp', state.ops.filter(function (o) { return o.op === 'delete'; }).length === 0 && state.ops.filter(function (o) { return o.t === LINKS && o.op === 'update'; }).every(function (o) { return Object.keys(o.patch).sort().join() === 'removed_at,removed_by,removed_by_name,removed_reason'; }), state.ops.filter(function (o) { return o.op !== 'insert'; }));
  var raceDb = fresh(); state.beforeInsert[LINKS] = function (db, rawFrom) { rawFrom(LINKS).insert({ id: U(900), proforma_id: PF_EMPTY, invoice_id: INV1, removed_at: null }).exec(); };
  var race = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV1 });
  check('two people linking the same invoice at the same moment: the second is refused (409), one active link only', race.status === 409 && race.j.code === 'taken' && rows(LINKS).filter(function (x) { return x.invoice_id === INV1 && !x.removed_at; }).length === 1 && raceDb === state.db, race);

  // ── the history window (Max: employees see ONLY the permitted window; the super admin sees all)
  fresh();
  var w1 = await call(EDIT, { action: 'get', kind: 'invoice', id: INV_OLD }); var w2 = await call(EDIT, { action: 'get', kind: 'proforma', id: PF_OLD });
  var w3 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV_OLD }); var w4 = await call(EDIT, { action: 'link', proforma_id: PF_OLD, invoice_id: INV2 }); var w5 = await call(EDIT, { action: 'upload_start', proforma_id: PF_OLD, file_name: 'a.pdf', size: 5 });
  check('an employee cannot open, link or upload to a document older than their window (403); nothing written', [w1, w2, w3, w4, w5].every(function (x) { return x.status === 403 && /older than the history/.test(x.j.error); }) && rows(LINKS).length === 0 && state.store.calls.length === 0, [w1, w2, w3, w4, w5].map(function (x) { return x.status; }));
  var s1 = await call(SUPER, { action: 'link', proforma_id: PF_OLD, invoice_id: INV2 }); var s2 = await call(SUPER, { action: 'link', proforma_id: PF1, invoice_id: INV_OLD });
  var sOld = await sendFile(SUPER, PF_OLD, 'old-signed.pdf', PDF);
  check('the super admin can (all history)', s1.status === 200 && s2.status === 200 && sOld.finish.status === 200, [s1, s2, sOld]);
  var w6 = await call(VIEW, { action: 'get', kind: 'invoice', id: INV2 });
  check('an in-window invoice whose proforma is older: the employee is told it exists but gets no number, no id, no files', w6.status === 200 && w6.j.proforma.hidden === true && w6.j.files.length === 0 && JSON.stringify(w6.j).indexOf('PF-OLD') < 0 && JSON.stringify(w6.j).indexOf(PF_OLD) < 0, w6.j);
  var w7 = await call(VIEW, { action: 'get', kind: 'proforma', id: PF1 });
  check('an in-window proforma with an older invoice: counted as hidden, not named', w7.status === 200 && w7.j.hidden_invoices === 1 && w7.j.invoices.length === 0 && JSON.stringify(w7.j).indexOf('INV-OLD') < 0, w7.j);
  var w8 = await call(VIEW, { action: 'map' }); var w9 = await call(SUPER, { action: 'map' });
  check('the list marks leave both out for the employee; the super admin gets them', !w8.j.by_invoice[INV2] && !w8.j.by_invoice[INV_OLD] && !w8.j.by_proforma[PF_OLD] && !w8.j.by_proforma[PF1] && w9.j.by_invoice[INV2].proforma_number === 'PF-OLD' && w9.j.by_proforma[PF_OLD].signed === 1 && w9.j.by_proforma[PF1].invoices === 1, [w8.j, w9.j]);
  var oldFile = rows(FILES)[0];
  var w10 = await call(VIEW, { action: 'file_url', file_id: oldFile.id }); var w11 = await call(SUPER, { action: 'file_url', file_id: oldFile.id });
  check('the signed file of an older proforma: no link for the employee (403), a link for the super admin', w10.status === 403 && w11.status === 200 && state.store.calls.filter(function (c) { return /^createSignedUrl/.test(c); }).length === 1, [w10, w11]);
  var w12 = await call(EDIT, { action: 'unlink', link_id: s1.j.link_id });
  check('an employee cannot unlink a link that involves an older document (403); the link stays active', w12.status === 403 && !rows(LINKS)[0].removed_at, w12);
  state.db.fail.app_settings = { select: 'connection lost' };
  var w13 = await call(VIEW, { action: 'get', kind: 'invoice', id: INV1 }); var w14 = await call(SUPER, { action: 'get', kind: 'invoice', id: INV1 });
  check('if the window setting cannot be read, an employee gets nothing (fails closed); the super admin is not affected', w13.status === 503 && !w13.j.proforma && w14.status === 200, [w13, w14]);

  // ── the signed proforma: versions are added; nothing is replaced or removed
  fresh();
  var st0 = await call(EDIT, { action: 'upload_start', proforma_id: PF1, file_name: 'Signed PF-1.pdf', size: PDF.length, content_type: 'application/pdf' });
  check('start: a ticket for ONE new path under this proforma, in the private store; nothing recorded yet', st0.status === 200 && st0.j.bucket === 'proforma-signed' && L.isSignedPathOf(st0.j.path, PF1) && !!st0.j.token && rows(FILES).length === 0, st0);
  var big = await call(EDIT, { action: 'upload_start', proforma_id: PF1, file_name: 'a.pdf', size: 16 * 1048576, content_type: 'application/pdf' }); var zip = await call(EDIT, { action: 'upload_start', proforma_id: PF1, file_name: 'a.zip', size: 10, content_type: 'application/zip' });
  check('start: over 15 MB → 413; not a PDF / picture → 415', big.status === 413 && zip.status === 415, [big, zip]);
  var noFile = await call(EDIT, { action: 'upload_finish', proforma_id: PF1, path: st0.j.path, file_name: 'Signed PF-1.pdf' });
  check('finish before the file arrived → 409, nothing recorded', noFile.status === 409 && noFile.j.code === 'not_arrived' && rows(FILES).length === 0, noFile);
  state.store.put('proforma-signed', st0.j.path, PDF);
  var f1 = await call(EDIT, { action: 'upload_finish', proforma_id: PF1, path: st0.j.path, file_name: 'Signed PF-1.jpg', note: ' signed by the buyer ' });
  var r1 = rows(FILES)[0] || {};
  check('finish: version 1 saved — kind read from the real bytes (PDF, though named .jpg), size, fingerprint, who', f1.status === 200 && f1.j.file.version === 1 && r1.version === 1 && r1.content_type === 'application/pdf' && r1.size_bytes === PDF.length && r1.sha256 === crypto.createHash('sha256').update(PDF).digest('hex') && r1.uploaded_by === EDIT && r1.uploaded_by_name === 'Eddie Editor' && r1.note === 'signed by the buyer' && r1.storage_path === st0.j.path && r1.storage_bucket === 'proforma-signed', [f1, r1]);
  var a3 = audits('proforma_signed_uploaded')[0] || {};
  check('… audited under the person with version, name, size and fingerprint', a3.actor_id === EDIT && a3.entity_id === PF1 && a3.details.version === 1 && a3.details.file_id === r1.id && a3.details.sha256 === r1.sha256, a3);
  var snap1 = JSON.stringify(r1);
  var f2 = await call(EDIT, { action: 'upload_finish', proforma_id: PF1, path: st0.j.path, file_name: 'x.pdf' });
  check('finishing the same upload twice → 409, still one row', f2.status === 409 && f2.j.code === 'already' && rows(FILES).length === 1, f2);
  var sameBytes = await sendFile(EDIT2, PF1, 'copy.pdf', PDF);
  check('the very same file again → refused, pointing at version 1; nothing added', sameBytes.finish.status === 409 && sameBytes.finish.j.code === 'same_file' && sameBytes.finish.j.version === 1 && rows(FILES).length === 1, sameBytes.finish);
  var v2 = await sendFile(EDIT2, PF1, 'Signed again.png', PNG);
  check('a newer signed copy → version 2; version 1 is byte-for-byte the row it was', v2.finish.status === 200 && v2.finish.j.file.version === 2 && v2.finish.j.kept_versions === 1 && rows(FILES).length === 2 && JSON.stringify(rows(FILES)[0]) === snap1 && rows(FILES)[1].content_type === 'image/png' && rows(FILES)[1].uploaded_by_name === 'Ella Edit', [v2.finish, rows(FILES)]);
  check('… and both files are still in the store under their own paths', Object.keys(state.store.objects).length >= 2 && state.store.objects['proforma-signed/' + r1.storage_path] === PDF && rows(FILES)[1].storage_path !== r1.storage_path);
  var exe = await sendFile(EDIT, PF1, 'totally-a.pdf', EXE); var html = await sendFile(EDIT, PF1, 'page.pdf', Buffer.from('<html><script>alert(1)</script></html>'));
  check('a file that is not really a PDF or picture (whatever its name says) → 415, nothing recorded', exe.finish.status === 415 && html.finish.status === 415 && rows(FILES).length === 2, [exe.finish, html.finish]);
  var empty = await sendFile(EDIT, PF1, 'empty.pdf', Buffer.alloc(0), { size: 5, _putEmpty: true });
  check('an empty file → refused, nothing recorded', empty.finish.status === 400 && rows(FILES).length === 2, empty.finish);
  var stB = await call(EDIT, { action: 'upload_start', proforma_id: PF1, file_name: 'b.pdf', size: 10 }); state.store.put('proforma-signed', stB.j.path, JPG);
  var cross = await call(EDIT, { action: 'upload_finish', proforma_id: PF_B, path: stB.j.path, file_name: 'b.pdf' });
  var trav = await call(EDIT, { action: 'upload_finish', proforma_id: PF1, path: 'pf/' + PF1 + '/../' + PF_B + '/1763640000000-a1b2c3d4e5f60718-x.pdf' });
  var other = await call(EDIT, { action: 'upload_finish', proforma_id: PF1, path: 'pv/upload-123-bill.pdf' });
  check('a path of another proforma, a path with "..", or a path from the bills store → 400; nothing fetched, nothing recorded', cross.status === 400 && trav.status === 400 && other.status === 400 && rows(FILES).length === 2 && state.store.calls.filter(function (c) { return /^download/.test(c) && (c.indexOf('..') >= 0 || c.indexOf('pv/') >= 0); }).length === 0, [cross, trav, other]);
  var stR = await call(EDIT, { action: 'upload_start', proforma_id: PF1, file_name: 'race.jpg', size: JPG.length }); state.store.put('proforma-signed', stR.j.path, JPG);
  state.beforeInsert[FILES] = function (db, rawFrom) { rawFrom(FILES).insert({ id: U(950), proforma_id: PF1, version: 3, storage_path: 'pf/' + PF1 + '/1763640000001-ffffffffffffffff-other.pdf', sha256: 'someone-else', file_name: 'other.pdf', size_bytes: 9, content_type: 'application/pdf' }).exec(); };
  var raceF = await call(EDIT, { action: 'upload_finish', proforma_id: PF1, path: stR.j.path, file_name: 'race.jpg' });
  check('two people uploading at the same moment: both are kept, as versions 3 and 4 (never the same number, never one over the other)', raceF.status === 200 && raceF.j.file.version === 4 && rows(FILES).map(function (x) { return x.version; }).sort().join() === '1,2,3,4', [raceF, rows(FILES).map(function (x) { return x.version; })]);

  // ── reading the signed copies — from the proforma AND from its linked invoice
  await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV1 });
  var gF = await call(VIEW, { action: 'get', kind: 'proforma', id: PF1 }); var gFI = await call(VIEW, { action: 'get', kind: 'invoice', id: INV1 });
  check('the proforma lists every version, newest first, with who and when', gF.j.files.map(function (x) { return x.version; }).join() === '4,3,2,1' && gF.j.files[0].newest === true && gF.j.files[3].newest === false && gF.j.files[3].uploaded_by_name === 'Eddie Editor' && !!gF.j.files[3].uploaded_at && gF.j.files[3].file_name === 'Signed_PF-1.jpg', gF.j.files);
  check('the linked invoice shows the same versions', gFI.j.files.length === 4 && gFI.j.files[3].id === r1.id, gFI.j.files);
  check('what a reader receives never contains a storage path or a fingerprint', [gF, gFI, mp].every(function (x) { var s = JSON.stringify(x.j); return s.indexOf('storage_path') < 0 && s.indexOf('pf/') < 0 && s.indexOf('sha256') < 0 && s.indexOf(r1.sha256) < 0; }));
  var o1 = await call(VIEW, { action: 'file_url', file_id: r1.id }); var o2 = await call(VIEW, { action: 'file_url', file_id: r1.id, download: true });
  check('Open / Download: a 5-minute link to exactly that version, only after the checks', o1.status === 200 && o1.j.url.indexOf('proforma-signed/' + r1.storage_path + '?valid=300') > 0 && o1.j.expires_in_seconds === 300 && /download=Signed_PF-1\.jpg/.test(o2.j.url) && o1.j.version === 1, [o1, o2]);
  var o3 = await call(NONE, { action: 'file_url', file_id: r1.id }); var o4 = await call(VIEW, { action: 'file_url', file_id: U(404) }); var linksBefore = state.store.calls.filter(function (c) { return /^createSignedUrl/.test(c); }).length;
  check('no invoice switch → no link (403); unknown file → 404; no link was made for either', o3.status === 403 && o4.status === 404 && linksBefore === 2, [o3, o4, linksBefore]);
  check('the store was only ever asked for tickets, downloads and read links — never to upload over, update, move, copy or remove', state.store.calls.every(function (c) { return /^(createSignedUploadUrl|download|createSignedUrl) proforma-signed\//.test(c); }), state.store.calls.filter(function (c) { return !/^(createSignedUploadUrl|download|createSignedUrl) /.test(c); }));
  check('no signed-file row was ever updated or deleted by the route', state.ops.filter(function (o) { return o.t === FILES && o.op !== 'insert'; }).length === 0 && state.ops.filter(function (o) { return o.op === 'delete'; }).length === 0);

  // ── archive / void keep everything; a hard delete of such a proforma is refused
  var lifeCalls = []; state.db.rpcs.hub_invoice_lifecycle = function (args) { lifeCalls.push(args.p); return { data: { ok: true, action: args.p.action, released: 0, name: 'x' }, error: null }; };
  state.who = { userId: DEL };
  var filesBefore = JSON.stringify(rows(FILES)); var linksSnap = JSON.stringify(rows(LINKS));
  var d1 = await post(LIFE, { action: 'delete', kind: 'proforma', id: PF1 });
  check('deleting a proforma that has a signed copy → 409 "archive it instead"; the database step is never called', d1.status === 409 && d1.j.code === 'kept_records' && /kept for ever/.test(d1.j.error) && lifeCalls.length === 0, d1);
  var d2 = await post(LIFE, { action: 'archive', kind: 'proforma', id: PF1 }); var d3 = await post(LIFE, { action: 'void', kind: 'proforma', id: PF1 }); var d3b = await post(LIFE, { action: 'archive', kind: 'invoice', id: INV1 });
  check('archiving or voiding the proforma, or archiving its invoice, goes through — and no file or link row changed', d2.status === 200 && d3.status === 200 && d3b.status === 200 && lifeCalls.length === 3 && JSON.stringify(rows(FILES)) === filesBefore && JSON.stringify(rows(LINKS)) === linksSnap, [d2, d3, d3b]);
  state.db.t.accounting_proformas.forEach(function (p) { if (p.id === PF1) { p.record_status = 'archived'; } }); state.db.t.accounting_invoices.forEach(function (i) { if (i.id === INV1) { i.record_status = 'void'; } });
  var gArch = await call(VIEW, { action: 'get', kind: 'invoice', id: INV1 }); var oArch = await call(VIEW, { action: 'file_url', file_id: r1.id });
  check('an archived proforma / a void invoice still show the link and the signed copies, and the file still opens', gArch.j.proforma.id === PF1 && gArch.j.proforma.record_status === 'archived' && gArch.j.files.length === 4 && oArch.status === 200, [gArch.j, oArch]);
  await call(EDIT, { action: 'link', proforma_id: PF_EMPTY, invoice_id: INV4 }); var le = rows(LINKS).slice(-1)[0]; await call(EDIT, { action: 'unlink', link_id: le.id });
  state.who = { userId: DEL }; lifeCalls.length = 0;
  var d4 = await post(LIFE, { action: 'delete', kind: 'proforma', id: PF_EMPTY });
  check('a proforma whose only link was unlinked (history) → delete still refused', d4.status === 409 && d4.j.code === 'kept_records' && lifeCalls.length === 0, d4);
  var d5 = await post(LIFE, { action: 'delete', kind: 'proforma', id: PF_B }); var d6 = await post(LIFE, { action: 'delete', kind: 'invoice', id: INV2 });
  check('a proforma with no signed copy and no link, and any invoice: the existing rules decide as before (step called)', d5.status === 200 && d6.status === 200 && lifeCalls.length === 2 && lifeCalls[0].kind === 'proforma' && lifeCalls[1].kind === 'invoice', [d5, d6]);
  state.db.fail[FILES] = { select: 'canceling statement due to statement timeout' };
  var d7 = await post(LIFE, { action: 'delete', kind: 'proforma', id: PF_B });
  check('if the check for signed copies cannot be made, the delete does NOT go ahead', d7.status === 500 && /Nothing was changed/.test(d7.j.error) && lifeCalls.length === 2, d7);

  // ── before the database update has been run
  fresh();
  var miss = 'relation "public.' + LINKS + '" does not exist'; var missF = 'Could not find the table \'public.' + FILES + '\' in the schema cache';
  state.db.fail[LINKS] = { select: miss, insert: miss, update: miss }; state.db.fail[FILES] = { select: missF, insert: missF };
  var m1 = await call(EDIT, { action: 'get', kind: 'invoice', id: INV3 }); var m2 = await call(EDIT, { action: 'get', kind: 'proforma', id: PF1 }); var m3 = await call(EDIT, { action: 'map' });
  check('not installed yet: the screens still load, Convert links still show, and the answer says "not installed"', m1.status === 200 && m1.j.installed === false && m1.j.proforma.id === PF2 && m2.status === 200 && m2.j.installed === false && m2.j.files.length === 0 && m3.status === 200 && m3.j.installed === false && m3.j.by_invoice[INV3].proforma_id === PF2, [m1.j, m2.j, m3.j]);
  var m4 = await call(EDIT, { action: 'link', proforma_id: PF1, invoice_id: INV1 }); var m5 = await call(EDIT, { action: 'upload_start', proforma_id: PF1, file_name: 'a.pdf', size: 5 }); var m6 = await call(EDIT, { action: 'file_url', file_id: U(1) });
  check('… and linking / uploading answer 409 naming the one script to run; nothing is sent to the store', [m4, m5, m6].every(function (x) { return x.status === 409 && /v55-83-VZ-proforma-links-signed\.sql/.test(x.j.error); }) && state.store.calls.length === 0, [m4, m5, m6]);
  state.who = { userId: DEL }; state.db.rpcs.hub_invoice_lifecycle = function (args) { return { data: { ok: true, action: args.p.action }, error: null }; };
  var m7 = await post(LIFE, { action: 'delete', kind: 'proforma', id: PF_B });
  check('… and deleting a proforma works exactly as before the update', m7.status === 200, m7);
  fresh(); state.store.bucketExists = false;
  var m8 = await call(EDIT, { action: 'upload_start', proforma_id: PF1, file_name: 'a.pdf', size: 5 });
  check('tables there but the private store missing → 409 with the same instruction', m8.status === 409 && /v55-83-VZ/.test(m8.j.error), m8);

  // ── wiring (source pins): the screen, the pop-ups, and what must NOT have changed
  var read = function (rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); };
  var route = read('src/app/api/accounting/proforma-links/route.js'); var tab = read('src/components/AccountingInvoicesTab.jsx'); var boxSrc = read('src/components/ProformaLinkBox.jsx'); var peek = read('src/components/InvoicePeek.jsx'); var pfPeek = read('src/components/ProformaPeek.jsx');
  var code = route.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
  check('route style: var + string concatenation only (no let / const / arrow / template string), verified caller, no Wave call', !/\blet\s|\bconst\s(?!dynamic|maxDuration)|=>|`/.test(code) && /verifiedCaller\(req, body, createClient\)/.test(code) && !/wave\//i.test(code) && !/\.remove\(|\.delete\(|upsert/.test(code));
  check('the server-side rules file is a plain module (safe to import from the server route)', !/^s*['"]use client['"]/m.test(read('src/lib/proforma-links.js')) && !/^s*['"]use client['"]/m.test(read('src/lib/proforma-keep-server.js')));
  check('the Invoices / Proformas screen shows the box in the View window and in the Edit window, and imports it', (tab.match(/<ProformaLinkBox /g) || []).length === 2 && /import ProformaLinkBox, \{ proformaLinksApi \} from '\.\/ProformaLinkBox'/.test(tab) && /docId=\{viewing\.id\}/.test(tab) && /docId=\{editing\.id\}/.test(tab) && /import ProformaPeek from '\.\/ProformaPeek'/.test(tab) && /import InvoicePeek from '\.\/InvoicePeek'/.test(tab));
  check('the linked document opens on top: both pop-ups are on the screen and each opens the other', /<InvoicePeek invoiceId=\{peekInv\}[^>]*onOpenProforma=\{openPeekProforma\}/.test(tab) && /<ProformaPeek proformaId=\{peekPf\}[^>]*onOpenInvoice=\{openPeekInvoice\}/.test(tab) && /<ProformaLinkBox kind="invoice"/.test(peek) && /import ProformaLinkBox from/.test(peek) && /<ProformaLinkBox kind="proforma"/.test(pfPeek));
  check('the box: upload on the proforma only; every call goes through the server with the signed-in token; no direct table or bills-store access', /kind === 'proforma' && props\.allowUpload !== false/.test(boxSrc) && /hubFetch\('\/api\/accounting\/proforma-links'/.test(boxSrc) && /uploadToSignedUrl/.test(boxSrc) && !/supabase\.from\(/.test(boxSrc) && boxSrc.indexOf('bills-private') < 0 && !/\.remove\(|\.delete\(/.test(boxSrc));
  var printFn = tab.substring(tab.indexOf('function printDoc(row)'), tab.indexOf('if (!mayView) return'));
  check('the printed customer invoice / proforma is untouched by this build (no link, no signed-file text in it)', printFn.length > 2000 && !/ProformaLink|signed proforma|linkMap|proforma-links/i.test(printFn) && /Customer signature \/ date/.test(printFn));
  var conv = tab.substring(tab.indexOf('function convertProforma(row)'), tab.indexOf('function printDoc(row)'));
  check('Convert still writes the same link field as before', /status: 'converted', converted_invoice_id: invId/.test(conv));

  console.log('\nVZ proforma links: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
