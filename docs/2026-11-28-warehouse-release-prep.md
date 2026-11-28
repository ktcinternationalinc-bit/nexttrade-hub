# Warehouse release preparation

## Receipt 1325

Applied after the November 28 approval. The correction changed `scan_in_inventories.id = 1325` from `1984-11-06 03:00:53` to `2024-10-11 03:00:53`. Independent production readback confirmed the new value, preserved `updated_at`, and found exactly one row, containing the original timestamp, in `zz_fix1325_before_20261128_approved`.

The reviewed program is `release-management/deploy/receipt-1325-correction.php`. After approval, create a unique InnoDB backup with `createReceipt1325Backup` and call `correctReceipt1325` with the same backup name. The program locks the receipt, checks the exact original timestamp, saves its previous values and updates that row alone. It verifies the backup and both timestamps before committing. The exact program passed on connection-local fix-staging fixtures, including preserved unrelated data, a failed verification that rolled back, and a refused retry. The deployed worker has no executor for this manual correction.

## BUG-002 shipped-date guard

Candidate `4471602b4a84fb6bdc3ee4eaa20fcaf072c22069` is on local branch `codex/warehouse-bug-002-candidate` in `.codex-warehouse-bug-002-prep`. It applies the six application-file changes from `f9d89d4` to the production baseline. The three copied source files matched their production hashes and preserve the Closed payment workflow. The candidate returns a validation message for malformed Scan Out dates before that handler starts a transaction.

The installed fix-staging date and checklist services passed 14 synthetic PHP checks without a database connection. The date cases covered future, unreadable, valid, and confirmable dates. Exercise the exact reconciled package in the signed-in date editor, both order-edit screens, Shipping, Reopen, and Scan Out.

## Warehouse look and inventory charts

Local candidate `8909f8c65d8bc93dcab93532ac3b088af4a7273c` combines the skin and chart work with the follow-up history and badge corrections on top of the reconciled shipped-date candidate. It labels the charts as all-warehouse historical movements and starts month ranges at the first of the month. The candidate excludes the intervening customer reminder migration. Verify the exact production baselines and the chart's signed-in results, including the corrected receipt date and a valid older receipt.

## Order checklist, ACID and the Hub feed

Local candidate `052bd5618a6ac07ad276ca7b3d6e5e3d67d87290` preserves the live Closed payments workflow and read-only endpoints. It scopes new checklist field writes without replacing the live model. It adds `shipping_doc_type`, `order_payment_type`, `load_time_known`, and the order-history `note` column. Production already has `load_date` as `DATETIME`, and the new migration leaves that type in place. The live feed can read newly added fields without replacing the controller. The close-order write endpoint is outside this package. Test Egypt, Kenya, other and blank destinations, required document fields, known and unknown load times, and feed continuity after rehearsing the three migrations.

## Order Queue Rolls / Not rolls

Local candidate `3f98347581aead1705abd3379ec5ab4be1e06593` applies the Rolls / Not rolls changes after the checklist candidate and passed 52 reference checks. Production has zero duplicate open reservation groups. The `form` and `not_rolls` columns are absent and none of the three Rolls / Not rolls migrations was recorded. Finish the signed-in reservation, legacy split, release and picking PDF checks. Rehearse the migrations and restore compatibility on a disposable restored copy. Generate install version files on the verified target so the footer describes what is actually installed there. Its migrations require a supported execution plan before Change Schedule can queue it.
