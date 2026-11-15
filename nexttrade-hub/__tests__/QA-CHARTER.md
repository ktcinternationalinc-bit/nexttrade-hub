# KTC NextTrade Hub — QA Charter

## The workflow (this is how it actually runs)

### On EVERY change

When code changes, the following ALWAYS happens:

1. **Code review** — the change itself is read end-to-end, not just the diff
2. **Bug hunt first** — look for bugs in what was just written before anything else
3. **Gap hunt second** — what's missing, what edge case isn't handled, what upstream/downstream effect wasn't considered
4. **Test scenarios authored** — new test cases covering the change are WRITTEN and added to the appropriate test file in `__tests__/`
5. **Upstream/downstream reconciliation focus** — for any change touching money or linked data, the test scenarios specifically verify:
   - `invoice.total_collected` = SUM(cash_in + bank_in) on linked non-placeholder, non-dedup rows after the change
   - No double-counting
   - No orphan rows
   - `payment_source` set correctly
   - Safe balance unaffected by bank-only ops

The new scenarios get ADDED to the test files. They do NOT get run yet.

### ONLY when Max says "run QA" or "run the full QA run"

The full suite is executed — every test, every scenario, including every one accumulated from past changes:

```bash
node __tests__/test-checks.js
node __tests__/test-full.js
```

Any failures are investigated and fixed. Zero-bug gate before declaring the QA run complete.

Max can also ask for targeted runs ("run QA on the check reconcile only") — but by default "full QA run" means all files.

## Why this structure

Max explicitly requested this: **QA doesn't run on every change**. It runs **on request**. Between requests:
- Code review happens (always)
- Bug hunt happens (always)
- Gap hunt happens (always)
- Test scenarios are authored and added to the suite (always)

That way, when Max says "run QA," the suite is already comprehensive — every change since the last run has been captured as test cases, and the accumulated runs catch regressions across everything.

## Focus areas by change type

### Money / financial changes
**Priority: upstream/downstream reconciliation.** Tests must verify:
- What feeds into the changed area (upstream) is still consistent
- What depends on the changed area (downstream) is still consistent
- The numbers reconcile — treasury ↔ invoice ↔ checks ↔ bank
- No orphan rows created
- No duplicates created

### UI/UX changes
- Mobile + desktop both work
- Bilingual (AR/EN) where user-facing
- RTL layout for Arabic
- No frozen states, no scroll jumps

### API/backend changes
- Error paths handled (not silently swallowed)
- No template literals/backticks in API routes (SWC/Vercel constraint)
- Graceful fallback when dependencies missing (tables, env vars)
- Response shapes consistent

### AI/memory changes
- Cross-user routing works (target_user_id preserved)
- Settings gates are respected
- Cap enforcement works
- Expiry rules applied correctly

## Test file structure

| File | Scope | Current assertions |
|---|---|---|
| `test-checks.js` | Check reconcile evaluator — all scenarios | 40 |
| `test-full.js` | End-to-end: reconcile + AI memory + action dispatch + login ET + data reconciliation | 68 |

**Total today: 108 assertions.**

### When to add to an existing file vs create a new one

- **Add to `test-full.js`** when the change fits into an existing section (memory, actions, login, reconciliation)
- **Create `test-<feature>.js`** when:
  - The feature is substantial enough to warrant its own lib file or subsystem
  - The scenarios form a coherent module that doesn't fit the existing sections

## Historical test case bank

### Check reconcile (21 scenarios, 40 assertions) — in `test-checks.js`
1. No invoice link → no_invoice
2. Order# doesn't match any invoice → no_invoice
3. Invoice linked via invoice_id → mode based on treasury state
4. Already linked via source_check_id → already_linked
5. Bank deposit exact amount match → candidate_match (1)
6. Partial payment edge case — cash + check both 100k on same invoice
7. Multiple exact-amount candidates → all surfaced
8. Treasury tied to OTHER check → excluded
9. Bank placeholder excluded
10. Bank confirmation dedup row excluded
11. Zero tolerance verified both directions
12. cash_in + bank_in summed correctly
13. Treasury on different invoice ignored
14. Order# whitespace tolerated
15. invoice_id wins over order_number when both present
16. Defensive — null/undefined safe
17. Zero-amount check handled
18. Decimal 0.01 off → no match (zero tolerance)
19. Re-evaluation after attach is idempotent
20. Check exceeds invoice total → no_match
21. Multiple customer invoices, only correct one matches

### AI memory (21 assertions) — in `test-full.js` Section 2
- Persist with and without target_user_id
- scope=team when target set, private otherwise
- Expiry rules: note (30d), meeting/reminder/follow_up (14d), urgent (never)
- Cap enforcement (max_memory_items_per_user)
- auto_capture_enabled=false blocks extraction
- Missing ANTHROPIC_API_KEY returns empty
- Short messages (<8 chars) skipped
- loadMemoryForUser filters dismissed + expired (keeps urgent indefinitely)
- cross_user_read='disabled' blocks targeted messages
- targetedAtMe excludes rows already in own

### AI action dispatch (15 assertions) — in `test-full.js` Section 3
- create_ticket with assigned_to routes correctly
- create_event with assigned_to (cross-user delegation)
- create_event without assigned_to defaults to creator
- create_reminder with target_users (specific UUID)
- create_reminder without target_users defaults to 'all'
- send_team_message creates ai_memory row correctly
- send_team_message urgent=true → type=urgent, no expiry
- send_team_message urgent=false → type=note, 7-day expiry
- send_team_message missing target_user_id → throws

### Login events ET timezone (12 assertions) — in `test-full.js` Section 4
- UTC-to-ET day boundary conversion (EDT + EST)
- Late-night ET logins stay in correct ET day
- is_online check (5 min / 11 min / null)
- Dedup window (30s / 90s)
- Login count aggregation by ET day

### Data reconciliation (4 assertions) — in `test-full.js` Section 5
- Check already_linked → collected unchanged (no double-count)
- Check no_match → new treasury → collected increases by check amount
- Partial payment + check → collected = cash + check sum
- Check amount = treasury inflow after attach
