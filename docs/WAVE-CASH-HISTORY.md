# NextTrade cash history and category mappings

Implemented on 23 November 2026 in `codex/wave-cash-history`, based on
`origin/main` at `e42f5ae5`. This extends the older Wave History foundation;
it does not replace its monthly accrual importer.

## Location and installation

1. Install `supabase/wave-history.sql` if the foundation is not already installed.
2. Apply the additive, transactional `supabase/wave-cash-history.sql` using the
   authorized database administrator. It is rerunnable. No public/anonymous
   access is granted. The Supabase CLI was unavailable on the build machine,
   so this follows the repository's existing named-SQL-file convention.
3. Deploy this commit through the normal integration/release process. No shared
   version badge or What's New file is changed by this isolated feature commit.
4. An authorized Wave History manager opens Accounting > Wave History >
   Cash history & mappings > Import CSV. Select the original NextTrade export,
   confirm its business currency and that all accounts are included, preview,
   then save the reconciled history.

Live SQL installation, production deployment, and the live import are separate
operations. Local tests do not prove that any of those operations has occurred.

## What is saved

- Private `wave_history.cash_imports`: original UTF-8 CSV, fingerprint, company,
  cash basis, source period, currency, totals, importer and timestamp.
- Private `wave_history.cash_entries`: every original ledger entry, its account
  description/category, date, debit, credit and original CSV record number.
- Private `wave_history.cash_mappings`: original account -> separate NextTrade
  Hub category and KTC internal reporting category, account type and revision.
- Private `wave_history.cash_mapping_history`: before/after mappings, actor and
  timestamp. Original source categories and source files are never overwritten.

The API uses the existing private Wave History access grants. Readers can read
and download source history; managers can import and map. Service-only RPCs also
check the manager grant for writes. No anonymous or ordinary direct Data API
access to these tables is allowed.

The supplied research export covers 2021-01-01 through 2026-06-01, not all of
November 2026. It contains 11,646 ledger entries in 73 account sections, with
equal debits and credits of 4,197,041,813 minor units. Currency must be confirmed
against Wave; a dollar sign alone is not an ISO currency code. The original CSV
and extracted research files are private local artifacts, not committed source.

## Reporting and duplicate protection

- Multi-year cash history stays separate from accrual history. Classified expense
  is debit minus credit; classified income is credit minus debit. Balance-sheet,
  clearing and unclassified accounts are not treated as expenses or revenue.
- The CSV supplies account names but not account types; types are explicitly
  classified, not inferred from transfer descriptions or signs.
- Exact re-import is a no-op. A different export overlapping an archived period
  in the same currency is rejected, not silently added or substituted. There is
  no source-replacement UI in this release.
- Duplicate account headings remain distinct by account number, description and
  occurrence. Wave does not supply stable transaction/account IDs in this file.
  Reordered duplicate headings in future exports require review before reusing
  a mapping; do not infer operational transaction identity from these keys.
- Category choices reuse the active `NEXTRADE_BOOKS` and KTC category catalogs.
  Changes require Save and create audit history; stale revisions are rejected.
- This release stores reusable research mappings. It does NOT overwrite existing
  NextTrade bank categories, update `company_category_map`, create bills, match
  ledger entries to bank transactions, or feed another expense into KTC P&L.
  Applying these mappings to existing operational transactions still requires a
  reviewed linkage step, preserving approved categories and existing bill links.
- KTC funding transfers and underlying bills must not both become expenses.
  A KTC reporting-category mapping is not an allocation or authorization to post.
  No tax treatment or KTC internal P&L calculation is changed here.
- Date filters and source coverage are shown. No imported source reads
  "Unavailable", not a fabricated zero. Imported but unclassified accounts are
  visibly counted and excluded from classified totals.

## Verification

Focused checks run against this implementation:

- Parser and existing accrual regression tests: 7 passed, including the complete
  private source export, multiline descriptions and source totals.
- In-memory PostgreSQL-compatible PGlite tests: 23 checks passed, including the
  complete export, twice-installed SQL, atomic rollback, overlap rejection,
  access restrictions, category validation and audited optimistic revisions.
- API tests: 19 checks passed using the real route with explicit auth/RPC test
  doubles, covering authorization, preview/save, fingerprint, source download
  and mappings. These are not live Supabase integration tests.
- Actual component in a browser fixture with simulated API responses: desktop
  and 390px mobile, mapping, drill-down, import controls, expense credit offset,
  no page overflow or browser errors. This is not a production login test.
- Full Next.js production build passed, including compilation, lint/type checks,
  generation of all 124 static pages and build tracing. Used the locked packages
  installed with `npm ci --ignore-scripts --no-audit --no-fund` and dummy public
  Supabase configuration, not production credentials. Existing metadata and
  Browserslist warnings remain outside this feature's scope.
- Built server started at `http://127.0.0.1:3090` with test-only configuration.
  Real unauthenticated cash-history request returned HTTP 401 with private,
  no-store headers and the sign-in error. Live authenticated import/reporting
  still requires database installation and the real deployment configuration.

Test commands (optional private source test uses `WAVE_CASH_TEST_CSV`):

```powershell
node --test __tests__/test-wave-cash-history.mjs __tests__/test-wave-history.mjs
# PGLITE_PATH points at an installed @electric-sql/pglite package.
node __tests__/test-wave-cash-history-sql.mjs
# SUCRASE_PATH points at an installed sucrase package.
node __tests__/test-wave-cash-history-route.cjs
```

## Coordination

Work was isolated from Claude's main checkout and unrelated worktrees. Ownership
and the final commit handoff are recorded in the shared warehouse
`CODEX_QA_FEEDBACK.md`; writing a handoff does not prove another session read it.
Integrate this commit without replacing unrelated changes. Do not import the
private CSV into git, expose service credentials, or apply SQL to production as
part of a frontend-only release without completing the installation checklist.
