# Warehouse release preparation

See the [production migration plans](2026-11-28-warehouse-data-migration-plans.md) for the latest BUG-002 production checks, ACID and Rolls / Not rolls staging evidence, file fingerprints, and recovery requirements.

## Receipt 1325

Applied after the November 28 approval. The correction changed `scan_in_inventories.id = 1325` from `1984-11-06 03:00:53` to `2024-10-11 03:00:53`. Independent production readback confirmed the new value, preserved `updated_at`, and found exactly one row, containing the original timestamp, in `zz_fix1325_before_20261128_approved`.

The reviewed program is `release-management/deploy/receipt-1325-correction.php`. After approval, create a unique InnoDB backup with `createReceipt1325Backup` and call `correctReceipt1325` with the same backup name. The program locks the receipt, checks the exact original timestamp, saves its previous values and updates that row alone. It verifies the backup and both timestamps before committing. The exact program passed on connection-local fix-staging fixtures, including preserved unrelated data, a failed verification that rolled back, and a refused retry. The deployed worker has no executor for this manual correction.

## BUG-002 shipped-date guard

Candidate `4471602b4a84fb6bdc3ee4eaa20fcaf072c22069` is on local branch `codex/warehouse-bug-002-candidate` in `.codex-warehouse-bug-002-prep`. It applies the six application-file changes from `f9d89d4` to the production baseline. The three copied source files matched their production hashes and preserve the Closed payment workflow. The candidate returns a validation message for malformed Scan Out dates before that handler starts a transaction.

The exact six files were fingerprint-checked in an isolated fix-staging folder. The PHP fixtures invoked the actual quick editor, Shipped step and Scan Out entry points. Valid dates saved, the Shipped step kept an existing date or accepted a supplied valid date, and future, unreadable, blank and unusable fallback dates were rejected. Both order forms compiled with the Closed payment section preserved.

## Warehouse look and inventory charts

Candidate `8909f8c65d8bc93dcab93532ac3b088af4a7273c` combines the skin and chart work with the follow-up history and badge corrections on top of the reconciled shipped-date candidate. Its fingerprint-checked chart handler ran on isolated fix staging and included older February receipts, included only shipped outbound weight, and counted pallets once when several grades matched. The Blade templates compiled. The modal labels the charts as all-warehouse historical movements. Deploy after the shipped-date guard because both change the order controller.

## Order checklist, ACID and the Hub feed

Local candidate `052bd5618a6ac07ad276ca7b3d6e5e3d67d87290` preserves the live Closed payments workflow and read-only endpoints. It scopes new checklist field writes without replacing the live model. It adds `shipping_doc_type`, `order_payment_type`, `load_time_known`, and the order-history `note` column. Production already has `load_date` as `DATETIME`, and the new migration leaves that type in place. The live feed can read newly added fields without replacing the controller. The close-order write endpoint is outside this package. Test Egypt, Kenya, other and blank destinations, required document fields, known and unknown load times, and feed continuity after rehearsing the three migrations.

## Order Queue Rolls / Not rolls

Local candidate `a1d74b708315b76e4129866d104f70f03470735a` applies Rolls / Not rolls after ACID and passed 52 reference checks. The revised migrations preserve history even after a partial run. The isolated workflow checks and remaining authenticated checks are listed in the migration plan. Its migrations require a supported executor before Change Schedule can queue them.

## Approval evidence for code packages

The approved disposable fixture received 51 changed files across the four candidates. SHA-256 checks matched the committed bytes. The staging PHP fixtures exercised the date and chart handlers using synthetic rows, and compiled and parsed the candidate Blade templates. A separate MariaDB rehearsal ran the six checklist and Rolls migrations twice on connection-local temporary tables. The existing load timestamp, reservation weights, timestamps, and release history matched the test baseline. This is fixture evidence. The two data releases still need a reviewed production execution plan and signed-in workflow checks.

The production file fingerprint precheck matched all 15 expected file states. The office worker's Git checkout contains both exact code commits. The two code manifests use the checked production baseline for unchanged files and the shipped-date build's installed controller fingerprint for the chart prerequisite. Both releases use code backups and leave the database schema in place.
