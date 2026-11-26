// v55.83-ZK — Max, 26 Nov 2026 (Profitability → P&L by period → a category's bank lines): "i changed the category here and it does not
// SAVE! it needs to save and automatically update the numbers". The audit trail showed the save ran twice with the SAME category
// the line already had, and the screen answered "Category saved". The menu always read "change category…", so the person could
// not see what the line was in. Now the menu shows it, the same pick saves nothing and says so, and a change names from / to.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
console.log('ZK — the category menu shows the current category; the same pick is not called saved');

var C = require(path.join(root, 'src/lib/cat-picker-state.js'));
var D = require(path.join(root, 'src/lib/pnl-expense-detail.js'));
var LIST = [{ key: 'returned_checks', label: 'Returned checks', active: true }, { key: 'bank_charges', label: 'Bank Charges', active: true }, { key: 'old_one', label: 'Old one', active: false }, { key: 'needs_clarification', label: 'Needs clarification', active: true }];

check('1: a line under Returned checks → the menu shows "Returned checks" as selected', C.currentCategoryOf({ id: 'a', category: 'returned_checks' }, LIST) === 'returned_checks');
check('2: no category, an unknown one, a switched-off one, or the report\'s own made-up groups → nothing selected (the "change category…" line shows)', ['', undefined, 'uncategorized', '__party_money_back', 'old_one', 'needs_clarification'].every(function (k) { return C.currentCategoryOf({ id: 'a', category: k }, LIST) === ''; }));
check('3: Max\'s case — picking "Returned checks" on a line already under it is the SAME pick', C.samePick({ id: 'a', category: 'returned_checks' }, 'returned_checks', LIST) === true);
check('4: picking a different category is not', C.samePick({ id: 'a', category: 'returned_checks' }, 'bank_charges', LIST) === false && C.samePick({ id: 'a', category: '' }, 'bank_charges', LIST) === false && C.samePick({ id: 'a' }, 'bank_charges', LIST) === false);
check('5: labels come from the list; an unknown key is shown as it is', C.categoryLabel('bank_charges', LIST) === 'Bank Charges' && C.categoryLabel('zzz', LIST) === 'zzz' && C.categoryLabel('', LIST) === '');
check('6: the list still loads before it is known (empty list → nothing selected, no crash)', C.currentCategoryOf({ id: 'a', category: 'returned_checks' }, null) === '' && C.samePick({ id: 'a', category: 'returned_checks' }, 'returned_checks', null) === false);

// the expense detail hands each bank line its own category
var fn = Object.keys(D).map(function (k) { return D[k]; }).filter(function (f) { return typeof f === 'function'; })[0];
var src = read('src/lib/pnl-expense-detail.js');
check('7 (source): every bank line in the breakdown carries the category it is listed under', src.indexOf("push({ id: r.id || null, category: k /* v55.83-ZK") > 0 && typeof fn === 'function');

var tab = read('src/components/ProfitabilityTab.jsx');
check('8 (source): the menu is set to the line\'s category, with a tooltip saying where it is now', tab.indexOf('var curK = currentCategoryOf(row, catList);') > 0 && tab.indexOf('<select value={curK} title={curK ? \'Now under: \' + categoryLabel(curK, catList) : \'No category chosen yet\'}') > 0);
check('9 (source): "change category…" shows only when the line has no category', tab.indexOf('{!curK && <option value="">change category…</option>}') > 0 && tab.indexOf('<select value="" aria-label={\'Change the category of \'') < 0);
check('10 (source): the same pick sends NOTHING to the server and says so — it comes before the save', tab.indexOf("if (samePick(row, key, catList)) { toast.error('This line is already under “'") > 0 && tab.indexOf('samePick(row, key, catList)') < tab.indexOf("erApi('bulk_classify', { ids: [row.id], classification: key, single_pick: true })") && /samePick\(row, key, catList\)\) \{ toast\.error\([^\n]*Nothing was changed[^\n]*\); return; \}/.test(tab));
check('11 (source): a real change names where the line came from and went to, and the numbers are loaded again', tab.indexOf("toast.success('Saved: moved ' + (fromLbl ? 'from “' + fromLbl + '” ' : '') + 'to “' + toLbl + '”'") > 0 && /Saved: moved [\s\S]{0,420}startExpenses\(\{ ignoreCache: true \}\)/.test(tab) && tab.indexOf("toast.success('Category saved'") < 0);
check('12 (source): removing a category and the undo point are untouched', tab.indexOf("erApi('clear_category', { ids: [row.id], confirm: true })") > 0 && tab.indexOf('setUndoPt(j.undo_id ?') > 0 && tab.indexOf('<option value="__remove__">✕ remove category (back to Uncategorized)</option>') > 0);
var page = read('src/app/page.jsx'); var wn = read('src/components/WhatsNewWidget.jsx');
check('13: What\'s New has the ZK entry and the badge names the newest entry on top', wn.indexOf("version: 'v55.83-ZK'") > 0 && (function () { var top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]{2}(?:\.\d+)?)'/.exec(wn); return !!top && page.indexOf('>' + top[1] + '</span>') > 0; })());
console.log('\nZK: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
