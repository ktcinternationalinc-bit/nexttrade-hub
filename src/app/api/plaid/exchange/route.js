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
    const { public_token, metadata } = await req.json();
    const env = process.env.PLAID_ENV || 'sandbox';
    const base = PLAID_BASE[env] || PLAID_BASE.sandbox;

    // Exchange public token for access token
    const res = await fetch(`${base}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        public_token,
      }),
    });

    const data = await res.json();
    if (data.error_code) return NextResponse.json({ error: data.error_message }, { status: 400 });

    const { access_token, item_id } = data;
    const institution = metadata?.institution || {};

    // Store connection in Supabase
    const { data: conn, error } = await supabase.from('bank_connections').upsert({
      plaid_item_id: item_id,
      access_token,
      institution_id: institution.institution_id || null,
      institution_name: institution.name || 'Unknown Bank',
      status: 'active',
      last_synced: new Date().toISOString(),
    }, { onConflict: 'plaid_item_id' }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, connection: { id: conn.id, institution_name: conn.institution_name } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
