// v55.83-VT — P&L by period: WHAT IS BEHIND each expense figure (Max, Nov 20 2026: "i already asked this to be able to click on
// expenses to see the underlying" · "make sure there is no double counting with professional fees and the underlying fees that
// it pays").
// Nothing is worked out a second time and nothing is asked from the server again: this only takes apart the SAME Income
// Statement answer (period_stats → spending) the figure came from, in the real-cost look:
//   the figure of a category = its bank lines
//                            + bills paid from an advance and booked here by the server
//                            − money sent to a paid-through company (RTM Capital / NextTrade) that was booked here
//                            + the bills that company paid which belong here
//   and anything the lists cannot explain is ONE visible line ("other adjustments"), never hidden.
// Pure. Money in whole cents.
import { remainderRows } from './paid-through-blocks';

function cents(x) { return Math.round((Number(x) || 0) * 100); }

// spending = the Income Statement's spending block; rc = realCostCategories(spending, adjust, fold) → { cats, uncategorized }.
// Returns { byKey: { <category key>: makeup }, not_pnl: [{ key, label, cents }], transfers_cents, rows_listed }.
export function expenseDetail(spending, rc) {
  var sp = spending || {}; var out = { byKey: {}, not_pnl: [], transfers_cents: cents(sp.transfers && sp.transfers.total), rows_listed: Array.isArray(sp.rows) };
  var blocks = sp.paid_through || (sp.rtm ? [sp.rtm] : []);
  var orig = {}; (sp.categories || []).forEach(function (c) { orig[c.key] = c; });
  var rowsBy = {}; (sp.rows || []).forEach(function (r) { var k = r.category || 'uncategorized'; (rowsBy[k] = rowsBy[k] || []).push({ id: r.id || null, date: r.date || '', who: r.who || '', cents: cents(r.amount) }); });
  var remOf = {}; blocks.forEach(function (b) { remainderRows(b).forEach(function (rw) { remOf[rw.key] = { block: b, row: rw }; }); });

  function makeup(key, label, figure) {
    var m = { key: key, label: label, cents: figure, bank: null, from_advances_cents: 0, taken_out: [], taken_out_cents: 0, bills: { cents: 0, listed_cents: 0, rows: [] }, remainder: null, other_cents: 0 };
    if (remOf[key]) {
      // what is left of the money sent to a paid-through company after the bills it paid — it has no lines of its own
      var b = remOf[key].block;
      m.remainder = { payer: b.payer || '', era_note: b.era_note || null, payments_cents: cents(b.payments_total), payments_count: Number(b.payments_count) || 0, bills_cents: cents(b.allocations_total),
        left_cents: cents(b.service_fee), fees_booked_cents: cents(b.fees_booked), waiting_cents: cents(b.waiting), other_left_cents: cents(b.remainder_other), advance_held_cents: cents(b.advance_held) };
      m.adds_up = true; return m;
    }
    var o = key === 'uncategorized' ? { total: sp.uncategorized && sp.uncategorized.total, count: sp.uncategorized && sp.uncategorized.count } : (orig[key] || null);
    var list = (rowsBy[key] || []).slice().sort(function (a, c) { return c.cents - a.cents; });
    var listed = list.reduce(function (a, r) { return a + r.cents; }, 0);
    var fromAdv = o && o.from_advances ? cents(o.from_advances) : 0;
    var bankCents = o ? cents(o.total) - fromAdv : 0;
    m.from_advances_cents = fromAdv;
    m.bank = { cents: bankCents, count: o ? (Number(o.count) || 0) : 0, rows: list, listed_cents: listed, unlisted_cents: bankCents - listed };
    blocks.forEach(function (b) {
      (b.payments_by_cat || []).forEach(function (p) { if (p.key === key) { var v = cents(p.total); if (v) { m.taken_out.push({ payer: b.payer || '', era_note: b.era_note || null, cents: v, from_advance: p.from_advance === true }); m.taken_out_cents += v; } } });
      (b.allocations_by_cat || []).forEach(function (a) { if (a.key === key) { m.bills.cents += cents(a.total); } });
      (b.rows || []).forEach(function (r) { if ((r.category || 'uncategorized') === key) { var v2 = cents(r.amount); m.bills.rows.push({ date: r.date || '', who: r.who || '', ref: r.ref || '', cents: v2, payer: b.payer || '' }); m.bills.listed_cents += v2; } });
    });
    m.bills.rows.sort(function (a, c) { return c.cents - a.cents; });
    m.other_cents = figure - (bankCents + fromAdv - m.taken_out_cents + m.bills.cents);
    m.adds_up = m.other_cents === 0;
    return m;
  }

  ((rc && rc.cats) || []).forEach(function (c) {
    var v = cents(c.total);
    if (String(c.kind || '') === 'not_pnl') { if (v) { out.not_pnl.push({ key: c.key, label: c.label || c.key, cents: v }); } }
    out.byKey[c.key] = makeup(c.key, c.label || c.key, v);
  });
  out.byKey.uncategorized = makeup('uncategorized', 'No category at all', cents(rc && rc.uncategorized));
  return out;
}

// The formula of one row of P&L by period, with that row's own numbers: what was USED and what was NOT.
// r = a period row (cents); e = its expense answer ({ status, cols, detail } or null); hidden = profit not shown to this person.
// Returns { lines: [{ sign: '' | '−' | '=', label, cents (null = not known / not shown), strong }], not_used: [{ label, cents, why }], notes: [] }.
export function pnlFormula(r, e, hidden) {
  var row = r || {}; var ok = !!(e && e.status === 'ok' && e.cols); var cols = ok ? e.cols : null;
  function n(v) { return hidden ? null : (v === undefined || v === null ? null : v); }
  var lines = [
    { sign: '', label: 'Goods revenue (what the goods were sold for)', cents: row.goods_revenue },
    { sign: '−', label: 'Goods cost = supplier cost + commission + inbound allowance + bonded', cents: row.goods_cost },
    { sign: '=', label: 'GOODS PROFIT', cents: n(row.goods_profit), strong: true },
    { sign: '', label: 'Transport charged to customers', cents: row.transport_revenue },
    { sign: '−', label: 'Trucking (our cost: bill, else typed figure, else estimate)', cents: row.trucking_cost },
    { sign: '−', label: 'Freight / shipping (our cost: bill, else typed figure, else estimate)', cents: row.freight_cost },
    // Codex 12:06 — a shipping amount kept as ONE combined figure is neither trucking nor freight: taken off exactly once, under its own name
    { sign: '−', label: 'Shipping kept as one combined amount (not divided into trucking / freight)', cents: row.combined_cost || 0, combined: true },
    { sign: '=', label: 'TRANSPORT PROFIT', cents: n(row.transport_profit), strong: true },
    { sign: '=', label: 'TOTAL PROFIT = goods profit + transport profit', cents: n(row.profit), strong: true },
    { sign: '−', label: 'A · Warehouse / Office', cents: cols ? cols.A.cents : null },
    { sign: '−', label: 'C · Partner fee', cents: cols ? cols.C.cents : null },
    { sign: '−', label: 'D · Payroll', cents: cols ? cols.D.cents : null },
    { sign: '−', label: 'E · Taxes', cents: cols ? cols.E.cents : null },
    { sign: '=', label: 'FINAL P&L = total profit − A − C − D − E', cents: (cols && !hidden && row.profit !== undefined && row.profit !== null) ? row.profit - cols.total : null, strong: true }
  ];
  lines = lines.filter(function (l) { return !(l.combined && !l.cents); });
  var not = [];
  if (cols && cols.unassigned.cents) { not.push({ label: 'Uncategorized expenses', cents: cols.unassigned.cents, why: 'money out with no category yet — not taken off until it gets one' }); }
  if (cols && cols.in_profit.cents) { not.push({ label: 'Paid to suppliers, truckers, brokers', cents: cols.in_profit.cents, why: 'ASSUMED already inside goods cost and transport cost above, so not taken off a second time — decided by the category name, not checked bill by bill' }); }
  var det = ok ? e.detail : null;
  if (det) {
    (det.not_pnl || []).forEach(function (x) { not.push({ label: x.label, cents: x.cents, why: 'not a cost of the period (loan, owner money or an advance still held)' }); });
    if (det.transfers_cents) { not.push({ label: 'Transfers between our own accounts', cents: det.transfers_cents, why: 'money moved, not spent' }); }
  }
  if (row.uncounted > 0) { not.push({ label: 'Revenue of ' + row.uncounted + ' sale line(s) whose cost is not known', cents: row.uncounted_revenue, why: 'adds nothing to profit until the cost is known' }); }
  var notes = ['Profit is dated by invoice date. Expenses are what was PAID in the period (bank date).'];
  if (!ok) { notes.push('The expense columns are not loaded or not shown for this row, so the final figure is not worked out.'); }
  if (row.incomplete > 0) { notes.push(row.incomplete + ' sale line(s) are missing a cost — the profit shown is the known part.'); }
  return { lines: lines, not_used: not, notes: notes };
}

// The invoices of one opened period, one row each, so every one can be opened on top of the page.
// cells = that period's cells. hidden = profit not shown to this person → profit is null on every row.
export function periodInvoices(cells, hidden) {
  var by = {}; var order = [];
  function known(x) { return !(x === null || x === undefined || x === ''); }
  (cells || []).forEach(function (c) {
    var key = String(c.invoice_id || c.invoice || ''); if (!key) { return; }
    var r = by[key]; if (!r) { r = by[key] = { key: key, invoice_id: c.invoice_id || null, invoice: c.invoice || '', date: c.invoice_date || '', customer: c.customer || '', releases: [], lines: 0, sold_cents: 0, profit: 0, missing: 0 }; order.push(key); }
    r.lines += 1;
    var rel = String(c.release_raw || c.release || ''); if (rel && r.releases.indexOf(rel) < 0) { r.releases.push(rel); }
    if (known(c.goods_revenue)) { r.sold_cents += Math.round(Number(c.goods_revenue) * 100); }
    if (known(c.transport_revenue)) { r.sold_cents += Math.round(Number(c.transport_revenue) * 100); }
    if (known(c.profit)) { r.profit += Math.round(Number(c.profit) * 100); } else { r.missing += 1; }
  });
  return order.map(function (k) { var r = by[k]; if (hidden === true) { r.profit = null; r.missing = 0; } return r; })
    .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : (a.invoice < b.invoice ? -1 : 1)); });
}
