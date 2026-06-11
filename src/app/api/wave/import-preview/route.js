// v55.83-AK — Wave import PREVIEW (read-only, paginated). Pulls actual customer
// or invoice records for a chosen business so we can see exactly what would be
// imported. Writes NOTHING. Token stays server-side.
export async function GET(request) {
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
