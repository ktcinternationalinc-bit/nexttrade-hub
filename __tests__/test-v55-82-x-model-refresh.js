// v55.82-X — Max May 12 2026 — "AI error: HTTP 400 on claude-haiku-4-5-20251001"
// Anthropic's dated snapshot IDs (claude-haiku-4-5-20251001 and
// claude-sonnet-4-20250514) started returning 400 after their May 2026
// model cleanup. Refresh every reference to the current dateless-pinned
// IDs per docs.claude.com.

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var apiDirs = ['ask', 'ask-v2', 'hr-report', 'translate', 'accountant'];
var allApiContent = '';
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function (f) {
    var p = path.join(dir, f);
    var s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith('.js')) allApiContent += fs.readFileSync(p, 'utf8') + '\n';
  });
}
walk(path.join(__dirname, '..', 'src', 'app', 'api'));
var aiMemory = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ai-memory.js'), 'utf8');

ok('1: ZERO refs to old dated Sonnet ID (claude-sonnet-4-20250514) in code',
  !/claude-sonnet-4-20250514/.test(allApiContent) && !/claude-sonnet-4-20250514/.test(aiMemory));

ok('2: ZERO refs to old dated Haiku ID (claude-haiku-4-5-20251001) in code',
  !/claude-haiku-4-5-20251001/.test(allApiContent) && !/claude-haiku-4-5-20251001/.test(aiMemory));

ok('3: ZERO refs to the old transitional Sonnet 4.5 ID',
  !/'claude-sonnet-4-5'/.test(allApiContent) && !/'claude-sonnet-4-5'/.test(aiMemory));

ok('4: API code uses claude-sonnet-4-6 (current Sonnet)',
  /claude-sonnet-4-6/.test(allApiContent));

ok('5: API code uses claude-haiku-4-5 (current dateless Haiku)',
  /claude-haiku-4-5(?!-)/.test(allApiContent));

ok('6: ai-memory uses claude-haiku-4-5 (current dateless Haiku)',
  /'claude-haiku-4-5'/.test(aiMemory));

ok('7: env-var override hook for AI_MODEL_CHAIN exists in /api/ask',
  /process\.env\.AI_MODEL_CHAIN/.test(allApiContent),
  'allows swapping models in Vercel without a code change');

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-X tests passed');
