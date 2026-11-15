// ============================================================
// __tests__/test-ai-smoke.js
//
// AI pipeline smoke test — runs ONLY when you have a local Next.js dev
// server up (`npm run dev`) and env vars set. Hits /api/ask with real
// history shapes and verifies a non-empty, intelligent response.
//
// Run:    node __tests__/test-ai-smoke.js
// Env:    NEXTTRADE_BASE_URL (default http://localhost:3000)
//
// This catches the exact class of bug that broke Session 5:
//   - silent empty answers
//   - cold-start import crashes
//   - Anthropic auth issues
//   - history-shape regressions
// ============================================================

var BASE = process.env.NEXTTRADE_BASE_URL || 'http://localhost:3000';
var passed = 0, failed = 0;

async function T(name, fn) {
  try { await fn(); console.log('✓ ' + name); passed++; }
  catch (e) { console.log('✗ ' + name + ' — ' + e.message); failed++; }
}

async function post(path, body) {
  var res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(function () { return {}; }) };
}

async function getJSON(path) {
  var res = await fetch(BASE + path);
  return { ok: res.ok, status: res.status, data: await res.json().catch(function () { return {}; }) };
}

(async function () {
  console.log('AI smoke test against ' + BASE);
  console.log('-----------------------------------');

  // Pre-flight — if server isn't reachable, this is an integration test
  // running outside its environment. Skip cleanly with exit 0 instead of
  // polluting the unit-test baseline with N "fetch failed" failures.
  try {
    var preflight = await fetch(BASE + '/api/ask/diag');
    if (!preflight) throw new Error('no response');
  } catch (preflightErr) {
    console.log('(server not reachable at ' + BASE + ' — skipping smoke test cleanly)');
    console.log('-----------------------------------');
    console.log('0 pass, 0 fail (SKIPPED)');
    process.exit(0);
  }

  // 1. Diagnostic endpoint reachable
  await T('/api/ask/diag returns 200 JSON', async function () {
    var r = await getJSON('/api/ask/diag');
    if (r.status !== 200) throw new Error('status ' + r.status);
    if (!r.data || typeof r.data !== 'object') throw new Error('not JSON');
  });

  // 2. Diag reports healthy
  await T('/api/ask/diag reports HEALTHY or prints useful notes', async function () {
    var r = await getJSON('/api/ask/diag');
    if (r.data.overall_health !== 'HEALTHY') {
      throw new Error('not healthy: ' + JSON.stringify(r.data.notes || []));
    }
  });

  // 3. Empty question → graceful fail, not crash
  await T('Empty question returns graceful response', async function () {
    var r = await post('/api/ask', { question: '' });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    if (!r.data.answer) throw new Error('no answer field');
  });

  // 4. Simple question → non-empty intelligent answer
  await T('Simple question: gets non-empty answer', async function () {
    var r = await post('/api/ask', {
      question: 'What are my open invoices?',
      history: [],
      userId: null,
    });
    if (!r.data.answer) throw new Error('answer empty');
    if (r.data.answer.length < 10) throw new Error('answer too short: ' + r.data.answer);
    if (r.data.answer.toLowerCase().indexOf('error') === 0) throw new Error('answer is error: ' + r.data.answer);
  });

  // 5. History starting with assistant (the bug I chased) — must still work
  await T('History starting with assistant message — still works', async function () {
    var r = await post('/api/ask', {
      question: 'What is my next action?',
      history: [
        { role: 'assistant', text: 'Hi Max!' },
        { role: 'user', text: 'How are things?' },
        { role: 'assistant', text: 'All clear.' },
      ],
      userId: null,
    });
    if (!r.data.answer) throw new Error('answer empty with asst-first history');
    if (r.data.answer.length < 10) throw new Error('answer too short: ' + r.data.answer);
  });

  // 6. Greeter mode — the dashboard path
  await T('Greeter mode: returns non-empty greeting', async function () {
    var r = await post('/api/ask', {
      mode: 'greeter',
      systemOverride: 'You are a helpful assistant. Say hi.',
      question: 'Greet me',
      history: [],
    });
    if (!r.data.answer) throw new Error('greeter answer empty');
    if (r.data.answer.length < 3) throw new Error('greeter answer too short');
  });

  // 7. Greeter with prior assistant greeting in history (real dashboard scenario)
  await T('Greeter with prior greeting in history — still responds', async function () {
    var r = await post('/api/ask', {
      mode: 'greeter',
      systemOverride: 'You are Nadia, Max\'s AI secretary. Answer concisely.',
      question: 'What should I focus on today?',
      history: [{ role: 'assistant', text: 'Good morning Max!' }],
    });
    if (!r.data.answer) throw new Error('empty answer in greeter-with-history');
    if (r.data.answer.length < 10) throw new Error('answer too short: ' + r.data.answer);
    if (/^hey\s+\w+!?$/i.test(r.data.answer.trim())) {
      throw new Error('answer is JUST a greeting fallback — intelligence is broken: ' + r.data.answer);
    }
  });

  // 8. /api/ask-v2 endpoint reachable (Session 5 addition)
  await T('/api/ask-v2 reachable', async function () {
    var r = await getJSON('/api/ask-v2');
    if (r.status !== 200) throw new Error('status ' + r.status);
    if (!r.data.tools || !Array.isArray(r.data.tools)) throw new Error('no tools array');
  });

  console.log('-----------------------------------');
  console.log(passed + ' pass, ' + failed + ' fail');
  process.exit(failed > 0 ? 1 : 0);
})();
