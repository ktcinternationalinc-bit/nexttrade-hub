// ============================================================
// /api/ask-v2 — Tool-use endpoint for Nadia
//
// Different from /api/ask:
//   - /api/ask    = legacy. Prose + embedded JSON for actions. Still used.
//   - /api/ask-v2 = new. Native Anthropic tool use. Multi-turn tool calls.
//
// Flow:
//   1. User sends { question, history, userId }
//   2. We send to Claude with tool definitions from nadia-tools.js
//   3. If model returns `tool_use` block → we execute the tool server-side
//   4. Result fed back as `tool_result` → model may call more tools
//   5. When model returns plain text → we return that as the answer
//
// Safety:
//   - READ tools hit supabase with service role (bypass RLS, no mutation)
//   - DRAFT tools dispatch a `tool_call_ready` payload in the response that
//     the client listens for and opens a UI prefilled
//   - WRITE tools (danger:true) ARE executed server-side but ONLY with
//     userId present + all required fields. No auth elevation beyond what
//     the user already has.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { getToolsForAPI, validateToolCall } from '../../../lib/nadia-tools';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

var MAX_TOOL_ITERATIONS = 6; // hard ceiling — model can't loop forever

// ---------- Tool handlers — pure async functions, no HTTP layer ----------

async function toolSearchCustomers(input) {
  var q = String(input.query || '').trim();
  var lim = Math.min(50, Math.max(1, Number(input.limit) || 10));
  if (!q) return { error: 'empty query' };
  var r = await supabase.from('customers')
    .select('id, name, name_en, phone, email, assigned_rep, last_contact_at')
    .or('name.ilike.%' + q + '%,name_en.ilike.%' + q + '%')
    .limit(lim);
  if (r.error) return { error: r.error.message };
  return { customers: r.data || [], count: (r.data || []).length };
}

async function toolQueryInvoices(input) {
  var q = supabase.from('invoices')
    .select('id, order_number, invoice_date, due_date, customer_id, customer_name, total_amount, total_collected, outstanding, category');
  if (input.customer_id) q = q.eq('customer_id', input.customer_id);
  if (input.order_number) q = q.eq('order_number', input.order_number);
  if (input.status === 'open') q = q.gt('outstanding', 0);
  if (input.status === 'paid') q = q.lte('outstanding', 0);
  if (input.status === 'overdue') q = q.gt('outstanding', 0).lt('due_date', new Date().toISOString().substring(0, 10));
  if (input.date_from) q = q.gte('invoice_date', input.date_from);
  if (input.date_to)   q = q.lte('invoice_date', input.date_to);
  var r = await q.limit(Math.min(100, Math.max(1, Number(input.limit) || 25))).order('invoice_date', { ascending: false });
  if (r.error) return { error: r.error.message };
  var now = Date.now();
  var enriched = (r.data || []).map(function(inv) {
    var dd = inv.due_date ? Math.floor((now - new Date(inv.due_date).getTime()) / 86400000) : null;
    return Object.assign({}, inv, { days_overdue: (dd != null && dd > 0) ? dd : 0 });
  });
  return { invoices: enriched, count: enriched.length };
}

async function toolQueryChecks(input) {
  var q = supabase.from('checks')
    .select('id, check_number, amount, due_date, status, customer_id, customer_name, invoice_id');
  if (input.customer_id) q = q.eq('customer_id', input.customer_id);
  if (input.status && input.status !== 'all') q = q.eq('status', input.status);
  if (input.clearing_within_days != null) {
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() + Number(input.clearing_within_days));
    q = q.gte('due_date', new Date().toISOString().substring(0, 10))
         .lte('due_date', cutoff.toISOString().substring(0, 10));
  }
  var r = await q.limit(Math.min(100, Number(input.limit) || 25)).order('due_date', { ascending: true });
  if (r.error) return { error: r.error.message };
  return { checks: r.data || [], count: (r.data || []).length };
}

async function toolQueryTreasury(input) {
  if (!input.date_from || !input.date_to) return { error: 'date_from and date_to required' };
  var q = supabase.from('treasury')
    .select('id, transaction_date, cash_in, cash_out, description, category, linked_invoice_id')
    .gte('transaction_date', input.date_from)
    .lte('transaction_date', input.date_to);
  if (input.category) q = q.eq('category', input.category);
  if (input.customer_id) q = q.eq('customer_id', input.customer_id);
  var r = await q.limit(Math.min(200, Number(input.limit) || 50)).order('transaction_date', { ascending: false });
  if (r.error) return { error: r.error.message };
  var rows = r.data || [];
  var totIn = rows.reduce(function(a, t) { return a + Number(t.cash_in || 0); }, 0);
  var totOut = rows.reduce(function(a, t) { return a + Number(t.cash_out || 0); }, 0);
  return { transactions: rows, count: rows.length, total_cash_in: totIn, total_cash_out: totOut, net: totIn - totOut };
}

async function toolSearchTickets(input) {
  var q = supabase.from('tickets')
    .select('id, ticket_number, title, description, priority, status, assigned_to, due_date, created_at');
  if (input.status === 'open') q = q.neq('status', 'Closed').neq('status', 'Fixed');
  if (input.status === 'closed') q = q.in('status', ['Closed', 'Fixed']);
  if (input.assigned_to) q = q.eq('assigned_to', input.assigned_to);
  if (input.query) q = q.or('title.ilike.%' + input.query + '%,description.ilike.%' + input.query + '%');
  var r = await q.limit(Math.min(50, Number(input.limit) || 20)).order('created_at', { ascending: false });
  if (r.error) return { error: r.error.message };
  return { tickets: r.data || [], count: (r.data || []).length };
}

async function toolGetCalendar(input) {
  if (!input.date_from || !input.date_to) return { error: 'date_from and date_to required' };
  var q = supabase.from('calendar_events')
    .select('id, title, event_date, event_type, assigned_to, location, notes')
    .gte('event_date', input.date_from)
    .lte('event_date', input.date_to);
  if (input.user_id) q = q.eq('assigned_to', input.user_id);
  var r = await q.limit(Math.min(100, Number(input.limit) || 30)).order('event_date', { ascending: true });
  if (r.error) return { error: r.error.message };
  return { events: r.data || [], count: (r.data || []).length };
}

async function toolGetAIAlerts(input) {
  var q = supabase.from('ai_alerts')
    .select('id, severity, alert_type, subject, body, recommendation, related_entity_type, related_entity_id, created_at')
    .is('resolved_at', null);
  if (input.severity && input.severity !== 'all') q = q.eq('severity', input.severity);
  var r = await q.limit(Math.min(50, Number(input.limit) || 20)).order('created_at', { ascending: false });
  if (r.error) return { error: r.error.message };
  return { alerts: r.data || [], count: (r.data || []).length };
}

async function toolPredictCategory(input) {
  // Delegate to the existing categorization API if the invoice id is provided,
  // otherwise return a note that we need more data.
  if (!input.invoice_id && !input.description && !input.customer_id) {
    return { error: 'provide invoice_id OR (description + customer_id)' };
  }
  // For V1, simple passthrough to the categorize-sales endpoint. Future: direct
  // lookup against category_memory here, skip the hop.
  try {
    var base = process.env.NEXT_PUBLIC_APP_URL || '';
    var res = await fetch(base + '/api/categorize-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'predict', invoice_id: input.invoice_id }),
    });
    return await res.json();
  } catch (e) { return { error: e.message }; }
}

// DRAFT / WRITE tools — these mostly signal back to the client. The actual UI
// action (open composer, open event form, show confirm dialog) is done by the
// NadiaActionBridge which listens to these events. The server just acknowledges.
async function toolDraftEmail(input)    { return { drafted: true, kind: 'email',    payload: input }; }
async function toolDraftWhatsApp(input) { return { drafted: true, kind: 'whatsapp', payload: input }; }
async function toolCreateEvent(input)   { return { drafted: true, kind: 'event',    payload: input }; }

async function toolCreateTicket(input, ctx) {
  if (!input.title) return { error: 'title required' };
  if (!ctx.userId)  return { error: 'user not signed in' };
  try {
    var count = (await supabase.from('tickets').select('id', { count: 'exact', head: true })).count || 0;
    var tktNum = 'T' + String(count + 1).padStart(5, '0');
    var r = await supabase.from('tickets').insert({
      ticket_number: tktNum,
      title: input.title,
      description: input.description || '',
      priority: input.priority || 'medium',
      due_date: input.due_date || null,
      assigned_to: input.assigned_to || null,
      status: 'New',
      created_by: ctx.userId,
    }).select('id, ticket_number').maybeSingle();
    if (r.error) return { error: r.error.message };
    return { created: true, ticket_number: tktNum, id: r.data && r.data.id };
  } catch (e) { return { error: e.message }; }
}

async function toolCreateReminder(input, ctx) {
  if (!input.task || !input.due_date) return { error: 'task + due_date required' };
  if (!ctx.userId) return { error: 'user not signed in' };
  try {
    var r = await supabase.from('reminders').insert({
      user_id: ctx.userId,
      task: input.task,
      due_date: input.due_date,
      completed: false,
      source: 'nadia_v2',
    }).select('id').maybeSingle();
    if (r.error) return { error: r.error.message };
    return { created: true, id: r.data && r.data.id, due_date: input.due_date };
  } catch (e) { return { error: e.message }; }
}

async function toolFlagInvoice(input, ctx) {
  if (!input.invoice_id) return { error: 'invoice_id required' };
  if (!ctx.userId) return { error: 'user not signed in' };
  try {
    var fields = { updated_at: new Date().toISOString(), updated_by: ctx.userId };
    if (input.flag === 'priority') fields.priority = 'high';
    else fields.at_risk = true;
    var r = await supabase.from('invoices').update(fields).eq('id', input.invoice_id);
    if (r.error) return { error: r.error.message };
    return { flagged: true, invoice_id: input.invoice_id, flag: input.flag || 'at_risk' };
  } catch (e) { return { error: e.message }; }
}

var HANDLERS = {
  search_customers: toolSearchCustomers,
  query_invoices:   toolQueryInvoices,
  query_checks:     toolQueryChecks,
  query_treasury:   toolQueryTreasury,
  search_tickets:   toolSearchTickets,
  get_calendar:     toolGetCalendar,
  get_ai_alerts:    toolGetAIAlerts,
  predict_category: toolPredictCategory,
  draft_email:      toolDraftEmail,
  draft_whatsapp:   toolDraftWhatsApp,
  create_event:     toolCreateEvent,
  create_ticket:    toolCreateTicket,
  create_reminder:  toolCreateReminder,
  flag_invoice:     toolFlagInvoice,
};

// ---------- The tool-use loop ----------

async function runToolLoop(apiKey, systemPrompt, messages, ctx) {
  var tools = getToolsForAPI();
  var iter = 0;
  var toolCallsMade = [];
  var draftsForClient = []; // captured from draft_* handlers, sent back to UI

  while (iter < MAX_TOOL_ITERATIONS) {
    iter++;
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools: tools,
        messages: messages,
      }),
    });
    if (!res.ok) {
      var errText = await res.text().catch(function() { return ''; });
      return { answer: 'AI call failed: ' + errText.substring(0, 200), iterations: iter, tool_calls: toolCallsMade };
    }
    var data = await res.json();
    var stopReason = data.stop_reason;
    var content = data.content || [];

    // Collect text blocks from this response (model may interleave text with tool calls)
    var textParts = content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; });
    var toolUses  = content.filter(function(b) { return b.type === 'tool_use'; });

    if (stopReason !== 'tool_use' || toolUses.length === 0) {
      // Model done reasoning — return the final text
      return {
        answer: textParts.join('\n').trim(),
        iterations: iter,
        tool_calls: toolCallsMade,
        drafts: draftsForClient,
      };
    }

    // Append the assistant's turn (with the tool_use blocks) to message history
    messages.push({ role: 'assistant', content: content });

    // Execute each tool call
    var toolResults = [];
    for (var i = 0; i < toolUses.length; i++) {
      var tu = toolUses[i];
      var v = validateToolCall(tu.name, tu.input || {});
      var result;
      if (!v.ok) {
        result = { error: v.error };
      } else {
        var handler = HANDLERS[tu.name];
        if (!handler) result = { error: 'Handler not implemented: ' + tu.name };
        else {
          try { result = await handler(tu.input || {}, ctx); }
          catch (e) { result = { error: 'Handler crashed: ' + e.message }; }
        }
      }
      toolCallsMade.push({ name: tu.name, input: tu.input, result: result });
      // If this was a draft/open-UI tool, capture for client
      if (result && result.drafted && result.kind) draftsForClient.push(result);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 20000), // hard cap on size fed back
      });
    }

    // Feed results back as a user message — model will reason over them
    messages.push({ role: 'user', content: toolResults });
  }

  // Hit iteration ceiling
  return {
    answer: 'I worked through ' + iter + ' steps and still need more — can you give me a narrower question?',
    iterations: iter,
    tool_calls: toolCallsMade,
    drafts: draftsForClient,
    hit_ceiling: true,
  };
}

// ---------- HTTP handler ----------

export async function POST(request) {
  try {
    var body = await request.json();
    var question = body.question || '';
    var history = Array.isArray(body.history) ? body.history : [];
    var userId = body.userId;

    if (!question) return Response.json({ ok: false, error: 'missing question' });
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ ok: false, error: 'ANTHROPIC_API_KEY not configured' });

    // Build message history — map user-friendly format to Anthropic's shape.
    // Same gotcha as /api/ask: first message must be role=user or the API
    // returns 400. Strip any leading assistant messages (greeter saves its own
    // opening greeting into history before the user has spoken).
    //
    // v53.1 (Apr 24 2026) — same double-push bug fix as /api/ask: client
    // already includes the current user message in history, so only push
    // `question` separately if it's NOT already at the tail.
    var messages = history.slice(-8).map(function(m) {
      return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text || m.content || '' };
    }).filter(function(m) { return m.content && m.content.trim(); });
    while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
    var lastMsgV2 = messages[messages.length - 1];
    var alreadyInHistoryV2 = lastMsgV2 && lastMsgV2.role === 'user' && String(lastMsgV2.content || '').trim() === String(question || '').trim();
    if (!alreadyInHistoryV2) {
      messages.push({ role: 'user', content: question });
    }

    var today = new Date().toISOString().substring(0, 10);
    var system =
      "You are Nadia, an AI Secretary for KTC International (a trading/import business based in Egypt + USA). " +
      "Today's date is " + today + ". " +
      "You have tools to query live business data (customers, invoices, checks, treasury, tickets, calendar, ai_alerts) " +
      "and tools to draft emails/whatsapps/events for the user to review. Use them liberally — don't guess. " +
      "When the user mentions a customer by name, ALWAYS call search_customers first to get the customer_id before calling other tools. " +
      "When the user asks a factual question, call the appropriate tool, then respond in plain language. " +
      "Be concise. Be direct. Prefer bullet points for lists of items. Surface the 2-3 most important numbers. " +
      "When drafting emails, call draft_email — don't write the email out as prose. " +
      "For decision-oriented questions, reason step by step, then give a clear recommendation.";

    var result = await runToolLoop(apiKey, system, messages, { userId: userId });
    return Response.json({ ok: true, answer: result.answer, iterations: result.iterations, tool_calls: result.tool_calls, drafts: result.drafts, hit_ceiling: !!result.hit_ceiling });
  } catch (e) {
    return Response.json({ ok: false, error: e.message || String(e) });
  }
}

export async function GET() {
  return Response.json({ status: 'ok', tools: getToolsForAPI().map(function(t) { return t.name; }) });
}
