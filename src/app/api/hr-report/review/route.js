// /api/hr-report/review
// =====================
// Generates an analytical, structured performance review of a team member
// for super_admin / privileged users to read. Tone is professional and
// HR-style: balanced, strengths-and-weaknesses, with specific recommended
// actions. Comparable to a manager's quarterly write-up.
//
// Build constraints: no template literals/backticks, var instead of const,
// string concatenation. Vercel SWC compiler.

import { sanitizeErr } from '../../../../lib/sanitize-error';

export async function POST(req) {
  try {
    var body = await req.json();
    var name = body.name || 'Employee';
    var periodCode = body.period || '30d';
    var metrics = body.metrics || {};
    var deltas = body.deltas || {};
    var score = body.score || {};
    var teamAvg = body.teamAverage || null;

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

    var lines = [];
    lines.push('Subject: ' + name);
    lines.push('Period: ' + periodLabel);
    lines.push('');
    lines.push('=== SCORES (0-100, mostly absolute thresholds) ===');
    lines.push('Overall: ' + (score.score != null ? score.score : 'n/a'));
    lines.push('Activity (35%): ' + (score.activity != null ? score.activity : 'n/a'));
    lines.push('Timeliness (20%): ' + (score.timeliness != null ? score.timeliness : 'n/a'));
    lines.push('Presence (15%): ' + (score.presence != null ? score.presence : 'n/a (no session data)'));
    lines.push('Quality (15%): ' + (score.quality != null ? score.quality : 'n/a'));
    lines.push('Reliability (10%): ' + (score.reliability != null ? score.reliability : 'n/a'));
    lines.push('Productivity (5%, relative): ' + (score.productivity != null ? score.productivity : 'n/a'));
    lines.push('');
    lines.push('NOTE: Score philosophy is ABSOLUTE — graded against personal targets (logins per week, daily-log entries per week, etc.), not against teammates. Productivity is the only relative input and is intentionally weighted at just 5% so specialists who do other things aren\'t punished. Working week = 6 days, ANY 6 of 7 calendar days.');
    lines.push('');
    lines.push('=== TICKET ACTIVITY ===');
    lines.push('Created: ' + (metrics.ticketsCreated || 0));
    lines.push('Closed: ' + (metrics.ticketsClosed || 0) + ' (on time: ' + (metrics.ticketsClosedOnTime || 0) + ', late: ' + (metrics.ticketsClosedLate || 0) + ')');
    if (metrics.onTimePct != null) lines.push('On-time close rate: ' + metrics.onTimePct + '%');
    lines.push('Avg days to close: ' + (metrics.avgDaysToClose || 0));
    lines.push('Currently open: ' + (metrics.openTickets || 0) + ' (' + (metrics.overdueNow || 0) + ' overdue right now)');
    lines.push('Comments written: ' + (metrics.ticketComments || 0) + ' (per assigned: ' + (metrics.commentsPerTicket || 0) + ')');
    lines.push('Late edits (24h+ after creation): ' + (metrics.lateEdits || 0));
    lines.push('');
    lines.push('=== SHIPPING & QUOTES ===');
    lines.push('Rates added: ' + (metrics.ratesAdded || 0));
    lines.push('Bookings made: ' + (metrics.bookings || 0));
    lines.push('Quotes created/sent/accepted: ' + (metrics.quotesCreated || 0) + ' / ' + (metrics.quotesSent || 0) + ' / ' + (metrics.quotesAccepted || 0));
    lines.push('');
    lines.push('=== CRM ===');
    lines.push('Customers assigned: ' + (metrics.assignedCustomers || 0));
    lines.push('Pipeline moves: ' + (metrics.pipelineMoves || 0));
    lines.push('Contact touches: ' + (metrics.contactTouches || 0));
    lines.push('CRM log entries: ' + (metrics.crmLogEntries || 0));
    lines.push('');
    lines.push('=== DAILY LOG ===');
    lines.push('Manual entries: ' + (metrics.manualEntries || 0) + ' on ' + (metrics.manualDays || 0) + ' / ' + (metrics.workingDays || 0) + ' working days (' + (metrics.manualFillRatePct || 0) + '%)');
    lines.push('Auto entries: ' + (metrics.autoEntries || 0));
    lines.push('');
    lines.push('=== PRESENCE (time on system) ===');
    lines.push('Showed up on: ' + (metrics.presentDays != null ? metrics.presentDays : 0) + ' / ' + (metrics.workingDays || 0) + ' expected working days (' + (metrics.presenceRatePct != null ? metrics.presenceRatePct : 0) + '%)');
    lines.push('Login frequency: ' + (metrics.loginCount != null ? metrics.loginCount : 0) + ' / ' + (metrics.expectedLogins || 0) + ' expected (' + (metrics.loginRatePct != null ? metrics.loginRatePct : 0) + '%)');
    lines.push('Avg hours/day on system: ' + (metrics.avgHoursPerDay != null ? metrics.avgHoursPerDay : 0));
    lines.push('NOTE: Working week = 6 days, ANY 6 of 7 calendar days. Min target = 6 logins per week.');
    lines.push('');
    lines.push('=== CALENDAR ===');
    lines.push('Owned events: ' + (metrics.assignedEvents || 0) + ' (completed: ' + (metrics.completedEvents || 0) + ')');
    lines.push('Attended (any role): ' + (metrics.attendedEvents || 0) + ' (declined: ' + (metrics.declinedEvents || 0) + ')');

    if (teamAvg) {
      lines.push('');
      lines.push('=== TEAM AVERAGE (for context) ===');
      lines.push('Tickets closed: team avg ' + teamAvg.ticketsClosed);
      lines.push('Tickets created: team avg ' + teamAvg.ticketsCreated);
      lines.push('Rates added: team avg ' + teamAvg.ratesAdded);
      lines.push('Quotes created: team avg ' + teamAvg.quotesCreated);
      lines.push('Daily log fill: team avg ' + teamAvg.manualFillRatePct + '%');
      lines.push('Comments per period: team avg ' + teamAvg.ticketComments);
      lines.push('Score: team avg ' + teamAvg.score + ' (productivity ' + teamAvg.productivity + ', timeliness ' + teamAvg.timeliness + ', engagement ' + teamAvg.engagement + ')');
    }

    if (deltas && Object.keys(deltas).length) {
      lines.push('');
      lines.push('=== TREND VS PRIOR PERIOD ===');
      var dKeys = ['ticketsClosed', 'ticketsCreated', 'ratesAdded', 'bookings', 'quotesCreated', 'ticketComments', 'manualEntries', 'attendedEvents'];
      dKeys.forEach(function (k) {
        var d = deltas[k];
        if (!d) return;
        var arrow = d.diff > 0 ? 'UP' : (d.diff < 0 ? 'DOWN' : 'flat');
        lines.push('  ' + k + ': ' + d.current + ' vs prior ' + d.prior + ' (' + arrow + ' ' + Math.abs(d.diff) + ', ' + d.pct + '%)');
      });
    }

    var summary = lines.join('\n');

    var system =
      'You are an experienced HR analyst writing a structured performance review for the manager (super admin) of an import/distribution company. ' +
      'Your audience is the manager, not the employee — write in third person about ' + name + '.\n\n' +
      'Tone: professional, balanced, factual. You may identify both strengths and concerns, but always with specific data points. Avoid vague language. Avoid emotion. Cite actual numbers from the data provided.\n\n' +
      'Output format (use these exact section headers, on their own lines):\n\n' +
      'SUMMARY\n' +
      '(2-3 sentences with the headline finding for this period.)\n\n' +
      'STRENGTHS\n' +
      '(2-4 bullet points starting with "- ". Each must reference a specific number from the data.)\n\n' +
      'AREAS TO WATCH\n' +
      '(1-3 bullet points starting with "- ". Each must reference a specific number from the data. Be objective — these are observations, not personal criticisms.)\n\n' +
      'RECOMMENDED ACTIONS FOR MANAGER\n' +
      '(2-4 bullet points starting with "- ". Each is a concrete next step the manager could take or discuss with the employee.)\n\n' +
      'Hard rules:\n' +
      '  - Stay strictly factual. Do not speculate about motivation or personality.\n' +
      '  - If a metric is missing or zero, do not invent context.\n' +
      '  - Total length under 350 words.\n' +
      '  - Do not use markdown formatting beyond the dashes for bullet points.';

    var userMsg = 'Here is the underlying data:\n\n' + summary + '\n\nWrite the review now.';

    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!response.ok) {
      var errText = await response.text();
      console.warn('[hr-review] Anthropic non-OK:', response.status, errText.substring(0, 200));
      return Response.json({ error: 'Review API error (' + response.status + ')' }, { status: response.status });
    }

    var data = await response.json();
    var text = (data.content && data.content[0] && data.content[0].text) || '';
    return Response.json({ message: text.trim() });
  } catch (err) {
    console.error('[hr-review] error:', err);
    return Response.json({ error: sanitizeErr(err) || 'Review unavailable' }, { status: 500 });
  }
}
