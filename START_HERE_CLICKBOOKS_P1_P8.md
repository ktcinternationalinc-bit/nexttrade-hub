# START HERE — ClickBooks US P1–P8 Review Package

This package is a **review and implementation handoff** for ClickBooks, the KTC Hub's U.S. Accounting system. It is not an instruction to blindly deploy or replay SQL.

## Read in this order

1. `ClickBooks_US_Full_System_Writeup_2026-11-02.md`
2. `ClickBooks_US_Production_Deployment_Runbook_2026-11-02.md`
3. `DATABASE_MIGRATION_LEDGER.json`
4. `QA_SUMMARY.json`
5. `LIVE_STATE_SNAPSHOT.json`
6. The full clean source ZIP and its `clickbooks/` folder.

## Critical facts

- Scope is U.S. Accounting only; Egypt/Treasury/Sales are excluded.
- 21 ClickBooks migrations are already installed in Supabase project `rmwbcfulncgfandhlzvz`.
- Frontend is not deployed by this package.
- Zero real ClickBooks journals have been posted.
- Historical books are not certified; posting remains off.
- Wave remains the U.S. write authority.
- Bank feeds were not disabled.
- The current source package must be merged into the latest production repository, not overwrite it.
- The protected dashboard/banking permission prerequisite remains absent in the inspected database and is a launch blocker.
- Full Next.js build still needs a networked environment; this environment could not reach npm registry.

## Review priority

Challenge U.S. scope isolation, opening-balance strategy, preservation of invoice/payment/bank relationships, deposit splits, idempotency/reversals, shadow posting, bank mappings, report redaction, permissions, cutover/rollback, and deployment migration history.

Do not treat a balanced synthetic QA fixture as proof that the real books are reconciled. Real cutover requires independent accounting evidence and a 7–31 day parallel window.
