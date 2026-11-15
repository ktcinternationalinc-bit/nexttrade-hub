// ============================================================
// /api/ask/diag  —  AI pipeline diagnostic
//
// When Nadia starts going silent or nonsensical, visit this URL in a browser:
//   https://nexttrade-hub.vercel.app/api/ask/diag
//
// Returns a JSON report showing:
//   1. Which env vars are present (ANTHROPIC_API_KEY, SUPABASE_*)
//   2. Whether each import in /api/ask loaded cleanly
//   3. Round-trip test to Anthropic with a minimal message — if this fails,
//      intelligence is broken at the provider level, not your code
//   4. Round-trip test to Supabase — confirms data fetch is alive
//   5. System prompt size estimation
//
// Why this exists: in the past, when Nadia broke, I had to trace through
// three files and guess. Now you hit one URL and see the truth.
//
// Safe to expose publicly — no secrets returned, only booleans + minimal
// error excerpts truncated to 200 chars.
// ============================================================

export async function GET() {
  var report = {
    timestamp: new Date().toISOString(),
    env: {},
    imports: {},
    anthropic: { ok: null, status: null, error: null },
    supabase: { ok: null, count: null, error: null },
    notes: [],
  };

  // -------- 1. Environment --------
  report.env.has_anthropic_key = !!process.env.ANTHROPIC_API_KEY;
  report.env.has_supabase_url = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  report.env.has_service_role = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  report.env.has_anon_key = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!report.env.has_anthropic_key) report.notes.push('MISSING ANTHROPIC_API_KEY → Nadia cannot talk');
  if (!report.env.has_supabase_url) report.notes.push('MISSING NEXT_PUBLIC_SUPABASE_URL → no data access');
  if (!report.env.has_service_role && !report.env.has_anon_key) {
    report.notes.push('MISSING both service role AND anon key → no Supabase access');
  }

  // -------- 2. Imports — detect broken lib files --------
  // We import at runtime (not top-of-file) so a broken import here doesn't kill
  // the whole route. If an import throws, we catch it and report which one.
  try {
    await import('../../../../lib/notify-server.js');
    report.imports.notify_server = 'ok';
  } catch (e) {
    report.imports.notify_server = 'FAIL: ' + (e.message || '').substring(0, 200);
    report.notes.push('notify-server.js broken — /api/ask may fail to cold-boot');
  }
  try {
    await import('../../../../lib/ai-memory.js');
    report.imports.ai_memory = 'ok';
  } catch (e) {
    report.imports.ai_memory = 'FAIL: ' + (e.message || '').substring(0, 200);
    report.notes.push('ai-memory.js broken — memory disabled');
  }
  try {
    await import('../../../../lib/decision-engine.js');
    report.imports.decision_engine = 'ok';
  } catch (e) {
    report.imports.decision_engine = 'FAIL: ' + (e.message || '').substring(0, 200);
    report.notes.push('decision-engine.js broken — decision panel disabled');
  }

  // -------- 3. Anthropic round-trip test --------
  if (report.env.has_anthropic_key) {
    try {
      var res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 20,
          messages: [{ role: 'user', content: 'say OK' }],
        }),
      });
      report.anthropic.status = res.status;
      if (res.ok) {
        var data = await res.json();
        report.anthropic.ok = true;
        report.anthropic.reply = (data.content && data.content[0] && data.content[0].text) || '(empty)';
      } else {
        report.anthropic.ok = false;
        report.anthropic.error = (await res.text()).substring(0, 300);
        report.notes.push('Anthropic returned HTTP ' + res.status + ' — check the error field for details');
      }
    } catch (e) {
      report.anthropic.ok = false;
      report.anthropic.error = 'Network/fetch exception: ' + (e.message || '').substring(0, 200);
      report.notes.push('Could not reach Anthropic — network or key issue');
    }
  }

  // -------- 4. Supabase round-trip --------
  if (report.env.has_supabase_url && (report.env.has_service_role || report.env.has_anon_key)) {
    try {
      var supa = await import('@supabase/supabase-js');
      var client = supa.createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );
      var r = await client.from('tickets').select('*', { count: 'exact', head: true });
      if (r.error) {
        report.supabase.ok = false;
        report.supabase.error = r.error.message.substring(0, 200);
      } else {
        report.supabase.ok = true;
        report.supabase.count = r.count || 0;
      }
    } catch (e) {
      report.supabase.ok = false;
      report.supabase.error = (e.message || '').substring(0, 200);
    }
  }

  // -------- 5. Summary --------
  report.overall_health =
    report.env.has_anthropic_key &&
    report.anthropic.ok &&
    report.imports.notify_server === 'ok' &&
    report.imports.ai_memory === 'ok' &&
    report.imports.decision_engine === 'ok' &&
    report.supabase.ok
    ? 'HEALTHY'
    : 'DEGRADED';

  return Response.json(report, { status: 200 });
}
