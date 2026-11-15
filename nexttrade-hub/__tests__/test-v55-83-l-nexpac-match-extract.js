// v55.83-L — mirrors the JSON extraction used in /api/nexpac-match/route.js:
// strip backticks (fences) via \u0060, then take first { .. last }. Must survive
// fenced, prose-prefixed, and bare JSON responses from the model.
function extract(text) {
  var clean = String(text).replace(/[\u0060]/g, '').trim();
  var first = clean.indexOf('{');
  var last = clean.lastIndexOf('}');
  if (first >= 0 && last > first) clean = clean.substring(first, last + 1);
  return JSON.parse(clean);
}
var fails = 0; function ok(n,c){ if(c) console.log('\u2713 '+n); else { console.log('\u2717 '+n); fails++; } }
var sample = '{"matches":[{"expectedId":"E1","actualIds":["A1"],"expectedRolls":384,"actualRolls":380,"rollDiff":-4,"confidence":"high","note":"Stock Black"}],"unmatchedExpected":[],"unmatchedActual":["A2"],"summary":"Mostly aligned."}';
var fenced = '```json\n' + sample + '\n```';
var prosed = 'Here is the result:\n```\n' + sample + '\n```\nLet me know!';
var bare = sample;

[['fenced', fenced], ['prose+fence', prosed], ['bare', bare]].forEach(function(p){
  try {
    var r = extract(p[1]);
    ok(p[0] + ' parses to object', r && r.matches && r.matches.length === 1);
    ok(p[0] + ' rollDiff preserved', r.matches[0].rollDiff === -4);
    ok(p[0] + ' unmatchedActual preserved', r.unmatchedActual[0] === 'A2');
  } catch (e) { ok(p[0] + ' parses', false); }
});
console.log('\n' + (fails===0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails===0?0:1);
