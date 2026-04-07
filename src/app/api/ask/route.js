import { createClient } from '@supabase/supabase-js';

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

    // EXECUTE ACTION
    if (action) {
      try {
        if (action.type === 'create_ticket') {
          var tktCount = await supabase.from('tickets').select('*', { count: 'exact', head: true });
          var tktNum = 'TKT-' + String(((tktCount.count || 0) + 1)).padStart(4, '0');
          var result = await supabase.from('tickets').insert({ ticket_number: tktNum, title: action.title, description: action.description || '', priority: action.priority || 'medium', status: 'New', assigned_to: action.assigned_to || null, due_date: action.due_date || null, created_by: userId || null }).select().single();
          if (result.error) throw result.error;
          if (userId) { await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'AI created ' + tktNum + ': ' + action.title, auto_generated: true, log_date: new Date().toISOString().substring(0, 10), log_category: 'ticket' }); }
          return Response.json({ answer: tktNum + ' created: ' + action.title + '\nPriority: ' + action.priority + (action.due_date ? '\nDue: ' + action.due_date : ''), action_result: 'success' });
        }
        if (action.type === 'create_event') {
          var evResult = await supabase.from('calendar_events').insert({ title: action.title, event_date: action.event_date, event_time: action.event_time || '09:00', event_type: action.event_type || 'meeting', notes: action.notes || '', created_by: userId || null });
          if (evResult.error) throw evResult.error;
          return Response.json({ answer: 'Event created: ' + action.title + '\nDate: ' + action.event_date, action_result: 'success' });
        }
        if (action.type === 'create_reminder') {
          var remResult = await supabase.from('follow_ups').insert({ task: action.task, due_date: action.due_date, due_time: action.due_time || '09:00', assigned_to: userId || null, created_by: userId || null });
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
    ]);
    var invoices = results[0], treasury = results[1], customers = results[2], tickets = results[3];
    var debts = results[4], shippingRates = results[5], followUps = results[6];
    var calendarEvents = results[7], inventory = results[8], dailyLog = results[9], vendorContacts = results[10];
    var recentMessages = results[11];

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

    // Identify current user
    var currentUserName = 'Unknown';
    var currentUserId = userId || '';
    if (userId && users.length > 0) {
      var found = users.find(function(u) { return u.id === userId; });
      if (found) currentUserName = found.name;
    }

    var gmailConnected = false;
    var gmailEmail = '';
    try { var ea = await supabase.from('email_accounts').select('email_address').eq('is_active', true).limit(1).maybeSingle(); if (ea.data) { gmailConnected = true; gmailEmail = ea.data.email_address; } } catch(e) {}
    var twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

    // BUILD CONTEXT
    var context = 'You are the AI Executive Assistant for KTC International (Kandil Trading Company), an Egyptian trading company.\n\n';
    context += 'TODAY: ' + today + '\n';
    context += 'CURRENT USER: ' + currentUserName + ' (ID: ' + currentUserId + ')\n';
    context += 'When the user says "my tickets" or "assigned to me", match assigned_to against ID: ' + currentUserId + '\n\n';
    context += 'CAPABILITIES:\n';
    context += '1. Answer business questions with real data\n';
    context += '2. Execute commands (tickets, meetings, reminders, rate requests)\n';
    context += '3. Read and search email' + (gmailConnected ? ' (CONNECTED: ' + gmailEmail + ')' : ' (NOT CONNECTED)') + '\n';
    context += '4. Send emails' + (gmailConnected ? ' (READY)' : ' (NOT CONNECTED)') + '\n';
    context += '5. Send WhatsApp messages' + (twilioConfigured ? ' (READY via Twilio)' : ' (NOT CONFIGURED)') + '\n';
    context += '6. Search and summarize communications\n\n';

    context += 'FOR COMMANDS: Respond with JSON wrapped in ---ACTION_START--- and ---ACTION_END--- tags.\n\n';
    context += 'Available actions:\n';
    context += '- create_ticket: {type:"create_ticket", title, description, priority, due_date, assigned_to}\n';
    context += '- create_event: {type:"create_event", title, event_date, event_time, event_type}\n';
    context += '- create_reminder: {type:"create_reminder", task, due_date, due_time}\n';
    context += '- request_quote: {type:"request_quote", vendor_company, vendor_contact, vendor_email, vendor_whatsapp, vendor_type, send_via, origin, destination, container, commodity, customer_name}\n';

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

    context += '\nSAFETY RULES:\n';
    context += '- ALWAYS draft first (draft_only:true) before sending any email or WhatsApp. NEVER auto-send.\n';
    context += '- When user says "reply to X" — first read the email, THEN draft a reply for approval.\n';
    context += '- For assigned_to on tickets: use user ID from TEAM list.\n';
    context += '- Answer concisely. Use EGP currency. Format numbers with commas.\n\n';

    context += '===== LIVE DATA =====\n';
    context += '[Loaded: ' + invoices.length + ' invoices, ' + treasury.length + ' treasury, ' + customers.length + ' customers, ' + tickets.length + ' tickets, ' + vendorContacts.length + ' vendors]\n\n';
    context += 'FINANCIAL: Invoiced EGP ' + totalInvoiced.toLocaleString() + ' | Collected EGP ' + totalCollected.toLocaleString() + ' | Outstanding EGP ' + totalOutstanding.toLocaleString() + '\n';
    context += 'Cash In EGP ' + totalCashIn.toLocaleString() + ' | Cash Out EGP ' + totalCashOut.toLocaleString() + ' | Net EGP ' + (totalCashIn - totalCashOut).toLocaleString() + '\n\n';
    context += 'OPERATIONS: ' + openTickets + ' open tickets (' + overdueTickets + ' overdue) | ' + pendingFollowUps + ' pending follow-ups | ' + customers.length + ' customers | ' + inventory.length + ' inventory\n\n';

    context += 'TOP OWING:\n';
    topOwing.forEach(function(x) { context += '- ' + x[0] + ': EGP ' + x[1].toLocaleString() + '\n'; });

    context += '\nMONTHLY SALES:\n';
    Object.entries(months).sort(function(a, b) { return b[0].localeCompare(a[0]); }).slice(0, 12).forEach(function(x) {
      context += '- ' + x[0] + ': ' + x[1].count + ' orders, EGP ' + x[1].inv.toLocaleString() + ' invoiced, EGP ' + x[1].col.toLocaleString() + ' collected\n';
    });

    context += '\nEXPENSES:\n';
    Object.entries(expCats).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10).forEach(function(x) {
      context += '- ' + x[0] + ': EGP ' + x[1].toLocaleString() + '\n';
    });

    context += '\nCUSTOMERS (' + customers.length + '):\n';
    customers.slice(0, 60).forEach(function(c) {
      context += '- ' + (c.name_en || c.name) + ' | ' + (c.industry || '') + ' | ' + (c.group_name || '') + (c.important ? ' IMPORTANT' : '') + (c.phone ? ' | Ph:' + c.phone : '') + (c.email ? ' | Em:' + c.email : '') + (c.whatsapp_number ? ' | WA:' + c.whatsapp_number : '') + '\n';
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

    context += '\nDEBTORS:\n';
    debts.forEach(function(d) { context += '- ' + d.debtor_name + ': EGP ' + Number(d.total_debt).toLocaleString() + '\n'; });

    if (recentMessages.length > 0) {
      context += '\nRECENT COMMUNICATIONS (' + recentMessages.length + '):\n';
      recentMessages.slice(0, 15).forEach(function(m) {
        context += '- [' + m.channel + '/' + m.direction + '] ' + (m.from_address || '') + (m.subject ? ' — ' + m.subject : '') + ' (' + (m.created_at || '').substring(0, 16) + ')' + (m.status !== 'read' && m.status !== 'sent' ? ' [' + m.status + ']' : '') + '\n';
      });
    }

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
          return Response.json({ answer: cleanText.trim() || 'Draft ready for approval.', pending_action: actionData });
        }

        return Response.json({ answer: cleanText.trim() || 'Action ready.', pending_action: actionData });
      } catch(parseErr) {
        return Response.json({ answer: aiText });
      }
    }

    return Response.json({ answer: aiText });
  } catch (err) {
    return Response.json({ answer: 'Error: ' + err.message });
  }
}
