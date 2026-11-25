// v55.83-AJ — Wave capability audit (read-only, live). Queries the connected
// account for how many customers / invoices / products exist per business, so we
// know exactly what historical data is importable. Token stays server-side.
import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { verifiedCaller } from '../../../../lib/verified-caller'; // v55.83-WQ
export const dynamic = 'force-dynamic';
// v55.83-YY — this GET-only route never keeps its reads in Next's Data Cache (it would otherwise keep them forever, across deployments)
export const revalidate = 0;
export const fetchCache = 'force-no-store';
function cnt(c) { return c && c.pageInfo && typeof c.pageInfo.totalCount === 'number' ? c.pageInfo.totalCount : null; }

export async function GET(req) {
  // v55.83-WQ (Codex 21 Nov, F3) — answers only a verified, signed-in Hub user (this route had no sign-in check)
  var whoWQ = await verifiedCaller(req, null, createClient);
  if (whoWQ.error) { return Response.json({ ok: false, error: whoWQ.error }, { status: whoWQ.status || 401 }); }
  var token = process.env.WAVE_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ ok: false, configured: false, error: 'No Wave token configured. Add WAVE_ACCESS_TOKEN in Vercel and redeploy.' });
  }
  try {
    var query = 'query { businesses(page:1,pageSize:20) { edges { node { id name isClassicInvoicing'
      + ' customers(page:1,pageSize:1){ pageInfo{ totalCount } }'
      + ' invoices(page:1,pageSize:1){ pageInfo{ totalCount } }'
      + ' products(page:1,pageSize:1){ pageInfo{ totalCount } } } } } }';
    var resp = await fetch('https://gql.waveapps.com/graphql/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ query: query })
    });
    var json = null;
    try { json = await resp.json(); } catch (parseErr) { json = null; }
    if (!resp.ok) {
      var detail = json && json.errors && json.errors[0] ? json.errors[0].message : ('HTTP ' + resp.status);
      return Response.json({ ok: false, configured: true, error: 'Wave rejected the request: ' + detail });
    }
    if (json && json.errors && json.errors.length) {
      return Response.json({ ok: false, configured: true, error: 'Wave API error: ' + (json.errors[0].message || 'unknown') });
    }
    var edges = json && json.data && json.data.businesses && json.data.businesses.edges ? json.data.businesses.edges : [];
    var businesses = edges.map(function (e) {
      var n = e.node;
      return {
        id: n.id, name: n.name, isClassicInvoicing: n.isClassicInvoicing === true,
        customers: cnt(n.customers), invoices: cnt(n.invoices), products: cnt(n.products)
      };
    });
    return Response.json({ ok: true, configured: true, businesses: businesses });
  } catch (e) {
    return Response.json({ ok: false, configured: true, error: 'Could not reach Wave: ' + ((e && e.message) || 'network error') });
  }
}
