# Team administration: required server configuration

The `/api/users` endpoint can create authentication accounts, reset passwords,
change team profiles, deactivate members, and permanently delete members. These
operations now require a verified administrator session before any service-role
mutation can run.

## One-time setup

In the hub deployment’s **server environment**, set the verified owner/super-administrator list. Add a delegated administrator list only if needed:

```text
HUB_SUPER_ADMIN_AUTH_USER_IDS=<approved owner Supabase Auth user UUID>
HUB_ADMIN_AUTH_USER_IDS=<optional delegated administrator Supabase Auth user UUID>
```

Copy the IDs from the intended administrators’ entries in **Supabase →
Authentication → Users**. Verify the intended people before adding them. Use Auth
user IDs, not a legacy `public.users.id`, a role name, or an email address. One to
50 comma-separated UUIDs are accepted in each configured list. Super administrators are automatically accepted by the team API; they do not need to appear in both lists. Do not prefix either setting with
`NEXT_PUBLIC_` or place it in browser code.

The existing server settings `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are also required.
The service-role key remains server-only. Redeploy after changing server values.
This code update does not configure or guess any administrator IDs. Apply `sql/bank-balance-visibility.sql` in the confirmed hub database before using account updates or deletions. That migration provides the protected identity and financial-grant checks used by this endpoint.

If both administrator lists are absent, or a supplied list is malformed, the endpoint returns **503** with a setup message and makes no account changes. Updates and deletions also require a valid super-administrator configuration and the financial-access migration so protected targets can be checked. The endpoint does not fall back to the browser’s claimed role or module permissions.

## Administrator requirements

An operator must:

1. Be signed in through the existing hub Supabase login.
2. Have that verified Supabase Auth UUID in `HUB_ADMIN_AUTH_USER_IDS` or `HUB_SUPER_ADMIN_AUTH_USER_IDS`.
3. Resolve to an active hub profile (`active = true`). A profile with the same
   Auth UUID is preferred. For older profiles with a separate UUID, the verified
   and confirmed Auth email must resolve to exactly one matching profile.

Existing Settings page visibility rules remain in place. The API’s independent
Auth-ID allowlist is authoritative even if a legacy role or module grant changes.
The two protected financial viewing permissions are separate; a financial viewer is not automatically a team administrator. Delegated team administration does not grant Full dashboard access, Banking information access, or permission to manage financial grants.

The four Settings actions now attach the genuine browser session bearer token.
The server verifies it using Supabase `auth.getUser` and rejects missing, invalid,
anonymous, inactive, and non-allowlisted identities. Cross-origin writes and
requests without JSON content type are rejected. No `user_id`, `role`, or
permission value in the request can impersonate the acting administrator.

## Protected target accounts

Before a profile update, password reset, deactivation or deletion, the server resolves the target to its exact Supabase Auth UUID using a service-only database function. Ambiguous mappings fail closed. Inactive, banned and deleted identities remain part of the protection check so deactivating an account cannot remove its protection.

Only a verified super administrator may change an account that is itself a configured super administrator or has either protected financial viewing permission. This prevents a delegated administrator from acquiring financial access by resetting a privileged user’s password or changing that user’s profile. Delegated administrators retain the existing ability to manage ordinary staff accounts.

Password resets and permanent Auth deletions use the resolved UUID directly; they do not rely on an unpaginated list of Auth users or a browser-supplied acting-user ID. A password reset with no matching sign-in returns an error. Permanent deletion reports an Auth deletion failure instead of claiming that the entire operation succeeded.

## Scope and verification

This change protects the existing credential-changing users endpoint and its
direct Settings callers. It does not claim to revise all legacy database RLS
policies or unrelated service routes. A repository search found the direct
Supabase Auth create/reset/delete calls only in this endpoint before the change.

Run the focused, offline tests with:

```sh
node scripts/test-user-admin-auth.mjs
```

They exercise the actual handler factory against mocked Supabase clients; no
live user account or deployment is modified. The suite includes protected super-administrator and financial-viewer targets, ordinary staff changes, exact target identity, missing/ambiguous targets and super-administrator access without a duplicate delegated-admin entry.
