import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Refresh access token if expired
async function getValidToken(account) {
  var now = new Date();
  var expiry = new Date(account.token_expiry || 0);

  if (now < expiry && account.access_token) {
    return account.access_token;
  }

  // Token expired — refresh it
  if (!account.refresh_token) return null;

  var res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=' + encodeURIComponent(process.env.GOOGLE_CLIENT_ID)
      + '&client_secret=' + encodeURIComponent(process.env.GOOGLE_CLIENT_SECRET)
      + '&refresh_token=' + encodeURIComponent(account.refresh_token)
      + '&grant_type=refresh_token'
  });

  if (!res.ok) return null;

  var data = await res.json();
  var newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  await supabase.from('email_accounts').update({
    access_token: data.access_token,
    token_expiry: newExpiry
  }).eq('id', account.id);

  return data.access_token;
}

// Decode base64url encoded content
function decodeBase64Url(str) {
  if (!str) return '';
  var padded = str.replace(/-/g, '+').replace(/_/g, '/');
  try { return decodeURIComponent(escape(atob(padded))); }
  catch (e) { try { return atob(padded); } catch(e2) { return str; } }
}

// Extract header value
function getHeader(headers, name) {
  if (!headers) return '';
  var h = headers.find(function(x) { return x.name && x.name.toLowerCase() === name.toLowerCase(); });
  return h ? h.value : '';
}

// GET /api/gmail/inbox?userId=xxx&q=search&maxResults=20
export async function GET(request) {
  try {
    var url = new URL(request.url);
    var userId = url.searchParams.get('userId');
    var query = url.searchParams.get('q') || '';
    var maxResults = parseInt(url.searchParams.get('maxResults') || '20');
    var threadId = url.searchParams.get('threadId') || '';

    // Find active email account
    var accountQuery = supabase.from('email_accounts').select('*').eq('is_active', true);
    if (userId) accountQuery = accountQuery.eq('user_id', userId);
    var acctResult = await accountQuery.limit(1).maybeSingle();

    if (!acctResult.data) {
      return Response.json({ error: 'no_account', message: 'No Gmail account connected. Go to Settings > Connect Gmail.' });
    }

    var account = acctResult.data;
    var token = await getValidToken(account);
    if (!token) {
      return Response.json({ error: 'token_expired', message: 'Gmail token expired. Please reconnect Gmail in Settings.' });
    }

    // If threadId, fetch full thread
    if (threadId) {
      var threadRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/threads/' + threadId + '?format=full', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!threadRes.ok) return Response.json({ error: 'Failed to fetch thread' });
      var thread = await threadRes.json();
      var threadMessages = (thread.messages || []).map(function(msg) {
        var body = '';
        if (msg.payload && msg.payload.body && msg.payload.body.data) {
          body = decodeBase64Url(msg.payload.body.data);
        } else if (msg.payload && msg.payload.parts) {
          var textPart = msg.payload.parts.find(function(p) { return p.mimeType === 'text/plain'; });
          if (textPart && textPart.body && textPart.body.data) body = decodeBase64Url(textPart.body.data);
        }
        return {
          id: msg.id,
          from: getHeader(msg.payload.headers, 'From'),
          to: getHeader(msg.payload.headers, 'To'),
          subject: getHeader(msg.payload.headers, 'Subject'),
          date: getHeader(msg.payload.headers, 'Date'),
          body: body.substring(0, 3000),
          labels: msg.labelIds || []
        };
      });
      return Response.json({ thread: threadMessages });
    }

    // List messages
    var listUrl = 'https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=' + maxResults;
    if (query) listUrl += '&q=' + encodeURIComponent(query);
    else listUrl += '&q=in:inbox';

    var listRes = await fetch(listUrl, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!listRes.ok) {
      var errText = await listRes.text();
      return Response.json({ error: 'Gmail API error: ' + errText.substring(0, 200) });
    }
    var listData = await listRes.json();
    var messageIds = (listData.messages || []).slice(0, maxResults);

    if (messageIds.length === 0) {
      return Response.json({ emails: [], total: 0 });
    }

    // Fetch metadata for each message (batch would be better but keeping it simple)
    var emails = [];
    var fetches = messageIds.slice(0, 15).map(function(m) {
      return fetch('https://www.googleapis.com/gmail/v1/users/me/messages/' + m.id + '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function(r) { return r.json(); });
    });

    var results = await Promise.all(fetches);
    results.forEach(function(msg) {
      if (msg.id) {
        emails.push({
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader(msg.payload ? msg.payload.headers : [], 'From'),
          to: getHeader(msg.payload ? msg.payload.headers : [], 'To'),
          subject: getHeader(msg.payload ? msg.payload.headers : [], 'Subject'),
          date: getHeader(msg.payload ? msg.payload.headers : [], 'Date'),
          snippet: msg.snippet || '',
          labels: msg.labelIds || [],
          isUnread: (msg.labelIds || []).indexOf('UNREAD') >= 0
        });
      }
    });

    // Update last sync
    await supabase.from('email_accounts').update({ last_sync: new Date().toISOString() }).eq('id', account.id);

    return Response.json({
      emails: emails,
      total: listData.resultSizeEstimate || emails.length,
      account: account.email_address
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
