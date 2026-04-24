import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PLAID_BASE = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { connection_id, start_date, end_date } = await req.json();
    const env = process.env.PLAID_ENV || 'sandbox';
    const base = PLAID_BASE[env] || PLAID_BASE.sandbox;

    // Get access token from DB
    const { data: conn, error: connErr } = await supabase
      .from('bank_connections').select('*').eq('id', connection_id).single();
    if (connErr || !conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    // Fetch transactions from Plaid
    const res = await fetch(`${base}/transactions/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        access_token: conn.access_token,
        start_date: start_date || thirtyDaysAgo,
        end_date: end_date || today,
        options: { count: 500, offset: 0 },
      }),
    });

    const data = await res.json();
    if (data.error_code) return NextResponse.json({ error: data.error_message }, { status: 400 });

    // Upsert transactions into Supabase
    const txns = (data.transactions || []).map(t => ({
      connection_id: conn.id,
      plaid_transaction_id: t.transaction_id,
      date: t.date,
      amount: t.amount,
      name: t.name || t.merchant_name || 'Unknown',
      merchant_name: t.merchant_name,
      category: (t.category || []).join(' > '),
      pending: t.pending || false,
      account_id: t.account_id,
    }));

    if (txns.length > 0) {
      const { error: upsertErr } = await supabase
        .from('bank_transactions')
        .upsert(txns, { onConflict: 'plaid_transaction_id' });
      if (upsertErr) console.error('Upsert error:', upsertErr);
    }

    // Update last_synced
    await supabase.from('bank_connections').update({ last_synced: new Date().toISOString() }).eq('id', conn.id);

    return NextResponse.json({
      transactions: txns,
      accounts: data.accounts || [],
      total: data.total_transactions,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET: fetch stored transactions from Supabase (no Plaid call)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get('connection_id');
    const matched = searchParams.get('matched'); // 'true', 'false', or null for all

    let query = supabase.from('bank_transactions').select('*').order('date', { ascending: false });
    if (connectionId) query = query.eq('connection_id', connectionId);
    if (matched === 'true') query = query.not('matched_invoice_id', 'is', null);
    if (matched === 'false') query = query.is('matched_invoice_id', null);

    const { data, error } = await query.limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ transactions: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
