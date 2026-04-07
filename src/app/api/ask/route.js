import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET() {
  var hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ticketCount = 0;
  try { var r = await supabase.from('tickets').select('*', { count: 'exact', head: true }); ticketCount = r.count || 0; } catch(e) {}
  return Response.json({ status: 'working', has_anthropic: !!process.env.ANTHROPIC_API_KEY, has_service_key: hasKey, ticket_count: ticketCount });
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
          var result = await supabase.from('tickets').insert({
            title: action.title, description: action.description || '',
            priority: action.priority || 'medium', status: 'New',
            assigned_to: action.assigned_to || null, due_date: action.due_date || null,
            created_by: userId || null
          }).select().single();
          if (result.error) throw result.error;
          if (userId) { await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'AI created ticket: ' + action.title, auto_generated: true, log_date: new Date().toISOString().substring(0, 10) }); }
          return Response.json({ answer: 'Ticket created: ' + action.title + '\nPriority: ' + action.priority + (action.due_date ? '\nDue: ' + action.due_date : ''), action_result: 'success' });
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
        return Response.json({ answer: 'Unknown action type: ' + action.type });
      } catch (actionErr) {
        return Response.json({ answer: 'Action failed: ' + actionErr.message, action_result: 'error' });
      }
    }

    // FETCH DATA (each independent)
    var safe = async function(fn) { try { var r = await fn; return r.data || []; } catch(e) { return []; } };
    var results = await Promise.all([
      safe(supabase.from('invoices').select('order_number, customer_name, invoice_date, total_amount, total_collected, outstanding, sales_rep').order('invoice_date', { ascending: false }).limit(500)),
      safe(supabase.from('treasury').select('transaction_date, description, cash_in, cash_out, order_number, category, subcategory').order('transaction_date', { ascending: false }).limit(500)),
      safe(supabase.from('customers').select('name, name_en, group_name, industry, city, credit_limit, status, important, assigned_rep, phone').limit(200)),
      safe(supabase.from('tickets').select('title, status, priority, due_date, assigned_to, created_at, description').order('created_at', { ascending: false }).limit(100)),
      safe(supabase.from('debts').select('debtor_name, total_debt').limit(100)),
      safe(supabase.from('shipping_rates').select('origin, destination, vendor_name, shipping_line, rate_type, rate_amount, currency, transit_days, expiry_date, container_type').order('effective_date', { ascending: false }).limit(200)),
      safe(supabase.from('follow_ups').select('task, due_date, completed, customer_id, assigned_to').order('due_date', { ascending: true }).limit(100)),
      safe(supabase.from('calendar_events').select('title, event_date, event_time, event_type').order('event_date', { ascending: true }).limit(50)),
      safe(supabase.from('inventory').select('product_id, reference_number, description, product_type, roll_count, net_weight, stock_status').limit(200)),
      safe(supabase.from('daily_log').select('entry_text, log_date, auto_generated').order('created_at', { ascending: false }).limit(30)),
      safe(supabase.from('vendor_contacts').select('*').eq('is_active', true).order('company_name')),
    ]);
    var invoices = results[0], treasury = results[1], customers = results[2], tickets = results[3];
    var debts = results[4], shippingRates = results[5], followUps = results[6];
    var calendarEvents = results[7], inventory = results[8], dailyLog = results[9], vendorContacts = results[10];

    // SUMMARIES
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

    // BUILD CONTEXT — using string concat to avoid template literal issues
    var context = 'You are the AI Executive Assistant for KTC International (Kandil Trading Company), an Egyptian trading company.\n\n';
    context += 'TODAY: ' + today + '\n\n';
    context += 'CAPABILITIES:\n1. Answer business questions with real data\n2. Execute commands (tickets, meetings, reminders, rate requests)\n\n';
    context += 'FOR COMMANDS: Respond with JSON wrapped in ---ACTION_START--- and ---ACTION_END--- tags.\n';
    context += 'Example ticket:\n---ACTION_START---\n{"type":"create_ticket","title":"Task name","description":"Details","priority":"high","due_date":"' + tomorrow + '"}\n---ACTION_END---\n';
    context += 'Example event:\n---ACTION_START---\n{"type":"create_event","title":"Meeting","event_date":"' + tomorrow + '","event_time":"14:00","event_type":"meeting"}\n---ACTION_END---\n';
    context += 'Example reminder:\n---ACTION_START---\n{"type":"create_reminder","task":"Follow up","due_date":"' + tomorrow + '","due_time":"09:00"}\n---ACTION_END---\n';
    context += 'Example rate request:\n---ACTION_START---\n{"type":"request_quote","vendor_company":"CompanyName","vendor_contact":"Name","vendor_email":"email@co.com","vendor_whatsapp":"+123","vendor_type":"Shipping","send_via":"whatsapp","origin":"China","destination":"Egypt","container":"40ft","commodity":"Materials","customer_name":"Client"}\n---ACTION_END---\n';
    context += 'For request_quote: Match vendor from VENDOR CONTACTS below. Use their exact email/whatsapp. Prefer whatsapp if not specified.\n';
    context += 'For assigned_to on tickets: use user ID from TEAM list.\n\n';
    context += 'RULES: Answer concisely. Use EGP currency. Format numbers with commas.\n\n';
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
      context += '- ' + (c.name_en || c.name) + ' | ' + (c.industry || '') + ' | ' + (c.group_name || '') + (c.important ? ' IMPORTANT' : '') + (c.phone ? ' | ' + c.phone : '') + '\n';
    });

    context += '\nTICKETS (' + tickets.length + ', ' + openTickets + ' open):\n';
    tickets.slice(0, 25).forEach(function(t) {
      context += '- [' + t.status + '/' + t.priority + '] ' + t.title + (t.due_date ? ' (due: ' + t.due_date + ')' : '') + '\n';
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
        return Response.json({ answer: cleanText.trim() || 'Action ready.', pending_action: actionData });
      } catch(parseErr) {
        return Response.json({ answer: aiText });
      }
    }

    return Response.json({ answer: aiText });
  } catch (err) {
    return Response.json({ answer: 'Error: ' + err.message });
  }
}import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET() {
  // Quick diagnostic — hit /api/ask in browser to check
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  let ticketCount = 0;
  try { const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true }); ticketCount = count || 0; } catch(e) {}
  return Response.json({ 
    status: 'working', 
    has_anthropic: !!process.env.ANTHROPIC_API_KEY,
    has_service_key: hasServiceKey,
    using_key: hasServiceKey ? 'service_role' : 'anon_key',
    ticket_count: ticketCount,
    note: !hasServiceKey ? 'WARNING: No SUPABASE_SERVICE_ROLE_KEY set — using anon key, RLS may block data' : 'OK',
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const question = body?.question;
    const history = body?.history || [];
    const action = body?.action; // For executing actions
    const userId = body?.userId;
    if (!question && !action) return Response.json({ answer: 'No question received' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ answer: '⚠️ API key not configured. Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.' });

    // ===== EXECUTE ACTION (if requested) =====
    if (action) {
      try {
        if (action.type === 'create_ticket') {
          const { data, error } = await supabase.from('tickets').insert({
            title: action.title, description: action.description || '',
            priority: action.priority || 'medium', status: 'New',
            assigned_to: action.assigned_to || null,
            due_date: action.due_date || null,
            created_by: userId || null,
          }).select().single();
          if (error) throw error;
          // Log to daily_log
          if (userId) {
            await supabase.from('daily_log').insert({ user_id: userId, entry_text: 'AI created ticket: ' + action.title, auto_generated: true, log_date: new Date().toISOString().substring(0, 10) });
          }
          return Response.json({ answer: '✅ Ticket created: "' + action.title + '"\nPriority: ' + action.priority + (action.due_date ? '\nDue: ' + action.due_date : ''), action_result: 'success', ticket_id: data?.id });
        }
        if (action.type === 'create_event') {
          const { error } = await supabase.from('calendar_events').insert({
            title: action.title, event_date: action.event_date, event_time: action.event_time || '09:00',
            event_type: action.event_type || 'meeting', notes: action.notes || '',
            created_by: userId || null,
          });
          if (error) throw error;
          return Response.json({ answer: '✅ Event created: "' + action.title + '"\nDate: ' + action.event_date + (action.event_time ? ' at ' + action.event_time : ''), action_result: 'success' });
        }
        if (action.type === 'create_reminder') {
          const { error } = await supabase.from('follow_ups').insert({
            task: action.task, due_date: action.due_date, due_time: action.due_time || '09:00',
            assigned_to: userId || null, created_by: userId || null,
          });
          if (error) throw error;
          return Response.json({ answer: '✅ Reminder set: "' + action.task + '"\nDue: ' + action.due_date, action_result: 'success' });
        }
        return Response.json({ answer: 'Unknown action type: ' + action.type });
      } catch (e) {
        return Response.json({ answer: '❌ Action failed: ' + e.message, action_result: 'error' });
      }
    }

    // ===== FETCH BUSINESS DATA =====
    let invoices = [], treasury = [], customers = [], tickets = [], debts = [], 
        shippingRates = [], followUps = [], calendarEvents = [], inventory = [], dailyLog = [], vendorContacts = [];
    
    // Each query catches independently — one failing table won't kill all data
    const safe = async (fn) => { try { const r = await fn; return r.data || []; } catch(e) { return []; } };
    
    [invoices, treasury, customers, tickets, debts, shippingRates, followUps, calendarEvents, inventory, dailyLog, vendorContacts] = await Promise.all([
      safe(supabase.from('invoices').select('order_number, customer_name, invoice_date, total_amount, total_collected, outstanding, sales_rep').order('invoice_date', { ascending: false }).limit(500)),
      safe(supabase.from('treasury').select('transaction_date, description, cash_in, cash_out, order_number, category, subcategory').order('transaction_date', { ascending: false }).limit(500)),
      safe(supabase.from('customers').select('name, name_en, group_name, industry, city, credit_limit, status, important, assigned_rep, phone').limit(200)),
      safe(supabase.from('tickets').select('title, status, priority, due_date, assigned_to, created_at, description').order('created_at', { ascending: false }).limit(100)),
      safe(supabase.from('debts').select('debtor_name, total_debt').limit(100)),
      safe(supabase.from('shipping_rates').select('origin, destination, vendor_name, shipping_line, rate_type, rate_amount, currency, transit_days, expiry_date, container_type').order('effective_date', { ascending: false }).limit(200)),
      safe(supabase.from('follow_ups').select('task, due_date, completed, customer_id, assigned_to').order('due_date', { ascending: true }).limit(100)),
      safe(supabase.from('calendar_events').select('title, event_date, event_time, event_type').order('event_date', { ascending: true }).limit(50)),
      safe(supabase.from('inventory').select('product_id, reference_number, description, product_type, roll_count, net_weight, stock_status').limit(200)),
      safe(supabase.from('daily_log').select('entry_text, log_date, auto_generated').order('created_at', { ascending: false }).limit(30)),
      safe(supabase.from('vendor_contacts').select('*').eq('is_active', true).order('company_name')),
    ]);
    } catch(e) { console.log('Data fetch error:', e); }

    // ===== COMPUTED SUMMARIES =====
    const totalInvoiced = invoices.reduce((a, i) => a + Number(i.total_amount || 0), 0);
    const totalCollected = invoices.reduce((a, i) => a + Number(i.total_collected || 0), 0);
    const totalOutstanding = invoices.reduce((a, i) => a + Number(i.outstanding || 0), 0);
    const totalCashIn = treasury.reduce((a, t) => a + Number(t.cash_in || 0), 0);
    const totalCashOut = treasury.reduce((a, t) => a + Number(t.cash_out || 0), 0);
    const openTickets = tickets.filter(t => t.status !== 'Closed').length;
    const overdueTickets = tickets.filter(t => t.status !== 'Closed' && t.due_date && t.due_date < new Date().toISOString().substring(0, 10)).length;
    const pendingFollowUps = (Array.isArray(followUps) ? followUps : []).filter(f => !f.completed).length;

    // Top owing customers
    const custOwed = {};
    invoices.forEach(i => { if (Number(i.outstanding) > 0) { custOwed[i.customer_name || '?'] = (custOwed[i.customer_name || '?'] || 0) + Number(i.outstanding); } });
    const topOwing = Object.entries(custOwed).sort((a, b) => b[1] - a[1]).slice(0, 15);

    // Monthly sales
    const months = {};
    invoices.forEach(i => { const m = (i.invoice_date || '').substring(0, 7); if (m) { if (!months[m]) months[m] = { inv: 0, col: 0, count: 0 }; months[m].inv += Number(i.total_amount || 0); months[m].col += Number(i.total_collected || 0); months[m].count++; } });

    // Expense categories
    const expCats = {};
    treasury.forEach(t => { if (t.cash_out > 0) { const c = t.category || 'Uncategorized'; expCats[c] = (expCats[c] || 0) + Number(t.cash_out); } });

    // Today's date
    const today = new Date().toISOString().substring(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().substring(0, 10);

    // ===== FETCH TEAM USERS =====
    let users = [];
    try { const { data } = await supabase.from('users').select('id, name, role'); users = data || []; } catch(e) {}

    // ===== BUILD CONTEXT =====
    const context = `You are the AI Executive Assistant for KTC International (Kandil Trading Company), an Egyptian trading company that imports and distributes materials including leather, pool materials, roofing, fabrics, PVC, and chemicals.

TODAY'S DATE: ${today}

YOUR CAPABILITIES:
1. ANSWER any business question using the data below
2. EXECUTE commands when the user asks you to create tickets, schedule meetings, or set reminders

WHEN THE USER GIVES A COMMAND (create ticket, schedule meeting, set reminder, request rate quote, etc.):
Respond with a JSON block wrapped in ---ACTION_START--- tags like this:
---ACTION_START---
{"type":"create_ticket","title":"Get shipping rates from Turkey","description":"Research current rates for 40ft containers","priority":"high","due_date":"${tomorrow}"}
---ACTION_END---
OR for calendar events:
---ACTION_START---
{"type":"create_event","title":"Team meeting","event_date":"${tomorrow}","event_time":"14:00","event_type":"meeting"}
---ACTION_END---
OR for reminders:
---ACTION_START---
{"type":"create_reminder","task":"Follow up with supplier","due_date":"${tomorrow}","due_time":"09:00"}
---ACTION_END---
OR for requesting rate quotes from vendors (IMPORTANT — use this when user says "request rate", "get quote", "send rate request", "ask for rates", etc.):
---ACTION_START---
{"type":"request_quote","vendor_company":"Ontrek","vendor_contact":"John","vendor_email":"rates@ontrek.com","vendor_whatsapp":"+1234567890","vendor_type":"Shipping","send_via":"whatsapp","origin":"China","destination":"Egypt","container":"40ft","commodity":"Trading materials","customer_name":"Ahmed"}
---ACTION_END---
IMPORTANT for request_quote: Match the vendor by name from the VENDOR CONTACTS list below. Use their exact email/whatsapp from the database. If the user says "send via whatsapp" use send_via:"whatsapp", if "send via email" use send_via:"email", if not specified use whichever contact method is available (prefer whatsapp). If user mentions a vendor type like "trucker" or "freight forwarder", match by vendor_type.
After the action block, write a brief confirmation message.
For assigned_to, use user IDs from the TEAM list below.

WHEN THE USER ASKS A QUESTION:
Answer clearly with specific numbers and data. Use tables or lists when helpful. Be concise.
Currency is EGP (Egyptian Pound) unless specified otherwise.

===== LIVE BUSINESS DATA =====
[Data loaded: ${invoices.length} invoices, ${treasury.length} treasury, ${customers.length} customers, ${tickets.length} tickets, ${debts.length} debts, ${shippingRates.length} rates, ${vendorContacts.length} vendors, ${inventory.length} inventory]

FINANCIAL SUMMARY:
- Total Invoiced: EGP ${totalInvoiced.toLocaleString()}
- Total Collected: EGP ${totalCollected.toLocaleString()}  
- Outstanding Receivables: EGP ${totalOutstanding.toLocaleString()}
- Treasury Cash In: EGP ${totalCashIn.toLocaleString()}
- Treasury Cash Out: EGP ${totalCashOut.toLocaleString()}
- Net Cash Flow: EGP ${(totalCashIn - totalCashOut).toLocaleString()}

OPERATIONS:
- Open Tickets: ${openTickets} (${overdueTickets} overdue)
- Pending Follow-ups: ${pendingFollowUps}
- Total Customers: ${customers.length}
- Inventory Items: ${Array.isArray(inventory) ? inventory.length : 0}
- Active Shipping Routes: ${Array.isArray(shippingRates) ? shippingRates.length : 0}

TOP CUSTOMERS OWING (sorted by amount):
${topOwing.map(([n, a]) => '• ' + n + ': EGP ' + a.toLocaleString()).join('\n') || 'None'}

MONTHLY SALES (last 12 months):
${Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).map(([m, d]) => '• ' + m + ': ' + d.count + ' orders, Invoiced EGP ' + d.inv.toLocaleString() + ', Collected EGP ' + d.col.toLocaleString()).join('\n') || 'No data'}

EXPENSE BREAKDOWN:
${Object.entries(expCats).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, a]) => '• ' + c + ': EGP ' + a.toLocaleString()).join('\n') || 'No expenses'}

CUSTOMERS (${customers.length} total):
${customers.slice(0, 60).map(c => '• ' + (c.name_en || c.name) + ' | ' + (c.industry || '') + ' | ' + (c.group_name || '') + ' | ' + (c.city || '') + (c.important ? ' ⭐' : '') + (c.phone ? ' | ' + c.phone : '')).join('\n')}

TICKETS (${tickets.length} total, ${openTickets} open):
${tickets.slice(0, 25).map(t => '• [' + t.status + '/' + t.priority + '] ' + t.title + (t.due_date ? ' (due: ' + t.due_date + ')' : '')).join('\n') || 'No tickets'}

SHIPPING RATES:
${(Array.isArray(shippingRates) ? shippingRates : []).slice(0, 30).map(r => '• ' + r.origin + '→' + r.destination + ': ' + (r.currency || 'USD') + ' ' + r.rate_amount + ' (' + (r.rate_type || r.vendor_name || '') + ', ' + (r.container_type || '') + ')' + (r.expiry_date ? ' exp:' + r.expiry_date : '')).join('\n') || 'No rates'}

FOLLOW-UPS (pending):
${(Array.isArray(followUps) ? followUps : []).filter(f => !f.completed).slice(0, 15).map(f => '• ' + f.task + ' (due: ' + f.due_date + ')').join('\n') || 'None pending'}

UPCOMING EVENTS:
${(Array.isArray(calendarEvents) ? calendarEvents : []).filter(e => e.event_date >= today).slice(0, 10).map(e => '• ' + e.event_date + ' ' + (e.event_time || '') + ': ' + e.title).join('\n') || 'No upcoming events'}

RECENT ACTIVITY LOG:
${(Array.isArray(dailyLog) ? dailyLog : []).slice(0, 10).map(l => '• ' + l.log_date + ': ' + l.entry_text).join('\n') || 'No recent activity'}

INVENTORY SUMMARY:
${(Array.isArray(inventory) ? inventory : []).slice(0, 20).map(p => '• ' + (p.reference_number || p.product_id || '?') + ' | ' + (p.product_type || '') + ' | ' + (p.description || '') + ' | Rolls: ' + (p.roll_count || 0) + ' | ' + (p.stock_status || '')).join('\n') || 'No inventory'}

TEAM:
${users.map(u => '• ' + u.name + ' (ID: ' + u.id + ', Role: ' + u.role + ')').join('\n') || 'No users'}

DEBTORS:
${debts.map(d => '• ' + d.debtor_name + ': EGP ' + Number(d.total_debt).toLocaleString()).join('\n') || 'None'}

VENDOR CONTACTS (freight forwarders, truckers, brokers — use these for request_quote actions):
${(Array.isArray(vendorContacts) ? vendorContacts : []).map(v => '• ' + v.company_name + (v.contact_name ? ' (' + v.contact_name + ')' : '') + ' | Type: ' + (v.vendor_type || '?') + (v.email ? ' | Email: ' + v.email : '') + (v.whatsapp ? ' | WhatsApp: ' + v.whatsapp : '') + (v.phone ? ' | Phone: ' + v.phone : '') + (v.origin_regions ? ' | Covers: ' + v.origin_regions : '')).join('\n') || 'No vendors yet — tell the user to add vendor contacts in Shipping → Vendors'}`;

    // ===== BUILD MESSAGES =====
    const messages = [];
    // Add conversation history
    if (history.length > 0) {
      for (const msg of history.slice(-10)) { // last 10 messages
        messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.text });
      }
    }
    messages.push({ role: 'user', content: question || body?.context || 'Hello' });

    // ===== CALL CLAUDE =====
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, system: context, messages }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return Response.json({ answer: 'API Error (' + response.status + '): ' + errText.substring(0, 300) });
    }

    const data = await response.json();
    const aiText = data.content?.[0]?.text || 'No response';

    // ===== PARSE ACTION FROM RESPONSE =====
    const actionStart = aiText.indexOf("---ACTION_START---");
    const actionEnd = actionStart >= 0 ? aiText.indexOf("---ACTION_END---", actionStart + 20) : -1;
    if (actionStart >= 0 && actionEnd > actionStart) {
      try {
        const actionJson = aiText.substring(actionStart + 18, actionEnd).trim();
        const actionData = JSON.parse(actionJson);
        const cleanText = aiText.substring(0, actionStart).trim() + ' ' + aiText.substring(actionEnd + 16).trim();
        return Response.json({ 
          answer: cleanText.trim() || 'Action ready to execute.',
          pending_action: actionData 
        });
      } catch(e) {
        return Response.json({ answer: aiText });
      }
    }

    return Response.json({ answer: aiText });
  } catch (err) {
    return Response.json({ answer: 'Error: ' + err.message });
  }
}
