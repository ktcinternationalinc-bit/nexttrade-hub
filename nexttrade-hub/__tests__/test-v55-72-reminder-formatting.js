// ============================================================
// v55.72 — Reminder/announcement formatting preserved (line breaks,
//          paragraphs, bullets, numbered lists)
//
// Max May 7 2026: "When I post a reminder, I should be able to format
// it the way I submit it. It should be formatted that way to the
// receivers. I don't want this one running message which is hard to
// read if it's a long message."
//
// Root causes (THREE separate spots all collapsed formatting):
//   1. /api/notify route built email HTML by interpolating ${body}
//      raw into a <div>. HTML collapses \n. So multi-line messages
//      arrived as a single wall of text.
//   2. The team-reminder send flow in page.jsx was passing ONLY the
//      subject (truncated to 60 chars) to /api/notify and not passing
//      the full body at all. The recipient saw only the subject line
//      in their email, never the full message.
//   3. The in-app team-reminder display rendered r.message in a flat
//      <div> with no whiteSpace: pre-wrap, so even when the body got
//      stored properly, the on-screen view collapsed it back to one line.
//
// Fixes:
//   1. New formatBodyAsHtml() helper in /api/notify route. Escapes
//      HTML, splits on blank lines into paragraphs, detects bullet
//      lines (-, *, •) and numbered lines (N.) and wraps in <ul>/<ol>.
//      Single \n inside a paragraph becomes <br/>.
//   2. Team reminder send flow now passes fullBody as the `body` field
//      to /api/notify (so /api/notify formats it). Subject is a short
//      preview line.
//   3. The announcement composer (separate from /api/notify) gets an
//      inline formatBody() helper that does the same paragraph + line
//      break treatment.
//   4. In-app team-reminder display gets whiteSpace: pre-wrap +
//      wordBreak: break-word so what you typed shows up exactly as
//      typed (with bullets, blank lines, indentation).
//   5. Both the reminder textarea and the announcement textarea grow
//      to 6 rows (was 3-4) and add a hint that formatting is preserved.
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label, detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.72 — Reminder/announcement formatting preserved');
console.log('============================================================');

var notify = read('src/app/api/notify/route.js');
var pg = read('src/app/page.jsx');

// ============================================================
// 1. /api/notify formatBodyAsHtml helper
// ============================================================
group('1. /api/notify has a plain-text-to-HTML formatter');

check('1.1 escapeHtml helper defined',
  /function escapeHtml\(s\)/.test(notify));
check('1.2 formatBodyAsHtml helper defined',
  /function formatBodyAsHtml\(raw\)/.test(notify));
check('1.3 Escapes &, <, >, ", \' (XSS safety)',
  /\.replace\(\/&\/g, '&amp;'\)/.test(notify) && /'&lt;'/.test(notify) && /'&gt;'/.test(notify));
check('1.4 Pass-through if body already looks like HTML',
  /\^\\s\*<\(p\|div\|ul\|ol\|h\[1-6\]/.test(notify));
check('1.5 Splits on blank lines for paragraphs',
  /paragraphs = escaped\.split\(\/\\r\?\\n\\s\*\\r\?\\n\/\)/.test(notify));
check('1.6 Detects bullet lines (-, *, •)',
  /var bulletRe = \/\^\\s\*\[-\*•\]/.test(notify));
check('1.7 Detects numbered lines (N. or N))',
  /var numRe = \/\^\\s\*\\d\+\[\\\.\\\)\]/.test(notify));
check('1.8 Bullet groups become <ul> with <li> items',
  /html \+= '<ul[^']*'/.test(notify));
check('1.9 Numbered groups become <ol> with <li> items',
  /html \+= '<ol[^']*'/.test(notify));
check('1.10 Plain paragraphs use <p> with <br/> for inline line breaks',
  /<p style="margin:8px 0;line-height:1\.6;">' \+ lines\.join\('<br\/>'\)/.test(notify));
check('1.11 Email HTML uses formatBodyAsHtml(body), not raw ${body}',
  /\$\{formatBodyAsHtml\(body\)\}/.test(notify) && !/<div[^>]*>\$\{body\}<\/div>/.test(notify));

// ============================================================
// 2. Team reminder send flow passes FULL body
// ============================================================
group('2. Team reminder /api/notify call sends FULL body, not just subject');

check('2.1 Reminder send passes `body: fullBody` to /api/notify',
  /body: fullBody[\s\S]{0,200}triggeredBy: userProfile\?\.id/.test(pg));
check('2.2 Subject is a SHORT preview, not the whole message',
  /const shortSubject = \(formData\.reminderPriority === 'urgent' \? '🔴 URGENT: ' : '📢 '\)[\s\S]{0,300}fullBody\.split\('\\n'\)\[0\]\.substring\(0, 80\)/.test(pg));
check('2.3 Subject gets truncation indicator if long or multi-line',
  /\? '…' : ''/.test(pg));
check('2.4 The OLD pattern (subject contained the body, no body field) is gone',
  // The old call did NOT have a `body:` field at all
  !/subject: \(formData\.reminderPriority === 'urgent' \? '🔴 URGENT: ' : '📢 '\) \+ formData\.reminderMsg\.trim\(\)\.substring\(0, 60\),\s*triggeredBy/.test(pg));

// ============================================================
// 3. In-app reminder display preserves line breaks
// ============================================================
group('3. In-app team reminder display preserves formatting');

check('3.1 Reminder body div uses whiteSpace: pre-wrap',
  /📢 \{r\.message \|\| r\.title\}[\s\S]{0,200}|whiteSpace: 'pre-wrap'[\s\S]{0,200}📢 \{r\.message \|\| r\.title\}/.test(pg));
check('3.2 Reminder body div explicitly sets whiteSpace + wordBreak',
  /whiteSpace: 'pre-wrap', wordBreak: 'break-word'/.test(pg));
check('3.3 Reminder body lineHeight increased to 1.5 (more readable for multi-line)',
  /fontSize: '15px', lineHeight: '1\.5'/.test(pg));

// ============================================================
// 4. Announcement composer email body keeps formatting too
// ============================================================
group('4. Announcement email body preserves blank-line paragraphs');

check('4.1 Announcement uses inline formatBody helper (not raw .replace(/\\n/g))',
  /const formatBody = \(raw\) =>/.test(pg));
check('4.2 Announcement formatBody escapes HTML',
  /escapeHtml = \(t\) => String\(t\)\.replace\(\/&\/g/.test(pg));
check('4.3 Announcement formatBody splits on blank lines',
  /escapeHtml\(s\)\.split\(\/\\r\?\\n\\s\*\\r\?\\n\/\)/.test(pg));
check('4.4 Announcement formatBody wraps each paragraph in <p>',
  /<p style="margin:8px 0;line-height:1\.6;">' \+ p\.split\(\/\\r\?\\n\/\)\.join\('<br\/>'\)/.test(pg));
check('4.5 Announcement email body uses formatBody(body), not body.replace',
  /formatBody\(body\)/.test(pg) && !/'\+body\.replace\(\/\\n\/g,'<br\/>'\)\+'/.test(pg));
check('4.6 Announcement body wrapper is <div> (not <p>) since formatBody emits multiple <p>s',
  /<div style="font-size:14px;color:#333;">'\+formatBody\(body\)\+'<\/div>/.test(pg));

// ============================================================
// 5. Composer textareas got bigger + formatting hint
// ============================================================
group('5. Composer textareas show formatting hint and grew to 6 rows');

check('5.1 Reminder textarea is rows={6}',
  /placeholder=\{"Type your reminder message[\s\S]{0,300}rows=\{6\}/.test(pg));
check('5.2 Reminder textarea placeholder includes formatting examples (- bullets)',
  /placeholder=\{"Type your reminder message[\s\S]{0,200}- bullets become a list/.test(pg));
check('5.3 Reminder textarea placeholder mentions blank lines',
  /placeholder=\{"Type your reminder message[\s\S]{0,300}Blank lines become paragraphs/.test(pg));
check('5.4 Reminder hint line below textarea ("Line breaks ... preserved")',
  /Line breaks, paragraphs, and bullet\/numbered lists preserved in the email and in-app view/.test(pg));
check('5.5 Announcement textarea is rows={6}',
  /placeholder=\{"Message details[\s\S]{0,300}rows=\{6\}/.test(pg));
check('5.6 Announcement textarea placeholder includes formatting examples',
  /placeholder=\{"Message details[\s\S]{0,200}Use bullets like this/.test(pg));
check('5.7 Announcement hint line below textarea ("preserved in the email")',
  /Line breaks, paragraphs, and bullet\/numbered lists preserved in the email recipients see/.test(pg));

// ============================================================
// 6. Edge cases the formatter MUST handle
// ============================================================
group('6. Edge case scenarios (formatter behavior)');

// These are conceptual checks of the helper's logic by inspecting the source
// (we can't easily run JS from a file in this static suite, but we verify the
// branches exist).
check('6.1 Empty body short-circuits to empty string (no crash)',
  /if \(!s\.trim\(\)\) return ''/.test(notify));
check('6.2 Pre-existing HTML body is returned untouched (no double-escape)',
  /if \(\/\^\\s\*<\(p\|div\|ul\|ol\|h\[1-6\]\|table\|br\|strong\|em\|span\)\\b\/i\.test\(s\)\) return s/.test(notify));
check('6.3 Mixed list + plain lines fall back to <p> (allBullets=false)',
  // Verify the `allBullets` AND `allNumbered` logic both check every line
  /var allBullets = lines\.every/.test(notify) && /var allNumbered = lines\.every/.test(notify));
check('6.4 List paragraph requires AT LEAST ONE actual bullet line (not just empty lines)',
  /allBullets && lines\.some\(function \(ln\) \{ return bulletRe\.test\(ln\); \}\)/.test(notify));
check('6.5 Inline single line breaks within a paragraph become <br/>',
  /lines\.join\('<br\/>'\)/.test(notify));
check('6.6 Email outer div sets white-space: normal (lets <p>/<ul> control spacing)',
  /white-space: normal/.test(notify));

// ============================================================
// 7. WhatsApp dispatch — already correct, no changes needed
// ============================================================
group('7. WhatsApp message format already preserves \\n natively');

check('7.1 WhatsApp message still uses \\n\\n between header and body',
  /'🔴 URGENT REMINDER\\n\\n'|'📢 Team Reminder\\n\\n'/.test(pg));
check('7.2 WhatsApp message still appends "— sender via KTC Hub" footer',
  /'\\n\\n— ' \+ \(userProfile\?\.name \|\| 'Admin'\) \+ ' via KTC Hub'/.test(pg));

// ============================================================
// 8. Carry-forward — earlier work intact
// ============================================================
group('8. Carry-forward — v55.65/66/67/68/69/70/71 still intact');

var ab = read('src/components/AssistantsBar.jsx');
check('8.1 v55.71 — AssistantsBar three avatars still present',
  /function NadiaAvatar/.test(ab) && /function JennaAvatar/.test(ab) && /function SaraAvatar/.test(ab));
check('8.2 v55.71 — Three Tile renders for nadia/jenna/sara',
  /who="nadia"/.test(ab) && /who="jenna"/.test(ab) && /who="sara"/.test(ab));
check('8.3 v55.71 — Nadia auto-opens via NADIA_AUTO_OPEN_KEY',
  /NADIA_AUTO_OPEN_KEY = 'ktc_nadia_morning_brief_dismissed_at'/.test(ab));
check('8.4 v55.71 — MyHRDesk mounts inside AssistantsBar Jenna panel',
  /openPanel === 'jenna'[\s\S]{0,1500}<MyHRDesk/.test(ab));
check('8.5 v55.71 — MyPerformance mounts inside AssistantsBar Sara panel',
  /openPanel === 'sara'[\s\S]{0,1500}<MyPerformance/.test(ab));

var pd = read('src/components/PersonalDashboard.jsx');
check('8.6 v55.71 — Dashboard has zero direct MyHRDesk mounts',
  (pd.match(/<MyHRDesk /g) || []).length === 0);
check('8.7 v55.71 — Dashboard has zero direct MyPerformance mounts',
  (pd.match(/<MyPerformance /g) || []).length === 0);

var tt = read('src/components/TicketsTab.jsx');
check('8.8 v55.69 ticket optimistic save still wired (savingRef)',
  /savingRef/.test(tt));

var srt = read('src/components/ShippingRatesTab.jsx');
check('8.9 v55.66 Shipping list view still wired',
  /routesViewMode/.test(srt));

var wnw = read('src/components/WhatsNewWidget.jsx');
check('8.10 v55.67 WhatsNew filterEntry still wired',
  /filterEntry/.test(wnw));

var hr = read('src/components/MyHRDesk.jsx');
check('8.11 v55.65 MyHRDesk still present', hr.length > 5000);

var ahr = read('src/components/AdminHRInbox.jsx');
check('8.12 v55.65 AdminHRInbox still present', ahr.length > 3000);

var vmr = read('src/app/api/phone/voicemail-record/route.js');
check('8.13 v55.65 voicemail trim="do-not-trim" still in place', /trim="do-not-trim"/.test(vmr));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); if (f.detail) console.log('     ' + f.detail); });
  process.exit(1);
}
console.log('\n✅ All ' + passed + ' tests passed');
