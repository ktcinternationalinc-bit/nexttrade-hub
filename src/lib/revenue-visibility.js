// v55.83-XK (Max, 22 Nov 2026: "build a permission that hides revenue too") — the SERVER removes every sales / revenue figure,
// and everything revenue can be rebuilt from (profit, margin), before a report leaves the server for a person whose
// 'P&L: See sales & revenue' switch is OFF (a RESEARCHER). Costs, pounds, units, releases, supplier evidence and the open tasks stay.
// Projection is by CONTRACT (named fields, warnings by their kind, cost-or-revenue by context), with a final key pass as a safety
// net only — never the boundary (Codex 22 Nov 19:38). Server-only; SWC-safe: var + concatenation.
import { stripProfit } from './margin-visibility';
import { loadUserPermissions, userHasPermission, revenueSwitchedOff, REVENUE_PERMISSION } from './server-permissions';

export { REVENUE_PERMISSION };
export var REVENUE_NOTE = 'Sales and revenue are hidden for you ("P&L: See sales & revenue" is off) — profit and margin too.';

// ONE permission read per request; every projection of that answer uses it. A failed read refuses (never "no OFF row").
// → { canSee: bool, ctx } | { error, status }
export async function revenueScope(db, userId) {
  var ctx = await loadUserPermissions(db, userId);
  if (ctx.readError && ctx.isSuperAdmin !== true) { return { error: 'Permissions could not be read right now — nothing was shown. Try again.', status: 503 }; }
  return { canSee: ctx.isSuperAdmin === true || !revenueSwitchedOff(ctx), ctx: ctx };
}

// field names that only ever carry a sale / revenue figure (anywhere in a profitability or P&L answer)
var REV_FIELDS = { invoiced: 1, orig_unit_price: 1, unit_price: 1, goods_revenue: 1, transport_revenue: 1, uncounted_revenue: 1, embedded_transport: 1,
  embedded_used: 1, embedded_source: 1, avg_goods_price_per_lb: 1, avg_goods_price_per_yd: 1, revenue: 1, costed_revenue: 1, uncosted_revenue: 1,
  shipping_revenue: 1, shipping_charged: 1, avg_price: 1, avg_price_per_lb: 1, avg_price_per_yd: 1, avg_sale_price: 1, sold_for: 1, charged: 1,
  line_total: 1, grand_total: 1, product_revenue: 1, pounds_revenue: 1, yards_revenue: 1 };
// warnings whose whole payload is about what the customer was charged: only the task stays (kind + which invoice / release)
var REV_FLAG_KINDS = { shipping_charged_below_cost_plus_7pct: 1, shipping_markup_not_checkable: 1, embedded_exceeds_goods: 1, manual_transport_ignored_not_inclusive: 1 };
var KEEP_FLAG_KEYS = ['kind', 'invoice_id', 'invoice', 'release', 'releases', 'line', 'basis', 'basis_source', 'what'];
// unallocated amounts that are customer money (by `what`); every other `what` is a cost and stays whole
var REV_WHAT = { transport_revenue: 1, embedded_transport: 1 };
// safety net: any key left that still says revenue / price / charged / invoiced
var NET = /revenue|invoiced|unit_price|price_per|sale_price|avg_price|charged|sold_for/i;
var NET_ALLOW = { goods_price_confirmed: 1, can_see_revenue: 1, revenue_hidden: 1, revenue_restricted: 1 };

function pick(o, keys) { var r = {}; keys.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(o, k)) { r[k] = o[k]; } }); return r; }

// one warning flag
function projectFlag(f) {
  if (!f || typeof f !== 'object') { return f; }
  if (REV_FLAG_KINDS[f.kind]) { var r = pick(f, KEEP_FLAG_KEYS); r.revenue_hidden = true; return r; }
  // the SAME kind carries a cost (release-level, `what` = a cost field) or customer money (invoice-level, text about transportation)
  if (f.kind === 'allocation_unresolved_missing_weight' && (f.invoice_id || REV_WHAT[f.what] || /transportation/i.test(String(f.what || '')))) {
    var a = pick(f, KEEP_FLAG_KEYS); a.revenue_hidden = true; return a;
  }
  return f;
}
function projectUnallocated(u) {
  if (u && REV_WHAT[u.what]) { var r = pick(u, ['what', 'invoice_id', 'invoice', 'release', 'why']); r.revenue_hidden = true; return r; }
  return u;
}

function deep(v, parentKey) {
  if (Array.isArray(v)) {
    if (parentKey === 'flags') { return v.map(function (f) { return typeof f === 'object' ? deep(projectFlag(f), null) : f; }); }
    if (parentKey === 'unallocated') { return v.map(function (u) { return deep(projectUnallocated(u), null); }); }
    return v.map(function (x) { return deep(x, null); });
  }
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    var out = {};
    Object.keys(v).forEach(function (k) {
      if (REV_FIELDS[k] === 1) { return; }
      if (NET.test(k) && NET_ALLOW[k] !== 1) { return; }
      // `unknown` maps on summary rows list which fields are incomplete — the revenue entries say nothing once revenue is gone
      if (k === 'unknown' && v[k] && typeof v[k] === 'object') { var un = {}; Object.keys(v[k]).forEach(function (u) { if (REV_FIELDS[u] !== 1 && !(NET.test(u) && NET_ALLOW[u] !== 1) && !/profit|margin/i.test(u)) { un[u] = v[k][u]; } }); out[k] = un; return; }
      out[k] = deep(v[k], k);
    });
    return out;
  }
  return v;
}

// The Profitability / P&L answer for a researcher: profit and margin first (stripProfit), then every revenue figure.
export function stripRevenue(answer) {
  var o = deep(stripProfit(answer), null);
  if (o && typeof o === 'object' && !Array.isArray(o)) { o.can_see_revenue = false; o.can_see_margin = false; o.revenue_hidden = true; o.revenue_note = REVENUE_NOTE; }
  return o;
}

// warehouse shipping rows / history: each matched invoice is { id, number, date, total, currency, customer_id } — the total goes,
// anywhere under an `invoices` list (also inside history `changes`); everything else (costs, releases, numbers) stays
export function dropInvoiceTotals(v, parentKey) {
  if (Array.isArray(v)) { return v.map(function (x) { if (parentKey === 'invoices' && x && typeof x === 'object') { var c = Object.assign({}, x); delete c.total; delete c.total_amount; return dropInvoiceTotals(c, null); } return dropInvoiceTotals(x, null); }); }
  if (v && typeof v === 'object' && !(v instanceof Date)) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = dropInvoiceTotals(v[k], k); }); return o; }
  return v;
}

// for routes that answer only with revenue (sales report, customer balances): one refusal text
export var AI_REFUSAL = 'The assistant reads sales and customer money, and "P&L: See sales & revenue" is off for you — it is not available. Ask the super admin.';
export var REVENUE_REFUSAL = 'This shows sales / customer money, and "P&L: See sales & revenue" is off for you — ask the super admin.';
export function canSeeRevenueCtx(ctx) { return userHasPermission(ctx, REVENUE_PERMISSION) || (ctx && ctx.isSuperAdmin === true); }
