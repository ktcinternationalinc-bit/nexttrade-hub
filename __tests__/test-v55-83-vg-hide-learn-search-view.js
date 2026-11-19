// v55.83-VG (Max, Nov 19 2026) — three asks:
//   "IF I HIDE SOMETHING IT SHOULD BE ABLE TO LEARN AND HIDE ALL OTHER ITEMS WITH THE SAME WORD DESCRIPTIONS"   (Egypt Bank)
//   "need a search on this page"                                                                               (Profitability)
//   "i should be able to click on the view invoice and see a copy of the invoice and edit it from there"       (Profitability)
// Real pure functions + screen wiring.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var H = require(path.join(root, 'src/lib/egypt-bank-hide-learn.js'));
var Q = require(path.join(root, 'src/lib/profitability-search.js'));
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
console.log('VG — hide one and learn · Profitability search · view invoice');

// ── 1. the words that repeat (descriptions from Max's real October statement)
check('"Outward Swift Charges FT26277RSPSR\\BNK AC-100055915096" → "Outward Swift Charges"', H.hidePhraseFrom('Outward Swift Charges FT26277RSPSR\\BNK AC-100055915096') === 'Outward Swift Charges');
check('"IPN Inward FT2627413HZ4\\BNK PayerMobNo:… Name: HOSSAM" → "IPN Inward"; "Commission Paid CHG26278RGW0J\\G06" → "Commission Paid"; "Credit Interest 100055915096-20261031" → "Credit Interest"',
  H.hidePhraseFrom('IPN Inward FT2627413HZ4\\BNK PayerMobNo:00201065005998 Payer Name: HOSSAM') === 'IPN Inward' && H.hidePhraseFrom('Commission Paid CHG26278RGW0J\\G06') === 'Commission Paid' && H.hidePhraseFrom('Credit Interest 100055915096-20261031') === 'Credit Interest');
check('extra spaces and a trailing dash / colon are cleaned: "  Fees   Account Transfer -  FT26302KV8GS" → "Fees Account Transfer"', H.hidePhraseFrom('  Fees   Account Transfer -  FT26302KV8GS\\BNK') === 'Fees Account Transfer');
check('an Arabic description keeps its words up to the first number', H.hidePhraseFrom('تحويل راتب شهر 10 موظف') === 'تحويل راتب شهر');
check('a description that STARTS with a reference → the whole description (only identical ones would match)', H.hidePhraseFrom('FT26100029985727 transfer') === 'FT26100029985727 transfer');
check('empty / null → nothing', H.hidePhraseFrom('') === '' && H.hidePhraseFrom(null) === '' && H.hidePhraseFrom('   ') === '');
check('fewer than 3 letters is never usable (it would hide far too much): "ab", " a  b ", "" no; "abc", "IPN Inward" yes', !H.hidePhraseUsable('ab') && !H.hidePhraseUsable(' a  b ') && !H.hidePhraseUsable('') && H.hidePhraseUsable('abc') && H.hidePhraseUsable('IPN Inward'));
var tx = [{ id: 1, description: 'Outward Swift Charges FT1\\BNK', hidden: false }, { id: 2, description: 'OUTWARD  SWIFT CHARGES FT2\\BNK', hidden: false }, { id: 3, description: 'Outward Swift Charges FT3', hidden: true },
  { id: 4, description: 'Outward FT4\\BNK', hidden: false }, { id: 5, description: 'IPN Inward FT5', hidden: false }, { id: 6, description: null }];
check('counting the OTHERS: capitals and double spaces ignored, the clicked one and already-hidden ones not counted (1 of 3)', H.countHideMatches(tx, 'Outward Swift Charges', [1]) === 1, H.countHideMatches(tx, 'Outward Swift Charges', [1]));
check('a wider phrase counts more ("Outward" → 3 not hidden), an unusable phrase counts none', H.countHideMatches(tx, 'outward', []) === 3 && H.countHideMatches(tx, 'ou', []) === 0 && H.countHideMatches(null, 'outward', []) === 0);
var rule = H.hideRuleFor('  Outward   Swift Charges ', 'u1');
check('the rule that is saved: PRIVATE, hides only (no category), matches the words, active, named "Hide: …"', rule.is_private === true && rule.set_hidden === true && rule.set_category === null && rule.match_description === 'Outward Swift Charges' && rule.match_amount === null && rule.match_account_id === null && rule.active === true && rule.rule_name === 'Hide: Outward Swift Charges' && rule.created_by === 'u1', rule);
check('the question says how many others, that new imports follow, and that Cancel hides only this one', (function () { var t = H.hideLearnQuestion('Outward Swift Charges', 7); return /7 others on screen now/.test(t) && /new ones as they are imported/.test(t) && /Cancel to hide only this one/.test(t) && /1 other on screen/.test(H.hideLearnQuestion('x', 1)); })());
var eb = read('src/components/EgyptBankTab.jsx');
check('Egypt Bank: helper imported (runtime import present)', /import \{ hidePhraseFrom, hidePhraseUsable, countHideMatches, hideLearnQuestion, hideRuleFor \} from '\.\.\/lib\/egypt-bank-hide-learn';/.test(eb));
check('Egypt Bank: asked only when HIDING (not when un-hiding), after the clicked one is hidden', eb.indexOf("if (!isHidden) { await learnHideFrom(t.description, [t.id]); }") > 0 && eb.indexOf("await dbUpdate('egypt_bank_transactions', t.id, { hidden: !isHidden }, myId);") < eb.indexOf("if (!isHidden) { await learnHideFrom(t.description, [t.id]); }"));
check('Egypt Bank: several selected → asked once and only when they all share the same words', eb.indexOf('if (picked.length && phrases.length === 1) { await learnHideFrom(picked[0].description, ids); }') > 0);
check('Egypt Bank: only the super admin can learn; no question when those words are already a hide rule; Cancel learns nothing', eb.indexOf('if (!canManagePrivateRules) return;') > 0 && eb.indexOf('if (already) return;') > 0 && eb.indexOf('if (typed === null) return;') > 0);
check('Egypt Bank: the learned rule goes through the SAME rules table and the SAME apply step as a rule made by hand', eb.indexOf("supabase.from('egypt_bank_rules').insert(hideRuleFor(phrase, myId)).select().single()") > 0 && eb.indexOf('await applyRules({ ruleId: data.id });') > 0);
check('Egypt Bank: a failure to save says plainly that only the clicked one is hidden', /The rule could not be saved, so only the one you clicked is hidden/.test(eb));

// ── 2. Profitability search
var rows = [
  { key: 'a', label: 'AMERICA 1827', invoice: { number: 'AMERICA 1827', date: '2026-10-07', customer: 'ELITE PAPER', basis: 'CNF', releases: [{ raw: '1002-1202', key: '10021202' }] }, release_list: ['10021202'], name_list: ['FOLDS WITH FABRICS BY TONS'] },
  { key: 'b', label: 'AMERICA 1756', invoice: { number: 'AMERICA 1756', date: '2026-10-06', customer: 'FADI ALSARAG', basis: 'EXW', releases: [{ raw: '1002-1166', key: '10021166' }] }, release_list: ['10021166'], name_list: ['FORTIS MATERIAL BY TONS'] },
  { key: 'c', label: 'AMERICA 1818', invoice: { number: 'AMERICA 1818', date: '2026-10-06', customer: 'Freiman Coated Fabrics', basis: null, releases: [{ raw: '1001-1642', key: '10011642' }] }, release_list: ['10011642'], name_list: ['Coated fabric'] },
  { key: 'g:1', label: 'Stock Paper', release_list: ['10021202', '10021188'], name_list: ['Stock Release Paper per Ton', 'Texas Paper (LBS)'] }];
function keys(q) { return Q.filterRowsBySearch(rows, q).map(function (r) { return r.key; }).join(','); }
check('empty search shows every row (same array back)', Q.filterRowsBySearch(rows, '') === rows && Q.filterRowsBySearch(rows, '   ') === rows && keys('') === 'a,b,c,g:1');
check('by invoice number: "1827" → AMERICA 1827', keys('1827') === 'a');
check('by customer, capitals ignored: "fadi" → AMERICA 1756; "elite paper" → AMERICA 1827', keys('fadi') === 'b' && keys('ELITE paper') === 'a');
check('by release, with or without the dash: "1001-1642" and "10011642" → AMERICA 1818', keys('1001-1642') === 'c' && keys('10011642') === 'c');
check('a product row is found by a release it sold on, typed with the dash: "1002-1188" → Stock Paper', keys('1002-1188') === 'g:1');
check('by an original description merged into a product: "texas" → Stock Paper', keys('texas') === 'g:1');
check('several words must ALL match: "2026-10-06 fadi" → only AMERICA 1756; "fadi elite" → nothing', keys('2026-10-06 fadi') === 'b' && keys('fadi elite') === '');
check('by pricing basis and by date: "exw" → 1756; "2026-10-06" → 1756 and 1818', keys('exw') === 'b' && keys('2026-10-06') === 'b,c');
check('nothing matches → empty list; null rows → empty list, no crash', keys('zzzz') === '' && Q.filterRowsBySearch(null, 'x').length === 0 && Q.rowMatchesSearch(null, 'x') === false);
var pt = read('src/components/ProfitabilityTab.jsx');
check('Profitability: search imported (runtime import present) and applied to the rows that are SHOWN only', /import \{ filterRowsBySearch \} from '\.\.\/lib\/profitability-search';/.test(pt) && pt.indexOf('var rows = filterRowsBySearch(rowsAll, searchQ);') > 0);
check('Profitability: the totals are never fed from the filtered rows, and the page says so while a search is on', pt.indexOf("shown — the totals above are for ALL rows") > 0 && !/summarize\(filterRowsBySearch/.test(pt));
check('Profitability: search box on By product / By customer / By invoice, with a clear button', pt.indexOf("(view === 'product' || view === 'customer' || view === 'invoice') &&") > 0 && pt.indexOf('placeholder="🔎 Search invoice, customer, release, product…"') > 0 && pt.indexOf("setSearchQ('');") > 0);

// ── 3. view invoice
check('Profitability: every invoice row has "view invoice"; the click does not also expand the row', pt.indexOf('🧾 view invoice</button>') > 0 && pt.indexOf('onClick={function (e) { e.stopPropagation(); setPeekId(r.invoice.id); }}') > 0);
check('Profitability: it opens the shared invoice pop-up (runtime import present)', /import InvoicePeek from '\.\/InvoicePeek';/.test(pt) && pt.indexOf('<InvoicePeek invoiceId={peekId}') > 0 && pt.indexOf('{peekId && ') > 0); // v55.83-VQ: mounted on the page body, above full screen
check('Profitability: Edit hands the invoice to the Invoices screen exactly like Stats does (same event, then go to invoices), leaving full screen first', pt.indexOf("window.dispatchEvent(new CustomEvent('nt-open-invoice-edit', { detail: id2 }))") > 0 && pt.indexOf("setPeekId(null); setFull(false); onGo('invoices');") > 0);
var at = read('src/components/AccountingTab.jsx'); var inv = read('src/components/AccountingInvoicesTab.jsx'); var peek = read('src/components/InvoicePeek.jsx');
check('Accounting gives Profitability the navigation it needs; the Invoices screen listens for that event; the pop-up shows Edit when given onEdit', at.indexOf('<ProfitabilityTab {...props} onGo={goFrom} />') > 0 && inv.indexOf("window.addEventListener('nt-open-invoice-edit', onEvt);") > 0 && /props\.onEdit && <button/.test(peek));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
