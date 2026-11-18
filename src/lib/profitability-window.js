// v55.83-UD (Codex 12:15 P1 · Max's history-window rule) — what an employee with a finite history window may see of the
// Profitability answer. The engine still COSTS permitted sales with older purchases (the numbers stay right); only the RECORDS of
// bills dated before the window's first day are taken out of the answer: cost sources, the "no cost" bill lines, the bill-name list's
// quantities / costs / vendors / dates and a group's first-link date. Totals are never changed. Pure. SWC-safe.

function before(d, floor) { return !!d && String(d).substring(0, 10) < floor; }

export function projectForWindow(out, floor) {
  if (!floor || !out) { return out; }
  var oldBill = {};
  (out.cells || []).forEach(function (c) {
    var keep = []; var hidden = 0;
    (c.cost_sources || []).forEach(function (s) { if (!s.bill_date || before(s.bill_date, floor)) { hidden++; if (s.bill_id) { oldBill[s.bill_id] = true; } } else { keep.push(s); } });
    c.cost_sources = keep; if (hidden) { c.cost_sources_hidden = hidden; }
  });
  (out.cells || []).forEach(function (c) {
    if (c.missing_cost_lines && c.missing_cost_lines.length) {
      var n0 = c.missing_cost_lines.length;
      c.missing_cost_lines = c.missing_cost_lines.filter(function (m) { return !(m.bill_id && oldBill[m.bill_id]); });
      if (c.missing_cost_lines.length < n0) { c.missing_cost_lines_hidden = n0 - c.missing_cost_lines.length; }
    }
  });
  // the bill-name set-up list sums EVERY purchase line ever: names and units only (no quantities, costs, vendors or dates)
  if (Array.isArray(out.bill_names)) {
    out.bill_names = out.bill_names.map(function (b) { return { key: b.key, name: b.name, units: b.units, usable_lines: b.usable_lines, unit_from_name: b.unit_from_name, history_hidden: true }; });
  }
  (out.groups || []).forEach(function (g) { if (g.link_stats && before(g.link_stats.first, floor)) { g.link_stats = { lines: g.link_stats.lines, usable: g.link_stats.usable, first: null }; } });
  out.window_floor = floor;
  return out;
}
