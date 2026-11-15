// v55.83-AW — Invoice import DIAGNOSTIC (read-only, no writes). Pulls the first
// page of Wave invoices and returns, per invoice, EVERY money field raw
// (total, subtotal, taxTotal, amountPaid, amountDue) + what num() maps + the
// current DB row, so we can see exactly which Wave field holds the real total.
import { createClient } from '@supabase/supabase-js';

function num(m) { if (!m || m.value == null) { return null; } var v = Number(String(m.value).replace(/,/g, '')); return isNaN(v) ? null : v; }

export async function POST(request) {
  var waveToken = process.env.WAVE_ACCESS_TOKEN;
  var supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!waveToken) { return Response.json({ ok: false, error: 'No Wave token configured.' }); }

  var body = null;
  try { body = await request.json(); } catch (e) { body = {}; }
  var businessId = body && body.businessId;
  if (!businessId) { return Response.json({ ok: false, error: 'Missing businessId.' }); }

  // Pull every plausible money field so we can SEE which one carries the total.
  var query = 'query($bid: ID!) { business(id:$bid){ invoices(page:1,pageSize:8){ edges{ node{'
    + ' id invoiceNumber status'
    + ' total{ value currency{ code } }'
    + ' subtotal{ value }'
    + ' taxTotal{ value }'
    + ' amountPaid{ value }'
    + ' amountDue{ value } } } } } }';

  try {
    var r = await fetch('https://gql.waveapps.com/graphql/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + waveToken },
      body: JSON.stringify({ query: query, variables: { bid: businessId } })
    });
    var j = await r.json();
    if (!r.ok || (j && j.errors && j.errors.length)) {
      return Response.json({ ok: false, error: 'Wave error: ' + (j && j.errors && j.errors[0] ? j.errors[0].message : ('HTTP ' + r.status)), rawErrors: j && j.errors });
    }
    var edges = j && j.data && j.data.business && j.data.business.invoices && j.data.business.invoices.edges ? j.data.business.invoices.edges : [];

    var admin = (supaUrl && serviceKey) ? createClient(supaUrl, serviceKey, { auth: { persistSession: false } }) : null;
    var out = [];
    for (var i = 0; i < edges.length; i++) {
      var n = edges[i].node;
      var dbRow = null;
      if (admin) {
        var dr = await admin.from('accounting_invoices').select('invoice_number, total_amount, amount_paid, wave_imported_paid, balance_due, payment_status').eq('wave_invoice_id', n.id).maybeSingle();
        dbRow = dr && dr.data ? dr.data : null;
      }
      out.push({
        invoiceNumber: n.invoiceNumber,
        status: n.status,
        wave_raw: {
          total: n.total, subtotal: n.subtotal, taxTotal: n.taxTotal, amountPaid: n.amountPaid, amountDue: n.amountDue
        },
        mapped_with_num: {
          total: num(n.total), subtotal: num(n.subtotal), taxTotal: num(n.taxTotal), amountPaid: num(n.amountPaid), amountDue: num(n.amountDue)
        },
        db_row: dbRow
      });
    }
    return Response.json({ ok: true, count: out.length, invoices: out });
  } catch (e) {
    return Response.json({ ok: false, error: (e && e.message) || 'Diagnostic failed' });
  }
}
