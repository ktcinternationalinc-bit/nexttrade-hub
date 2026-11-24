# Warehouse release review

## Pallet unit prevention

The deployable change is the ScanInController file from Warehouse commit `f8572e1bbd445f537e1959875e3f4964f03270fe`. The production version matched the November 14 baseline. The staging file matched the candidate after normalizing CRLF line endings. The deployment worker will check the current production fingerprint again, back up the file and install the exact committed bytes.

On November 24, the staging PHP 8.2 runtime passed syntax checking and eight synthetic invocations of the deployed `resolveUnit` method. The cases cover weight and yard skews, missing and whitespace values, lowercase input, explicit posted units and missing skews. The four write paths call the resolver five times. This exercise called the method directly and made no database writes. The existing-record correction has its own release entry.

## Existing pallet unit correction

The November 24 production dry run found exactly 2,776 matching InnoDB records. The approval binds the full record snapshot and the SHA-256 fingerprint of the reviewed correction. The worker first confirms the prevention controller is an exact match, then verifies the locked snapshot before writing. It backs up the previous values by pallet ID and commits the backup rows and `unit` updates together. If any selected row drifted, it stops without changing pallet data.

The exact program passed a synthetic seven-row exercise on MariaDB in fix staging. It refused a same-count fingerprint mismatch and preserved the original values in its backup, unchanged timestamps and weights, and all nonmatching records. No production data was changed. An operator needs a separate reviewed restore if the correction later needs reversal.

## Order Queue

- Order Queue at `c8e70efafe514337c54d54fbcdcf897366a3deee` requires the two November 15 migrations. Production has none of the three release columns. Fix staging has all three. Its shared OrderController and routes have newer staging changes, so that deployed staging pair cannot certify the earlier release in isolation.
