// v55.83-WR — P&L by period: the "change category" menu on a bank line (Max, 21 Nov 2026: "should be able to change category
// right from here but not working" — the menus in the "How [month] is worked out" pop-up stayed on "loading…" for ever).
// Cause: the list of categories was only fetched when a line of the EXPENSE TABLE was opened, never when the pop-up was opened,
// and a failed fetch left an empty menu with no message. Pure, so it is tested without a browser.

// Should the category list be fetched now? Yes when the person may pick, the list is not there yet, no fetch is running, and
// any place that shows bank lines with the menu is open: a line of the expense table (xOpen) or the pop-up (fShow).
export function needCategoryList(s) {
  var o = s || {};
  return o.canPick === true && !o.loaded && !o.loading && (!!o.xOpen || !!o.fShow);
}

// What the menu shows: 'ready' (the categories), 'loading' (a disabled "loading…"), 'error' (a retry button with the reason).
export function pickerState(catList, catErr) {
  if (Array.isArray(catList)) { return 'ready'; }
  if (catErr) { return 'error'; }
  return 'loading';
}

// The categories a person may pick from the menu: active ones, never "needs clarification".
export function pickableCategories(list) {
  return (list || []).filter(function (c) { return c && c.active !== false && c.key !== 'needs_clarification'; });
}
// v55.83-ZK (Max, Nov 26) — what the menu shows as selected for one line: its own category when that is one of the choices, else ''
export function currentCategoryOf(row, list) {
  var k = row && (row.category || row.bank_category || ''); if (!k) { return ''; }
  return pickableCategories(list).some(function (c) { return c.key === k; }) ? k : '';
}
export function categoryLabel(key, list) { var c = (list || []).filter(function (x) { return x && x.key === key; })[0]; return (c && c.label) || key || ''; }
// same category picked again = nothing to save (said plainly, never 'saved')
export function samePick(row, key, list) { var cur = currentCategoryOf(row, list); return !!cur && cur === key; }
