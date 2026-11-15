import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET /api/gmail/callback — Google redirects here after consent
export async function GET(request) {
  try {
    var url = new URL(request.url);
    var code = url.searchParams.get('code');
    var userId = url.searchParams.get('state') || null;
    var error = url.searchParams.get('error');

    if (error) {
      return new Response('<html><body><h2>Gmail connection cancelled.</h2><script>setTimeout(function(){window.close()},2000)</script></body></html>', {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    if (!code) {
      return NextResponse.json({ error: 'No authorization code received' }, { status: 400 });
    }

    // Exchange code for tokens
    var tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'code=' + encodeURIComponent(code)
        + '&client_id=' + encodeURIComponent(process.env.GOOGLE_CLIENT_ID)
        + '&client_secret=' + encodeURIComponent(process.env.GOOGLE_CLIENT_SECRET)
        + '&redirect_uri=' + encodeURIComponent(process.env.GOOGLE_REDIRECT_URI)
        + '&grant_type=authorization_code'
    });

    if (!tokenRes.ok) {
      var errBody = await tokenRes.text();
      return new Response('<html><body><h2>Token exchange failed</h2><p>' + errBody + '</p></body></html>', {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    var tokens = await tokenRes.json();

    // Get user's email address from Gmail profile
    var profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': 'Bearer ' + tokens.access_token }
    });
    var profile = await profileRes.json();
    var emailAddress = profile.emailAddress || 'unknown';

    // Calculate token expiry
    var expiryDate = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    // Store in database (upsert by email)
    var existing = await supabase.from('email_accounts').select('id').eq('email_address', emailAddress).maybeSingle();

    if (existing.data) {
      await supabase.from('email_accounts').update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || existing.data.refresh_token,
        token_expiry: expiryDate,
        is_active: true,
        user_id: userId || existing.data.user_id
      }).eq('id', existing.data.id);
    } else {
      await supabase.from('email_accounts').insert({
        user_id: userId || null,
        email_address: emailAddress,
        provider: 'gmail',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: expiryDate,
        is_active: true
      });
    }

    // Success page that auto-closes
    var html = '<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0a0a0f;color:#e2e8f0">'
      + '<h2 style="color:#10b981">Gmail Connected Successfully</h2>'
      + '<p>Account: ' + emailAddress + '</p>'
      + '<p style="color:#94a3b8">You can close this window and return to NextTrade Hub.</p>'
      + '<script>setTimeout(function(){window.close()},3000)</script>'
      + '</body></html>';

    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    return new Response('<html><body><h2>Error: ' + err.message + '</h2></body></html>', {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
