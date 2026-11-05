# ClickBooks US — Production Deployment, Migration & Cutover Runbook

**Scope:** KTC U.S. Accounting only · **Prepared:** 2 November 2026

This runbook separates five events that must never be conflated: database code installation, frontend deployment, historical financial migration, parallel operation, and Wave write cutover.

## A. Present verified state

- Connected Supabase project already contains all 21 ClickBooks migrations listed in the full write-up.
- `KTC_US.posting_enabled = false`.
- `KTC_US.historical_data_ready = false`.
- Opening cutoff = null.
- Posted ClickBooks journals = 0.
- Reviewed live bank-ledger mappings = 0.
- Future-invoice posting default is not reviewed.
- Shadow runs = 0; cutover runs = 0.
- Cutover phase = `wave_primary`; shadow sync off; execution gate off.
- Wave U.S. writes/pushes remain enabled.
- Hub frontend is source-only, not deployed through this release.
- Protected dashboard/banking permission prerequisite is still absent in the inspected database.
- Full build has not passed in this authoring environment because npm registry DNS was unavailable.

## B. Merge/deploy checklist

1. Freeze the exact current production commit and current Vercel production deployment ID.
2. Back up Supabase and perform a restore test before financial migration.
3. Merge the focused ClickBooks changes into the current source tree. Do not replace the current tree with the reference ZIP.
4. Compare remote Supabase migration history to the release manifest. The existing project already has the 21 ClickBooks migrations; do not rerun them blindly.
5. Review/install the protected financial visibility prerequisite together with its matching application source. Test existing banking/backups/team administration after it.
6. Set server-only super-admin Auth UUID allowlist.
7. In a networked build environment run:

```sh
npm ci
node --test clickbooks/tests/read-handler.test.mjs clickbooks/tests/workbench.test.mjs clickbooks/tests/p58-handlers.test.mjs
node scripts/run-accounting-bank-regression.js
npm run build
```

Expected release gate: ClickBooks handlers all pass, existing required accounting/bank regression reaches 122/122, and Next.js build succeeds.

8. Deploy a protected preview with review-only flags enabled and all write/cutover/cron flags disabled.
9. Test all user permission combinations and existing U.S. Accounting workflows; verify Egypt/Treasury/Sales unchanged.

## C. Environment flags

Start with false unless explicitly moving to the corresponding phase:

```text
CLICKBOOKS_US_ENABLED=true
NEXT_PUBLIC_CLICKBOOKS_US_ENABLED=true
CLICKBOOKS_US_WORKBENCH_ENABLED=true
NEXT_PUBLIC_CLICKBOOKS_US_WORKBENCH_ENABLED=true
CLICKBOOKS_US_REPORTS_ENABLED=true
NEXT_PUBLIC_CLICKBOOKS_US_REPORTS_ENABLED=true
CLICKBOOKS_US_CUTOVER_ENABLED=true
NEXT_PUBLIC_CLICKBOOKS_US_CUTOVER_ENABLED=true
CLICKBOOKS_US_STAGE_WRITES_ENABLED=false
CLICKBOOKS_US_RULES_AUTO_STAGE_ENABLED=false
CLICKBOOKS_US_REPORT_SETTINGS_WRITES_ENABLED=false
CLICKBOOKS_US_SHADOW_SYNC_ENABLED=false
```

Server only:

```text
HUB_SUPER_ADMIN_AUTH_USER_IDS=<verified Supabase Auth UUID list>
CLICKBOOKS_US_SYSTEM_AUTH_USER_ID=<verified system/operator Auth UUID>
CRON_SECRET=<strong secret when/if cron jobs are activated>
```

Never put service keys, DB passwords, allowlists or cron secrets in `NEXT_PUBLIC_*` variables or source control.

## D. Historical migration procedure

1. Create a new migration snapshot at the agreed cutoff; do not reuse the stale audit-only run.
2. Review relevant ClickBooks account mappings with `clickbooks/deploy/review-account.psql`.
3. Review active provider-bank mappings with `clickbooks/deploy/review-bank-map.psql`.
4. Obtain independent accounting evidence: trial balance, bank statements, open AR/AP and accountant schedules.
5. Choose:
   - opening balance + detailed open AR/AP; or
   - supported transaction batches where complete source detail exists.
6. Save and validate manifest in the Migration workspace.
7. Review every validation exception; never insert a fake balancing account just to force equality.
8. Use trusted operator approval/commit scripts. Retain the approved hash and output.
9. Re-run preflight and independent reconciliation after commit.
10. If the migration is wrong and no dependent later entries exist, use the linked reversal script. Do not delete history.
11. Once independently reconciled, run `certify-history.psql` with the exact cutoff and evidence reference.

## E. Configure ongoing posting

1. Approve the future-invoice sales-income account with `review-posting-default.psql`.
2. Confirm every active Plaid/provider account is mapped to a reviewed ClickBooks bank account.
3. Review accounts required by rules and ongoing invoices.
4. Use `enable-parallel.psql` to set parallel phase and enable shadow posting; Wave remains writable.
5. Optionally review/run `merge-shadow-cron.mjs` and `merge-rules-cron.mjs`; inspect the `vercel.json` diff before deploy.
6. Verify authenticated cron routes and idempotent repeats.

## F. Parallel acceptance window

Use a rolling 7–31 day period ending on the current day. Before cutover:

- Recent shadow run must cover period end.
- No supported source invoices/payments/approved rule bank events remain unposted.
- No source event is blocked for review.
- Active bank mappings all reviewed.
- Posting default reviewed.
- Historical books certified.
- Trial balance and reports reconcile to independent evidence.
- Bank reconciliation matches external statements, not merely source movement totals.
- Wave remains operational during the parallel phase.

## G. Cutover

1. Stage cutover in the Hub with independent evidence.
2. Trusted operator runs `approve-cutover.psql`; retain approval hash.
3. Recheck source/ledger state and current-day readiness.
4. Trusted operator runs `execute-cutover.psql` with the exact approved hash.
5. Verify:
   - only U.S. Wave write/push flags disabled;
   - bank connection remains active;
   - ClickBooks phase = `clickbooks_primary`;
   - cutover execution gate automatically returns off;
   - no Egypt/Treasury/Sales state changed.
6. Continue monitoring bank feeds and ClickBooks posting.

## H. Rollback

If accounting authority must return to Wave, run `rollback-cutover.psql` for the exact executed run. It restores the Wave write flags captured at execution, turns shadow sync off and changes phase to `rollback_review`.

It deliberately does not delete ClickBooks journals or erase audit evidence. Subsequent financial reconciliation must determine the correct accounting authority and duplicate-event handling.

## I. Stop conditions

Stop deployment/migration/cutover for any of the following:

- Wrong Supabase/Vercel target.
- Missing protected identity/visibility prerequisite.
- Full build or required regression failure.
- Unverified owner/operator Auth identity.
- Unreviewed account or bank mapping used by a financial event.
- Stale source snapshot/approval fingerprint.
- Unexplained trial-balance or bank difference.
- Missing historical evidence.
- Source event outside supported U.S. accounting types.
- Bank data visible to a user without Banking Information permission.
- Any unexpected Egypt/Treasury/Sales change.

## J. Evidence to retain for every release/cutover

- Production source commit and artifact SHA-256.
- Vercel project/team and deployment ID.
- Supabase migration ledger before/after.
- Backup and restore-test reference.
- Auth UUIDs/capability grants (without secrets).
- Cutoff and migration strategy.
- Independent trial balance and AR/AP schedules.
- Bank reconciliation evidence.
- Migration run/hash and cutover run/hash.
- Test output and browser acceptance evidence.
- Wave flags before/after and rollback reference.
