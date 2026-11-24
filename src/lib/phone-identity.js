// Phone assignments and TwiML <Client> destinations use public.users IDs,
// which can differ from the verified Supabase Auth ID on legacy accounts.
export async function resolvePhoneIdentity(db, authUser, requestedId) {
  if (!authUser || !authUser.id || authUser.is_anonymous === true || authUser.deleted_at ||
      (authUser.banned_until && Date.parse(authUser.banned_until) > Date.now())) {
    return { error: 'An active sign-in is required.', status: 403 };
  }
  const direct = await db.from('users').select('id,email,active').eq('id', authUser.id).maybeSingle();
  if (direct.error) return { error: 'Phone profile could not be verified. Please retry.', status: 503 };
  let profile = direct.data;
  if (!profile) {
    const email = authUser.email_confirmed_at && typeof authUser.email === 'string'
      ? authUser.email.trim().toLowerCase() : '';
    if (!email) return { error: 'Your sign-in does not resolve to a verified Hub phone profile.', status: 403 };
    const literalEmail = email.replace(/[\\%_]/g, char => '\\' + char);
    const candidates = await db.from('users').select('id,email,active').ilike('email', literalEmail).limit(3);
    if (candidates.error) return { error: 'Phone profile could not be verified. Please retry.', status: 503 };
    const exact = (candidates.data || []).filter(row =>
      typeof row.email === 'string' && row.email.trim().toLowerCase() === email);
    if (exact.length !== 1) return { error: 'Your sign-in must resolve to one Hub phone profile.', status: 403 };
    profile = exact[0];
  }
  if (profile.active !== true) return { error: 'Your Hub phone profile is inactive.', status: 403 };
  // Accept only this user's profile ID or Auth ID; always issue the profile
  // identity. Never trust a client-supplied UUID as the token identity.
  if (requestedId != null && requestedId !== profile.id && requestedId !== authUser.id) {
    return { error: 'user_id mismatch', status: 403 };
  }
  return { identity: profile.id };
}
