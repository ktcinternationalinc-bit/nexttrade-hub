# ClickBooks US — deployment, migration and activation runbook

**Release:** P3/P4 v1 · **Prepared:** 2 November 2026 · **Scope:** KTC_US / USD / U.S. Accounting only.

This is an executable operator runbook, not authorization to post financial entries. Source deployment, review-tool activation, historical migration and accounting cutover are four different events. Record each independently. No Egyptian Sales, Treasury, invoices or other subsidiary records are part of this release.

## 1. What has actually happened

| Layer | Verified release state | Remaining activation |
|---|---|---|
| P1/P2 database | Four prior migrations installed; 176 proposed accounts; 1,880 Wave source-ID mappings | Accountant review of mappings and balances |
| P3/P4 database | Eight new migrations installed in the connected Supabase project | Do not replay them against this project |
| Review evidence | One U.S. audit snapshot retained; no financial manifest or approval | Select the actual cutover date and migration strategy |
| Financial ledger | Zero journals; posting disabled; history not certified | Approved/reconciled import and separate ongoing-posting integration |
| Rules | Engine and storage installed; no business rules enabled or proposals retained | Reviewed rules, authorized users and optional proposal-only scheduler |
| Hub screens/API | Implemented in the source package | Merge into the current repository; build, test and deploy |
| Identity/permissions | Required protected visibility migration still absent at inspection | Review and deploy its matching SQL and application changes together |
| Vercel | Project inspection returned team authorization 403 | Approve the connected app for the existing team |

**Connected project:** `rmwbcfulncgfandhlzvz`. **Existing Vercel project:** `prj_0c2jW5UkaWvGWZvXE8JapcfaQqll`, team `team_156nxvQgKQo0dxLKtLHgirD6`.

**Hard source binding:** `QnVzaW5lc3M6NWRkNzI3MDctOTExNC00NjQwLTg4MGQtMjYzNmI3YzM4YTdk` (KTC INTERNATIONAL ENTERPRISES LLC). A currency, display name or legacy `business_id` alone is not a company boundary.

The retained review run is `c5c27993-d696-4fbf-9ae5-360301df9844`, cutoff 2026-11-02, strategy `opening_balance`, state `staged`. This date is an audit reference, **not an approved cutover date**. Its actor is null because it was a system audit, not a human approval.

## 2. Release-control record

For each deployment retain: source commit, artifact SHA-256, target project/team, migration ledger before/after, backup/restore evidence, authorized operator, selected cutoff, independent trial balance and AR/AP evidence, approved run/hash, tests, preview URL, production deployment ID, permission tests and rollback reference. Never store service keys, database passwords, bank credentials or raw tokens in this record.

Use `release-manifest.json`, `qa/p34/verified-results.json`, `deploy/preflight.sql` and this runbook as the starting record. A file hash verifies a supplied file, not that it is deployed. A successful build is not a completed historical migration.

## 3. Source merge and SQL order

1. Obtain the **current production repository and deployment commit**. This package is based on the previously supplied v55.83-OW snapshot with the P1/P2 patch. Do not overwrite newer work with the full ZIP.
2. Review the focused delta. The only pre-existing application file changed by P3/P4 is `src/components/AccountingTab.jsx`; `deploy/accounting-tab-p34.patch` shows the incremental integration. New workflow components, routes and libraries are listed in the manifest. Merge the required P1/P2 source as well if it is not already present.
3. Preserve the current deployment as the rollback target. Take a database backup and **test restore** before any financial import. No backup or restore test was performed in this session.
4. Run the read-only preflight in the intended database. Compare the book binding and migration names to the release register. Stop if they differ.
5. In this connected project, the P1/P2 and P3/P4 migrations listed below are already installed. **Do not paste/replay all SQL blindly.** Reconcile the repository's migration history with the remote migration ledger through the team's normal Supabase workflow before a subsequent push.
6. For a fresh compatible staging database only: restore the required Hub schema/data with appropriately restricted access, install the P1/P2 reproduction bundle in documented order, then apply P3/P4 files **05 through 12 in order**, including the corrective patches. Do not assume a blank Supabase project has the required public accounting tables, auth records or verified U.S. binding.

| Remote version | Recorded migration | Reproduction file |
|---|---|---|
| 20261102103809 | clickbooks_us_p34_workflow_storage_v1 | p34/05_workflow_storage.sql |
| 20261102103836 | clickbooks_us_p34_source_snapshot_v1 | p34/06_source_snapshot.sql |
| 20261102104015 | clickbooks_us_p34_rules_engine_v1 | p34/07_rules_engine.sql |
| 20261102104342 | clickbooks_us_p34_migration_validation_v1 | p34/08_migration_validation.sql |
| 20261102104359 | clickbooks_us_p34_migration_execution_v1 | p34/09_migration_execution.sql |
| 20261102104612 | clickbooks_us_p34_workbench_facades_v1 | p34/10_workbench_facades.sql |
| 20261102105249 | clickbooks_us_p34_validation_alias_fix_v1 | p34/11_validation_alias_fix.sql |
| 20261102105553 | clickbooks_us_p34_source_and_rule_hardening_v1 | p34/12_source_and_rule_hardening.sql |

Prior database migration versions: `20261102093306`, `20261102093330`, `20261102093537`, `20261102093732`. The older `sql/01..04` files are a reproduction bundle, not a claim that every file maps one-for-one to a remote migration. Keep the real remote IDs; generate future migration files using the actual CLI/migration tooling rather than inventing history entries.

SQL roles: all new internal tables/functions are private, fixed U.S. scope, row-level security enabled, no browser access. Service-only public facades expose explicitly limited operations. **Do not grant blanket schema/table/function access to make a screen work.**

## 4. Identity and permission prerequisite — launch blocker

The matching prior source contains `sql/bank-balance-visibility.sql`, `src/lib/bank-visibility.js` and protected permission routes. The live check did not find `public.financial_visibility_permissions` or `public.bank_visibility_profile_for_identity(uuid)`.

Have the owner/developer review that SQL **with its matching application source**. It changes privileges on existing banking/backup objects as well as adding permission functions; it is not a harmless ClickBooks-only table creation. Test existing banking, assignment, team administration and backups before applying it to production. It was deliberately not executed here.

Resolve the owner's actual active **Supabase Auth UUID**, not a guessed `public.users` ID or editable role string. Configure server-only `HUB_SUPER_ADMIN_AUTH_USER_IDS`. Verify the protected identity map resolves each person once. Ambiguous/inactive/banned mappings must fail closed. Do not automatically carry forward legacy dashboard/banking grants.

A verified super admin has both workspaces. A non-super user needs:
- Rules: explicit `can_manage_rules`; no bank-balance or full-dashboard grant is needed merely to review individual transaction suggestions.
- Migration: explicit `can_manage_migration` **and** protected full-dashboard **and** bank-balance grants, because a full snapshot/reconciliation reveals financial totals.

Use the trusted-operator `deploy/operator-grant.psql` for ClickBooks grants. The same script with both booleans false revokes them. Financial visibility grants remain separate in the existing protected system. No browser endpoint can approve/commit migrations or change these operator grants in this release.

## 5. Build and preview deployment

Configure a secure libpq service named `ktc_us` for operator commands; keep its credentials outside the repository with restricted file permissions. The commands below use `service=ktc_us` instead of embedding passwords in shell arguments. The remote SQL editor is an alternative for read-only preflight; the supplied `.psql` files require psql's variable handling and must not be pasted unmodified into a SQL editor.

From the current merged repository:

```sh
npm ci
node --test clickbooks/tests/read-handler.test.mjs clickbooks/tests/workbench.test.mjs
node scripts/run-accounting-bank-regression.js
npm run build
psql "service=ktc_us" -X -v ON_ERROR_STOP=1 -f clickbooks/deploy/preflight.sql
```

Use the existing package lock. Do not upgrade dependencies or suppress a failing test just to claim success. The authoring environment passed 62 handler tests but lacked installed Next.js/Supabase dependencies; the full build was blocked and one of 122 required legacy tests could not run. These are release gates, not optional warnings.

Start with all flags in `deploy/environment.example` false. Configure existing Supabase settings through the hosting secret store. Never expose a service key, owner allowlist or `CRON_SECRET` through a `NEXT_PUBLIC_` variable.

After identity and permissions work in a protected preview, enable the following in that preview and rebuild/deploy:

```text
CLICKBOOKS_US_ENABLED=true
NEXT_PUBLIC_CLICKBOOKS_US_ENABLED=true
CLICKBOOKS_US_WORKBENCH_ENABLED=true
NEXT_PUBLIC_CLICKBOOKS_US_WORKBENCH_ENABLED=true
CLICKBOOKS_US_STAGE_WRITES_ENABLED=false
CLICKBOOKS_US_RULES_AUTO_STAGE_ENABLED=false
```

This allows inspection/preview/validation, not saving new staging work. Browser-visible flags are built into the frontend; changing their deployment settings needs a new build. After tests, set `CLICKBOOKS_US_STAGE_WRITES_ENABLED=true` to allow snapshots, manifests, rule definitions and proposal decisions. **Database posting/execution flags remain false.**

In U.S. Accounting, the new workflow tab contains Migration and Rules. The existing core ClickBooks view remains separate. No entity selector is offered in these fixed-U.S. views.

## 6. Browser acceptance gate

Test signed-in super admin; rules-only operator without bank-balance access; dashboard-only user; banking-only user; unauthorized employee; signed-out/expired session; revoked permissions and a changed user in the same browser. Verify URLs and exports as well as visible controls.

Confirm unauthorized API requests return 401/403 and no data, flags-off requests fail closed, forged user/business IDs are rejected, cross-site POSTs fail, and rule views never expose bank balances or sensitive ledger accounts. Confirm account choices needing review are blocked from classification approval. Validate the entire existing U.S. accounting/bank workflow and confirm Egyptian workflows are unchanged. These signed-in browser checks have **not** been run in production.

## 7. Migration preparation — independent evidence required

Two supported strategies:

**Opening balance:** one balanced entry on a reviewed cutoff date in an empty ClickBooks ledger, supported by an independent trial balance and detailed open receivables/payables. Subsequent transactions must be later than the cutoff. This is usually the more practical route when complete historic payment/journal detail is unavailable, but the owner/accountant must choose it.

**Transaction batch:** reviewed, bounded source-linked journal plans for supported approved U.S. invoices, invoice payments and standalone reviewed bank transactions. Up to 200 journals per manifest. It is not a general importer for all possible Wave GL entries, foreign currency, credit notes, fixed assets or historical bills. Completeness of all books remains a separate sign-off.

The current audit finds 1,167 USD invoices whose paid amount differs from available local payment detail. The earlier 1,144 figure counted only paid invoices with **no** local payment rows; these are different checks, not evidence that data was changed. Do not invent payments from paid totals. Hold the three non-USD invoices, one missing-item invoice, seven pending bank rows and incomplete/ambiguous mappings.

Choose the final cutoff. Obtain source statements/exports, independently reconcile the trial balance, verify every relevant account and bank mapping and record evidence. Current invoice paid/balance fields are **not** historical as-of balances. `review-account.psql` and `review-bank-map.psql` record explicit operator decisions; they do not infer tax treatment, ownership or account mappings.

In the Migration workspace create a new snapshot; select its run; download protected evidence if needed. Prepare the manifest with:

- `plans`: source kind/ID, ISO date, description and balanced ledger lines; debit/credit amounts are **integer-cent strings**, not floats or dollars.
- `expectedBalances`: independently sourced post-batch net-debit cents by account; a missing account implies zero and will fail if the resulting balance is nonzero.
- `openingSubledger`: for opening strategy, detailed receivable/payable refs, control-account IDs and positive amounts; totals must reconcile to control accounts. Receivable refs must identify valid U.S. USD invoices. Payable refs require independent supporting evidence.
- `evidence`: a protected document/reconciliation reference, not a claim generated from the manifest itself.

The workspace can save and validate this plan. It cannot post it. If source records, account mappings, the chart, ledger or period locks change, refresh/restage and reapprove rather than bypassing the stale-snapshot check. A suggested bank category does not automatically become a journal plan in this release.

## 8. Controlled financial import — separate owner decision

Before using the following scripts: restore-tested backup, correct target/identity, reviewed accounts, independent evidence, validated manifest, agreed cutoff, no parallel posting, and an owner-approved change window. Pause only the relevant U.S. writers for a stable cutover snapshot when necessary; do not pause or change Egypt as a side effect.

```sh
psql "service=ktc_us" -X -v ON_ERROR_STOP=1 \
  -v run_uuid=REVIEWED_RUN_UUID -v revision=REVIEWED_REVISION \
  -v actor_uuid=VERIFIED_OWNER_AUTH_UUID -f clickbooks/deploy/approve-run.psql

# Review and retain the returned approval hash before this financial-write step.
psql "service=ktc_us" -X -v ON_ERROR_STOP=1 \
  -v run_uuid=APPROVED_RUN_UUID -v approval_hash=APPROVED_HASH \
  -v actor_uuid=VERIFIED_OWNER_AUTH_UUID -f clickbooks/deploy/commit-run.psql
```

Replace every symbolic value; none is a usable default. `commit-run.psql` opens a repeatable-read transaction, locks the book, checks the approval/source fingerprint, temporarily enables the two import gates, posts atomically and turns both gates **off** before commit. A failure rolls back the batch and gate changes. No such real-data execution was performed in this release.

Afterwards run preflight, compare every trial-balance account to independent evidence, inspect sample invoice/payment/bank traces, verify AR/AP detail, zero duplicate event postings, permissions and untouched source digests. Retain signed evidence. This batch does not set `historical_data_ready=true`, enable ongoing accounting posting, stop Wave or declare reports tax-ready. Those require their own integration and reconciliation gate.

## 9. Rules activation and optional automation

Create rules disabled initially. Conditions support direction, literal description/merchant, an optional source account, min/max integer cents and effective dates. Advanced definitions support percentage splits totaling 10,000 basis points and tax-review tags. Preview before saving/enabling. Lower priority numbers win; equal-priority matches are conflicts, never arbitrary winners.

Stage enabled-rule suggestions and inspect them. Reviewed, classified, split, pending, non-USD and invoice-linked transactions are protected. Approve only after target accounts are reviewed. Approval records a ClickBooks classification proposal; **it does not change Wave, the existing bank transaction, invoice payment, tax return or general ledger**. Transfer and invoice-match actions create review flags, not automatic movement of money or payment matching.

For automatic proposal staging only, first verify that the hosting plan supports the chosen schedule. Configure a cryptographically random server-only `CRON_SECRET` of at least 32 characters. Review and run locally:

```sh
node clickbooks/deploy/merge-rules-cron.mjs --enable-proposals-only
```

It preserves existing cron entries, saves a local backup and adds the rules-job endpoint every 15 minutes. Review the diff and explicitly deploy. Set `CLICKBOOKS_US_RULES_AUTO_STAGE_ENABLED=true` only after route/auth tests. Verify a successful scheduled run and idempotent repeat. This script has **not** been run, the hosting schedule is unchanged, and no new automation is active. It schedules proposal generation, not a new bank feed or journal posting.

## 10. Rollback and stop conditions

For a UI problem: disable workbench/stage/auto-stage flags, disable only the new rules-job schedule if installed, restore the known-good frontend deployment and retain private schema/evidence. Do not remove migration history or drop ledger tables as a rollback shortcut.

For an imported batch: an authorized operator may use `reverse-run.psql` with the exact run, reviewed reversal date and actor. It creates linked reversing journals and relocks posting. If later independent postings exist it refuses automatic reversal; unwind dependencies under accountant control. An opening cutoff remains recorded after reversal; recovery/reimport must be reviewed rather than clearing it casually.

Stop for wrong project/scope, missing permission prerequisites, failed build/regressions, stale evidence, unexplained balances, missing history, unreviewed account ownership, ambiguous identity, bank-balance exposure or unsupported source types. No database grant, flag override or fake balancing amount is an acceptable workaround.

## 11. QA rerun and operational limits

`tests/p34_qa.sql` passed 53 database assertions; `tests/p34_transaction_validation.sql` passed five source-backed validation checks. Both are rollback-only private-fixture scripts. The main suite requires an empty financial ledger and is intended for a controlled test environment, **not routine execution after cutover**. No real source records are modified. Test-generated approval/entry amounts are synthetic and must never be reused as migration evidence.

62 handler tests passed (47 new and 15 prior). JSX syntax transpilation passed; this is not an application build or signed-in browser test. The legacy required regression remains 121/122 because `test-v55-83-is-unmatch-and-plaid-scope.js` lacks its Supabase JS dependency in this environment. Full build was blocked by `next: not found`.

The scoped security check found zero ClickBooks tables without RLS, zero browser-callable ClickBooks functions and zero missing fixed search paths. Supabase lists private RLS-with-no-policy tables as informational; this is deliberate denial behind service-only facades, not permission to add permissive policies. Existing unrelated public-schema security findings remain outside this change. References: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy and https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public.

Not delivered as live capability: complete Wave payment/GL-history retrieval; full AP/credit-note/FX migration; ongoing automatic journal posting; auto-application of rule proposals into financial records; complete P&L/tax-report suite; tax filing/payments; production browser validation; Wave cutover. These are explicit remaining gates, not hidden work behind a “ready” label.
