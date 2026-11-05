# Automatic Ledgerly feed for the existing KTC hub

This update adds **Accounting → Ledgerly** to the supplied Nexttrade/KTC hub. It prepares a server connection that pulls selected Ledgerly datasets every **15 minutes**, including while the hub is closed. The open dashboard reads the saved snapshot every **60 seconds**, and when the page becomes visible or regains focus. Users do not import files or press a refresh button.

**The implementation is provided in this source package. Live activation is pending deployment to the existing hub, both database migrations, and server configuration.** No production database or cloud environment was changed during this work. Existing jobs found in `vercel.json` are preserved; their presence in source is not evidence that they are running in production. At handoff, Vercel still requires authorization for the existing KTC team before its project configuration or deployment can be accessed.

## What appears in the hub

The default automatic selection is:

- Year-to-date summary: revenue, expenses, profit, recorded cash, receivables, payables, recorded invoice tax, and the planning reserve.
- Invoices: dates, customers, amounts, balances, status, and line details.
- Bank account snapshots: masked account labels, cached balances, currencies, bank snapshot time, and connection/environment status.
- Bank transactions: signed amounts, dates, descriptions, pending/removed flags, review status, and changed-after-review flags.

Server configuration can also select bills, expenses, checks, contacts, and journal entries. Every dataset has its own view; additional resources appear automatically when selected and successfully synced.

Ledgerly records remain a separate read-only source. They are **not inserted into the hub’s existing invoice, inventory, bank transaction, payment, or Wave tables**. This prevents a mirrored invoice or bank transaction from being counted twice or triggering an operational workflow. The existing hub and its current Plaid/Wave features are preserved.

## Activation steps

1. **Confirm and use the existing hub’s Supabase project.** Review and run `sql/ledgerly-automatic-sync.sql` and `sql/bank-balance-visibility.sql`. The first adds an isolated snapshot table and service-only sync functions. The second adds protected financial grants and audit records, restricts direct browser access to bank-account metadata, protects raw backups, and removes historical provider balances/tokens from nested Plaid log payloads. These privacy changes are deliberate; invoice, bill, expense, payment and bank-transaction records are preserved. Do not replay the hub’s historical migrations or infer the database association from its name alone.
2. **Create a scoped read key in the real Ledgerly company.** Its scopes must include every resource selected below. The defaults require `summary`, `invoices`, `bank-accounts`, and `bank-transactions`. This key only reads records. It cannot connect banks, post journal entries, or move money.
3. **Obtain the private Ledgerly Site service credential** through the supported Sites access flow. This is separate from the scoped Ledgerly key. Both credentials are needed to read the private Site from the hub server.
4. **Configure the existing hub’s production server environment** using the table below, including the verified owner’s Supabase Auth UUID in `HUB_SUPER_ADMIN_AUTH_USER_IDS`. Secrets and administrator allowlists must stay on the server. Never prefix them with `NEXT_PUBLIC_` or paste them into source files. The owner can then use Settings → Financial data access to grant the two independent financial viewing permissions to other users.
5. **Deploy this updated source to the existing Vercel hub project.** Vercel activates `vercel.json` cron jobs on production deployments. The every-15-minute schedule requires a plan that supports subdaily jobs, such as Pro or Enterprise; Hobby permits daily jobs only. If the existing deployment uses another scheduler, configure an equivalent authorized GET request every 15 minutes with its secret kept by that scheduler. See [Vercel cron configuration](https://vercel.com/docs/cron-jobs/quickstart) and [plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
6. **Verify activation with a real scheduled run and permitted user sessions.** Confirm a successful `/api/ledgerly/sync` execution and a populated `last_success_at` in the new snapshot row. Then sign in as an approved financial user and open Accounting → Ledgerly. Verify source revision, currency, invoice totals, and the successful-pull time. Confirm that Full dashboard access alone omits bank balances from the API response, Banking information access alone does not unlock all company datasets, and permitted transaction matching/classification still works. Wait for a subsequent scheduled run and check that the view updates without a manual action. Source tests do not substitute for this live verification.

The supplied hub’s account-administration route is also being hardened in this update. Deploy that fix with the integration; do not activate the financial source against an older unprotected `/api/users` route.

## Production server settings

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing hub Supabase project URL. Preserve the established value. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Existing hub public Supabase key, used to verify a visitor’s JWT through Supabase Auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing **server secret** for the same hub database. It writes the isolated snapshot and reads authorization records. |
| `LEDGERLY_BASE_URL` | Optional. Defaults to `https://ledgerly-business-books.easyibex128.chatgpt.site`. Use an HTTPS origin only, without a path, query, credentials, or fragment. |
| `LEDGERLY_ALLOWED_ORIGIN` | Only needed when deliberately changing the source origin. Set to the same exact HTTPS origin as `LEDGERLY_BASE_URL`; this extra pin prevents an accidental URL change from sending existing credentials to another host. |
| `LEDGERLY_READ_KEY` | **Secret.** A scoped `ldg_…` read key from the real Ledgerly company. |
| `LEDGERLY_SITE_ACCESS_TOKEN` | **Secret.** The private Sites service credential for this exact Ledgerly Site. |
| `LEDGERLY_RESOURCES` | Optional comma-separated resource names. Default: `summary,invoices,bank-accounts,bank-transactions`. Allowed names: `summary,invoices,bills,expenses,checks,contacts,journal,bank-accounts,bank-transactions`. |
| `CRON_SECRET` | **Secret.** A cryptographically random scheduler credential of at least 16 characters. Preserve a strong existing value used by the hub’s other jobs. Vercel supplies it as `Authorization: Bearer …`. Missing or weak values disable this new sync. |
| `HUB_SUPER_ADMIN_AUTH_USER_IDS` | Required server-only list of 1–50 approved **Supabase Auth user UUIDs**. A verified, active super administrator receives both protected viewing permissions, manages those grants, and can administer protected user accounts and backups. Use IDs from Supabase Authentication → Users, not a legacy `public.users.id`. |
| `HUB_ADMIN_AUTH_USER_IDS` | Optional server-only list of up to 50 verified Supabase Auth UUIDs for delegated team administration. It does not grant either financial permission or allow changing a protected financial user’s identity. Super administrators are included automatically and need not be duplicated here. See `TEAM_ADMIN_SECURITY_SETUP.md`. |

Do not log credentials, put them in URLs, or pass them to the browser. The hub’s new browser endpoint only returns authorized cached records and connection status. If Vercel Deployment Protection is enabled, confirm that the project’s supported cron invocation is permitted; do not make the hub or Ledgerly public to work around a sign-in wall.

### Two independent financial permissions

The server validates the visitor’s bearer token with Supabase `auth.getUser` and resolves exactly one active hub profile through the verified Auth UUID or a confirmed email address. Ambiguous, anonymous, banned, deleted and inactive identities fail closed. The two special permissions are stored in the service-only `financial_visibility_permissions` table and are changed through an audited API by a verified super administrator.

| Permission | What it grants | What remains separately controlled |
| --- | --- | --- |
| **Full dashboard access** | Shared company financial overview, nonbank dashboard figures, and the selected nonbank Ledgerly datasets. | Bank balances and bank-wide monetary summaries still require Banking information access. Editing and operational navigation still use ordinary module/action permissions. |
| **Banking information access** | Bank account balances, available balances and bank-wide monetary summaries. | It does not grant the full company dashboard or all nonbank Ledgerly datasets. |
| **Verified super administrator** | Both permissions, their administration, and protected account/backup administration. | This status comes from the server Auth UUID list, not an editable profile role. |

In Settings → Financial data access, changing one switch preserves the other. Legacy owner/admin/Finance Admin role names, ordinary module grants and the obsolete `LEDGERLY_ALLOWED_AUTH_USER_IDS` setting do not confer either special permission.

Staff retain ordinary permissions for entering invoices, bills and expenses; reviewing individual bank transactions; matching payments; and classification. Personal or assigned work is retained. Existing transaction-amount permissions still control individual amounts. Neither new viewing switch grants an operational edit action by itself.

For the shared Ledgerly source, a viewer needs at least one special permission. Full-dashboard viewers receive nonbank company datasets, but the server omits the cash balance from summary responses. Their ordinary bank permissions can also permit account metadata and individual transactions; current and available balances remain absent. Banking-only viewers receive bank datasets without the other company datasets. The complete raw journal requires both special permissions because it includes opening balances and balance adjustments. These projections do not modify the complete server-only snapshot.

Older migrations permit broad writes to some legacy module-permission records, so they cannot be the authority for protected financial access. The new grants, audits, identity RPCs and snapshot are unavailable directly to browser roles. The bank-account tables expose explicit safe metadata columns rather than `SELECT *`. Raw backups require a verified super administrator, even for a user who has both viewing permissions.

The browser clears protected state on sign-out, account changes, failed authorization and permission-change events. It rechecks permissions on focus and at least every 60 seconds while active; each API read is independently authorized. A remote revocation does not retroactively erase information already seen, but later requests cannot retrieve it.

## Automatic operation and data semantics

The source is fetched with HTTPS GET requests using two headers:

```text
Authorization: Bearer <LEDGERLY_READ_KEY>
OAI-Sites-Authorization: Bearer <LEDGERLY_SITE_ACCESS_TOKEN>
```

Requests are pinned to the configured origin and reject redirects. Unexpected HTML, a sign-in page, an expired key, insufficient scopes, malformed money fields, or an incomplete page sequence cannot become a successful snapshot. Raw upstream error bodies and credentials are never returned in error messages.

Every selected resource and page must use the same Ledgerly revision and company currency. A change mid-pull restarts the **whole snapshot**, including resources already fetched. The process uses bounded requests, response sizes, row counts, and a 45-second fetch budget. Publication is one atomic database update guarded by a two-minute lease and run token. Overlapping jobs cannot overwrite one another, and an older source revision cannot replace a newer revision for the same configuration. Failed pulls preserve the last complete snapshot.

The summary covers January 1 through the current UTC date. Its financial totals are accrual figures, and its cash figure is the **book balance**. Detailed documents cover all recorded dates; document status and outstanding balances are current as of the snapshot. Bank account balances are the latest cached snapshots from the bank provider, with each account’s bank snapshot time shown separately from the hub’s pull time. A recent hub pull does not force a fresh bank-provider update.

All `…Cents` amounts use integer cents. Bank rows carry their own currency; there is no currency conversion or mixed-currency aggregation. Bank transaction amounts are positive for money in and negative for money out. Null balances remain unavailable. Pending, removed, changed-after-review, and sandbox/test states stay visible. Nothing in this connection initiates a payment, remits tax, or posts an additional accounting entry.

The dashboard labels a snapshot stale after 30 minutes without a successful pull. It continues showing the last complete snapshot with its timestamp and status. Browser reads automatically resume after temporary failures. Vercel does not retry a failed cron invocation automatically; this integration retries on its next scheduled invocation. See [Vercel job behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Changing the source credentials, origin, or selected resources changes the configuration fingerprint. A snapshot from the previous configuration is hidden until a complete new pull succeeds. Expiring Ledgerly read keys must be rotated in the server environment; the data view never requests secrets from ordinary users.

## Verification provided with this package

Run the focused offline suites:

```sh
node __tests__/test-ledgerly-automatic-sync.mjs
node __tests__/test-ledgerly-visibility.mjs
node __tests__/test-ledgerly-data-route.mjs
node __tests__/test-bank-visibility-client.mjs
node __tests__/test-bank-account-schema-compatibility.mjs
node scripts/test-bank-visibility.mjs
node scripts/test-bank-write-auth.mjs
node scripts/test-backup-security.mjs
node scripts/test-user-admin-auth.mjs
```

These use Node built-ins and injected HTTP/database doubles. They check pagination, whole-snapshot revision restarts, private header placement, redirect/HTML rejection, null/currency/sign handling, malformed data and capacity limits, lease contention, failure preservation, cache isolation after credential rotation, verified identity mapping, independent financial permissions, protected fields absent from actual HTTP JSON, ordinary matching without a balance grant, revocation, backup authorization, and protected account administration. They perform no live API calls or database writes.

`scripts/test-bank-visibility-sql.mjs` separately executes the actual privacy migration in a disposable PostgreSQL runtime supplied by pinned `@electric-sql/pglite@0.5.11`. Install that dependency in a temporary directory outside the application and pass the absolute path of its `dist/index.js` to the script. Its header contains the repeatable command. It checks real role and column privileges, identity ambiguity, partial grants, audit rollback, historical log cleanup and migration reapplication. It does not contact Supabase or modify application dependencies. This local runtime test is not a claim that the migration has been applied to the live database.

The existing accounting/bank regression suite remains available:

```sh
npm run test:accounting-bank
```

The hub’s normal production build remains `npm run build`. A build with synthetic Supabase values can verify compilation but cannot establish a working live connection, valid production credentials, applied SQL, scheduled execution, or authorized financial access. Those are the activation checks above.

## Files added or changed for this integration

- `src/lib/ledgerly-sync.js`: private source client, validation, pagination, atomic sync orchestration, and cached response projection.
- `src/lib/ledgerly-auth.js`: verified user/profile and protected financial authorization.
- `src/lib/ledgerly-visibility.js`: per-request resource and field projection.
- `src/lib/ledgerly-data-handler.js`: testable authorized cached-data handler.
- `src/app/api/ledgerly/sync/route.js`: mandatory-secret scheduled GET endpoint.
- `src/app/api/ledgerly/data/route.js`: thin, no-store cached data endpoint.
- `src/components/LedgerlyHub.jsx`: automatic dashboard and record views.
- `src/components/AccountingTab.jsx`: Ledgerly sub-tab; existing sections retained.
- `sql/ledgerly-automatic-sync.sql`: isolated table and service-only functions.
- `sql/bank-balance-visibility.sql`: protected grants, audit, identity functions and bank/backup privacy restrictions.
- `src/lib/bank-visibility.js` and `src/app/api/bank-visibility/route.js`: verified financial capabilities and audited super-admin grant management.
- `src/components/BankBalancePermissions.jsx`: independent Settings switches.
- `vercel.json`: added `*/15 * * * *` Ledgerly job; all existing jobs retained.
- `__tests__/test-ledgerly-automatic-sync.mjs`: offline integration tests.

The financial bridge does not replace the hub’s broader authentication or RLS policy model. The accompanying bank, backup and account-administration protections must be deployed together with these migrations. Existing ordinary operational permissions remain in force. Live bank-provider credentials, tax filings, payments and payroll processing are separate integrations and are not activated by this package.
