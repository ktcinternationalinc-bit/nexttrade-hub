// v55.83-WF step C — THE ACCOUNTANT PACK's spending files, as pure functions so the exact CSV text can be run in a test
// (Codex 20 Nov 18:00: the pack re-bucketed NextTrade's transfers on the client and undid the tax rule).
// THE TAX PRESENTATION (Max, 20 Nov 2026): every transfer to RTM Capital / NextTrade Industries is ONE Professional-fees
// amount, in full, on its bank date. The server already delivers the categories that way (spend.categories). The pack must
// print them AS THEY ARE: no company is re-bucketed into "real costs" or an "advance" here, whatever its kind or era and
// whatever the on-screen tax / real-cost switch says. (The internal real-cost view lives on the screen, not in this pack.)
// This is the report layout Max asked for; the accountant confirms treatment and timing.
// Pure. Safe on server and browser. SWC-safe.
function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
function n2(x) { return (Number(x) || 0).toFixed(2); }

// the categories the pack prints: the server's, with a stray "uncategorized" category folded into the ⚠ Uncategorized line
export function taxPackCats(cats) {
  var shift = 0;
  var out = (cats || []).filter(function (c) { if (c && c.key === 'uncategorized') { shift += Number(c.total) || 0; return false; } return !!c; });
  out.uncShift = Math.round(shift * 100) / 100;
  return out;
}
export function taxPackUncOut(spending) {
  var u = spending && spending.uncategorized; if (!u) { return 0; }
  return Math.max(0, Math.round((Number(u.total) + taxPackCats(spending.categories).uncShift) * 100) / 100);
}

// tax-pack-7-spending-by-category
export function spendingByCategoryCsv(spending, kindLabels) {
  var KL = kindLabels || {}; var sp = ['category,type,transactions,total_usd']; var cats = taxPackCats(spending.categories);
  cats.forEach(function (c) { sp.push(q(c.label) + ',' + (KL[c.kind] || c.kind || 'Expense') + ',' + c.count + ',' + n2(c.total)); });
  if (spending.not_pnl_out && spending.not_pnl_out.count > 0) { sp.push('"NOT P&L - loan principal / owner (NOT deductible)",,' + spending.not_pnl_out.count + ',' + n2(spending.not_pnl_out.total)); }
  if (spending.deductible_spending !== undefined) {
    var ded = 0; cats.forEach(function (c) { if (c.kind !== 'not_pnl' && c.key !== 'transfer' && c.key !== 'uncategorized') { ded += Number(c.total) || 0; } });
    sp.push('"DEDUCTIBLE SPENDING (P&L categories only; every transfer to RTM / NextTrade is in Professional fees, once, in full)",,,' + n2(ded));
  }
  // v55.83-XO — the transfers line shows the transfers alone; bills paid from a starting balance (1 June 2026 on) get their own line
  var fst = spending.funds_sent_tax; var fstSb = fst ? Number(fst.from_starting_balance) || 0 : 0;
  var fstN = fst ? (fst.transfers_count !== undefined ? fst.transfers_count : fst.count) : 0; var fstT = fst ? (fst.transfers_total !== undefined ? fst.transfers_total : fst.total) : 0;
  if (fst && fstN > 0) { sp.push(q('  of which transfers to RTM / NextTrade (inside ' + (fst.label || 'Professional fees') + ')') + ',' + ',' + fstN + ',' + n2(fstT)); }
  if (fst && fstSb > 0.004) { sp.push(q('  of which bills paid from a starting balance with RTM / NextTrade, a new expense when used from 1 June 2026 (inside ' + (fst.label || 'Professional fees') + ')') + ',' + ',' + (fst.from_starting_balance_count || 0) + ',' + n2(fstSb)); }
  // v55.83-XR (Max 22 Nov, Option 1) — money RTM / NextTrade sent back reduces that same line in the month it came back (file 8: a negative row)
  var mbk = fst && fst.money_back;
  if (mbk && mbk.count > 0) { sp.push(q('  less money back from RTM / NextTrade (already taken off ' + (fst.label || 'Professional fees') + '; not income)') + ',' + ',' + mbk.count + ',-' + n2(mbk.total)); }
  if (spending.uncategorized) { sp.push('"UNCATEGORIZED (needs review before filing)",' + spending.uncategorized.count + ',' + n2(taxPackUncOut(spending))); }
  if (spending.transfers) { sp.push('"TRANSFERS BETWEEN OWN ACCOUNTS (not deductible spending)",' + spending.transfers.count + ',' + n2(spending.transfers.total)); }
  sp.push('"REAL SPENDING (transfers excluded)",,' + n2(spending.real_spending));
  return sp;
}

// tax-pack-8-spending-detail — one row per bank line, with the SAME category the summary counted it in
export function spendingDetailCsv(spending) {
  var det = ['date,who,amount,category,paired_transfer'];
  (spending.rows || []).forEach(function (r) { det.push(r.date + ',' + q(r.who) + ',' + n2(r.amount) + ',' + (r.category || 'UNCATEGORIZED') + ',' + (r.paired ? 'yes' : '')); });
  return det;
}

// tax-pack-12-income-statement-cash-basis
export function incomeStatementCsv(spending) {
  var rev = 0, cogs = 0, exp = 0, oin = 0, oex = 0;
  (spending.in_categories || []).forEach(function (c) { if (c.kind === 'income') { rev += c.total; } else if (c.kind === 'other_income') { oin += c.total; } });
  taxPackCats(spending.categories).forEach(function (c) { if (c.kind === 'cogs') { cogs += c.total; } else if (c.kind === 'other_expense') { oex += c.total; } else if (c.kind !== 'not_pnl') { exp += c.total; } });
  var out = ['line,amount_usd'];
  out.push('"Revenue (cash received)",' + n2(rev));
  out.push('"Cost of goods sold",-' + n2(cogs));
  out.push('"GROSS PROFIT",' + n2(rev - cogs));
  out.push('"Operating expenses",-' + n2(exp));
  out.push('"OPERATING PROFIT",' + n2(rev - cogs - exp));
  out.push('"Other income",' + n2(oin));
  out.push('"Other expenses",-' + n2(oex));
  out.push('"NET PROFIT (cash basis)",' + n2(rev - cogs - exp + oin - oex));
  if (spending.in_uncategorized && spending.in_uncategorized.total > 0.005) { out.push('"WARNING: uncategorized deposits OUTSIDE this statement",' + n2(spending.in_uncategorized.total)); }
  var u = taxPackUncOut(spending); if (u > 0.005) { out.push('"WARNING: uncategorized spending OUTSIDE this statement",' + n2(u)); }
  return out;
}
