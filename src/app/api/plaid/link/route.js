import { NextResponse } from 'next/server';

const PLAID_BASE = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export async function POST(req) {
  try {
    const { user_id } = await req.json();
    const env = process.env.PLAID_ENV || 'sandbox';
    const base = PLAID_BASE[env] || PLAID_BASE.sandbox;

    const res = await fetch(`${base}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        user: { client_user_id: user_id || 'default' },
        client_name: 'KTC NextTrade Hub',
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
      }),
    });

    const data = await res.json();
    if (data.error_code) return NextResponse.json({ error: data.error_message, env: env }, { status: 400 });
    return NextResponse.json({ link_token: data.link_token, env: env });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
