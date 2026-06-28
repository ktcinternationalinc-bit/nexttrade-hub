// Decisive question (Max): does pushing a Hub invoice to Wave REALLY need a product/inventory item, or can a
// line carry just its description/qty/price? -> introspect InvoiceCreateInput + InvoiceCreateItemInput and
// report which fields are REQUIRED (NON_NULL). If productId is NON_NULL, Wave demands a product per line;
// if nullable, we can push description-only lines and drop the Default Invoice Product requirement entirely.
import fs from 'fs';
var env = ''; try { env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); } catch (e) {}
var tok = (env.match(/WAVE_ACCESS_TOKEN\s*=\s*"?([^"\r\n]+)"?/) || [])[1];
async function gql(q, v) { var r = await fetch('https://gql.waveapps.com/graphql/public', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (tok || '') }, body: JSON.stringify({ query: q, variables: v || {} }) }); return r.json(); }
function tn(t) { if (!t) return '?'; return t.name || (t.ofType ? (t.kind === 'NON_NULL' ? tn(t.ofType) + '!' : t.kind === 'LIST' ? '[' + tn(t.ofType) + ']' : tn(t.ofType)) : t.kind); }
async function dump(typeName) {
  var d = await gql('query($n:String!){ __type(name:$n){ name inputFields{ name type{ name kind ofType{ name kind ofType{ name kind ofType{ name kind } } } } } } }', { n: typeName });
  var t = (d.data || {}).__type;
  console.log('\n=== ' + typeName + ' ===');
  if (!t) { console.log('NOT FOUND / ' + JSON.stringify(d.errors || d).slice(0, 300)); return; }
  (t.inputFields || []).forEach(function (f) { var ty = tn(f.type); console.log('  ' + f.name + ': ' + ty + (/!$/.test(ty) ? '   <-- REQUIRED' : '')); });
}
if (!tok) { console.log('NO WAVE_ACCESS_TOKEN in .env.local'); process.exit(0); }
await dump('InvoiceCreateInput');
await dump('InvoiceCreateItemInput');
