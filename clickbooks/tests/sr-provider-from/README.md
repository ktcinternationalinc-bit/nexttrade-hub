# v55.83-SR — NextTrade booked like RTM from 2026-11-15 (real Postgres run)

Runs `sql/v55-83-SR-provider-from.sql` against a copy of the ledger test database (the one built by
`../qz2-ledger-drift` 00 … 17). Never touches Supabase.

    createdb -T cbso cbsr && psql -d cbsr -f 01_scen.sql

Result of the run on Nov 15 2026 (amounts in cents where shown as account:amount):

| Step | What was checked | Result |
|---|---|---|
| R0 | Before the change, a NextTrade transfer dated Nov 16 ($300) and a bill it paid ($100) booked the old way | bank −300 / Due from NextTrade +300; bill: Office supplies +100 / Due from −100 |
| R1 | Script run | provider_from = 2026-11-15 on both companies; 5 ledger functions changed |
| R2 | Entries dated before Nov 15 | **0 changed; 0 account balances differ**; the Nov 5 advance is still an advance |
| R3 | The Nov 16 line booked the old way | reversed (2 reversing entries, 0 entries edited) and re-posted as bank −300 / Office +300; its bill entry reversed |
| R4 | New transfer dated Nov 15 ($2,000) with a $1,500 bill | one line by its category; no bill entry ("paid through a service provider (stays one line)") |
| R5 | A transfer entered late but dated Nov 12 | still the old way: Due from +800; bill: Office supplies +250 / Due from −250 |
| R6 | RTM line | unchanged: one line by its category |
| R7 | NextTrade bill already on the books (accounts payable, dated Nov 10) paid from the Nov 15 transfer | payable cleared (payable −600 / Office supplies −600), nothing left owed; a NextTrade bill dated Nov 16 is not put on the books |
| R8 | Nightly check again | nothing reversed, nothing posted; trial balance 0 |
| R9 | Script run a second time | "0 changed, 5 already done" |

Trial balance was 0 at every step.
