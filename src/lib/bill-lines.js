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
  ls.forEach(function (l) { if (l.line_kind !== 'commission' && isCommissionText(l.description)) { l.line_kind = 'commission'; } }); // review #6
  var items = ls.filter(function (l) { return l.line_kind === 'item' && l.amount != null; });
  var comms = ls.filter(function (l) { return l.line_kind === 'commission'; });
  var costTotal = r2(items.reduce(function (a, l) { return a + l.amount; }, 0));
  var commTotal = r2(comms.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0));
  var expected = r2(costTotal * rate);
  if (!items.length) { return { lines: ls, issues: issues, no_items: true }; } // review #5 — no lines yet: the check says so as a note
  if (!comms.length) {
    issues.push({ code: 'COMMISSION_MISSING', cols: { issue: 'Commission line missing', where: 'Whole bill', billed: '$0.00', expected: dollars(expected) + ' (' + (rate * 100) + '% of ' + dollars(costTotal) + ')', diff: '−' + dollars(expected), effect: 'No commission billed', rule: commissionRule.vendor_match + ' bills cost + ' + (rate * 100) + '%' }, text: 'No commission line on this ' + commissionRule.vendor_match + ' bill — expected ' + (rate * 100) + '% of $' + costTotal.toFixed(2) + ' = $' + expected.toFixed(2) + '.', expected: expected, actual: 0 });
  } else if (Math.abs(commTotal - expected) > 0.02) {
    issues.push({ code: 'COMMISSION_RATE', impact: r2(commTotal - expected), cols: { issue: commTotal > expected ? 'Commission too high' : 'Commission too low', where: 'Commission line', billed: dollars(commTotal) + ' (' + (costTotal ? Math.round(commTotal / costTotal * 10000) / 100 : 0) + '%)', expected: dollars(expected) + ' (' + (rate * 100) + '% of ' + dollars(costTotal) + ')', diff: (commTotal > expected ? '+' : '−') + dollars(commTotal - expected), effect: dollars(commTotal - expected) + (commTotal > expected ? ' overcharged' : ' undercharged'), rule: commissionRule.vendor_match + ' bills cost + ' + (rate * 100) + '%' }, text: 'Commission: billed $' + commTotal.toFixed(2) + ', expected ' + (rate * 100) + '% of the product cost $' + costTotal.toFixed(2) + ' = $' + expected.toFixed(2) + ' — $' + Math.abs(r2(commTotal - expected)).toFixed(2) + ' ' + (commTotal > expected ? 'TOO HIGH' : 'TOO LOW') + ' (that is ' + (costTotal ? Math.round(commTotal / costTotal * 10000) / 100 : 0) + '% instead of ' + (rate * 100) + '%).', expected: expected, actual: commTotal });
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
  // review #7 — a unit spelling never switches a rule off silently: same unit (LB = LBS = pounds) or a UNIT flag in priceCheck
  return s;
}
var UNIT_SYN = { lb: 'lbs', lbs: 'lbs', pound: 'lbs', pounds: 'lbs', kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  m: 'm', mt: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', yd: 'yd', yds: 'yd', yard: 'yd', yards: 'yd',
  ea: 'ea', each: 'ea', pc: 'ea', pcs: 'ea', piece: 'ea', pieces: 'ea', unit: 'ea', units: 'ea', roll: 'roll', rolls: 'roll',
  load: 'load', loads: 'load', flat: 'flat', 'flat rate': 'flat', flatrate: 'flat', container: 'container', containers: 'container', cntr: 'container' };
export function normUnit(u) { var k = normText(u); return UNIT_SYN[k] || UNIT_SYN[k.replace(/s$/, '')] || k; }

export function matchRule(rules, bill, line) {
  var best = null; var bestS = -1;
  (rules || []).forEach(function (r) { var sc = ruleScore(r, bill, line); if (sc > bestS) { best = r; bestS = sc; } });
  return best;
}

// minAllowed: dollar amounts keep half a cent for rounding; a per-unit RATE is compared exactly (NexPac rates are 5–26 cents)
function off(actual, expected, tolPct, minAllowed) {
  var tol = Math.max(0, Number(tolPct == null ? 2 : tolPct)) / 100;
  var diff = Math.round((actual - expected) * 100000) / 100000;
  var allowed = Math.max(minAllowed == null ? 0.005 : minAllowed, Math.abs(expected) * tol);
  return Math.abs(diff) > allowed + 1e-9 ? diff : 0;
}
function money(n) { var v = Number(n) || 0; var t = Math.abs(v) < 1 && v !== 0 ? v.toFixed(4).replace(/0{1,2}$/, '') : v.toFixed(2); return '$' + t; } // $0.10, $0.105, $2.50

// v55.83-RU (Max, Nov 9 21:49: "the price check should always check based on the rules when importing and flagging if
// something looks off stating what exactly is off") — every flag says: what was billed, what the rule says (and which rule),
// the difference per unit and in %, and what it costs in dollars on this bill.
function ruleWords(rule) {
  var w = [];
  if (rule.vendor_match) { w.push(rule.vendor_match); }
  if (rule.item_match) { w.push('“' + rule.item_match + '”'); }
  if (rule.bill_type) { w.push(String(rule.bill_type).replace('_', ' / ')); }
  return 'rule: ' + w.join(', ') + (rule.applies_to === 'billed' ? ', price incl. commission' : '') + (rule.note ? ' — ' + rule.note : '') + ', ±' + Number(rule.tolerance_pct == null ? 2 : rule.tolerance_pct) + '% allowed';
}
function pctOf(diff, base) { return base ? (diff > 0 ? '+' : '−') + Math.abs(Math.round(diff / base * 1000) / 10) + '%' : ''; }
function dollars(n) { return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function qtyWords(q, unit) { return Number(q).toLocaleString('en-US', { maximumFractionDigits: 3 }) + (unit ? ' ' + unit : ''); }

// The Hub's first look at a bill. status: ok | flagged | no_rules
// flags = manual intervention (shown on the bill; resolved in writing before it can be validated).
export function priceCheck(bill, lines, rules, commissionRule) {
  var flags = []; var notes = []; var checked = 0;
  var sp = splitBill(lines, commissionRule);
  var ls = sp.lines;
  sp.issues.forEach(function (x) { flags.push(x); });
  if (sp.no_items && commissionRule) { notes.push({ code: 'NO_LINES', item: 'no product lines yet — add the lines to check the ' + (Number(commissionRule.rate) * 100) + '% commission', text: 'No product lines on this bill yet — add them so the commission and prices can be checked.' }); }
  var total = r2(bill.total_amount);
  if (ls.length) {
    var sum = r2(ls.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0));
    if (Math.abs(sum - total) > 0.01) { flags.push({ code: 'LINES_TOTAL', impact: r2(total - sum), cols: { issue: 'Lines do not add up', where: 'Whole bill', billed: dollars(total) + ' bill total', expected: dollars(sum) + ' sum of lines', diff: (total > sum ? '+' : '−') + dollars(total - sum), effect: total > sum ? dollars(total - sum) + ' billed with no line' : dollars(total - sum) + ' of lines not in the total', rule: 'Lines must equal the total' }, text: 'The lines add up to ' + dollars(sum) + ' but the bill total is ' + dollars(total) + ' — ' + dollars(total - sum) + ' ' + (total > sum ? 'is billed without a line for it' : 'of lines is missing from the total') + '.', expected: total, actual: sum }); }
  }
  ls.forEach(function (l) {
    if (l.line_kind === 'commission') { return; }
    var label = 'Line ' + (l.line_no || '?') + ' (' + (l.description || 'no description') + ')';
    var whereL = 'Line ' + (l.line_no || '?') + ' · ' + (l.description || 'no description');
    if (l.qty != null && l.unit_price != null && l.amount != null && Math.abs(r2(l.qty * l.unit_price) - l.amount) > Math.max(0.02, Math.abs(l.amount) * 0.001)) {
      flags.push({ code: 'QTY_X_PRICE', line_no: l.line_no, impact: r2(l.amount - l.qty * l.unit_price), cols: { issue: 'Line math wrong', where: whereL, billed: dollars(l.amount), expected: dollars(l.qty * l.unit_price) + ' (' + qtyWords(l.qty, l.unit) + ' × ' + money(l.unit_price) + ')', diff: (l.amount > l.qty * l.unit_price ? '+' : '−') + dollars(l.amount - l.qty * l.unit_price), effect: dollars(l.amount - l.qty * l.unit_price) + (l.amount > l.qty * l.unit_price ? ' overcharged' : ' undercharged'), rule: 'Qty × rate = amount' }, text: label + ': ' + qtyWords(l.qty, l.unit) + ' × ' + money(l.unit_price) + ' = ' + dollars(l.qty * l.unit_price) + ', but the line charges ' + dollars(l.amount) + ' — ' + dollars(l.amount - l.qty * l.unit_price) + ' ' + (l.amount > l.qty * l.unit_price ? 'more' : 'less') + ' than the math.', expected: r2(l.qty * l.unit_price), actual: l.amount });
    }
    var rule = matchRule(rules, bill, l);
    if (rule && rule.unit && l.unit && normUnit(rule.unit) !== normUnit(l.unit) && rule.expected_unit_price != null) {
      checked++;
      flags.push({ code: 'UNIT_MISMATCH', line_no: l.line_no, rule_id: rule.id, cols: { issue: 'Different unit', where: 'Line ' + (l.line_no || '?') + ' · ' + (l.description || ''), billed: (l.unit_price != null ? money(l.unit_price) : '—') + ' per ' + l.unit, expected: money(rule.expected_unit_price) + ' per ' + rule.unit, diff: '—', effect: 'Cannot compare — billed per ' + l.unit + ', rule is per ' + rule.unit, rule: ruleWords(rule).replace(/^rule: /, '') },
        text: label + ': billed per ' + l.unit + ' but the price rule is per ' + rule.unit + ' — check the price by hand or fix the rule’s unit. [' + ruleWords(rule) + ']' });
      return;
    }
    if (!rule) { notes.push({ code: 'NO_RULE', line_no: l.line_no, item: l.description || ('Line ' + l.line_no), text: label + ': no price rule yet — nothing to compare it with.' }); return; }
    checked++;
    // the bill prints products AT COST; a rule "on the billed price" means cost + the commission
    var withComm = !!commissionRule && rule.applies_to === 'billed' && l.line_kind === 'item';
    var factor = withComm ? 1 + Number(commissionRule.rate) : 1;
    var unitActual = l.unit_price != null ? Number(l.unit_price) * factor : (l.qty ? (Number(l.amount) || 0) * factor / l.qty : null);
    if (rule.expected_unit_price != null && unitActual != null) {
      var d = off(unitActual, Number(rule.expected_unit_price), rule.tolerance_pct, 0.0000005);
      if (d) {
        var perU = (l.unit || rule.unit) ? '/' + (l.unit || rule.unit) : '';
        var impact = l.qty != null ? r2(d * l.qty) : null;
        flags.push({ code: d > 0 ? 'PRICE_HIGH' : 'PRICE_LOW', line_no: l.line_no, rule_id: rule.id, impact: impact, expected: Number(rule.expected_unit_price), actual: unitActual,
          cols: { issue: d > 0 ? 'Price too high' : 'Price too low', where: whereL, billed: money(unitActual) + perU + (withComm ? ' (incl. commission)' : ''), expected: money(rule.expected_unit_price) + perU, diff: (d > 0 ? '+' : '−') + money(Math.abs(d)) + perU + ' (' + pctOf(d, Number(rule.expected_unit_price)) + ')',
            effect: impact != null ? dollars(impact) + (d > 0 ? ' overcharged' : ' undercharged') + ' on ' + qtyWords(l.qty, l.unit) : '—', rule: ruleWords(rule).replace(/^rule: /, '') },
          text: label + ': billed ' + money(unitActual) + perU + (withComm ? ' (incl. commission)' : '') + ', expected ' + money(rule.expected_unit_price) + perU + ' — ' + money(Math.abs(d)) + perU + ' ' + (d > 0 ? 'TOO HIGH' : 'TOO LOW') + ' (' + pctOf(d, Number(rule.expected_unit_price)) + ')' +
            (impact != null ? '; on ' + qtyWords(l.qty, l.unit) + ' that is ' + dollars(impact) + ' ' + (d > 0 ? 'more' : 'less') + ' than expected' : '') + '. [' + ruleWords(rule) + ']' });
      }
    } else if (rule.expected_amount != null) {
      var amt = (Number(l.amount) || 0) * factor;
      var d2 = off(amt, Number(rule.expected_amount), rule.tolerance_pct);
      if (d2) { flags.push({ code: d2 > 0 ? 'PRICE_HIGH' : 'PRICE_LOW', line_no: l.line_no, rule_id: rule.id, impact: r2(d2), expected: Number(rule.expected_amount), actual: amt,
        cols: { issue: d2 > 0 ? 'Charge too high' : 'Charge too low', where: whereL, billed: dollars(amt), expected: dollars(Number(rule.expected_amount)), diff: (d2 > 0 ? '+' : '−') + dollars(d2) + ' (' + pctOf(d2, Number(rule.expected_amount)) + ')', effect: dollars(d2) + (d2 > 0 ? ' overcharged' : ' undercharged'), rule: ruleWords(rule).replace(/^rule: /, '') },
        text: label + ': billed ' + dollars(amt) + ', expected ' + dollars(Number(rule.expected_amount)) + ' — ' + dollars(d2) + ' ' + (d2 > 0 ? 'TOO HIGH' : 'TOO LOW') + ' (' + pctOf(d2, Number(rule.expected_amount)) + '). [' + ruleWords(rule) + ']' }); }
    } else {
      flags.push({ code: 'NO_UNIT_PRICE', line_no: l.line_no, rule_id: rule.id, cols: { issue: 'Cannot check price', where: whereL, billed: l.amount != null ? dollars(l.amount) : '—', expected: money(rule.expected_unit_price) + '/' + (rule.unit || 'unit'), diff: '—', effect: 'No qty / rate on the line', rule: ruleWords(rule).replace(/^rule: /, '') }, text: label + ': the price rule is per ' + (rule.unit || 'unit') + ' but the line has no quantity / rate to check it.' });
    }
  });
  // a whole-bill rule (e.g. "AMB Logistic, trucking: $2,050 a load")
  var billRule = matchRule(rules, bill, null);
  if (billRule && billRule.expected_amount != null) {
    checked++;
    var d3 = off(total, Number(billRule.expected_amount), billRule.tolerance_pct);
    if (d3) { flags.push({ code: d3 > 0 ? 'PRICE_HIGH' : 'PRICE_LOW', rule_id: billRule.id, impact: r2(d3), expected: Number(billRule.expected_amount), actual: total,
      cols: { issue: d3 > 0 ? 'Bill total too high' : 'Bill total too low', where: 'Whole bill', billed: dollars(total), expected: dollars(Number(billRule.expected_amount)), diff: (d3 > 0 ? '+' : '−') + dollars(d3) + ' (' + pctOf(d3, Number(billRule.expected_amount)) + ')', effect: dollars(d3) + (d3 > 0 ? ' overcharged' : ' undercharged'), rule: ruleWords(billRule).replace(/^rule: /, '') },
      text: 'Bill total: billed ' + dollars(total) + ', expected ' + dollars(Number(billRule.expected_amount)) + ' — ' + dollars(d3) + ' ' + (d3 > 0 ? 'TOO HIGH' : 'TOO LOW') + ' (' + pctOf(d3, Number(billRule.expected_amount)) + '). [' + ruleWords(billRule) + ']' }); }
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
