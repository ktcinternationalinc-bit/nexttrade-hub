import { authorizePlaidOperation, plaidJson, plaidError } from '../_auth';
import { readBankJson } from '../../../../lib/bank-visibility';

const PLAID_BASE = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export async function POST(req) {
  try {
    const access = await authorizePlaidOperation(req, 'categories.apply', false);
    await readBankJson(req);
    const env = process.env.PLAID_ENV || 'sandbox';
    const base = PLAID_BASE[env] || PLAID_BASE.sandbox;

    const res = await fetch(`${base}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        user: { client_user_id: access.authUserId },
        client_name: 'KTC NextTrade Hub',
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
      }),
    });

    const data = await res.json();
    if (data.error_code) return plaidJson({ error: data.error_message, env: env }, { status: 400 });
    return plaidJson({ link_token: data.link_token, env: env });
  } catch (e) {
    return plaidError(e);
  }
}
