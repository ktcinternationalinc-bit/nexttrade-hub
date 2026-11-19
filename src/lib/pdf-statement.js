// v55.83-VF — BANK STATEMENT PDF → transactions (Max, Nov 19 2026: "I NEED TO BE ABLE TO IMPORT PDFS AS WELL IN EGYPT BANK").
// Pure functions: they are handed the words of the PDF with their positions and return dated rows. No file, no network, no database.
// Nothing is guessed from a bank's name. The columns are found from where the numbers line up on the page, and WHICH amount
// column is money out and which is money in is PROVED against the balances the bank prints (never assumed from left / right
// when the balances can settle it). Every row is then checked against the bank's own running balance, and the result of that
// check is returned so the screen can say so.
//
// pages = [[{ str, x, y, w }]] — one array per page; x = left edge, y = baseline (PDF units, larger = higher on the page), w = width.

var MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function validYmd(y, m, d) { if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) { return ''; } var dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCDate() === d ? y + '-' + pad2(m) + '-' + pad2(d) : ''; }
// 03FEB25 / 03-Feb-2025 / 03 FEB 2025 · 03/02/2025 (day first — Egyptian statements) · 2025-02-03. Anything else = not a date.
export function parseStatementDate(v) {
  var s = String(v || '').trim();
  var a = s.match(/^(\d{1,2})[\s\-\/]?([A-Za-z]{3})[\s\-\/]?(\d{2}|\d{4})$/);
  if (a && MONTHS[a[2].toUpperCase()]) { var ya = Number(a[3]); if (ya < 100) { ya += 2000; } return validYmd(ya, Number(MONTHS[a[2].toUpperCase()]), Number(a[1])); }
  var b = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (b) { return validYmd(Number(b[3]), Number(b[2]), Number(b[1])); }
  var c = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (c) { return validYmd(Number(c[1]), Number(c[2]), Number(c[3])); }
  return '';
}
// "1,850,000.00" · "350.00" · "(350.00)" · "350.00 DR" → cents, or null when it is not a money figure (an account number is not)
export function parseStatementAmount(v) {
  var s = String(v || '').trim().replace(/\s*(CR|DR)\.?$/i, '');
  var neg = false; var p = s.match(/^\((.*)\)$/); if (p) { neg = true; s = p[1]; }
  if (/^-/.test(s)) { neg = true; s = s.substring(1); }
  if (!/^\d{1,3}(,\d{3})*\.\d{2}$/.test(s) && !/^\d+\.\d{2}$/.test(s)) { return null; }
  var c = Math.round(Number(s.replace(/,/g, '')) * 100);
  return isFinite(c) ? (neg ? -c : c) : null;
}
function cluster(values, tol) { // [{ v, ... }] → [{ at, n }] sorted by position
  var out = [];
  values.slice().sort(function (a, b) { return a - b; }).forEach(function (v) {
    var last = out[out.length - 1];
    if (last && Math.abs(v - last.at) <= tol) { last.sum += v; last.n++; last.at = last.sum / last.n; } else { out.push({ at: v, sum: v, n: 1 }); }
  });
  return out;
}
function linesOf(items) { // words on one baseline → one line, left to right; lines top to bottom
  var rows = [];
  items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; }).forEach(function (it) {
    var r = rows[rows.length - 1];
    if (r && Math.abs(r.y - it.y) <= 2.5) { r.items.push(it); } else { rows.push({ y: it.y, items: [it] }); }
  });
  rows.forEach(function (r) { r.items.sort(function (a, b) { return a.x - b.x; }); });
  return rows;
}

// → { ok, error, transactions: [{ date, description, amount }], check: {...} }   (amount: + money in, − money out)
export function statementFromTextItems(pages) {
  var lines = [];
  (pages || []).forEach(function (items, pi) {
    var clean = (items || []).filter(function (i) { return i && String(i.str || '').trim() !== '' && isFinite(i.x) && isFinite(i.y); })
      .map(function (i) { return { s: String(i.str).trim(), x: Number(i.x), y: Number(i.y), r: Number(i.x) + (Number(i.w) || 0) }; });
    linesOf(clean).forEach(function (l) { l.page = pi + 1; lines.push(l); });
  });
  // a transaction line starts with a date; the word after the date starts the description column
  var dated = lines.filter(function (l) { return !!parseStatementDate(l.items[0].s) && l.items.length >= 2; });
  if (dated.length < 1) { return { ok: false, error: 'No dated lines were found in this PDF. If it is a scanned picture of a statement, it cannot be read — export the statement from the bank as PDF or Excel.', transactions: [], check: null }; }
  var dateX = cluster(dated.map(function (l) { return l.items[0].x; }), 6).sort(function (a, b) { return b.n - a.n; })[0].at;
  dated = dated.filter(function (l) { return Math.abs(l.items[0].x - dateX) <= 6; });
  var descX = cluster(dated.map(function (l) { return l.items[1].x; }).filter(function (x) { return x > dateX; }), 6).sort(function (a, b) { return b.n - a.n; })[0].at;
  // money columns: where the RIGHT edges of the figures on dated lines line up
  var figs = [];
  dated.forEach(function (l) { l.items.slice(1).forEach(function (it) { if (it.x > descX + 20 && parseStatementAmount(it.s) !== null) { figs.push(it.r); } }); });
  var cols = cluster(figs, 7).map(function (c) { return c.at; });
  if (cols.length < 2 || cols.length > 3) { return { ok: false, error: 'This PDF does not have the usual statement columns (found ' + cols.length + ' amount column' + (cols.length === 1 ? '' : 's') + '; a statement needs the amounts and the running balance). Nothing was read.', transactions: [], check: null }; }
  var balCol = cols.length - 1;
  function colOf(it) { var best = -1; for (var c = 0; c < cols.length; c++) { if (Math.abs(it.r - cols[c]) <= 7) { best = c; } } return best; }

  var rows = []; var cur = null; var opening = null; var closing = null;
  lines.forEach(function (l) {
    var first = l.items[0]; var dt = Math.abs(first.x - dateX) <= 6 ? parseStatementDate(first.s) : '';
    if (dt) {
      var desc = []; var amt = {};
      l.items.slice(1).forEach(function (it) {
        var a = parseStatementAmount(it.s); var c = a !== null && it.x > descX + 20 ? colOf(it) : -1;
        if (c >= 0) { amt[c] = a; } else if (it.x >= descX - 6) { desc.push(it.s); }
      });
      var text = desc.join(' ').replace(/\s+/g, ' ').trim();
      var bal = amt[balCol] === undefined ? null : amt[balCol];
      if (/OPENING BALANCE|BALANCE BROUGHT FORWARD|رصيد افتتاحي|الرصيد الافتتاحي/i.test(text)) { if (opening === null && bal !== null) { opening = bal; } cur = null; return; }
      if (/CLOSING BALANCE|BALANCE CARRIED FORWARD|رصيد الاقفال|الرصيد الختامي/i.test(text)) { if (bal !== null) { closing = bal; } cur = null; return; }
      cur = { date: dt, description: text, a0: amt[0] === undefined || balCol === 0 ? null : amt[0], a1: cols.length === 3 ? (amt[1] === undefined ? null : amt[1]) : null, balance: bal, page: l.page };
      rows.push(cur);
    } else if (Math.abs(first.x - descX) <= 6) {
      // an undated line that STARTS in the description column (a totals line starting at the page edge is not one)
      var lineText = l.items.filter(function (it) { return parseStatementAmount(it.s) === null || colOf(it) < 0; }).map(function (it) { return it.s; }).join(' ');
      var hasFig = l.items.some(function (it) { return parseStatementAmount(it.s) !== null && colOf(it) >= 0 && it.x > descX + 20; });
      if (/CLOSING BALANCE|BALANCE CARRIED FORWARD|رصيد الاقفال|الرصيد الختامي/i.test(lineText)) {
        // the closing balance printed on its own line, without a date
        l.items.forEach(function (it) { var a2 = parseStatementAmount(it.s); if (a2 !== null && colOf(it) === balCol) { closing = a2; } });
        cur = null; return;
      }
      if (/OPENING BALANCE|BALANCE BROUGHT FORWARD|رصيد افتتاحي|الرصيد الافتتاحي/i.test(lineText)) {
        l.items.forEach(function (it) { var a3 = parseStatementAmount(it.s); if (a3 !== null && colOf(it) === balCol && opening === null) { opening = a3; } });
        cur = null; return;
      }
      // a continuation line (it may be the first line of the next page): words only, no figure in a money column
      var more = l.items.filter(function (it) { return it.x >= descX - 6 && it.x < cols[0] - 40; });
      if (cur && more.length && !hasFig) { cur.description = (cur.description + ' ' + more.map(function (it) { return it.s; }).join(' ')).replace(/\s+/g, ' ').trim(); }
    }
  });
  rows = rows.filter(function (r) { return r.a0 !== null || r.a1 !== null; });
  if (!rows.length) { return { ok: false, error: 'Dated lines were found but none carries an amount. Nothing was read.', transactions: [], check: null }; }

  // WHICH column is money out? Try both readings against the bank's printed balances and keep the one that agrees.
  function run(outFirst) {
    var bal = opening; var hits = 0; var misses = []; var signed = [];
    rows.forEach(function (r) {
      var amount;
      if (cols.length === 3) { var out = outFirst ? r.a0 : r.a1; var inn = outFirst ? r.a1 : r.a0; amount = (inn || 0) - (out || 0); }
      else { amount = outFirst ? -(r.a0 || 0) : (r.a0 || 0); }
      signed.push(amount);
      if (bal !== null) { bal += amount; }
      if (r.balance !== null) { if (bal === null) { bal = r.balance; } else if (bal === r.balance) { hits++; } else { misses.push({ date: r.date, description: r.description.substring(0, 60), expected: r.balance / 100, got: bal / 100 }); bal = r.balance; } }
    });
    return { hits: hits, misses: misses, signed: signed, end: bal };
  }
  // v55.83-VG (Codex 19 Nov 15:48 / 16:03, P1) — PROVED means: exactly ONE reading agrees with the bank's printed balances.
  // If two readings both agree, nothing is proved, and nothing may be imported on a guess.
  var best; var proved = false; var ambiguous = false;
  if (cols.length === 3) {
    var A = run(true); var B = run(false);
    var aFits = A.misses.length === 0 && A.hits > 0; var bFits = B.misses.length === 0 && B.hits > 0;
    if (aFits && bFits) { ambiguous = JSON.stringify(A.signed) !== JSON.stringify(B.signed); best = A; proved = !ambiguous; }
    else if (aFits || bFits) { best = aFits ? A : B; proved = true; }
    else { best = A.misses.length <= B.misses.length ? A : B; proved = false; }
    if (ambiguous) { best = { hits: A.hits, misses: [], signed: rows.map(function () { return null; }), end: null }; }
  } else {
    // one amount column: each run of rows between two printed balances is signed by the ONLY choice of + / − that moves the
    // balance from one printed figure to the next. No choice fits = the bank's figure disagrees. More than one fits = not proved.
    var bal2 = opening; var signed2 = []; var hits2 = 0; var misses2 = []; var pending = [];
    rows.forEach(function (r) {
      pending.push(r);
      if (r.balance !== null && bal2 !== null) {
        var target = r.balance - bal2; var n = pending.length; var found = null; var count = 0;
        if (n <= 12) { for (var mask = 0; mask < (1 << n) && count < 2; mask++) { var sum = 0; for (var i = 0; i < n; i++) { sum += ((mask >> i) & 1 ? 1 : -1) * (pending[i].a0 || 0); } if (sum === target) { count++; if (found === null) { found = mask; } } } }
        if (n > 12 || count > 1) { ambiguous = true; pending.forEach(function () { signed2.push(null); }); }
        else if (count === 0) { misses2.push({ date: r.date, description: r.description.substring(0, 60), expected: r.balance / 100, got: null }); pending.forEach(function () { signed2.push(null); }); }
        else { hits2++; pending.forEach(function (pr, i2) { signed2.push(((found >> i2) & 1 ? 1 : -1) * (pr.a0 || 0)); }); }
        bal2 = r.balance; pending = [];
      } else if (r.balance !== null) { bal2 = r.balance; pending.forEach(function () { signed2.push(null); }); pending = []; }
    });
    pending.forEach(function () { signed2.push(null); });
    best = { hits: hits2, misses: misses2, signed: signed2, end: ambiguous || misses2.length ? null : bal2 }; proved = hits2 > 0 && misses2.length === 0 && !ambiguous;
  }
  // rows after the LAST printed balance are covered only when a closing balance line follows them
  var lastBalIx = -1; rows.forEach(function (r, i) { if (r.balance !== null) { lastBalIx = i; } });
  var tailRows = rows.length - 1 - lastBalIx;
  var closingOk = closing === null ? null : (best.end !== null && best.end === closing);
  var tailUnchecked = tailRows > 0 && closingOk !== true ? tailRows : 0;
  var tx = []; var unresolved = []; var totalIn = 0; var totalOut = 0;
  rows.forEach(function (r, i) {
    var a = best.signed[i];
    if (a === null) { unresolved.push({ date: r.date, description: r.description, figure: ((r.a0 !== null ? r.a0 : r.a1) || 0) / 100 }); return; } // kept and reported — never silently dropped
    if (a === 0) { return; }
    if (a > 0) { totalIn += a; } else { totalOut -= a; }
    tx.push({ date: r.date, description: r.description, amount: a / 100 });
  });
  var check = { rows: tx.length, lines_found: rows.length, pages: (pages || []).length, opening: opening === null ? null : opening / 100, closing: closing === null ? null : closing / 100, total_in: totalIn / 100, total_out: totalOut / 100,
    balances_checked: best.hits + best.misses.length, balances_agree: best.hits, mismatches: best.misses.slice(0, 20), closing_agrees: closingOk, rows_without_a_proved_sign: unresolved.length,
    direction_proved: proved, two_readings_fit: ambiguous, rows_after_the_last_balance: tailUnchecked, first_date: rows[0].date, last_date: rows[rows.length - 1].date };
  check.ok = proved && !ambiguous && best.misses.length === 0 && unresolved.length === 0 && closingOk !== false && best.hits > 0 && tailUnchecked === 0;
  // ok = the PDF could be read · importable = every row is proved against the bank's own balances. ONLY importable rows may be saved.
  return { ok: true, error: null, importable: check.ok === true, transactions: check.ok === true ? tx : [], read_rows: tx, unresolved: unresolved, check: check };
}

// why a statement that was read is NOT allowed in (plain words; '' when it is allowed)
export function statementRefusalText(check) {
  if (!check || check.ok === true) { return ''; }
  var m = function (n) { return n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var why = [];
  if (!check.balances_checked && !check.two_readings_fit) { why.push('the statement prints no running balance to check the rows against'); }
  if (check.two_readings_fit) { why.push('the balances fit BOTH ways round, so it cannot be proved which amounts are money in and which are money out'); }
  if (check.mismatches && check.mismatches.length) { why.push(check.mismatches.length + ' printed balance' + (check.mismatches.length === 1 ? ' does' : 's do') + ' not agree with the rows (first: ' + check.mismatches[0].date + ' — the bank prints ' + m(check.mismatches[0].expected) + ')'); }
  if (check.rows_without_a_proved_sign && !check.two_readings_fit) { why.push(check.rows_without_a_proved_sign + ' row' + (check.rows_without_a_proved_sign === 1 ? '' : 's') + ' could not be proved as money in or money out'); }
  if (check.closing_agrees === false) { why.push('the closing balance ' + m(check.closing) + ' does not match'); }
  if (check.rows_after_the_last_balance) { why.push('the last ' + check.rows_after_the_last_balance + ' row' + (check.rows_after_the_last_balance === 1 ? ' is' : 's are') + ' not covered by any printed balance (the file may be cut short)'); }
  if (!why.length) { why.push('the rows could not be proved against the bank’s balances'); }
  return 'NOT imported — ' + why.join('; ') + '. Nothing from this PDF was added. Use the bank’s Excel export for this statement, or send the PDF to Claude.';
}

// THE GATE (Codex 16:03): what a read PDF may hand to the import. Rows only when every one is proved; otherwise none, with the reason.
export function pdfRowsForImport(res, fileName) {
  var name = String(fileName || 'PDF');
  if (!res || res.ok !== true) { return { rows: [], refused: true, reason: name + ': ' + ((res && res.error) || 'the PDF could not be read.'), note: null }; }
  if (res.importable !== true || !res.check || res.check.ok !== true) { return { rows: [], refused: true, reason: name + ': ' + statementRefusalText(res.check), note: { name: name, ok: false, text: name + ': ' + statementRefusalText(res.check), short: name + ': ' + statementRefusalText(res.check).replace(/\d[\d,]*\.\d{2}/g, '•••') } }; }
  return { refused: false, reason: null,
    rows: res.transactions.map(function (t, i) { return { date: t.date, description: t.description, amount: t.amount, _include: true, _row: i + 1, _src: 'pdf', _pdfOk: true, _pdfFile: name }; }),
    note: { name: name, ok: true, text: statementCheckText(res.check, name), short: name + ': ' + res.check.rows + ' rows read from ' + res.check.pages + ' page' + (res.check.pages === 1 ? '' : 's') + '. Checked against the bank’s own running balance: everything agrees.' } };
}
// second lock, used again at the moment of saving: a PDF row that does not carry the proof mark blocks the whole import
export function importBlockedByPdf(rows) {
  var bad = (rows || []).filter(function (r) { return r && r._src === 'pdf' && r._pdfOk !== true; });
  return bad.length ? 'Import stopped: ' + bad.length + ' row' + (bad.length === 1 ? '' : 's') + ' from a PDF statement ' + (bad.length === 1 ? 'is' : 'are') + ' not proved against the bank’s balances. Nothing was saved.' : '';
}

// what the screen says after reading a PDF (one short text; plain words)
export function statementCheckText(check, fileName) {
  if (!check) { return ''; }
  var m = function (n) { return n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var head = (fileName ? fileName + ': ' : '') + check.rows + ' rows read from ' + check.pages + ' page' + (check.pages === 1 ? '' : 's') + ' (' + check.first_date + ' to ' + check.last_date + '). Money in ' + m(check.total_in) + ', money out ' + m(check.total_out) + '.';
  if (check.ok) { return head + ' CHECKED against the bank’s own running balance: all ' + check.balances_agree + ' printed balances agree' + (check.closing_agrees === true ? ', and the closing balance ' + m(check.closing) + ' matches.' : '.'); }
  return head.replace(check.rows + ' rows read', check.lines_found + ' lines found') + ' ' + statementRefusalText(check);
}
