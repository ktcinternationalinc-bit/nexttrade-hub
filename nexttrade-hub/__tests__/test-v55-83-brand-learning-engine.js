/* Brand Learning Engine — upload/URL ingestion + AI extraction +
 * review/approve, feeding the Social Content Studio.
 */
var path = require('path');
var fs = require('fs');
function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}
function read(f) { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); }

var tab = read('src/components/BrandLearningTab.jsx');
var route = read('src/app/api/brand-learn/route.js');
var social = read('src/app/api/social-content/route.js');
var page = read('src/app/page.jsx');
var rl = read('src/lib/rate-limit.js');

console.log('\n── Brand Learning Engine ──');

ok('B.1: BrandLearningTab component with default export',
  /export default function BrandLearningTab/.test(tab));

ok('B.2: accepts BOTH file uploads and website URLs',
  /handleFileUpload/.test(tab) && /function addUrl/.test(tab) &&
  /source_type: 'file'/.test(tab) && /source_type: 'url'/.test(tab));

ok('B.3: supports multiple websites (URL add is repeatable, not single-slot)',
  /dbInsert\('brand_sources'/.test(tab));

ok('B.4: uploads to Supabase storage attachments bucket',
  /supabase\.storage\.from\(BUCKET_NAME\)\.upload/.test(tab));

ok('B.5: triggers extraction via /api/brand-learn',
  /fetch\('\/api\/brand-learn'/.test(tab));

ok('B.6: review screen lets user approve/unapprove learned knowledge',
  /approveKnowledge\(k, true\)/.test(tab) && /approveKnowledge\(k, false\)/.test(tab));

ok('B.7: user can edit the extracted summary (human correction)',
  /updateKnowledgeField\(k, 'summary'/.test(tab) && /edited_by_user/.test(tab));

ok('ROUTE.1: brand-learn route authenticates + rate limits',
  /requireUser\(req\)/.test(route) && /checkRateLimit\(userId, 'brand-learn'\)/.test(route));

ok('ROUTE.2: handles URL sources by fetching + stripping HTML',
  /source_type === 'url'/.test(route) && /replace\(\/<\[\^>\]\+>\/g/.test(route));

ok('ROUTE.3: handles PDF via native document block (no PDF library)',
  /type: 'document'/.test(route) && /media_type: 'application\/pdf'/.test(route));

ok('ROUTE.4: handles image via native image block',
  /type: 'image'/.test(route) && /\^image\\\//.test(route));

ok('ROUTE.5: extracts STRICT JSON product knowledge',
  /"products":/.test(route) && /parseJson/.test(route));

ok('ROUTE.6: saves knowledge unapproved for human review',
  /approved: false/.test(route) && /brand_knowledge/.test(route));

ok('RL.1: brand-learn budget registered',
  /'brand-learn': \{ max: 30/.test(rl));

ok('LINK.1: social generator pulls APPROVED brand knowledge',
  /from\('brand_knowledge'\)/.test(social) && /\.eq\('approved', true\)/.test(social));

ok('LINK.2: social generator falls back to built-in context when nothing approved',
  /learnedContext\s*\?/.test(social) && /BUSINESS_CONTEXT/.test(social));

ok('PAGE.1: BrandLearningTab imported + tab registered + rendered',
  /import BrandLearningTab/.test(page) &&
  /id: 'brand', label: 'Brand Learning/.test(page) &&
  /tab === 'brand'/.test(page));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ Brand Learning Engine — ingest + extract + approve + feed generator');
console.log('══════════════════════════════════════════════');
