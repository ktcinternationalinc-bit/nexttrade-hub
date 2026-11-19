// v55.83-VI — Egypt Bank: SEVERAL statement files in one go (Max, Nov 19 2026: "make sure i can upload several pdfs at a time").
// Pure helpers. Each file is read and proved ON ITS OWN (the PDF gate is per file); these functions only keep the files apart
// afterwards: which row came from which file, the same line appearing in two of the selected files, one result line per file
// for the preview, and one import batch per file for the audit trail. Nothing here reads or writes anything.

function norm60(s) { return String(s || '').replace(/\s+/g, ' ').trim().substring(0, 60).toLowerCase(); }
function amt(a) { return String(Math.round((Number(a) || 0) * 100)); }

// every row carries the file it came from (name + its position in the selection, so two files with the same name stay apart)
export function tagFileRows(rows, fileName, fileIndex) {
  return (rows || []).map(function (r) { return Object.assign({}, r, { _file: String(fileName || 'file'), _fileIx: fileIndex }); });
}

// The same bank line in TWO of the selected files (overlapping statement periods, or the same statement as Excel and as PDF).
// The FIRST file keeps its rows. In a later file:
//   • same date + amount + first 60 characters of the description as a row of an earlier file → unticked, "same line"
//   • same date + amount only → unticked, "same date and amount" (a person can tick it back if it is really another payment)
// Count-aware (Codex 19 Nov 17:18 / 18:48): every earlier row is ONE occurrence with its own identity and can cover at most one
// row of a later file, whichever way it is matched. Inside a later file the exact matches are reserved FIRST, then the
// date-and-amount matches take what is left — so the order of the rows in the file does not change the result. Two identical
// fees in the earlier file cover two in the later file, not three. Rows inside ONE file are never compared with each other (a
// statement can truly carry two identical lines). A row recognised as a copy does not itself cover a further copy; a third
// file is compared with the originals of the first two.
export function markCrossFileDuplicates(rows) {
  var list = (rows || []).map(function (r) { return Object.assign({}, r); });
  var order = []; list.forEach(function (r) { if (order.indexOf(r._fileIx) < 0) { order.push(r._fileIx); } });
  function keyE(r) { return r.date + '|' + amt(r.amount) + '|' + norm60(r.description); }
  function keyL(r) { return r.date + '|' + amt(r.amount); }
  var byExact = {}; var byLoose = {}; // key → [occurrence]; an occurrence = { file, usedIn } and sits in BOTH indexes as the same object
  function take(index, key, ix) { var c = index[key] || []; for (var i = 0; i < c.length; i++) { if (c[i].usedIn !== ix) { c[i].usedIn = ix; return c[i]; } } return null; }
  order.forEach(function (ix) {
    var mine = list.filter(function (r) { return r._fileIx === ix; });
    mine.forEach(function (r) { var o = take(byExact, keyE(r), ix); if (o) { r._include = false; r._crossDup = 'exact'; r._crossDupFile = o.file; } });
    mine.forEach(function (r) { if (r._crossDup) { return; } var o = take(byLoose, keyL(r), ix); if (o) { r._include = false; r._crossDup = 'possible'; r._crossDupFile = o.file; } });
    // only now do this file's own rows become "earlier" occurrences (so they are never matched against each other)
    mine.forEach(function (r) {
      if (r._crossDup) { return; }
      var occ = { file: r._file, usedIn: null };
      (byExact[keyE(r)] = byExact[keyE(r)] || []).push(occ); (byLoose[keyL(r)] = byLoose[keyL(r)] || []).push(occ);
    });
  });
  return list;
}

// The preview shows the rows a page at a time; EVERY row of every file can be reached (Codex 18:48: a copy unticked at row 201
// could not be ticked back). Each item keeps the row's position in the whole list, so ticking works the same on any page.
// onlyMarked = show just the rows that were unticked as copies of a line in another selected file.
export function previewPage(rows, page, size, onlyMarked) {
  var per = Math.max(1, Number(size) || 200);
  var all = (rows || []).map(function (r, i) { return { row: r, index: i }; }).filter(function (it) { return !onlyMarked || !!it.row._crossDup; });
  var pages = Math.max(1, Math.ceil(all.length / per));
  var pg = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  var items = all.slice(pg * per, pg * per + per);
  return { items: items, page: pg, pages: pages, total: all.length, from: items.length ? pg * per + 1 : 0, to: pg * per + items.length, marked: (rows || []).filter(function (r) { return !!r._crossDup; }).length };
}

// tick / untick ONE row by its position in the whole list. A new list and a new row object: nothing else changes.
export function toggleRowInclude(rows, index) {
  return (rows || []).map(function (r, i) { return i === index ? Object.assign({}, r, { _include: !r._include }) : r; });
}

// one line per selected file for the preview. results = [{ name, kind: 'pdf' | 'sheet', refused, reason, note }] in selection order
export function fileResultLines(results, rows, canSeeAmounts) {
  return (results || []).map(function (res, ix) {
    var mine = (rows || []).filter(function (r) { return r._fileIx === ix; });
    // what is unticked NOW (a row the person ticked back is no longer "unticked" and is counted apart)
    var exact = mine.filter(function (r) { return r._crossDup === 'exact' && !r._include; }).length; var possible = mine.filter(function (r) { return r._crossDup === 'possible' && !r._include; }).length;
    var tickedBack = mine.filter(function (r) { return !!r._crossDup && !!r._include; }).length;
    var willImport = mine.filter(function (r) { return !!r._include; }).length;
    if (res.refused) { return { name: res.name, ok: false, refused: true, rows: 0, text: '⛔ ' + (canSeeAmounts || !res.short ? (res.reason || (res.name + ': not imported.')) : res.short) }; }
    var text = '✅ ' + (res.note ? (canSeeAmounts ? res.note.text : res.note.short) : (res.name + ': ' + mine.length + ' row' + (mine.length === 1 ? '' : 's') + ' read.'));
    if (exact) { text += ' ' + exact + ' row' + (exact === 1 ? ' is' : 's are') + ' the same line as in another selected file and ' + (exact === 1 ? 'is' : 'are') + ' unticked.'; }
    if (possible) { text += ' ' + possible + ' row' + (possible === 1 ? ' has' : 's have') + ' the same date and amount as a line in another selected file and ' + (possible === 1 ? 'is' : 'are') + ' unticked — tick ' + (possible === 1 ? 'it' : 'them') + ' only if ' + (possible === 1 ? 'it is a different payment' : 'they are different payments') + '.'; }
    if (tickedBack) { text += ' ' + tickedBack + ' row' + (tickedBack === 1 ? '' : 's') + ' marked as a copy ' + (tickedBack === 1 ? 'was' : 'were') + ' ticked back by you and will be imported.'; }
    text += ' Ticked to import from this file: ' + willImport + ' of ' + mine.length + '.';
    return { name: res.name, ok: true, refused: false, rows: mine.length, willImport: willImport, crossExact: exact, crossPossible: possible, tickedBack: tickedBack, text: text };
  });
}

// The whole selection in one step. results = one entry per selected file, in selection order:
//   { name, kind: 'pdf' | 'sheet', refused, reason, short, note, rows }
// A refused file contributes NO rows whatever its `rows` holds, and never affects the other files. Returns the rows of the
// accepted files (tagged with their file, copies across files unticked, numbered 1..n) and the results without their rows.
export function combineFiles(results) {
  var all = [];
  var clean = (results || []).map(function (res, ix) {
    var r = res || {}; var refused = !!r.refused || !(r.rows && r.rows.length);
    if (!refused) { all = all.concat(tagFileRows(r.rows, r.name, ix)); }
    return { name: String(r.name || 'file'), kind: r.kind || 'sheet', refused: refused, reason: refused ? (r.reason || (String(r.name || 'file') + ': nothing could be read from this file. Nothing from it was added.')) : '', short: refused ? (r.short || '') : '', note: r.note || null };
  });
  var rows = markCrossFileDuplicates(all).map(function (r, i) { return Object.assign({}, r, { _row: i + 1 }); });
  return { rows: rows, results: clean };
}

// The duplicate-review screen in numbers. A flagged row is brought in ONLY when its decision is 'import'; every other state
// (skip, or a "possible" row nobody decided on) is skipped — so the screen and the import always say the same thing.
export function reviewCounts(classified) {
  var list = classified || [];
  var clean = list.filter(function (c) { return c.status === 'clean'; }).length;
  var exact = list.filter(function (c) { return c.status === 'exact'; }).length;
  var possible = list.filter(function (c) { return c.status === 'possible'; }).length;
  var importing = list.filter(function (c) { return c.decision === 'import'; }).length;
  var flaggedImporting = list.filter(function (c) { return c.status !== 'clean' && c.decision === 'import'; }).length;
  return { clean: clean, exact: exact, possible: possible, flagged: exact + possible, importing: importing, skipping: list.length - importing, flaggedImporting: flaggedImporting, allFlaggedSkipped: flaggedImporting === 0 };
}

// What "Confirm and import" writes: only rows whose decision is 'import', kept apart per file (one import batch per file, so
// one statement can be rolled back without touching the others). The rows carry exactly the columns of the bank table.
export function importPlan(classified, accountId, userId) {
  var picked = []; var skipped = 0, exactSkipped = 0, possibleSkipped = 0, overridden = 0;
  (classified || []).forEach(function (c) {
    if (c.decision === 'import') {
      picked.push({ account_id: accountId, date: c.row.date, description: c.row.description, amount: c.row.amount, imported_by: userId, _file: c.row._file, _fileIx: c.row._fileIx });
      if (c.status !== 'clean') { overridden += 1; }
    } else {
      skipped += 1;
      if (c.status === 'exact') { exactSkipped += 1; } else if (c.status === 'possible') { possibleSkipped += 1; }
    }
  });
  var groups = groupRowsByFile(picked).map(function (g) {
    var rows = g.rows.map(function (r) { return { account_id: r.account_id, date: r.date, description: r.description, amount: r.amount, imported_by: r.imported_by }; });
    return { file: g.file, fileIx: g.fileIx, rows: rows, total: rows.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0) };
  });
  return { groups: groups, rowCount: picked.length, skipped: skipped, exactSkipped: exactSkipped, possibleSkipped: possibleSkipped, overridden: overridden };
}

// Writes an importPlan. db = { createBatch(row) → id or null, insertRows(rows) → true when saved, updateBatch(id, patch) }.
// One batch record per file, made first; the file's rows carry its id. Rows go in groups of 100. A file whose batch record
// cannot be made is still imported (without a batch), as before. If some of a file's rows cannot be saved, that file's batch
// record is corrected to what WAS saved (row count, total and a note). That correction is itself CHECKED (Codex 19 Nov 19:08):
// db.updateBatch must return true only when exactly that record was changed. When it is not confirmed, the file's result says
// so (historyOk false + a warning) — the saved rows stay, nothing is retried or removed, and reconcileBatchRecord can put the
// record right later from what is really saved. A file saved without a batch record is flagged too (it cannot be undone on its own);
// the other files are not affected. Never throws.
export async function writeImportPlan(plan, db, accountId, userId) {
  var imported = 0, failed = 0; var perFile = []; var batchByFile = {};
  var groups = (plan && plan.groups) || [];
  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi]; var batchId = null;
    var batchRow = { imported_by: userId, account_id: accountId, row_count: g.rows.length, total_amount: g.total, status: 'active' };
    try { batchId = (await db.createBatch(g.file ? Object.assign({ filename: g.file }, batchRow) : batchRow)) || null; } catch (e1) { batchId = null; }
    if (!batchId && g.file) { try { batchId = (await db.createBatch(batchRow)) || null; } catch (e2) { batchId = null; } } // an older table without the file-name column
    var rows = batchId ? g.rows.map(function (r) { return Object.assign({}, r, { import_batch_id: batchId }); }) : g.rows;
    var saved = 0; var savedTotal = 0;
    for (var i = 0; i < rows.length; i += 100) {
      var chunk = rows.slice(i, i + 100); var ok = false;
      try { ok = (await db.insertRows(chunk)) === true; } catch (e3) { ok = false; }
      if (ok) { saved += chunk.length; savedTotal += chunk.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0); } else { failed += chunk.length; }
    }
    var historyOk = !!batchId; var warning = '';
    var label = g.file || 'this import';
    if (!batchId && saved > 0) { warning = label + ': the ' + saved + ' row' + (saved === 1 ? ' was' : 's were') + ' saved, but no import record could be made for this file. It will not appear in Import history and cannot be undone there as one file.'; }
    if (batchId && saved !== rows.length) {
      var fixed = false;
      try { fixed = (await db.updateBatch(batchId, { row_count: saved, total_amount: savedTotal, notes: saved + ' of ' + rows.length + ' rows were saved; ' + (rows.length - saved) + ' could not be saved' + (g.file ? ' (' + g.file + ')' : '') })) === true; } catch (e4) { fixed = false; }
      historyOk = fixed;
      if (!fixed) { warning = label + ': ' + saved + ' of ' + rows.length + ' rows were saved, but the import record for this file could NOT be corrected — Import history still shows ' + rows.length + ' rows for it. The saved rows are fine. Do not import the file again; press “Correct this import record”.'; }
    }
    imported += saved; batchByFile[String(g.fileIx)] = batchId;
    perFile.push({ file: g.file, fileIx: g.fileIx, selected: g.rows.length, imported: saved, batchId: batchId, historyOk: historyOk, warning: warning });
  }
  return { imported: imported, failed: failed, perFile: perFile, batchByFile: batchByFile, warnings: perFile.map(function (f) { return f.warning; }).filter(Boolean) };
}

// Was a change to ONE record really made? r = what the database call returned when asked to hand back the changed record
// (.update(...).eq('id', id).select('id')). True only with no error and exactly one record changed — a refused change, an error
// that comes back as a value, or a change that matched no record are all false.
export function updateConfirmed(r) { return !!r && !r.error && Array.isArray(r.data) && r.data.length === 1; }

// Puts ONE import record right from what is really saved, without touching any bank row and without re-importing anything.
// db.readBatchRows(id) → { ok, count, total } counted from the saved rows of that batch; db.updateBatch(id, patch) → true only
// when exactly that record was changed. Returns { ok, count, total, message }. Never throws.
export async function reconcileBatchRecord(db, batchId) {
  if (!batchId) { return { ok: false, message: 'There is no import record to correct.' }; }
  var seen = null;
  try { seen = await db.readBatchRows(batchId); } catch (e1) { seen = null; }
  if (!seen || seen.ok !== true || !(Number(seen.count) >= 0)) { return { ok: false, message: 'The saved rows of this import could not be counted, so the record was left as it is. Nothing was changed.' }; }
  var done = false;
  try { done = (await db.updateBatch(batchId, { row_count: Number(seen.count), total_amount: Number(seen.total) || 0, notes: 'Corrected to the ' + Number(seen.count) + ' rows actually saved' })) === true; } catch (e2) { done = false; }
  if (!done) { return { ok: false, count: Number(seen.count), total: Number(seen.total) || 0, message: 'The import record could not be changed (' + Number(seen.count) + ' rows are really saved). Nothing was changed; ask an administrator.' }; }
  return { ok: true, count: Number(seen.count), total: Number(seen.total) || 0, message: 'Import record corrected: ' + Number(seen.count) + ' rows.' };
}

// what is written, kept apart per file: [{ file, fileIx, rows: [...] }] in selection order. Rows with no file tag go in one group.
export function groupRowsByFile(rows) {
  var out = []; var at = {};
  (rows || []).forEach(function (r) {
    var key = r._fileIx === undefined || r._fileIx === null ? 'none' : String(r._fileIx);
    if (at[key] === undefined) { at[key] = out.length; out.push({ file: r._file || null, fileIx: r._fileIx === undefined ? null : r._fileIx, rows: [] }); }
    out[at[key]].rows.push(r);
  });
  return out;
}
