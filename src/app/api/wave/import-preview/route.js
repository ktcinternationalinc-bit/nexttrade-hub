// v55.83-AK — Wave import PREVIEW (read-only, paginated). Pulls actual customer
// or invoice records for a chosen business so we can see exactly what would be
// imported. Writes NOTHING. Token stays server-side.
import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { verifiedCaller } from '../../../../lib/verified-caller'; // v55.83-WQ
import { revenueScope, REVENUE_REFUSAL } from '../../../../lib/revenue-visibility'; // v55.83-XK
export const dynamic = 'force-dynamic';
// v55.83-YY — this GET-only route never keeps its reads in Next's Data Cache (it would otherwise keep them forever, across deployments)
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export async function GET(request) {
  // v55.83-WQ (Codex 21 Nov, F3) — answers only a verified, signed-in Hub user (this route had no sign-in check)
  var whoWQ = await verifiedCaller(request, null, createClient);
  if (whoWQ.error) { return Response.json({ ok: false, error: whoWQ.error }, { status: whoWQ.status || 401 }); }
  // v55.83-XK — Wave invoice totals / paid / due: never for a researcher ("P&L: See sales & revenue" off); fails closed
  var rsXK = await revenueScope(createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }), whoWQ.userId);
  if (rsXK.error) { return Response.json({ ok: false, error: rsXK.error }, { status: rsXK.status }); }
  if (!rsXK.canSee) { return Response.json({ ok: false, error: REVENUE_REFUSAL }, { status: 403 }); }
  var token = process.env.WAVE_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ ok: false, configured: false, error: 'No Wave token configured. Add WAVE_ACCESS_TOKEN in Vercel and redeploy.' });
  }
  var url = new URL(request.url);
  var businessId = url.searchParams.get('businessId');
  var type = url.searchParams.get('type') || 'customers';
  var page = parseInt(url.searchParams.get('page') || '1', 10);
  if (!businessId) {
    return Response.json({ ok: false, error: 'Missing businessId — choose a business first.' });
  }
  if (!(page > 0)) { page = 1; }
  var inner;
  if (type === 'invoices') {
    inner = 'invoices(page:$page,pageSize:25){ pageInfo{ currentPage totalPages totalCount } edges{ node{ id invoiceNumber status invoiceDate total{ value } amountPaid{ value } amountDue{ value } customer{ id name } } } }';
  } else {
    type = 'customers';
    inner = 'customers(page:$page,pageSize:25){ pageInfo{ currentPage totalPages totalCount } edges{ node{ id name email phone } } }';
  }
  var query = 'query($bid: ID!, $page: Int!) { business(id:$bid){ id name ' + inner + ' } }';
  try {
    var resp = await fetch('https://gql.waveapps.com/graphql/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ query: query, variables: { bid: businessId, page: page } })
    });
    var json = null;
    try { json = await resp.json(); } catch (parseErr) { json = null; }
    if (!resp.ok) {
      var detail = json && json.errors && json.errors[0] ? json.errors[0].message : ('HTTP ' + resp.status);
      return Response.json({ ok: false, error: 'Wave rejected the request: ' + detail });
    }
    if (json && json.errors && json.errors.length) {
      return Response.json({ ok: false, error: 'Wave API error: ' + (json.errors[0].message || 'unknown') });
    }
    var biz = json && json.data && json.data.business;
    if (!biz) {
      return Response.json({ ok: false, error: 'No business found for that ID on this token.' });
    }
    var conn = type === 'invoices' ? biz.invoices : biz.customers;
    var pi = conn && conn.pageInfo ? conn.pageInfo : {};
    var items = (conn && conn.edges ? conn.edges : []).map(function (e) { return e.node; });
    return Response.json({
      ok: true, type: type, businessName: biz.name,
      totalCount: pi.totalCount, currentPage: pi.currentPage, totalPages: pi.totalPages,
      items: items
    });
  } catch (e) {
    return Response.json({ ok: false, error: 'Could not reach Wave: ' + ((e && e.message) || 'network error') });
  }
}
