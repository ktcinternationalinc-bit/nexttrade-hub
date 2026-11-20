# WC Release - 20 Nov 2026

Owner: Codex, explicitly authorized by Max to commit and deploy while Claude rests.
Base: f6a4662ec1e0e046898282239b06a5042694db28, independently verified as both GitHub main and production.
Previous production: dpl_CdbKxFF9oRavKsc7jeMuQgvyzLNR (WB).

## Included

- All Transactions partial/whole-word search, highlighted full descriptions.
- Import dedupe no longer lets pending/archived copies suppress final posted identities.
- Pending settlement checks historic stored bank replacement references and exposes partial failures.
- Super-admin read-only pending preview and explicitly confirmed, guarded repair endpoint.
- Additive WC SQL keeps existing payment references on a bank-confirmed same-money replacement; no new payment created.

## Database Status

The application release does NOT install SQL or manually repair production bank records.
Install sql/v55-83-WC-pending-identity.sql separately after approval, following SO and TU.
Missing WC function falls back ONLY to installed TU settlement, retaining its existing safeguards.
The new linked-record repair requires WC SQL; missing installation produces an actionable warning.
Review actual candidates before confirming any manual repair. No age/amount/name-only posting guesses.
Once repairs have run, retain the WC tombstone compatibility function even if reverting application code.

## Verification

- Production build passed: gfQMxLDz69L_NOxc4c7XG (dummy environment, no production credentials).
- WC core/search 31, actual sync route 7, actual repair route/helper 16, isolated PostgreSQL 23, legacy TU 17 checks passed.
- Full regression: 244/263 passed, exact same 19 failing tests as unchanged WB (241/260). No new failing tests; suite is not globally green.
- Browser tests passed for actual All Transactions search and actual repair component -> API -> isolated PostgreSQL, desktop/mobile. Authentication is a test fixture, not live sign-in.
- No live data repair or verification of Max's screenshot records claimed.

## Coordination

Shared warehouse CODEX_QA_FEEDBACK.md and shared VERSION-LETTERS.md contain the release-in-progress notice.
Claude worktrees are not modified. Final commit/deployment receipt will be appended to both shared files.
Claude must fetch main and preserve WC before integrating future work; no force pushes or whole-file replacement of overlapping changes.
No Claude acknowledgement is claimed while those sessions are asleep.

## Next

Split deposits/returned checks is priority two, separate from WC. RTM/NextTrade consistency is priority three.
