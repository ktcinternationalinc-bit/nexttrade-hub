import { createClient } from '@supabase/supabase-js';
import { notifyTicketAssignedServer, notifyTicketReassignedServer, notifyEventScheduledServer, notifyReminderServer, notifyTeamMessageServer, notifyShippingRateServer } from '../../../lib/notify-server';
import { loadMemorySettings, loadMemoryForUser, buildMemoryContext, extractMemoryCandidates, persistMemoryCandidates } from '../../../lib/ai-memory';
import { runDecisionEngine, detectIntent } from '../../../lib/decision-engine';
// Phase 2 / S13 — Morning briefing engine. Computes top 3 things needing
// attention when the user logs in for the first time today. See
// src/lib/briefing-engine.js for the scoring logic.
import * as briefingEngine from '../../../lib/briefing-engine';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET() {
  var hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ticketCount = 0;
  try { var r = await supabase.from('tickets').select('*', { count: 'exact', head: true }); ticketCount = r.count || 0; } catch(e) {}
  return Response.json({ status: 'working', has_anthropic: !!process.env.ANTHROPIC_API_KEY, has_service_key: hasKey, ticket_count: ticketCount, has_gmail: !!process.env.GOOGLE_CLIENT_ID, has_twilio: !!process.env.TWILIO_ACCOUNT_SID });
}

async function getGmailToken() {
  var acct = await supabase.from('email_accounts').select('*').eq('is_active', true).limit(1).maybeSingle();
  if (!acct.data) return null;
  var account = acct.data;
  var now = new Date();
  var expiry = new Date(account.token_expiry || 0);
  if (now < expiry && account.access_token) return { token: account.access_token, email: account.email_address, id: account.id };
  if (!account.refresh_token) return null;
  var res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=' + encodeURIComponent(process.env.GOOGLE_CLIENT_ID) + '&client_secret=' + encodeURIComponent(process.env.GOOGLE_CLIENT_SECRET) + '&refresh_token=' + encodeURIComponent(account.refresh_token) + '&grant_type=refresh_token'
  });
  if (!res.ok) return null;
  var data = await res.json();
  await supabase.from('email_accounts').update({ access_token: data.access_token, token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString() }).eq('id', account.id);
  return { token: data.access_token, email: account.email_address, id: account.id };
}

function getHeader(headers, name) {
  if (!headers) return '';
  var h = headers.find(function(x) { return x.name && x.name.toLowerCase() === name.toLowerCase(); });
  return h ? h.value : '';
}

function decodeBase64Url(str) {
  if (!str) return '';
  var padded = str.replace(/-/g, '+').replace(/_/g, '/');
  try { return decodeURIComponent(escape(atob(padded))); } catch(e) { try { return atob(padded); } catch(e2) { return str; } }
}

async function executeEmailRead(action) {
  var gmail = await getGmailToken();
  if (!gmail) return { result: 'Gmail not connected. Tell user to connect Gmail in Settings.' };
  var query = action.query || 'in:inbox is:unread';
  var max = action.maxResults || 10;
  var listRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=' + max + '&q=' + encodeURIComponent(query), { headers: { 'Authorization': 'Bearer ' + gmail.token } });
  if (!listRes.ok) return { result: 'Gmail API error' };
  var listData = await listRes.json();
  var ids = (listData.messages || []).slice(0, max);
  if (ids.length === 0) return { result: 'No emails found for query: ' + query };
  var emails = [];
  var fetches = ids.map(function(m) {
    return fetch('https://www.googleapis.com/gmail/v1/users/me/messages/' + m.id + '?format=full', { headers: { 'Authorization': 'Bearer ' + gmail.token } }).then(function(r) { return r.json(); });
  });
  var results = await Promise.all(fetches);
  results.forEach(function(msg) {
    if (!msg.id) return;
    var bodyText = '';
    if (msg.payload && msg.payload.body && msg.payload.body.data) bodyText = decodeBase64Url(msg.payload.body.data);
    else if (msg.payload && msg.payload.parts) {
      var tp = msg.payload.parts.find(function(p) { return p.mimeType === 'text/plain'; });
      if (tp && tp.body && tp.body.data) bodyText = decodeBase64Url(tp.body.data);
    }
    emails.push({
      id: msg.id, threadId: msg.threadId,
      from: getHeader(msg.payload.headers, 'From'),
      to: getHeader(msg.payload.headers, 'To'),
      subject: getHeader(msg.payload.headers, 'Subject'),
      date: getHeader(msg.payload.headers, 'Date'),
      snippet: msg.snippet || '',
      body: bodyText.substring(0, 1500),
      unread: (msg.labelIds || []).indexOf('UNREAD') >= 0
    });
  });
  return { result: 'Found ' + emails.length + ' emails', emails: emails };
}

async function executeEmailSend(action, userId) {
  var gmail = await getGmailToken();
  if (!gmail) return { result: 'Gmail not connected' };
  var to = action.to;
  var subject = action.subject || '';
  var body = action.body || '';
  if (!to || !body) return { result: 'Need to and body to send email' };
  var emailLines = ['To: ' + to, 'From: ' + gmail.email, 'Subject: ' + subject, 'Content-Type: text/plain; charset=utf-8'];
  if (action.inReplyTo) { emailLines.push('In-Reply-To: ' + action.inReplyTo); emailLines.push('References: ' + action.inReplyTo); }
  emailLines.push(''); emailLines.push(body);
  var raw = emailLines.join('\r\n');
  var encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  var sendBody = { raw: encoded };
  if (action.threadId) sendBody.threadId = action.threadId;
  var sendRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + gmail.token, 'Content-Type': 'application/json' }, body: JSON.stringify(sendBody)
  });
  if (!sendRes.ok) { var errText = await sendRes.text(); return { result: 'Send failed: ' + errText.substring(0, 200) }; }
  var sendResult = await sendRes.json();
  await supabase.from('messages').insert({ channel: 'email', direction: 'outbound', from_address: gmail.email, to_address: to, subject: subject, body: body.substring(0, 10000), thread_id: sendResult.threadId, external_id: sendResult.id, status: 'sent', handled_by: userId });
  await supabase.from('comms_audit').insert({ action_type: 'send_email', triggered_by: 'ai_assistant', user_id: userId, input_text: 'To: ' + to + ' | Subject: ' + subject, output_text: 'Sent. ID: ' + sendResult.id });
  return { result: 'Email sent successfully to ' + to + '. Subject: ' + subject };
}

async function executeWhatsAppSend(action, userId) {
  var sid = process.env.TWILIO_ACCOUNT_SID;
  var authTk = process.env.TWILIO_AUTH_TOKEN;
  var fromNum = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !authTk || !fromNum) return { result: 'Twilio/WhatsApp not configured' };
  var to = (action.to || '').replace(/[^0-9+]/g, '');
  if (!to.startsWith('+')) to = '+' + to;
  var body = action.body || '';
  if (!to || !body) return { result: 'Need to and body' };
  var waTo = 'whatsapp:' + to;
  var waFrom = fromNum.startsWith('whatsapp:') ? fromNum : 'whatsapp:' + fromNum;
  var twilioUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
  var twilioBody = 'To=' + encodeURIComponent(waTo) + '&From=' + encodeURIComponent(waFrom) + '&Body=' + encodeURIComponent(body);
  var sendRes = await fetch(twilioUrl, {
    method: 'POST', headers: { 'Authorization': 'Basic ' + btoa(sid + ':' + authTk), 'Content-Type': 'application/x-www-form-urlencoded' }, body: twilioBody
  });
  var sendResult = await sendRes.json();
  if (sendResult.error_code) return { result: 'WhatsApp send failed: ' + sendResult.message };
  await supabase.from('messages').insert({ channel: 'whatsapp', direction: 'outbound', from_address: waFrom.replace('whatsapp:', ''), to_address: to, body: body.substring(0, 10000), external_id: sendResult.sid, status: 'sent', handled_by: userId });
  await supabase.from('comms_audit').insert({ action_type: 'send_whatsapp', triggered_by: 'ai_assistant', user_id: userId, input_text: 'To: ' + to, output_text: 'Sent. SID: ' + sendResult.sid });
  return { result: 'WhatsApp message sent to ' + to };
}

export async function POST(request) {
  try {
    var body = await request.json();
    var question = body.question || '';
    var history = body.history || [];
    var action = body.action;
    var userId = body.userId;
    if (!question && !action) return Response.json({ answer: 'No question received' });

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ answer: 'API key not configured. Add ANTHROPIC_API_KEY in Vercel env vars.' });

    // GREETER MODE — conversational AI assistant.
    //
    // UPGRADED S9 (2026-04-22): super_admin team visibility + cross-team
    // action execution now work from the dashboard greeter, not just the
    // AI Assistant tab.
    //
    // Before S9 the greeter early-returned after calling Anthropic with
    // only the client-built systemOverride. That system prompt had no
    // login_events, no team_profiles, no other users' tickets, and no
    // way to parse ---ACTION_START--- blocks. Symptom: Max would ask
    // "is Omar online" from the dashboard and Nadia would say she didn't
    // know; he would say "remind Omar to X" and she would agree but
    // nothing would land in team_reminders. This block fixes that gap.
    if (body.mode === 'greeter' && body.systemOverride) {
      // Decision Engine pre-pass — if the user's question looks like a
      // decision question ("what should I do about invoice 2280?"), run
      // the engine in parallel with the chat model.
      var decisionPromise = null;
      try {
        var intent = detectIntent(question);
        if (intent !== 'unknown') decisionPromise = runDecisionEngine(question);
      } catch(e) { decisionPromise = null; }

      // ---------- Resolve current user + team roster server-side ----------
      // The client systemOverride is untrusted for auth purposes; we look
      // up role here so super_admin gates can't be spoofed from the browser.
      var gUsersList = [];
      var gCurrentUserName = 'Unknown';
      var gCurrentUserRole = 'viewer';
      var gIsSuperAdmin = false;
      try {
        if (userId) {
          var gUsersRes = await supabase.from('users').select('id, name, role');
          gUsersList = (gUsersRes && gUsersRes.data) || [];
          var gMe = gUsersList.find(function(u) { return u.id === userId; });
          if (gMe) {
            gCurrentUserName = gMe.name || 'Unknown';
            gCurrentUserRole = gMe.role || 'viewer';
            gIsSuperAdmin = gCurrentUserRole === 'super_admin';
          }
        }
      } catch(e) { /* non-fatal — proceed with no team context */ }

      // ---------- Super-admin team visibility block ----------
      // team_profiles + login-derived TEAM ACTIVITY + per-assignee open
      // tickets + recent daily_log. Only injected for super_admin so
      // non-admins don't see HR-grade data on the dashboard.
      var superAdminBlock = '';
      if (gIsSuperAdmin) {
        superAdminBlock += '\n\n===== SUPER ADMIN ACCESS — YOU HAVE FULL TEAM VISIBILITY =====\n';
        superAdminBlock += 'The current user (' + gCurrentUserName + ') is a SUPER ADMIN. You DO have visibility into every team member through the sections below.\n';
        superAdminBlock += 'You can answer questions using: TICKETS (assigned_to per employee), CALENDAR EVENTS (team schedule next 14 days), DAILY_LOG (recent activity entries for every user), TEAM PROFILES (job, personality, strengths), FOLLOW_UPS (each team member\'s CRM tasks), and LOGIN_EVENTS (who is online, attendance).\n';
        superAdminBlock += 'When he asks about an employee ("what has Omar been doing", "is Mohamed online", "who has overdue items") — ANSWER using the team data below. Do NOT refuse by saying you "don\'t track HR" — you are his executive assistant with full operational visibility.\n';

        // team_profiles
        try {
          var tpRes = await supabase.from('team_profiles').select('user_id, nickname, job_title, personality, strengths, weaknesses, notes');
          var profiles = (tpRes && tpRes.data) || [];
          if (profiles.length > 0) {
            superAdminBlock += '\nTEAM PROFILES:\n';
            profiles.forEach(function(p) {
              var u = gUsersList.find(function(x) { return x.id === p.user_id; });
              if (!u) return;
              var parts = [];
              if (p.nickname) parts.push('nickname "' + p.nickname + '"');
              if (p.personality) parts.push('personality: ' + p.personality);
              if (p.strengths) parts.push('strengths: ' + p.strengths);
              if (p.weaknesses) parts.push('watch-outs: ' + p.weaknesses);
              if (p.notes) parts.push('notes: ' + p.notes);
              superAdminBlock += '- ' + u.name + ' (' + (p.job_title || u.role || 'team member') + ')' + (parts.length ? ': ' + parts.join(' | ') : '') + '\n';
            });
          }
        } catch(e) {}

        // login_events — online now + last seen + logins_7d
        try {
          var since = new Date(Date.now() - 7 * 86400000).toISOString();
          var leRes = await supabase.from('login_events')
            .select('user_id, event_type, created_at')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(500);
          var loginEv = (leRes && leRes.data) || [];
          var byUser = {};
          loginEv.forEach(function(ev) {
            if (!byUser[ev.user_id]) byUser[ev.user_id] = { last_seen: ev.created_at, logins_7d: 0, last_event: ev.event_type };
            if (ev.event_type === 'login') byUser[ev.user_id].logins_7d++;
          });
          if (Object.keys(byUser).length > 0) {
            superAdminBlock += '\nTEAM ACTIVITY (last 7 days — use for "is X online" / attendance questions):\n';
            Object.keys(byUser).forEach(function(uid) {
              var u = gUsersList.find(function(x) { return x.id === uid; });
              if (!u) return;
              var info = byUser[uid];
              var minutesAgo = Math.round((Date.now() - new Date(info.last_seen).getTime()) / 60000);
              var onlineNow = minutesAgo < 10 && info.last_event !== 'logout';
              superAdminBlock += '- ' + u.name + ': last activity ' + minutesAgo + ' min ago' + (onlineNow ? ' [ONLINE NOW]' : '') + ' | ' + info.logins_7d + ' logins this week\n';
            });
          }
        } catch(e) {}

        // Team tickets grouped by assignee
        try {
          var tktRes = await supabase.from('tickets')
            .select('ticket_number, title, status, priority, due_date, assigned_to, created_at')
            .neq('status', 'Closed')
            .order('created_at', { ascending: false })
            .limit(100);
          var teamTickets = (tktRes && tktRes.data) || [];
          if (teamTickets.length > 0) {
            superAdminBlock += '\nTEAM TICKETS (all open, grouped by assignee — for "what is X working on" questions):\n';
            var byAssignee = {};
            teamTickets.forEach(function(t) {
              var aid = t.assigned_to || 'unassigned';
              if (!byAssignee[aid]) byAssignee[aid] = [];
              byAssignee[aid].push(t);
            });
            Object.keys(byAssignee).forEach(function(aid) {
              var aUser = gUsersList.find(function(u) { return u.id === aid; });
              var aName = aid === 'unassigned' ? 'UNASSIGNED' : ((aUser && aUser.name) || aid.substring(0, 8));
              var line = '- ' + aName + ': ';
              line += byAssignee[aid].slice(0, 6).map(function(t) {
                return (t.ticket_number || '') + ' "' + (t.title || '').substring(0, 40) + '" [' + (t.status || '') + (t.due_date ? ', due ' + t.due_date : '') + ']';
              }).join('; ');
              if (byAssignee[aid].length > 6) line += ' (+' + (byAssignee[aid].length - 6) + ' more)';
              superAdminBlock += line + '\n';
            });
          }
        } catch(e) {}

        // Recent daily_log — what people have been doing
        try {
          var dlRes = await supabase.from('daily_log')
            .select('user_id, entry_text, log_date, log_category')
            .order('created_at', { ascending: false })
            .limit(40);
          var dLogs = (dlRes && dlRes.data) || [];
          if (dLogs.length > 0) {
            superAdminBlock += '\nRECENT TEAM ACTIVITY LOG (~40 latest entries):\n';
            dLogs.forEach(function(l) {
              var u = gUsersList.find(function(x) { return x.id === l.user_id; });
              var uName = (u && u.name) || 'unknown';
              superAdminBlock += '- ' + (l.log_date || '') + ' [' + uName + ']: ' + (l.entry_text || '').substring(0, 140) + '\n';
            });
          }
        } catch(e) {}

        // Upcoming calendar_events for the team — next 14 days, grouped by assignee.
        // Needed for "what does Omar have today / this week" questions.
        try {
          var cEvStart = new Date().toISOString().substring(0, 10);
          var cEvEnd = new Date(Date.now() + 14 * 86400000).toISOString().substring(0, 10);
          var ceRes = await supabase.from('calendar_events')
            .select('title, event_date, event_time, event_type, assigned_to')
            .gte('event_date', cEvStart)
            .lte('event_date', cEvEnd)
            .order('event_date', { ascending: true })
            .limit(80);
          var cEv = (ceRes && ceRes.data) || [];
          if (cEv.length > 0) {
            superAdminBlock += '\nCALENDAR EVENTS (next 14 days):\n';
            // S22.7 (Apr 23 2026) — Always include day-of-week inline so the
            // LLM can't hallucinate the weekday. Max reported Nadia saying
            // "Friday April 25" when April 25 is actually Saturday.
            var WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            cEv.forEach(function(e) {
              var u = gUsersList.find(function(x) { return x.id === e.assigned_to; });
              var uName = (u && u.name) || 'unassigned';
              var dayName = '';
              try {
                // Parse YYYY-MM-DD as LOCAL (not UTC) — otherwise a 12am UTC
                // date rolls back to the previous day in Western timezones.
                var dp = String(e.event_date || '').split('-');
                if (dp.length === 3) {
                  var dt = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]), 12, 0, 0);
                  dayName = WEEKDAYS[dt.getDay()];
                }
              } catch (_) {}
              superAdminBlock += '- ' + (dayName ? dayName + ' ' : '') + e.event_date + (e.event_time ? ' at ' + e.event_time : '') + ' [' + uName + ']: ' + (e.title || '') + ' (' + (e.event_type || 'event') + ')\n';
            });
          }
        } catch(e) {}

        // FOLLOW_UPS — each team member's assigned CRM tasks (legacy super-admin block
        // referenced these; re-adding here so "who has overdue follow-ups" works).
        try {
          var fuRes = await supabase.from('follow_ups')
            .select('task, due_date, completed, customer_id, assigned_to')
            .eq('completed', false)
            .order('due_date', { ascending: true })
            .limit(60);
          var fus = (fuRes && fuRes.data) || [];
          if (fus.length > 0) {
            superAdminBlock += '\nOPEN FOLLOW_UPS:\n';
            fus.forEach(function(f) {
              var u = gUsersList.find(function(x) { return x.id === f.assigned_to; });
              var uName = (u && u.name) || 'unassigned';
              superAdminBlock += '- ' + (f.due_date || 'no date') + ' [' + uName + ']: ' + (f.task || '').substring(0, 120) + '\n';
            });
          }
        } catch(e) {}
        superAdminBlock += '===========================================\n';
      }

      // ---------- Cross-team action syntax block ----------
      // Action execution works for ALL users (per v25 permission reversal —
      // any team member can send reminders/messages/tickets/events to anyone).
      // Only the visibility data above is super_admin-gated.
      var actionSyntaxBlock = '';
      if (gUsersList.length > 0) {
        actionSyntaxBlock += '\n\n===== CROSS-TEAM ACTIONS YOU CAN EXECUTE =====\n';
        actionSyntaxBlock += 'When the user asks you to do something for a team member ("remind Omar to X", "tell Mohamed Y", "assign a ticket to Ahmed", "schedule a meeting with Sara"), emit an action block in your reply using EXACTLY this syntax — the literal markers must be on their own lines:\n';
        actionSyntaxBlock += '---ACTION_START---\n';
        actionSyntaxBlock += '{"type":"<action_type>", ...fields}\n';
        actionSyntaxBlock += '---ACTION_END---\n\n';
        actionSyntaxBlock += 'Supported actions:\n';
        actionSyntaxBlock += '  * create_reminder: {"type":"create_reminder","task":"<what>","due_date":"YYYY-MM-DD","priority":"normal|high","target_users":"<user_uuid>"}\n';
        actionSyntaxBlock += '  * send_team_message: {"type":"send_team_message","target_user_id":"<user_uuid>","message":"<text>","urgent":false}\n';
        actionSyntaxBlock += '  * create_ticket: {"type":"create_ticket","title":"<title>","description":"<detail>","priority":"medium","assigned_to":"<user_uuid>","due_date":"YYYY-MM-DD"}\n';
        actionSyntaxBlock += '  * create_event: {"type":"create_event","title":"<title>","event_date":"YYYY-MM-DD","event_time":"HH:MM","assigned_to":"<user_uuid>"}\n';
        actionSyntaxBlock += 'Resolve employee names to UUIDs from the USERS list below (case-insensitive, accept nicknames and partial matches). If you cannot confidently resolve a name, ASK the user for clarification instead of guessing.\n';
        actionSyntaxBlock += 'USERS (uuid → name):\n';
        gUsersList.forEach(function(u) {
          actionSyntaxBlock += '  - ' + u.id + ' => ' + u.name + ' (' + (u.role || 'member') + ')\n';
        });
        actionSyntaxBlock += '\nIn your conversational text, just say "Done — reminded Omar for tomorrow" or similar. The action block is what actually executes — do not just PROMISE to do it, always emit the block.\n';
        actionSyntaxBlock += 'If the user asks you to message MULTIPLE people (e.g. "tell everyone", "message the team"), emit one action block per person. The system supports up to 10 action blocks per reply.\n';
        actionSyntaxBlock += '===========================================\n';
      }

      // ---------- Pending messages targeted AT the current user ----------
      // (Receive side — already worked before S9, kept unchanged.)
      var crossTeamBlock = '';
      try {
        if (userId) {
          var pendingMsgRes = await supabase.from('ai_memory')
            .select('content, type, created_at, created_by')
            .eq('target_user_id', userId)
            .eq('auto_captured', false)
            .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(10);
          var pending = (pendingMsgRes && pendingMsgRes.data) || [];

          var remRes = await supabase.from('team_reminders')
            .select('title, message, reminder_date, priority, target_users, created_by')
            .or('target_users.eq.all,target_users.eq.' + userId)
            .order('reminder_date', { ascending: true })
            .limit(10);
          var remindersForUser = ((remRes && remRes.data) || []).filter(function(r) {
            return !r.reminder_date || r.reminder_date <= new Date().toISOString().substring(0, 10);
          });

          if (pending.length > 0 || remindersForUser.length > 0) {
            crossTeamBlock = '\n\n===== PENDING MESSAGES FOR THIS USER =====\n';
            crossTeamBlock += 'Another team member asked you (Nadia) to relay the following to this user. SURFACE THESE in your greeting — they haven\'t seen them yet.\n';
            if (pending.length > 0) {
              crossTeamBlock += '\nDirect messages:\n';
              pending.forEach(function(m) {
                crossTeamBlock += '- [' + (m.type || 'note') + '] ' + (m.content || '') + '\n';
              });
            }
            if (remindersForUser.length > 0) {
              crossTeamBlock += '\nReminders sent to this user:\n';
              remindersForUser.forEach(function(r) {
                crossTeamBlock += '- [' + (r.priority || 'normal') + ']' + (r.reminder_date ? ' (due ' + r.reminder_date + ')' : '') + ' ' + (r.message || r.title || '') + '\n';
              });
            }
            crossTeamBlock += '===== END PENDING MESSAGES =====\n';
          }
        }
      } catch(e) { /* non-fatal — never block greeting on this */ }

      // ---------- New alerts since last login ----------
      // S14 — Proactive watcher (running every 30 min) populates ai_alerts.
      // Surface any UNACKED alerts so Nadia can say "since we last talked,
      // X happened." Only runs on isFirstGreeting to avoid spamming every
      // chat turn.
      //
      // v51 (Apr 24 2026) — Stale-alert fix. Previously Nadia would remind
      // Max about an unacked ticket 14 min after he acked it because the
      // ai_alerts row was upserted with ignoreDuplicates, never updated when
      // the ticket state changed. Fix: cross-check each alert's referenced
      // entity against live state. If the condition is no longer true,
      // auto-acknowledge the alert and skip it.
      var watcherAlerts = [];
      if (isFirstGreeting && userId) {
        try {
          var alertsRes = await supabase.from('ai_alerts')
            .select('id, alert_type, severity, subject, body, recommendation, created_at, related_entity_id')
            .eq('target_user_id', userId)
            .or('acknowledged.is.null,acknowledged.eq.false')
            .order('created_at', { ascending: false })
            .limit(30); // pull extra since we may filter some out as stale
          var rawAlerts = (alertsRes && alertsRes.data) || [];

          // Identify alerts that reference tickets so we can validate them.
          var ticketAlerts = rawAlerts.filter(function(a) {
            return a.related_entity_id && /ticket|unack|overdue/i.test(a.alert_type || '');
          });
          // Load current state for referenced tickets once.
          var staleIds = [];
          if (ticketAlerts.length > 0) {
            try {
              var ids = ticketAlerts.map(function(a) { return a.related_entity_id; }).filter(Boolean);
              var tRes = await supabase.from('tickets')
                .select('id, status, due_date')
                .in('id', ids);
              var liveMap = {};
              (tRes && tRes.data || []).forEach(function(t) { liveMap[t.id] = t; });
              var today = new Date().toISOString().substring(0, 10);
              ticketAlerts.forEach(function(a) {
                var t = liveMap[a.related_entity_id];
                var at = String(a.alert_type || '').toLowerCase();
                // Ticket is gone from DB (deleted) → stale.
                if (!t) { staleIds.push(a.id); return; }
                // Unack-type alerts: stale if ticket is no longer in 'New'.
                if (at.indexOf('unack') >= 0 && t.status && t.status !== 'New') {
                  staleIds.push(a.id); return;
                }
                // Overdue-type: stale if due_date is no longer past OR status is Closed.
                if (at.indexOf('overdue') >= 0) {
                  if (t.status === 'Closed') { staleIds.push(a.id); return; }
                  if (t.due_date && t.due_date >= today) { staleIds.push(a.id); return; }
                }
                // Generic ticket-related alerts: stale once ticket is closed.
                if (at.indexOf('ticket') >= 0 && t.status === 'Closed') {
                  staleIds.push(a.id); return;
                }
              });
            } catch (e) { /* if cross-check fails, fall through — better to over-surface than silently drop */ }
          }

          // Fire-and-forget auto-acknowledge for stale alerts. Non-blocking:
          // we don't wait for the update to finish before continuing the reply.
          if (staleIds.length > 0) {
            (function() {
              try {
                supabase.from('ai_alerts')
                  .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
                  .in('id', staleIds)
                  .then(function() {}, function() {});
              } catch (e) {}
            })();
          }

          // Final surfacing list — original order preserved, stale removed, cap at 15.
          watcherAlerts = rawAlerts
            .filter(function(a) { return staleIds.indexOf(a.id) === -1; })
            .slice(0, 15);

          if (watcherAlerts.length > 0) {
            crossTeamBlock += '\n\n===== RECENT ALERTS FROM THE PROACTIVE WATCHER =====\n';
            crossTeamBlock += 'I\'ve been monitoring the business between conversations. Here is what I flagged (newest first). Mention only the 1-2 most important ones naturally in your greeting; the full list is visible to the user in their alerts bell.\n';
            watcherAlerts.slice(0, 5).forEach(function(a) {
              crossTeamBlock += '- [' + (a.severity || 'med').toUpperCase() + '] ' + (a.subject || '') + ' — ' + (a.body || '') + (a.recommendation ? ' (suggestion: ' + a.recommendation + ')' : '') + '\n';
            });
            crossTeamBlock += '====================================================\n';
          }
        } catch(e) { /* non-fatal */ }
      }

      // ---------- Build morning briefing (only on first greeting today) ----------
      // S13 — Phase 2: structured top-3 priority list returned alongside the
      // chat answer. Client renders it as visual cards above the chat.
      // We compute this ONLY when this is the auto-greeting (no question typed)
      // OR when the question is empty/looks like an opening — avoids running
      // the full scan on every chat turn.
      var briefing = null;
      var isFirstGreeting = body.isGreeting === true || (!question || /^(hi|hello|hey|good morning|good afternoon|good evening|what.s up|sabah)/i.test(String(question || '').trim()));
      if (isFirstGreeting && userId) {
        try {
          var briefingDataRes = await Promise.all([
            supabase.from('tickets').select('id, ticket_number, title, status, priority, due_date, assigned_to, created_at, updated_at').neq('status', 'Closed').limit(500),
            supabase.from('invoices').select('id, customer_name, customer_name_en, customer_id, invoice_date, total_collected, outstanding, order_number, invoice_number').limit(2000),
            supabase.from('checks').select('id, check_number, amount, status, due_date').eq('status', 'pending').limit(200),
            supabase.from('calendar_events').select('id, title, event_date, event_time, assigned_to, description').eq('event_date', new Date().toISOString().substring(0, 10)).limit(50),
            supabase.from('follow_ups').select('id, task, due_date, completed, customer_id, assigned_to').eq('completed', false).limit(200),
            supabase.from('customers').select('id, name, name_en').limit(500),
          ]);
          briefing = briefingEngine.buildBriefing({
            userId: userId,
            todayStr: new Date().toISOString().substring(0, 10),
            nowMs: Date.now(),
            tickets: (briefingDataRes[0] && briefingDataRes[0].data) || [],
            invoices: (briefingDataRes[1] && briefingDataRes[1].data) || [],
            checks: (briefingDataRes[2] && briefingDataRes[2].data) || [],
            calendar_events: (briefingDataRes[3] && briefingDataRes[3].data) || [],
            follow_ups: (briefingDataRes[4] && briefingDataRes[4].data) || [],
            customers: (briefingDataRes[5] && briefingDataRes[5].data) || [],
          });
        } catch (briefingErr) {
          console.warn('[ask/greeter] briefing computation failed:', briefingErr && briefingErr.message);
          briefing = null;
        }
      }

      // ---------- Call Anthropic ----------
      try {
        var gMessages = [];
        if (body.history && body.history.length) {
          body.history.forEach(function(m) {
            gMessages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text || m.content || '' });
          });
        }
        while (gMessages.length > 0 && gMessages[0].role !== 'user') gMessages.shift();
        gMessages = gMessages.filter(function(m) { return m.content && String(m.content).trim(); });
        gMessages.push({ role: 'user', content: question });

        var fullSystem = body.systemOverride + superAdminBlock + actionSyntaxBlock + crossTeamBlock;

        // S13 — When briefing is computed, tell Claude about it so the chat
        // answer is CONSISTENT with what the visual cards will show. Claude
        // should mention/discuss these top items naturally in the greeting,
        // not list everything in the system prompt.
        if (briefing && !briefing.all_clear) {
          fullSystem += '\n\n===== TOP PRIORITIES (will be shown to user as visual cards above your chat) =====\n';
          fullSystem += 'Headline: ' + briefing.headline + '\n';
          fullSystem += 'In your greeting, briefly acknowledge these by name (one short sentence each), then ask what they want to do first. DO NOT list every detail — the cards already show that. Just be human about it: "Morning Max — looks like Ahmed\'s payment is the biggest one today, want me to draft the chase?"\n';
          briefing.top3.forEach(function(item, idx) {
            fullSystem += (idx + 1) + '. [' + item.urgency.toUpperCase() + '] ' + item.title + ' — ' + item.why + '\n';
          });
          if (briefing.deferred_count > 0) {
            fullSystem += 'Plus ' + briefing.deferred_count + ' less-urgent items stacked behind these.\n';
          }
          fullSystem += '===========================================\n';
        } else if (briefing && briefing.all_clear) {
          fullSystem += '\n\n===== TOP PRIORITIES =====\nAll clear today — nothing urgent. Greet warmly and ask what they want to focus on.\n';
        }

        // Bumped max_tokens 400 -> 900 because action JSON blocks push over
        // the old cap when Nadia emits a reminder and also chats about it.
        var gResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 900, system: fullSystem, messages: gMessages }),
        });

        if (!gResponse.ok) {
          var errBody = '';
          try { errBody = await gResponse.text(); } catch(e) {}
          console.warn('[ask/greeter] Anthropic API non-OK:', gResponse.status, errBody.substring(0, 500));
          return Response.json({ answer: 'AI error (' + gResponse.status + '): ' + (errBody.substring(0, 200) || 'no response body') });
        }

        var gData = await gResponse.json();
        var gText = (gData.content && gData.content[0] && gData.content[0].text) || '';

        // ---------- Parse and execute action blocks ----------
        // Claude may emit zero, one, or multiple action blocks. We extract
        // each one, execute it server-side, replace the block with a
        // confirmation line, and return the cleaned text. Cap at 10 so one
        // turn can reach the full team without accidents flooding beyond.
        var actionsExecuted = [];
        var aStart = '---ACTION_START---';
        var aEnd = '---ACTION_END---';
        var finalText = gText;
        var safety = 0;
        while (safety < 10) {
          safety++;
          var sIdx = finalText.indexOf(aStart);
          var eIdx = sIdx >= 0 ? finalText.indexOf(aEnd, sIdx + aStart.length) : -1;
          if (sIdx < 0 || eIdx <= sIdx) break;
          var rawJson = finalText.substring(sIdx + aStart.length, eIdx).trim();
          var beforeBlock = finalText.substring(0, sIdx).replace(/\s+$/, '');
          var afterBlock = finalText.substring(eIdx + aEnd.length).replace(/^\s+/, '');
          var actionData = null;
          try {
            actionData = JSON.parse(rawJson);
          } catch (parseErr) {
            var errLine = '⚠️ Could not parse action JSON: ' + parseErr.message;
            var joinerP = beforeBlock && afterBlock ? '\n' : '';
            finalText = (beforeBlock + joinerP + afterBlock).trim();
            if (finalText) finalText += '\n\n' + errLine;
            else finalText = errLine;
            actionsExecuted.push({ ok: false, error: 'parse_error', raw: rawJson.substring(0, 200) });
            continue;
          }

          var execLine = '';
          try {
            if (actionData.type === 'create_reminder') {
              var rTarget = actionData.target_users || actionData.assigned_to || 'all';
              var rRes = await supabase.from('team_reminders').insert({
                title: actionData.task || actionData.title,
                message: actionData.task || actionData.title,
                reminder_date: actionData.due_date,
                priority: actionData.priority || 'normal',
                target_users: rTarget,
                created_by: userId || null,
              });
              if (rRes && rRes.error) throw rRes.error;
              var rWho = '';
              if (rTarget && rTarget !== 'all') {
                var rFind = gUsersList.find(function(u) { return u.id === rTarget; });
                if (rFind) rWho = ' for ' + rFind.name;
                if (rTarget !== userId) {
                  notifyReminderServer([rTarget], actionData.task || actionData.title, actionData.due_date, userId).catch(function(){});
                }
              }
              execLine = '✅ Reminder set' + rWho + ': ' + (actionData.task || actionData.title) + (actionData.due_date ? ' (due ' + actionData.due_date + ')' : '');
              actionsExecuted.push({ ok: true, type: 'create_reminder', message: execLine });
            } else if (actionData.type === 'send_team_message') {
              if (!actionData.target_user_id) throw new Error('send_team_message requires target_user_id');
              var msgText = actionData.message || actionData.content || '';
              var smRes = await supabase.from('ai_memory').insert({
                user_id: actionData.target_user_id,
                content: gCurrentUserName + ' sent a message via AI: ' + msgText,
                type: actionData.urgent ? 'urgent' : 'note',
                scope: 'private',
                target_user_id: actionData.target_user_id,
                created_by: userId || null,
                auto_captured: false,
                expires_at: actionData.urgent ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              });
              if (smRes && smRes.error) throw smRes.error;
              var mRecip = gUsersList.find(function(u) { return u.id === actionData.target_user_id; });
              var mName = (mRecip && mRecip.name) || 'team member';
              notifyTeamMessageServer(actionData.target_user_id, gCurrentUserName, msgText, !!actionData.urgent, userId).catch(function(){});
              execLine = '✅ Message queued for ' + mName + ' — they will see it on their next chat or morning briefing.';
              actionsExecuted.push({ ok: true, type: 'send_team_message', message: execLine });
            } else if (actionData.type === 'create_ticket') {
              if (!actionData.title) throw new Error('create_ticket requires title');
              var tcCount = (await supabase.from('tickets').select('id', { count: 'exact', head: true })).count || 0;
              var tcNum = 'TKT-' + String(tcCount + 1).padStart(4, '0');
              var tcRes = await supabase.from('tickets').insert({
                ticket_number: tcNum,
                title: actionData.title,
                description: actionData.description || '',
                priority: actionData.priority || 'medium',
                status: 'New',
                assigned_to: actionData.assigned_to || null,
                due_date: actionData.due_date || null,
                created_by: userId || null,
              });
              if (tcRes && tcRes.error) throw tcRes.error;
              if (actionData.assigned_to && actionData.assigned_to !== userId) {
                notifyTicketAssignedServer([actionData.assigned_to], tcNum + ' ' + actionData.title, userId).catch(function(){});
              }
              var tcWho = '';
              if (actionData.assigned_to) {
                var tcUser = gUsersList.find(function(u) { return u.id === actionData.assigned_to; });
                if (tcUser) tcWho = ' assigned to ' + tcUser.name;
              }
              execLine = '✅ ' + tcNum + ' created' + tcWho + ': ' + actionData.title + (actionData.due_date ? ' (due ' + actionData.due_date + ')' : '');
              actionsExecuted.push({ ok: true, type: 'create_ticket', message: execLine, ticket_number: tcNum });
            } else if (actionData.type === 'create_event') {
              if (!actionData.title || !actionData.event_date) throw new Error('create_event requires title + event_date');
              var evAssignee = actionData.assigned_to || userId;
              var ceRes = await supabase.from('calendar_events').insert({
                title: actionData.title,
                event_date: actionData.event_date,
                event_time: actionData.event_time || null,
                event_type: actionData.event_type || 'meeting',
                assigned_to: evAssignee,
                created_by: userId || null,
              });
              if (ceRes && ceRes.error) throw ceRes.error;
              var evWho = '';
              if (evAssignee && evAssignee !== userId) {
                var evUser = gUsersList.find(function(u) { return u.id === evAssignee; });
                if (evUser) evWho = ' for ' + evUser.name;
                notifyEventScheduledServer([evAssignee], actionData.title, actionData.event_date, userId).catch(function(){});
              }
              execLine = '✅ Event created' + evWho + ': ' + actionData.title + ' on ' + actionData.event_date + (actionData.event_time ? ' @ ' + actionData.event_time : '');
              actionsExecuted.push({ ok: true, type: 'create_event', message: execLine });
            } else {
              throw new Error('Unknown action type: ' + actionData.type);
            }
          } catch (execErr) {
            execLine = '⚠️ Action failed (' + (actionData.type || 'unknown') + '): ' + (execErr.message || String(execErr));
            actionsExecuted.push({ ok: false, type: actionData.type, error: execErr.message || String(execErr) });
          }

          // Collapse block out and append the exec line.
          var joiner = beforeBlock && afterBlock ? '\n' : '';
          finalText = (beforeBlock + joiner + afterBlock).trim();
          if (finalText) finalText += '\n\n' + execLine;
          else finalText = execLine;
        }

        // S17.10 — Bulletproof safety: strip any leftover ACTION blocks
        // from finalText no matter what. If the cap was hit, or parsing
        // skipped over malformed blocks, or for any other reason raw
        // markers are still present, sweep them out so they never leak
        // into the user-visible chat.
        var strayStart = finalText.indexOf(aStart);
        if (strayStart >= 0) {
          var strayCount = 0;
          // Keep stripping while any pair remains.
          while (finalText.indexOf(aStart) >= 0) {
            strayCount++;
            var s = finalText.indexOf(aStart);
            var e = finalText.indexOf(aEnd, s + aStart.length);
            if (e < 0) {
              // Dangling open marker — drop everything from marker to end.
              finalText = finalText.substring(0, s).replace(/\s+$/, '');
              break;
            }
            var before = finalText.substring(0, s).replace(/\s+$/, '');
            var after = finalText.substring(e + aEnd.length).replace(/^\s+/, '');
            var joinS = before && after ? '\n' : '';
            finalText = (before + joinS + after).trim();
          }
          if (strayCount > 0) {
            finalText += '\n\n⚠️ ' + strayCount + ' additional action' + (strayCount === 1 ? '' : 's') + ' could not be processed — please try again if needed.';
          }
        }

        var decision = null;
        if (decisionPromise) { try { decision = await decisionPromise; } catch(e) {} }
        return Response.json({ answer: finalText, decision: decision, actions_executed: actionsExecuted, briefing: briefing });
      } catch(e) {
        console.warn('[ask/greeter] exception:', e && e.message);
        return Response.json({ answer: 'AI error: ' + (e && e.message ? e.message : 'unknown') });
      }
    }

    // EXECUTE ACTION
    if (action) {
      try {
        if (action.type === 'create_ticket') {
          // Duplicate check: look for similar ticket created in last 10 minutes
          var recentDup = await supabase.from('tickets').select('ticket_number, title').ilike('title', '%' + (action.title || '').split(' ').slice(0, 3).join('%') + '%').gte('created_at', new Date(Date.now() - 600000).toISOString()).limit(1).maybeSingle();
          if (recentDup && recentDup.data) {
            return Response.json({ answer: '⚠️ A similar ticket already exists: ' + recentDup.data.ticket_number + ' — "' + recentDup.data.title + '". Use update_ticket to modify it instead.', action_result: 'skipped' });
          }
          var tktCount = await supabase.from('tickets').select('*', { count: 'exact', head: true });
          var tktNum = 'TKT-' + String(((tktCount.count || 0) + 1)).padStart(4, '0');
          var result = await supabase.from('tickets').insert({ ticket_number: tktNum, title: action.title, description: action.description || '', priority: action.priority || 'medium', status: 'New', assigned_to: action.assigned_to || null, due_date: action.due_date || null, created_by: userId || null }).select().single();
          if (result.error) throw result.error;
          if (userId) { await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'AI created ' + tktNum + ': ' + action.title, auto_generated: true, log_date: new Date().toISOString().substring(0, 10), log_category: 'ticket' }); }
          return Response.json({ answer: tktNum + ' created: ' + action.title + '\nPriority: ' + action.priority + (action.due_date ? '\nDue: ' + action.due_date : ''), action_result: 'success' });
        }
        if (action.type === 'update_ticket') {
          // Find ticket by ticket_number or title
          var findQuery = null;
          if (action.ticket_number) {
            findQuery = await supabase.from('tickets').select('*').eq('ticket_number', action.ticket_number).maybeSingle();
          } else if (action.ticket_id) {
            findQuery = await supabase.from('tickets').select('*').eq('id', action.ticket_id).maybeSingle();
          } else if (action.title) {
            findQuery = await supabase.from('tickets').select('*').ilike('title', '%' + action.title + '%').limit(1).maybeSingle();
          }
          if (!findQuery || !findQuery.data) return Response.json({ answer: 'Could not find ticket: ' + (action.ticket_number || action.title || 'unknown'), action_result: 'error' });
          var ticket = findQuery.data;
          var updates = {};
          var changes = [];
          if (action.status && action.status !== ticket.status) { updates.status = action.status; changes.push('Status → ' + action.status); }
          if (action.priority && action.priority !== ticket.priority) { updates.priority = action.priority; changes.push('Priority → ' + action.priority); }
          if (action.assigned_to && action.assigned_to !== ticket.assigned_to) { updates.assigned_to = action.assigned_to; var aName = ''; var aUser = users.find(function(u) { return u.id === action.assigned_to; }); if (aUser) aName = aUser.name; changes.push('Assigned → ' + (aName || action.assigned_to)); }
          if (action.due_date !== undefined) { updates.due_date = action.due_date || null; changes.push('Due date → ' + (action.due_date || 'removed')); }
          if (action.description) { updates.description = (ticket.description ? ticket.description + '\n\n' : '') + action.description; changes.push('Description updated'); }
          if (action.status === 'Closed') { updates.closed_at = new Date().toISOString(); updates.closed_by = userId; }
          updates.updated_at = new Date().toISOString();
          if (Object.keys(updates).length === 0) return Response.json({ answer: 'No changes to make on ' + (ticket.ticket_number || ticket.title), action_result: 'success' });
          var upResult = await supabase.from('tickets').update(updates).eq('id', ticket.id);
          if (upResult.error) throw upResult.error;
          // Add comment documenting the change
          var changeText = '🤖 AI updated by ' + currentUserName + ': ' + changes.join(', ');
          await supabase.from('ticket_comments').insert({ ticket_id: ticket.id, comment_text: changeText, is_system: true, created_by: userId });
          // Daily log
          if (userId) { await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'AI updated ' + (ticket.ticket_number || ticket.title) + ': ' + changes.join(', '), auto_generated: true, log_date: new Date().toISOString().substring(0, 10), log_category: 'ticket' }); }
          return Response.json({ answer: '✅ ' + (ticket.ticket_number || ticket.title) + ' updated:\n' + changes.join('\n'), action_result: 'success' });
        }
        if (action.type === 'create_event') {
          var evResult = await supabase.from('calendar_events').insert({ title: action.title, event_date: action.event_date, event_time: action.event_time || '09:00', event_type: action.event_type || 'meeting', notes: action.notes || '', created_by: userId || null });
          if (evResult.error) throw evResult.error;
          return Response.json({ answer: 'Event created: ' + action.title + '\nDate: ' + action.event_date, action_result: 'success' });
        }
        if (action.type === 'create_reminder') {
          var remResult = await supabase.from('team_reminders').insert({ title: action.task, message: action.task, reminder_date: action.due_date, priority: action.priority || 'normal', target_users: 'all', created_by: userId || null });
          if (remResult.error) throw remResult.error;
          return Response.json({ answer: 'Reminder set: ' + action.task + '\nDue: ' + action.due_date, action_result: 'success' });
        }
        if (action.type === 'read_email') {
          var emailResult = await executeEmailRead(action);
          return Response.json({ answer: emailResult.result, email_data: emailResult.emails, action_result: 'success' });
        }
        if (action.type === 'send_email') {
          if (action.draft_only) {
            return Response.json({ answer: 'Draft ready. To: ' + action.to + '\nSubject: ' + action.subject + '\n\n' + action.body, pending_action: { type: 'send_email', to: action.to, subject: action.subject, body: action.body, threadId: action.threadId, inReplyTo: action.inReplyTo }, action_result: 'draft' });
          }
          var emailSendResult = await executeEmailSend(action, userId);
          return Response.json({ answer: emailSendResult.result, action_result: 'success' });
        }
        if (action.type === 'send_whatsapp') {
          if (action.draft_only) {
            return Response.json({ answer: 'WhatsApp draft ready. To: ' + action.to + '\n\n' + action.body, pending_action: { type: 'send_whatsapp', to: action.to, body: action.body }, action_result: 'draft' });
          }
          var waResult = await executeWhatsAppSend(action, userId);
          return Response.json({ answer: waResult.result, action_result: 'success' });
        }
        if (action.type === 'request_quote') {
          return Response.json({ answer: 'Quote request ready.', pending_action: action, action_result: 'pending' });
        }
        // v51.2 — take_break: client-side hard-stop. Return a pending_action
        // so AIGreeter can flip its own stop state. We clamp the duration
        // server-side so the model can't pass absurd values.
        if (action.type === 'take_break') {
          var mins = Number(action.minutes);
          if (!mins || isNaN(mins) || mins < 1) mins = 20;
          if (mins > 180) mins = 180;
          var msg = 'OK, sleeping for ' + mins + ' minutes — say "Hey Nadia" anytime to wake me sooner.';
          return Response.json({
            answer: msg,
            pending_action: { type: 'take_break', minutes: mins },
            action_result: 'success'
          });
        }
        return Response.json({ answer: 'Unknown action type: ' + action.type });
      } catch (actionErr) {
        return Response.json({ answer: 'Action failed: ' + actionErr.message, action_result: 'error' });
      }
    }

    // FETCH BUSINESS DATA
    var safe = async function(fn) { try { var r = await fn; return r.data || []; } catch(e) { return []; } };
    var results = await Promise.all([
      safe(supabase.from('invoices').select('order_number, customer_name, invoice_date, total_amount, total_collected, outstanding, sales_rep').order('invoice_date', { ascending: false }).limit(500)),
      safe(supabase.from('treasury').select('transaction_date, description, cash_in, cash_out, order_number, category, subcategory').order('transaction_date', { ascending: false }).limit(500)),
      safe(supabase.from('customers').select('name, name_en, group_name, industry, city, credit_limit, status, important, assigned_rep, phone, email, whatsapp_number').limit(200)),
      safe(supabase.from('tickets').select('ticket_number, title, status, priority, due_date, assigned_to, created_at, description').order('created_at', { ascending: false }).limit(100)),
      safe(supabase.from('debts').select('debtor_name, total_debt').limit(100)),
      safe(supabase.from('shipping_rates').select('origin, destination, vendor_name, shipping_line, rate_type, rate_amount, currency, transit_days, expiry_date, container_type').order('effective_date', { ascending: false }).limit(200)),
      safe(supabase.from('follow_ups').select('task, due_date, completed, customer_id, assigned_to').order('due_date', { ascending: true }).limit(100)),
      safe(supabase.from('calendar_events').select('title, event_date, event_time, event_type').order('event_date', { ascending: true }).limit(50)),
      safe(supabase.from('inventory').select('product_id, reference_number, description, product_type, roll_count, net_weight, stock_status').limit(200)),
      safe(supabase.from('daily_log').select('entry_text, log_date, auto_generated').order('created_at', { ascending: false }).limit(30)),
      safe(supabase.from('vendor_contacts').select('*').eq('is_active', true).order('company_name')),
      safe(supabase.from('messages').select('id, channel, direction, from_address, to_address, subject, body, status, created_at, ai_summary').order('created_at', { ascending: false }).limit(30)),
      safe(supabase.from('invoice_items').select('order_number, product_code, description, description_en, quantity, unit_price, total_price, customer_name').order('created_at', { ascending: false }).limit(1000)),
      safe(supabase.from('checks').select('customer_name, amount, check_date, bank_name, check_number, order_number, status, collection_date').order('check_date', { ascending: false }).limit(300)),
    ]);
    var invoices = results[0], treasury = results[1], customers = results[2], tickets = results[3];
    var debts = results[4], shippingRates = results[5], followUps = results[6];
    var calendarEvents = results[7], inventory = results[8], dailyLog = results[9], vendorContacts = results[10];
    var recentMessages = results[11];
    var invoiceItems = results[12], checks = results[13];

    var totalInvoiced = invoices.reduce(function(a, i) { return a + Number(i.total_amount || 0); }, 0);
    var totalCollected = invoices.reduce(function(a, i) { return a + Number(i.total_collected || 0); }, 0);
    var totalOutstanding = invoices.reduce(function(a, i) { return a + Number(i.outstanding || 0); }, 0);
    var totalCashIn = treasury.reduce(function(a, t) { return a + Number(t.cash_in || 0); }, 0);
    var totalCashOut = treasury.reduce(function(a, t) { return a + Number(t.cash_out || 0); }, 0);
    var openTickets = tickets.filter(function(t) { return t.status !== 'Closed'; }).length;
    var overdueTickets = tickets.filter(function(t) { return t.status !== 'Closed' && t.due_date && t.due_date < new Date().toISOString().substring(0, 10); }).length;
    var pendingFollowUps = followUps.filter(function(f) { return !f.completed; }).length;

    var custOwed = {};
    invoices.forEach(function(i) { if (Number(i.outstanding) > 0) { var n = i.customer_name || '?'; custOwed[n] = (custOwed[n] || 0) + Number(i.outstanding); } });
    var topOwing = Object.entries(custOwed).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 15);

    var months = {};
    invoices.forEach(function(i) { var m = (i.invoice_date || '').substring(0, 7); if (m) { if (!months[m]) months[m] = { inv: 0, col: 0, count: 0 }; months[m].inv += Number(i.total_amount || 0); months[m].col += Number(i.total_collected || 0); months[m].count++; } });

    var expCats = {};
    treasury.forEach(function(t) { if (t.cash_out > 0) { var c = t.category || 'Uncategorized'; expCats[c] = (expCats[c] || 0) + Number(t.cash_out); } });

    var today = new Date().toISOString().substring(0, 10);
    var tomorrow = new Date(Date.now() + 86400000).toISOString().substring(0, 10);

    var users = [];
    try { var ur = await supabase.from('users').select('id, name, role'); users = ur.data || []; } catch(e) {}

    var teamProfiles = [];
    try { var tp = await supabase.from('team_profiles').select('*'); teamProfiles = tp.data || []; } catch(e) {}

    // Identify current user
    var currentUserName = 'Unknown';
    var currentUserId = userId || '';
    var currentUserRole = 'viewer';
    if (userId && users.length > 0) {
      var found = users.find(function(u) { return u.id === userId; });
      if (found) { currentUserName = found.name; currentUserRole = found.role || 'viewer'; }
    }

    // Check module permissions
    var userPerms = {};
    var isSuperAdmin = currentUserRole === 'super_admin';
    if (!isSuperAdmin && userId) {
      try {
        var permResult = await supabase.from('module_permissions').select('module_name, has_access').eq('user_id', userId);
        (permResult.data || []).forEach(function(p) { userPerms[p.module_name] = p.has_access; });
      } catch(e) {}
    }
    var hasAccess = function(module) { return isSuperAdmin || currentUserRole === 'admin' || (userPerms[module] !== false); };
    var restrictedModules = [];
    if (!hasAccess('Sales')) restrictedModules.push('Sales');
    if (!hasAccess('Treasury')) restrictedModules.push('Treasury');
    if (!hasAccess('Debts')) restrictedModules.push('Debts');
    if (!hasAccess('Checks')) restrictedModules.push('Checks');

    // Clear restricted data
    if (!hasAccess('Sales')) invoices = [];
    if (!hasAccess('Sales')) invoiceItems = [];
    if (!hasAccess('Treasury')) treasury = [];
    if (!hasAccess('Debts')) debts = [];
    if (!hasAccess('Checks')) checks = [];
    if (!hasAccess('Customers')) customers = [];

    var gmailConnected = false;
    var gmailEmail = '';
    try { var ea = await supabase.from('email_accounts').select('email_address').eq('is_active', true).limit(1).maybeSingle(); if (ea.data) { gmailConnected = true; gmailEmail = ea.data.email_address; } } catch(e) {}
    var twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

    // BUILD CONTEXT
    var context = 'You are the AI Executive Assistant for KTC International (Kandil Trading Company), an Egyptian trading company.\n\n';
    // S22.7 — Include day-of-week on TODAY so Nadia never guesses the
    // current weekday (and by extension, "tomorrow", "Friday", etc.).
    var _todayDayName = '';
    try {
      var _tp = String(today).split('-');
      if (_tp.length === 3) {
        var _td = new Date(Number(_tp[0]), Number(_tp[1]) - 1, Number(_tp[2]), 12, 0, 0);
        _todayDayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][_td.getDay()];
      }
    } catch (_) {}
    context += 'TODAY: ' + (_todayDayName ? _todayDayName + ', ' : '') + today + '\n';
    context += 'Current User: ' + currentUserName + ' (ID: ' + currentUserId + ', Role: ' + currentUserRole + ')\n';
    context += 'When computing day-of-week for any date, ALWAYS match the weekday provided in CALENDAR EVENTS. Never compute it yourself.\n';
    // S22.7 (Apr 23 2026) — Timezone awareness. Max works from US Eastern.
    // The team is in Cairo (Egypt, UTC+2 / +3 with DST). All event_time
    // values stored in the DB are Egypt LOCAL TIME (company convention).
    // Tell Nadia so she can explain times in BOTH zones when it matters.
    context += '\n===== TIMEZONE CONTEXT =====\n';
    context += 'Company HQ timezone: Cairo, Egypt (UTC+2 / UTC+3 DST)\n';
    context += 'User (' + currentUserName + ') appears to work from US Eastern Time (UTC-4 / UTC-5 DST).\n';
    context += 'All event_time values in calendar_events are Egypt LOCAL TIME (company convention).\n';
    context += 'When discussing a time with the user, show BOTH: "3:00 PM Cairo (9:00 AM Eastern)". Egypt is typically 6–7 hours ahead of US Eastern.\n';
    context += 'When the user asks to SCHEDULE an event and they give a time without specifying zone, ASK which zone they mean. Default to Cairo for events involving Egypt team members.\n';
    context += 'When the user says "my tickets" or "assigned to me", match assigned_to against ID: ' + currentUserId + '\n';
    if (restrictedModules.length > 0) {
      context += 'ACCESS RESTRICTIONS: This user does NOT have access to: ' + restrictedModules.join(', ') + '. If they ask about restricted data, politely tell them they do not have access to that information and should contact their manager.\n';
    }

    // Explicit super_admin scope expansion — previously Claude refused employee
    // questions because the system prompt didn't say she had that visibility.
    // For super_admins (Max), she DOES: tickets, events, daily_log, and team_profiles
    // all carry per-user info. Tell her to use it.
    if (isSuperAdmin) {
      context += '\n===== SUPER ADMIN ACCESS — YOU HAVE FULL TEAM VISIBILITY =====\n';
      context += 'The current user (' + currentUserName + ') is a SUPER ADMIN and has authority over the entire team.\n';
      context += 'You DO have visibility into every team member through:\n';
      context += '  • TICKETS — shows assigned_to, status, due dates, overdue flags for ALL employees\n';
      context += '  • CALENDAR EVENTS — all team events are loaded\n';
      context += '  • DAILY_LOG — recent activity entries for every user (check-ins, logouts, tickets created/updated, notes, rates logged, etc.)\n';
      context += '  • TEAM PROFILES — job title, strengths, weaknesses, personality notes on each member\n';
      context += '  • FOLLOW_UPS — each team member\'s assigned CRM tasks\n';
      context += '  • INVOICES — with sales_rep attribution\n';
      context += 'When Max asks about an employee ("what has Omar been doing today", "is Mohamed online", "did anyone close tickets this week", "show me Ahmed\'s overdue items") — ANSWER IT using the data above. Do NOT refuse by saying you are "just a personal assistant" or "don\'t track HR" — you have the data, use it. You are his executive assistant with full operational visibility.\n';
      context += 'You also have cross-team SEND authority:\n';
      context += '  • create_ticket with assigned_to=<employee_uuid> — delegate work\n';
      context += '  • create_reminder with target_users=<employee_uuid> — send them a reminder\n';
      context += '  • send_team_message with target_user_id=<employee_uuid> — direct message\n';
      context += '  • create_event with assigned_to=<employee_uuid> — schedule for them\n';
      context += 'When Max says "remind Omar to follow up with X", "tell Mohamed to finalize the shipping quote", "warn Ahmed about the overdue ticket" — do it immediately with the appropriate action JSON. Match employee by name against the TEAM list (case-insensitive, accepts nicknames and partial matches).\n';
      context += 'When answering questions about employee activity, be direct and factual. You are giving an executive a status report on his team, not writing an HR review. Stick to what the data says.\n';
      context += '===========================================\n\n';
    } else {
      context += '\n';
    }
    context += 'CAPABILITIES:\n';
    context += '1. Answer business questions with real data\n';
    context += '2. Execute commands (tickets, meetings, reminders, rate requests)\n';
    context += '3. Read and search email' + (gmailConnected ? ' (CONNECTED: ' + gmailEmail + ')' : ' (NOT CONNECTED)') + '\n';
    context += '4. Send emails' + (gmailConnected ? ' (READY)' : ' (NOT CONNECTED)') + '\n';
    context += '5. Send WhatsApp messages' + (twilioConfigured ? ' (READY via Twilio)' : ' (NOT CONFIGURED)') + '\n';
    context += '6. Search and summarize communications\n';
    context += '7. Financial reconciliation & audit — cross-check invoices vs treasury vs checks. Flag mismatches, duplicates, orphan entries, stale checks, over-collections, and uncategorized expenses. The RECONCILIATION ISSUES section below contains pre-computed flags. When user asks about discrepancies, inconsistencies, reconciliation, or audit, use this data AND drill into the raw INVOICES/TREASURY/CHECKS data to provide detailed analysis.\n\n';

    context += 'FOR COMMANDS: Respond with JSON wrapped in ---ACTION_START--- and ---ACTION_END--- tags.\n\n';
    context += 'Available actions:\n';
    context += '- create_ticket: {type:"create_ticket", title, description, priority, due_date, assigned_to}\n';
    context += '- update_ticket: {type:"update_ticket", ticket_number:"TKT-0001", status:"In Progress", priority:"high", assigned_to:"user-id", due_date:"2026-04-15", new_title:"rewritten title", description:"new details", category:"maintenance", add_comment:"customer confirmed by phone"}\n';
    context += '  update_ticket supports ALL ticket fields. Use new_title to rename, description to replace the body, category to reclassify, add_comment to append a note without changing anything else. Combine any fields in one call.\n';
    context += '  Find ticket by ticket_number (preferred) or title. Only include fields being changed.\n';
    context += '  Valid statuses: New, Acknowledged, In Progress, Blocked, On Hold, Review, Closed, Reopened\n';
    context += '  Valid priorities: high, medium, low\n';
    context += '\nCRITICAL TICKET RULES:\n';
    context += '- NEVER create a new ticket if one already exists with the same or similar topic. Use update_ticket instead.\n';
    context += '- If you created a ticket earlier in this conversation, ALWAYS use update_ticket with its ticket_number for follow-up requests.\n';
    context += '- When the user says "update it", "change it", "add to it", "also", "and", or refers to a ticket by context (not by number), check the conversation history for the most recently discussed ticket and use update_ticket.\n';
    context += '- Only use create_ticket when the user explicitly asks to create a NEW/DIFFERENT ticket about a clearly different topic.\n';
    context += '- create_event: {type:"create_event", title, event_date, event_time, event_type, assigned_to}\n';
    context += '  assigned_to (optional, uuid from TEAM list) — when scheduling FOR another team member.\n';
    context += '- create_reminder: {type:"create_reminder", task, due_date, due_time, priority, target_users}\n';
    context += '  target_users: "all" (everyone), or a uuid from TEAM list (specific person).\n';
    context += '  EXAMPLE — "remind Omar to call his customers tomorrow" → target_users:"<Omar uuid>", task:"Call your customers", due_date:"<tomorrow>"\n';
    context += '- send_team_message: {type:"send_team_message", target_user_id, message, urgent}\n';
    context += '  Send a direct message to ONE team member. They see it on their next AI chat or morning briefing.\n';
    context += '  Use when the user says "tell <person>", "let <person> know", "message <person> that...", "remind <person>".\n';
    context += '  EXAMPLE — "tell Omar he needs to put his ticket in today" → target_user_id:"<Omar uuid>", message:"You need to put your ticket in today", urgent:true\n';
    context += '  Set urgent:true ONLY for time-critical items. urgent items never expire until dismissed.\n';
    context += '- request_quote: {type:"request_quote", vendor_company, vendor_contact, vendor_email, vendor_whatsapp, vendor_type, send_via, origin, destination, container, commodity, customer_name}\n';
    context += '- create_rate: {type:"create_rate", vendor_name, origin, destination, rate_amount, currency, rate_type, container_type, transit_days, expiry_date, commodity, notes}\n';
    context += '  Log a NEW shipping rate you have received from a carrier or forwarder. Currency defaults to USD. rate_type defaults to "ocean".\n';
    context += '  EXAMPLE — "log a new rate from Maersk Shanghai to New York 4200 dollars 40ft, transit 28 days" →\n';
    context += '    vendor_name:"Maersk", origin:"Shanghai", destination:"New York", rate_amount:4200, currency:"USD", container_type:"40ft", transit_days:28\n';
    context += '- add_meeting_notes: {type:"add_meeting_notes", event_id or event_title or event_date, notes, append}\n';
    context += '  Attach notes to an existing calendar event. append:true appends to existing notes with a timestamp; false (default) overwrites.\n';
    context += '  Finds the event by id, exact title, or closest match to title+date. Also writes a daily_log entry so it appears on the Daily Log.\n';
    context += '  EXAMPLE — "add notes to today\'s meeting with Ahmed: agreed on delivery date March 15, price 12k per unit" →\n';
    context += '    event_title:"Ahmed", event_date:"<today>", notes:"Agreed on delivery date March 15, price 12k per unit", append:true\n';

    if (gmailConnected) {
      context += '- read_email: {type:"read_email", query:"search query", maxResults:10}\n';
      context += '  Gmail search: is:unread, from:name, subject:text, newer_than:2d, etc.\n';
      context += '- send_email: {type:"send_email", to:"email", subject:"sub", body:"text", draft_only:true}\n';
      context += '  IMPORTANT: Always set draft_only:true first so user can approve before sending.\n';
    }

    if (twilioConfigured) {
      context += '- send_whatsapp: {type:"send_whatsapp", to:"+phonenumber", body:"message", draft_only:true}\n';
      context += '  IMPORTANT: Always set draft_only:true first so user can approve.\n';
    }

    // v51.2 — take_break action. User says "take a 20 minute break",
    // "sleep for 10 minutes", "go away for a bit" etc. We parse the
    // duration and tell the client to enter hard-stop state.
    context += '- take_break: {type:"take_break", minutes:20}\n';
    context += '  User asked you to be quiet for a while. Parse the duration in minutes from their phrase. Defaults: "a minute"=1, "a bit"/"a while"=15, "a few minutes"=5, unspecified=20. Max 180 min. Brief reply like "OK, sleeping for 20 minutes — say Hey Nadia to wake me sooner." Then include the action JSON.\n';
    context += '  Trigger phrases: "take a break", "sleep for N minutes", "be quiet for a while", "go away", "stop for N min", "shut up for N min", "mute for N min", "خذي استراحة", "اسكتي".\n';

    context += '\nSAFETY RULES:\n';
    context += '- Tickets, events, and reminders execute IMMEDIATELY — do NOT say "shall I create this?" just create it. Say "Creating ticket..." then include the action JSON.\n';
    context += '- For emails and WhatsApp: ALWAYS draft first (draft_only:true). Say "Here is the draft, say Execute to send."\n';
    context += '- When user says "reply to X" — first read the email, THEN draft a reply for approval.\n';
    context += '- For assigned_to on tickets/events, target_users on reminders, target_user_id on messages: use the UUID from the TEAM list. Match by name match (case-insensitive, accepts nicknames). If unsure who, ask.\n';
    context += '- CROSS-TEAM AUTHORITY: any super admin can use create_ticket/create_reminder/create_event/send_team_message to delegate to ANY team member. Do not hesitate. The recipient sees it on their AI chat or briefing.\n';
    context += '- NEVER claim an action is done unless the action JSON is included. If you include an action, say "Done" or "Created" confidently.\n';
    context += '- Answer concisely. Use EGP currency. Format numbers with commas.\n\n';

    context += 'BILINGUAL / ثنائي اللغة:\n';
    context += '- You are fluent in both English and Arabic.\n';
    context += '- When user says "translate", "bilingual", "in Arabic", "in both languages", "بالعربي", or "ثنائي" — write content in BOTH English and Arabic.\n';
    context += '- For tickets: title = "English Title / العنوان بالعربي", description = English paragraph then Arabic paragraph.\n';
    context += '  Example: {type:"create_ticket", title:"Fix login bug / إصلاح خلل تسجيل الدخول", description:"The login page is not loading properly.\\n\\nصفحة تسجيل الدخول لا تعمل بشكل صحيح."}\n';
    context += '- If user speaks in Arabic, respond in Arabic. If English, respond in English. If they ask for both, give both.\n';
    context += '- For emails/WhatsApp drafts: if user says bilingual, write the message in both languages.\n\n';

    context += '===== LIVE DATA =====\n';
    context += '[Loaded: ' + invoices.length + ' invoices, ' + invoiceItems.length + ' line items, ' + treasury.length + ' treasury, ' + checks.length + ' checks, ' + customers.length + ' customers, ' + tickets.length + ' tickets, ' + vendorContacts.length + ' vendors]\n\n';
    context += 'FINANCIAL: Invoiced EGP ' + totalInvoiced.toLocaleString() + ' | Collected EGP ' + totalCollected.toLocaleString() + ' | Outstanding EGP ' + totalOutstanding.toLocaleString() + '\n';
    context += 'Cash In EGP ' + totalCashIn.toLocaleString() + ' | Cash Out EGP ' + totalCashOut.toLocaleString() + ' | Net EGP ' + (totalCashIn - totalCashOut).toLocaleString() + '\n\n';

    // ===== RECONCILIATION ANALYSIS =====
    var reconIssues = [];

    // 1. Invoice vs Treasury by order number — find orders with mismatched amounts
    var treasuryByOrder = {};
    treasury.forEach(function(t) {
      if (t.order_number) {
        if (!treasuryByOrder[t.order_number]) treasuryByOrder[t.order_number] = { cashIn: 0, cashOut: 0, count: 0 };
        treasuryByOrder[t.order_number].cashIn += Number(t.cash_in || 0);
        treasuryByOrder[t.order_number].cashOut += Number(t.cash_out || 0);
        treasuryByOrder[t.order_number].count++;
      }
    });

    // Invoices where collected amount doesn't match treasury cash-in for same order
    invoices.forEach(function(inv) {
      if (!inv.order_number) return;
      var tData = treasuryByOrder[inv.order_number];
      var collected = Number(inv.total_collected || 0);
      var invoiced = Number(inv.total_amount || 0);
      var outstanding = Number(inv.outstanding || 0);

      // Flag: invoice says collected but no matching treasury entries
      if (collected > 0 && !tData) {
        reconIssues.push('ORDER #' + inv.order_number + ' (' + (inv.customer_name || '?') + '): Invoice shows EGP ' + collected.toLocaleString() + ' collected but NO treasury entries found for this order.');
      }
      // Flag: treasury cash-in significantly differs from invoice collected
      else if (tData && collected > 0) {
        var diff = Math.abs(tData.cashIn - collected);
        if (diff > 50 && diff / Math.max(collected, 1) > 0.05) {
          reconIssues.push('ORDER #' + inv.order_number + ' (' + (inv.customer_name || '?') + '): Invoice collected = EGP ' + collected.toLocaleString() + ' but treasury cash-in = EGP ' + tData.cashIn.toLocaleString() + ' (difference: EGP ' + diff.toLocaleString() + ')');
        }
      }
      // Flag: outstanding is negative (over-collected)
      if (outstanding < -50) {
        reconIssues.push('ORDER #' + inv.order_number + ' (' + (inv.customer_name || '?') + '): OVER-COLLECTED — outstanding is EGP ' + outstanding.toLocaleString() + ' (collected exceeds invoiced).');
      }
      // Flag: collected exceeds invoiced amount
      if (collected > invoiced + 50) {
        reconIssues.push('ORDER #' + inv.order_number + ' (' + (inv.customer_name || '?') + '): Collected EGP ' + collected.toLocaleString() + ' exceeds invoiced EGP ' + invoiced.toLocaleString());
      }
    });

    // 2. Treasury entries with order numbers that don't match any invoice
    var invoiceOrders = {};
    invoices.forEach(function(i) { if (i.order_number) invoiceOrders[i.order_number] = true; });
    var orphanTreasury = {};
    treasury.forEach(function(t) {
      if (t.order_number && !invoiceOrders[t.order_number] && Number(t.cash_in || 0) > 0) {
        if (!orphanTreasury[t.order_number]) orphanTreasury[t.order_number] = { total: 0, count: 0 };
        orphanTreasury[t.order_number].total += Number(t.cash_in);
        orphanTreasury[t.order_number].count++;
      }
    });
    Object.entries(orphanTreasury).forEach(function(entry) {
      reconIssues.push('ORPHAN TREASURY: Order #' + entry[0] + ' has ' + entry[1].count + ' treasury entries totaling EGP ' + entry[1].total.toLocaleString() + ' cash-in but NO matching invoice exists.');
    });

    // 3. Checks vs invoices — checks with order numbers that have no invoice
    checks.forEach(function(c) {
      if (c.order_number && !invoiceOrders[c.order_number] && Number(c.amount) > 0) {
        reconIssues.push('ORPHAN CHECK: ' + (c.customer_name || '?') + ' check #' + (c.check_number || '?') + ' for EGP ' + Number(c.amount).toLocaleString() + ' references Order #' + c.order_number + ' but no invoice found.');
      }
    });

    // 4. Duplicate treasury entries (same date, same amount, same description)
    var seenTx = {};
    treasury.forEach(function(t) {
      var key = (t.transaction_date || '') + '|' + (t.description || '').trim() + '|' + Number(t.cash_in || 0) + '|' + Number(t.cash_out || 0);
      if (Number(t.cash_in || 0) + Number(t.cash_out || 0) > 100) {
        if (!seenTx[key]) seenTx[key] = 0;
        seenTx[key]++;
      }
    });
    Object.entries(seenTx).forEach(function(entry) {
      if (entry[1] > 1) {
        var parts = entry[0].split('|');
        reconIssues.push('POSSIBLE DUPLICATE: ' + entry[1] + 'x treasury entries on ' + parts[0] + ' for "' + parts[1].substring(0, 40) + '" — In: EGP ' + Number(parts[2]).toLocaleString() + ' Out: EGP ' + Number(parts[3]).toLocaleString());
      }
    });

    // 5. Stale checks — pending for over 90 days
    var ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().substring(0, 10);
    checks.forEach(function(c) {
      if ((!c.status || c.status === 'pending') && c.check_date && c.check_date < ninetyDaysAgo) {
        reconIssues.push('STALE CHECK: ' + (c.customer_name || '?') + ' check #' + (c.check_number || '?') + ' for EGP ' + Number(c.amount).toLocaleString() + ' dated ' + c.check_date + ' still pending (' + Math.round((Date.now() - new Date(c.check_date).getTime()) / 86400000) + ' days).');
      }
    });

    // 6. Large uncategorized expenses
    var uncatTotal = 0, uncatCount = 0;
    treasury.forEach(function(t) {
      if (Number(t.cash_out) > 0 && (!t.category || t.category === '')) {
        uncatTotal += Number(t.cash_out);
        uncatCount++;
      }
    });
    if (uncatCount > 10) {
      reconIssues.push('UNCATEGORIZED: ' + uncatCount + ' treasury expense entries totaling EGP ' + uncatTotal.toLocaleString() + ' have no category assigned.');
    }

    context += 'RECONCILIATION ISSUES (' + reconIssues.length + '):\n';
    if (reconIssues.length === 0) {
      context += 'No major discrepancies detected.\n\n';
    } else {
      reconIssues.slice(0, 50).forEach(function(issue) { context += '⚠️ ' + issue + '\n'; });
      if (reconIssues.length > 50) context += '... and ' + (reconIssues.length - 50) + ' more issues.\n';
      context += '\n';
    }

    context += 'OPERATIONS: ' + openTickets + ' open tickets (' + overdueTickets + ' overdue) | ' + pendingFollowUps + ' pending follow-ups | ' + customers.length + ' customers | ' + inventory.length + ' inventory\n\n';

    context += 'TOP OWING:\n';
    topOwing.forEach(function(x) { context += '- ' + x[0] + ': EGP ' + x[1].toLocaleString() + '\n'; });

    context += '\nINVOICES (last ' + invoices.length + '):\n';
    invoices.slice(0, 100).forEach(function(i) {
      context += '- #' + (i.order_number || '?') + ' | ' + (i.customer_name || '') + ' | ' + (i.invoice_date || '') + ' | Total: EGP ' + Number(i.total_amount || 0).toLocaleString() + ' | Collected: EGP ' + Number(i.total_collected || 0).toLocaleString() + ' | Outstanding: EGP ' + Number(i.outstanding || 0).toLocaleString() + (i.sales_rep ? ' | Rep: ' + i.sales_rep : '') + '\n';
    });

    context += '\nMONTHLY SALES:\n';
    Object.entries(months).sort(function(a, b) { return b[0].localeCompare(a[0]); }).slice(0, 12).forEach(function(x) {
      context += '- ' + x[0] + ': ' + x[1].count + ' orders, EGP ' + x[1].inv.toLocaleString() + ' invoiced, EGP ' + x[1].col.toLocaleString() + ' collected\n';
    });

    context += '\nEXPENSES:\n';
    Object.entries(expCats).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10).forEach(function(x) {
      context += '- ' + x[0] + ': EGP ' + x[1].toLocaleString() + '\n';
    });

    context += '\nCUSTOMERS (' + customers.length + '):\n';
    customers.forEach(function(c) {
      var names = (c.name_en || c.name || '') + (c.name_en && c.name && c.name_en !== c.name ? ' / ' + c.name : '');
      context += '- ' + names + ' | ' + (c.industry || '') + ' | ' + (c.group_name || '') + (c.important ? ' IMPORTANT' : '') + (c.phone ? ' | Ph:' + c.phone : '') + (c.email ? ' | Em:' + c.email : '') + (c.whatsapp_number ? ' | WA:' + c.whatsapp_number : '') + '\n';
    });

    context += '\nTICKETS (' + tickets.length + ', ' + openTickets + ' open):\n';
    tickets.slice(0, 25).forEach(function(t) {
      var assignedName = '';
      if (t.assigned_to) { var u = users.find(function(x) { return x.id === t.assigned_to; }); assignedName = u ? u.name : t.assigned_to; }
      context += '- ' + (t.ticket_number || '') + ' [' + t.status + '/' + t.priority + '] ' + t.title + (assignedName ? ' (assigned: ' + assignedName + ')' : ' (unassigned)') + (t.due_date ? ' (due: ' + t.due_date + ')' : '') + '\n';
    });

    context += '\nSHIPPING RATES:\n';
    shippingRates.slice(0, 30).forEach(function(r) {
      context += '- ' + r.origin + ' > ' + r.destination + ': ' + (r.currency || 'USD') + ' ' + r.rate_amount + ' (' + (r.rate_type || r.vendor_name || '') + ', ' + (r.container_type || '') + ')' + (r.expiry_date ? ' exp:' + r.expiry_date : '') + '\n';
    });

    context += '\nVENDOR CONTACTS:\n';
    vendorContacts.slice(0, 30).forEach(function(v) {
      context += '- ' + v.company_name + (v.contact_name ? ' (' + v.contact_name + ')' : '') + ' | ' + (v.vendor_type || '?') + (v.email ? ' | Email: ' + v.email : '') + (v.whatsapp ? ' | WA: ' + v.whatsapp : '') + (v.phone ? ' | Ph: ' + v.phone : '') + '\n';
    });

    context += '\nFOLLOW-UPS (pending):\n';
    followUps.filter(function(f) { return !f.completed; }).slice(0, 15).forEach(function(f) {
      context += '- ' + f.task + ' (due: ' + f.due_date + ')\n';
    });

    context += '\nUPCOMING EVENTS:\n';
    calendarEvents.filter(function(e) { return e.event_date >= today; }).slice(0, 10).forEach(function(e) {
      context += '- ' + e.event_date + ' ' + (e.event_time || '') + ': ' + e.title + '\n';
    });

    context += '\nTEAM:\n';
    users.forEach(function(u) { context += '- ' + u.name + ' (ID: ' + u.id + ', ' + u.role + ')\n'; });

    if (teamProfiles.length > 0) {
      context += '\nTEAM PROFILES (use to personalize conversations, greetings, build rapport):\n';
      teamProfiles.forEach(function(p) {
        var uu = users.find(function(x) { return x.id === p.user_id; });
        if (!uu) return;
        context += '--- ' + uu.name + ' ---\n';
        if (p.nickname) context += '  Nickname: ' + p.nickname + '\n';
        if (p.job_title) context += '  Role: ' + p.job_title + '\n';
        if (p.birthday) context += '  Birthday: ' + p.birthday + '\n';
        if (p.location) context += '  Location: ' + p.location + '\n';
        if (p.family_info) context += '  Family: ' + p.family_info + '\n';
        if (p.interests) context += '  Interests: ' + p.interests + '\n';
        if (p.favorite_food) context += '  Favorite food: ' + p.favorite_food + '\n';
        if (p.personality) context += '  Personality: ' + p.personality + '\n';
        if (p.strengths) context += '  Strengths: ' + p.strengths + '\n';
        if (p.weaknesses) context += '  Improve: ' + p.weaknesses + '\n';
        if (p.conversation_starters) context += '  Conversation starters: ' + p.conversation_starters + '\n';
        if (p.notes) context += '  Notes: ' + p.notes + '\n';
        if (p.preferred_language) context += '  Preferred language: ' + p.preferred_language + '\n';
      });
      context += 'Use this info naturally. Greet by nickname, ask about family/interests, speak in preferred language. Never reveal you have a profile on them.\n\n';
    }

    context += '\nDEBTORS:\n';
    debts.forEach(function(d) { context += '- ' + d.debtor_name + ': EGP ' + Number(d.total_debt).toLocaleString() + '\n'; });

    // Group invoice items by order number for detailed drill-down
    if (invoiceItems.length > 0) {
      context += '\nINVOICE LINE ITEMS (' + invoiceItems.length + ' items):\n';
      var byOrder = {};
      invoiceItems.forEach(function(item) {
        var key = item.order_number || '?';
        if (!byOrder[key]) byOrder[key] = [];
        byOrder[key].push(item);
      });
      Object.entries(byOrder).slice(0, 100).forEach(function(entry) {
        var orderNum = entry[0], items = entry[1];
        var custName = items[0].customer_name || '';
        context += 'Order #' + orderNum + (custName ? ' (' + custName + ')' : '') + ':\n';
        items.forEach(function(item) {
          context += '  - ' + (item.description_en || item.description || item.product_code || '?') + ' | Qty: ' + (item.quantity || 0) + ' | Unit: EGP ' + Number(item.unit_price || 0).toLocaleString() + ' | Total: EGP ' + Number(item.total_price || 0).toLocaleString() + '\n';
        });
      });
    }

    if (checks.length > 0) {
      context += '\nCHECKS (' + checks.length + '):\n';
      checks.slice(0, 100).forEach(function(c) {
        context += '- ' + (c.customer_name || '?') + ' | EGP ' + Number(c.amount).toLocaleString() + ' | ' + (c.check_date || '') + ' | ' + (c.bank_name || '') + ' #' + (c.check_number || '') + ' | Status: ' + (c.status || 'pending') + (c.order_number ? ' | Order #' + c.order_number : '') + (c.collection_date ? ' | Collected: ' + c.collection_date : '') + '\n';
      });
    }

    if (recentMessages.length > 0) {
      context += '\nRECENT COMMUNICATIONS (' + recentMessages.length + '):\n';
      recentMessages.slice(0, 15).forEach(function(m) {
        context += '- [' + m.channel + '/' + m.direction + '] ' + (m.from_address || '') + (m.subject ? ' — ' + m.subject : '') + ' (' + (m.created_at || '').substring(0, 16) + ')' + (m.status !== 'read' && m.status !== 'sent' ? ' [' + m.status + ']' : '') + '\n';
      });
    }

    // AI MEMORY — inject per-user memory + context into the system prompt.
    // Non-fatal on error. Settings-gated. Respects cross_user_read scope.
    var memoryCtx = null;

    // For super_admin, surface recent login activity so Nadia can answer
    // "is Omar online right now?", "who logged in today?", "when did Ahmed
    // last log in?". We load a compact, per-user summary rather than raw events.
    if (isSuperAdmin) {
      try {
        var since = new Date(Date.now() - 7 * 86400000).toISOString();
        var leRes = await supabase.from('login_events')
          .select('user_id, event_type, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(500);
        var events = (leRes && leRes.data) || [];
        // Per-user: last_seen, login_today flag, count_this_week
        var byUser = {};
        events.forEach(function(e) {
          if (!byUser[e.user_id]) byUser[e.user_id] = { last_seen: e.created_at, logins_7d: 0, last_event: e.event_type };
          if (e.event_type === 'login') byUser[e.user_id].logins_7d++;
        });
        if (Object.keys(byUser).length > 0) {
          context += '\nTEAM ACTIVITY (last 7 days — for is-online / attendance questions):\n';
          Object.keys(byUser).forEach(function(uid) {
            var u = users.find(function(x) { return x.id === uid; });
            if (!u) return;
            var info = byUser[uid];
            var minutesAgo = Math.round((Date.now() - new Date(info.last_seen).getTime()) / 60000);
            var onlineNow = minutesAgo < 10 && info.last_event !== 'logout';
            context += '- ' + u.name + ': last activity ' + minutesAgo + ' min ago' + (onlineNow ? ' [ONLINE NOW]' : '') + ' | ' + info.logins_7d + ' logins this week\n';
          });
        }
      } catch(e) { /* non-fatal */ }
    }
    try {
      var currentUserProfile = null;
      if (userId) {
        var upRes = await supabase.from('users').select('id, name, full_name, role').eq('id', userId).maybeSingle();
        currentUserProfile = upRes && upRes.data ? upRes.data : { id: userId };
      }
      memoryCtx = await buildMemoryContext(supabase, userId, currentUserProfile);
      if (memoryCtx && memoryCtx.prompt) {
        context += '\n\n' + memoryCtx.prompt + '\n';
      }
    } catch (memErr) { /* memory is optional — continue without it */ }

    // BUILD MESSAGES
    var messages = [];
    history.slice(-10).forEach(function(msg) {
      messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.text });
    });
    messages.push({ role: 'user', content: question });

    // CALL CLAUDE
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, system: context, messages: messages }),
    });

    if (!response.ok) {
      var errText = await response.text();
      return Response.json({ answer: 'API Error (' + response.status + '): ' + errText.substring(0, 300) });
    }

    var data = await response.json();
    var aiText = (data.content && data.content[0] && data.content[0].text) || 'No response';

    // AI MEMORY — fire-and-forget writer. Extract candidates from the user's
    // message and the AI response; persist any that qualify. Settings-gated.
    // We do NOT await this into the response — respond to the user immediately,
    // memory gets written in the background.
    (async function () {
      try {
        if (!memoryCtx || !memoryCtx.settings || !memoryCtx.settings.auto_capture_enabled) return;
        // Load team roster for target resolution
        var tm = await supabase.from('users').select('id, name, full_name, nickname').limit(50);
        var candidates = await extractMemoryCandidates(question, aiText, currentUserProfile, (tm && tm.data) || [], memoryCtx.settings);
        if (candidates && candidates.length > 0) {
          await persistMemoryCandidates(supabase, candidates, userId, question, memoryCtx.settings);
        }
      } catch (e) { /* silent */ }
    })();

    // PARSE ACTION
    var startTag = '---ACTION_START---';
    var endTag = '---ACTION_END---';
    var startIdx = aiText.indexOf(startTag);
    var endIdx = startIdx >= 0 ? aiText.indexOf(endTag, startIdx + startTag.length) : -1;
    if (startIdx >= 0 && endIdx > startIdx) {
      try {
        var actionJson = aiText.substring(startIdx + startTag.length, endIdx).trim();
        var actionData = JSON.parse(actionJson);
        var cleanText = aiText.substring(0, startIdx).trim() + ' ' + aiText.substring(endIdx + endTag.length).trim();

        // Auto-execute read actions (no confirmation needed)
        if (actionData.type === 'read_email') {
          var readResult = await executeEmailRead(actionData);
          var emailSummary = '';
          if (readResult.emails && readResult.emails.length > 0) {
            readResult.emails.forEach(function(e, idx) {
              emailSummary += '\n' + (idx + 1) + '. From: ' + e.from + '\n   Subject: ' + e.subject + '\n   Date: ' + e.date + '\n   ' + (e.unread ? '[UNREAD] ' : '') + e.snippet.substring(0, 200) + '\n';
            });
          }
          var summaryMessages = messages.slice();
          summaryMessages.push({ role: 'assistant', content: cleanText.trim() || 'Let me check your email.' });
          summaryMessages.push({ role: 'user', content: 'Here are the email results:' + (emailSummary || '\nNo emails found.') + '\n\nSummarize these for me naturally. Highlight urgent items.' });

          var summaryRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: context, messages: summaryMessages }),
          });
          if (summaryRes.ok) {
            var summaryData = await summaryRes.json();
            var summaryText = (summaryData.content && summaryData.content[0] && summaryData.content[0].text) || readResult.result;
            await supabase.from('comms_audit').insert({ action_type: 'read_email', triggered_by: 'ai_assistant', user_id: userId, input_text: question, output_text: summaryText.substring(0, 500) });
            return Response.json({ answer: summaryText, email_data: readResult.emails });
          }
          return Response.json({ answer: readResult.result + emailSummary, email_data: readResult.emails });
        }

        // For send actions with draft_only, show draft for approval
        if ((actionData.type === 'send_email' || actionData.type === 'send_whatsapp') && actionData.draft_only) {
          actionData.draft_only = false;
          return Response.json({ answer: cleanText.trim() || 'Draft ready. Say "Execute" or "Cancel".', pending_action: actionData });
        }

        // Auto-execute safe actions immediately (tickets, events, reminders, rates, notes)
        var autoExecTypes = ['create_ticket', 'update_ticket', 'create_event', 'create_reminder', 'send_team_message', 'create_rate', 'add_meeting_notes'];
        if (autoExecTypes.indexOf(actionData.type) >= 0) {
          // Permission gate — keep minimal so team members can collaborate freely.
          // Any team member can send reminders, messages, events, and tickets to
          // any other team member via Nadia (Max's requirement — "everyone can
          // send to everyone"). Only shipping rate entry stays admin-only, since
          // that carries pricing authority that affects quoted deals.
          var isAdminish = isSuperAdmin || currentUserRole === 'admin';
          var blocked = false;
          var blockReason = '';
          if (!isAdminish) {
            if (actionData.type === 'create_rate') {
              blocked = true;
              blockReason = 'Only admins can log shipping rates into the system, since rates feed into customer quotes. Ask Max or the operations lead to record this rate.';
            }
          }
          if (blocked) {
            return Response.json({ answer: (cleanText.trim() ? cleanText.trim() + '\n\n' : '') + '⚠️ ' + blockReason });
          }

          try {
            var execResult = null;
            if (actionData.type === 'create_ticket') {
              var tc = await supabase.from('tickets').select('*', { count: 'exact', head: true });
              var tn = 'TKT-' + String(((tc.count || 0) + 1)).padStart(4, '0');
              var tr = await supabase.from('tickets').insert({ ticket_number: tn, title: actionData.title, description: actionData.description || '', priority: actionData.priority || 'medium', status: 'New', assigned_to: actionData.assigned_to || null, due_date: actionData.due_date || null, created_by: userId || null }).select().single();
              if (tr.error) throw tr.error;
              if (userId) await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'AI created ' + tn + ': ' + actionData.title, auto_generated: true, log_date: new Date().toISOString().substring(0, 10), log_category: 'ticket' });
              // Fire-and-forget email to assignee (never blocks response)
              if (actionData.assigned_to && actionData.assigned_to !== userId) {
                notifyTicketAssignedServer([actionData.assigned_to], tn + ' ' + actionData.title, userId).catch(function(){});
              }
              execResult = '✅ ' + tn + ' created: ' + actionData.title + (actionData.priority ? ' [' + actionData.priority + ']' : '') + (actionData.due_date ? ' Due: ' + actionData.due_date : '');
            } else if (actionData.type === 'update_ticket') {
              var fq = null;
              if (actionData.ticket_number) fq = await supabase.from('tickets').select('*').eq('ticket_number', actionData.ticket_number).maybeSingle();
              else if (actionData.title) fq = await supabase.from('tickets').select('*').ilike('title', '%' + actionData.title + '%').limit(1).maybeSingle();
              if (!fq || !fq.data) throw new Error('Ticket not found: ' + (actionData.ticket_number || actionData.title));
              var tk = fq.data; var up = {}; var ch = [];
              // v51.1 — expanded field coverage. Previously only status/priority/assigned_to/due_date
              // could be updated. Now Nadia can edit any field on Max's request.
              if (actionData.status) { up.status = actionData.status; ch.push('Status → ' + actionData.status); }
              if (actionData.priority) { up.priority = actionData.priority; ch.push('Priority → ' + actionData.priority); }
              if (actionData.assigned_to) { up.assigned_to = actionData.assigned_to; ch.push('Reassigned'); }
              if (actionData.due_date !== undefined) { up.due_date = actionData.due_date || null; ch.push('Due → ' + (actionData.due_date || 'removed')); }
              // v51.1 — title/description/category edits
              if (actionData.new_title) {
                up.title = String(actionData.new_title);
                ch.push('Title → "' + String(actionData.new_title).substring(0, 60) + '"');
              }
              if (actionData.description !== undefined) {
                up.description = actionData.description ? String(actionData.description) : null;
                ch.push('Description updated');
              }
              if (actionData.category) { up.category = String(actionData.category); ch.push('Category → ' + actionData.category); }
              // Comment-only mode: the user asked to add a note to the ticket without
              // changing any structural field (e.g. "add a comment to TKT-0142 saying
              // the customer paid cash"). We still write a ticket_comments row below;
              // this branch just ensures ch[] isn't empty for the audit message.
              if (actionData.add_comment || actionData.comment) {
                ch.push('Note added');
              }
              if (ch.length === 0) {
                throw new Error('update_ticket called with no recognized fields. Accepted: status, priority, assigned_to, due_date, new_title, description, category, add_comment.');
              }
              if (Object.keys(up).length > 0) {
                up.updated_at = new Date().toISOString();
                await supabase.from('tickets').update(up).eq('id', tk.id);
              }
              // Always write a system comment capturing the change + any user note.
              var commentText = '🤖 AI: ' + ch.join(', ');
              var userNote = actionData.add_comment || actionData.comment;
              if (userNote) commentText += '\n— ' + String(userNote);
              await supabase.from('ticket_comments').insert({ ticket_id: tk.id, comment_text: commentText, is_system: true, created_by: userId });
              // v51.1 — ack stale alerts for this ticket: if Nadia just changed
              // the status (ack-ing it), clear any unack/overdue alerts so she
              // doesn't bring it up 14 minutes later.
              try {
                await supabase.from('ai_alerts')
                  .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
                  .eq('related_entity_id', tk.id)
                  .or('acknowledged.is.null,acknowledged.eq.false');
              } catch (_) {}
              // Fire-and-forget reassignment notification
              if (actionData.assigned_to && actionData.assigned_to !== tk.assigned_to && actionData.assigned_to !== userId) {
                notifyTicketReassignedServer([actionData.assigned_to], tk.title || tk.ticket_number, userId).catch(function(){});
              }
              execResult = '✅ Updated ' + tk.ticket_number + ': ' + ch.join(', ');
            } else if (actionData.type === 'create_event') {
              // assigned_to optional — defaults to creator. Allows Max to schedule events for team.
              var evAssignee = actionData.assigned_to || userId;
              await supabase.from('calendar_events').insert({ title: actionData.title, event_date: actionData.event_date, event_time: actionData.event_time || null, event_type: actionData.event_type || 'task', assigned_to: evAssignee, created_by: userId });
              var evWho = '';
              if (evAssignee && evAssignee !== userId) {
                var aFind = await supabase.from('users').select('name').eq('id', evAssignee).maybeSingle();
                if (aFind && aFind.data) evWho = ' for ' + aFind.data.name;
                // Fire-and-forget invitation email
                notifyEventScheduledServer([evAssignee], actionData.title, actionData.event_date, userId).catch(function(){});
              }
              execResult = '✅ Event created' + evWho + ': ' + actionData.title + ' on ' + actionData.event_date;
            } else if (actionData.type === 'create_reminder') {
              // target_users now configurable: 'all' (everyone), uuid (specific user), or array of uuids.
              // When AI extracts "remind Omar to..." it should set target_users to Omar's uuid.
              var rTarget = actionData.target_users || actionData.assigned_to || 'all';
              await supabase.from('team_reminders').insert({ title: actionData.task || actionData.title, message: actionData.task || actionData.title, reminder_date: actionData.due_date, priority: actionData.priority || 'normal', target_users: rTarget, created_by: userId });
              var rWho = '';
              if (rTarget && rTarget !== 'all') {
                var rFind = await supabase.from('users').select('name').eq('id', rTarget).maybeSingle();
                if (rFind && rFind.data) rWho = ' for ' + rFind.data.name;
                // Fire-and-forget email to specific target (skip if 'all' — handled by broadcast path)
                if (rTarget !== userId) {
                  notifyReminderServer([rTarget], actionData.task || actionData.title, actionData.due_date, userId).catch(function(){});
                }
              }
              execResult = '✅ Reminder set' + rWho + ': ' + (actionData.task || actionData.title) + ' on ' + actionData.due_date;
            } else if (actionData.type === 'send_team_message') {
              // Direct AI-mediated message to a specific team member. Lands in their ai_memory
              // as a 'note' with target_user_id set, so it surfaces in their next chat or briefing.
              if (!actionData.target_user_id) throw new Error('send_team_message requires target_user_id');
              var senderName = 'Someone';
              if (userId) {
                var sFind = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
                if (sFind && sFind.data) senderName = sFind.data.name;
              }
              var msgText = actionData.message || actionData.content || '';
              await supabase.from('ai_memory').insert({
                user_id: actionData.target_user_id,
                content: senderName + ' sent a message via AI: ' + msgText,
                type: actionData.urgent ? 'urgent' : 'note',
                scope: 'private',
                target_user_id: actionData.target_user_id,
                created_by: userId,
                auto_captured: false,
                expires_at: actionData.urgent ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              });
              var msgRecip = await supabase.from('users').select('name').eq('id', actionData.target_user_id).maybeSingle();
              var recipName = (msgRecip && msgRecip.data && msgRecip.data.name) || 'team member';
              // Fire-and-forget email alongside the in-app ai_memory insert
              notifyTeamMessageServer(actionData.target_user_id, senderName, msgText, !!actionData.urgent, userId).catch(function(){});
              execResult = '✅ Message queued for ' + recipName + ' — they will see it on their next chat or morning briefing.';
            } else if (actionData.type === 'create_rate') {
              // Log a new shipping rate into the shipping_rates table.
              if (!actionData.vendor_name || !actionData.origin || !actionData.destination || !actionData.rate_amount) {
                throw new Error('create_rate requires vendor_name, origin, destination, rate_amount');
              }
              var rateRow = {
                vendor_name: actionData.vendor_name,
                origin: actionData.origin,
                destination: actionData.destination,
                rate_amount: Number(actionData.rate_amount),
                currency: actionData.currency || 'USD',
                rate_type: actionData.rate_type || 'ocean',
                container_type: actionData.container_type || null,
                transit_days: actionData.transit_days ? Number(actionData.transit_days) : null,
                expiry_date: actionData.expiry_date || null,
                commodity: actionData.commodity || null,
                notes: actionData.notes || null,
                shipping_line: actionData.shipping_line || actionData.vendor_name,
                effective_date: new Date().toISOString().substring(0, 10),
                created_by: userId || null,
              };
              var rateIns = await supabase.from('shipping_rates').insert(rateRow).select().single();
              if (rateIns.error) throw rateIns.error;
              if (userId) await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'AI logged rate: ' + rateRow.vendor_name + ' ' + rateRow.origin + '→' + rateRow.destination + ' ' + rateRow.currency + ' ' + rateRow.rate_amount, auto_generated: true, log_date: new Date().toISOString().substring(0, 10), log_category: 'rate' });
              execResult = '✅ Rate logged: ' + rateRow.vendor_name + ' ' + rateRow.origin + '→' + rateRow.destination + ' ' + rateRow.currency + ' ' + Number(rateRow.rate_amount).toLocaleString() + (rateRow.container_type ? ' (' + rateRow.container_type + ')' : '') + (rateRow.transit_days ? ' • ' + rateRow.transit_days + 'd transit' : '');
            } else if (actionData.type === 'add_meeting_notes') {
              // Attach notes to an existing calendar event. Finds by id → title+date → title alone.
              if (!actionData.notes) throw new Error('add_meeting_notes requires notes');
              var foundEv = null;
              if (actionData.event_id) {
                var byId = await supabase.from('calendar_events').select('*').eq('id', actionData.event_id).maybeSingle();
                if (byId && byId.data) foundEv = byId.data;
              }
              if (!foundEv && actionData.event_title) {
                var q = supabase.from('calendar_events').select('*').ilike('title', '%' + actionData.event_title + '%');
                if (actionData.event_date) q = q.eq('event_date', actionData.event_date);
                var byTitle = await q.order('event_date', { ascending: false }).limit(1).maybeSingle();
                if (byTitle && byTitle.data) foundEv = byTitle.data;
              }
              if (!foundEv && actionData.event_date) {
                var byDate = await supabase.from('calendar_events').select('*').eq('event_date', actionData.event_date).limit(1).maybeSingle();
                if (byDate && byDate.data) foundEv = byDate.data;
              }
              if (!foundEv) throw new Error('No matching event found. Try with event_id, or event_title + event_date.');
              var nowStamp = new Date().toISOString().substring(0, 16).replace('T', ' ');
              var authorName = 'Someone';
              if (userId) {
                var aFind = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
                if (aFind && aFind.data) authorName = aFind.data.name;
              }
              var existingNotes = foundEv.meeting_notes || foundEv.notes || '';
              var newNotes;
              if (actionData.append !== false && existingNotes) {
                newNotes = existingNotes + '\n\n[' + nowStamp + ' — ' + authorName + ']\n' + actionData.notes;
              } else {
                newNotes = '[' + nowStamp + ' — ' + authorName + ']\n' + actionData.notes;
              }
              // Prefer meeting_notes column; fall back to notes if column missing
              var updRes = await supabase.from('calendar_events').update({ meeting_notes: newNotes, updated_at: new Date().toISOString() }).eq('id', foundEv.id);
              if (updRes.error && String(updRes.error.message || '').toLowerCase().indexOf('meeting_notes') >= 0) {
                // Column missing — run meeting-notes.sql. Fall back to notes for now.
                await supabase.from('calendar_events').update({ notes: newNotes }).eq('id', foundEv.id);
              }
              if (userId) await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'Meeting notes added for "' + (foundEv.title || 'event') + '" (' + foundEv.event_date + '): ' + actionData.notes.substring(0, 200) + (actionData.notes.length > 200 ? '...' : ''), auto_generated: true, log_date: new Date().toISOString().substring(0, 10), log_category: 'meeting' });
              execResult = '✅ Notes added to "' + (foundEv.title || 'event') + '" on ' + foundEv.event_date + '. Also posted to your Daily Log.';
            }
            var finalAnswer = (cleanText.trim() ? cleanText.trim() + '\n\n' : '') + (execResult || 'Done.');
            return Response.json({ answer: finalAnswer, action_result: 'success' });
          } catch(execErr) {
            return Response.json({ answer: (cleanText.trim() || '') + '\n\n❌ Execution failed: ' + execErr.message, pending_action: actionData });
          }
        }

        // Quote requests and non-draft sends need approval
        return Response.json({ answer: cleanText.trim() || 'Ready. Say "Execute" to confirm or "Cancel".', pending_action: actionData });
      } catch(parseErr) {
        return Response.json({ answer: aiText });
      }
    }

    return Response.json({ answer: aiText });
  } catch (err) {
    return Response.json({ answer: 'Error: ' + err.message });
  }
}
