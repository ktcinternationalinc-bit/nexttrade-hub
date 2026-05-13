// Test suite for v55.38 login hydration fix
// =============================================
// Asserts the login page no longer initialises `time` with `new Date()`
// at module-evaluation time (which caused server/client renders to disagree
// on machines with non-English locales — Chrome auto-translate, Arabic
// numerals, Cairo timezone — and crashed the app with React errors
// #418/#423/#425, leaving users stuck on the login page).
//
// Also asserts the root layout has the notranslate guards that stop
// Chrome from rewriting the DOM mid-hydration.
//
// Pure content/shape assertions — no live HTTP, no browser.

import fs from 'fs';
import path from 'path';

var REPO = path.resolve(new URL('.', import.meta.url).pathname, '..');

var passed = 0, failed = 0;
var errors = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  \u2717 ' + label); }
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(REPO, rel)); }

console.log('\n========================================');
console.log('v55.38 LOGIN HYDRATION FIX TEST SUITE');
console.log('========================================\n');

// ----------------------------------------------------------------------
// LOGIN PAGE — clock no longer initialises with new Date() at render
// ----------------------------------------------------------------------
console.log('Login page — initial clock state is null, not new Date()');
var login = read('src/app/login/page.jsx');

assert(/useState\(null\)/.test(login),
  'L.1 — login uses useState(null) somewhere (lazy time init)');
assert(!/const \[time, setTime\] = useState\(new Date\(\)\)/.test(login),
  'L.2 — login does NOT use useState(new Date()) for time (was the hydration bug)');
assert(/const \[time, setTime\] = useState\(null\)/.test(login),
  'L.3 — time state specifically initialises as null');
assert(/const \[mounted, setMounted\] = useState\(false\)/.test(login),
  'L.4 — login tracks a mounted flag so the clock only renders post-hydration');
assert(/setMounted\(true\)/.test(login),
  'L.5 — mounted flag is flipped to true inside useEffect');

// ----------------------------------------------------------------------
// LOGIN PAGE — placeholder safety in formatters
// ----------------------------------------------------------------------
console.log('\nLogin page — formatters tolerate null time');

// fmt(null) must return a placeholder, not crash
assert(/fmt = \(d\) => \{[\s\S]*if \(!d\) return/.test(login),
  'L.6 — fmt() returns a placeholder when time is null');
assert(/fmtDate = \(d\) => \{[\s\S]*if \(!d\) return/.test(login),
  'L.7 — fmtDate() returns a placeholder when time is null');
assert(/getGreeting = \(d\) => \{[\s\S]*if \(!d\) return/.test(login),
  'L.8 — getGreeting() returns a generic greeting when time is null');

// The clock JSX must render a placeholder until mounted+time are ready
assert(/mounted && time \?/.test(login),
  'L.9 — clock JSX gates rendering on mounted && time');
assert(/--:--:--/.test(login),
  'L.10 — clock has a stable placeholder string for first paint');

// ----------------------------------------------------------------------
// LOGIN PAGE — defence in depth: notranslate + suppressHydrationWarning
// ----------------------------------------------------------------------
console.log('\nLogin page — Chrome auto-translate guards in place');
assert(/notranslate/.test(login),
  'L.11 — login page has notranslate class on outer container');
assert(/translate="no"/.test(login),
  'L.12 — login page has translate="no" attribute');
assert(/suppressHydrationWarning/.test(login),
  'L.13 — login page uses suppressHydrationWarning on time-dependent nodes');

// ----------------------------------------------------------------------
// LOGIN PAGE — locale lock so Arabic-locale browsers don't render
// Arabic numerals (which would itself cause a hydration mismatch)
// ----------------------------------------------------------------------
console.log('\nLogin page — locale is locked to en-US for time formatting');
assert(/toLocaleTimeString\('en-US'/.test(login),
  'L.14 — toLocaleTimeString called with explicit en-US locale');
assert(/toLocaleDateString\('en-US'/.test(login),
  'L.15 — toLocaleDateString called with explicit en-US locale');

// ----------------------------------------------------------------------
// LOGIN PAGE — autocomplete attrs (small UX win, often missing on
// custom login forms; helps password managers fill on Emad's machine too)
// ----------------------------------------------------------------------
console.log('\nLogin page — autocomplete attributes set');
assert(/autoComplete="username"/.test(login),
  'L.16 — email field declares autoComplete="username"');
assert(/autoComplete="current-password"/.test(login),
  'L.17 — password field declares autoComplete="current-password"');

// ----------------------------------------------------------------------
// LOGIN PAGE — backtick/template-literal scrub (Vercel SWC compiler hates
// these inside style/className expressions; previous fixes called this out)
// ----------------------------------------------------------------------
console.log('\nLogin page — no backticks introduced in inline expressions');
// Allow backticks ONLY inside the <style>{`...`}</style> block (CSS keyframes)
// and not in style/className expressions or other live code.
// Strip the style block AND comments before counting, so a backtick inside a
// // comment quoting code (e.g. "If we use `new Date()`") doesn't false-positive.
var loginNoStyleBlock = login.replace(/<style>\{`[\s\S]*?`\}<\/style>/g, '<STYLE_BLOCK_REMOVED>');
var loginCodeOnly = loginNoStyleBlock
  .replace(/\/\*[\s\S]*?\*\//g, '')           // /* ... */ block comments
  .replace(/(^|[^:\\])\/\/.*$/gm, '$1');      // // line comments (don't eat URLs)
var backticksOutsideStyleBlock = (loginCodeOnly.match(/`/g) || []).length;
assert(backticksOutsideStyleBlock === 0,
  'L.18 — no backticks outside the <style> block (use string concat in JSX exprs)');

// Confirm one specific old hot-spot is now string-concat
assert(/'rgba\(56,189,248,' \+ d\.a/.test(login),
  'L.19 — canvas fillStyle uses string concatenation, not template literal');

// ----------------------------------------------------------------------
// LOGIN PAGE — auth flow preserved (must not regress what already works)
// ----------------------------------------------------------------------
console.log('\nLogin page — auth flow preserved from v55.37');
assert(/supabase\.auth\.signInWithPassword/.test(login),
  'L.20 — Supabase auth call still present');
assert(/\.ilike\('email', lookupEmail\)/.test(login),
  'L.21 — case-insensitive email lookup preserved (Emad bounce-out fix)');
assert(/\.maybeSingle\(\)/.test(login),
  'L.22 — maybeSingle preserved (does not throw on missing profile row)');
assert(/profileErr/.test(login),
  'L.23 — profile-lookup errors still soft-fail (auth not undone)');
assert(/window\.location\.href = '\/'/.test(login),
  'L.24 — successful login still redirects to /');
assert(/from\('user_sessions'\)\s*\.insert/.test(login),
  'L.25 — user_sessions insert preserved (login tracking still works)');

// ----------------------------------------------------------------------
// ROOT LAYOUT — Chrome auto-translate guards
// ----------------------------------------------------------------------
console.log('\nRoot layout — auto-translate is disabled at the page level');
var layout = read('src/app/layout.jsx');

assert(/<html[^>]*translate="no"/.test(layout),
  'R.1 — <html> has translate="no" attribute');
assert(/<meta name="google" content="notranslate"/.test(layout),
  'R.2 — Google notranslate meta tag is in <head>');
assert(/<body[^>]*notranslate/.test(layout),
  'R.3 — <body> carries the notranslate class as a final fallback');
assert(/lang="en"/.test(layout),
  'R.4 — html lang="en" preserved (correct semantics, not the cause of the bug)');
assert(/dir="ltr"/.test(layout),
  'R.5 — html dir="ltr" preserved');

// Version stamps — at least v55.38 (forward-compatible: don't fail on v55.39+)
console.log('\nVersion stamps — bumped to v55.38 or later');
var page = read('src/app/page.jsx');
function vNum(s) { var m = s.match(/v55\.(\d+)/); return m ? parseInt(m[1], 10) : 0; }
var headerMatch = page.match(/>v55\.\d+(?:-[A-Z][0-9]*(?:\.\d+)*)?</);
var modalMatch = page.match(/BUILD v55\.\d+-/);
assert(headerMatch && vNum(headerMatch[0]) >= 38,
  'V.1 — header pill shows v55.38 or later');
assert(modalMatch && vNum(modalMatch[0]) >= 38,
  'V.2 — build modal shows v55.38-* or later');
assert(!/>v55\.37</.test(page),
  'V.3 — no v55.37 header pill remains');
assert(!/BUILD v55\.37-WHATSAPP-INBOX/.test(page),
  'V.4 — no v55.37 build modal label remains');

// ----------------------------------------------------------------------
// REGRESSION GUARD — v55.37 features still wired (no scope drift)
// ----------------------------------------------------------------------
console.log('\nRegression guard — v55.37 features intact');
assert(exists('src/components/WhatsAppInbox.jsx'),
  'G.1 — WhatsAppInbox component still present');
assert(exists('src/app/api/whatsapp/conversations/route.js'),
  'G.2 — WhatsApp conversations API still present');
assert(exists('src/app/api/whatsapp/diagnostic/route.js'),
  'G.3 — WhatsApp diagnostic API still present');
assert(exists('src/app/api/hr-report/coach/route.js') &&
       exists('src/app/api/hr-report/review/route.js') &&
       exists('src/components/HRReport.jsx'),
  'G.4 — AI HR Report API routes + component still present');

// ----------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------
console.log('\n========================================');
console.log('TOTAL: ' + (passed + failed) + ' assertions');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES:');
  errors.forEach(function (e) { console.log('  \u2022 ' + e); });
  process.exit(1);
}
console.log('\u2713 All v55.38 login hydration assertions present.\n');
