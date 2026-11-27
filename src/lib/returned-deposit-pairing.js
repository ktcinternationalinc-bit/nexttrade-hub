// v55.83-ZO (Max, 26 Nov 2026: "returned checks 3964 there should be another part when we deposited in so it should 0 itself out";
// then "yes build") — a returned deposit is two bank lines: the deposit (money in) and the bank's return (money out). Until now the
// two only cancelled when a person put BOTH in the "Returned checks" category. The bank's own text on the return names the deposit:
//   DEPOSITED ITEM RETURNED ... DEP AMT0000396400 DEP DATE060226 CK AMT0000396400
// (deposit amount in cents, deposit date MMDDYY, returned check amount in cents). When a return a person categorized as a returned
// check names its deposit like that, and EXACTLY ONE money-in line IN THE SAME BANK ACCOUNT AND CURRENCY on that date has that exact
// amount, the deposit is netted against the return automatically. Nothing is guessed: no named deposit, none found, more than one
// found, an unknown account / currency, or a return whose amount is not the check amount the bank names = no pairing, and it is
// reported for a person. Nothing is saved: bank lines and their categories are not touched; this only decides how the report counts.
// Pure (no database, no React) so the report route and the tests share it.
// rev 2 (Codex 26 Nov HOLD): same bank account + currency; the debit must equal the parsed CK AMT; off when money-back cannot be read.

function toCents(x) { return Math.round((Number(x) || 0) * 100); }
function cur(t) { return String((t && t.iso_currency) || '').trim().toUpperCase(); }
function acct(t) { return String((t && t.account_id) || '').trim(); }

// the deposit a bank return names, or null when the text does not name one
export function parseReturnText(text) {
  var s = String(text || '');
  if (!/DEPOSITED\s+ITEM\s+RETURNED/i.test(s)) { return null; }
  var m = /DEP\s+AMT\s*(\d{3,})\s*DEP\s+DATE\s*(\d{2})(\d{2})(\d{2})\s*CK\s+AMT\s*(\d{3,})/i.exec(s);
  if (!m) { return null; }
  var depCents = parseInt(m[1], 10); var ckCents = parseInt(m[5], 10);
  var mo = parseInt(m[2], 10), da = parseInt(m[3], 10), yr = 2000 + parseInt(m[4], 10);
  if (!(depCents > 0) || !(ckCents > 0) || mo < 1 || mo > 12 || da < 1 || da > 31) { return null; }
  var dt = new Date(Date.UTC(yr, mo - 1, da));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) { return null; }
  return { deposit_cents: depCents, check_cents: ckCents, deposit_date: yr + '-' + ('0' + mo).slice(-2) + '-' + ('0' + da).slice(-2) };
}

// lines: the period's bank lines { id, date, posted_date, direction, amount_abs, name, classification, transfer_group_id, account_id, iso_currency }
// isReturnCat(key): is this category "Returned checks"
// skipDeposit(line): true for a money-in line that must never be paired (e.g. recorded as money back from RTM / NextTrade)
// opts.disabled: a reason text when pairing must not run at all (the money-back records could not be read, so the exclusion above
//                cannot be checked) → nothing is paired and `skipped` carries the reason
// → { byDeposit: { depositId: { amount, category, return_ids: [], return_date } }, not_paired: [ { return_id, date, amount, deposit_date, deposit_amount, reason } ], count, total, skipped }
// reasons: check_amount_differs · account_unknown · currency_unknown · no_deposit_found · more_than_one_deposit · deposit_already_used
export function pairReturnedDeposits(lines, isReturnCat, skipDeposit, opts) {
  var out = { byDeposit: {}, not_paired: [], count: 0, total: 0, skipped: null };
  if (opts && opts.disabled) { out.skipped = String(opts.disabled); return out; }
  var list = (lines || []).filter(function (t) { return t && t.id; });
  var isTrf = function (t) { return !!t.transfer_group_id || t.classification === 'transfer'; };
  var ins = list.filter(function (t) { return t.direction === 'in' && !isTrf(t) && !(skipDeposit && skipDeposit(t)); });
  var used = {}; // depositId → cents already netted by returns
  var returns = list.filter(function (t) { return t.direction === 'out' && !isTrf(t) && isReturnCat(t.classification); });
  returns.sort(function (a, b) { var da = String(a.posted_date || a.date || ''), db = String(b.posted_date || b.date || ''); return da < db ? -1 : (da > db ? 1 : (String(a.id) < String(b.id) ? -1 : 1)); });
  returns.forEach(function (rt) {
    var p = parseReturnText(rt.name); if (!p) { return; } // the bank did not name a deposit: nothing to do, a person decides
    var retCents = toCents(rt.amount_abs);
    var note = { return_id: rt.id, date: rt.posted_date || rt.date || '', amount: retCents / 100, deposit_date: p.deposit_date, deposit_amount: p.deposit_cents / 100 };
    if (retCents !== p.check_cents) { note.reason = 'check_amount_differs'; note.check_amount = p.check_cents / 100; out.not_paired.push(note); return; } // the bank line and its own text disagree
    if (p.check_cents > p.deposit_cents) { note.reason = 'check_amount_differs'; note.check_amount = p.check_cents / 100; out.not_paired.push(note); return; }
    if (!acct(rt)) { note.reason = 'account_unknown'; out.not_paired.push(note); return; }
    if (!cur(rt)) { note.reason = 'currency_unknown'; out.not_paired.push(note); return; }
    var cand = ins.filter(function (d) { return acct(d) === acct(rt) && cur(d) === cur(rt) && toCents(d.amount_abs) === p.deposit_cents && (d.date === p.deposit_date || d.posted_date === p.deposit_date); });
    if (cand.length === 0) { note.reason = 'no_deposit_found'; out.not_paired.push(note); return; }
    if (cand.length > 1) { note.reason = 'more_than_one_deposit'; out.not_paired.push(note); return; }
    var dep = cand[0];
    if (isReturnCat(dep.classification)) { return; } // a person already put the deposit in the category: it nets the old way
    var left = p.deposit_cents - (used[dep.id] || 0);
    if (retCents > left) { note.reason = 'deposit_already_used'; out.not_paired.push(note); return; } // never part of a return: all of it or none
    used[dep.id] = (used[dep.id] || 0) + retCents;
    var e = out.byDeposit[dep.id] || (out.byDeposit[dep.id] = { amount: 0, category: rt.classification, return_ids: [], return_date: note.date });
    e.amount = Math.round((e.amount * 100) + retCents) / 100; e.return_ids.push(rt.id);
    out.count++; out.total = Math.round((out.total * 100) + retCents) / 100;
  });
  return out;
}
