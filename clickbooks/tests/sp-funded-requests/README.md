# v55.83-SP — requests drawn from a transfer (real Postgres run)

These scripts run the REAL database functions from `sql/v55-83-SP-funded-requests.sql`
(`wire_funding_summary`, `wire_request_send`, `wire_request_fee_change`) on a local Postgres 16.
They never touch Supabase.

Set-up used: database `wr` with the minimal `users`, `vendor_bills`, `vendor_bill_payments`,
`bank_transactions` tables, then the real wire scripts in order (RH, RI, RL, RZ), then:

    psql -d wr -f 01_scen.sql          # F0–F19
    psql -d wr -f 02_closed_month.sql  # G1–G4

What they prove (run Nov 15 2026, all as expected):

| Case | Result |
|---|---|
| F1 no signatures | refused, nothing recorded |
| F2 future sent date | refused |
| F3 request 1 ($38,300 bills + $1,000 fee) on a $50,000 transfer | attached; payments dated the TRANSFER date, method rtm |
| F5 sending twice | refused (no duplicate payments) |
| F6 request 2 over what is left | refused, nothing recorded |
| F7 last bill split to fit | attached; two requests share one bank line; transfer fully used |
| F8 fee raised beyond the room | refused |
| F9 fee lowered | allowed; signatures untouched; the difference is back on the transfer |
| F10 / F11 fee or transfer changed directly on a sent request | refused by the lock |
| F12 two ORDINARY wires on one bank line | refused (unchanged rule) |
| F13 a request straight to a vendor | refused |
| F14 / F15 line not marked as sent to the company / linked as an internal transfer | refused |
| F16 undo of one request | only its payments are void; the other request untouched |
| F17 / F18 | no bill overpaid; one payment per bill per bank line |
| F19 | the SQL file is safe to run again |
| G1 transfer inside a closed month | refused, nothing recorded |
| G2 month reopened | allowed |
| G3 fee change inside a closed month | refused |

Not covered here (not in this build): the ledger side for NextTrade (still posted as before),
currency mismatch.
