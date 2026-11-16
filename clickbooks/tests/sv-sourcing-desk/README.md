# v55.83-SV — Sourcing desk database rules (real Postgres run)

Runs `sql/v55-83-SV-sourcing-desk.sql` (twice) and `01_scen.sql` on a local Postgres 16. Never touches Supabase.

| Check | Result (Nov 16 2026) |
|---|---|
| V1 requests are numbered SR-0001 … | yes |
| V2 closing a request without a reason | refused |
| V3 unknown direction | refused |
| V4 / V5 the same supplier twice (by name, by website) | refused |
| V6 the agent marks a fact VERIFIED | refused |
| V7 the agent records a fact with no source link | refused |
| V8 a person marks VERIFIED without saying what they saw | refused |
| V9 / V10 a recorded fact rewritten / erased | refused |
| V11 retracted without a reason | refused |
| V12 retracted with a reason | allowed (kept on file) |
| V13 retracted twice | refused |
| V14 a contact with no email, phone or WhatsApp | refused |
| V15 a supplier dropped without a reason | refused |
| V16 a draft marked "sent" (this stage cannot send) | refused |
| V17 a second research job while one is waiting (paid twice) | refused |
| V18–V19 one worker at a time | yes |
| V20–V22b a stuck job is retried, then marked failed after 3 attempts | yes |
| V23 a new job after a failed one | allowed |
| V24 row level security on all seven tables | 7 of 7 |
| V25 the web roles (anon, authenticated) can read the tables | none — even with default grants in place |
