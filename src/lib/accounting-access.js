// v55.83-RE — Unified Accounting Permissions (Max, Nov 8 15:12, "Claude
// Implementation Instructions — KTC Hub & Wave Hub — Unified Accounting
// Permissions"). ONE definition used by every accounting screen (ClickBooks /
// KTC Hub and the Wave Hub screens) and by the server, so both hubs behave
// identically:
//
//   P1  accounting.view           Accounting Access — opens the Accounting
//                                 module in both hubs; REQUIRED before any other
//                                 accounting permission takes effect.
//   P2  accounting.view_totals    Bank & Financial Summary — Bank Balance,
//                                 Came In, Went Out, Sales, Net Moved,
//                                 Projected Net.
//   P3  accounting.view_invoicing Invoicing & Collections — Invoiced, Paid,
//                                 Still Open, Collected (+ their records).
//   Always visible with P1: Expected (≤30 / 31–60 / 61–90 / 90+), Bills Due,
//   Late, Total Overdue — clickable to their records.
//
// Card navigation is NOT tied to P2: a card is clickable when its own group is
// allowed. A P2 card without P2 shows "Restricted" and does not open (its rows
// would add up to the restricted number). Super admin (and the owner/admin
// roles, which the server already treats as all-permissions) see everything.
// Pure functions — the launch test runs them for real.

// v55.83-RF (Max, Nov 8 15:25: "2 switches with same permissioning for both")
// — P1 is now TWO area switches, one per hub, with the SAME P2/P3 rules inside
// each:  P1a accounting.clickbooks.access → ClickBooks (KTC Hub) screens;
//        P1b accounting.wavehub.access    → Wave Hub screens.
// The Accounting menu shows with either. The RE key accounting.view is
// retired but still honoured as "both" so nobody is locked out before the RF
// SQL moves its holders onto the two switches.
export var P1 = 'accounting.view'; // retired — counts as both hubs
export var P1_KTC = 'accounting.clickbooks.access';
export var P1_WAVE = 'accounting.wavehub.access';
export var P2 = 'accounting.view_totals';
export var P3 = 'accounting.view_invoicing';
export var KTC_SCREENS = ['books_home', 'all_txns', 'categories', 'bills', 'wires', 'period_stats', 'forecast', 'clickbooks_reports', 'clickbooks_admin'];
export var WAVE_SCREENS = ['dashboard', 'review', 'invoices', 'all_invoices', 'proformas', 'recon', 'customers', 'arhistory', 'ledger', 'balances', 'sales_report', 'pnl', 'purchaseorders', 'wavehub', 'company'];

// hub: 'ktc' | 'wave' | undefined (= either hub)
export function acctAccess(isSuperAdmin, mp, role, hub) {
  var all = isSuperAdmin === true || role === 'owner' || role === 'admin';
  var m = mp || {};
  var legacy = m[P1] === true;
  var ktc = all || legacy || m[P1_KTC] === true;
  var wave = all || legacy || m[P1_WAVE] === true;
  var access = hub === 'ktc' ? ktc : hub === 'wave' ? wave : (ktc || wave);
  return {
    access: access,
    ktc: ktc,
    wave: wave,
    fin: access && (all || m[P2] === true),
    inv: access && (all || m[P3] === true),
    ops: access,
  };
}
// Which hub a screen belongs to ('both' for the audit trail).
export function screenHub(key) { return KTC_SCREENS.indexOf(key) >= 0 ? 'ktc' : WAVE_SCREENS.indexOf(key) >= 0 ? 'wave' : 'both'; }

// Which group a dashboard value belongs to.
export var CARD_GROUP = {
  bank_balance: 'fin', came_in: 'fin', went_out: 'fin', sales: 'fin', net_moved: 'fin', projected_net: 'fin',
  invoiced: 'inv', paid: 'inv', still_open: 'inv', collected: 'inv',
  expected: 'ops', bills_due: 'ops', late: 'ops', total_overdue: 'ops',
};
export function cardAllowed(v, card) { var g = CARD_GROUP[card] || 'fin'; return !!(v && v[g]); }

function nullNums(o, keys) {
  if (!o) { return o; }
  var c = Object.assign({}, o);
  keys.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(c, k)) { c[k] = null; } });
  return c;
}
var LOCKED_DRILL = { masked: true, count: null, sum: null, rows: [] };

// Books (cash flow): Came In / Went Out / Net Moved / Sales / Projected Net are
// P2; Expected In and Bills Due (with their records) stay with P1.
export function maskCashflow(p, v) {
  if (!p || (v && v.fin)) { return p; }
  var o = Object.assign({}, p);
  o.summary = p.summary ? Object.keys(p.summary).reduce(function (a, k) { a[k] = null; return a; }, {}) : p.summary;
  o.sales_in = null; o.sales_in_count = null;
  if (p.ahead) { o.ahead = nullNums(p.ahead, ['projected_net']); }
  if (p.drills) {
    o.drills = Object.assign({}, p.drills, { sales_in: LOCKED_DRILL, came_in: LOCKED_DRILL, went_out: LOCKED_DRILL });
  }
  o.fin_restricted = true;
  return o;
}

// Stats / period engine: invoice figures are P3; bill payments, net cash and
// the spending/income analysis (Went Out, Sales) are P2; bills entered and
// bills still open (what we owe) stay with P1 like Bills Due.
export function maskPeriodStats(p, v) {
  if (!p) { return p; }
  var o = Object.assign({}, p);
  var d = Object.assign({}, p.drills || {});
  if (!(v && v.inv)) {
    o.invoices = p.invoices ? Object.keys(p.invoices).reduce(function (a, k) { a[k] = null; return a; }, {}) : p.invoices;
    d.invoiced = []; d.collected = []; d.collected_on_period = []; d.open_invoices = [];
    o.inv_restricted = true;
  }
  if (!(v && v.fin)) {
    o.bills = nullNums(p.bills, ['paid', 'paid_count']);
    d.bills_paid = [];
    o.spending = null;
    o.fin_restricted = true;
  }
  o.drills = d;
  o.months = (p.months || []).map(function (m) {
    var c = Object.assign({}, m);
    if (!(v && v.inv)) { ['invoiced', 'invoiced_count', 'collected', 'collected_count'].forEach(function (k) { if (k in c) { c[k] = null; } }); }
    if (!(v && v.fin)) { ['bills_paid', 'bills_paid_count', 'bill_payments', 'net_cash', 'net'].forEach(function (k) { if (k in c) { c[k] = null; } }); }
    return c;
  });
  return o;
}

// Forecast: expected (D buckets), late (L buckets) and bills due stay with P1;
// the net / running position and the bank balance are P2.
export function maskForecast(p, v) {
  if (!p || (v && v.fin)) { return p; }
  var o = Object.assign({}, p);
  if (p.buckets) {
    o.buckets = {};
    Object.keys(p.buckets).forEach(function (k) { o.buckets[k] = nullNums(p.buckets[k], ['net', 'running']); });
  }
  o.bank_balance = null;
  o.fin_restricted = true;
  return o;
}
