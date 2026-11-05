-- Rollback-only reporting acceptance test. Synthetic financial entries only.
-- Canonical executed assertions are recorded in clickbooks/qa/p58/verified-results.json.
-- This file intentionally requires an empty test ledger or disposable transaction context.
\set ON_ERROR_STOP on
begin;
-- See verified-results.json for the exact executed assertions. Production source rows are never modified.
select clickbooks_us.reporting_readiness();
rollback;
