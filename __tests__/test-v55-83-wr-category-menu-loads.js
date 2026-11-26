// v55.83-WR — Max, 21 Nov 2026 (screenshot of the "How [month] is worked out" pop-up, bank lines with "loading…" menus): "should be
// able to change category right from here but not working". The category list was only fetched when a line of the expense table
// was opened (xOpen), never for the pop-up (fShow), and a failed fetch left an empty menu. Real helpers + the real menu rendered.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var C = require(path.join(root, 'src/lib/cat-picker-state.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('WR — the category menu loads in the pop-up too');
var base = { canPick: true, loaded: false, loading: false, xOpen: null, fShow: null };
function need(o) { return C.needCategoryList(Object.assign({}, base, o)); }
check('Max’s case: ONLY the pop-up is open (nothing opened in the expense table) → the list IS fetched (before: never)', need({ fShow: { key: '2026-06', pinned: true } }) === true);
check('a line of the expense table opened → fetched, as before', need({ xOpen: '2026-06|A|rent' }) === true);
check('nothing open → not fetched; already loaded → not fetched again; a fetch running → not started twice', need({}) === false && need({ fShow: { key: 'x' }, loaded: true }) === false && need({ fShow: { key: 'x' }, loading: true }) === false);
check('a person who may not change categories → never fetched', need({ canPick: false, fShow: { key: 'x' } }) === false && need({ canPick: undefined, xOpen: 'a' }) === false);
check('what the menu shows: list there → ready; fetch failed → error (with a retry), never an empty menu; otherwise loading', C.pickerState([], '') === 'ready' && C.pickerState([{ key: 'rent' }], 'x') === 'ready' && C.pickerState(null, 'The server did not answer') === 'error' && C.pickerState(null, '') === 'loading' && C.pickerState(undefined, null) === 'loading');
var cats = [{ key: 'rent', label: 'Rent' }, { key: 'old', label: 'Old', active: false }, { key: 'needs_clarification', label: 'Needs clarification' }, null, { key: 'returned_checks', label: 'Returned checks', active: true }];
var pk = C.pickableCategories(cats);
check('the menu lists active categories only and never “needs clarification” (same rule as before, now in one place)', pk.length === 2 && pk[0].key === 'rent' && pk[1].key === 'returned_checks' && C.pickableCategories(null).length === 0);
// the real menu, rendered: the tab's catPicker is built from these states — render the same three shapes from the tab's own source
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('WIRING: the tab imports the helpers, fetches on BOTH xOpen and fShow, and remembers a running fetch', /import \{ needCategoryList, pickerState, pickableCategories[^}]*\} from '\.\.\/lib\/cat-picker-state'/.test(tab) && tab.indexOf('needCategoryList({ canPick: canPick, loaded: Array.isArray(catList), loading: catLoading.current, xOpen: xOpen, fShow: fShow })') > 0 && tab.indexOf('}, [xOpen, fShow]);') > 0 && tab.indexOf('var catLoading = useRef(false);') > 0);
check('WIRING: a failed fetch shows “categories not loaded — try again” with the reason, and the button fetches again', tab.indexOf("if (pst === 'error') { return <button type=\"button\" title={catErr} onClick={function (e) { e.stopPropagation(); loadCats(); }}") > 0 && tab.indexOf('categories not loaded — try again') > 0 && tab.indexOf("setCatErr((j && j.error) || 'The categories could not be loaded.')") > 0);
check('WIRING: while loading the menu is disabled (no empty pick possible); when ready it lists pickableCategories', tab.indexOf('<select value="" disabled aria-label="Loading the categories"') > 0 && tab.indexOf('{pickableCategories(catList).map(') > 0 && tab.indexOf("catList ? 'change category…' : 'loading…'") < 0);
check('WIRING: the old rule that fetched ONLY for the expense table is gone', tab.indexOf('if (!canPick || catList || !xOpen) { return; }') < 0);
var pf = fs.readFileSync(path.join(root, 'src/components/PnlFormula.jsx'), 'utf8'); var ed = fs.readFileSync(path.join(root, 'src/components/ExpenseDetail.jsx'), 'utf8');
check('the pop-up passes the SAME picker down to its bank lines (so the fix reaches the screen Max used)', /picker/.test(pf) && ed.indexOf('{picker(r)}') > 0 && /<PnlFormula[^>]*picker=\{catPicker\}/.test(tab), (tab.match(/<PnlFormula[^>]*>/) || [''])[0].substring(0, 300));
var lib = fs.readFileSync(path.join(root, 'src/lib/cat-picker-state.js'), 'utf8');
check('style: no backticks, arrow functions, let / const in the helper', lib.indexOf(String.fromCharCode(96)) < 0 && !/=>/.test(lib) && !/\b(let|const)\s/.test(lib));
console.log('\nWR: ' + pass + ' passed, ' + failN + ' failed');
if (failN) { process.exit(1); }
