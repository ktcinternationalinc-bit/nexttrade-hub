# Warehouse release preparation

## Receipt 1325

Ready for explicit manual approval. The production read-only check found `scan_in_inventories.id = 1325` at `1984-11-06 03:00:53`. Fix staging returned `2024-10-11 03:00:53`. The production table uses InnoDB and reported zero update triggers. The correction preserves the time of day.

The reviewed program is `release-management/deploy/receipt-1325-correction.php`. After approval, create a unique InnoDB backup with `createReceipt1325Backup` and call `correctReceipt1325` with the same backup name. The program locks the receipt, checks the exact original timestamp, saves its previous values and updates that row alone. It verifies the backup and both timestamps before committing. The exact program passed on connection-local fix-staging fixtures, including preserved unrelated data, a failed verification that rolled back, and a refused retry. The deployed worker has no executor for this manual correction.

## BUG-002 shipped-date guard

Candidate `dd23fce9d852953caa99ea9883da25db0a3ead64` is on local branch `codex/warehouse-bug-002-candidate` in `.codex-warehouse-bug-002-prep`. It applies the six application-file changes from `f9d89d4` on the recorded live shipping-feed build `09d21b12`, keeping the live Order Queue release behavior. The candidate also returns a validation message for malformed Scan Out dates before that handler starts a transaction.

The installed fix-staging date and checklist services passed 14 synthetic PHP checks without a database connection. The date cases covered future, unreadable, valid, and confirmable dates. The candidate's three PHP files passed PHP 8.2 syntax checks. Three of its six files have unexpected production fingerprints: `OrderController.php`, `edit.blade.php`, and `edit_OrderUSA.blade.php`. Reconcile the three live files before package review. Then exercise the exact package in the signed-in date editor, both order-edit screens, Shipping, Reopen, and Scan Out.

## Warehouse look and inventory charts

Local candidate `13154ac296caf0edd79a940425275fb3364521d6` combines the skin and chart work with the follow-up history and badge corrections. It labels the charts as all-warehouse historical movements and starts month ranges at the first of the month. The candidate excludes the intervening customer reminder migration. It shares the live order-controller discrepancy. Verify the exact production baselines and the chart's signed-in results, with a valid old receipt retained and receipt 1325 handled through its separate data release.

## Order checklist, ACID and the Hub feed

Start with `d24ceba` and its checklist follow-up `48467bb`. The production feed fingerprints match `905ef4b8` and `09d21b12`. Production already has `load_date` as `DATETIME` and lacks `shipping_doc_type`, `order_payment_type`, `load_time_known`, and the order-history `note` column. None of the three checklist migrations was recorded. The reviewed migration plan can keep the existing `DATETIME` column and add the missing fields. Preserve the live endpoints and the opt-in close-order write path. Test Egypt, Kenya, other and blank destinations, required document fields, known and unknown load times, and feed continuity. The order controller and forms overlap BUG-002 and must be reconciled with the live files.

## Order Queue Rolls / Not rolls

The exact staging branch at `b5bdd63` passed 53 local reference checks, including the file fingerprints and migrations. Production has the existing reservation release columns and zero duplicate open reservation groups. The `form` and `not_rolls` columns are absent and none of the three Rolls / Not rolls migrations was recorded. Finish the signed-in reservation, legacy split, release and picking PDF checks. Rehearse the migrations and restore compatibility on a disposable restored copy. This change overlaps the chart package in the dashboard and inventory files and the checklist package in the order controller. Its migrations require a supported execution plan before Change Schedule can queue it.
