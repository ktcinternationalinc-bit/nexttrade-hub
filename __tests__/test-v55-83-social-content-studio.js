/* Social Content Studio — new tab + API route + table.
 * Round one: generate per-platform posts, edit, save to calendar,
 * approve, mark posted. Direct publishing to Meta/LinkedIn is a later
 * phase once content quality is proven.
 */
var path = require('path');
var fs = require('fs');
function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}
function read(f) { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); }

var tab = read('src/components/SocialContentTab.jsx');
var route = read('src/app/api/social-content/route.js');
var page = read('src/app/page.jsx');
var rl = read('src/lib/rate-limit.js');

console.log('\n── Social Content Studio ──');

ok('S.1: SocialContentTab component exists with default export',
  /export default function SocialContentTab/.test(tab));

ok('S.2: three platforms (linkedin, instagram, facebook) defined',
  /id: 'linkedin'/.test(tab) && /id: 'instagram'/.test(tab) && /id: 'facebook'/.test(tab));

ok('S.3: calls /api/social-content endpoint',
  /fetch\('\/api\/social-content'/.test(tab));

ok('S.4: saves to social_posts table with status draft/approved',
  /dbInsert\('social_posts'/.test(tab) && /status: status/.test(tab));

ok('S.5: content calendar filters by status (all/draft/approved/posted)',
  /\['all', 'draft', 'approved', 'posted'\]/.test(tab));

ok('S.6: mark-posted sets posted_at timestamp',
  /status === 'posted'\) changes\.posted_at/.test(tab));

ok('S.7: copy-to-clipboard helper present',
  /navigator\.clipboard\.writeText/.test(tab));

ok('ROUTE.1: API route authenticates via requireUser',
  /requireUser\(req\)/.test(route) && /Not authenticated/.test(route));

ok('ROUTE.2: API route enforces social-content rate limit',
  /checkRateLimit\(userId, 'social-content'\)/.test(route));

ok('ROUTE.3: API route uses claude-sonnet with haiku fallback',
  /claude-sonnet-4-6/.test(route) && /claude-haiku-4-5/.test(route));

ok('ROUTE.4: API route carries NextTrade business context for on-brand posts',
  /NextTrade Industries/.test(route) && /180 cm roll width/.test(route));

ok('ROUTE.5: API route returns strict JSON posts array',
  /JSON\.parse/.test(route) && /Array\.isArray\(parsed\.posts\)/.test(route));

ok('RL.1: social-content budget registered in rate-limit',
  /'social-content': \{ max: 40/.test(rl));

ok('PAGE.1: SocialContentTab imported',
  /import SocialContentTab from '\.\.\/components\/SocialContentTab'/.test(page));

ok('PAGE.2: social tab in menu',
  /id: 'social', label: 'Social Studio/.test(page));

ok('PAGE.3: social tab renders',
  /tab === 'social'/.test(page) && /<SocialContentTab/.test(page));

console.log('\n── Image → Content ──');

var imgRoute = read('src/app/api/image-content/route.js');

ok('IMG.1: image-content route exists with auth + rate limit',
  /requireUser\(req\)/.test(imgRoute) && /checkRateLimit\(userId, 'image-content'\)/.test(imgRoute));

ok('IMG.2: sends image as native vision block',
  /type: 'image'/.test(imgRoute) && /media_type: mimeType/.test(imgRoute));

ok('IMG.3: returns productRead + posts + reelScript',
  /productRead/.test(imgRoute) && /reelScript/.test(imgRoute) && /Array\.isArray\(parsed\.posts\)/.test(imgRoute));

ok('IMG.4: pulls approved brand knowledge for grounding',
  /from\('brand_knowledge'\)/.test(imgRoute) && /\.eq\('approved', true\)/.test(imgRoute));

ok('IMG.5: Studio has photo upload + generateFromImage',
  /handleImagePick/.test(tab) && /function generateFromImage/.test(tab) && /fetch\('\/api\/image-content'/.test(tab));

ok('IMG.6: Studio renders reel script + product read',
  /Reel \/ Video Script/.test(tab) && /What the AI saw in the photo/.test(tab));

ok('IMG.7: image-content rate budget registered',
  /'image-content': \{ max: 30/.test(read('src/lib/rate-limit.js')));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ Social Content Studio — tab + route + calendar');
console.log('══════════════════════════════════════════════');
