import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET() {
  return Response.json({ status: 'working', has_anthropic: !!process.env.ANTHROPIC_API_KEY });
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
            priority: action.priority || 'medium', status: 'Open',
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
        shippingRates = [], followUps = [], calendarEvents = [], inventory = [], dailyLog = [];
    try {
      const [inv, tres, cust, tix, dbt, ship, fu, cal, inv2, dl] = await Promise.all([
        supabase.from('invoices').select('order_number, customer_name, invoice_date, total_amount, total_collected, outstanding, sales_rep').order('invoice_date', { ascending: false }).limit(500),
        supabase.from('treasury').select('transaction_date, description, cash_in, cash_out, order_number, category, subcategory').order('transaction_date', { ascending: false }).limit(500),
        supabase.from('customers').select('name, name_en, group_name, industry, city, credit_limit, status, important, assigned_rep, phone').limit(200),
        supabase.from('tickets').select('title, status, priority, due_date, assigned_to, created_at, description').order('created_at', { ascending: false }).limit(100),
        supabase.from('debts').select('debtor_name, total_debt').limit(100),
        supabase.from('shipping_rates').select('origin, destination, vendor_name, shipping_line, rate_type, rate_amount, currency, transit_days, expiry_date, container_type').order('effective_date', { ascending: false }).limit(200).catch(() => ({ data: [] })),
        supabase.from('follow_ups').select('task, due_date, completed, customer_id, assigned_to').order('due_date', { ascending: true }).limit(100).catch(() => ({ data: [] })),
        supabase.from('calendar_events').select('title, event_date, event_time, event_type').order('event_date', { ascending: true }).limit(50).catch(() => ({ data: [] })),
        supabase.from('inventory').select('product_id, reference_number, description, product_type, roll_count, net_weight, stock_status').limit(200).catch(() => ({ data: [] })),
        supabase.from('daily_log').select('entry_text, log_date, auto_generated').order('created_at', { ascending: false }).limit(30).catch(() => ({ data: [] })),
      ]);
      invoices = inv.data || []; treasury = tres.data || []; customers = cust.data || [];
      tickets = tix.data || []; debts = dbt.data || [];
      shippingRates = ship.data || ship || []; followUps = fu.data || fu || [];
      calendarEvents = cal.data || cal || []; inventory = inv2.data || inv2 || [];
      dailyLog = dl.data || dl || [];
    } catch(e) { console.log('Data fetch error:', e); }

    // ===== COMPUTED SUMMARIES =====
    const totalInvoiced = invoices.reduce((a, i) => a + Number(i.total_amount || 0), 0);
    const totalCollected = invoices.reduce((a, i) => a + Number(i.total_collected || 0), 0);
    const totalOutstanding = invoices.reduce((a, i) => a + Number(i.outstanding || 0), 0);
    const totalCashIn = treasury.reduce((a, t) => a + Number(t.cash_in || 0), 0);
    const totalCashOut = treasury.reduce((a, t) => a + Number(t.cash_out || 0), 0);
    const openTickets = tickets.filter(t => t.status !== 'Closed' && t.status !== 'Done').length;
    const overdueTickets = tickets.filter(t => t.status !== 'Closed' && t.status !== 'Done' && t.due_date && t.due_date < new Date().toISOString().substring(0, 10)).length;
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

WHEN THE USER GIVES A COMMAND (create ticket, schedule meeting, set reminder, etc.):
Respond with a JSON block wrapped in \`\`\`action tags like this:
\`\`\`action
{"type":"create_ticket","title":"Get shipping rates from Turkey","description":"Research current rates for 40ft containers","priority":"high","due_date":"${tomorrow}"}
\`\`\`
OR for calendar events:
\`\`\`action
{"type":"create_event","title":"Team meeting","event_date":"${tomorrow}","event_time":"14:00","event_type":"meeting"}
\`\`\`
OR for reminders:
\`\`\`action
{"type":"create_reminder","task":"Follow up with supplier","due_date":"${tomorrow}","due_time":"09:00"}
\`\`\`
After the action block, write a brief confirmation message.
For assigned_to, use user IDs from the TEAM list below.

WHEN THE USER ASKS A QUESTION:
Answer clearly with specific numbers and data. Use tables or lists when helpful. Be concise.
Currency is EGP (Egyptian Pound) unless specified otherwise.

===== LIVE BUSINESS DATA =====

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
${debts.map(d => '• ' + d.debtor_name + ': EGP ' + Number(d.total_debt).toLocaleString()).join('\n') || 'None'}`;

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
    const actionMatch = aiText.match(/```action\s*\n([\s\S]*?)\n```/);
    if (actionMatch) {
      try {
        const actionData = JSON.parse(actionMatch[1]);
        const cleanText = aiText.replace(/```action\s*\n[\s\S]*?\n```/, '').trim();
        return Response.json({ 
          answer: cleanText || 'Action ready to execute.',
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
