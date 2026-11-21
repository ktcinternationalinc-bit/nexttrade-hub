// ═══════════════════════════════════════════════════════════════════════════
// v55.83-PJ — Bill categories: dropdown + add + vendor memory on import
//
// Max (Nov 6): "categories for bills should be a dropdown to select with an
// ability to add a category.. remember and categorize later on with new
// bills automatically when imported."
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('PJ — bill categories remembered');

// ── 1. Server: the vendor memory ──
var srv = R('src/lib/expense-rules-server.js');
ok('1a: suggestCategory exists — active rules only, most-specific match, null (never a guess) otherwise',
  /export async function suggestCategory\(db, text\)/.test(srv) &&
  /eq\('active', true\)/.test(srv) && /return r \? r\.classification : null;/.test(srv));
var br = R('src/app/api/accounting/bills/route.js');
// superseded (v55.83-WX, Max 21 Nov "create rules for bills ... to place categories"): the bill rules come first; when no bill rule
// fits, categoryForNewBill falls back to the SAME vendor memory (suggestCategory) — the auto-fill is unchanged for such bills
var wxSrv = R('src/lib/bill-rules-server.js');
ok('1b: save_bill with NO category auto-fills (bill rules, then the vendor\'s remembered rule), reported as auto_category',
  /wxPick = await categoryForNewBill\(db, wxBill, \[\]\)/.test(br) && /if \(wxPick && wxPick\.category\) \{ autoCat = wxPick\.category; fields\.category = autoCat; \}/.test(br) &&
  /mem = await suggestCategory\(db, bill && bill\.vendor_name\)/.test(wxSrv) && /auto_category: autoCat/.test(br));
ok('1c: save_bill WITH a category LEARNS it (create + edit) — a changed pick updates the rule; auto-filled picks are NOT re-learned',
  /if \(fields\.category && !autoCat\) \{ learnedB = await learnRule\(db, vendor, fields\.category, userId\); \}/.test(br) &&
  /learnedU = await learnRule\(db, vendor, fields\.category, userId\)/.test(br));
ok('1d: extract_bill suggests the remembered category ONLY when the document itself names none',
  /if \(rd\.draft && rd\.draft\.vendor_name && !rd\.draft\.category\) \{ \/\/ v55\.83-WX/.test(br) && /sugg = sPick\.category \|\| null;/.test(br) && // superseded (WX): bill rules, then the vendor memory
  /suggested_category: sugg/.test(br));

// ── 2. Permission: Bills people can list + add categories, nothing more ──
var rt = R('src/app/api/accounting/expense-rules/route.js');
ok('2: bills.manage unlocks ONLY list + save_category on the rules route (rules/verify/apply stay bank.classify)',
  /gate\.ok && \(action === 'list' \|\| action === 'save_category'\)/.test(rt) &&
  /assertPermission\(db, userId, 'bills\.manage', req\)/.test(rt));

// ── 3. UI ──
var ui = R('src/components/BillsTab.jsx');
ok('3a: category is a DROPDOWN from the shared list, with free-text fallback until the PI SQL runs',
  /from\('expense_categories'\)/.test(ui) && /\{cats \? <span/.test(ui) &&
  /placeholder="Category \(e\.g\. Freight\)"/.test(ui));
ok('3b: ＋ add-a-category inline — saves via the shared route and selects the new category on the open bill',
  /action: 'save_category'/.test(ui) && /setAddingCat\(true\)/.test(ui) &&
  /setEditing\(function \(ed\) \{ return ed \? Object\.assign\(\{\}, ed, \{ category: j\.category\.key \}\) : ed; \}\)/.test(ui));
ok('3c: import pre-fills the REMEMBERED category and says so (human still confirms every field)',
  /category: j\.draft\.category \|\| j\.suggested_category \|\| ''/.test(ui) &&
  /Category pre-filled from what you picked for this vendor before/.test(ui));
ok('3d: an existing bill whose category is not in the active list still shows it (no silent data loss)',
  /!cats\.some\(function \(c\) \{ return c\.key === editing\.category; \}\) && <option/.test(ui));
ok('3e: the bills table shows the human label for a category key',
  /catLabelOf\[b\.category\] \|\| b\.category/.test(ui));

console.log('');
console.log('PJ: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
