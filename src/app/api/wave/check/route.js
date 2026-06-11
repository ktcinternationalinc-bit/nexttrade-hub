// v55.83-AI — Wave connection check (read-only). Server-side only: the token
// lives in the WAVE_ACCESS_TOKEN env var and is NEVER sent to the browser.
// Reads businesses + isClassicInvoicing so we can confirm API compatibility.
export async function GET() {
  var token = process.env.WAVE_ACCESS_TOKEN;
  if (!token) {
    return Response.json({
      connected: false,
      configured: false,
      error: 'No Wave token is configured yet. Add WAVE_ACCESS_TOKEN in Vercel (Settings -> Environment Variables), then redeploy.'
    });
  }
  try {
    var query = 'query { businesses { edges { node { id name isClassicInvoicing isPersonal } } } }';
    var resp = await fetch('https://gql.waveapps.com/graphql/public', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ query: query })
    });
    var json = null;
    try { json = await resp.json(); } catch (parseErr) { json = null; }
    if (!resp.ok) {
      var detail = json && json.errors && json.errors[0] ? json.errors[0].message : ('HTTP ' + resp.status);
      return Response.json({ connected: false, configured: true, error: 'Wave rejected the token: ' + detail });
    }
    if (json && json.errors && json.errors.length) {
      return Response.json({ connected: false, configured: true, error: 'Wave API error: ' + (json.errors[0].message || 'unknown') });
    }
    var edges = json && json.data && json.data.businesses && json.data.businesses.edges ? json.data.businesses.edges : [];
    var businesses = edges.map(function (e) {
      return {
        id: e.node.id,
        name: e.node.name,
        isClassicInvoicing: e.node.isClassicInvoicing === true,
        isPersonal: e.node.isPersonal === true
      };
    });
    return Response.json({ connected: true, configured: true, businesses: businesses });
  } catch (e) {
    return Response.json({ connected: false, configured: true, error: 'Could not reach Wave: ' + ((e && e.message) || 'network error') });
  }
}
