# Warehouse release review

## Pallet unit prevention

The deployable change is the ScanInController file from Warehouse commit `f8572e1bbd445f537e1959875e3f4964f03270fe`. The production version matched the November 14 baseline. The staging file matched the candidate after normalizing CRLF line endings. The deployment worker will check the current production fingerprint again, back up the file and install the exact committed bytes.

On November 24, the staging PHP 8.2 runtime passed syntax checking and eight synthetic invocations of the deployed `resolveUnit` method. The cases cover weight and yard skews, missing and whitespace values, lowercase input, explicit posted units and missing skews. The four write paths call the resolver five times. This exercise called the method directly and made no database writes. The existing-record correction has its own release entry.

## Existing pallet unit correction

The November 24 production dry run found exactly 2,776 matching InnoDB records. The approval binds the full record snapshot and the SHA-256 fingerprint of the reviewed correction. The worker first confirms the prevention controller is an exact match, then verifies the locked snapshot before writing. It backs up the previous values by pallet ID and commits the backup rows and `unit` updates together. If any selected row drifted, it stops without changing pallet data.

The exact program passed a synthetic seven-row exercise on MariaDB in fix staging. It refused a same-count fingerprint mismatch and preserved the original values in its backup, unchanged timestamps and weights, and all nonmatching records. No production data was changed. An operator needs a separate reviewed restore if the correction later needs reversal.

### November 28 production dry run

History entry #11 recorded that request #10 stopped because its November 24 snapshot had changed. A read-only production transaction on November 28 found 2,806 matching records, up from 2,776. The dry run confirmed the production prevention controller matched the reviewed build and that `scan_in_logs` uses InnoDB. It computed the fingerprint with the same fields, order and PHP JSON encoding as the correction. Only the count and fingerprint were returned. The correction program's SHA-256 still matches the reviewed program. Its November 24 staging test remains the evidence for the program's behavior. The refreshed snapshot requires a new approval.

## Order Queue

The candidate is Warehouse commit `ae404ef4f57b2bfe07a9f92fe142817f7917c85d` in the isolated `output/warehouse-order-queue-candidate` checkout. It keeps the November 15 Order Queue work and requires an explicit selection to release the whole order. A partial colour/grade selection is refused. The worker must use this checkout so it can read the exact commit. The manifest lists six code files and two additive migrations. Production had none of the three release-history columns at the November 24 dry run. The worker checks the live file fingerprints and backs up those files before adding the columns, keeps a separate backup table, and verifies the schema before replacing the application files.

Fix staging passed synthetic MariaDB checks for separate USA and Canada totals, picked weight deducted once, saved lines the PDF uses, retained released rows, and release-by-line or explicit full release. The candidate Blade compiled and the candidate PHP handler refused five ambiguous or invalid requests. Both migration bodies ran twice with only the table name replaced by a synthetic table, retaining its sample row. These tests did not run a signed-in browser order through shipping or concurrent reservation writes. A code rollback retains the additive columns and order history.
