// v55.83-XH — Change Schedule (Releases) tab + release register + gated API. Static checks.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
const whatsnew = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/app/api/releases/route.js'), 'utf8');
const comp = fs.readFileSync(path.join(root, 'src/components/ChangeScheduleTab.jsx'), 'utf8');
const registerRaw = fs.readFileSync(path.join(root, 'release-management/release-register.json'), 'utf8');
const cases = fs.readFileSync(path.join(root, 'release-management/qa/cases.json'), 'utf8');
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok: ' + msg); pass++; }

// Tab wiring
ok(/\{ id: 'releases', label: '[^']*', icon: '[^']*' \}/.test(page), "'releases' tab registered in TABS");
ok(/items: \['admin', 'ai', 'settings', 'import', 'systemtickets', 'releases'\]/.test(page), "'releases' added to the SYSTEM sidebar group");
ok(/releases:'System'/.test(page), "'releases' mapped to the System breadcrumb group");
ok(/releases: CalendarClock/.test(page), "'releases' has a sidebar icon");
ok(/tab === 'releases' && \(/.test(page), "content area renders a block for tab === 'releases'");
ok(/<ChangeScheduleTab \/>/.test(page), 'the releases tab renders ChangeScheduleTab');

// UI permission gate: super admin handled by `return TABS` earlier; others need the switch.
ok(/if \(t\.id === 'releases'\) \{ return modulePerms\['releases\.access'\] === true; \}/.test(page), "releases tab gated on modulePerms['releases.access']");
ok(/key: 'releases\.access'/.test(settings), "releases.access permission key exists in SettingsTab");

// API is AUTHENTICATED and read-only (Codex point 3: protect the API itself, fail closed).
ok(/export async function GET\(/.test(route), '/api/releases exposes GET');
ok(!/export async function (POST|PUT|DELETE|PATCH)/.test(route), '/api/releases has no POST/PUT/DELETE/PATCH (read-only)');
ok(/verifiedCaller\(/.test(route), '/api/releases verifies the sign-in (verifiedCaller)');
ok(/assertPermission\([^)]*'releases\.access'/.test(route), "/api/releases requires super-admin OR releases.access");
ok(/if \(who\.error\)[^\n]*deny/.test(route) && /if \(!perm\.ok\)[^\n]*deny/.test(route), '/api/releases fails closed on unverified sign-in and on missing permission (unauthorized direct request is denied)');
ok(!/\.(insert|update|delete|upsert)\s*\(/.test(route), '/api/releases performs no DB writes');
ok(!/request\.(nextUrl|url)|searchParams|params\.get/.test(route), '/api/releases takes no caller input / path (fixed register path, no traversal)');

// Component reads the register via the route WITH the sign-in bearer.
ok(/fetch\('\/api\/releases'/.test(comp), 'ChangeScheduleTab reads the register via /api/releases');
ok(/getSession\(\)/.test(comp) && /Authorization.*Bearer/.test(comp), 'ChangeScheduleTab sends the sign-in bearer to the gated route');
ok(/not a live deployment feed|maintained release plan/.test(comp), 'the screen labels itself a maintained plan, not a live deployment feed');

// Register is valid JSON with the keys the screen needs.
let reg; ok((reg = JSON.parse(registerRaw)) && Array.isArray(reg.items), 'release-register.json is valid JSON with an items array');
ok(Array.isArray(reg.protocol) && Array.isArray(reg.legend), 'register has protocol + legend');
ok(reg.items.some(it => it.status === 'live') && reg.items.some(it => it.status !== 'live'), 'register has both live and queued items');

// QA cases: valid JSON, cover both repos, and are labelled lint vs governance (Codex point 5).
let cj; ok((cj = JSON.parse(cases)) && Array.isArray(cj.cases) && cj.cases.length >= 10, 'qa/cases.json is valid JSON with cases');
ok(cj.cases.some(c => c.repo === 'warehouse') && cj.cases.some(c => c.repo === 'hub'), 'QA covers the warehouse rollout rules AND the Hub');
ok(cj.cases.every(c => ['lint', 'governance', 'behavioral', 'manual'].includes(c.kind)), 'every QA case is labelled lint/governance/manual (source lint is not behavioral QA)');

// Badge + What's New
ok(page.includes('>v55.83-XH</span>'), 'badge bumped to v55.83-XH');
ok(/version: 'v55\.83-XH'/.test(whatsnew), "What's New has a v55.83-XH entry");

console.log('\nXH change-schedule: ' + pass + '/' + pass + ' checks passed');
process.exit(0);
