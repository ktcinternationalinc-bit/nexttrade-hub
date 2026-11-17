// ═══════════════════════════════════════════════════════════════════════════
// v55.83-TW — Nextrade and RTM as their own companies, and Nextrade expense → KTC bill (Max, Nov 17 2026).
// RUN, not grep: the company helpers, then the server's proposal for the one database function (prepareCategorize)
// (one link per Nextrade line, one active line per bill). Plus wiring checks on the route, screens and SQL.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var C = require(path.join(root, 'src/lib/companies.js'));
var N = require(path.join(root, 'src/lib/nextrade-bills-server.js'));
var US = require(path.join(root, 'src/lib/business-of.js')).US_WAVE_BUSINESS_ID;
var FakeDb = require('./fake-supabase.js').FakeDb;
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
console.log('TW — company books + Nextrade bills');

// ── companies ──
check('nextrade / rtm known; anything else refused (never KTC by default)', C.companyByKey('nextrade').id === 'NEXTRADE_BOOKS' && C.companyByKey('RTM').id === 'RTM_BOOKS' && C.companyByKey('') === null && C.companyByKey('ktc') === null);
check('companyById: KTC only for the US Wave business; unknown → null', C.companyById(US).key === 'ktc' && C.companyById('NEXTRADE_BOOKS').key === 'nextrade' && C.companyById(null) === null && C.companyById('KANDIL') === null);
check('no-Wave companies are placeholders for every Wave push', require(path.join(root, 'src/lib/wave-business-shared.js')).isPlaceholderWaveBusiness('NEXTRADE_BOOKS') && require(path.join(root, 'src/lib/wave-business-shared.js')).isPlaceholderWaveBusiness('RTM_BOOKS'));
check('Nextrade / RTM never take old untagged rows', require(path.join(root, 'src/lib/wave-business.js')).scopeIfRegistered([{ wave_business_id: null }, { wave_business_id: 'NEXTRADE_BOOKS' }], 'NEXTRADE_BOOKS', [{ wave_business_id: 'NEXTRADE_BOOKS', is_production: true }]).length === 1);
check('category key from a label', C.categoryKey('Utilities – Electricity') === 'utilities_electricity' && C.categoryKey('  ') === null);
check('most specific rule wins', C.bestCompanyRule([{ match_text: 'centerpoint', category_key: 'a' }, { match_text: 'centerpoint energy', category_key: 'b' }], 'CENTERPOINT ENERGY HOUSTON').category_key === 'b');
check('switched-off / too-short rules ignored', C.bestCompanyRule([{ match_text: 'ab', category_key: 'a' }, { match_text: 'shell', category_key: 'b', active: false }], 'shell ab') === null);
check('end of month', C.endOfMonth('2026-11-17') === '2026-11-30' && C.endOfMonth('2028-02-03') === '2028-02-29' && C.endOfMonth('2026-12-31') === '2026-12-31');
var tot = C.companyTotals([
  { date: '2026-11-02', amount_abs: 100, direction: 'out', company_category: 'elec' },
  { date: '2026-11-05', amount_abs: 5000, direction: 'in', company_category: 'money_from_ktc' },
  { date: '2026-12-01', amount_abs: 50, direction: 'out', company_category: null }], [{ key: 'elec', label: 'Electricity', kind: 'expense' }, { key: 'money_from_ktc', label: 'Money from KTC', kind: 'transfer' }]);
check('totals: money from KTC is a transfer in, never income', tot.inTotal === 0 && tot.transfersIn === 5000 && tot.outTotal === 150);
check('totals: by month, uncategorized shown as such', tot.months.join(',') === '2026-11,2026-12' && tot.rows.some(function (r) { return r.key === '__none' && r.total === -50; }));

// ── which lines make a KTC bill ──
var EXP = { key: 'elec', kind: 'expense' }; var PAY = { key: 'payroll', kind: 'expense', is_payroll: true }; var TRF = { key: 'money_from_ktc', kind: 'transfer' };
check('money-out expense → bill', N.wantsBill({ direction: 'out' }, EXP));
check('payroll → no bill', !N.wantsBill({ direction: 'out' }, PAY));
check('transfer → no bill', !N.wantsBill({ direction: 'out' }, TRF));
check('money in (refund) → no bill even as expense', !N.wantsBill({ direction: 'in' }, EXP));
var row = N.nextradeBillRow({ id: 'abcdef123', date: '2026-11-17', amount_abs: 412.5, name: 'CENTERPOINT ENERGY', merchant_name: 'CenterPoint Energy' }, 'utilities_electricity', 'NextTrade Industries', 'u1', 'Chase ••1234');
check('bill: full amount, end of month, KTC books, paid via NextTrade, tagged', row.total_amount === 412.5 && row.due_date === '2026-11-30' && row.bill_date === '2026-11-17' && row.wave_business_id === US && row.paid_via === 'NextTrade Industries' && /^Created from Nextrade/.test(row.notes) && row.vendor_name === 'CenterPoint Energy' && row.category === 'utilities_electricity' && row.bill_number === 'NXT-20261117-ABCDEF');
check('bill without a mapping says where to set it', /Category mapping/.test(N.nextradeBillRow({ id: 'x', date: '2026-11-17', amount_abs: 1, name: 'x' }, null, null, null, null).notes));

function newDb() {
  var db = new FakeDb({ company_bill_links: [['source_bank_transaction_id'], { cols: ['bill_id'], where: function (r) { return r.status === 'active'; } }] });
  db.t.paid_through_parties = [{ name: 'NextTrade Industries', kind: 'affiliate' }];
  return db;
}
var LINE = { id: 'L1', wave_business_id: 'NEXTRADE_BOOKS', direction: 'out', date: '2026-11-17', amount_abs: 412.5, name: 'CENTERPOINT ENERGY', merchant_name: 'CenterPoint Energy', account_id: 'A1' };
function ctx(cat, ktc) { return { cat: cat, ktcCategory: ktc || null, party: 'NextTrade Industries', actorId: 'u1' }; }

(async function () {
  // v55.83-TW (Codex P1-2) — bill + link + category are now written by ONE database function (hub_company_categorize;
  // run for real in test-v55-83-tw-tx-real-postgres.mjs). Here: the server's PROPOSAL and how errors are reported.
  var db = newDb();
  var p1 = await N.prepareCategorize(db, LINE, EXP, ctx(EXP, 'utilities_electricity'));
  check('expense line → proposal carries the new KTC bill (full amount comes from the line itself in the database)', p1.ok && p1.payload.bill && p1.payload.bill.due_date === '2026-11-30' && p1.payload.ktc_category === 'utilities_electricity' && !p1.payload.attach_bill_id, p1);
  var p2 = await N.prepareCategorize(db, LINE, PAY, ctx(PAY));
  check('payroll → no bill proposed', p2.ok && !p2.payload.bill);
  var p3 = await N.prepareCategorize(db, Object.assign({}, LINE, { wave_business_id: 'RTM_BOOKS' }), EXP, ctx(EXP));
  check('RTM line → no bill proposed (category only)', p3.ok && !p3.payload.bill && p3.payload.company_id === 'RTM_BOOKS');
  var dbA = newDb();
  dbA.t.vendor_bills = [{ id: 'RENT1', wave_business_id: US, vendor_name: 'CenterPoint Energy, Inc.', bill_number: 'X', bill_date: '2026-11-15', total_amount: 412.5, record_status: 'active' }];
  var p4 = await N.prepareCategorize(dbA, LINE, EXP, ctx(EXP));
  check('open KTC bill same vendor + amount within 10 days → proposed for attaching', p4.ok && p4.payload.attach_bill_id === 'RENT1');
  dbA.t.company_bill_links = [{ bill_id: 'RENT1', status: 'active', source_bank_transaction_id: 'OTHER' }];
  var p5 = await N.prepareCategorize(dbA, LINE, EXP, ctx(EXP));
  check('… not when another line already has it', p5.ok && !p5.payload.attach_bill_id);
  var dbX = newDb(); dbX.fail.vendor_bills = { select: 'boom' };
  var p6 = await N.prepareCategorize(dbX, LINE, EXP, ctx(EXP));
  check('cannot read KTC bills → refused before anything is written', !p6.ok && /nothing changed/.test(p6.error));
  var dbR = newDb(); dbR.rpcs.hub_company_categorize = function () { return { data: null, error: { message: 'HUB_GUARD: KTC bill X made from this line already has money recorded on it — undo that payment first, then change the category.' } }; };
  var c1 = await N.categorizeLine(dbR, LINE, TRF, ctx(TRF));
  check('a refusal from the database is reported plainly, and says nothing was changed', !c1.ok && /undo that payment/.test(c1.error) && /Nothing was changed/.test(c1.error));
  dbR.rpcs.hub_company_categorize = function () { return { data: null, error: { code: '23505', message: 'duplicate key' } }; };
  var c2 = await N.categorizeLine(dbR, LINE, EXP, ctx(EXP));
  check('two people at once → the second is told to refresh, nothing changed', !c2.ok && /same moment/.test(c2.error));
  dbR.rpcs.hub_company_categorize = function () { return { data: { ok: true, action: 'created', bill_id: 'B1', bill_number: 'NXT-1' }, error: null }; };
  var c3 = await N.categorizeLine(dbR, LINE, EXP, ctx(EXP));
  check('success → the action and bill come back', c3.ok && c3.action === 'created' && c3.bill_id === 'B1');
  var lib = fs.readFileSync(path.join(root, 'src/lib/nextrade-bills-server.js'), 'utf8');
  check('no step-by-step writes left in the server code (only the one database call)', lib.indexOf("from('vendor_bills').insert") < 0 && lib.indexOf("from('company_bill_links').insert") < 0 && lib.indexOf("from('company_bill_links').update") < 0 && lib.indexOf("db.rpc('hub_company_categorize'") >= 0);

  // ── wiring ──
  var route = fs.readFileSync(path.join(root, 'src/app/api/accounting/company-books/route.js'), 'utf8');
  var sql = fs.readFileSync(path.join(root, 'sql/v55-83-TW-company-books.sql'), 'utf8');
  var acct = fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8');
  var bills = fs.readFileSync(path.join(root, 'src/components/BillsTab.jsx'), 'utf8');
  var si = fs.readFileSync(path.join(root, 'src/app/api/accounting/statement-import/route.js'), 'utf8');
  var pull = fs.readFileSync(path.join(root, 'src/app/api/wave/sync-pull/route.js'), 'utf8');
  check('route: every action for the verified signed-in person', /verifiedCaller\(req, body, createClient\)/.test(route));
  check('route: company required, never defaulted', /companyByKey\(body\.company\)/.test(route) && /Say which company/.test(route));
  check('route: view / manage permission per company', /comp\.managePerm : comp\.viewPerm/.test(route));
  check('route: category + KTC bill go through the one database function (no separate category write)', route.indexOf('categorizeLine(db, line') >= 0 && route.indexOf("from('bank_transactions').update({ company_category") < 0 && route.indexOf('hub_company_books_installed') >= 0);
  check('route: lines must belong to the company', /are not ' \+ comp\.label \+ ' lines/.test(route));
  check('route: payroll shown as "Warehouse staff"', /'Warehouse staff'/.test(route));
  check('route: private bank accounts (live TP) hidden and never changed unless allowed; fails closed', route.indexOf('privateScope(db, userId)') >= 0 && route.indexOf('dropPrivate(pl.data, scope)') >= 0 && route.indexOf('isPrivateRow(l, scope)') >= 0 && route.indexOf('nothing shown') >= 0);
  check('route: SWC-safe, no deletes', route.indexOf('`') < 0 && !/=>/.test(route) && route.indexOf('.delete(') < 0);
  check('SQL: one link per Nextrade line; own categories + rules; registry rows; additive', /company_bill_links_one_per_line/.test(sql) && /CREATE TABLE IF NOT EXISTS public\.company_categories/.test(sql) && /CREATE TABLE IF NOT EXISTS public\.company_rules/.test(sql) && /NEXTRADE_BOOKS/.test(sql) && !/drop table|delete from/i.test(sql));
  check('SQL: money from KTC seeded as a transfer', /'money_from_ktc',\s+'Money from KTC \(transfer in\)',\s+'transfer'/.test(sql));
  check('Accounting has 🟦 Nextrade and 🟪 RTM tabs, gated per company', /\['nextrade', '🟦 Nextrade'\]/.test(acct) && /company\.rtm\.view/.test(acct));
  check('Bills has the 🟦 Nextrade bills section', /NextradeBillsPanel/.test(bills));
  check('statement import: company required (no silent KTC), credit cards allowed', /Pick the company this account belongs to/.test(si) && /isCardM \? 'credit'/.test(si) && si.indexOf('body.wave_business_id || US_WAVE_BUSINESS_ID') < 0);
  check('Wave pull skips Nextrade / RTM', /NEXTRADE_BOOKS/.test(pull));

  console.log('\nTW company books: ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
