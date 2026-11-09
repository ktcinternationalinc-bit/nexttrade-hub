// v55.83-RQ — bill LINES, the commission split and the price rules.
// Max, Nov 9 21:10 / 21:18:
//  "FOR all of NEXPAC BILLS ... broken down for each product billed line with 2 lines. actual cost and commission line"
//  "so it is supposed to be cost then 12.5% is added to the cost"
//  "we also need a section to enter the prices of the types of products supplied so the HUB can validate that the correct
//   prices were entered into the bill. Same for trucking.. or any other type of charge.. there should be a rule creation
//   where we can enter the types of services or supplies and the expected cost that the HUB can initially validate.. if
//   there is an issue that the HUB sees, then it should flag it for manual intervention."
// Learned from the real bills (Nov 9 21:19): a NexPac bill prints every product AT COST (qty LBS × rate) and then ONE
// "Commission 12.5%" line = 12.5% × the product total. The Hub spreads that commission back onto each product line, so
// every product shows two lines: its cost and its commission. A trucking bill (Trinity "LINEHAUL", AMB "Line Haul" +
// "Rail swing Fee") is a list of charges.
// Pure functions: the route, the screens and the tests all run THESE rules.

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function normText(s) { return String(s == null ? '' : s).toLowerCase().replace(/\(([^)]*)\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }

export var LINE_KINDS = ['item', 'charge', 'commission'];
export var LINE_KIND_LABEL = { item: 'Product', charge: 'Charge / service', commission: 'Commission' };
export function isCommissionText(desc) { return /\bcommission\b/i.test(String(desc || '')); }

// which commission rule (if any) covers this vendor — "NexPac" matches "NexPac Corporation", "NEXPAC Inc." …
export function commissionRuleFor(rules, vendorName) {
  var v = normText(vendorName); if (!v) { return null; }
  var best = null;
  (rules || []).forEach(function (r) {
    if (r.active === false) { return; }
    var m = normText(r.vendor_match); if (!m) { return; }
    if (v.indexOf(m) >= 0 && (!best || m.length > normText(best.vendor_match).length)) { best = r; }
  });
  return best;
}

function num(x) {
  if (x === '' || x == null) { return null; }
  var n = typeof x === 'number' ? x : Number(String(x).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}

// one line as stored (no money split yet — see splitBill)
export function shapeLine(raw, i) {
  var qty = num(raw.qty); var price = num(raw.unit_price); var amount = num(raw.amount);
  if (amount == null && qty != null && price != null) { amount = qty * price; }
  var desc = String(raw.description || '').trim().substring(0, 300);
  var kind = LINE_KINDS.indexOf(raw.line_kind) >= 0 ? raw.line_kind : (isCommissionText(desc) ? 'commission' : (raw.line_kind === 'charge' ? 'charge' : 'item'));
  var unitM = /\(([^)]{1,12})\)\s*$/.exec(desc); // "Cambridge Seconds (LBS)" → LBS
  return {
    line_no: Number(raw.line_no) || (i != null ? i + 1 : null),
    line_kind: kind,
    description: desc,
    item_key: normText(raw.item_key || desc).substring(0, 120) || null,
    qty: qty, unit: String(raw.unit || (unitM ? unitM[1] : '') || '').trim().toUpperCase().substring(0, 20) || null,
    unit_price: price != null ? Math.round(price * 100000) / 100000 : null,
    amount: amount != null ? r2(amount) : null,
    cost_amount: null, commission_amount: null, commission_rate: null,
  };
}

// Spread the bill's commission line(s) over its product lines, in proportion to their cost, to the cent
// (largest remainder — the shares add up EXACTLY to the commission printed on the bill).
// Returns { lines, issues } — issues feed the price check.
export function splitBill(lines, commissionRule) {
  var ls = (lines || []).map(function (l) { return Object.assign({}, l, { cost_amount: null, commission_amount: null, commission_rate: null }); });
  var issues = [];
  if (!commissionRule) { return { lines: ls, issues: issues }; }
  var rate = Number(commissionRule.rate);
  var items = ls.filter(function (l) { return l.line_kind === 'item' && l.amount != null; });
  var comms = ls.filter(function (l) { return l.line_kind === 'commission'; });
  var costTotal = r2(items.reduce(function (a, l) { return a + l.amount; }, 0));
  var commTotal = r2(comms.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0));
  var expected = r2(costTotal * rate);
  if (!comms.length) {
    issues.push({ code: 'COMMISSION_MISSING', text: 'No commission line on this ' + commissionRule.vendor_match + ' bill — expected ' + (rate * 100) + '% of $' + costTotal.toFixed(2) + ' = $' + expected.toFixed(2) + '.', expected: expected, actual: 0 });
  } else if (Math.abs(commTotal - expected) > 0.02) {
    issues.push({ code: 'COMMISSION_RATE', text: 'Commission on the bill is $' + commTotal.toFixed(2) + ' but ' + (rate * 100) + '% of the product cost $' + costTotal.toFixed(2) + ' is $' + expected.toFixed(2) + '.', expected: expected, actual: commTotal });
  }
  if (!items.length || costTotal <= 0) { return { lines: ls, issues: issues }; }
  var cents = Math.round(commTotal * 100); var given = 0; var parts = [];
  items.forEach(function (l, k) { var exact = cents * l.amount / costTotal; var fl = Math.floor(exact); given += fl; parts.push({ k: k, fl: fl, rem: exact - fl }); });
  parts.sort(function (a, b) { return b.rem - a.rem || a.k - b.k; }).forEach(function (p, j) { if (j < cents - given) { p.fl += 1; } });
  parts.sort(function (a, b) { return a.k - b.k; });
  items.forEach(function (l, k) { l.cost_amount = l.amount; l.commission_amount = parts[k].fl / 100; l.commission_rate = rate; });
  return { lines: ls, issues: issues };
}

// the most specific active rule for a line: vendor + item beats item alone beats a rule for the bill type
function ruleScore(rule, bill, line) {
  if (rule.active === false) { return -1; }
  var s = 0;
  if (rule.vendor_match) { if (normText(bill.vendor_name).indexOf(normText(rule.vendor_match)) < 0) { return -1; } s += 4; }
  if (rule.bill_type) { if (rule.bill_type !== bill.bill_type) { return -1; } s += 1; }
  if (rule.item_match) {
    if (!line) { return -1; }
    var words = normText(rule.item_match).split(' ').filter(Boolean);
    var hay = ' ' + normText(line.description) + ' ' + normText(line.item_key) + ' ';
    if (!words.length || !words.every(function (w) { return hay.indexOf(' ' + w + ' ') >= 0; })) { return -1; }
    s += 8 + words.length;
  } else if (line) { return -1; } // a whole-bill rule is not a line rule
  if (rule.unit && line && line.unit && normText(rule.unit) !== normText(line.unit)) { return -1; }
  return s;
}
export function matchRule(rules, bill, line) {
  var best = null; var bestS = -1;
  (rules || []).forEach(function (r) { var sc = ruleScore(r, bill, line); if (sc > bestS) { best = r; bestS = sc; } });
  return best;
}

function off(actual, expected, tolPct) {
  var tol = Math.max(0, Number(tolPct == null ? 2 : tolPct)) / 100;
  var diff = Math.round((actual - expected) * 100000) / 100000;
  var allowed = Math.max(0.005, Math.abs(expected) * tol);
  return Math.abs(diff) > allowed + 1e-9 ? diff : 0;
}
function money(n) { var v = Number(n) || 0; return '$' + (Math.abs(v) < 1 && v !== 0 ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : v.toFixed(2)); }

// The Hub's first look at a bill. status: ok | flagged | no_rules
// flags = manual intervention (shown on the bill; resolved in writing before it can be validated).
export function priceCheck(bill, lines, rules, commissionRule) {
  var flags = []; var notes = []; var checked = 0;
  var sp = splitBill(lines, commissionRule);
  var ls = sp.lines;
  sp.issues.forEach(function (x) { flags.push(x); });
  var total = r2(bill.total_amount);
  if (ls.length) {
    var sum = r2(ls.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0));
    if (Math.abs(sum - total) > 0.01) { flags.push({ code: 'LINES_TOTAL', text: 'The lines add up to $' + sum.toFixed(2) + ' but the bill total is $' + total.toFixed(2) + '.', expected: total, actual: sum }); }
  }
  ls.forEach(function (l) {
    if (l.line_kind === 'commission') { return; }
    var label = 'Line ' + (l.line_no || '?') + ' (' + (l.description || 'no description') + ')';
    if (l.qty != null && l.unit_price != null && l.amount != null && Math.abs(r2(l.qty * l.unit_price) - l.amount) > Math.max(0.02, Math.abs(l.amount) * 0.001)) {
      flags.push({ code: 'QTY_X_PRICE', line_no: l.line_no, text: label + ': ' + l.qty + ' × ' + money(l.unit_price) + ' = $' + r2(l.qty * l.unit_price).toFixed(2) + ', but the line says $' + Number(l.amount).toFixed(2) + '.', expected: r2(l.qty * l.unit_price), actual: l.amount });
    }
    var rule = matchRule(rules, bill, l);
    if (!rule) { notes.push({ code: 'NO_RULE', line_no: l.line_no, text: label + ': no price rule yet — nothing to compare it with.' }); return; }
    checked++;
    // the bill prints products AT COST; a rule "on the billed price" means cost + the commission
    var withComm = !!commissionRule && rule.applies_to === 'billed' && l.line_kind === 'item';
    var factor = withComm ? 1 + Number(commissionRule.rate) : 1;
    var unitActual = l.unit_price != null ? Number(l.unit_price) * factor : (l.qty ? (Number(l.amount) || 0) * factor / l.qty : null);
    if (rule.expected_unit_price != null && unitActual != null) {
      var d = off(unitActual, Number(rule.expected_unit_price), rule.tolerance_pct);
      if (d) { flags.push({ code: d > 0 ? 'PRICE_HIGH' : 'PRICE_LOW', line_no: l.line_no, rule_id: rule.id, text: label + ': ' + money(unitActual) + (l.unit ? '/' + l.unit : '') + ' vs the expected ' + money(rule.expected_unit_price) + (rule.unit ? '/' + rule.unit : '') + '.', expected: Number(rule.expected_unit_price), actual: unitActual }); }
    } else if (rule.expected_amount != null) {
      var amt = (Number(l.amount) || 0) * factor;
      var d2 = off(amt, Number(rule.expected_amount), rule.tolerance_pct);
      if (d2) { flags.push({ code: d2 > 0 ? 'PRICE_HIGH' : 'PRICE_LOW', line_no: l.line_no, rule_id: rule.id, text: label + ': $' + amt.toFixed(2) + ' vs the expected $' + Number(rule.expected_amount).toFixed(2) + '.', expected: Number(rule.expected_amount), actual: amt }); }
    } else {
      flags.push({ code: 'NO_UNIT_PRICE', line_no: l.line_no, rule_id: rule.id, text: label + ': the price rule is per ' + (rule.unit || 'unit') + ' but the line has no quantity / rate to check it.' });
    }
  });
  // a whole-bill rule (e.g. "AMB Logistic, trucking: $2,050 a load")
  var billRule = matchRule(rules, bill, null);
  if (billRule && billRule.expected_amount != null) {
    checked++;
    var d3 = off(total, Number(billRule.expected_amount), billRule.tolerance_pct);
    if (d3) { flags.push({ code: d3 > 0 ? 'PRICE_HIGH' : 'PRICE_LOW', rule_id: billRule.id, text: 'Bill total $' + total.toFixed(2) + ' vs the expected $' + Number(billRule.expected_amount).toFixed(2) + (billRule.note ? ' (' + billRule.note + ')' : '') + '.', expected: Number(billRule.expected_amount), actual: total }); }
  }
  var status = flags.length ? 'flagged' : (checked ? 'ok' : 'no_rules');
  return { status: status, flags: flags, notes: notes, checked: checked, lines: ls.length, split_lines: ls };
}

export var PRICE_STATUS_LABEL = { ok: '✅ prices match the rules', flagged: '⚠ flagged — needs a person', no_rules: '— no price rule applies yet', not_checked: '… not checked yet' };

// ── reports ────────────────────────────────────────────────────────────────
// periods Max named: since June 1st, last week, month, quarter, last year, custom
export var REPORT_PERIODS = [
  ['since_jun1', 'Since June 1'], ['last_7', 'Last 7 days'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['this_quarter', 'This quarter'], ['last_quarter', 'Last quarter'], ['this_year', 'This year'], ['last_year', 'Last year'], ['custom', 'Custom dates'],
];
function iso(d) { return d.toISOString().substring(0, 10); }
export function periodRange(key, todayIso, custom) {
  var t = new Date((todayIso || iso(new Date())) + 'T00:00:00Z'); var y = t.getUTCFullYear(); var m = t.getUTCMonth();
  function D(yy, mm, dd) { return new Date(Date.UTC(yy, mm, dd)); }
  var q = Math.floor(m / 3);
  switch (key) {
    case 'since_jun1': { var jy = m >= 5 ? y : y - 1; return { from: iso(D(jy, 5, 1)), to: iso(t) }; }
    case 'last_7': return { from: iso(D(y, m, t.getUTCDate() - 6)), to: iso(t) };
    case 'last_week': { var dow = (t.getUTCDay() + 6) % 7; var mon = D(y, m, t.getUTCDate() - dow - 7); return { from: iso(mon), to: iso(D(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6)) }; }
    case 'this_month': return { from: iso(D(y, m, 1)), to: iso(t) };
    case 'last_month': return { from: iso(D(y, m - 1, 1)), to: iso(D(y, m, 0)) };
    case 'this_quarter': return { from: iso(D(y, q * 3, 1)), to: iso(t) };
    case 'last_quarter': return { from: iso(D(y, q * 3 - 3, 1)), to: iso(D(y, q * 3, 0)) };
    case 'this_year': return { from: iso(D(y, 0, 1)), to: iso(t) };
    case 'last_year': return { from: iso(D(y - 1, 0, 1)), to: iso(D(y - 1, 11, 31)) };
    default: return { from: (custom && custom.from) || iso(D(y, 0, 1)), to: (custom && custom.to) || iso(t) };
  }
}

// Product inventory from commission-vendor bills (NexPac): like items added together — qty, cost, commission, billed, paid
// paidShare(bill) = paid / total of that bill (payments are per bill; each line gets its proportional part)
export function productInventory(bills, linesByBill, paidByBill, range) {
  var by = {};
  (bills || []).forEach(function (b) {
    if (b.record_status !== 'active') { return; }
    if (range && (String(b.bill_date || '') < range.from || String(b.bill_date || '') > range.to)) { return; }
    var tot = Number(b.total_amount) || 0; var share = tot > 0 ? Math.min(1, (Number(paidByBill[b.id]) || 0) / tot) : 0;
    (linesByBill[b.id] || []).forEach(function (l) {
      if (l.line_kind !== 'item') { return; }
      var k = (l.item_key || normText(l.description)) + '|' + (l.unit || '');
      var row = by[k] || (by[k] = { item: l.description.replace(/\s*\([^)]*\)\s*$/, ''), item_key: l.item_key, unit: l.unit, qty: 0, cost: 0, commission: 0, billed: 0, paid: 0, bills: 0, vendors: {} });
      var cost = Number(l.cost_amount != null ? l.cost_amount : l.amount) || 0; var com = Number(l.commission_amount) || 0;
      row.qty += Number(l.qty) || 0; row.cost += cost; row.commission += com; row.billed += cost + com; row.paid += (cost + com) * share; row.bills += 1; row.vendors[b.vendor_name] = true;
    });
  });
  return Object.keys(by).map(function (k) { var r = by[k]; return Object.assign(r, { qty: Math.round(r.qty * 1000) / 1000, cost: r2(r.cost), commission: r2(r.commission), billed: r2(r.billed), paid: r2(r.paid), avg_cost: r.qty ? Math.round(r.cost / r.qty * 10000) / 10000 : null, vendors: Object.keys(r.vendors) }); })
    .sort(function (a, b) { return b.billed - a.billed; });
}

// Charges & services billed (every bill that is not a commission vendor's product bill): by type, by vendor, by service
export function spendReport(bills, linesByBill, paymentsByBill, range, opts) {
  var o = opts || {}; var byType = {}; var byVendor = {}; var byService = {}; var tot = { billed: 0, paid: 0, bills: 0 };
  function add(map, key, label, billed, paid, extra) {
    var r = map[key] || (map[key] = Object.assign({ key: key, label: label, billed: 0, paid: 0, bills: 0, first: null, last: null }, extra || {}));
    r.billed += billed; r.paid += paid; return r;
  }
  (bills || []).forEach(function (b) {
    if (b.record_status !== 'active') { return; }
    if (o.skip && o.skip(b)) { return; }
    var inRange = !range || (String(b.bill_date || '') >= range.from && String(b.bill_date || '') <= range.to);
    var paidIn = 0; (paymentsByBill[b.id] || []).forEach(function (p) { if (p.voided === true) { return; } if (!range || (String(p.paid_date || '') >= range.from && String(p.paid_date || '') <= range.to)) { paidIn += Number(p.amount) || 0; } });
    var billed = inRange ? (Number(b.total_amount) || 0) : 0;
    if (!billed && !paidIn) { return; }
    var t = b.bill_type || 'unsorted';
    [add(byType, t, t, billed, paidIn), add(byVendor, b.vendor_name || '?', b.vendor_name || '?', billed, paidIn, { type: b.bill_type || null })].forEach(function (r) {
      if (billed) { r.bills += 1; if (!r.first || b.bill_date < r.first) { r.first = b.bill_date; } if (!r.last || b.bill_date > r.last) { r.last = b.bill_date; } }
    });
    var ls = (linesByBill[b.id] || []).filter(function (l) { return l.line_kind !== 'commission'; });
    var tb = Number(b.total_amount) || 0;
    if (ls.length) {
      ls.forEach(function (l) { var la = Number(l.amount) || 0; var sv = add(byService, (l.item_key || '?') + '|' + (b.bill_type || ''), l.description.replace(/\s*\([^)]*\)\s*$/, ''), inRange ? la : 0, tb > 0 ? paidIn * la / tb : 0, { type: b.bill_type || null }); if (inRange) { sv.bills += 1; } });
    } else {
      var sv0 = add(byService, '(whole bill)|' + t, '(whole bill — no lines)', billed, paidIn, { type: b.bill_type || null }); if (billed) { sv0.bills += 1; }
    }
    tot.billed += billed; tot.paid += paidIn; if (billed) { tot.bills += 1; }
  });
  function out(map) { return Object.keys(map).map(function (k) { var r = map[k]; r.billed = r2(r.billed); r.paid = r2(r.paid); return r; }).sort(function (a, b) { return b.billed - a.billed; }); }
  return { by_type: out(byType), by_vendor: out(byVendor), by_service: out(byService), totals: { billed: r2(tot.billed), paid: r2(tot.paid), bills: tot.bills } };
}
