// ═══════════════════════════════════════════════════════════════════════════
// v55.83-TV — REPEATING BILLS (Max, Nov 17 2026: the monthly "Warehouse staff" bill and any bill that comes back).
// RUN, not grep: the schedule maths, then the bill maker against an in-memory database that enforces the same two
// unique rules as sql/v55-83-TV-repeating-bills.sql — one run row and one bill per repeating bill per date.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = require(path.join(root, 'src/lib/repeating-bills.js'));
var S = require(path.join(root, 'src/lib/repeating-bills-server.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }

console.log('TV — repeating bills');

// ── schedule maths ──
check('monthly on the 31st: Feb is the last day, March is back to the 31st (no drift)',
  R.occurrenceDate('2026-01-31', 'monthly', 1) === '2026-02-28' && R.occurrenceDate('2026-01-31', 'monthly', 2) === '2026-03-31');
check('leap year February', R.occurrenceDate('2028-01-31', 'monthly', 1) === '2028-02-29');
check('weekly = +7 days', R.occurrenceDate('2026-12-28', 'weekly', 1) === '2027-01-04');
check('quarterly = +3 months', R.occurrenceDate('2026-11-30', 'quarterly', 1) === '2027-02-28' && R.occurrenceDate('2026-11-30', 'quarterly', 2) === '2027-05-30');
check('yearly from Feb 29', R.occurrenceDate('2028-02-29', 'yearly', 1) === '2029-02-28' && R.occurrenceDate('2028-02-29', 'yearly', 4) === '2032-02-29');
check('unknown frequency → nothing', R.occurrenceDate('2026-01-01', 'daily', 1) === null);
check('isDateStr refuses 2026-02-30', !R.isDateStr('2026-02-30') && R.isDateStr('2026-02-28'));

var rb = { start_date: '2026-12-01', frequency: 'monthly', lead_days: 7 };
check('7 days before: on Nov 23 nothing is due for Dec 1', R.dueDates(rb, '2026-11-23', {}).length === 0);
check('7 days before: on Nov 24 the Dec 1 bill is due', JSON.stringify(R.dueDates(rb, '2026-11-24', {})) === '["2026-12-01"]');
check('lead 0: due only on the day', R.dueDates({ start_date: '2026-12-01', frequency: 'monthly', lead_days: 0 }, '2026-11-30', {}).length === 0);
check('default lead is 7 when not set', R.leadDaysOf({}) === 7 && R.DEFAULT_LEAD_DAYS === 7);
check('catch-up: the Hub was down — every missed date, oldest first, one each',
  JSON.stringify(R.dueDates(rb, '2027-02-20', {})) === '["2026-12-01","2027-01-01","2027-02-01"]');
check('dates already handled are not due again', JSON.stringify(R.dueDates(rb, '2027-02-20', { '2026-12-01': true, '2027-01-01': true })) === '["2027-02-01"]');
check('end date stops the schedule', JSON.stringify(R.dueDates({ start_date: '2026-12-01', frequency: 'monthly', end_date: '2027-01-15', lead_days: 7 }, '2027-06-01', {})) === '["2026-12-01","2027-01-01"]');
check('paused time is never made: resume_from skips older dates', JSON.stringify(R.dueDates({ start_date: '2026-12-01', frequency: 'monthly', lead_days: 7, resume_from: '2027-01-20' }, '2027-02-20', {})) === '["2027-02-01"]');
check('never more than MAX_PER_RUN in one run', R.dueDates({ start_date: '2020-01-01', frequency: 'weekly', lead_days: 0 }, '2026-12-01', {}).length === R.MAX_PER_RUN);
check('next date skips handled ones', R.nextDate(rb, { '2026-12-01': true }) === '2027-01-01');
check('next date null after the end', R.nextDate({ start_date: '2026-12-01', frequency: 'monthly', end_date: '2026-12-31' }, { '2026-12-01': true }) === null);
check('auto bill # is readable and unique per date', R.autoBillNumber('Warehouse staff', '2026-12-01') === 'AUTO-WAREHOUSES-20261201');

// ── checks on what a person types ──
var ok = R.validateRepeating({ vendor_name: ' Warehouse staff ', amount: '12500', frequency: 'monthly', start_date: '2026-12-01', release_number: '1002-55' }, '2026-11-17');
check('valid repeating bill → stored row', ok.ok && ok.row.vendor_name === 'Warehouse staff' && ok.row.amount === 12500 && ok.row.lead_days === 7 && ok.row.release_number === '1002-55');
check('no vendor → refused', !R.validateRepeating({ amount: 5, frequency: 'monthly', start_date: '2026-12-01' }, '2026-11-17').ok);
check('zero amount → refused', !R.validateRepeating({ vendor_name: 'x', amount: 0, frequency: 'monthly', start_date: '2026-12-01' }, '2026-11-17').ok);
check('end before start → refused', !R.validateRepeating({ vendor_name: 'x', amount: 5, frequency: 'monthly', start_date: '2026-12-01', end_date: '2026-11-01' }, '2026-11-17').ok);
check('lead over 60 → refused', !R.validateRepeating({ vendor_name: 'x', amount: 5, frequency: 'monthly', start_date: '2026-12-01', lead_days: 61 }, '2026-11-17').ok);
check('first date > 3 months ago → refused (would pile up old bills)', !R.validateRepeating({ vendor_name: 'x', amount: 5, frequency: 'weekly', start_date: '2026-01-01' }, '2026-11-17').ok);
check('… but an edit that KEEPS its saved first date is fine', R.validateRepeating({ vendor_name: 'x', amount: 5, frequency: 'weekly', start_date: '2026-01-01' }, '2026-11-17', { keepStart: '2026-01-01' }).ok);

// ── in-memory database with the SQL's unique rules ──
function FakeDb() {
  var self = this; self.t = { recurring_bills: [], recurring_bill_runs: [], vendor_bills: [], hub_audit_log: [], us_expense_rules: [] }; var seq = 0;
  self.failInsertBills = false;
  var UNIQUE = { recurring_bill_runs: ['recurring_id', 'occurrence_date'], vendor_bills: ['recurring_id', 'recurring_date'] };
  function Q(table) { this.table = table; this.filters = []; this.op = 'select'; this.single = false; }
  Q.prototype.select = function () { if (this.op === 'select') { this.op = 'select'; } this.returning = true; return this; };
  Q.prototype.eq = function (k, v) { this.filters.push(function (r) { return String(r[k]) === String(v); }); return this; };
  Q.prototype.neq = function (k, v) { this.filters.push(function (r) { return String(r[k]) !== String(v); }); return this; };
  Q.prototype.in = function (k, vs) { this.filters.push(function (r) { return vs.indexOf(r[k]) >= 0; }); return this; };
  Q.prototype.not = function () { return this; };
  Q.prototype.limit = function () { return this; };
  Q.prototype.order = function () { return this; };
  Q.prototype.range = function (a, b) { this.rng = [a, b]; return this; };
  Q.prototype.maybeSingle = function () { this.single = true; return this; };
  Q.prototype.insert = function (row) { this.op = 'insert'; this.row = row; return this; };
  Q.prototype.update = function (p) { this.op = 'update'; this.patch = p; return this; };
  Q.prototype.exec = function () {
    var rows = self.t[this.table] || (self.t[this.table] = []); var f = this.filters;
    function match(r) { for (var i = 0; i < f.length; i++) { if (!f[i](r)) { return false; } } return true; }
    if (this.op === 'insert') {
      if (this.table === 'vendor_bills' && self.failInsertBills) { return { error: { message: 'boom' }, data: null }; }
      var u = UNIQUE[this.table]; var row = this.row;
      if (u && row[u[0]] != null && rows.some(function (x) { return String(x[u[0]]) === String(row[u[0]]) && String(x[u[1]]) === String(row[u[1]]); })) { return { error: { code: '23505', message: 'duplicate key' }, data: null }; }
      var n = Object.assign({ id: 'id' + (++seq), updated_at: new Date(Date.now() + seq).toISOString() }, row); rows.push(n);
      return { error: null, data: this.single ? n : [n] };
    }
    if (this.op === 'update') {
      var hit = rows.filter(match); var p = this.patch;
      hit.forEach(function (r) { Object.assign(r, p); if (!p.updated_at) { r.updated_at = new Date(Date.now() + (++seq)).toISOString(); } });
      return { error: null, data: hit };
    }
    var out = rows.filter(match);
    if (this.rng) { out = out.slice(this.rng[0], this.rng[1] + 1); }
    return { error: null, data: this.single ? (out[0] || null) : out };
  };
  Q.prototype.then = function (res, rej) { try { return Promise.resolve(this.exec()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } };
  self.from = function (t) { return new Q(t); };
}

(async function () {
  var db = new FakeDb();
  db.t.recurring_bills.push({ id: 'rb1', wave_business_id: 'US', vendor_name: 'Warehouse staff', amount: 12500, category: 'payroll', frequency: 'monthly', start_date: '2026-12-01', lead_days: 7, status: 'active', created_by: 'u1' });
  var r1 = await S.runRepeatingBills(db, { today: '2026-11-24' });
  check('run on Nov 24 makes the Dec 1 bill', r1.ok && r1.made === 1 && db.t.vendor_bills.length === 1, r1);
  var b = db.t.vendor_bills[0] || {};
  check('the bill: vendor, amount, dates, auto #, category, links back to its repeating bill',
    b.vendor_name === 'Warehouse staff' && b.total_amount === 12500 && b.bill_date === '2026-12-01' && b.due_date === '2026-12-01' && b.bill_number === 'AUTO-WAREHOUSES-20261201' && b.category === 'payroll' && b.recurring_id === 'rb1' && b.recurring_date === '2026-12-01' && b.wave_business_id === 'US');
  check('audit row written for the bill', db.t.hub_audit_log.some(function (a) { return a.action === 'bill_created' && a.details && a.details.repeating_bill_id === 'rb1'; }));
  var r2 = await S.runRepeatingBills(db, { today: '2026-11-24' });
  check('running again the same day makes nothing (one bill per date)', r2.made === 0 && db.t.vendor_bills.length === 1, r2);

  // two runs at the same moment: the run row is claimed once
  var db2 = new FakeDb();
  db2.t.recurring_bills.push({ id: 'rb2', wave_business_id: 'US', vendor_name: 'Rent Co', amount: 3000, frequency: 'monthly', start_date: '2026-12-01', lead_days: 7, status: 'active' });
  var both = await Promise.all([S.runRepeatingBills(db2, { today: '2026-11-25' }), S.runRepeatingBills(db2, { today: '2026-11-25' })]);
  check('two runs at once → exactly ONE bill', db2.t.vendor_bills.length === 1 && db2.t.recurring_bill_runs.length === 1, both);

  // a bill typed by hand with the same vendor + bill # → strong duplicate → skipped, not made
  var db3 = new FakeDb();
  db3.t.recurring_bills.push({ id: 'rb3', wave_business_id: 'US', vendor_name: 'Warehouse staff', amount: 12500, frequency: 'monthly', start_date: '2026-12-01', lead_days: 7, status: 'active' });
  db3.t.vendor_bills.push({ id: 'hand1', vendor_name: 'Warehouse Staff', bill_number: 'AUTO-WAREHOUSES-20261201', bill_date: '2026-12-01', total_amount: 12500, record_status: 'active' });
  var r3 = await S.runRepeatingBills(db3, { today: '2026-11-24' });
  var run3 = db3.t.recurring_bill_runs[0] || {};
  check('strong duplicate → NOT made, date marked skipped with the reason', r3.skipped === 1 && db3.t.vendor_bills.length === 1 && run3.outcome === 'skipped_duplicate' && /duplicate/i.test(run3.message || ''), r3);
  var r3b = await S.runRepeatingBills(db3, { today: '2026-11-24' });
  check('a skipped date is not retried every day', r3b.skipped === 0 && r3b.made === 0);
  var any = await S.makeSkippedAnyway(db3, 'rb3', '2026-12-01', 'u9');
  check('"make it anyway" makes it, audited as a duplicate override by that person', any.ok && db3.t.vendor_bills.length === 2 && db3.t.hub_audit_log.some(function (a) { return a.action === 'bill_duplicate_override' && a.actor_id === 'u9'; }), any);
  var any2 = await S.makeSkippedAnyway(db3, 'rb3', '2026-12-01', 'u9');
  check('… and only once', !any2.ok && db3.t.vendor_bills.length === 2);

  // a failed insert stays open and is tried again
  var db4 = new FakeDb();
  db4.t.recurring_bills.push({ id: 'rb4', wave_business_id: 'US', vendor_name: 'Power Co', amount: 400, frequency: 'monthly', start_date: '2026-12-01', lead_days: 7, status: 'active' });
  db4.failInsertBills = true;
  var r4 = await S.runRepeatingBills(db4, { today: '2026-11-24' });
  check('a failed bill is reported, the date marked failed', r4.failed === 1 && db4.t.recurring_bill_runs[0].outcome === 'failed', r4);
  db4.failInsertBills = false;
  var r4b = await S.runRepeatingBills(db4, { today: '2026-11-24' });
  check('… and made on the next run', r4b.made === 1 && db4.t.vendor_bills.length === 1 && db4.t.recurring_bill_runs.length === 1, r4b);

  // paused / stopped make nothing
  var db5 = new FakeDb();
  db5.t.recurring_bills.push({ id: 'rb5', wave_business_id: 'US', vendor_name: 'A', amount: 1, frequency: 'monthly', start_date: '2026-12-01', lead_days: 7, status: 'paused' });
  db5.t.recurring_bills.push({ id: 'rb6', wave_business_id: 'US', vendor_name: 'B', amount: 1, frequency: 'monthly', start_date: '2026-12-01', lead_days: 7, status: 'stopped' });
  var r5 = await S.runRepeatingBills(db5, { today: '2026-12-10' });
  check('paused and stopped repeating bills make nothing', r5.made === 0 && db5.t.vendor_bills.length === 0);

  // fail closed: cannot read the bills → nothing made
  var db6 = new FakeDb();
  db6.t.recurring_bills.push({ id: 'rb7', wave_business_id: 'US', vendor_name: 'C', amount: 1, frequency: 'monthly', start_date: '2026-12-01', lead_days: 7, status: 'active' });
  var origFrom = db6.from; db6.from = function (t) { var q = origFrom(t); if (t === 'vendor_bills') { q.exec = function () { return { error: { message: 'read failed' }, data: null }; }; } return q; };
  var r6 = await S.runRepeatingBills(db6, { today: '2026-11-24' });
  check('cannot read the bills on file → nothing made, says why', !r6.ok && /nothing was made/.test(r6.error || '') && db6.t.recurring_bill_runs.length === 0, r6);

  // ── wiring (read the files) ──
  var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/bills/repeating/route.js'), 'utf8');
  var vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-TV-repeating-bills.sql'), 'utf8');
  var tab = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  check('daily cron registered', vercel.crons.some(function (c) { return c.path === '/api/accounting/bills/repeating'; }));
  check('cron refuses without CRON_SECRET (fails closed)', /if \(!secret\)/.test(route) && /Bearer ' \+ secret/.test(route));
  check('writes act for the verified signed-in person', /verifiedCaller\(req, body, createClient\)/.test(route) && /WRITES\[action\]/.test(route));
  check('writes need Bills: Manage', /'bills\.manage'/.test(route));
  check('nothing is deleted: no .delete( in the route', route.indexOf('.delete(') < 0);
  check('SQL: unique run per date and unique bill per date', /recurring_bill_runs_one_per_date/.test(sql) && /vendor_bills_one_per_recurring_date/.test(sql));
  check('SQL: additive only (no DROP TABLE / DELETE)', !/drop table|delete from/i.test(sql));
  check('route is SWC-safe (no template literals / arrow functions)', route.indexOf('`') < 0 && !/=>/.test(route));
  check('Bills screen has the 🔁 Repeating bills button and panel', /RepeatingBillsPanel/.test(tab) && /🔁 Repeating bills/.test(tab));

  console.log('\nTV repeating bills: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
