/* SEO Audit — crawl a page, detect technical SEO issues, score it,
 * save history. Detector only (no live-site modification).
 */
var path = require('path');
var fs = require('fs');
function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}
function read(f) { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); }

var route = read('src/app/api/seo-audit/route.js');
var tab = read('src/components/SEOAuditTab.jsx');
var page = read('src/app/page.jsx');
var rl = read('src/lib/rate-limit.js');

console.log('\n── SEO Audit ──');

ok('SEO.1: route authenticates + rate limits',
  /requireUser\(req\)/.test(route) && /checkRateLimit\(userId, 'seo-audit'\)/.test(route));

ok('SEO.2: detects title issues',
  /no <title> tag/.test(route) && /Title is empty or malformed/.test(route));

ok('SEO.3: detects missing meta description',
  /No meta description/.test(route));

ok('SEO.4: detects heading problems (h1 count, heading dumps)',
  /No <h1> heading/.test(route) && /looks like a data dump/.test(route));

ok('SEO.5: detects missing alt text',
  /missing alt text/.test(route));

ok('SEO.6: detects mobile viewport + HTTPS + schema',
  /No viewport meta tag/.test(route) && /not served over HTTPS/.test(route) && /No schema markup/.test(route));

ok('SEO.7: flags placeholder Lorem-Ipsum text',
  /Vokalia and Consonantia/.test(route) && /Placeholder filler text/.test(route));

ok('SEO.8: flags injected-spam / hacked content signature',
  /crypto Rom/.test(route) && /injected spam/.test(route));

ok('SEO.9: detects platform (WordPress/WooCommerce/static)',
  /WooCommerce/.test(route) && /Static HTML/.test(route));

ok('SEO.10: computes a 0-100 score from weighted penalties',
  /score = Math\.max\(0, 100 - penalty\)/.test(route));

ok('SEO.11: persists audit to seo_audits table',
  /from\('seo_audits'\)\.insert/.test(route));

ok('SEO.12: tab has preset buttons for the 3 real sites',
  /ktcus\.com/.test(tab) && /stocklotwarehouse\.com/.test(tab) && /nextradeindustries\.com/.test(tab));

ok('SEO.13: tab calls the audit endpoint + shows score + issues',
  /fetch\('\/api\/seo-audit'/.test(tab) && /SEO SCORE/.test(tab));

ok('SEO.14: seo-audit rate budget registered',
  /'seo-audit': \{ max: 60/.test(rl));

ok('SEO.15: tab imported + registered + rendered in page',
  /import SEOAuditTab/.test(page) && /id: 'seo', label: 'SEO Audit/.test(page) && /tab === 'seo'/.test(page));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ SEO Audit — crawl + detect + score + history');
console.log('══════════════════════════════════════════════');
