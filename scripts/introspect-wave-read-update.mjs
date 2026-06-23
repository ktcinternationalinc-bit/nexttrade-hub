// COMMITTED PROOF (Codex-required): can Wave's PUBLIC API read an existing money transaction and
// update/categorize it? Re-run any time with a live WAVE_ACCESS_TOKEN in .env.local.
// Result (2026-06-23): NO. Money transactions are CREATE-ONLY — see WAVE_API_TRANSACTION_EVIDENCE.md §0-PREMISE.
//   - Root Query: no transaction entry point.
//   - Business + Account: no `transactions` / `moneyTransactions` connection.
//   - Transaction OBJECT: only field is `id`.
//   - Mutations: only moneyTransactionCreate / moneyTransactionsCreate / MoneyDepositTransactionCreate (create).
//   - The only readable "transactionId"s are on InvoicePayment / EstimatePayment (the invoice/payment lane).
// Schema introspection works even with an expired data token; data queries need a live token.
import fs from 'fs';
var env = '';
try { env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); } catch (e) { console.log('no .env.local'); }
var tok = (env.match(/WAVE_ACCESS_TOKEN\s*=\s*"?([^"\r\n]+)"?/) || [])[1];
var URL_ = 'https://gql.waveapps.com/graphql/public';
async function gql(q, v) { var r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (tok || '') }, body: JSON.stringify({ query: q, variables: v || {} }) }); return r.json(); }
function retName(t) { if (!t) return ''; return t.name || (t.ofType ? (t.ofType.name || (t.ofType.ofType ? t.ofType.ofType.name : '')) : ''); }

var full = await gql('query{ __schema{ types{ name kind fields{ name type{ name kind ofType{ name kind ofType{ name } } } } inputFields{ name } } } }');
var types = (((full.data || {}).__schema) || {}).types || [];
if (full.errors) { console.log('ERR ' + JSON.stringify(full.errors).slice(0, 300)); }
console.log('TOTAL TYPES: ' + types.length);

console.log('\n=== FIELDS mentioning "transaction" ===');
var hits = 0;
types.forEach(function (t) { (t.fields || []).forEach(function (f) { var rn = retName(f.type); if (/transaction/i.test(f.name) || /transaction/i.test(rn)) { console.log('  ' + t.name + '.' + f.name + ' -> ' + (rn || (f.type && f.type.kind))); hits++; } }); });
if (!hits) console.log('  (none)');

console.log('\n=== Business + Account fields (look for a transactions connection) ===');
['Business', 'Account'].forEach(function (n) { var t = types.filter(function (x) { return x.name === n; })[0]; console.log('  ' + n + ': ' + (t ? (t.fields || []).map(function (f) { return f.name; }).join(', ') : 'NOT FOUND')); });

console.log('\n=== Transaction-returning fields (read paths) ===');
var rh = 0;
types.forEach(function (t) { (t.fields || []).forEach(function (f) { var rn = retName(f.type); if (/^Transaction$|^MoneyTransaction|^AccountTransaction/.test(rn)) { console.log('  ' + t.name + '.' + f.name + ' -> ' + rn); rh++; } }); });
if (!rh) console.log('  (none — nothing in the schema returns a Transaction except create-mutation outputs)');

// Codex correction: print the EXACT root Mutation field list so the evidence only names real mutations
// (MoneyDepositTransaction* appear as TYPES in the schema but are NOT necessarily root mutation fields).
console.log('\n=== ROOT MUTATION fields (the only callable mutations) ===');
var mt = await gql('query{ __schema{ mutationType{ fields{ name } } } }');
var muts = (((mt.data || {}).__schema || {}).mutationType || {}).fields || [];
console.log('  ' + muts.map(function (f) { return f.name; }).join(', '));
console.log('  money/transaction root mutations: ' + muts.map(function (f) { return f.name; }).filter(function (n) { return /money|transaction/i.test(n); }).join(', '));
