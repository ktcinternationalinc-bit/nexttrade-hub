// Server authorization for credential-changing team administration.
// Browser roles, user_id values and legacy module grants never confer access.
export class UserAdminError extends Error {
  constructor(message, status) { super(message); this.name = 'UserAdminError'; this.status = status; }
}
function reject(message, status) { throw new UserAdminError(message, status); }
var UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function authorizeUserAdmin(request, createClient, env) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site')
    reject('Cross-site team administration is not allowed.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) reject('Send team changes as JSON.', 415);
  var allowedIds = [];
  for (var key of ['HUB_ADMIN_AUTH_USER_IDS', 'HUB_SUPER_ADMIN_AUTH_USER_IDS']) {
    var configured = String(env[key] || '').trim();
    var ids = configured ? configured.split(',').map(function (id) { return id.trim().toLowerCase(); }) : [];
    if (ids.length > 50 || ids.some(function (id) { return !UUID.test(id); }))
      reject('Team administration requires valid HUB_ADMIN_AUTH_USER_IDS and HUB_SUPER_ADMIN_AUTH_USER_IDS settings.', 503);
    allowedIds.push(...ids);
  }
  if (!allowedIds.length) reject('Team administration is disabled until HUB_ADMIN_AUTH_USER_IDS or HUB_SUPER_ADMIN_AUTH_USER_IDS is configured with approved Supabase Auth user IDs.', 503);
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY)
    reject('Team administration requires the server Supabase configuration.', 503);
  var match = /^Bearer ([^\s]{1,8192})$/.exec(request.headers.get('authorization') || '');
  if (!match) reject('Sign in to administer team members.', 401);
  var options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  var authClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  var verified;
  try { verified = await authClient.auth.getUser(match[1]); }
  catch (_) { reject('Your sign-in could not be verified. Sign in again.', 401); }
  var user = verified && verified.data && verified.data.user;
  if (!verified || verified.error || !user || !UUID.test(user.id || '') || user.is_anonymous === true)
    reject('Your sign-in could not be verified. Sign in again.', 401);
  if (!allowedIds.includes(user.id.toLowerCase())) reject('Your verified account is not approved to administer team members.', 403);
  if ((user.banned_until && Date.parse(user.banned_until) > Date.now()) || user.deleted_at) reject('This administrator account is inactive.', 403);

  // Construct the service client only after the independent Auth-ID allowlist.
  var db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
  var direct = await db.from('users').select('id,email,active').eq('id', user.id).maybeSingle();
  if (direct.error) reject('The administrator profile could not be verified.', 503);
  var profile = direct.data;
  if (!profile) {
    // Legacy profiles can have a separate UUID. Resolve only the verified email,
    // use a literal LIKE pattern, and reject duplicate or inactive profiles.
    var email = user.email_confirmed_at && typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    if (!email) reject('Your administrator sign-in does not resolve to an active hub profile.', 403);
    var escapedEmail = email.replace(/[\\%_]/g, function (char) { return '\\' + char; });
    var candidates = await db.from('users').select('id,email,active').ilike('email', escapedEmail).limit(3);
    if (candidates.error) reject('The administrator profile could not be verified.', 503);
    var exact = (candidates.data || []).filter(function (row) { return typeof row.email === 'string' && row.email.trim().toLowerCase() === email; });
    if (exact.length !== 1) reject('Your administrator sign-in does not resolve to one active hub profile.', 403);
    profile = exact[0];
  }
  if (profile.active !== true) reject('Your administrator hub profile is inactive.', 403);
  return { db: db, authUserId: user.id, profileId: profile.id };
}

export async function readUserAdminJson(request) {
  if (Number(request.headers.get('content-length') || 0) > 32768) reject('This team change is too large.', 413);
  var raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32768) reject('This team change is too large.', 413);
  try {
    var value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (_) { reject('Provide a valid team change as a JSON object.', 400); }
}
export function requireTargetUserId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) reject('A valid target user ID is required.', 400);
  return value;
}
export function userAdminErrorResponse(error) {
  return Response.json({ error: error instanceof UserAdminError ? error.message : 'The team administration request could not be completed. Refresh before retrying.' },
    { status: error instanceof UserAdminError ? error.status : 500, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' } });
}
