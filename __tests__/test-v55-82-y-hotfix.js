// v55.82-Y — Two hotfixes (May 12 2026):
//   1. Nadia/chat still getting HTTP 400 after model-ID refresh — root cause
//      is request shape (consecutive same-role messages, empty content) and
//      truncated error reporting hid the real reason.
//   2. Ticket creation silently fails when the v55.82-V privacy columns
//      haven't been migrated yet. Loop column-stripping in dbInsert and only
//      include is_private/private_to when actually private.

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var askRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'ask', 'route.js'), 'utf8');
var tickets  = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var supaLib  = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'supabase.js'), 'utf8');

// ITEM 1 — AI request normalization
ok('1a: /api/ask main path collapses consecutive same-role messages',
  /var normalized = \[\];[\s\S]{0,800}prev\.role === nmMsg\.role/.test(askRoute),
  'Anthropic rejects two same-role messages in a row');

ok('1b: /api/ask main path filters empty content',
  /var nmContent = String\(\(nmMsg && nmMsg\.content\) \|\| ''\)\.trim\(\);\s*if \(!nmContent\) continue;/.test(askRoute));

ok('1c: /api/ask greeter path also collapses consecutive same-role',
  /gNormalized = \[\][\s\S]{0,500}gnPrev\.role === gMessages\[gnIdx\]\.role/.test(askRoute));

ok('1d: Error body captures FULL response, not truncated to 200 chars',
  /substring\(0, 500\)/.test(askRoute) &&
  !/r\.text\(\)\)\.substring\(0, 200\)/.test(askRoute),
  'truncating to 200 chars hid the actual Anthropic error message');

ok('1e: All attempt errors surfaced when chain exhausts (not just last)',
  /allAttemptErrors\s*=\s*\[\]/.test(askRoute) &&
  /allAttemptErrors\.join\(' \| '\)/.test(askRoute) &&
  /gAllErrors\s*=\s*\[\]/.test(askRoute) &&
  /gAllErrors\.join\(' \| '\)/.test(askRoute));

// ITEM 2 — Ticket creation backward-compatible
ok('2a: TicketsTab only sets is_private/private_to when actually private',
  /if \(makePrivate\) \{\s*ticketRow\.is_private = true;\s*ticketRow\.private_to = myId \|\| null;\s*\}/.test(tickets));

ok('2b: REGRESSION GUARD — is_private no longer in the default ticketRow',
  // Default row literal should NOT contain is_private: makePrivate
  !/\s*is_private: makePrivate,/.test(tickets),
  'sending is_private even as false breaks INSERT on unmigrated DBs');

ok('3a: dbInsert iteratively strips ALL missing columns (not just one)',
  /while \(error && safety < 8\)[\s\S]{0,600}extractMissingColumn\(error\)/.test(supaLib));

ok('3b: dbUpdate iteratively strips ALL missing columns',
  /while \(error && safetyU < 8\)[\s\S]{0,600}extractMissingColumn\(error\)/.test(supaLib));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-Y tests passed');
