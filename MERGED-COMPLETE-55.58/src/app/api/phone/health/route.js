// ============================================================
// /api/phone/health — PHONE WEBHOOK SELF-TEST
// ============================================================
// What this does:
//   Returns valid TwiML that confirms the phone webhook stack is
//   reachable and configured. Open this URL in a browser:
//       https://nexttrade-hub.vercel.app/api/phone/health
//   You should see a small XML document that says everything is
//   green. If you see an HTTP error or a Vercel error page,
//   something is wrong at the deployment level (not Twilio).
//
//   You can ALSO point a Twilio test phone number at this URL
//   temporarily — Twilio will play "Phone webhook is healthy.
//   Goodbye." when the test number is called. That's a dead-simple
//   way to confirm Twilio → portal connectivity end-to-end without
//   touching the real production routing.
//
//   Reported by Max May 6 2026: calling 17328005428 played greeting
//   twice + "an application error has occurred." This route exists
//   so we can pinpoint whether the failure is at the Twilio config
//   level (webhook URL wrong in Twilio Console) vs the portal level
//   (a route is crashing on real traffic).
// ============================================================

export const runtime = 'nodejs';

function buildHealthTwiml() {
  var deployUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nexttrade-hub.vercel.app';
  var hasTwilioToken = !!process.env.TWILIO_AUTH_TOKEN;
  var hasTwilioSid = !!process.env.TWILIO_ACCOUNT_SID;
  var hasInternalSecret = !!process.env.INTERNAL_SECRET;
  var hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Response>'
    + '<Say voice="Polly.Joanna">'
    + 'Phone webhook is healthy. '
    + 'Twilio credentials ' + (hasTwilioToken && hasTwilioSid ? 'are configured.' : 'are missing.') + ' '
    + 'Public URL is ' + deployUrl.replace(/^https?:\/\//, '') + '. '
    + 'Goodbye.'
    + '</Say>'
    + '<Hangup />'
    + '</Response>';
}

export async function GET(req) {
  // Plain JSON for browser inspection (when called from a browser this is more useful than TwiML)
  var ua = (req.headers.get('user-agent') || '').toLowerCase();
  var isBrowser = ua.indexOf('mozilla') >= 0 || ua.indexOf('chrome') >= 0 || ua.indexOf('safari') >= 0;
  if (isBrowser && req.url.indexOf('format=twiml') < 0) {
    return Response.json({
      ok: true,
      route: '/api/phone/health',
      message: 'Phone webhook stack is reachable.',
      env: {
        TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID ? 'set' : 'NOT SET',
        TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN ? 'set' : 'NOT SET',
        TWILIO_API_KEY: !!process.env.TWILIO_API_KEY ? 'set' : 'NOT SET',
        TWILIO_API_SECRET: !!process.env.TWILIO_API_SECRET ? 'set' : 'NOT SET',
        TWILIO_TWIML_APP_SID: !!process.env.TWILIO_TWIML_APP_SID ? 'set' : 'NOT SET',
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || '(not set — falling back to nexttrade-hub.vercel.app)',
        NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'NOT SET',
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET',
        INTERNAL_SECRET: !!process.env.INTERNAL_SECRET ? 'set' : 'NOT SET',
        SKIP_TWILIO_SIGNATURE: process.env.SKIP_TWILIO_SIGNATURE || '(not set — signature check enabled)',
      },
      hint: 'Append ?format=twiml to see the TwiML response Twilio would receive. Point a test Twilio number at this URL to verify the webhook path end-to-end.',
    });
  }
  return new Response(buildHealthTwiml(), {
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function POST(req) {
  // Twilio always POSTs to webhooks, so support that too
  return new Response(buildHealthTwiml(), {
    headers: { 'Content-Type': 'text/xml' },
  });
}
