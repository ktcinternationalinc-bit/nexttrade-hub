// src/lib/wave-csv-columns.js — pure CSV column detection for the Wave Account-Transactions import, extracted
// (Codex Round-2) so it can be unit-tested against a REAL Wave header fixture. The load-bearing rule: the
// signed "Amount (One column)" must NEVER be mis-detected as "Debit Amount (One column)" — both normalize to a
// string containing "amount one column", so the exact match must EXCLUDE debit/credit/withdrawal/deposit.
// Server-safe: var + concat only (imported by an API route).

export function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }

export function findCol(headers, patterns, avoid) {
  var i, h;
  for (i = 0; i < headers.length; i++) {
    h = norm(headers[i]);
    var bad = false; var a;
    if (avoid) { for (a = 0; a < avoid.length; a++) { if (h.indexOf(avoid[a]) >= 0) { bad = true; break; } } }
    if (bad) { continue; }
    var p;
    for (p = 0; p < patterns.length; p++) { if (h.indexOf(patterns[p]) >= 0) { return i; } }
  }
  return -1;
}

// Prefer Wave's exact signed "Amount (One column)" header, EXCLUDING debit/credit/withdrawal/deposit so the
// Debit/Credit one-column variants are never picked; fall back to a generic amount/total (same exclusions).
export function detectAmountCol(headers) {
  var exact = findCol(headers, ['amount one column'], ['debit', 'credit', 'withdrawal', 'deposit']);
  return exact >= 0 ? exact : findCol(headers, ['amount', 'total'], ['running', 'balance', 'debit', 'credit', 'withdrawal', 'deposit']);
}
