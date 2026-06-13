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
    const { public_token, metadata, wave_business_id } = await req.json();
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
      wave_business_id: wave_business_id || null,
      last_synced: new Date().toISOString(),
    }, { onConflict: 'plaid_item_id' }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Pull accounts so we can show account names/masks. Balances are stored here but
    // only shown to admins (bank.view_account_balances) at display time. Non-fatal.
    try {
      const accRes = await fetch(`${base}/accounts/get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.PLAID_CLIENT_ID,
          secret: process.env.PLAID_SECRET,
          access_token,
        }),
      });
      const accData = await accRes.json();
      if (accData && Array.isArray(accData.accounts) && conn && conn.id) {
        const accRows = accData.accounts.map((a) => ({
          connection_id: conn.id,
          business_id: conn.business_id || null,
          plaid_account_id: a.account_id,
          name: a.name || null,
          official_name: a.official_name || null,
          mask: a.mask || null,
          type: a.type || null,
          subtype: a.subtype || null,
          iso_currency: (a.balances && a.balances.iso_currency_code) || 'USD',
          current_balance: a.balances ? a.balances.current : null,
          available_balance: a.balances ? a.balances.available : null,
          is_read_only: true,
          updated_at: new Date().toISOString(),
        }));
        if (accRows.length) {
          await supabase.from('plaid_accounts').upsert(accRows, { onConflict: 'plaid_account_id' });
        }
      }
    } catch (accErr) {
      // Connection still succeeds even if account pull fails; accounts refresh on next sync.
    }

    return NextResponse.json({ success: true, connection: { id: conn.id, institution_name: conn.institution_name } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
