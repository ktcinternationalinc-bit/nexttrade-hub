// Independent server-only dashboard and bank balance authorities. Operational transactions, invoice payments,
// bills and categorization retain their own permissions. Neither a legacy role
// nor a writable module_permissions row can grant account balances.
export class BankVisibilityError extends Error {
  constructor(message, status) { super(message); this.name = 'BankVisibilityError'; this.status = status; }
}
function reject(message, status) { throw new BankVisibilityError(message, status); }
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
var HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' };

export var BANK_CONNECTION_METADATA_COLUMNS = 'id,institution_id,institution_name,status,last_synced,created_at,wave_business_id,last_sync_status,last_sync_error,initial_backfill_start_date,last_successful_posted_date,last_successful_plaid_sync_at';
export var PLAID_ACCOUNT_METADATA_COLUMNS = 'id,connection_id,business_id,plaid_account_id,name,official_name,mask,type,subtype,iso_currency,is_read_only,updated_at,wave_business_id';

export function bankSuperAdminIds(env) {
  var value = String(env.HUB_SUPER_ADMIN_AUTH_USER_IDS || '').trim();
  var ids = value ? value.split(',').map(function (id) { return id.trim().toLowerCase(); }) : [];
  if (!ids.length || ids.length > 50 || ids.some(function (id) { return !UUID.test(id); }))
    reject('Bank balance access needs HUB_SUPER_ADMIN_AUTH_USER_IDS configured with verified Supabase Auth user IDs.', 503);
  return Array.from(new Set(ids));
}

export function requireBankSameOrigin(request, writes) {
  var origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || (writes && !origin) || request.headers.get('sec-fetch-site') === 'cross-site')
    reject('Cross-site bank requests are not allowed.', 403);
  if (writes && !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    reject('Send bank changes as JSON.', 415);
}

// This identity-only helper intentionally does not require a balance grant or
// configured super-admin list. Operational bank work can continue without it.
export async function authorizeBankIdentity(request, createClient, env) {
  requireBankSameOrigin(request, !['GET', 'HEAD'].includes(request.method));
  var match = /^Bearer ([^\s]{1,8192})$/.exec(request.headers.get('authorization') || '');
  if (!match) reject('Sign in to use bank data.', 401);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY)
    reject('The hub server database connection needs configuration.', 503);
  var authClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, OPTIONS);
  var result;
  try { result = await authClient.auth.getUser(match[1]); }
  catch (_) { reject('Your sign-in could not be verified. Sign in again.', 401); }
  var user = result && result.data && result.data.user;
  if (!result || result.error || !user || !UUID.test(user.id || '') || user.is_anonymous === true)
    reject('Your sign-in could not be verified. Sign in again.', 401);
  if (user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > Date.now()))
    reject('This account is inactive.', 403);
  var db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, OPTIONS);
  // The RPC maps the actual Auth UUID to exactly one active Hub profile. It
  // reads confirmed email from auth.users itself, never a browser identity.
  var mapped = await db.rpc('bank_visibility_profile_for_identity', { p_auth_user_id: user.id });
  if (mapped.error) reject('Bank access needs the bank-balance-visibility database migration.', 503);
  if (!Array.isArray(mapped.data) || mapped.data.length !== 1 || !UUID.test(mapped.data[0].profile_id || ''))
    reject('Your verified sign-in does not resolve to one active hub profile.', 403);
  return { db: db, authUserId: user.id.toLowerCase(), profileId: mapped.data[0].profile_id };
}

// Call only after independently verifying the supplied Auth UUID. This helper
// does not accept public.users IDs or role/module permission values.
export async function readBankVisibilityForIdentity(db, authUserId, env) {
  if (!UUID.test(authUserId || '')) reject('A verified sign-in is required.', 401);
  var isSuper = bankSuperAdminIds(env).includes(authUserId.toLowerCase());
  if (isSuper) return { canViewFullDashboard: true, canViewBankBalances: true, isVerifiedSuperAdmin: true };
  var result = await db.from('financial_visibility_permissions').select('can_view_dashboard,can_view_bank_balances').eq('auth_user_id', authUserId).maybeSingle();
  if (result.error) reject('Financial visibility permissions need the bank-balance-visibility database migration.', 503);
  return { canViewFullDashboard: result.data?.can_view_dashboard === true, canViewBankBalances: result.data?.can_view_bank_balances === true, isVerifiedSuperAdmin: false };
}

export async function authorizeBankVisibility(request, createClient, env) {
  var access = await authorizeBankIdentity(request, createClient, env);
  var capabilities = await readBankVisibilityForIdentity(access.db, access.authUserId, env);
  return Object.assign({}, access, capabilities);
}

export function bankVisibilityJson(body, status) { return Response.json(body, { status: status || 200, headers: HEADERS }); }
export function bankVisibilityErrorResponse(error) {
  return bankVisibilityJson({ ok: false, error: error instanceof BankVisibilityError ? error.message : 'The bank request could not be completed. Refresh before retrying.' },
    error instanceof BankVisibilityError ? error.status : 500);
}

export async function readBankJson(request) {
  if (Number(request.headers.get('content-length') || 0) > 32768) reject('This bank request is too large.', 413);
  var text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 32768) reject('This bank request is too large.', 413);
  try {
    var value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (_) { reject('Provide a valid JSON object.', 400); }
}

// Never return provider accounts verbatim, including to privileged callers:
// the operation needs account labels, not balances. The same payload is safe
// when scheduled ingestion records it in wave_sync_log.
export function projectPlaidAccountMetadata(accounts) {
  return (Array.isArray(accounts) ? accounts : []).map(function (account) {
    var a = account || {};
    var value = {};
    ['account_id', 'name', 'official_name', 'mask', 'type', 'subtype'].forEach(function (key) {
      value[key] = typeof a[key] === 'string' ? a[key] : null;
    });
    value.iso_currency = typeof a.balances?.iso_currency_code === 'string' ? a.balances.iso_currency_code : null;
    return value;
  });
}

function capabilitiesOf(access) {
  return { canViewFullDashboard: access.canViewFullDashboard, canViewBankBalances: access.canViewBankBalances, isVerifiedSuperAdmin: access.isVerifiedSuperAdmin };
}
async function listMappedProfiles(db) {
  var result = await db.rpc('bank_visibility_list_profiles');
  if (result.error || !Array.isArray(result.data)) reject('Verified bank permission targets could not be loaded. Check the database migration.', 503);
  if (result.data.length > 2000) reject('The permission target list is too large to display safely.', 503);
  return result.data;
}

// Dependency injection keeps the permission boundary testable without any
// live database or provider calls.
export function createBankVisibilityHandlers(createClient, env) {
  async function GET(request) {
    try {
      var access = await authorizeBankVisibility(request, createClient, env);
      var url = new URL(request.url);
      for (var key of url.searchParams.keys()) {
        if (key !== 'scope' || url.searchParams.getAll(key).length !== 1) reject('Invalid bank access query.', 400);
      }
      var scope = url.searchParams.get('scope');
      if (scope === null) return bankVisibilityJson({ ok: true, capabilities: capabilitiesOf(access) });
      if (scope !== 'grants') reject('Invalid bank access scope.', 400);
      if (!access.isVerifiedSuperAdmin) reject('Only a verified super admin can manage financial data access.', 403);
      var profiles = await listMappedProfiles(access.db);
      var result = await access.db.from('financial_visibility_permissions').select('auth_user_id,can_view_dashboard,can_view_bank_balances');
      if (result.error) reject('Financial visibility permissions could not be loaded.', 503);
      var granted = new Map((result.data || []).map(function (p) { return [p.auth_user_id.toLowerCase(), p]; }));
      var supers = bankSuperAdminIds(env);
      var rows = profiles.map(function (profile) {
        var id = profile.auth_user_id.toLowerCase(), isSuper = supers.includes(id);
        var grant = granted.get(id);
        return { profileId: profile.profile_id, authUserId: id, name: profile.name || '', email: profile.email || '',
          canViewFullDashboard: isSuper || grant?.can_view_dashboard === true,
          canViewBankBalances: isSuper || grant?.can_view_bank_balances === true, isVerifiedSuperAdmin: isSuper };
      });
      return bankVisibilityJson({ ok: true, capabilities: capabilitiesOf(access), grants: rows });
    } catch (error) { return bankVisibilityErrorResponse(error); }
  }
  async function PUT(request) {
    try {
      var access = await authorizeBankVisibility(request, createClient, env);
      if (!access.isVerifiedSuperAdmin) reject('Only a verified super admin can manage financial data access.', 403);
      if (new URL(request.url).search) reject('Invalid bank access query.', 400);
      var body = await readBankJson(request);
      var hasDashboard = Object.hasOwn(body, 'canViewFullDashboard'), hasBank = Object.hasOwn(body, 'canViewBankBalances');
      if (!UUID.test(body.profileId || '') || (!hasDashboard && !hasBank) ||
          (hasDashboard && typeof body.canViewFullDashboard !== 'boolean') || (hasBank && typeof body.canViewBankBalances !== 'boolean') ||
          Object.keys(body).some(function (key) { return !['profileId', 'canViewFullDashboard', 'canViewBankBalances'].includes(key); }))
        reject('Choose a verified team profile and at least one explicit financial access setting.', 400);
      var profiles = await listMappedProfiles(access.db);
      var targets = profiles.filter(function (p) { return p.profile_id === body.profileId; });
      if (targets.length !== 1) reject('This profile does not resolve to one active, verified Auth identity.', 409);
      var target = targets[0];
      if (bankSuperAdminIds(env).includes(target.auth_user_id.toLowerCase()))
        reject('Super-admin access is managed by the server Auth-ID allowlist.', 409);
      // One database transaction changes the grant and appends its audit event.
      // Re-resolve the profile within that transaction to reject changed targets.
      var saved = await access.db.rpc('bank_visibility_set_grant', {
        p_profile_id: body.profileId, p_auth_user_id: target.auth_user_id,
        p_actor_auth_user_id: access.authUserId,
        p_can_view_dashboard: hasDashboard ? body.canViewFullDashboard : null,
        p_can_view_bank_balances: hasBank ? body.canViewBankBalances : null,
      });
      if (saved.error || typeof saved.data?.can_view_dashboard !== 'boolean' || typeof saved.data?.can_view_bank_balances !== 'boolean')
        reject('The financial permission change was not saved. Refresh the target list and retry.', 409);
      return bankVisibilityJson({ ok: true, capabilities: capabilitiesOf(access),
        grant: { profileId: body.profileId, authUserId: target.auth_user_id,
          canViewFullDashboard: saved.data.can_view_dashboard, canViewBankBalances: saved.data.can_view_bank_balances, isVerifiedSuperAdmin: false } });
    } catch (error) { return bankVisibilityErrorResponse(error); }
  }
  return { GET: GET, PUT: PUT };
}
