import { NextResponse } from 'next/server';

// GET /api/gmail/connect — redirects user to Google OAuth consent screen
export async function GET(request) {
  try {
    var clientId = process.env.GOOGLE_CLIENT_ID;
    var redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return NextResponse.json({ error: 'Gmail not configured. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI in Vercel env vars.' }, { status: 500 });
    }

    // Get user ID from query param to pass through OAuth state
    var url = new URL(request.url);
    var userId = url.searchParams.get('userId') || '';

    var scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ].join(' ');

    var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
      + '?client_id=' + encodeURIComponent(clientId)
      + '&redirect_uri=' + encodeURIComponent(redirectUri)
      + '&response_type=code'
      + '&scope=' + encodeURIComponent(scopes)
      + '&access_type=offline'
      + '&prompt=consent'
      + '&state=' + encodeURIComponent(userId);

    return NextResponse.redirect(authUrl);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
