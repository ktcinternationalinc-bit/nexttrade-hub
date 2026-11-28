# Warehouse release preparation

## Receipt 1325

The fix-staging history records `scan_in_inventories.id = 1325` moving from November 6, 1984 to October 11, 2024. Before approval, confirm the exact live `created_at` value and that the corrected date is still needed. The production plan should lock and compare that one receipt, preserve its original value in a new backup, commit only the verified one-row change, and reread the receipt. If the live receipt already has the correct date, close the release without a write. The existing release worker has no executor for this receipt correction.

## BUG-002 shipped-date guard

Candidate `dd23fce9d852953caa99ea9883da25db0a3ead64` is on local branch `codex/warehouse-bug-002-candidate` in `.codex-warehouse-bug-002-prep`. It applies the six application-file changes from `f9d89d4` on the recorded live shipping-feed build `09d21b12`, keeping the live Order Queue release behavior. The candidate also returns a validation message for malformed Scan Out dates before that handler starts a transaction.

The installed fix-staging date and checklist services passed 14 synthetic PHP checks without a database connection. The date cases covered future, unreadable, valid, and confirmable dates. Next verify the six production file fingerprints and run the exact package through the signed-in date editor, both order-edit screens, Shipping, Reopen, and Scan Out. Capture the committed file hashes and staging evidence before registering the build for approval.

## Warehouse look and inventory charts

Use the chart work from `6c40a66` with the reviewed historical-movement and order-badge corrections in `834beb1`. Prepare only the skin and chart changes. The intervening `bf69316` customer reminder migration is outside this release. Verify the warehouse scope and inbound/outbound totals in the actual chart, with a valid old receipt retained and receipt 1325 handled through its separate data release.

## Order checklist, ACID and the Hub feed

Start with `d24ceba` and its checklist follow-up `48467bb`. Preserve the live receipts and read-only shipping endpoints from `905ef4b8` and `09d21b12`. The live feed deployment does not establish that the checklist schema is installed. Verify `shipping_doc_type`, `order_payment_type`, the type of `load_date`, `load_time_known`, and the order-history `note` column before planning migrations. Preserve the opt-in close-order write path and verify its configuration independently of the read-only feed. Test Egypt, Kenya, other and blank destinations, required document fields, known and unknown load times, and feed continuity. The order controller and forms overlap BUG-002. Assemble each package on the code expected immediately before it deploys.

## Order Queue Rolls / Not rolls

The exact staging branch at `b5bdd63` passed 53 local reference checks, including the file fingerprints and additive migrations. For a production release, finish the signed-in reservation, legacy split, release and picking PDF checks. Check the production schema and duplicate open reservation groups first. Verify the three migrations and the compatibility of the older code on a disposable restored copy before approval. Keep production's version files separate from staging's version history. This change overlaps the chart package in the dashboard and inventory files and the checklist package in the order controller. Its migrations require a supported execution plan before Change Schedule can queue it.
