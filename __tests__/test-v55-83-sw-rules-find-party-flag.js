// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SW — Max, Nov 16 2026: "need to add in category and rules.. ability to find a description and to also
// select not only expense but if it is RTM or NEXTRADE flag"
// Standing rules: a rule only ever FILLS A BLANK (never a person's pick); nothing is deleted; var-only server code.
// The marking engine is RUN against a small in-memory table. Checks marked (pin) read the source.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service';
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }

// a very small stand-in for the database: only what the marking engine calls
function fakeDb(rows, log) {
  return { from: function (t) {
    var st = { filters: [], upd: null, range: null };
    function match(r) {
      for (var i = 0; i < st.filters.length; i++) {
        var f = st.filters[i];
        if (f[1] === 'wave_business_id') { continue; }
        if (f[0] === 'eq' && r[f[1]] !== f[2]) { return false; }
        if (f[0] === 'is' && f[2] === null && r[f[1]] != null) { return false; }
        if (f[0] === 'in' && f[2].indexOf(r[f[1]]) < 0) { return false; }
      }
      return true;
    }
    function run() {
      if (t !== 'bank_transactions') { if (st.ins) { log.push({ table: t, row: st.ins }); } return { data: [], error: null }; }
      var out = rows.filter(match);
      if (st.upd) { out.forEach(function (r) { Object.assign(r, st.upd); }); return { data: out.map(function (r) { return { id: r.id }; }), error: null }; }
      if (st.range) { out = out.slice(st.range[0], st.range[1] + 1); }
      return { data: out, error: null };
    }
    var q = {
      select: function () { return q; }, order: function () { return q; }, limit: function () { return q; }, not: function () { return q; }, or: function () { return q; }, maybeSingle: function () { return q; },
      eq: function (k, v) { st.filters.push(['eq', k, v]); return q; }, is: function (k, v) { st.filters.push(['is', k, v]); return q; }, in: function (k, v) { st.filters.push(['in', k, v]); return q; },
      range: function (a, b) { st.range = [a, b]; return q; }, update: function (o) { st.upd = o; return q; }, insert: function (o) { st.ins = o; return q; },
      then: function (res, rej) { try { res(run()); } catch (e) { if (rej) { rej(e); } } }
    };
    return q;
  } };
}

(async function () {
  console.log('SW — find a description; a rule can mark a line as sent to RTM / NextTrade');
  var E = require(path.join(root, 'src/lib/expense-rules.js'));
  var Sv = require(path.join(root, 'src/lib/expense-rules-server.js'));

  // A. the marking engine
  var rows = [
    { id: 't1', direction: 'out', name: 'WIRE OUT RTM CAPITAL LLC', merchant_name: '', third_party_payer: null, transfer_group_id: null, review_status: null, classification: null },
    { id: 't2', direction: 'out', name: 'Wire Out  Rtm-Capital', merchant_name: '', third_party_payer: null, transfer_group_id: null, review_status: 'reviewed', classification: 'professional_fees' },
    { id: 't3', direction: 'in', name: 'WIRE IN RTM CAPITAL REFUND', merchant_name: '', third_party_payer: null, transfer_group_id: null, review_status: null, classification: null },
    { id: 't4', direction: 'out', name: 'RTM CAPITAL', merchant_name: '', third_party_payer: 'NextTrade Industries', transfer_group_id: null, review_status: null, classification: null },
    { id: 't5', direction: 'out', name: 'RTM CAPITAL internal move', merchant_name: '', third_party_payer: null, transfer_group_id: 'g1', review_status: null, classification: null },
    { id: 't6', direction: 'out', name: 'SHELL OIL 5544', merchant_name: 'Shell', third_party_payer: null, transfer_group_id: null, review_status: null, classification: null }
  ];
  var log = [];
  var res = await Sv.applyPartyFlag(fakeDb(rows, log), { id: 'r1', match_text: 'rtm capital', third_party_payer: 'RTM Capital' }, null);
  var by = {}; rows.forEach(function (r) { by[r.id] = r; });
  check('A1: money-out lines whose description contains the text are marked as sent to the company', res.flagged === 2 && by.t1.third_party_payer === 'RTM Capital' && by.t2.third_party_payer === 'RTM Capital', res);
  check('A2: punctuation and spacing never decide a match ("Rtm-Capital")', by.t2.third_party_payer === 'RTM Capital');
  check('A3: money IN is never marked', by.t3.third_party_payer === null);
  check('A4: a line a person already marked for another company is NOT changed', by.t4.third_party_payer === 'NextTrade Industries');
  check('A5: a transfer between our own accounts is never marked', by.t5.third_party_payer === null);
  check('A6: a line that does not contain the text is untouched', by.t6.third_party_payer === null);
  check('A7: marking does not touch the category of a line', by.t1.classification === null && by.t2.classification === 'professional_fees');
  var again = await Sv.applyPartyFlag(fakeDb(rows, []), { id: 'r1', match_text: 'rtm capital', third_party_payer: 'RTM Capital' }, null);
  check('A8: running it again changes nothing (only blanks are filled)', again.flagged === 0, again);
  var none = await Sv.applyPartyFlag(fakeDb(rows, []), { id: 'r2', match_text: 'shell oil', third_party_payer: '' }, null);
  check('A9: a rule with no company marks nothing', none.flagged === 0 && by.t6.third_party_payer === null);

  // B. a flag-only rule never suggests a CATEGORY
  var flagOnly = { id: 'f', match_text: 'nexttrade industries wire', classification: null, third_party_payer: 'NextTrade Industries', active: true };
  var catRule = { id: 'c', match_text: 'nexttrade', classification: 'professional_fees', active: true };
  check('B1: the category matcher skips a rule that has no category (even when its text is more specific)', E.bestRule([flagOnly, catRule], 'NEXTTRADE INDUSTRIES WIRE 1001').id === 'c');
  check('B2: with only a flag-only rule there is no category suggestion', E.bestRule([flagOnly], 'NEXTTRADE INDUSTRIES WIRE 1001') === null);

  // C. (pin) server
  var er = R('src/app/api/accounting/expense-rules/route.js'); var srv = R('src/lib/expense-rules-server.js');
  check('C1 (pin): save_rule accepts a category, a company, or both — and refuses neither', /if \(!p\.classification && !payerName\)/.test(er) && /classification: p\.classification \|\| null/.test(er) && /if \(hasFlagField\) \{ patch\.third_party_payer = payerName; \}/.test(er));
  check('C2 (pin): the company must be a registered paid-through company', /Unknown company/.test(er) && /loadRuleParties\(db\)/.test(er));
  check('C3 (pin): the list sends the companies and still loads before the SQL is run', /parties: await loadRuleParties\(db\), flag_ready: flagReady/.test(er) && /flagReady = false;/.test(er));
  check('C4 (pin): the test / preview says how many lines would be marked', /would_flag: wouldFlag/.test(er) && /partyFlagRows\(db, mtxt\)/.test(er));
  check('C5 (pin): the 15-minute job gives categories only from rules that have one, then runs the company rules (most specific first)', /var catRules = rules\.filter\(function \(r\) \{ return !!r\.classification; \}\);/.test(srv) && /bestRule\(catRules, rowText\(t\)\)/.test(srv) && /var flagRules = rules\.filter\(function \(r\) \{ return !!r\.third_party_payer; \}\)\.sort/.test(srv));
  check('C6 (pin): the mark re-checks "still blank, still money out" at write time and is written to the audit trail', /\.is\('third_party_payer', null\)\.eq\('direction', 'out'\)\.select\('id'\)/.test(srv) && /rule_flagged_paid_through/.test(srv));
  check('C7 (pin): before the SQL is run the job behaves exactly as before', /SW SQL not run yet → exactly as before/.test(srv));
  var sql = R('sql/v55-83-SW-rule-party-flag.sql');
  check('C8 (pin): the SQL only adds — a column, a relaxed NOT NULL, and "a rule must do at least one thing"', /ADD COLUMN IF NOT EXISTS third_party_payer text/.test(sql) && /ALTER COLUMN classification DROP NOT NULL/.test(sql) && /CHECK \(classification IS NOT NULL OR third_party_payer IS NOT NULL\)/.test(sql) && !/\bDELETE\b|\bTRUNCATE\b|DROP TABLE|DROP COLUMN/i.test(sql));

  // D. (pin) screen
  var ui = R('src/components/ExpenseRulesTab.jsx');
  check('D1 (pin): a Find box that narrows the rules by description, category or company', /🔎 Find/.test(ui) && /var shownRules = rules\.filter/.test(ui) && /String\(r0\.third_party_payer \|\| ''\)\)\.toLowerCase\(\)\.indexOf\(findKey\)/.test(ui));
  check('D2 (pin): "find it in the bank lines" shows the real descriptions, and one click turns a found text into a new rule', /find it in the bank lines/.test(ui) && /testRule\(null, findQ\)/.test(ui) && /for a new rule<\/button>/.test(ui));
  check('D3 (pin): a new rule can pick a category and / or "sent to" a company', /pick one, or both/.test(ui) && /Mark it as money we SENT TO/.test(ui) && /'🏢 sent to ' \+ x\.name/.test(ui) && /\(!nr\.classification && !nr\.third_party_payer\)/.test(ui));
  check('D4 (pin): the rules table shows the company, and editing a rule can change it', /Category \/ company/.test(ui) && /'🏢 sent to ' \+ r\.third_party_payer/.test(ui) && /third_party_payer: editRule\.third_party_payer \|\| ''/.test(ui));
  check('D5 (pin): until the SQL is run the company choice is switched off and says what to run', /disabled=\{!flagReady\}/.test(ui) && /sql\/v55-83-SW-rule-party-flag\.sql/.test(ui));
  check('D6 (pin): house rules in the new server code — var only, no template strings', !/\b(let|const)\s/.test(srv.substring(srv.indexOf('export async function partyFlagRows'))) && srv.substring(srv.indexOf('export async function partyFlagRows')).indexOf('`') < 0);
  // E. v55.83-SX — "make it user friendly": the companies are buttons you can always see, and the setup steps are on the screen
  check('E1 (pin): the new rule is two numbered steps in plain words', /➕ Make a new rule/.test(ui) && /1 · When the bank description contains/.test(ui) && /2 · Then do this — pick one, or both/.test(ui) && /Give it the category/.test(ui));
  check('E2 (pin): RTM / NextTrade are buttons that are always visible — never a greyed-out dropdown with jargon', /\(onP \? '✓ ' : ''\) \+ '🏢 ' \+ x\.name/.test(ui) && !/company mark — needs SQL/.test(ui));
  check('E3 (pin): when the one-time setup is missing, clicking a company shows the steps on the screen', /if \(!flagReady\) \{ setSqlHelp\(true\); return; \}/.test(ui) && /Not switched on yet — click for the one-time setup/.test(ui) && /One-time setup to turn on the RTM Capital \/ NextTrade Industries buttons/.test(ui) && /Open supabase\.com/.test(ui));
  check('E4 (pin): before saving, one sentence says exactly what the rule will do', /var ruleSummary = /.test(ui) && /This rule: every bank line containing/.test(ui) && /is marked as money sent to /.test(ui));
  var wn = R('src/components/WhatsNewWidget.jsx');
  check('D7 (pin): What’s New has v55.83-SW with one technical line; badge at SW or later; SX is listed', /version: 'v55\.83-SW'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-SW'"), wn.indexOf("version: 'v55.83-SV'"))) && />v55\.83-(?:S[W-Z]|[T-Z][A-Z]|AA[A-Z])<\/span>/.test(R('src/app/page.jsx')) && /version: 'v55\.83-SX'/.test(wn));

  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
})().catch(function (e) { console.log('CRASH', e && e.stack); process.exit(1); });
// v55.83-UB realign: badge letters now run past T (UA, UB …) — the badge checks accept T–Z
