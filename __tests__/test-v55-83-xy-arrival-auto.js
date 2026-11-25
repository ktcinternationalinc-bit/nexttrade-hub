// v55.83-XY — Max, 23 Nov 2026, on the live reminders screen: "change that .. take from hub customer" (the Send-to) · "need in customer
// list in hub radio box to indicate the language to use with correspondce" · "default language is eglish" · "this needs to be automated at
// begining of the day of the time email is needed" · "cced to Jasmine@ktcus.com hsaad@ktcus.com" · "SHOULS BE SENT FROM info@ktcus.com" ·
// "please attach a copy of the invoice" · (PDF cannot be produced) "SEND IT ANYWAY".
// (the file's first checks cover the addresses; then the rows; then the REAL route, POST and the timer's GET)
// The REAL helpers and the REAL route (POST + the timer's GET) on an in-memory database, a made-up warehouse feed and a mail-server
// stand-in. Nothing leaves this machine. All customers, orders and amounts are made up.
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
console.log('XY — Hub-customer Send-to and language, CC, sender, invoice PDF, and the automatic morning run');

// ── 1. the addresses on the warehouse customer ──
var r1 = L.recipientsOf('buyer@acme.example'); var r2 = L.recipientsOf(' a@x.example; B@y.example ,a@X.example\n<c@z.example> ');
check('one address', r1.list.length === 1 && r1.list[0] === 'buyer@acme.example' && r1.bad.length === 0);
check('several addresses (comma / semicolon / space / line / angle brackets), each once', r2.list.join('|') === 'a@x.example|B@y.example|c@z.example' && r2.bad.length === 0, r2);
check('empty / missing → none', L.recipientsOf('').list.length === 0 && L.recipientsOf(null).list.length === 0 && L.recipientsOf(undefined).list.length === 0);
var r3 = L.recipientsOf('ok@x.example, call Maria, x@y, two@@x.example');
check('anything that is not a plain address is reported, never guessed', r3.list.join('|') === 'ok@x.example' && r3.bad.indexOf('call') >= 0 && r3.bad.indexOf('x@y') >= 0 && r3.bad.indexOf('two@@x.example') >= 0, r3);
var r4 = L.recipientsOf('a@x.example\r\nBcc: evil@x.example');
check('a header smuggled into the field cannot add a hidden recipient (it is just another address, and "Bcc:" is reported)', r4.list.join('|') === 'a@x.example|evil@x.example' && r4.bad.indexOf('Bcc:') >= 0, r4);
var r5 = L.recipientsOf('1@x.example 2@x.example 3@x.example 4@x.example 5@x.example 6@x.example 7@x.example');
check('at most 5 are used; the rest are counted', r5.list.length === 5 && r5.extra === 2);

// ── 2. fixtures ──
var TODAY = L.todayInNewYork();
function plus(n) { var m = /^(\d+)-(\d+)-(\d+)/.exec(TODAY); return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().substring(0, 10); }
function ord(id, rel, cust, hubEmailNote, o) { return Object.assign({ id: id, release_number: rel, customer_id: id, customer_name: cust, warehouse_id: 1, warehouse_name: 'USA', status: 'shipped', country: 'Peru', container: 'CONT' + id, order_closed: 0, is_draft: 0, in_house_order: 0, payment_made: 0, customer_email: 'wh' + id + '@warehouse.example', customer_language: 'ar', customer_contact_person: 'Warehouse Person ' + id }, o || {}); }
function stage(orderId, arrival) { return { id: orderId * 10, order_id: orderId, order_status: 'shipping_in_process', arrival_date: arrival, updated_at: '2026-11-01 10:00:00' }; }
function inv(id, rel, cust, total, o) { return Object.assign({ id: 'i' + id, invoice_number: 'INV-' + id, release_number: rel, po_so_number: null, accounting_customer_id: cust, total_amount: total, wave_imported_paid: 0, currency: 'USD', record_status: 'active', approval_status: 'approved', wave_status: null, wave_business_id: US_BIZ, invoice_date: '2026-10-01' }, o || {}); }
var feedLive = { ok: true, source: 'nextrade-live', site: 'nextradeindustries.com', orders: [
  ord(1, '1002-0001', 'Alpha Trading', 'buyer@alpha.example'),                        // friendly, everything in order → goes by itself
  ord(2, '1002-0002', 'Beta Imports', ''),                                            // no e-mail in the warehouse → a person
  ord(3, '1002-0003', 'Quite Another Name', 'g@gamma.example'),                       // customer name differs → a person
  ord(4, '1003-0004', 'Delta Co', 'd@delta.example'),                                 // 1003: port of loading to confirm → a person
  ord(5, '1002-0005', 'Epsilon Ltd', 'e@eps.example'),                                // 2 days past the date → one a day
  ord(6, '1002-0006', 'Zeta LLC', 'z@zeta.example'),                                  // 40 days past → the daily reminder has stopped
  ord(7, '1001-0007', 'Eta Inc', 'x@eta.example; y@eta.example'), // two addresses on the Hub customer, Spanish chosen there
  ord(8, '1002-0008', 'Theta', 't@theta.example'),                                    // paid in full → nothing to send
  ord(9, '1002-0009', 'Iota', 'call the office')                                      // the e-mail field holds no address
], requirements: [stage(1, plus(18)), stage(2, plus(10)), stage(3, plus(3)), stage(4, plus(5)), stage(5, plus(-2)), stage(6, plus(-40)), stage(7, plus(6)), stage(8, plus(6)), stage(9, plus(6))], status_history: [] };
var HUB_EMAIL = { 1: 'buyer@alpha.example', 2: '', 3: 'g@gamma.example', 4: 'd@delta.example', 5: 'e@eps.example', 6: 'z@zeta.example', 7: 'x@eta.example; y@eta.example', 8: 't@theta.example', 9: 'call the office' };
var customers = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return { id: 'c' + n, company_name: ['', 'Alpha Trading', 'Beta Imports', 'Gamma SA', 'Delta Co', 'Epsilon Ltd', 'Zeta LLC', 'Eta Inc', 'Theta', 'Iota'][n], contact_name: n === 7 ? 'Luis Vega' : 'Contact ' + n, email: HUB_EMAIL[n] || null, billing_address: n + ' Main Street\nLima', correspondence_language: n === 7 ? 'es' : null }; });
var invoices = [inv(1, '1002-0001', 'c1', 10000), inv(2, '1002-0002', 'c2', 2000), inv(3, '1002-0003', 'c3', 3000), inv(4, '1003-0004', 'c4', 4000), inv(5, '1002-0005', 'c5', 5000), inv(6, '1002-0006', 'c6', 6000), inv(7, '1001-0007', 'c7', 7000), inv(8, '1002-0008', 'c8', 800), inv(9, '1002-0009', 'c9', 900)];
var payments = [{ id: 'p1', accounting_invoice_id: 'i1', amount: 4000, payment_date: '2026-11-02', voided: false, sync_status: 'synced' }, { id: 'p8', accounting_invoice_id: 'i8', amount: 800, payment_date: '2026-11-02', voided: false, sync_status: 'synced' }];

var built = S.buildReminderRows({ feed: feedLive, invoices: invoices, payments: payments, customers: customers, log: [], today: TODAY });
var by = {}; built.rows.forEach(function (r) { by[r.order_id] = r; });
check('Send-to is the HUB customer’s e-mail — the warehouse feed’s address, language and contact person are in the feed and are NOT used', by[1].email === 'buyer@alpha.example' && by[1].email_from === 'hub' && by[1].recipients.length === 1 && by[1].fields.name === 'Contact 1' && by[1].language === 'en' && by[1].language_chosen === false && JSON.stringify(built.rows).indexOf('@warehouse.example') < 0 && JSON.stringify(built.rows).indexOf('Warehouse Person') < 0, by[1]);
check('no e-mail on the Hub customer → no Send-to; by hand the person types one, by itself it is "cannot send"', by[2].email === null && by[2].email_from === null && by[2].recipients.length === 0 && by[2].blocks.length === 0 && by[2].auto.eligible === false && by[2].auto.reasons[0] === 'Cannot send — no e-mail on the Hub customer.', by[2]);
check('two addresses on the Hub customer → both; the language chosen on the Hub customer (Spanish) is used, not the feed’s', by[7].recipients.join('|') === 'x@eta.example|y@eta.example' && by[7].email === 'x@eta.example, y@eta.example' && by[7].language === 'es' && by[7].language_chosen === true && by[7].fields.name === 'Luis Vega');
check('a Hub e-mail field with no address in it → none, and the words are reported', by[9].recipients.length === 0 && by[9].recipients_bad.length > 0 && /not an address/.test(by[9].auto.reasons.join(' ')));
var el = built.rows.filter(function (r) { return r.auto && r.auto.eligible; }).map(function (r) { return r.order_id; }).sort().join(',');
check('goes by itself: only orders 1, 5 and 7 (nothing about them needs a person)', el === '1,5,7', el);
check('needs a person, with the reason: no Hub e-mail · a warning to check · port of loading · the daily reminder stopped after 30 days · paid in full · not an address', /no e-mail on the Hub customer/.test(by[2].auto.reasons.join(' ')) && /A person must check first/.test(by[3].auto.reasons.join(' ')) && /port of loading must be confirmed/.test(by[4].auto.reasons.join(' '))
  && /More than 30 days past/.test(by[6].auto.reasons.join(' ')) && /paid in full/.test(by[8].auto.reasons.join(' ')) && /not an address/.test(by[9].auto.reasons.join(' ')), built.rows.map(function (r) { return r.order_id + ':' + r.auto.reasons.join('|'); }));
var a1 = L.autoCheck(Object.assign({}, by[1], { slot_sent: true })); var a2 = L.autoCheck(Object.assign({}, by[1], { slot_unconfirmed: true })); var a3 = L.autoCheck(Object.assign({}, by[1], { slot_failed_auto: 2 })); var a4 = L.autoCheck(Object.assign({}, by[1], { slot_failed_auto: 1 }));
check('never by itself: a stage already sent · an unconfirmed earlier send · two refusals by the mail server (one refusal is tried again)', !a1.eligible && !a2.eligible && !a3.eligible && a4.eligible, [a1, a2, a3, a4]);
var builtW = S.buildReminderRows({ feed: feedLive, invoices: invoices, payments: payments, customers: customers, log: [], today: TODAY, floor: '2026-11-15' });
check('a person limited by the history window is not told what the schedule would do with a limited order', builtW.rows.every(function (r) { return r.limited ? r.auto === null : true; }) && builtW.rows.some(function (r) { return r.limited; }));

// ── 3. the REAL route ──
var sentMail = []; var smtp = {}; // smtp[first recipient] = 'refused' | 'timeout'
var fakeNodemailer = { createTransport: function () { return { sendMail: function (m) { var first = String(m.to).split(',')[0].trim(); if (smtp[first] === 'timeout') { var e = new Error('Connection timeout'); e.code = 'ETIMEDOUT'; return Promise.reject(e); } if (smtp[first] === 'refused') { return Promise.resolve({ accepted: [], rejected: [first], response: '550 no such user' }); } sentMail.push(m); return Promise.resolve({ accepted: String(m.to).split(',').map(function (x) { return x.trim(); }), rejected: [], response: '250 OK' }); } }; } };
function FakeComposer(m) { this.m = m; } FakeComposer.prototype.compile = function () { var m = this.m; return { build: function (cb) { cb(null, Buffer.from('raw:' + m.subject)); } }; };
function FakeImap() { } FakeImap.prototype.connect = function () { return Promise.resolve(); }; FakeImap.prototype.list = function () { return Promise.resolve([{ path: 'INBOX.Sent', specialUse: '\\Sent' }]); }; FakeImap.prototype.append = function () { return Promise.resolve(); }; FakeImap.prototype.logout = function () { return Promise.resolve(); };
var origLoad = Module._load;
Module._load = function (req) { if (req === 'nodemailer') { return fakeNodemailer; } if (req === 'nodemailer/lib/mail-composer') { return FakeComposer; } if (req === 'imapflow') { return { ImapFlow: FakeImap }; } return origLoad.apply(this, arguments); };
var orig = Module._resolveFilename; var mockPath = path.join(__dirname, 'helpers', 'mock-supabase-js.js');
Module._resolveFilename = function (req) { if (req === '@supabase/supabase-js') { return mockPath; } if (/lib[\/]verified-caller(.js)?$/.test(req)) { return path.join(__dirname, 'helpers', 'stub-verified-caller.js'); } return orig.apply(this, arguments); };
fs.writeFileSync(mockPath, 'module.exports={createClient:function(){return global.__db;}};');
function perms(u, list) { return list.map(function (k) { return { user_id: u, module_name: k, has_access: true }; }); }
var ALLP = ['accounting.clickbooks.access', 'accounting.view_invoicing', 'ar.view_invoice_balances', 'ar.send_reminders'];
var db = new MemDB({ users: [{ id: 'u-super', name: 'Max', email: 'max@ktc.example', role: 'super_admin', active: true }, { id: 'u-admin', name: 'Admin', email: 'admin@ktc.example', role: 'admin', active: true }, { id: 'u-staff', name: 'Staff', email: 'staff@ktc.example', role: 'staff', active: true }],
  module_permissions: [].concat(perms('u-admin', ALLP), perms('u-staff', ALLP)), accounting_invoices: invoices, accounting_invoice_payments: payments, accounting_customers: customers, arrival_reminders: [], hub_audit_log: [], app_settings: [],
  accounting_invoice_items: [{ id: 'it1', invoice_id: 'i1', description: 'Second quality denim, mixed rolls', quantity: 8000, unit_price: 1.25, line_total: 10000, sort_order: 1, sku: 'INTERNAL-SKU-77', product_ref: 'INTERNAL-REF' },
    { id: 'it5', invoice_id: 'i5', description: '\u0642\u0645\u0627\u0634 denim', quantity: 1, unit_price: 5000, line_total: 5000, sort_order: 1 }, { id: 'it7', invoice_id: 'i7', description: 'Tela de algodón', quantity: 7, unit_price: 1000, line_total: 7000, sort_order: 1 }],
  company_profile: [{ id: 'co', company_name: 'KTC International Enterprises LLC', address: '1 Example Road\nHouston TX', phone: '+1 000 000 0000', email: 'info@ktcus.com', tax_id: '00-0000000', default_payment_terms: 'Wire transfer only.' }],
  pl_invoice_terms: [{ invoice_id: 'i1', shipping_terms: 'CNF', shipping_cost_estimate: 4321.99 }] });
// the database's own rule (sql/v55-83-XG: uq_arrival_reminders_auto_slot): one automatic row per source + order + channel + slot while sending / sent / unknown
db.hooks = { arrival_reminders: { insert: function (r) { if (r.mode !== 'auto') { return null; } var clash = db.t.arrival_reminders.some(function (x) { return x.mode === 'auto' && x.source === r.source && x.order_id === r.order_id && x.channel === r.channel && x.slot === r.slot && ['sending', 'sent', 'unknown'].indexOf(x.status) >= 0; }); return clash ? 'duplicate key value violates unique constraint "uq_arrival_reminders_auto_slot"' : null; } } };
global.__db = db;
var feedCalls = 0; var feedNow = feedLive;
global.fetch = function () { feedCalls++; return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(feedNow))); } }); };
var route = require(path.join(root, 'src/app/api/accounting/arrival-reminders/route.js'));
async function call(user, body) { var res = await route.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
async function timer(secret) { var h = new Map(); if (secret) { h.set('authorization', 'Bearer ' + secret); } var res = await route.GET({ headers: h }); var j = await res.json(); j._status = res.status; return j; }
function log() { return db.t.arrival_reminders; }
function setting(k) { var r = db.t.app_settings.filter(function (x) { return x.key === k; })[0]; return r ? r.value : null; }

// reads a PDF back with the PDF reader that is already one of the Hub's packages (pdfjs-dist) — its start-up notices are not test output
async function readPdf(buf) {
  var cw = console.warn; var cl = console.log; console.warn = function () { }; console.log = function () { };
  try {
    var pdfjs = require(path.join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.js'));
    var doc = await pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0, disableFontFace: true, useSystemFonts: false }).promise; var out = [];
    for (var p = 1; p <= doc.numPages; p++) { var pg = await doc.getPage(p); var tc = await pg.getTextContent(); out.push(tc.items.map(function (x) { return x.str; }).join(' ')); }
    return out.join('\n');
  } finally { console.warn = cw; console.log = cl; }
}
(async function () {
  // the door
  var t0 = await timer(null); var t1 = await timer('wrong-secret-0123456789'); var keep = process.env.CRON_SECRET; process.env.CRON_SECRET = 'short'; var t2 = await timer('short'); process.env.CRON_SECRET = keep;
  check('the timer’s door: no secret, a wrong secret, or a secret shorter than 16 characters → 401, nothing read, nothing sent', t0._status === 401 && t1._status === 401 && t2._status === 401 && feedCalls === 0 && sentMail.length === 0);

  // OFF by default
  var off = await timer(SECRET);
  check('the switch has never been set → OFF: the run does nothing at all (feed not even read, nothing recorded, nothing sent)', off.ok === true && off.off === true && off.sent === 0 && feedCalls === 0 && sentMail.length === 0 && log().length === 0 && setting(S.AUTO_LAST_RUN_KEY) === null, off);
  var li0 = await call('u-staff', { action: 'list' });
  check('the screen shows it OFF, how many would go (3), the time of day, and that staff cannot switch it', li0.ok && li0.auto.on === false && li0.auto.would_send === 3 && li0.auto.can_switch === false && li0.auto.live_feed === true && /12:00 UTC/.test(li0.auto.schedule) && li0.auto.max_overdue_days === 30, li0.auto);

  // who may switch it
  var s1 = await call('u-staff', { action: 'auto_set', enabled: true, confirm: true }); var s2 = await call('u-admin', { action: 'auto_set', enabled: true, confirm: true });
  var s3 = await call('u-super', { action: 'auto_set', enabled: true }); var s4 = await call('u-super', { action: 'auto_set', enabled: 'yes', confirm: true }); var s5 = await call('u-super', { action: 'auto_set', _no_token: true, enabled: true, confirm: true });
  check('staff and an ordinary admin cannot switch it on (403); the super admin without the confirmation, or with a value that is not on / off, or without a sign-in, cannot either — it stays OFF', s1._status === 403 && s2._status === 403 && s3.ok === false && s4.ok === false && s5._status === 401 && setting(S.AUTO_SWITCH_KEY) === null && (await timer(SECRET)).off === true && sentMail.length === 0, [s1, s2, s3, s4, s5]);
  var on = await call('u-super', { action: 'auto_set', enabled: true, confirm: true });
  var liOn = await call('u-super', { action: 'list' });
  check('the super admin switches it ON with the confirmation: saved with who and when, in the audit trail, shown on the screen', on.ok && on.auto.on === true && setting(S.AUTO_SWITCH_KEY).enabled === true && setting(S.AUTO_SWITCH_KEY).by === 'u-super' && db.t.hub_audit_log.some(function (a) { return a.action === 'arrival_reminders_auto_on' && a.actor_id === 'u-super'; }) && liOn.auto.on === true && liOn.auto.by_name === 'Max' && liOn.auto.can_switch === true, [on, liOn.auto]);
  check('switching it on sends nothing by itself', sentMail.length === 0 && log().length === 0);

  // the morning run — with yesterday's "past the date" reminder already in the log for order 5
  db.t.arrival_reminders.push({ id: 'y5', source: 'nextrade-live', order_id: 5, channel: 'email', mode: 'auto', phase: 'overdue', slot: 'overdue-' + plus(-1), language: 'en', sent_to: 'e@eps.example', status: 'sent', created_at: plus(-1) + 'T12:00:00Z', sent_at: plus(-1) + 'T12:00:01Z' });
  var run1 = await timer(SECRET);
  var m = {}; sentMail.forEach(function (x) { m[x.to] = x; });
  check('morning run: exactly the 3 reminders that need nobody go out — to the HUB customer addresses', run1.ok && run1.run.sent.length === 3 && sentMail.length === 3 && !!m['buyer@alpha.example'] && !!m['e@eps.example'] && !!m['x@eta.example, y@eta.example'], [run1.run, Object.keys(m)]);
  check('…never to a warehouse-feed address, and nothing to the orders that need a person', sentMail.every(function (x) { return (x.to + ' ' + (x.cc || '')).indexOf('@warehouse.example') < 0; }) && !m['g@gamma.example'] && !m['d@delta.example'] && !m['z@zeta.example'] && !m['t@theta.example']);
  var mA = m['buyer@alpha.example']; var mE = m['x@eta.example, y@eta.example']; var mO = m['e@eps.example'];
  check('…the approved text for the stage, with the figures of the moment (10,000 − 4,000), from "KTC International" <info@ktcus.com>', mA.subject === '1002-0001 · KTC · Houston → Peru · Container CONT1' && mA.text.indexOf('Good news — your shipment is on the way.') > 0 && mA.text.indexOf('Balance remaining: $6,000.00') > 0 && mA.from === '"KTC International" <info@ktcus.com>' && mA.text.indexOf('Dear Contact 1,') === 0, mA);
  check('…in the language chosen on the Hub customer (Spanish, urgent, Canada for a 1001 release), one e-mail to both addresses', mE.text.indexOf('Estimado/a Luis Vega:') === 0 && mE.text.indexOf('Su envío llega muy pronto.') > 0 && mE.subject.indexOf('1001-0007 · KTC · Canada → Peru') === 0);
  check('…past the arrival date: today’s reminder goes although yesterday’s is in the log (one every day)', mO.text.indexOf('has arrived (expected') > 0 && mO.text.indexOf('now overdue') > 0);
  var autoRows = log().filter(function (r) { return r.mode === 'auto' && r.id !== 'y5'; });
  check('…each one logged before it left: automatic, sent, to whom, stage, slot, language, the text and the balance; no person named', autoRows.length === 3 && autoRows.every(function (r) { return r.status === 'sent' && r.sent_by === null && r.sent_by_name === 'Automatic schedule' && !!r.body && !!r.sent_at && r.source === 'nextrade-live' && r.channel === 'email'; }) && autoRows.filter(function (r) { return r.order_id === 7; })[0].language === 'es' && autoRows.filter(function (r) { return r.order_id === 1; })[0].remaining === 6000 && autoRows.filter(function (r) { return r.order_id === 5; })[0].slot === 'overdue-' + TODAY, autoRows.map(function (r) { return r.order_id + ':' + r.status + ':' + r.slot; }));
  check('…the audit trail marks them automatic', db.t.hub_audit_log.filter(function (a) { return a.action === 'arrival_reminder_sent' && a.details.automatic === true && a.actor_id === null; }).length === 3);
  check('…every automatic reminder is copied to Jasmine@ktcus.com and hsaad@ktcus.com (Max: "cced to Jasmine@ktcus.com hsaad@ktcus.com"), and the log row says so', sentMail.every(function (x) { return x.cc === 'Jasmine@ktcus.com, hsaad@ktcus.com'; }) && autoRows.every(function (r) { return r.cc === 'Jasmine@ktcus.com, hsaad@ktcus.com'; }));
  check('…the customer invoice is attached as a PDF where it can be made (orders 1 and 7), named after the invoice', mA.attachments.length === 1 && mA.attachments[0].filename === 'Invoice-INV-1.pdf' && mA.attachments[0].contentType === 'application/pdf' && String(mA.attachments[0].content.slice(0, 5)) === '%PDF-' && mE.attachments.length === 1 && mE.attachments[0].filename === 'Invoice-INV-7.pdf' && autoRows.filter(function (r) { return r.order_id === 1; })[0].invoices_attached === 1 && autoRows.filter(function (r) { return r.order_id === 1; })[0].attachment_note === null);
  var row5 = autoRows.filter(function (r) { return r.order_id === 5; })[0];
  check('…an invoice the PDF cannot show (an Arabic line): "SEND IT ANYWAY" — the reminder still goes, with no attachment, and the log row + the run record say it went without the invoice and why', !mO.attachments && row5.status === 'sent' && row5.invoices_attached === 0 && /^Sent WITHOUT the invoice attached — INV-5: the invoice has a letter the PDF cannot show/.test(row5.attachment_note) && run1.run.sent.filter(function (x) { return x.order_id === 5; })[0].attachment_note === row5.attachment_note, [row5.attachment_note, run1.run.sent]);
  var pdfText = await readPdf(mA.attachments[0].content);
  check('…the PDF really is the invoice: company, number, bill-to, the line, total 10,000, paid 4,000, balance 6,000 (read back from the file)', /KTC International Enterprises LLC/.test(pdfText) && /INVOICE/.test(pdfText) && /No\. INV-1/.test(pdfText) && /Alpha Trading/.test(pdfText) && /Second quality denim, mixed rolls/.test(pdfText) && /8,000/.test(pdfText) && /\$1\.25/.test(pdfText) && /Total\W+\$10,000\.00/.test(pdfText) && /Amount paid\W+\$4,000\.00/.test(pdfText) && /Balance due\W+\$6,000\.00/.test(pdfText) && /Wire transfer only\./.test(pdfText), pdfText.substring(0, 600));
  check('…and nothing internal is in it: no SKU / product reference, no shipping terms or shipping cost, no customs invoice', !/INTERNAL-SKU-77|INTERNAL-REF|4,321\.99|4321|CNF|customs/i.test(pdfText));
  var lr = setting(S.AUTO_LAST_RUN_KEY);
  check('…the run is recorded for the screen: 3 sent, 5 waiting for a person (the paid order waits for nobody), nothing failed', lr && lr.sent.length === 3 && lr.failed.length === 0 && lr.unconfirmed.length === 0 && lr.needs_person === 5 && lr.today === TODAY && lr.note === null, lr);

  // never twice
  var run2 = await timer(SECRET); var run3 = await timer(SECRET);
  check('the second pass an hour later, and any later run the same day: nothing is sent again', run2.run.sent.length === 0 && run3.run.sent.length === 0 && sentMail.length === 3 && log().filter(function (r) { return r.mode === 'auto'; }).length === 4);
  var liAfter = await call('u-super', { action: 'list' }); var ra = {}; liAfter.rows.forEach(function (r) { ra[r.order_id] = r; });
  check('the screen afterwards: those stages show as sent, nothing more would go, and the last run is shown', ra[1].slot_sent === true && ra[1].reminders.sent === 1 && ra[1].reminders.last.mode === 'auto' && liAfter.auto.would_send === 0 && liAfter.auto.last_run.sent.length === 0);
  var liStaff = await call('u-staff', { action: 'list' });
  check('a person CAN still send by hand after the schedule — but must tick "send another one" (the stage counts as sent)', liStaff.rows.filter(function (r) { return r.order_id === 1; })[0].slot_sent === true);

  // two timers at the very same moment
  db.t.arrival_reminders = db.t.arrival_reminders.filter(function (r) { return r.id === 'y5'; }); sentMail.length = 0;
  var both = await Promise.all([timer(SECRET), timer(SECRET)]);
  var perOrder = {}; sentMail.forEach(function (x) { perOrder[x.to] = (perOrder[x.to] || 0) + 1; });
  check('two runs at the very same moment: every reminder still goes out ONCE (the database refuses the second claim of a stage)', sentMail.length === 3 && Object.keys(perOrder).every(function (k) { return perOrder[k] === 1; }) && both[0].run.sent.length + both[1].run.sent.length === 3 && both[0].run.skipped.length + both[1].run.skipped.length === 3 && log().filter(function (r) { return r.mode === 'auto' && r.id !== 'y5'; }).length === 3, [both[0].run, both[1].run, perOrder]);

  // a person already sent that stage by hand → the schedule leaves it alone
  db.t.arrival_reminders = [{ id: 'm1', source: 'nextrade-live', order_id: 1, channel: 'email', mode: 'manual', phase: 'friendly', slot: 'friendly-1', language: 'en', sent_to: 'buyer@alpha.example', status: 'sent', created_at: TODAY + 'T09:00:00Z', sent_at: TODAY + 'T09:00:01Z' },
    { id: 'm7', source: 'nextrade-live', order_id: 7, channel: 'email', mode: 'manual', phase: 'urgent', slot: 'urgent-1', language: 'es', sent_to: 'x@eta.example', status: 'unknown', created_at: TODAY + 'T09:00:00Z' }]; sentMail.length = 0;
  var run4 = await timer(SECRET);
  check('a stage a person already sent by hand, or whose hand-sent delivery is unconfirmed, is NOT sent by the schedule', sentMail.length === 1 && sentMail[0].to === 'e@eps.example' && run4.run.sent.length === 1, [run4.run, sentMail.map(function (x) { return x.to; })]);

  // the mail server refuses, then never answers
  db.t.arrival_reminders = []; sentMail.length = 0; smtp['buyer@alpha.example'] = 'refused'; smtp['e@eps.example'] = 'timeout';
  var f1 = await timer(SECRET);
  var rowA = log().filter(function (r) { return r.order_id === 1; }); var rowE = log().filter(function (r) { return r.order_id === 5; });
  check('a definite refusal → "failed" with the reason; no answer → "unknown" (delivery unconfirmed); the third one still goes out; all three are in the run record', f1.run.sent.length === 1 && f1.run.failed.length === 1 && f1.run.unconfirmed.length === 1 && rowA.length === 1 && rowA[0].status === 'failed' && /did not accept/.test(rowA[0].error) && rowE.length === 1 && rowE[0].status === 'unknown' && /DELIVERY UNCONFIRMED/.test(rowE[0].error) && sentMail.length === 1 && setting(S.AUTO_LAST_RUN_KEY).failed[0].release === '1002-0001', f1.run);
  var f2 = await timer(SECRET);
  check('next run: the refused one is tried once more (still refused); the unconfirmed one is NOT tried again — it waits for a person', log().filter(function (r) { return r.order_id === 1; }).length === 2 && log().filter(function (r) { return r.order_id === 5; }).length === 1 && f2.run.failed.length === 1 && f2.run.unconfirmed.length === 0 && sentMail.length === 1, f2.run);
  smtp = {}; var f3 = await timer(SECRET);
  check('after two refusals the schedule stops trying that stage (a person must look) — even once the mail server works again; nothing else is re-sent', log().filter(function (r) { return r.order_id === 1; }).length === 2 && f3.run.sent.length === 0 && sentMail.length === 1, f3.run);
  var liF = await call('u-super', { action: 'list' }); var rf = {}; liF.rows.forEach(function (r) { rf[r.order_id] = r; });
  check('the screen says why each waits: refused twice · delivery unconfirmed', /refused this reminder 2 times/.test(rf[1].auto.reasons.join(' ')) && /unconfirmed/.test(rf[5].auto.reasons.join(' ')) && rf[5].slot_unconfirmed === true && rf[5].reminders.unconfirmed.count === 1);

  // guards that stop the whole run
  db.t.arrival_reminders = []; sentMail.length = 0;
  process.env.NEXTRADE_FEED_URL = 'https://fix.nextrade-staging.com/api/hub-feed/shipping'; feedNow = Object.assign({}, feedLive, { source: 'nextrade-staging' });
  var st = await timer(SECRET);
  check('the Hub reading the STAGING copy of the warehouse: the schedule sends nothing, even switched ON, and says so', st.run.sent.length === 0 && sentMail.length === 0 && log().length === 0 && /not the live one/.test(st.run.note) && /^At this run the Hub was reading the nextrade-staging copy/.test(st.run.note) && st.run.reason === 'not_live' && st.run.source === 'nextrade-staging' && setting(S.AUTO_LAST_RUN_KEY).reason === 'not_live', st.run);
  // v55.83-ZG — the day the Hub is switched to the LIVE warehouse, the last run on record is still the staging one
  var stagingRun = JSON.parse(JSON.stringify(setting(S.AUTO_LAST_RUN_KEY)));
  process.env.NEXTRADE_FEED_URL = 'https://nextradeindustries.com/api/hub-feed/shipping'; feedNow = feedLive;
  var pw = process.env.COMMERCIAL_MAIL_PASSWORD; delete process.env.COMMERCIAL_MAIL_PASSWORD; var nm = await timer(SECRET); process.env.COMMERCIAL_MAIL_PASSWORD = pw;
  check('mailbox not connected → nothing sent, nothing logged as sent, the reason recorded', nm._status === 503 && sentMail.length === 0 && log().length === 0 && /mailbox is not connected/.test(nm.run.note));
  var realFrom = db.from.bind(db);
  db.from = function (name) { if (name === 'arrival_reminders') { var q = realFrom(name); q.run = function () { return { data: null, error: { message: 'relation "public.arrival_reminders" does not exist' } }; }; return q; } return realFrom(name); };
  var nl = await timer(SECRET); db.from = realFrom;
  check('no log table → nothing sent', nl._status === 503 && sentMail.length === 0);
  db.from = function (name) { if (name === 'app_settings') { var q2 = realFrom(name); q2.run = function () { return { data: null, error: { message: 'permission denied for table app_settings' } }; }; return q2; } return realFrom(name); };
  var ns = await timer(SECRET); var liU = await call('u-super', { action: 'list' }); db.from = realFrom;
  check('the switch cannot be read → it is NOT taken as on: nothing sent; the screen says it counts as OFF', ns._status === 503 && sentMail.length === 0 && log().length === 0 && liU.auto.on === false && liU.auto.unreadable === true, [ns, liU.auto]);
  db.t.app_settings.filter(function (x) { return x.key === S.AUTO_SWITCH_KEY; })[0].value = { enabled: 'true' };
  var odd = await timer(SECRET);
  check('a switch value that is not exactly "on" (a text "true") is OFF', odd.off === true && sentMail.length === 0);
  db.t.app_settings.filter(function (x) { return x.key === S.AUTO_SWITCH_KEY; })[0].value = { enabled: true };

  // switching OFF
  var offA = await call('u-admin', { action: 'auto_set', enabled: false }); var offS = await call('u-super', { action: 'auto_set', enabled: false });
  var afterOff = await timer(SECRET);
  check('only the super admin switches it OFF too (no confirmation needed to stop); after that the run does nothing', offA._status === 403 && offS.ok && offS.auto.on === false && afterOff.off === true && sentMail.length === 0 && db.t.hub_audit_log.some(function (a) { return a.action === 'arrival_reminders_auto_off'; }));

  // by hand, with the warehouse address(es)
  var pv7 = await call('u-staff', { action: 'preview', order_id: 7 });
  check('by hand: the box is pre-filled with the Hub customer’s addresses, the language chosen there is pre-selected, the copy list and the invoice PDF are shown', pv7.ok && pv7.to === 'x@eta.example, y@eta.example' && pv7.lang === 'es' && pv7.cc.join('|') === 'Jasmine@ktcus.com|hsaad@ktcus.com' && pv7.attachments.join('|') === 'Invoice-INV-7.pdf' && pv7.attachment_note === null, pv7);
  var b7 = { action: 'send', order_id: 7, draft_hash: pv7.draft_hash, confirm: true };
  var h1 = await call('u-staff', Object.assign({}, b7, { to: 'x@eta.example, not an address', confirm_to: 'x@eta.example, not an address' }));
  var h2 = await call('u-staff', Object.assign({}, b7, { to: 'x@eta.example; y@eta.example', confirm_to: 'x@eta.example' }));
  var h3 = await call('u-staff', Object.assign({}, b7, { to: 'x@eta.example; y@eta.example', confirm_to: 'X@eta.example , y@eta.example' }));
  check('by hand: a Send-to with something that is not an address is refused; the confirmation must name the same addresses; then ONE e-mail goes to both', h1.ok === false && h2.ok === false && h3.ok && sentMail.length === 1 && sentMail[0].to === 'x@eta.example, y@eta.example' && log()[log().length - 1].sent_to === 'x@eta.example, y@eta.example' && log()[log().length - 1].mode === 'manual', [h1, h2, h3]);
  var pv2 = await call('u-staff', { action: 'preview', order_id: 2 });
  check('by hand, no e-mail on the Hub customer: the box is empty and a person types one', pv2.ok && !pv2.to && pv2.can_send === true);
  var n2 = await call('u-staff', { action: 'send', order_id: 2, draft_hash: pv2.draft_hash, confirm: true, to: '', confirm_to: '' });
  check('…and nothing is sent without an address', n2.ok === false && sentMail.length === 1);
  var tst = await call('u-staff', { action: 'send', order_id: 2, draft_hash: pv2.draft_hash, confirm: true, test: true, to: 'buyer@alpha.example' });
  check('"Send a test to myself" still goes only to the signed-in person', tst.ok && tst.to === 'staff@ktc.example' && sentMail[1].to === 'staff@ktc.example' && /^\[TEST/.test(sentMail[1].subject));

  var React0 = require('react'); global.React = React0; var RS0 = require('react-dom/server'); var UI0 = require(path.join(root, 'src/components/ArrivalRemindersTab.jsx'));
  // ── CC, sender, attachment and language through the REAL routes ──
  var mH = sentMail[0]; var lH = log()[log().length - 2];
  check('by hand: the customer reminder is copied to the office too, the invoice PDF is attached, and the log row records both', mH.cc === 'Jasmine@ktcus.com, hsaad@ktcus.com' && mH.attachments.length === 1 && mH.attachments[0].filename === 'Invoice-INV-7.pdf' && lH.cc === 'Jasmine@ktcus.com, hsaad@ktcus.com' && lH.invoices_attached === 1 && h3.cc.length === 2 && h3.attachments[0] === 'Invoice-INV-7.pdf', [mH.cc, lH]);
  var mT = sentMail[1]; var lT = log()[log().length - 1];
  check('"Send a test to myself" is NOT copied to anyone (Max accepted: a test goes only to the person testing); it does carry the invoice PDF so the tester sees the real thing', !mT.cc && lT.cc === null && lT.mode === 'test' && mT.attachments.length === 1 && tst.cc.length === 0, [mT.cc, lT.cc]);
  var cc1 = await call('u-staff', { action: 'cc_set', cc: 'a@x.example' }); var cc2 = await call('u-admin', { action: 'cc_set', cc: 'a@x.example' }); var cc3 = await call('u-super', { action: 'cc_set', cc: 'a@x.example, not an address' });
  check('the copy list is a setting: only the super admin changes it (staff / admin 403), and a value that is not an address is refused — it stays Jasmine + hsaad', cc1._status === 403 && cc2._status === 403 && cc3.ok === false && (await call('u-staff', { action: 'list' })).cc.join('|') === 'Jasmine@ktcus.com|hsaad@ktcus.com', [cc1, cc2, cc3]);
  var cc4 = await call('u-super', { action: 'cc_set', cc: 'Jasmine@ktcus.com; hsaad@ktcus.com; office@ktc.example' });
  var pvC = await call('u-staff', { action: 'preview', order_id: 1 });
  var sC = await call('u-staff', { action: 'send', order_id: 1, draft_hash: pvC.draft_hash, confirm: true, to: 'buyer@alpha.example; hsaad@ktcus.com', confirm_to: 'buyer@alpha.example, hsaad@ktcus.com' });
  var mC = sentMail[sentMail.length - 1];
  check('the super admin adds an address: the next reminder is copied to all three; an address that is already in Send-to is not repeated in CC; the change is in the audit trail', cc4.ok && cc4.cc.length === 3 && pvC.cc.length === 3 && sC.ok && mC.to === 'buyer@alpha.example, hsaad@ktcus.com' && mC.cc === 'Jasmine@ktcus.com, office@ktc.example' && db.t.hub_audit_log.some(function (a) { return a.action === 'arrival_reminders_cc_set' && a.actor_id === 'u-super'; }), [cc4, mC.to, mC.cc]);
  db.t.app_settings.filter(function (x) { return x.key === S.CC_KEY; })[0].value = { list: 'not a list' };
  check('a damaged copy-list setting falls back to Jasmine + hsaad (the office copy is never silently lost)', (await call('u-staff', { action: 'list' })).cc.join('|') === 'Jasmine@ktcus.com|hsaad@ktcus.com');
  db.t.app_settings = db.t.app_settings.filter(function (x) { return x.key !== S.CC_KEY; });

  // sent from info@ktcus.com only
  var nBefore = sentMail.length; var nLog = log().length; process.env.COMMERCIAL_MAIL_USER = 'sales@ktcus.com';
  var wfL = await call('u-staff', { action: 'list' }); var wfP = await call('u-staff', { action: 'preview', order_id: 3 });
  var wfS = await call('u-staff', { action: 'send', order_id: 3, draft_hash: wfP.draft_hash, confirm: true, ack_warnings: true, to: 'g@gamma.example', confirm_to: 'g@gamma.example' });
  var wfT = await call('u-staff', { action: 'send', order_id: 3, draft_hash: wfP.draft_hash, confirm: true, ack_warnings: true, test: true });
  await call('u-super', { action: 'auto_set', enabled: true, confirm: true }); var wfG = await timer(SECRET); await call('u-super', { action: 'auto_set', enabled: false });
  var direct = await S.sendReminderMail({ to: 'x@y.example', subject: 's', text: 't', html: 'h', id: 'zz' }, {});
  process.env.COMMERCIAL_MAIL_USER = 'info@ktcus.com';
  check('Max: "SHOULS BE SENT FROM info@ktcus.com" — with the mailbox set to another address NOTHING is sent: by hand, as a test, by the morning run, or by the mail helper itself; the screen names the wrong address', wfL.mailbox.configured === false && wfL.mailbox.wrong_from === true && wfL.mailbox.from === 'sales@ktcus.com' && wfP.can_send === false && wfS._status === 503 && wfS.wrong_from === true && /sales@ktcus\.com, not info@ktcus\.com/.test(wfS.error) && wfT._status === 503 && wfG._status === 503 && /not info@ktcus\.com/.test(wfG.run.note) && direct.ok === false && direct.wrong_from === true && sentMail.length === nBefore && log().length === nLog, [wfL.mailbox, wfS, wfG.run && wfG.run.note, direct]);

  // the invoice cannot be read at all → still sent
  var realFromA = db.from.bind(db); db.from = function (name) { if (name === 'accounting_invoice_items') { var qa = realFromA(name); qa.run = function () { return { data: null, error: { message: 'connection reset' } }; }; return qa; } return realFromA(name); };
  var pvN = await call('u-staff', { action: 'preview', order_id: 3 });
  var sN = await call('u-staff', { action: 'send', order_id: 3, draft_hash: pvN.draft_hash, confirm: true, ack_warnings: true, to: 'g@gamma.example', confirm_to: 'g@gamma.example' }); db.from = realFromA;
  var mN = sentMail[sentMail.length - 1]; var lN = log()[log().length - 1];
  check('by hand, the invoice cannot even be read: the box says it will go WITHOUT the invoice, and it is SENT ANYWAY — no attachment, the reason on the log row and in the answer', pvN.attachments.length === 0 && /^Sent WITHOUT the invoice attached — the invoice could not be read \(connection reset\)/.test(pvN.attachment_note) && sN.ok && sN.attachments.length === 0 && mN.to === 'g@gamma.example' && !mN.attachments && lN.status === 'sent' && lN.invoices_attached === 0 && lN.attachment_note === sN.attachment_note, [pvN.attachment_note, sN]);
  var liN = await call('u-staff', { action: 'list' }); var r3 = liN.rows.filter(function (r) { return r.order_id === 3; })[0];
  check('…and the reminders list shows it on that order, so someone can send the invoice afterwards', /^Sent WITHOUT the invoice attached/.test(r3.reminders.last.attachment_note) && r3.reminders.last.invoices_attached === 0 && r3.reminders.last.cc === 'Jasmine@ktcus.com, hsaad@ktcus.com', r3.reminders.last);

  // the log's three new columns are not installed yet (the build is live before the SQL)
  db.hooks.arrival_reminders.insert0 = db.hooks.arrival_reminders.insert;
  db.hooks.arrival_reminders.insert = function (r) { if ('cc' in r || 'invoices_attached' in r || 'attachment_note' in r) { return 'Could not find the \'cc\' column of \'arrival_reminders\' in the schema cache'; } return db.hooks.arrival_reminders.insert0(r); };
  var pvO = await call('u-staff', { action: 'preview', order_id: 4, pol: 'Savannah' });
  var sO = await call('u-staff', { action: 'send', order_id: 4, pol: 'Savannah', draft_hash: pvO.draft_hash, confirm: true, to: 'd@delta.example', confirm_to: 'd@delta.example' });
  db.hooks.arrival_reminders.insert = db.hooks.arrival_reminders.insert0; var lO = log()[log().length - 1];
  check('before the XY SQL is installed (no cc / invoices_attached / attachment_note columns): the reminder is still logged and sent, with CC and the PDF — only the three facts are not stored', sO.ok && lO.status === 'sent' && lO.order_id === 4 && !('cc' in lO) && sentMail[sentMail.length - 1].cc === 'Jasmine@ktcus.com, hsaad@ktcus.com' && sentMail[sentMail.length - 1].attachments.length === 1, [sO, lO.cc]);

  // the warehouse feed answers, but not with what the Hub expects (live on 23 Nov: "The warehouse feed answered 200")
  await call('u-super', { action: 'auto_set', enabled: true, confirm: true }); var nF = sentMail.length; var nFL = log().length;
  var realFetch = global.fetch; global.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.reject(new Error('Unexpected end of JSON input')); } }); };
  var badFeed = await timer(SECRET); var badList = await call('u-staff', { action: 'list' });
  global.fetch = function () { return Promise.reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })); }; var slowFeed = await timer(SECRET);
  global.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, source: 'nextrade-live', orders: [], requirements: [], status_history: [] }); } }); }; var emptyFeed = await timer(SECRET);
  global.fetch = realFetch; await call('u-super', { action: 'auto_set', enabled: false });
  check('an unreadable warehouse feed (answers 200 but not the expected data, or is cut off) = the morning run sends NOTHING and records why — it is never taken as "no orders"; the screen shows the error too', badFeed.ok === false && badFeed.run.sent.length === 0 && /warehouse (feed )?answered 200/.test(badFeed.run.note) && slowFeed.ok === false && slowFeed.run.sent.length === 0 && /aborted/.test(slowFeed.run.note) && badList.ok === false && /warehouse (feed )?answered 200/.test(badList.error) && sentMail.length === nF && log().length === nFL && /warehouse feed answered 200|aborted/.test(setting(S.AUTO_LAST_RUN_KEY).note || 'x') === false, [badFeed.run, slowFeed.run, badList.error, setting(S.AUTO_LAST_RUN_KEY)]);
  check('…a feed that is read correctly and simply has no orders is a normal quiet run (nothing sent, no error)', emptyFeed.ok === true && emptyFeed.run.sent.length === 0 && emptyFeed.run.note === null && sentMail.length === nF);

  // the language choice on the Hub customer (the Customers screen's radio)
  db.t.module_permissions = db.t.module_permissions.concat(perms('u-admin', ['accounting.customers.edit']));
  var langRoute = require(path.join(root, 'src/app/api/accounting/customer-language/route.js'));
  async function lang(user, body) { var res = await langRoute.POST({ json: function () { return Promise.resolve(Object.assign({ user_id: user }, body)); }, headers: new Map() }); var j = await res.json(); j._status = res.status; return j; }
  var g1 = await lang('u-staff', { customer_id: 'c1', language: 'fr' }); var g2 = await lang('u-admin', { customer_id: 'c1', language: 'de' }); var g3 = await lang('u-admin', { customer_id: 'nope', language: 'fr' }); var g4 = await lang('u-admin', { customer_id: 'c1', language: 'fr', _no_token: true }); var g5 = await lang('u-admin', { language: 'fr' });
  check('language: without the customer-edit permission → 403; a language outside the four, an unknown customer, no sign-in, no customer → refused; nothing changed', g1._status === 403 && g2.ok === false && g3._status === 404 && g4._status === 401 && g5.ok === false && !db.t.accounting_customers.filter(function (c) { return c.id === 'c1'; })[0].correspondence_language, [g1, g2, g3, g4, g5]);
  var g6 = await lang('u-admin', { customer_id: 'c1', language: 'fr' }); var g7 = await lang('u-admin', { customer_id: 'c1', language: 'fr' }); var g8 = await lang('u-super', { customer_id: 'c1', language: 'ar' });
  var auL = db.t.hub_audit_log.filter(function (a) { return a.action === 'customer_correspondence_language_set'; });
  check('language: a person with the customer-edit permission saves it (and the super admin); each change is in the audit trail with who, the customer, from and to; saving the same value again writes nothing', g6.ok && g6.from === null && g7.ok && g7.unchanged === true && g8.ok && g8.from === 'fr' && db.t.accounting_customers.filter(function (c) { return c.id === 'c1'; })[0].correspondence_language === 'ar' && auL.length === 2 && auL[0].actor_id === 'u-admin' && auL[0].entity_id === 'c1' && auL[0].details.from === null && auL[0].details.to === 'fr' && auL[1].details.from === 'fr' && auL[1].details.to === 'ar', [g6, g7, g8, auL]);
  var pvL = await call('u-staff', { action: 'preview', order_id: 1 }); var pvL2 = await call('u-staff', { action: 'preview', order_id: 1, lang: 'en' });
  check('…the reminder for that customer is now pre-selected in Arabic (right-to-left), and a person can still pick another language for one send', pvL.lang === 'ar' && pvL.rtl === true && pvL.row.language_chosen === true && pvL2.lang === 'en' && pvL2.body.indexOf('Dear Contact 1,') === 0);
  var realFromL = db.from.bind(db); db.from = function (name) { if (name === 'accounting_customers') { var ql = realFromL(name); var run0 = ql.run.bind(ql); ql.select = function (cols) { ql._cols = cols; return ql; }; ql.run = function () { if (/correspondence_language/.test(String(ql._cols || '')) || (ql.op === 'update' && ql.payload && 'correspondence_language' in ql.payload)) { return { data: null, error: { message: 'column accounting_customers.correspondence_language does not exist' } }; } var r0 = run0(); if (r0 && Array.isArray(r0.data)) { r0.data = r0.data.map(function (x) { var y = Object.assign({}, x); delete y.correspondence_language; return y; }); } return r0; }; return ql; } return realFromL(name); };
  var g9 = await lang('u-admin', { customer_id: 'c2', language: 'es' }); var liNoCol = await call('u-staff', { action: 'list' }); db.from = realFromL;
  check('before the XY SQL is installed: saving a language says which SQL to run (nothing saved); the reminders still list and write in English, and the screen is told the language is not installed', g9._status === 503 && /v55-83-XY-reminder-language-cc-attachments\.sql/.test(g9.error) && liNoCol.ok && liNoCol.language_ready === false && liNoCol.rows.every(function (r) { return r.language === 'en' && r.language_chosen === false; }), [g9, liNoCol.error]);

  // ── PAID IN FULL is not urgent (Max, 23 Nov, on the live list: "why is something that doesn't have any more money owed to it, so it's
  //    paid off. Why is it still showing in this here that it's urgent to release it? It's already paid.") — his four rows, his figures ──
  var pfFeed = { ok: true, source: 'nextrade-live', site: 'nextradeindustries.com', status_history: [], orders: [
    ord(101, '1001-1613', 'MAA KIRPA'), ord(102, '1002-1185', 'MAA KIRPA'), ord(103, '1002-1190', 'Still Owing One'), ord(104, '1002-1191', 'Still Owing Two'),
    ord(105, '1002-1192', 'Overpaid Co'), ord(106, '1002-1193', 'No Invoice Co'), ord(107, '1002-1194', 'Old History Co'), ord(108, '1002-1195', 'Recent Owing Co')],
    requirements: [stage(101, plus(-34)), stage(102, plus(-34)), stage(103, plus(-34)), stage(104, plus(-34)), stage(105, plus(-34)), stage(106, plus(-34)), stage(107, plus(-34)), stage(108, plus(-5))] };
  function pc(n, name) { return { id: 'pc' + n, company_name: name, contact_name: 'Contact', email: 'pay' + n + '@cust.example', correspondence_language: null }; }
  var pfCust = [pc(101, 'MAA KIRPA'), pc(103, 'Still Owing One'), pc(104, 'Still Owing Two'), pc(105, 'Overpaid Co'), pc(107, 'Old History Co'), pc(108, 'Recent Owing Co')];
  var pfInv = [inv(101, '1001-1613', 'pc101', 26906.40), inv(102, '1002-1185', 'pc101', 24187.40), inv(103, '1002-1190', 'pc103', 20000), inv(104, '1002-1191', 'pc104', 9000), inv(105, '1002-1192', 'pc105', 500), inv(107, '1002-1194', 'pc107', 700, { invoice_date: '2026-05-01' }), inv(108, '1002-1195', 'pc108', 1000)];
  function pp(id, invId, amount, date) { return { id: 'pp' + id, accounting_invoice_id: 'i' + invId, amount: amount, payment_date: date || '2026-11-05', voided: false, sync_status: 'synced' }; }
  var pfPay = [pp(1, 101, 20000), pp(2, 101, 6906.40), pp(3, 102, 24187.40), pp(4, 103, 11572), pp(5, 104, 5712.74), pp(6, 105, 600), pp(7, 107, 700, '2026-05-10'), pp(8, 104, 99999, '2026-11-06')];
  pfPay[7].voided = true; // a void payment never makes an order "paid"
  var pfB = S.buildReminderRows({ feed: pfFeed, invoices: pfInv, payments: pfPay, customers: pfCust, log: [], today: TODAY }); var pf = {}; pfB.rows.forEach(function (r) { pf[r.order_id] = r; });
  check('MAA KIRPA 1001-1613 ($26,906.40 received of $26,906.40) and 1002-1185 ($24,187.40 of $24,187.40), 34 days past: PAID IN FULL — no payment stage, nothing to send', pf[101].paid_in_full === true && pf[101].balance.total === 26906.40 && pf[101].balance.received === 26906.40 && pf[101].balance.remaining === 0 && pf[102].paid_in_full === true && pf[102].balance.remaining === 0 && pf[101].days === -34 && pf[101].auto.eligible === false && pf[102].auto.eligible === false, [pf[101], pf[102]]);
  check('the two that still owe $8,428.00 and $3,287.26 are NOT paid and keep their stage (beyond urgent)', pf[103].paid_in_full === false && pf[103].balance.remaining === 8428 && pf[103].phase === 'overdue' && pf[104].paid_in_full === false && pf[104].balance.remaining === 3287.26 && pf[104].phase === 'overdue', [pf[103].balance, pf[104].balance]);
  check('an overpaid order is paid; an order with NO invoice is not paid (the balance is unknown), and it still cannot be sent', pf[105].paid_in_full === true && pf[106].paid_in_full === false && pf[106].balance === null && /No invoice/.test(pf[106].blocks[0]));
  check('the orders that owe are listed first, the paid ones after them; the paid ones are in no reminder count', pfB.rows.slice(0, 4).every(function (r) { return !r.paid_in_full; }) && pfB.rows.slice(4).every(function (r) { return r.paid_in_full; }) && pfB.rows.length === 8 && pfB.counts.paid === 4 && pfB.counts.overdue === 4 && pfB.counts.ready + pfB.counts.blocked === 4, [pfB.rows.map(function (r) { return r.order_id + ':' + r.paid_in_full; }), pfB.counts]);
  var pfW = S.buildReminderRows({ feed: pfFeed, invoices: pfInv, payments: pfPay, customers: pfCust, log: [], today: TODAY, floor: '2026-11-01' }); var pw7 = pfW.rows.filter(function (r) { return r.order_id === 107; })[0];
  check('a person limited by the history window: an order whose (paid) invoice is older than their window is NOT shown as paid — the balance is withheld, nothing is claimed', pf[107].paid_in_full === true && pw7.limited === true && pw7.paid_in_full === false && pw7.balance === null);
  var hPf = RS0.renderToStaticMarkup(React0.createElement(UI0.ArrivalRemindersView, { rows: pfB.rows, autoOn: true, onPrepare: function () { }, onHistory: function () { } }));
  var paidRow = hPf.substring(hPf.indexOf('1001-1613')); paidRow = paidRow.substring(0, paidRow.indexOf('</tr>')); var oweRow = hPf.substring(hPf.indexOf('1002-1190')); oweRow = oweRow.substring(0, oweRow.indexOf('</tr>'));
  check('screen: the paid row shows a green "Paid in full", NO pink day counter, NO "Beyond urgent", NO "Prepare reminder" and no "Automatic: needs a person" line; the owing row keeps the pink counter and "Beyond urgent"', paidRow.indexOf('>Paid in full<') > 0 && paidRow.indexOf('#d1fae5') > 0 && paidRow.indexOf('Paid in full — no reminder') > 0 && paidRow.indexOf('#f9a8d4') < 0 && paidRow.indexOf('Beyond urgent') < 0 && paidRow.indexOf('Prepare reminder') < 0 && paidRow.indexOf('Automatic:') < 0 && paidRow.indexOf('$0.00') > 0 && oweRow.indexOf('#f9a8d4') > 0 && oweRow.indexOf('Beyond urgent') > 0 && oweRow.indexOf('$8,428.00') > 0, [paidRow.replace(/<[^>]+>/g, ' ').replace(/ +/g, ' '), oweRow.replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ')]);
  // the automatic run on exactly these orders
  var keepT = { i: db.t.accounting_invoices, p: db.t.accounting_invoice_payments, c: db.t.accounting_customers, l: db.t.arrival_reminders }; db.t.accounting_invoices = pfInv; db.t.accounting_invoice_payments = pfPay; db.t.accounting_customers = pfCust; db.t.arrival_reminders = [];
  feedNow = pfFeed; await call('u-super', { action: 'auto_set', enabled: true, confirm: true }); var nPf = sentMail.length; var pfRun = await timer(SECRET); var pfList = await call('u-super', { action: 'list' });
  var pfPrev = await call('u-super', { action: 'preview', order_id: 101 }); var pfSend = await call('u-super', { action: 'send', order_id: 101, draft_hash: 'x', confirm: true, to: 'pay101@cust.example', confirm_to: 'pay101@cust.example' });
  await call('u-super', { action: 'auto_set', enabled: false }); feedNow = feedLive; db.t.accounting_invoices = keepT.i; db.t.accounting_invoice_payments = keepT.p; db.t.accounting_customers = keepT.c; db.t.arrival_reminders = keepT.l;
  check('automatic run: NOTHING goes to a paid order (zero owed) — only the one order that owes and is inside the 30 days is sent; the paid orders are not even counted as waiting for a person', pfRun.run.sent.length === 1 && pfRun.run.sent[0].release === '1002-1195' && sentMail.length === nPf + 1 && sentMail[sentMail.length - 1].to === 'pay108@cust.example' && sentMail.slice(nPf).every(function (x) { return x.to.indexOf('pay101@') < 0 && x.to.indexOf('pay105@') < 0; }) && pfRun.run.needs_person === 3, pfRun.run);
  check('by hand too: a paid order has no text to send and a send is refused', pfPrev.can_send === false && !pfPrev.body && pfSend._status === 409 && sentMail.length === nPf + 1 && pfList.counts.paid === 4 && pfList.auto.would_send === 0);

  // screen + files
  var React = require('react'); global.React = React; var RS = require('react-dom/server');
  var UI = require(path.join(root, 'src/components/ArrivalRemindersTab.jsx'));
  var hOff = RS.renderToStaticMarkup(React.createElement(UI.AutoPanel, { auto: liF.auto, onSet: function () { } }));
  var hStaff = RS.renderToStaticMarkup(React.createElement(UI.AutoPanel, { auto: li0.auto, onSet: function () { } }));
  check('screen: the automatic panel shows ON / OFF, the time, the last run with what was not sent and why; the switch button only for the super admin', hOff.indexOf('>ON<') > 0 && hOff.indexOf('Switch OFF') > 0 && hOff.indexOf('12:00 UTC') > 0 && hOff.indexOf('Last run') > 0 && hStaff.indexOf('>OFF<') > 0 && hStaff.indexOf('Switch ON') < 0 && hStaff.indexOf('Only the super admin can switch it.') > 0 && hStaff.indexOf('3 reminder(s)') > 0);
  var liveNow = Object.assign({}, liF.auto, { live_feed: true, on: true, would_send: 20, last_run: stagingRun });
  var hZg = RS.renderToStaticMarkup(React.createElement(UI.AutoPanel, { auto: liveNow, onSet: function () { } })); var tZg = hZg.replace(/<[^>]+>/g, ' ').replace(/ +/g, ' ');
  check('ZG (Max 25 Nov: "this message is wrong"): the last run was on the staging copy, the Hub reads LIVE now → the Last run line says it in the PAST, tied to that run; nothing on the screen says the Hub IS reading a test copy', /Last run .+?: 0 sent/.test(tZg) && /At that run \([^)]+\) the Hub was reading the staging test copy of the warehouse, so nothing was sent\./.test(tZg) && !/The Hub is reading/.test(tZg) && !/never sent from a test copy/.test(tZg) && !/TEST copy/.test(tZg) && /20 reminder\(s\) will go out at the next run\./.test(tZg), tZg);
  var oldStored = { at: '2026-11-25T13:00:00Z', sent: [], failed: [], unconfirmed: [], skipped: [], needs_person: 0, note: 'The Hub is reading the nextrade-staging copy of the warehouse, not the live one — automatic reminders are never sent from a test copy.' };
  var tOld = RS.renderToStaticMarkup(React.createElement(UI.AutoPanel, { auto: Object.assign({}, liveNow, { last_run: oldStored }), onSet: function () { } })).replace(/<[^>]+>/g, ' ');
  check('ZG: the run record ALREADY STORED on live (the old present-tense sentence, no reason code) is shown the same corrected way', /At that run \([^)]+\) the Hub was reading the staging test copy/.test(tOld) && !/The Hub is reading/.test(tOld) && UI.lastRunWasTestCopy(oldStored) === true);
  var tStg = RS.renderToStaticMarkup(React.createElement(UI.AutoPanel, { auto: Object.assign({}, liveNow, { live_feed: false }), onSet: function () { } })).replace(/<[^>]+>/g, ' ');
  check('ZG: while the Hub really IS reading a test copy, the present-tense warning shows (once), beside the past-tense line about the last run', (tStg.match(/The Hub is reading a TEST copy of the warehouse/g) || []).length === 1 && /At that run \(/.test(tStg));
  var tErr = RS.renderToStaticMarkup(React.createElement(UI.AutoPanel, { auto: Object.assign({}, liveNow, { last_run: { at: '2026-11-25T12:00:00Z', sent: [], failed: [], unconfirmed: [], skipped: [], needs_person: 0, note: 'The warehouse feed answered 200 Nothing was sent.' } }), onSet: function () { } }));
  check('ZG: any other stored reason is also tied to its run ("At that run: …") and stays red; a run with no reason shows none', tErr.indexOf('At that run: The warehouse feed answered 200') > 0 && tErr.indexOf('#991b1b') > 0 && UI.lastRunNote({ at: 'x', note: null }) === '' && UI.lastRunNote(null) === '' && UI.lastRunWasTestCopy({ note: 'The warehouse feed answered 200' }) === false);
  var hList = RS.renderToStaticMarkup(React.createElement(UI.ArrivalRemindersView, { rows: li0.rows, autoOn: false, onPrepare: function () { }, onHistory: function () { } }));
  check('screen: each order says what the schedule would do with it, with the reason when a person is needed', hList.indexOf('Automatic: would go out by itself (switch is OFF)') > 0 && hList.indexOf('Automatic: needs a person — Cannot send — no e-mail on the Hub customer.') > 0 && hList.indexOf('no e-mail on the Hub customer') > 0 && hList.indexOf('language not chosen yet') > 0 && hList.indexOf('Spanish') > 0 && hList.indexOf('Automatic: needs a person — The port of loading must be confirmed') > 0);
  var src = fs.readFileSync(path.join(root, 'src/components/ArrivalRemindersTab.jsx'), 'utf8');
  check('screen: Send-to says it is the Hub customer’s; the box shows the CC line and what is attached; nothing refers to a warehouse address any more', src.indexOf('on file in the Hub customer (Accounting → Customers)') > 0 && src.indexOf('<b>CC:</b>') > 0 && src.indexOf('<b>Attached:</b>') > 0 && !/hub_email|warehouse_sends_email|language_from_warehouse|NT Warehouse/.test(src) && src.indexOf('<AutoPanel auto={data.auto}') > 0 && src.indexOf("action: 'auto_set'") > 0 && src.indexOf("action: 'cc_set'") > 0);
  var CU = require(path.join(root, 'src/components/AccountingCustomersTab.jsx'));
  var hNo = RS.renderToStaticMarkup(React.createElement(CU.LanguageChoice, { value: '', name: 'lang-x', onPick: function () { } })); var hFr = RS.renderToStaticMarkup(React.createElement(CU.LanguageChoice, { value: 'fr', name: 'lang-y', onPick: function () { } })); var hDis = RS.renderToStaticMarkup(React.createElement(CU.LanguageChoice, { value: 'en', name: 'lang-z', disabled: true, onPick: function () { } }));
  check('Customers list: four radio buttons EN / ES / FR / AR per customer; nothing chosen shows "not chosen yet · English"; the chosen one is ticked; without the edit right they are disabled', (hNo.match(/type="radio"/g) || []).length === 4 && hNo.indexOf('not chosen yet · English') > 0 && hNo.indexOf('checked') < 0 && (hFr.match(/checked=""/g) || []).length === 1 && /checked=""[^>]*\/>FR/.test(hFr) && hFr.indexOf('not chosen yet') < 0 && (hDis.match(/disabled=""/g) || []).length === 4, [hNo, hFr]);
  var cuSrc = fs.readFileSync(path.join(root, 'src/components/AccountingCustomersTab.jsx'), 'utf8');
  check('Customers list: the radio column is in the list, saves through the server route (never straight from the browser), and the helper it needs is imported', cuSrc.indexOf("import { hubFetch } from '../lib/hub-fetch'") > 0 && cuSrc.indexOf("hubFetch('/api/accounting/customer-language'") > 0 && cuSrc.indexOf('<LanguageChoice value={r.correspondence_language') > 0 && (cuSrc.match(/gridTemplateColumns: '1fr 1fr 140px 90px 90px 96px 178px'/g) || []).length === 2 && !/dbUpdate\([^)]*correspondence_language/.test(cuSrc));
  var hCc = RS.renderToStaticMarkup(React.createElement(UI.CcLine, { cc: ['Jasmine@ktcus.com', 'hsaad@ktcus.com'], canEdit: false, onSave: function () { } })); var hCc2 = RS.renderToStaticMarkup(React.createElement(UI.CcLine, { cc: [], canEdit: true, onSave: function () { } }));
  check('screen: the copy list is shown to everyone, "Change" only to the super admin, and it says tests are not copied', hCc.indexOf('Jasmine@ktcus.com, hsaad@ktcus.com') > 0 && hCc.indexOf('>Change<') < 0 && hCc2.indexOf('>Change<') > 0 && hCc2.indexOf('nobody') > 0 && hCc.indexOf('A test you send to yourself is not copied to anyone.') > 0);
  var hListN = RS.renderToStaticMarkup(React.createElement(UI.ArrivalRemindersView, { rows: liN.rows, autoOn: false, onPrepare: function () { }, onHistory: function () { } }));
  check('screen: an order whose reminder went without the invoice says so on the list', hListN.indexOf('Sent WITHOUT the invoice attached') > 0);
  var hHist = RS.renderToStaticMarkup(React.createElement(UI.ReminderHistoryView, { rows: [lN, lH] }));
  check('screen: the history shows who was copied and whether the invoice was attached', hHist.indexOf('CC: Jasmine@ktcus.com, hsaad@ktcus.com') > 0 && hHist.indexOf('1 invoice PDF(s) attached') > 0 && hHist.indexOf('no invoice attached') > 0 && hHist.indexOf('Sent WITHOUT the invoice attached') > 0);
  check('screen: a wrong mailbox is named in a red bar, and the language-not-installed notice exists', src.indexOf("not info@ktcus.com. Reminders are only sent from info@ktcus.com") > 0 && src.indexOf('data.language_ready === false') > 0);
  var P = require(path.join(root, 'src/lib/invoice-pdf.js'));
  var big = []; for (var bi = 1; bi <= 70; bi++) { big.push({ description: 'Line ' + bi + ' (rolls) \\ with a slash', quantity: bi, unit_price: 2.5, line_total: bi * 2.5, sort_order: bi }); }
  var pBig = P.buildInvoicePdf({ invoice: { invoice_number: 'INV/2026 #9', invoice_date: '2026-11-01', due_date: '2026-12-01', total_amount: 6000, notes: 'Thank you \u2013 \u201Cwire only\u201D.' }, items: big, customer: { company_name: 'Importaci\u00F3n Jos\u00E9 S.A.' }, company: { company_name: 'KTC' }, paid: 100 });
  var tBig = await readPdf(pBig.bytes);
  check('invoice PDF: a 70-line invoice runs over several pages with "Page n of m"; accents are kept; subtotal / discount appear when the total differs from the lines; a safe file name', pBig.ok && pBig.pages >= 2 && /Page 1 of \d/.test(tBig) && /\(continued\)/.test(tBig) && /Importaci\u00F3n Jos\u00E9 S\.A\./.test(tBig) && /Line 70 \(rolls\) \\ with a slash/.test(tBig) && /Subtotal\W+\$6,212\.50/.test(tBig) && /Discount \/ adjustment\W+-\$212\.50/.test(tBig) && /Balance due\W+\$5,900\.00/.test(tBig) && /Thank you - "wire only"\./.test(tBig) && pBig.filename === 'Invoice-INV-2026-9.pdf', [pBig.filename, pBig.pages, tBig.substring(tBig.length - 400)]);
  var pAr = P.buildInvoicePdf({ invoice: { invoice_number: 'A1', total_amount: 5 }, items: [], customer: { company_name: '\u0634\u0631\u0643\u0629' }, company: {}, paid: 0 }); var pNo = P.buildInvoicePdf({ invoice: { total_amount: 5 }, items: [], customer: {}, company: {}, paid: 0 }); var pNull = P.buildInvoicePdf({});
  check('invoice PDF: a non-Latin customer name, an invoice with no number, or no invoice at all → NO file and a plain reason (never a file with wrong text)', pAr.ok === false && /cannot show/.test(pAr.reason) && pNo.ok === false && /no number/.test(pNo.reason) && pNull.ok === false);
  var pdfSrc = fs.readFileSync(path.join(root, 'src/lib/invoice-pdf.js'), 'utf8'); var clSrc = fs.readFileSync(path.join(root, 'src/app/api/accounting/customer-language/route.js'), 'utf8');
  check('new server files: var + concatenation only, no client module, the PDF writer reads no database and knows nothing of costs / customs', !/\blet\s|\bconst\s|=>|`/.test(pdfSrc) && !/\blet\s|\bconst\s|=>|`/.test(clSrc) && !/components\//.test(pdfSrc + clSrc) && !/^'use client'/m.test(pdfSrc + clSrc) && !/supabase|createClient|pl_invoice_terms|shipping_cost|customs-invoice|import /.test(pdfSrc.replace(/^\/\/.*$/gm, '')));
  var sqlXY = fs.readFileSync(path.join(root, 'sql/v55-83-XY-reminder-language-cc-attachments.sql'), 'utf8');
  check('SQL: additive and re-runnable — one column + a four-value check on accounting_customers, three columns on the reminder log, the delete right taken from the server role; no DROP / DELETE', /ADD COLUMN IF NOT EXISTS correspondence_language text/.test(sqlXY) && /IN \('en','es','fr','ar'\)/.test(sqlXY) && /ADD COLUMN IF NOT EXISTS cc text/.test(sqlXY) && /ADD COLUMN IF NOT EXISTS invoices_attached integer/.test(sqlXY) && /ADD COLUMN IF NOT EXISTS attachment_note text/.test(sqlXY) && /REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.arrival_reminders FROM service_role/.test(sqlXY) && !/\bDROP\b|DELETE FROM/i.test(sqlXY.replace(/--.*$/gm, '')));
  var vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')); var cr = vj.crons.filter(function (c) { return c.path.indexOf('/api/accounting/arrival-reminders') === 0; });
  check('the timer: two entries, 12:00 and 13:00 UTC every day, on the reminders route', cr.length === 2 && cr[0].schedule === '0 12 * * *' && cr[1].schedule === '0 13 * * *');
  var rs = fs.readFileSync(path.join(root, 'src/app/api/accounting/arrival-reminders/route.js'), 'utf8'); var ls = fs.readFileSync(path.join(root, 'src/lib/arrival-reminders-server.js'), 'utf8'); var lp = fs.readFileSync(path.join(root, 'src/lib/arrival-reminders.js'), 'utf8');
  check('route / libs: still var + concatenation only, no client module imported, GET checks the timer secret first', !/\blet\s|\bconst\s|=>|`/.test(rs.replace(/export const maxDuration/, '')) && !/\blet\s|\bconst\s|=>|`/.test(ls) && !/\blet\s|\bconst\s|=>|`/.test(lp) && !/components\//.test(rs + ls + lp) && /export async function GET\(req\) \{\s*if \(!isTimer\(req\)\) \{ return bad\('Timer only\.', 401\); \}/.test(rs));
  var page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8'); var wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
  check('What’s New has the XY entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-XY'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]{2})'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());

  Module._load = origLoad; Module._resolveFilename = orig;
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
