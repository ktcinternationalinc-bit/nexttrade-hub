# Warehouse release review

## Pallet unit prevention

The deployable change is the ScanInController file from Warehouse commit `f8572e1bbd445f537e1959875e3f4964f03270fe`. The production version matched the November 14 baseline. The staging file matched the candidate after normalizing CRLF line endings. The deployment worker will check the current production fingerprint again, back up the file and install the exact committed bytes.

On November 24, the staging PHP 8.2 runtime passed syntax checking and eight synthetic invocations of the deployed `resolveUnit` method. The cases cover weight and yard skews, missing and whitespace values, lowercase input, explicit posted units and missing skews. The four write paths call the resolver five times. This exercise called the method directly and made no database writes. The existing-record correction has its own release entry.

## Database work

- Order Queue at `c8e70efafe514337c54d54fbcdcf897366a3deee` requires the two November 15 migrations. Production has none of the three release columns. Fix staging has all three. Its shared OrderController and routes have newer staging changes, so that deployed staging pair cannot certify the earlier release in isolation.
- A production read-only count found 2,776 `scan_in_logs` records with a weight skew and a blank or null unit. The production correction needs a fresh count, a row-level backup and a reviewed, guarded update. The prevention release does not backfill existing records.
