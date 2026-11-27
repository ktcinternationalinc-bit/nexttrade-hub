// v55.83-ZH — Max, 25 Nov 2026: "and i should have a button to send the emails by batch with a manual button instead of automated"
// (the automatic morning run stays ON — his "Keep it on" — the button is an addition). "Send all ready reminders": a list to confirm,
// then the SAME set and the SAME rules as the morning run, results per row, safe to press twice.
// The REAL route (POST + the timer's GET) on an in-memory database, a made-up warehouse feed and a mail-server stand-in. Nothing
// leaves this machine. All customers, orders and amounts are made up.
var path = require('path'); var Module = require('module'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'x';
process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub-feed/shipping'; process.env.NEXTRADE_FEED_ALLOW_LIVE = 'yes';
process.env.NEXTRADE_FEED_TOKEN = 'test-token-0123456789-0123456789-0123456789';
process.env.COMMERCIAL_MAIL_USER = 'info@ktcus.com'; process.env.COMMERCIAL_MAIL_PASSWORD = 'not-a-real-password';
var SECRET = 'timer-secret-0123456789'; process.env.CRON_SECRET = SECRET;
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var L = require(path.join(root, 'src/lib/arrival-reminders.js'));
var S = require(path.join(root, 'src/lib/arrival-reminders-server.js'));
var US_BIZ = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;

var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('ZH — Send all ready reminders (the manual batch button)');

var TODAY = L.todayInNewYork();
function plus(n) { var m = /^(\d+)-(\d+)-(\d+)/.exec(TODAY); return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().substring(0, 10); }
function ord(id, rel, cust, o) { return Object.assign({ id: id, release_number: rel, customer_id: id, customer_name: cust, warehouse_id: 1, warehouse_name: 'USA', status: 'shipped', country: 'Peru', container: 'CONT' + id, order_closed: 0, is_draft: 0, in_house_order: 0, payment_made: 0 }, o || {}); }
function stage(orderId, arrival) { return { id: orderId * 10, order_id: orderId, order_status: 'shipping_in_process', arrival_date: arrival, updated_at: '2026-11-01 10:00:00' }; }
function inv(id, rel, cust, total, o) { return Object.assign({ id: 'i' + id, invoice_number: 'INV-' + id, release_number: rel, po_so_number: null, accounting_customer_id: cust, total_amount: total, wave_imported_paid: 0, currency: 'USD', record_status: 'active', approval_status: 'approved', wave_status: null, wave_business_id: US_BIZ, invoice_date: '2026-11-05' }, o || {}); }
var feedLive = { ok: true, source: 'nextrade-live', site: 'nextradeindustries.com', status_history: [], orders: [
  ord(1, '1002-0001', 'Alpha Trading'),          // friendly, ready
  ord(2, '1002-0002', 'Beta Imports'),           // no e-mail on the Hub customer → needs a person
  ord(3, '1003-0003', 'Gamma SA'),               // 1003: port of loading to confirm → needs a person
  ord(4, '1002-0004', 'Delta Co'),               // 2 days past, ready
  ord(5, '1001-0005', 'Eta Inc'),                // urgent, Spanish, ready
  ord(6, '1002-0006', 'Theta'),                  // paid in full → nothing to send
  ord(7, '1002-0007', 'Old Invoice Co')          // ready for the super admin; its invoice is OLDER than a staff member's history window
], requirements: [stage(1, plus(18)), stage(2, plus(10)), stage(3, plus(5)), stage(4, plus(-2)), stage(5, plus(6)), stage(6, plus(6)), stage(7, plus(9))] };
var customers = [{ id: 'c1', company_name: 'Alpha Trading', contact_name: 'Ann', email: 'buyer@alpha.example' }, { id: 'c2', company_name: 'Beta Imports', contact_name: 'Bo', email: null }, { id: 'c3', company_name: 'Gamma SA', contact_name: 'Gil', email: 'g@gamma.example' },
  { id: 'c4', company_name: 'Delta Co', contact_name: 'Dee', email: 'd@delta.example' }, { id: 'c5', company_name: 'Eta Inc', contact_name: 'Luis Vega', email: 'x@eta.example; y@eta.example', correspondence_language: 'es' },
  { id: 'c6', company_name: 'Theta', contact_name: 'Tee', email: 't@theta.example' }, { id: 'c7', company_name: 'Old Invoice Co', contact_name: 'Ola', email: 'o@old.example' }];
var invoices = [inv(1, '1002-0001', 'c1', 10000), inv(2, '1002-0002', 'c2', 2000), inv(3, '1003-0003', 'c3', 3000), inv(4, '1002-0004', 'c4', 4000), inv(5, '1001-0005', 'c5', 5000), inv(6, '1002-0006', 'c6', 600), inv(7, '1002-0007', 'c7', 7000, { invoice_date: '2026-06-01' })];
var payments = [{ id: 'p1', accounting_invoice_id: 'i1', amount: 4000, payment_date: '2026-11-06', voided: false, sync_status: 'synced' }, { id: 'p6', accounting_invoice_id: 'i6', amount: 600, payment_date: '2026-11-06', voided: false, sync_status: 'synced' }];

var sentMail = []; var smtp = {};
var fakeNodemailer = { createTransport: function () { return { sendMail: function (m) { var first = String(m.to).split(',')[0].trim(); if (smtp[first] === 'timeout') { var e = new Error('Connection timeout'); e.code = 'ETIMEDOUT'; return Promise.reject(e); } if (smtp[first] === 'refused') { return Promise.resolve({ accepted: [], rejected: [first], response: '550 no such user' }); } sentMail.push(m); return Promise.resolve({ accepted: String(m.to).split(',').map(function (x) { return x.trim(); }), rejected: [], response: '250 OK' }); } }; } };
function FakeComposer(m) { this.m = m; } FakeComposer.prototype.compile = function () { var m = this.m; return { build: function (cb) { cb(null, Buffer.from('raw:' + m.subject)); } }; };
function FakeImap() { } FakeImap.prototype.connect = function () { return Promise.resolve(); }; FakeImap.prototype.list = function () { return Promise.resolve([{ path: 'INBOX.Sent', specialUse: '\\Sent' }]); }; FakeImap.prototype.append = function () { return Promise.resolve(); }; FakeImap.prototype.logout = function () { return Promise.resolve(); };
var origLoad = Module._load;
Module._load = function (req) { if (req === 'nodemailer') { return fakeNodemailer; } if (req === 'nodemailer/lib/mail-composer') { return FakeComposer; } if (req === 'imapflow') { return { ImapFlow: FakeImap }; } return origLoad.apply(this, arguments); };
var orig = Module._resolveFilename; var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
function perms(u, list) { return list.map(function (k) { return { user_id: u, module_name: k, has_access: true }; }); }
var db = new MemDB({ users: [{ id: 'u-super', name: 'Max', email: 'max@ktc.example', role: 'super_admin', active: true }, { id: 'u-staff', name: 'Sam', email: 'sam@ktc.example', role: 'staff', active: true }, { id: 'u-view', name: 'Viv', email: 'viv@ktc.example', role: 'staff', active: true }],
  module_permissions: [].concat(perms('u-staff', ['accounting.clickbooks.access', 'accounting.view_invoicing', 'ar.view_invoice_balances', 'ar.send_reminders']), perms('u-view', ['accounting.clickbooks.access', 'accounting.view_invoicing', 'ar.view_invoice_balances'])),
  accounting_invoices: invoices, accounting_invoice_payments: payments, accounting_customers: customers, arrival_reminders: [], hub_audit_log: [], app_settings: [], accounting_invoice_items: [], company_profile: [{ id: 'co', company_name: 'KTC International Enterprises LLC' }] });
// the database's own rule (sql/v55-83-XG: uq_arrival_reminders_auto_slot)
db.hooks = { arrival_reminders: { insert: function (r) { if (r.mode !== 'auto') { return null; } var clash = db.t.arrival_reminders.some(function (x) { return x.mode === 'auto' && x.source === r.source && x.order_id === r.order_id && x.channel === r.channel && x.slot === r.slot && ['sending', 'sent', 'unknown'].indexOf(x.status) >= 0; }); return clash ? 'duplicate key value violates unique constraint "uq_arrival_reminders_auto_slot"' : null; } } };
global.__db = db;
var feedNow = feedLive;
global.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(feedNow))); } }); };
var route = require(path.join(root, 'src/app/api/accounting/arrival-reminders/route.js'));
async function call(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
async function timer() { var h = new Map(); h.set('authorization', 'Bearer ' + SECRET); var res = await route.GET({ headers: h }); var j = await res.json(); j._status = res.status; return j; }
function log() { return db.t.arrival_reminders; }
function reset() { db.t.arrival_reminders = []; sentMail.length = 0; smtp = {}; }
function keys(list) { return list.map(function (x) { return { key: x.key, seal: x.seal }; }); } // exactly what the screen sends back: each confirmed line with its seal
function byRel(results) { var o = {}; results.forEach(function (r) { o[r.release] = r; }); return o; }

(async function () {
  // ── the confirm list ──
  var v0 = await call('u-view', { action: 'batch_list' }); var n0 = await call('u-staff', { action: 'batch_list', _no_token: true });
  check('who: a person who may only VIEW balances cannot open the batch (403); no sign-in → 401', v0._status === 403 && !v0.list && n0._status === 401);
  var bl = await call('u-staff', { action: 'batch_list' });
  var rels = bl.list.map(function (x) { return x.release; }).sort().join(',');
  check('the confirm list (a person with "AR: Send reminders"): exactly the reminders the morning run would send — orders 1, 4, 5 and 7 — with the count', bl.ok && bl.count === 4 && rels === '1001-0005,1002-0001,1002-0004,1002-0007' && bl.live === true && bl.can_send === true && bl.why_not === null, bl);
  var b5 = bl.list.filter(function (x) { return x.release === '1001-0005'; })[0]; var b1 = bl.list.filter(function (x) { return x.release === '1002-0001'; })[0];
  check('…each line shows customer, release, stage, language and e-mail (and what is still owed)', b5.customer === 'Eta Inc' && b5.stage === 'urgent' && b5.language === 'es' && b5.language_chosen === true && b5.to === 'x@eta.example, y@eta.example' && b5.remaining === 5000 && b1.customer === 'Alpha Trading' && b1.stage === 'friendly' && b1.language === 'en' && b1.language_chosen === false && b1.to === 'buyer@alpha.example' && b1.remaining === 6000 && /^\d+\|friendly-1$/.test(b1.key) && /^[0-9a-f]{64}$/.test(b1.seal) && b1.seal !== b5.seal, [b5, b1]);
  check('…the orders that need a person, and the paid one, are NOT in it; the office copy is shown', rels.indexOf('1002-0002') < 0 && rels.indexOf('1003-0003') < 0 && rels.indexOf('1002-0006') < 0 && bl.cc.join('|') === 'Jasmine@ktcus.com|hsaad@ktcus.com');
  check('opening the list sends nothing and logs nothing', sentMail.length === 0 && log().length === 0);

  // ── sending ──
  var s0 = await call('u-staff', { action: 'batch_send', items: keys(bl.list) }); var s1 = await call('u-staff', { action: 'batch_send', confirm: true }); var s2 = await call('u-staff', { action: 'batch_send', confirm: true, items: [] }); var s3 = await call('u-view', { action: 'batch_send', confirm: true, items: keys(bl.list) });
  check('refused, nothing sent: no confirmation · no list · an empty list · a person without the send permission', s0.ok === false && s1.ok === false && s2.ok === false && s3._status === 403 && sentMail.length === 0 && log().length === 0, [s0, s1, s2, s3]);
  var go = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }); var r = byRel(go.results);
  check('"Send these 4 reminders now": 4 sent, one result line per order', go.ok && go.confirmed === 4 && go.sent === 4 && go.not_sent === 0 && go.delivery_unconfirmed === 0 && go.skipped === 0 && go.results.length === 4 && go.results.every(function (x) { return x.outcome === 'sent' && !!x.to && !!x.customer; }) && sentMail.length === 4, go);
  var m5 = sentMail.filter(function (x) { return x.to === 'x@eta.example, y@eta.example'; })[0]; var m1 = sentMail.filter(function (x) { return x.to === 'buyer@alpha.example'; })[0];
  check('…the same e-mails the morning run sends: approved text for the stage, the customer’s language, CC to Jasmine + hsaad, the invoice PDF, from info@ktcus.com', m1.subject === '1002-0001 · KTC · Houston → Peru · Container CONT1' && m1.text.indexOf('Dear Ann,') === 0 && m1.text.indexOf('Balance remaining: $6,000.00') > 0 && m5.text.indexOf('Estimado/a Luis Vega:') === 0 && sentMail.every(function (x) { return x.cc === 'Jasmine@ktcus.com, hsaad@ktcus.com' && x.from === '"KTC International" <info@ktcus.com>' && x.attachments && x.attachments.length === 1 && /^Invoice-INV-\d\.pdf$/.test(x.attachments[0].filename); }), [m1 && m1.subject, m5 && m5.text.substring(0, 40)]);
  check('…each one logged before it left, with WHO pressed the button', log().length === 4 && log().every(function (x) { return x.status === 'sent' && x.sent_by === 'u-staff' && x.sent_by_name === 'Sam — send all ready' && x.mode === 'auto' && x.cc === 'Jasmine@ktcus.com, hsaad@ktcus.com' && !!x.body; }), log().map(function (x) { return x.sent_by_name + ':' + x.status; }));
  var au = db.t.hub_audit_log.filter(function (a) { return a.action === 'arrival_reminders_batch_sent'; })[0] || { details: {} };
  check('…and the audit trail has the batch (who, how many) and each reminder marked as a batch send, not an automatic one', au.actor_id === 'u-staff' && au.details.confirmed === 4 && au.details.sent === 4 && db.t.hub_audit_log.filter(function (a) { return a.action === 'arrival_reminder_sent' && a.details.batch === true && a.details.automatic === false && a.actor_id === 'u-staff'; }).length === 4, au);

  // ── safe to press twice ──
  var again = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) });
  check('pressing it AGAIN with the same list: nothing is sent a second time — every line says it was already sent', again.ok && again.sent === 0 && again.skipped === 4 && again.results.every(function (x) { return x.outcome === 'skipped' && /already sent/.test(x.why); }) && sentMail.length === 4 && log().length === 4, again);
  var bl2 = await call('u-staff', { action: 'batch_list' }); var li2 = await call('u-staff', { action: 'list' });
  check('the list afterwards is empty (0 ready), and the screen’s count is 0', bl2.count === 0 && bl2.list.length === 0 && li2.auto.would_send === 0);
  var t1 = await timer();
  check('the morning run after the button (switch OFF here): does nothing', t1.off === true && sentMail.length === 4);
  await call('u-super', { action: 'auto_set', enabled: true, confirm: true }); var t2 = await timer();
  check('…and with the automatic switch ON, the morning run does not re-send what the button sent', t2.run.sent.length === 0 && sentMail.length === 4);

  reset();
  var both = await Promise.all([call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }), call('u-super', { action: 'batch_send', confirm: true, items: keys(bl.list) })]);
  var per = {}; sentMail.forEach(function (x) { per[x.to] = (per[x.to] || 0) + 1; });
  check('two people press it at the very same moment: each reminder still goes out ONCE (the database refuses the second claim of a stage)', sentMail.length === 4 && Object.keys(per).every(function (k) { return per[k] === 1; }) && both[0].sent + both[1].sent === 4 && both[0].skipped + both[1].skipped === 4 && log().length === 4, [both[0].sent, both[1].sent, per]);
  reset();
  var mix = await Promise.all([call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }), timer()]);
  var per2 = {}; sentMail.forEach(function (x) { per2[x.to] = (per2[x.to] || 0) + 1; });
  check('the button and the morning run at the very same moment: each reminder once', sentMail.length === 4 && Object.keys(per2).every(function (k) { return per2[k] === 1; }) && mix[0].sent + mix[1].run.sent.length === 4, [mix[0].sent, mix[1].run && mix[1].run.sent.length, per2]);
  await call('u-super', { action: 'auto_set', enabled: false });
  check('the button never changes the automatic switch (it is OFF again only because this test switched it)', db.t.app_settings.filter(function (x) { return x.key === S.AUTO_SWITCH_KEY; })[0].value.by === 'u-super' && !db.t.hub_audit_log.some(function (a) { return /auto_(on|off)/.test(a.action) && a.actor_id === 'u-staff'; }));

  // ── only what was confirmed, and only what is still due ──
  reset();
  var part = await call('u-staff', { action: 'batch_send', confirm: true, items: [{ key: b1.key, seal: b1.seal }, { key: b1.key, seal: b1.seal }, { key: '2|firmer-2', seal: b1.seal }, { key: '6|urgent-1', seal: b1.seal }, { key: '999|urgent-1', seal: 'x' }, { key: '4|overdue-1999-01-01', seal: 'x' }, { key: 'nonsense', seal: 'x' }, 'not an object', null] }); var rp = byRel(part.results);
  check('only the confirmed orders that are STILL due are sent: order 1 once (listed twice); an order that needs a person, the paid order, an unknown order, an old stage and a bad key are each reported "not sent" and nothing goes to them', part.sent === 1 && sentMail.length === 1 && sentMail[0].to === 'buyer@alpha.example' && part.skipped === 5 && part.results.filter(function (x) { return x.outcome === 'skipped'; }).every(function (x) { return /no longer due|already sent/.test(x.why); }) && rp['1002-0002'].outcome === 'skipped' && rp['1002-0006'].outcome === 'skipped' && log().length === 1, part);
  check('…the orders that were due but NOT in the confirmed list were not sent (4, 5, 7 still wait)', (await call('u-staff', { action: 'batch_list' })).count === 3);

  // ── Codex 25 Nov, finding 1: the confirmation is bound to what the person SAW ──
  reset(); var seen = await call('u-staff', { action: 'batch_list' }); var sAll = keys(seen.list);
  db.t.accounting_customers.filter(function (c) { return c.id === 'c1'; })[0].email = 'someone-else@alpha.example';               // order 1: the Hub customer's address is changed after the list was shown
  db.t.accounting_customers.filter(function (c) { return c.id === 'c5'; })[0].correspondence_language = 'fr';                       // order 5: another language is chosen
  db.t.accounting_invoice_payments.push({ id: 'pz4', accounting_invoice_id: 'i4', amount: 1000, payment_date: '2026-11-20', voided: false, sync_status: 'synced' }); // order 4: a payment arrives
  var chg = await call('u-staff', { action: 'batch_send', confirm: true, items: sAll }); var rc = byRel(chg.results);
  check('finding 1: after the list was shown, a customer address, a language and a balance change → those three are NOT sent ("changed since the list was shown"); only the unchanged order goes; nothing reaches the new address the person never saw', chg.ok && chg.sent === 1 && chg.changed === 3 && rc['1002-0007'].outcome === 'sent' && ['1002-0001', '1001-0005', '1002-0004'].every(function (k) { return rc[k].outcome === 'skipped' && /changed since the list was shown/.test(rc[k].why); }) && sentMail.length === 1 && sentMail[0].to === 'o@old.example' && sentMail.every(function (x) { return x.to.indexOf('someone-else@') < 0; }) && log().length === 1, chg);
  var seen2 = await call('u-staff', { action: 'batch_list' }); var l1 = seen2.list.filter(function (x) { return x.release === '1002-0001'; })[0];
  check('…the refreshed list shows them as they are NOW (the new address, French, the lower balance) with new seals', seen2.count === 3 && l1.to === 'someone-else@alpha.example' && l1.seal !== b1.seal && seen2.list.filter(function (x) { return x.release === '1001-0005'; })[0].language === 'fr' && seen2.list.filter(function (x) { return x.release === '1002-0004'; })[0].remaining === 3000);
  var forged = await call('u-staff', { action: 'batch_send', confirm: true, items: [{ key: l1.key, seal: l1.seal, to: 'attacker@evil.example', cc: 'attacker@evil.example', body: 'pay me' }, { key: seen2.list.filter(function (x) { return x.release === '1001-0005'; })[0].key }, { key: seen2.list.filter(function (x) { return x.release === '1002-0004'; })[0].key, seal: 'deadbeef' }] });
  check('…an address, copy list or text supplied by the browser is never used (the server sends its OWN current draft to the customer on file); a line with no seal or a wrong seal is not sent', forged.sent === 1 && sentMail.length === 2 && sentMail[1].to === 'someone-else@alpha.example' && sentMail[1].cc === 'Jasmine@ktcus.com, hsaad@ktcus.com' && sentMail[1].text.indexOf('pay me') < 0 && JSON.stringify(sentMail).indexOf('attacker@') < 0 && forged.changed === 2, forged);
  await call('u-super', { action: 'cc_set', cc: 'Jasmine@ktcus.com' }); var seen3 = await call('u-staff', { action: 'batch_list' }); await call('u-super', { action: 'cc_set', cc: 'Jasmine@ktcus.com; hsaad@ktcus.com' });
  var ccChg = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(seen3.list) });
  check('…the copy list is part of what was confirmed: it changed after the list was shown → nothing is sent until the person looks again', seen3.count === 2 && ccChg.sent === 0 && ccChg.changed === 2 && sentMail.length === 2, ccChg);
  db.t.accounting_customers.filter(function (c) { return c.id === 'c1'; })[0].email = 'buyer@alpha.example'; db.t.accounting_customers.filter(function (c) { return c.id === 'c5'; })[0].correspondence_language = 'es'; db.t.accounting_invoice_payments = db.t.accounting_invoice_payments.filter(function (p) { return p.id !== 'pz4'; });

  // ── Codex 25 Nov, finding 2: a one-order send, the batch and the morning run share ONE atomic claim of a stage ──
  reset(); var fresh = await call('u-staff', { action: 'batch_list' }); var pv1 = await call('u-staff', { action: 'preview', order_id: 1 });
  var one = { action: 'send', order_id: 1, draft_hash: pv1.draft_hash, confirm: true, to: 'buyer@alpha.example', confirm_to: 'buyer@alpha.example' };
  var ov = await Promise.all([call('u-staff', one), call('u-super', { action: 'batch_send', confirm: true, items: keys(fresh.list) })]);
  var to1 = sentMail.filter(function (x) { return x.to === 'buyer@alpha.example'; }).length; var rows1 = log().filter(function (x) { return x.order_id === 1; });
  check('finding 2: a one-order Send and "Send all ready" for the same stage, started together with no resend tick: the customer gets ONE e-mail, the log has ONE row for that stage, and the loser is told plainly', to1 === 1 && rows1.length === 1 && rows1[0].status === 'sent' && sentMail.length === 4 && ((ov[0].ok && byRel(ov[1].results)['1002-0001'].outcome === 'skipped') || (ov[0]._status === 409 && ov[0].claimed_elsewhere === true && byRel(ov[1].results)['1002-0001'].outcome === 'sent')), [ov[0], byRel(ov[1].results)['1002-0001'], rows1.map(function (x) { return x.mode + ':' + x.status + ':' + x.sent_by_name; })]);
  reset(); var pvA = await call('u-staff', { action: 'preview', order_id: 1 }); var two = await Promise.all([call('u-staff', Object.assign({}, one, { draft_hash: pvA.draft_hash })), call('u-super', Object.assign({}, one, { draft_hash: pvA.draft_hash }))]);
  check('…two people pressing Send on the same order at the same moment: one e-mail, one row; the other is refused (409) and nothing of theirs is logged', sentMail.length === 1 && log().length === 1 && [two[0], two[1]].filter(function (x) { return x.ok; }).length === 1 && [two[0], two[1]].filter(function (x) { return x._status === 409 && x.claimed_elsewhere === true && /nothing was sent from here/.test(x.error); }).length === 1, two);
  reset(); await call('u-super', { action: 'auto_set', enabled: true, confirm: true }); var pvB = await call('u-staff', { action: 'preview', order_id: 1 });
  var tm = await Promise.all([call('u-staff', Object.assign({}, one, { draft_hash: pvB.draft_hash })), timer()]); await call('u-super', { action: 'auto_set', enabled: false });
  check('…a person’s Send and the morning run at the same moment: one e-mail for that stage', sentMail.filter(function (x) { return x.to === 'buyer@alpha.example'; }).length === 1 && log().filter(function (x) { return x.order_id === 1; }).length === 1, [tm[0], tm[1].run && tm[1].run.sent.length]);
  var rowP = log().filter(function (x) { return x.order_id === 1; })[0]; var liP = await call('u-staff', { action: 'list' }); var r1P = liP.rows.filter(function (x) { return x.order_id === 1; })[0];
  check('…the stage then counts as sent for everyone: the batch list no longer offers it and a plain second Send is refused', r1P.slot_sent === true && (await call('u-staff', { action: 'batch_list' })).list.every(function (x) { return x.release !== '1002-0001'; }) && (await call('u-staff', Object.assign({}, one, { draft_hash: pvB.draft_hash })))._status === 409 && sentMail.filter(function (x) { return x.to === 'buyer@alpha.example'; }).length === 1);
  var pvC = await call('u-staff', { action: 'preview', order_id: 1 }); var dl = await call('u-staff', Object.assign({}, one, { draft_hash: pvC.draft_hash, again: true })); var rowD = log()[log().length - 1];
  check('…the separate, explicit "send another one" decision is kept: ticked, a second reminder goes, recorded as that person’s deliberate re-send (not a stage claim)', dl.ok && sentMail.filter(function (x) { return x.to === 'buyer@alpha.example'; }).length === 2 && rowD.mode === 'manual' && rowD.sent_by === 'u-staff' && rowD.sent_by_name === 'Sam' && db.t.hub_audit_log.some(function (a) { return a.action === 'arrival_reminder_sent' && a.details.first_send_of_the_stage === false && a.details.sent_again_after_a_confirmed_send === true; }), [dl, rowD.mode]);
  reset(); smtp['buyer@alpha.example'] = 'timeout'; var pvU = await call('u-staff', { action: 'preview', order_id: 1 }); var un1 = await call('u-staff', Object.assign({}, one, { draft_hash: pvU.draft_hash })); smtp = {};
  var un2 = await call('u-super', { action: 'batch_send', confirm: true, items: keys((await call('u-super', { action: 'batch_list' })).list.concat([{ key: b1.key, seal: b1.seal }])) }); await call('u-super', { action: 'auto_set', enabled: true, confirm: true }); var un3 = await timer(); await call('u-super', { action: 'auto_set', enabled: false });
  check('…a one-order send whose delivery is UNCONFIRMED holds the stage: neither the batch nor the morning run sends it; only the person’s explicit "I checked" does', un1.delivery_unconfirmed === true && log().filter(function (x) { return x.order_id === 1; }).length === 1 && log().filter(function (x) { return x.order_id === 1; })[0].status === 'unknown' && sentMail.every(function (x) { return x.to !== 'buyer@alpha.example'; }) && un2.ok && un3.run.sent.every(function (x) { return x.release !== '1002-0001'; }), [un1, un2.results, un3.run]);
  var pvK = await call('u-staff', { action: 'preview', order_id: 1 }); var ck = await call('u-staff', Object.assign({}, one, { draft_hash: pvK.draft_hash, resend_after_unconfirmed: true }));
  check('…"I checked — send another one" then sends it, as a deliberate re-send', ck.ok && sentMail.filter(function (x) { return x.to === 'buyer@alpha.example'; }).length === 1 && log()[log().length - 1].mode === 'manual');
  reset(); smtp['mistyped@alpha.example'] = 'refused'; var pvR = await call('u-staff', { action: 'preview', order_id: 1 });
  var typo = Object.assign({}, one, { draft_hash: pvR.draft_hash, to: 'mistyped@alpha.example', confirm_to: 'mistyped@alpha.example' }); var ty1 = await call('u-staff', typo); var ty2 = await call('u-staff', typo); smtp = {};
  var afterTypo = await call('u-staff', { action: 'batch_list' });
  check('…an address a person mistyped twice (refused by the mail server) does not use up the schedule’s two tries: the order is still offered for the customer’s real address', ty1._status === 502 && ty2._status === 502 && afterTypo.list.some(function (x) { return x.release === '1002-0001' && x.to === 'buyer@alpha.example'; }), [ty1, ty2]);

  // ── results per row: sent / not sent / delivery unconfirmed ──
  reset(); smtp['buyer@alpha.example'] = 'refused'; smtp['d@delta.example'] = 'timeout';
  var bad = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }); var rb = byRel(bad.results);
  check('per-row results: one refused by the mail server = "not sent" with the reason; one with no answer = "delivery unconfirmed"; the others sent', bad.ok && bad.sent === 2 && bad.not_sent === 1 && bad.delivery_unconfirmed === 1 && rb['1002-0001'].outcome === 'not_sent' && /did not accept/.test(rb['1002-0001'].why) && rb['1002-0004'].outcome === 'unconfirmed' && /DELIVERY UNCONFIRMED/.test(rb['1002-0004'].why) && rb['1001-0005'].outcome === 'sent' && rb['1002-0007'].outcome === 'sent' && sentMail.length === 2, bad);
  smtp = {}; var bl3 = await call('u-staff', { action: 'batch_list' });
  check('afterwards: the refused one is offered again; the unconfirmed one is NOT (a person must check it — it may have arrived); the sent ones are gone', bl3.count === 1 && bl3.list[0].release === '1002-0001');
  var retry = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }); var rr = byRel(retry.results);
  check('pressing again with the OLD list: the refused one is now sent; the unconfirmed one and the sent ones are not sent again', retry.sent === 1 && rr['1002-0001'].outcome === 'sent' && rr['1002-0004'].outcome === 'skipped' && rr['1001-0005'].outcome === 'skipped' && sentMail.length === 3 && log().filter(function (x) { return x.order_id === 4; }).length === 1 && log().filter(function (x) { return x.order_id === 4; })[0].status === 'unknown', retry);

  // ── the same guards as the morning run ──
  reset(); process.env.NEXTRADE_FEED_URL = 'https://fix.nextrade-staging.com/api/hub-feed/shipping'; feedNow = Object.assign({}, feedLive, { source: 'nextrade-staging' });
  var stL = await call('u-staff', { action: 'batch_list' }); var stS = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) });
  process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub-feed/shipping'; feedNow = feedLive;
  check('the Hub reading the STAGING copy: the list says it cannot be sent and why; a send is refused — never from a test copy', stL.ok && stL.live === false && stL.can_send === false && /not the live one/.test(stL.why_not) && stS._status === 409 && /nothing was sent/.test(stS.error) && sentMail.length === 0 && log().length === 0, [stL.why_not, stS]);
  process.env.COMMERCIAL_MAIL_USER = 'sales@ktcus.com'; var wfL = await call('u-staff', { action: 'batch_list' }); var wfS = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }); process.env.COMMERCIAL_MAIL_USER = 'info@ktcus.com';
  var pw = process.env.COMMERCIAL_MAIL_PASSWORD; delete process.env.COMMERCIAL_MAIL_PASSWORD; var nmS = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }); process.env.COMMERCIAL_MAIL_PASSWORD = pw;
  check('a mailbox that is not info@ktcus.com, or no mailbox: nothing is sent', wfL.can_send === false && /not info@ktcus\.com/.test(wfL.why_not) && wfS._status === 503 && wfS.wrong_from === true && nmS._status === 503 && sentMail.length === 0 && log().length === 0);
  var realFetch = global.fetch; global.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.reject(new Error('Unexpected end of JSON input')); } }); };
  var fdL = await call('u-staff', { action: 'batch_list' }); var fdS = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }); global.fetch = realFetch;
  check('the warehouse cannot be read: no list, nothing sent, the reason given (never "nothing is ready")', fdL.ok === false && !fdL.list && /did not send a readable order list|warehouse feed answered 200/.test(fdL.error) && fdS.ok === false && sentMail.length === 0, [fdL, fdS, sentMail.length]);

  // ── a person limited by the history window ──
  db.t.app_settings.push({ key: 'accounting_visibility_window', value: { window: 'custom', customFrom: '2026-11-01' } });
  var wl = await call('u-staff', { action: 'batch_list' }); var wsu = await call('u-super', { action: 'batch_list' });
  check('a person limited to a history window is offered only the orders they may see in full (order 7’s June invoice is outside it); the super admin still gets all 4', wl.count === 3 && wl.list.every(function (x) { return x.release !== '1002-0007'; }) && wsu.count === 4, [wl.list.map(function (x) { return x.release; }), wsu.count]);
  var ws = await call('u-staff', { action: 'batch_send', confirm: true, items: keys(bl.list) }); var rw = byRel(ws.results);
  check('…and even with a key for the limited order in the request, that person cannot send it (3 sent, the limited one reported not sent, no figure of it in the answer)', ws.sent === 3 && rw['1002-0007'].outcome === 'skipped' && sentMail.length === 3 && sentMail.every(function (x) { return x.to !== 'o@old.example'; }) && JSON.stringify(ws).indexOf('7000') < 0 && JSON.stringify(ws).indexOf('7,000') < 0, ws);
  db.t.app_settings = db.t.app_settings.filter(function (x) { return x.key !== 'accounting_visibility_window'; });

  // ── screen ──
  var React = require('react'); global.React = React; var RS = require('react-dom/server');
  var UI = require(path.join(root, 'src/components/ArrivalRemindersTab.jsx'));
  var hL = RS.renderToStaticMarkup(React.createElement(UI.BatchListView, { list: bl.list })).replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ');
  check('screen: the confirm list shows customer, release, stage, language and e-mail for each', /Customer Release Stage Language E-mail Still owed/.test(hL) && /Alpha Trading 1002-0001 Friendly · 18 days English \(not chosen yet\) buyer@alpha\.example \$6,000\.00/.test(hL) && /Eta Inc 1001-0005 Urgent · 6 days Spanish x@eta\.example, y@eta\.example \$5,000\.00/.test(hL) && /Delta Co 1002-0004 Beyond urgent · 2 days past/.test(hL), hL);
  var hR = RS.renderToStaticMarkup(React.createElement(UI.BatchResultsView, { results: bad.results })); var tR = hR.replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ');
  check('screen: the results show each order as Sent / Not sent / Delivery unconfirmed, with the reason', (tR.match(/ Sent /g) || []).length === 2 && / Not sent Alpha Trading 1002-0001 buyer@alpha\.example The mail server did not accept/.test(tR) && / Delivery unconfirmed Delta Co 1002-0004 d@delta\.example DELIVERY UNCONFIRMED/.test(tR), tR);
  check('screen: an empty list says nothing is ready', RS.renderToStaticMarkup(React.createElement(UI.BatchListView, { list: [] })).indexOf('No reminder is ready to go right now.') > 0);
  var src = fs.readFileSync(path.join(root, 'src/components/ArrivalRemindersTab.jsx'), 'utf8');
  check('screen: the button "Send all ready reminders (N)" opens the list first (batch_list), sends only on a second, confirmed click (batch_send with the listed keys), and cannot be pressed again while sending or after it finished', src.indexOf("'Send all ready reminders (' + (data.auto.would_send || 0) + ')'") > 0 && src.indexOf("call({ action: 'batch_list' })") > 0 && src.indexOf("call({ action: 'batch_send', confirm: true, items: b.list.map(function (x) { return { key: x.key, seal: x.seal }; }) })") > 0 && src.indexOf('batch.done.changed > 0') > 0 && src.indexOf('!b.can_send || b.sending || b.done') > 0 && src.indexOf("window.confirm('Send these ' + b.list.length + ' reminders to the customers now?')") > 0 && src.indexOf('<BatchListView list={batch.list} />') > 0 && src.indexOf('<BatchResultsView results={batch.done.results} />') > 0);
  var rs = fs.readFileSync(path.join(root, 'src/app/api/accounting/arrival-reminders/route.js'), 'utf8');
  check('route: the morning run and the button use ONE send routine (sendDue), and the file is still var + concatenation only', (rs.match(/await sendDue\(db, all, mailCfg, /g) || []).length === 2 && (rs.match(/async function sendDue\(/g) || []).length === 1 && (rs.match(/mode: 'auto'/g) || []).length === 1 && !/\blet\s|\bconst\s|=>|`/.test(rs.replace(/export const maxDuration/, '')));
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  check('What’s New has the ZH entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-ZH'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55.83-[A-Z]{2,3})'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());

  Module._load = origLoad; Module._resolveFilename = orig;
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
