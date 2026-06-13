import { NextResponse } from 'next/server';

// v55.83-BU — lightweight status probe for the Bank tab. Reports which Plaid
// environment is active and whether the keys are present in Vercel, WITHOUT
// creating a link token or calling Plaid. Never returns the secret itself.
export async function GET() {
  try {
    const env = process.env.PLAID_ENV || 'sandbox';
    const hasClientId = !!process.env.PLAID_CLIENT_ID;
    const hasSecret = !!process.env.PLAID_SECRET;
    return NextResponse.json({ env: env, hasClientId: hasClientId, hasSecret: hasSecret, hasKeys: hasClientId && hasSecret });
  } catch (e) {
    return NextResponse.json({ env: 'unknown', hasClientId: false, hasSecret: false, hasKeys: false, error: e.message }, { status: 500 });
  }
}
