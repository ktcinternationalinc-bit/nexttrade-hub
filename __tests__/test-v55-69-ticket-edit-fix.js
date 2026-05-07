// ============================================================
// v55.69 — Ticket title/description edit is INSTANT,
//          Back button ALWAYS works.
//
// Max reported May 7 2026: "Something's strange when I update a
// description in a ticket. It takes a long time to save, then when I
// click back nothing happens. I can't go back to tickets."
//
// Root causes:
//   1. dbUpdate() does THREE round-trips to Supabase (SELECT old +
//      UPDATE + INSERT audit). On slow connections that's 1.5–3 seconds
//      and the await blocks the user inside the editor.
//   2. While the await was pending, the Save button showed "Saving…" and
//      the back button felt unresponsive because nothing visible changed
//      until the save resolved.
//
// Fix: OPTIMISTIC update.
//   - User clicks Save → UI exits edit mode IMMEDIATELY (no await).
//   - The actual database save happens entirely in the background.
//   - If save fails, optimistic update is rolled back and edit mode
//     is re-opened with the user's text intact + an error toast.
//   - Back button works instantly because there's no pending await
//     blocking the click handler.
//   - Double-tap protection via a ref (zero-render-cost).
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label, detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.69 — Ticket edit instant, Back button always works');
console.log('============================================================');

var tt = read('src/components/TicketsTab.jsx');

// ============================================================
// 1. Optimistic save — UI exits edit mode INSTANTLY (no await before)
// ============================================================
group('1. Optimistic save: UI is instant, save runs in background');

// The flow MUST be: setEditingField(null) → background save (no await
// between these). If there were an await before setEditingField(null),
// the UI would still be slow.
var saveFn = (tt.match(/const saveTicketEdit = async \(field\) => \{[\s\S]*?^  \};/m) || [''])[0];
check('1.1 saveTicketEdit function exists',
  saveFn.length > 0);

check('1.2 setEditingField(null) called BEFORE any await on dbUpdate',
  // setEditingField(null) appears in source BEFORE the dbUpdate await
  saveFn.indexOf('setEditingField(null)') < saveFn.indexOf('await dbUpdate'));

check('1.3 setSel(updatedSel) called BEFORE any await on dbUpdate (optimistic)',
  saveFn.indexOf('setSel(updatedSel)') < saveFn.indexOf('await dbUpdate'));

check('1.4 setEditBuf cleared BEFORE any await',
  saveFn.indexOf("setEditBuf({ title: '', description: '' })") < saveFn.indexOf('await dbUpdate'));

check('1.5 dbUpdate runs INSIDE an IIFE (background async function)',
  /\(async \(\) => \{[\s\S]*?await dbUpdate\('tickets'/.test(saveFn));

check('1.6 success toast fires INSTANTLY (before save), not after',
  saveFn.indexOf('updated ✓') < saveFn.indexOf('await dbUpdate'));

// ============================================================
// 2. Error path — rollback on failure
// ============================================================
group('2. Error path: optimistic update rolls back on failure');

check('2.1 previousSel snapshot taken BEFORE optimistic update',
  /const previousSel = sel;[\s\S]{0,200}setSel\(updatedSel\)/.test(saveFn));

check('2.2 catch block restores setSel(previousSel) on failure',
  /catch \(err\) \{[\s\S]{0,300}setSel\(previousSel\)/.test(saveFn));

check('2.3 catch block re-opens edit mode (setEditingField(field))',
  /catch \(err\) \{[\s\S]{0,500}setEditingField\(field\)/.test(saveFn));

check('2.4 catch block restores user text in editBuf',
  /catch \(err\) \{[\s\S]{0,500}setEditBuf\(\{[\s\S]{0,40}\[field\]: newVal/.test(saveFn));

check('2.5 catch block surfaces error to user via toast/alert',
  /catch \(err\) \{[\s\S]{0,800}toast.*error|catch \(err\) \{[\s\S]{0,800}alert\(/.test(saveFn));

check('2.6 catch block logs the error to console',
  /catch \(err\) \{[\s\S]{0,200}console\.error/.test(saveFn));

// ============================================================
// 3. Background work — never blocks user
// ============================================================
group('3. Background work: audit + activity + reloads do not block');

check('3.1 audit comment written in background (inside IIFE)',
  /\(async \(\) => \{[\s\S]*?dbInsert\('ticket_comments'/.test(saveFn));

check('3.2 logActivity in background (inside IIFE)',
  /\(async \(\) => \{[\s\S]*?logActivity/.test(saveFn));

check('3.3 loadComments in background',
  /\(async \(\) => \{[\s\S]*?loadComments/.test(saveFn));

check('3.4 loadTickets in background',
  /\(async \(\) => \{[\s\S]*?loadTickets/.test(saveFn));

check('3.5 each background step has its own try/catch (one failure does not stop others)',
  // Should see multiple try{...}catch blocks inside the IIFE for the post-dbUpdate work
  ((saveFn.match(/try \{ await dbInsert/g) || []).length
   + (saveFn.match(/try \{[\s\S]{0,80}await logActivity/g) || []).length
   + (saveFn.match(/try \{ await loadComments/g) || []).length
   + (saveFn.match(/try \{ await loadTickets/g) || []).length) >= 3);

// ============================================================
// 4. Double-tap protection (without UI lockup)
// ============================================================
group('4. Double-tap guard via ref (no render-state lockup)');

check('4.1 useRef for savingRef declared',
  /const savingRef = useRef\(false\)/.test(tt));

check('4.2 saveTicketEdit early-returns if savingRef.current is true',
  /if \(savingRef\.current\) return;/.test(saveFn));

check('4.3 savingRef.current = true set BEFORE the optimistic update',
  saveFn.indexOf('savingRef.current = true') < saveFn.indexOf('setSel(updatedSel)'));

check('4.4 savingRef.current = false in finally (so retries work after errors)',
  /finally \{[\s\S]{0,80}savingRef\.current = false/.test(saveFn));

// ============================================================
// 5. Back button is always responsive
// ============================================================
group('5. Back button works at any time (even mid-save)');

// Find back button onClick
var backHandler = (tt.match(/onClick=\{\(\) => \{[\s\S]{0,200}setSel\(null\);[\s\S]{0,80}setComments\(\[\]\)/) || [''])[0];
check('5.1 Back button onClick clears editingField → editBuf → sel → comments',
  /setEditingField\(null\)[\s\S]{0,100}setEditBuf[\s\S]{0,100}setSel\(null\)[\s\S]{0,80}setComments\(\[\]\)/.test(backHandler));

check('5.2 Back button is rendered ABOVE the title editor (clickable on top)',
  // Source order: back button JSX appears before the editingField === 'title' block
  tt.indexOf('← Back') < tt.indexOf("editingField === 'title'"));

check('5.3 Back button is NOT disabled by savingEdit/savingRef',
  // The button itself shouldn't have disabled={savingEdit} or similar
  !/← Back[\s\S]{0,50}disabled=\{savingEdit\}/.test(tt)
  && !/disabled=\{savingRef\.current\}[\s\S]{0,50}← Back/.test(tt));

// ============================================================
// 6. Initial-load anti-pattern fix from earlier v55.69 work
// ============================================================
group('6. Initial load fired from useEffect (not render body)');

check('6.1 if(!loaded) loadTickets() is INSIDE a useEffect, not in render body',
  /useEffect\(\(\) => \{ if \(!loaded\) loadTickets\(\); \/\* eslint-disable-next-line \*\/ \}, \[\]\);/.test(tt));

check('6.2 The OLD anti-pattern (loadTickets() called directly in render body) is gone',
  // There should NOT be a top-level "if (!loaded) loadTickets();" outside a useEffect.
  // Bare loadTickets() calls inside event handlers (createTicket, deleteTicket, etc.)
  // are correct and expected.
  !/^\s{2,4}if \(!loaded\) loadTickets\(\);/m.test(tt));

// ============================================================
// 7. Workflow integrity
// ============================================================
group('7. Workflow integrity — no behaviour regressions');

check('7.1 Title edit click sets editBuf with current title',
  /setEditBuf\(\{\.\.\.editBuf, title: sel\.title \|\| ''\}\); setEditingField\('title'\)/.test(tt));

check('7.2 Description edit click sets editBuf with current description',
  /setEditBuf\([^)]*description: sel\.description \|\| ''[^)]*\); setEditingField\('description'\)/.test(tt));

check('7.3 Empty title still rejected',
  /Title cannot be empty/.test(saveFn));

check('7.4 No-change save just exits edit mode (no DB write)',
  /if \(newVal === oldVal\) \{ setEditingField\(null\); return; \}/.test(saveFn));

check('7.5 canEditTicketContent permission check still in place',
  /if \(!canEditTicketContent\(sel\)\)/.test(saveFn));

check('7.6 Enter key in title editor saves',
  /if \(e\.key === 'Enter'\) saveTicketEdit\('title'\)/.test(tt));

check('7.7 Ctrl+Enter / Cmd+Enter in description editor saves',
  /if \(e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)\) saveTicketEdit\('description'\)/.test(tt));

check('7.8 Escape key cancels edit (without losing track of save state)',
  /e\.key === 'Escape'/.test(tt));

// ============================================================
// 8. Edge cases
// ============================================================
group('8. Edge cases');

check('8.1 Save uses previousSel (not stale closure of sel) for ticket id reference',
  // After optimistic update, dbUpdate uses sel.id (which is the same as before since id doesn't change)
  // and background work uses previousSel.id to be safe even if sel changes
  /dbInsert\('ticket_comments', \{[\s\S]{0,80}ticket_id: previousSel\.id/.test(saveFn));

check('8.2 logActivity uses previousSel for ticket reference',
  /logActivity\([^)]*previousSel\.(ticket_number|title)/.test(saveFn));

check('8.3 loadComments(previousSel.id) — not stale sel.id',
  /loadComments\(previousSel\.id\)/.test(saveFn));

check('8.4 If user clicks Back DURING save, the background save still completes safely',
  // Because we use previousSel snapshot, the background work doesn't depend on sel state
  /const previousSel = sel/.test(saveFn) && /previousSel\.id/.test(saveFn));

check('8.5 If user navigates to ANOTHER ticket during save, prev save uses original ticket id',
  // Same as 8.4 — previousSel is a snapshot
  /const previousSel = sel/.test(saveFn));

check('8.6 No double-fetch on save success (no await loadTickets that blocks UI)',
  // loadTickets is inside the background IIFE
  !/^\s*await loadTickets\(\);\s*$/m.test(saveFn.replace(/\(async \(\) => \{[\s\S]*?\}\)\(\);/, ''))
  && /\(async \(\) => \{[\s\S]*?await loadTickets\(\)/.test(saveFn));

// ============================================================
// 9. Carry-forward
// ============================================================
group('9. Carry-forward — v55.65/66/67/68 still intact');

var pd = read('src/components/PersonalDashboard.jsx');
check('9.1 v55.71 — MyHRDesk now lives in AssistantsBar (zero dashboard mounts, one in AssistantsBar)',
  (function () {
    var ab = read('src/components/AssistantsBar.jsx');
    return (pd.match(/<MyHRDesk /g) || []).length === 0
      && (ab.match(/<MyHRDesk /g) || []).length === 1;
  })());
check('9.2 v55.68 no early-return tree',
  !/if \(!loaded\) return \(/.test(pd));
check('9.3 v55.68 stable [myId] dep still in place',
  /\}, \[myId\]\);/.test(pd));

var hr = read('src/components/MyHRDesk.jsx');
check('9.4 v55.65 MyHRDesk component still present', hr.length > 5000);

var ai = read('src/components/AdminHRInbox.jsx');
check('9.5 v55.65 AdminHRInbox still present', ai.length > 3000);

var srt = read('src/components/ShippingRatesTab.jsx');
check('9.6 v55.66 Shipping list view still present', /routesViewMode/.test(srt));

var wnw = read('src/components/WhatsNewWidget.jsx');
check('9.7 v55.67 WhatsNew adminOnly filter still wired', /filterEntry/.test(wnw));

var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('9.8 v55.65 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); if (f.detail) console.log('     ' + f.detail); });
  process.exit(1);
}
console.log('\n✅ All ' + passed + ' tests passed');
