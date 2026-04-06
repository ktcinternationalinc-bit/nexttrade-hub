import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET() {
  return Response.json({ 
    status: 'working', 
    has_anthropic: !!process.env.ANTHROPIC_API_KEY,
    has_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const question = body?.question;
    if (!question) return Response.json({ answer: 'No question received' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ answer: 'API key not set' });

    // Fetch data from database using service role (bypasses RLS)
    let invoices = [], treasury = [], customers = [], tickets = [], debts = [];
    try {
      const [inv, tres, cust, tix, dbt] = await Promise.all([
        supabase.from('invoices').select('order_number, customer_name, invoice_date, total_amount, total_collected, outstanding').order('invoice_date', { ascending: false }).limit(500),
        supabase.from('treasury').select('transaction_date, description, cash_in, cash_out, order_number, category, subcategory').order('transaction_date', { ascending: false }).limit(500),
        supabase.from('customers').select('name, name_en, group_name, client_type, city, credit_limit, status, important').limit(200),
        supabase.from('tickets').select('title, status, priority, due_date').order('created_at', { ascending: false }).limit(100),
        supabase.from('debts').select('debtor_name, total_debt').limit(100),
      ]);
      invoices = inv.data || [];
      treasury = tres.data || [];
      customers = cust.data || [];
      tickets = tix.data || [];
      debts = dbt.data || [];
    } catch(e) { /* continue */ }

    // Debug: include data counts in response if no data found
    const dataCounts = 'Data loaded: ' + invoices.length + ' invoices, ' + treasury.length + ' treasury, ' + customers.length + ' customers, ' + debts.length + ' debts';

    const totalInvoiced = invoices.reduce((a, i) => a + Number(i.total_amount || 0), 0);
    const totalCollected = invoices.reduce((a, i) => a + Number(i.total_collected || 0), 0);
    const totalOutstanding = invoices.reduce((a, i) => a + Number(i.outstanding || 0), 0);
    const totalCashIn = treasury.reduce((a, t) => a + Number(t.cash_in || 0), 0);
    const totalCashOut = treasury.reduce((a, t) => a + Number(t.cash_out || 0), 0);
    const totalDebt = debts.reduce((a, d) => a + Number(d.total_debt || 0), 0);
    const openTickets = tickets.filter(t => t.status !== 'Closed').length;

    const custOutstanding = {};
    invoices.forEach(i => {
      if (Number(i.outstanding) > 0) {
        const name = i.customer_name || 'Unknown';
        custOutstanding[name] = (custOutstanding[name] || 0) + Number(i.outstanding);
      }
    });
    const topOwing = Object.entries(custOutstanding).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const months = {};
    invoices.forEach(i => {
      const m = (i.invoice_date || '').substring(0, 7);
      if (!m) return;
      if (!months[m]) months[m] = { invoiced: 0, collected: 0 };
      months[m].invoiced += Number(i.total_amount || 0);
      months[m].collected += Number(i.total_collected || 0);
    });

    const context = `You are a business data assistant for KTC International (Kandil Trading Company), an Egyptian trading/textile company.
Answer in the same language the user asks in. Be concise and specific with numbers.
Currency is EGP (Egyptian Pound). Format large numbers with commas.
You have FULL ACCESS to the company database.

${dataCounts}

FINANCIAL SUMMARY:
- Total Invoiced: EGP ${totalInvoiced.toLocaleString()}
- Total Collected: EGP ${totalCollected.toLocaleString()}
- Total Outstanding: EGP ${totalOutstanding.toLocaleString()}
- Total Cash In: EGP ${totalCashIn.toLocaleString()}
- Total Cash Out: EGP ${totalCashOut.toLocaleString()}
- Net Cash: EGP ${(totalCashIn - totalCashOut).toLocaleString()}
- Total Debt: EGP ${totalDebt.toLocaleString()}
- Open Tickets: ${openTickets}
- Total Customers: ${customers.length}
- Total Invoices: ${invoices.length}

TOP CUSTOMERS OWING MONEY:
${topOwing.length > 0 ? topOwing.map(([name, amt]) => '- ' + name + ': EGP ' + amt.toLocaleString()).join('\n') : 'None'}

MONTHLY SALES (recent):
${Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).map(([m, d]) => '- ' + m + ': Invoiced EGP ' + d.invoiced.toLocaleString() + ', Collected EGP ' + d.collected.toLocaleString()).join('\n') || 'No data'}

CUSTOMERS:
${customers.slice(0, 50).map(c => '- ' + c.name + ' (' + (c.client_type || '') + ', ' + (c.group_name || '') + ')' + (c.important ? ' IMPORTANT' : '')).join('\n') || 'No customers'}

DEBTORS:
${debts.map(d => '- ' + d.debtor_name + ': EGP ' + Number(d.total_debt).toLocaleString()).join('\n') || 'None'}

RECENT TRANSACTIONS:
${treasury.slice(0, 20).map(t => '- ' + t.transaction_date + ': ' + t.description + ' | In: ' + (t.cash_in || 0) + ' | Out: ' + (t.cash_out || 0)).join('\n') || 'No transactions'}

TICKETS:
${tickets.slice(0, 20).map(t => '- ' + t.title + ' | ' + t.status + ' | ' + t.priority).join('\n') || 'No tickets'}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: context,
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return Response.json({ answer: 'API Error: ' + errText.substring(0, 200) });
    }

    const data = await response.json();
    return Response.json({ answer: data.content?.[0]?.text || 'No response' });
  } catch (err) {
    return Response.json({ answer: 'Error: ' + err.message });
  }
}
