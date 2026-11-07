// ═══════════════════════════════════════════════════════════════════════════
// v55.83-QS (part 2) — "the import bills is not working... nothing happens"
// (Max, Nov 8 01:02, same Trinity PDF). Root cause found: every status line
// (reading, multi-import results, mailbox scan, 🩺 diagnostics) rendered ONLY
// inside an open bill editor — so on a fresh screen nothing ever showed.
// ═══════════════════════════════════════════════════════════════════════════
var fs = require('fs');
var path = require('path');
var R = function (p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); };
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ FAIL: ' + name); }
}
console.log('QS2 — Bills status always visible');
var bt = R('src/components/BillsTab.jsx');
ok('1: a standalone status panel renders whenever reading OR there are notes and no imported editor is open — the old editor-only display can no longer hide results',
  /\{\(reading \|\| \(importNotes\.length > 0 && !\(editing && editing\._imported\)\)\) && <div/.test(bt) &&
  /⏳ Working… \(reading a document can take up to a minute/.test(bt));
ok('2: the single-file read announces itself immediately (file name + size), races a 75s client guard, and on success scrolls to the editor',
  /📄 Reading "' \+ f\.name \+ '"/.test(bt) && /no answer after 75 seconds/.test(bt) &&
  /getElementById\('nt-bill-editor'\)/.test(bt) && /id="nt-bill-editor"/.test(bt));
ok('3: a read refusal is written to the panel too (not only a toast), and non-photo/PDF picks are named',
  /setImportNotes\(\['✗ ' \+ \(\(j && j\.error\) \|\| 'Could not read the bill/.test(bt) &&
  /Those files are not photos or PDFs/.test(bt));
console.log('');
console.log('QS2: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
