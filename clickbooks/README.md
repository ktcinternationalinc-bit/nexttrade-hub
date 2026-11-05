# ClickBooks US — priorities 1 through 4 review release

**Latest:** P3/P4 v1, 2 November 2026. Database foundation and workflow SQL are installed. The new Hub source is not deployed. Financial posting, migration execution and historical readiness remain disabled. No business rules or new cron schedule are active.

Start with **docs/CLAUDE_HANDOFF_P34.md** and **docs/DEPLOYMENT_RUNBOOK_P34.md**. The release manifest records the exact installed SQL versions, code and QA status. A retained snapshot is review evidence, not a completed financial migration.

**US Accounting only.** Preserve the existing Wave/bank workflows and keep Egyptian Sales/Treasury/invoices excluded. Merge the isolated patch into the current repository; never overwrite newer production with the reference full-source ZIP.

## Latest tools and evidence
- `p34/05..12` — ordered migration/rule workflow SQL; already installed in the connected project, not rerun-safe as a bundle.
- `deploy/` — preflight, activation flags, operator scripts, opt-in proposal cron helper, Accounting-tab patch.
- `tests/p34_qa.sql` — 53 rollback-only database assertions (empty test ledger required).
- `tests/p34_transaction_validation.sql` — five rollback-only source-backed validation checks.
- `tests/workbench.test.mjs` plus `tests/read-handler.test.mjs` — 62 passing handler tests.
- `qa/p34/` — actual test logs and recorded verification results; full build/browser release gates remain open.

## Prior foundation reference


**Status:** isolated database core installed; account mappings loaded; live posting disabled; source-only read UI prepared, not deployed. No historical financial transactions migrated.

Read `docs/CLAUDE_HANDOFF.md` before deployment. The existing hub, Wave routes, bank feeds, Treasury, Sales and Egyptian workflows are not replaced.

## Review package
- `sql/01_us_core.sql` — private US schema, tables and ledger functions.
- `sql/02_seed_us_chart.sql` — US-only proposed chart and source mappings.
- `sql/03_source_audit.sql` — scoped source audit and saved evidence.
- `sql/04_scope_and_read_facade.sql` — scope guards and service-only read RPC.
- `tests/ledger_qa.sql` — rollback-only trusted-operator test transaction.
- `tests/read-handler.test.mjs` — dependency-free server handler tests.
- `qa/verified-results.json` — recorded database and QA outcomes.
- `qa/AccountingTab.patch` — the only changed pre-existing source file.

The SQL is a review/reproduction bundle, NOT an instruction to rerun already-applied migrations against the live project. Files 01, 03 and 04 are not rerun-safe. File 02 is idempotent. Do not run the QA script with posting enabled or against changed fixtures without review.

## Local tests
```sh
node --test clickbooks/tests/read-handler.test.mjs
node scripts/run-accounting-bank-regression.js
npm ci
npm run build
```

The first command passed 15 tests. The legacy runner passed 121/122 required cases; one test was blocked by a missing dependency, before and after this change. Dependency installation and the full Next.js build were not completed in the authoring environment.

Use the existing repository lockfile. Do not change dependency versions to conceal test failures. Do not deploy this older full-source snapshot over newer production changes; merge the isolated patch into the current repository.
