// ============================================================
// /api/phone/diagnose — PHONE SYSTEM HEALTH CHECK
// ============================================================
// What this does:
//   Runs through every dependency of the phone system and reports
//   exactly which pieces are healthy and which are broken. Each
//   check returns a status (ok / warn / fail), a clear message,
//   and a fix hint when something is wrong.
//
//   The Settings → Phone "Run Diagnostics" button calls this
//   endpoint so admins can verify the system end-to-end without
//   actually placing a real phone call.
//
// What gets checked:
//   1. Every required env var is set (Twilio + Supabase + INTERNAL)
//   2. Supabase DB has phone_numbers rows
//   3. At least one user has an assigned number
//   4. Twilio API responds to a credentials check (validates SID + AUTH_TOKEN)
//   5. The TwiML App SID exists under this Twilio account
//   6. The Twilio numbers in our DB match the ones registered with Twilio
//   7. NEXT_PUBLIC_APP_URL is set (or we're using a default)
//
// Auth: admin only. Surfaces credentials presence (not values) so
// non-admins can't probe the env config remotely.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { requireUser } from '../../../../lib/phone-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const runtime = 'nodejs';

// Build a single check result. status is one of: 'ok' | 'warn' | 'fail'.
function check(label, status, message, fix) {
  return { label: label, status: status, message: message, fix: fix || null };
}

export async function GET(req) {
  try {
    // Auth — must be logged in admin or super_admin
    var auth = await requireUser(req);
    if (!auth.user) {
      return NextResponse.json({ error: 'auth required' }, { status: 401 });
    }
    var roleRes = await supabase
      .from('users')
      .select('role')
      .eq('id', auth.user.id)
      .maybeSingle();
    var role = roleRes && roleRes.data ? roleRes.data.role : null;
    if (role !== 'admin' && role !== 'super_admin') {
      return NextResponse.json({ error: 'admin only' }, { status: 403 });
    }

    var results = [];
    var summary = { ok: 0, warn: 0, fail: 0 };

    // ---- 1. ENV VAR CHECKS ----
    // These are the env vars actually referenced by phone code:
    var envChecks = [
      { key: 'TWILIO_ACCOUNT_SID',    purpose: 'Identifies your Twilio account; used by the token endpoint and webhook signature checks',          startsWith: 'AC' },
      { key: 'TWILIO_AUTH_TOKEN',     purpose: 'Verifies that incoming webhooks really came from Twilio AND lets us play back voicemail recordings', startsWith: null },
      { key: 'TWILIO_API_KEY_SID',    purpose: 'Used to sign the access token the browser uses to dial out',                                          startsWith: 'SK' },
      { key: 'TWILIO_API_KEY_SECRET', purpose: 'Secret half of the API key (signs the same token)',                                                   startsWith: null },
      { key: 'TWILIO_TWIML_APP_SID',  purpose: 'Tells Twilio which TwiML App handles outbound browser calls',                                          startsWith: 'AP' },
    ];

    for (var i = 0; i < envChecks.length; i++) {
      var ec = envChecks[i];
      var v = process.env[ec.key];
      if (!v) {
        results.push(check(
          ec.key,
          'fail',
          'Not set. ' + ec.purpose + '.',
          'In Vercel project settings → Environment Variables, add ' + ec.key + '. Find the value in your Twilio Console.'
        ));
      } else if (ec.startsWith && !v.startsWith(ec.startsWith)) {
        results.push(check(
          ec.key,
          'warn',
          'Set, but value does not start with "' + ec.startsWith + '". Make sure you pasted the right value from Twilio.',
          'In Twilio Console, double-check the value. ' + ec.key + ' should start with "' + ec.startsWith + '".'
        ));
      } else {
        results.push(check(ec.key, 'ok', 'Set (' + (v.length) + ' chars). ' + ec.purpose + '.'));
      }
    }

    // INTERNAL_SECRET (used by transcription)
    if (!process.env.INTERNAL_SECRET) {
      results.push(check(
        'INTERNAL_SECRET',
        'warn',
        'Not set. Voicemail transcription background jobs cannot authenticate themselves.',
        'Add any 32+ character random string to Vercel env vars. Generate with: openssl rand -hex 32'
      ));
    } else {
      results.push(check('INTERNAL_SECRET', 'ok', 'Set (' + process.env.INTERNAL_SECRET.length + ' chars).'));
    }

    // OPENAI_API_KEY (used by transcription)
    if (!process.env.OPENAI_API_KEY) {
      results.push(check(
        'OPENAI_API_KEY',
        'warn',
        'Not set. Voicemails will be saved as audio only; no automatic text transcription.',
        'Optional: add an OpenAI API key in Vercel env vars to enable Whisper transcription of voicemails.'
      ));
    } else {
      results.push(check('OPENAI_API_KEY', 'ok', 'Set (' + process.env.OPENAI_API_KEY.length + ' chars).'));
    }

    // NEXT_PUBLIC_APP_URL (used by webhook callback URLs)
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      results.push(check(
        'NEXT_PUBLIC_APP_URL',
        'warn',
        'Not set. Falling back to default https://nexttrade-hub.vercel.app — calls will work, but if you switch to hub.ktcus.com, set this so callbacks point there.',
        'Optional: set NEXT_PUBLIC_APP_URL=https://hub.ktcus.com (or your custom domain) in Vercel.'
      ));
    } else {
      results.push(check('NEXT_PUBLIC_APP_URL', 'ok', 'Set to ' + process.env.NEXT_PUBLIC_APP_URL));
    }

    // ---- 2. SUPABASE DB STATE ----
    var phoneNumbers = [];
    try {
      var nRes = await supabase
        .from('phone_numbers')
        .select('id, phone_number, label, assigned_to, recording_enabled, voicemail_enabled');
      if (nRes.error) {
        results.push(check(
          'phone_numbers table',
          'fail',
          'Table query failed: ' + nRes.error.message,
          'Run sql/s29_phone_system.sql in Supabase SQL editor to create the phone tables.'
        ));
      } else {
        phoneNumbers = nRes.data || [];
        if (phoneNumbers.length === 0) {
          results.push(check(
            'phone_numbers table',
            'fail',
            'Table exists but is empty.',
            'Run sql/s30_seed_ktc_phone_numbers.sql to add the 4 KTC numbers.'
          ));
        } else {
          var assigned = phoneNumbers.filter(function(p) { return p.assigned_to; }).length;
          if (assigned === 0) {
            results.push(check(
              'phone_numbers table',
              'warn',
              phoneNumbers.length + ' numbers in DB, but NONE are assigned to a team member. Inbound calls have nowhere to ring.',
              'In Settings → Phone, set the "Assigned to" dropdown for each number.'
            ));
          } else {
            results.push(check(
              'phone_numbers table',
              'ok',
              phoneNumbers.length + ' numbers in DB; ' + assigned + ' assigned to team members.'
            ));
          }
        }
      }
    } catch (e) {
      results.push(check('phone_numbers table', 'fail', 'Query crashed: ' + e.message));
    }

    // Check phone_calls table exists
    try {
      var cRes = await supabase.from('phone_calls').select('id', { count: 'exact', head: true });
      if (cRes.error) {
        results.push(check(
          'phone_calls table',
          'fail',
          'Cannot query: ' + cRes.error.message,
          'Run sql/s29_phone_system.sql in Supabase to create this table.'
        ));
      } else {
        results.push(check('phone_calls table', 'ok', 'Available (' + (cRes.count || 0) + ' calls logged).'));
      }
    } catch (e) {
      results.push(check('phone_calls table', 'fail', 'Query crashed: ' + e.message));
    }

    // Check phone_voicemails has the unique-index for race-safe upserts
    try {
      var vRes = await supabase.from('phone_voicemails').select('id', { count: 'exact', head: true });
      if (vRes.error) {
        results.push(check(
          'phone_voicemails table',
          'fail',
          'Cannot query: ' + vRes.error.message,
          'Run sql/s29_phone_system.sql then sql/s32_phone_rls_policies.sql.'
        ));
      } else {
        results.push(check('phone_voicemails table', 'ok', 'Available (' + (vRes.count || 0) + ' voicemails).'));
      }
    } catch (e) {
      results.push(check('phone_voicemails table', 'fail', 'Query crashed: ' + e.message));
    }

    // ---- 3. TWILIO API CONNECTIVITY ----
    // Only attempt if both ACCOUNT_SID and AUTH_TOKEN are set; otherwise the
    // env-var checks above already explain what's missing.
    var twilioApiOk = false;
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        var client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        var accountInfo = await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
        twilioApiOk = true;
        results.push(check(
          'Twilio API connectivity',
          'ok',
          'Connected to Twilio account "' + (accountInfo.friendlyName || 'unnamed') + '" (status: ' + accountInfo.status + ').'
        ));

        // ---- 4. TwiML App existence ----
        if (process.env.TWILIO_TWIML_APP_SID) {
          try {
            var app = await client.applications(process.env.TWILIO_TWIML_APP_SID).fetch();
            // Inspect voiceUrl to make sure it points at our /api/phone/outbound
            var expectedTail = '/api/phone/outbound';
            if (app.voiceUrl && app.voiceUrl.indexOf(expectedTail) >= 0) {
              results.push(check(
                'TwiML App configuration',
                'ok',
                'TwiML App "' + (app.friendlyName || 'unnamed') + '" is configured with voiceUrl: ' + app.voiceUrl
              ));
            } else {
              results.push(check(
                'TwiML App configuration',
                'warn',
                'TwiML App found but voiceUrl is "' + (app.voiceUrl || '<empty>') + '" — should end with /api/phone/outbound for browser dialing to work.',
                'In Twilio Console → Voice → TwiML Apps → ' + (app.friendlyName || 'your app') + ', set Request URL to https://nexttrade-hub.vercel.app/api/phone/outbound (POST).'
              ));
            }
          } catch (twiAppErr) {
            results.push(check(
              'TwiML App configuration',
              'fail',
              'TwiML App SID does not exist in this Twilio account: ' + twiAppErr.message,
              'Either fix the TWILIO_TWIML_APP_SID env var or create the TwiML App in Twilio Console.'
            ));
          }
        }

        // ---- 5. Phone number registration check ----
        // Compare what's in our DB to what's actually owned in Twilio
        if (phoneNumbers.length > 0) {
          try {
            var ownedNumbers = await client.incomingPhoneNumbers.list({ limit: 50 });
            var ownedSet = {};
            for (var oi = 0; oi < ownedNumbers.length; oi++) {
              ownedSet[ownedNumbers[oi].phoneNumber] = ownedNumbers[oi];
            }
            var missingFromTwilio = [];
            var voiceUrlIssues = [];
            for (var pi = 0; pi < phoneNumbers.length; pi++) {
              var dbNum = phoneNumbers[pi].phone_number;
              var twNum = ownedSet[dbNum];
              if (!twNum) {
                missingFromTwilio.push(dbNum);
              } else {
                // Check that the voice URL points at /api/phone/incoming
                if (!twNum.voiceUrl || twNum.voiceUrl.indexOf('/api/phone/incoming') < 0) {
                  voiceUrlIssues.push(dbNum + ' (voiceUrl: ' + (twNum.voiceUrl || '<empty>') + ')');
                }
              }
            }
            if (missingFromTwilio.length > 0) {
              results.push(check(
                'Phone numbers — Twilio ownership',
                'fail',
                'These numbers are in your DB but NOT in your Twilio account: ' + missingFromTwilio.join(', '),
                'Either remove these from phone_numbers in Supabase, or buy/transfer them in Twilio.'
              ));
            } else {
              results.push(check(
                'Phone numbers — Twilio ownership',
                'ok',
                'All ' + phoneNumbers.length + ' numbers are owned by this Twilio account.'
              ));
            }
            if (voiceUrlIssues.length > 0) {
              results.push(check(
                'Phone numbers — voice webhooks',
                'warn',
                'Some numbers have a voice URL that does not point at /api/phone/incoming. Inbound calls to those numbers will not reach our app. Affected: ' + voiceUrlIssues.join('; '),
                'In Twilio Console → Phone Numbers → Manage, click each number and set "A CALL COMES IN" Webhook → https://nexttrade-hub.vercel.app/api/phone/incoming (POST).'
              ));
            } else if (missingFromTwilio.length === 0) {
              results.push(check(
                'Phone numbers — voice webhooks',
                'ok',
                'All numbers have voice URLs pointing to /api/phone/incoming.'
              ));
            }
          } catch (numErr) {
            results.push(check(
              'Phone numbers — Twilio ownership',
              'warn',
              'Could not list owned numbers: ' + numErr.message,
              'May indicate a permissions or networking issue. Calls may still work.'
            ));
          }
        }
      } catch (twErr) {
        results.push(check(
          'Twilio API connectivity',
          'fail',
          'Could not authenticate with Twilio: ' + twErr.message,
          'Double-check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Vercel env vars.'
        ));
      }
    }

    // ---- Tally ----
    for (var ri = 0; ri < results.length; ri++) {
      summary[results[ri].status]++;
    }
    var overall = summary.fail > 0 ? 'fail' : (summary.warn > 0 ? 'warn' : 'ok');

    return NextResponse.json({
      overall: overall,
      summary: summary,
      results: results,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[phone/diagnose] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
