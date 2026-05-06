// /api/hr-report/coach
// =====================
// Generates a positive, encouraging coach message for a single user about
// their own performance over a chosen period.
//
// Tone rules: positive, growth-oriented, never judgmental, focused on
// wins and 1-2 actionable suggestions. Never compares to other team
// members. Never gives a numeric score back.
//
// Build constraints (per project memory): no template literals/backticks,
// var instead of const, string concatenation. Vercel SWC compiler is
// fragile on this route family.

export async function POST(req) {
  try {
    var body = await req.json();
    var name = body.name || 'You';
    var periodCode = body.period || '30d';
    var metrics = body.metrics || {};
    var deltas = body.deltas || {};

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'ANTHROPIC_API_KEY not set in Vercel environment variables.' }, { status: 500 });
    }

    var periodLabel = ({
      yesterday: 'yesterday',
      '7d': 'the last 7 days',
      '30d': 'the last 30 days',
      '3mo': 'the last 3 months',
      '1y': 'the last year',
      custom: 'this period'
    })[periodCode] || 'this period';

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

    var system =
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

    var userMsg = 'Here is the activity data:\n\n' + summary + '\n\nPlease write the coach message now.';

    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!response.ok) {
      var errText = await response.text();
      console.warn('[hr-coach] Anthropic non-OK:', response.status, errText.substring(0, 200));
      return Response.json({ error: 'Coach API error (' + response.status + ')' }, { status: response.status });
    }

    var data = await response.json();
    var text = (data.content && data.content[0] && data.content[0].text) || '';
    return Response.json({ message: text.trim() });
  } catch (err) {
    console.error('[hr-coach] error:', err);
    return Response.json({ error: err.message || 'Coach unavailable' }, { status: 500 });
  }
}
