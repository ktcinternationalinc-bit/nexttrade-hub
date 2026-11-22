// v55.83 — HUB → WAREHOUSE product-cost feed (Max, Nov 22 2026; Advanced PNL "Option B / Model P").
//
// READ ONLY. Exposes, per Hub product group, the SAME "Avg Cost All / LB" the Profitability report shows:
// an ALL-TIME, SALES-WEIGHTED BLENDED figure = (goods cost + commission + $0.02/lb inbound allowance) ÷ the
// pounds SOLD of that product, in USD per lb. It is NOT a purchase-weighted average and NOT the actual cost of
// any one warehouse shipment — the warehouse uses it as a blended allocated cost. The quantity returned is the
// pounds SOLD behind the figure (pounds_sold), not pounds purchased. The response carries a self-describing
// `basis` block so consumers cannot mistake what it is. Nothing here is written; no customer or PII is returned.
//
// Secured by a long secret token in the X-Hub-Cost-Token header (HUB_COST_TOKEN) because product cost is
// sensitive. No token configured = the feed is switched off (503). The token is compared in constant time.
// House rule for API routes: var + concat only.

import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';
import { assembleProfitability } from '../../../../lib/profitability-assemble';
import { loadProfitabilityInput } from '../../../../lib/profitability-load-server';

export const maxDuration = 60;

var API_BUILD_MARKER = 'v55.83-product-costs-feed';
var FEED_HEADERS = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', Vary: 'X-Hub-Cost-Token' };

function feedJson(body, status) {
  return Response.json(body, { status: status || 200, headers: FEED_HEADERS });
}

// constant-time token check; the feed is OFF unless a long token is configured
function tokenOk(request) {
  var expected = String(process.env.HUB_COST_TOKEN || '');
  if (expected.length < 32 || /[\r\n]/.test(expected)) { return 'off'; }
  var given = String(request.headers.get('x-hub-cost-token') || '');
  var a = Buffer.from(given);
  var b = Buffer.from(expected);
  if (a.length !== b.length) { return false; }
  return timingSafeEqual(a, b);
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function GET(request) {
  var state = tokenOk(request);
  if (state === 'off') { return feedJson({ ok: false, error: 'product-cost feed is not configured (HUB_COST_TOKEN)', api_build_marker: API_BUILD_MARKER }, 503); }
  if (state !== true) { return feedJson({ ok: false, error: 'unauthorized', api_build_marker: API_BUILD_MARKER }, 401); }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return feedJson({ ok: false, error: 'the hub server database connection needs configuration', api_build_marker: API_BUILD_MARKER }, 503);
  }

  try {
    var ld = await loadProfitabilityInput(admin());
    if (ld.setup_needed) { return feedJson({ ok: false, error: 'profitability set-up tables are not installed in the hub yet', api_build_marker: API_BUILD_MARKER }, 503); }

    // all-time blended average (no history window) — this is the lifetime "Avg Cost All / LB", internal cost basis only
    var out = assembleProfitability(Object.assign({ date_from: null, date_to: null }, ld.input));
    var rows = (out && out.by_product) || [];

    var products = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var avg = (r.avg_all_cost_per_lb === null || r.avg_all_cost_per_lb === undefined) ? null : Number(r.avg_all_cost_per_lb);
      products.push({
        product_key: String(r.key),
        product_name: String(r.label || r.key),
        grouped: r.grouped === true,
        // ALL-TIME sales-weighted blended cost in USD/lb; null stays null (unknown), never 0
        avg_all_cost_per_lb: (avg === null || isNaN(avg)) ? null : avg,
        // the pounds SOLD behind the figure (NOT pounds purchased)
        pounds_sold: (r.pounds === null || r.pounds === undefined) ? null : Number(r.pounds)
      });
    }

    // self-describing contract so the warehouse cannot mistake what this number is
    var basis = {
      metric: 'hub_blended_all_time',
      weight_basis: 'sales',            // the pounds are SOLD pounds, not purchased
      cost_units: 'USD/lb',
      scope: 'all_time',
      components: 'goods cost + commission + inbound allowance',
      excludes: 'brokerage, bonded, outbound shipping',
      note: 'Sales-weighted blended Hub cost (same as Profitability "Avg Cost All / LB"). Use as an allocated goods cost, not a verified actual shipment cost.'
    };

    return feedJson({ ok: true, as_of: new Date().toISOString(), basis: basis, count: products.length, products: products, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return feedJson({ ok: false, error: 'product-cost feed read failed', api_build_marker: API_BUILD_MARKER }, 500);
  }
}
