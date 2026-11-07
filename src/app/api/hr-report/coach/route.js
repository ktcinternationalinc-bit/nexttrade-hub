// /api/hr-report/coach
// =====================
// Generates a positive, encouraging coach message for a single user about
// their own performance over a chosen period.
//
// v55.82-L — Max May 11 2026: 10th report of "blank coach panel". Hardening
// pass on this route:
//   • Zero-activity payloads now produce a real coaching message rather
//     than going through the same template that needs activity stats.
//   • Missing ANTHROPIC_API_KEY returns a friendly user-facing error
//     instead of a raw "API key not configured" string.
//   • Anthropic-side failures are surfaced with the actual reason instead
//     of an opaque HTTP code.
//   • GET handler added for diagnostics — pings the route to verify
//     deployment without sending a body.
//
// Tone rules: positive, growth-oriented, never judgmental, focused on
// wins and 1-2 actionable suggestions. Never compares to other team
// members. Never gives a numeric score back.
//
// Build constraints (per project memory): no template literals/backticks,
// var instead of const, string concatenation. Vercel SWC compiler is
// fragile on this route family.

import { sanitizeErr } from '../../../../lib/sanitize-error';

// v55.82-L — Lightweight GET for diagnostics. Visiting /api/hr-report/coach
// in a browser used to 405. Now returns a JSON status so the user can verify
// the route is deployed AND the API key is wired in.
export async function GET() {
  return Response.json({
    status: 'ok',
    route: '/api/hr-report/coach',
    method_expected: 'POST',
    has_anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    hint: 'POST with JSON body { name, period, metrics, deltas } to get coach feedback.',
  });
}

export async function POST(req) {
  try {
    var body = await req.json();
    var name = body.name || 'You';
    var periodCode = body.period || '30d';
    var metrics = body.metrics || {};
    var deltas = body.deltas || {};
    // v55.82-S — Arabic toggle. Frontend sends lang='ar' to get the coach
    // response written in Modern Standard Arabic. Default 'en'. Any other
    // value falls back to English.
    var lang = body.lang === 'ar' ? 'ar' : 'en';

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // v55.82-L — user-friendly error instead of dev jargon.
      return Response.json({
        error: 'The AI coach is not connected yet. Ask your admin to set ANTHROPIC_API_KEY in the Vercel environment variables. Once set, the coach will start working.'
      }, { status: 500 });
    }

    var periodLabel = ({
      yesterday: 'yesterday',
      '7d': 'the last 7 days',
      '30d': 'the last 30 days',
      '3mo': 'the last 3 months',
      '1y': 'the last year',
      custom: 'this period'
    })[periodCode] || 'this period';

    // v55.82-L — Check whether we have any meaningful activity. If not, branch
    // to a special "low-activity" prompt that produces real coaching content
    // (encouragement + setting goals for the next period) instead of being
    // a thin template that needs activity numbers to riff on.
    var activitySum =
      (Number(metrics.ticketsClosed) || 0) +
      (Number(metrics.ticketsCreated) || 0) +
      (Number(metrics.ticketComments) || 0) +
      (Number(metrics.ratesAdded) || 0) +
      (Number(metrics.bookings) || 0) +
      (Number(metrics.quotesCreated) || 0) +
      (Number(metrics.contactTouches) || 0) +
      (Number(metrics.pipelineMoves) || 0) +
      (Number(metrics.manualEntries) || 0) +
      (Number(metrics.attendedEvents) || 0) +
      (Number(metrics.meetingsCreated) || 0);
    var isLowActivity = activitySum === 0;
    // v55.82-T — Distinguish "metrics object is empty/missing" from
    // "real low-activity period". If the frontend sent metrics:{} (or
    // a stub with no keys at all), that's a client-side timing bug —
    // not the user's fault. We refuse to write a "you had no activity"
    // message in that case; instead we ask the client to retry.
    var metricsKeyCount = Object.keys(metrics || {}).length;
    var metricsLooksEmpty = metricsKeyCount < 5;
    if (isLowActivity && metricsLooksEmpty) {
      try { console.warn('[hr-coach] metrics payload looks empty (', metricsKeyCount, 'keys) — refusing to generate "no activity" message. Likely a client-side timing bug.'); } catch (_) {}
      return Response.json({
        error: 'Activity data is still loading — please tap Refresh in a moment.'
      }, { status: 503 });
    }

    // Build a plain-English summary of what happened. We hand this to Claude
    // along with strict instructions on tone.
    var lines = [];
    lines.push('Period: ' + periodLabel);
    lines.push('Tickets created: ' + (metrics.ticketsCreated || 0));
    lines.push('Tickets closed: ' + (metrics.ticketsClosed || 0));
    if (metrics.onTimePct != null) lines.push('On-time close rate: ' + metrics.onTimePct + '%');
    lines.push('Tickets currently open: ' + (metrics.openTickets || 0));
    lines.push('Tickets currently overdue: ' + (metrics.overdueNow || 0));
    lines.push('Comments written on tickets: ' + (metrics.ticketComments || 0));
    lines.push('Comments per assigned ticket: ' + (metrics.commentsPerTicket || 0));
    lines.push('Shipping rates added: ' + (metrics.ratesAdded || 0));
    lines.push('Bookings made: ' + (metrics.bookings || 0));
    lines.push('Quotes created: ' + (metrics.quotesCreated || 0));
    lines.push('Quotes accepted by customers: ' + (metrics.quotesAccepted || 0));
    lines.push('Customer pipeline moves: ' + (metrics.pipelineMoves || 0));
    lines.push('Customer contact touches: ' + (metrics.contactTouches || 0));
    lines.push('Manual daily-log entries: ' + (metrics.manualEntries || 0));
    lines.push('Daily-log fill rate (manual entries on working days): ' + (metrics.manualFillRatePct || 0) + '%');
    lines.push('Meetings attended: ' + (metrics.attendedEvents || 0));
    lines.push('Meetings declined: ' + (metrics.declinedEvents || 0));

    if (deltas && Object.keys(deltas).length) {
      lines.push('');
      lines.push('Versus the prior matching period:');
      var dKeys = ['ticketsClosed', 'ticketsCreated', 'ratesAdded', 'bookings', 'quotesCreated', 'ticketComments', 'manualEntries', 'attendedEvents', 'totalActions'];
      dKeys.forEach(function (k) {
        var d = deltas[k];
        if (!d) return;
        var arrow = d.diff > 0 ? 'UP' : (d.diff < 0 ? 'DOWN' : 'flat');
        lines.push('  ' + k + ': ' + d.current + ' (' + arrow + ' ' + Math.abs(d.diff) + ' vs ' + d.prior + ')');
      });
    }

    var summary = lines.join('\n');

    // v55.82-L — Branch the system prompt on isLowActivity. Activity prompt
    // is the original. Low-activity prompt asks Claude to write a warm
    // welcome + goal-setting message instead of pretending there are wins.
    var system;
    if (isLowActivity) {
      system =
        'You are a supportive, positive personal performance coach for ' + name + ', a team member at KTC International (an import/distribution company).\n\n' +
        'IMPORTANT: ' + name + ' has no recorded activity in ' + periodLabel + ' yet. Do NOT pretend they did things they did not do, and do NOT shame them for the empty period. Instead, write a warm, encouraging welcome that:\n' +
        '  Paragraph 1: Greet them warmly by name and acknowledge that the system shows no recorded activity for ' + periodLabel + ' yet. Frame this neutrally — maybe they had a quiet stretch, maybe they were focused elsewhere, maybe their work is in areas the system does not track yet. No judgment.\n' +
        '  Paragraph 2: Quick reminder of the kinds of things that show up here when they happen: closing tickets, adding shipping rates, booking shipments, creating quotes, customer touches, writing daily-log entries. Make it sound supportive ("Once you start logging…") not corrective.\n' +
        '  Paragraph 3: One concrete, easy starter goal for the next period — for example "writing a quick daily-log entry at the end of each day" or "closing one ticket this week." End with a sentence of genuine encouragement.\n\n' +
        'Hard rules:\n' +
        '  - Never use phrases like "needs improvement", "you should", "you must", "lacking", "behind", or anything corrective.\n' +
        '  - Never use stars, ratings, scores, or rankings.\n' +
        '  - Address them by their first name once at the start.\n' +
        '  - Plain English. No bullet points, no markdown, no headers.\n' +
        '  - Keep total length under 180 words.';
    } else {
      system =
        'You are a supportive, positive personal performance coach for ' + name + ', a team member at KTC International (an import/distribution company).\n\n' +
        'Your tone is encouraging, warm, and growth-oriented. You are NEVER judgmental. You DO NOT give numeric scores or rankings. You DO NOT compare them to other team members. You focus on celebrating wins and offering one or two specific, doable suggestions for the next period.\n\n' +
        'Structure your response as 3 short paragraphs in plain English (no headers, no bullet points, no markdown):\n' +
        '  Paragraph 1: Open with a warm, genuine acknowledgement of something they did well in this period (cite a specific number from the data).\n' +
        '  Paragraph 2: Highlight a strength or improvement you see in the data (especially if a metric went UP from the prior period).\n' +
        '  Paragraph 3: Offer ONE concrete, gentle suggestion for the next period — something realistic and actionable. Keep it constructive, not corrective. End with a sentence of encouragement.\n\n' +
        'Hard rules:\n' +
        '  - Never use phrases like "needs improvement", "you should", "you must", "lacking", or anything that sounds like a critique.\n' +
        '  - Never use stars, ratings, scores, or rankings.\n' +
        '  - Address the person by their first name once at the start.\n' +
        '  - Keep total length under 180 words.\n' +
        '  - If a number is zero, do not call it out as a failure — frame any suggestion around the next period as opportunity, not deficiency.\n' +
        '  - If they had a tough period (low activity), still find something genuine and specific to acknowledge.';
    }

    var userMsg = 'Here is the activity data:\n\n' + summary + '\n\nPlease write the coach message now.';

    // v55.82-S — If user requested Arabic, append explicit instruction to
    // both prompts. Done as an append so the English logic above is
    // preserved verbatim (no risk of breaking the existing prompt).
    if (lang === 'ar') {
      system = system + '\n\nLANGUAGE: Write your entire response in Modern Standard Arabic (الفصحى). Use natural, warm Arabic phrasing — not a literal word-for-word translation of English. The name "' + name + '" can be transliterated to Arabic letters or kept in Latin script, whichever sounds more natural in context. Same rules apply: plain prose, no markdown, under 180 words.';
    }

    var response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          system: system,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });
    } catch (fetchErr) {
      console.error('[hr-coach] network error to Anthropic:', fetchErr);
      return Response.json({ error: 'Could not reach the AI service. Check your internet connection and try again.' }, { status: 502 });
    }

    if (!response.ok) {
      var errText = '';
      try { errText = await response.text(); } catch (_) { errText = ''; }
      console.warn('[hr-coach] Anthropic non-OK:', response.status, errText.substring(0, 400));
      // v55.82-L — try to extract a useful reason from the Anthropic error body
      var friendly = 'The AI service returned an error (HTTP ' + response.status + ').';
      // v55.83-A — billing error detection (Max May 13 2026)
      if (/credit balance is too low/i.test(errText) || /credit_balance/i.test(errText)) {
        friendly = 'AI coaching is paused — the Anthropic account needs credit. Please ask your super admin to top up at console.anthropic.com/settings/billing.';
        return Response.json({ error: friendly, error_type: 'billing', admin_action_required: true }, { status: response.status });
      }
      if (response.status === 401) friendly = 'The AI service key is invalid. Ask your admin to double-check ANTHROPIC_API_KEY in Vercel.';
      else if (response.status === 429) friendly = 'The AI service is rate-limited right now. Try again in a minute.';
      else if (response.status >= 500) friendly = 'The AI service is having trouble right now. Try again in a minute.';
      return Response.json({ error: friendly }, { status: response.status });
    }

    var data;
    try { data = await response.json(); } catch (parseErr) {
      console.error('[hr-coach] bad JSON from Anthropic:', parseErr);
      return Response.json({ error: 'The AI service sent back an unreadable response. Try again.' }, { status: 502 });
    }
    var text = (data && data.content && data.content[0] && data.content[0].text) || '';
    if (!text.trim()) {
      // v55.82-L — never return empty string. If Claude somehow returned
      // blank, surface that explicitly so the client doesn't show "blank
      // panel" again.
      return Response.json({ error: 'The coach returned an empty response. Try again.' }, { status: 502 });
    }
    return Response.json({ message: text.trim() });
  } catch (err) {
    console.error('[hr-coach] error:', err);
    return Response.json({ error: sanitizeErr(err) || 'Coach unavailable' }, { status: 500 });
  }
}
