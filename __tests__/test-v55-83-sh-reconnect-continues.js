// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SH — Max, Nov 12 10:30: "the sync is NOT working. figure it out. and also it should give me an option only to sync
//  from last date if i reconnect from that is seen on hub (last previous transaction) .. not bring all of it again if i
//  reconnect"
// Found: (1) a reconnected bank's first sync pulled the whole history window again; (2) the scheduled sync skipped the
// production books entirely. Fixed: a link that never finished a sync continues from the newest transaction the Hub already
// shows for the same real accounts; the overlap days are not doubled; the scheduled sync includes production.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var MemDB = require('./helpers/memdb-wires.js');
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var C = require(path.join(root, 'src/lib/bank-continue.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 500))); }
console.log('SH — a reconnected bank continues from the last transaction on the Hub');
(async function () {
  var db = new MemDB({
    bank_connections: [{ id: 'old', institution_name: 'Chase', status: 'active' }, { id: 'new', institution_name: 'Chase', status: 'active' }, { id: 'arch', institution_name: 'Chase', status: 'archived' }, { id: 'pnc', institution_name: 'PNC', status: 'active' }, { id: 'fresh', institution_name: 'M&T Bank', status: 'active' }],
    plaid_accounts: [{ plaid_account_id: 'old-6338', mask: '6338', connection_id: 'old' }, { plaid_account_id: 'new-6338', mask: '6338', connection_id: 'new' }, { plaid_account_id: 'arch-6338', mask: '6338', connection_id: 'arch' },
      { plaid_account_id: 'pnc-6338', mask: '6338', connection_id: 'pnc' }, { plaid_account_id: 'mt-8303', mask: '8303', connection_id: 'fresh' }],
    bank_transactions: [{ id: 't1', account_id: 'old-6338', date: '2026-10-20' }, { id: 't2', account_id: 'old-6338', date: '2026-11-04' }, { id: 't3', account_id: 'arch-6338', date: '2026-11-09' }, { id: 't4', account_id: 'pnc-6338', date: '2026-11-10' }],
  });
  var a = await C.hubNewestForConnection(db, { id: 'new' });
  check('1: reconnected Chase ••6338 → continue from 2026-11-04, the newest line the Hub shows for that account', a.date === '2026-11-04' && a.others.length === 1 && a.others[0] === 'old-6338', a);
  check('2: an ARCHIVED duplicate link is not counted (its lines are not shown), and another bank with the same last-4 is never mixed in', a.others.indexOf('arch-6338') < 0 && a.others.indexOf('pnc-6338') < 0);
  var b = await C.hubNewestForConnection(db, { id: 'fresh' });
  check('3: a bank that was never on the Hub has nothing to continue from → the normal first pull', b.date === null && b.others.length === 0, b);
  var T = R('src/app/api/plaid/transactions/route.js');
  check('4: the sync uses it only when no start date was asked for and the link has no finished sync — and backs up 7 days for late postings', T.indexOf('if (!effStart && hn.date) { continuedFrom = hn.date; effStart = new Date(new Date(hn.date).getTime() - OVERLAP_DAYS * 86400000)') > 0 &&
    T.indexOf('hubNewestForConnection(supabase, conn)') < T.indexOf('if (!effStart && conn.initial_backfill_start_date)') && T.indexOf('if (!effStart && conn.last_successful_posted_date)') < T.indexOf('hubNewestForConnection(supabase, conn)'));
  check('5: the overlap days are not doubled — lines already on the Hub from the older link are counted like CSV twins', T.indexOf("var seenRows = ((!manQ.error && manQ.data) || []).concat(oldRows);") > 0 && T.indexOf("otherTwinAccts.filter(function (x) { return !mdAccts[x]; })") > 0);
  check('6: the answer says so: "Continued from the last transaction already on the Hub … the full history was NOT pulled again"', T.indexOf('continued_from: continuedFrom') > 0 && R('src/components/BankTab.jsx').indexOf('Continued from the last transaction already on the Hub (') > 0);
  check('7: the full history is still available on purpose — ⏬ Re-pull history sends an explicit start date, which wins', T.indexOf('var effStart = start_date || null;') > 0 && R('src/components/BankTab.jsx').indexOf('⏬ Re-pull history') > 0);
  check('8: the scheduled sync (every 2 hours) now includes the production books — it used to skip them', /"path": "\/api\/plaid\/sync\?includeProduction=true"/.test(R('vercel.json')) && R('src/app/api/plaid/sync/route.js').indexOf("searchParams.get('includeProduction') === 'true'") > 0);
  check('9: the sync has a full minute (it had no limit of its own)', T.indexOf('export var maxDuration = 60;') > 0);
  console.log('\n' + pass + ' passed, ' + failN + ' failed'); if (failN) { process.exit(1); }
})().catch(function (e) { console.error(e); process.exit(1); });
