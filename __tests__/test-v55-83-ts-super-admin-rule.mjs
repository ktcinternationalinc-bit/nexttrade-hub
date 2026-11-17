// v55.83-TS (Max, Nov 17: "im a super admin why wouldn't i see it" — Month-end refused him; Codex QA 17 Nov: the fallback and the
// grants list must use the SAME authority). Runs the real authorizeBankVisibility + the grants handler on a fake database.
import { authorizeBankVisibility, createBankVisibilityHandlers } from '../src/lib/bank-visibility.js';

let pass = 0, fail = 0;
const check = (l, c, x) => { if (c) pass++; else fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + l + (c ? '' : '  ' + JSON.stringify(x))); };
const MAX = '11111111-1111-4111-8111-111111111111', LISTED = '22222222-2222-4222-8222-222222222222', STAFF = '33333333-3333-4333-8333-333333333333';
const PROFILE = { [MAX]: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [LISTED]: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [STAFF]: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const ROLE = { [PROFILE[MAX]]: 'super_admin', [PROFILE[LISTED]]: 'admin', [PROFILE[STAFF]]: 'admin' };
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', HUB_SUPER_ADMIN_AUTH_USER_IDS: LISTED };
function q(table) {
  const f = {};
  const api = {
    select() { return api; }, eq(k, v) { f[k] = v; return api; },
    maybeSingle() {
      if (table === 'users') { return Promise.resolve({ data: ROLE[f.id] ? { role: ROLE[f.id] } : null, error: null }); }
      if (table === 'financial_visibility_permissions') { return Promise.resolve({ data: null, error: null }); }
      return Promise.resolve({ data: null, error: null });
    },
    then(res) {
      if (table === 'users') { return Promise.resolve({ data: Object.keys(ROLE).filter(id => !f.role || ROLE[id] === f.role).map(id => ({ id })), error: null }).then(res); }
      if (table === 'financial_visibility_permissions') { return Promise.resolve({ data: [], error: null }).then(res); }
      return Promise.resolve({ data: [], error: null }).then(res);
    }
  };
  return api;
}
function createClient(url, key) {
  return {
    auth: { getUser: tok => Promise.resolve({ data: { user: { id: tok } }, error: null }) },
    from: q,
    rpc(name, a) {
      if (name === 'bank_visibility_profile_for_identity') { return Promise.resolve({ data: [{ profile_id: PROFILE[a.p_auth_user_id], auth_user_id: a.p_auth_user_id }], error: null }); }
      if (name === 'bank_visibility_list_profiles') { return Promise.resolve({ data: Object.keys(PROFILE).map(u => ({ profile_id: PROFILE[u], auth_user_id: u, name: u.slice(0, 4), email: '' })), error: null }); }
      return Promise.resolve({ data: null, error: { message: 'no' } });
    }
  };
}
const req = (uid, url) => new Request(url || 'https://hub.test/api/accounting/month-end', { method: 'GET', headers: { authorization: 'Bearer ' + uid } });

console.log('TS — one super-admin rule for bank screens and the grants list');
const a = await authorizeBankVisibility(req(MAX), createClient, env);
check('Max (Hub role super_admin, not on the server id list) is a super admin on Month-end and the bank screens', a.isVerifiedSuperAdmin === true && a.canViewBankBalances === true, a);
const s = await authorizeBankVisibility(req(STAFF), createClient, env);
check('an admin who is not super admin still gets NO balances without a grant', s.isVerifiedSuperAdmin === false && s.canViewBankBalances === false, s);
const l = await authorizeBankVisibility(req(LISTED), createClient, env);
check('the server id list still works as before', l.isVerifiedSuperAdmin === true);
const H = createBankVisibilityHandlers(createClient, env);
const g = await (await H.GET(req(MAX, 'https://hub.test/api/bank-visibility?scope=grants'))).json();
const row = id => (g.grants || []).find(x => x.authUserId === id) || {};
check('the grants list shows Max as super admin too (it used to show only the id list)', g.ok === true && row(MAX).isVerifiedSuperAdmin === true && row(MAX).canViewBankBalances === true, g);
check('…and an ordinary admin as NOT super admin', row(STAFF).isVerifiedSuperAdmin === false && row(STAFF).canViewBankBalances === false);
// Codex QA 17 Nov — the ⚠ Uncategorized row must equal the lines listed under it; the paid-through part is its own minus line
const fs = await import('fs');
const ps = fs.readFileSync(new URL('../src/components/PeriodStatsTab.jsx', import.meta.url), 'utf8');
check('Stats: the ⚠ Uncategorized row shows the full total of its listed lines, and the paid-through part is a separate − line',
  /\$\{fmt\(data\.spending\.uncategorized\.total\)\}<\/td><td \/><\/tr>\}/.test(ps) && /− of which sent to \{ptOnNames\.join/.test(ps) && /−\$\{fmt\(Math\.abs\(ptAdjust\(data\.spending\.categories\)\.uncShift\)\)\}/.test(ps) &&
  /var uncOut2 = uncOutView\(\);/.test(ps));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
