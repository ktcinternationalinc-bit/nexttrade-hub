# Bills, Wires and bank matching: bug review, gap review and master plan

KTC NextTrade Hub, as of v55.83-SA (12 Nov 2026). Written from reading the current code. The bugs below were found by reading; none has been reproduced with a test yet, and bugs 1 to 5 and 7 were fixed in v55.83-SB.

## 1. Decisions (Max, 12 Nov 2026)

1. **Auto-matching.** The Hub matches a wire by itself when the bank line fits and is within $100 of the wire. Built in v55.83-SB with these safeguards: the line must read like a wire or be exact to the cent, must not be verified by a person, and no other sent wire may fit the same line. A person can always pick the line by hand.
2. **Undoing a sent wire:** super admin only. Done in SB.
3. **Bank sync:** every 2 hours. Done in SB.
4. **Clean bills:** one-click validation (build 8). Not automatic.
5. **Purchase orders:** not complete enough to check bills against. Build 7 is on hold until they are.
6. **Screens:** every new screen must look professional and be easy to use: white panels with dark text in both skins, one accent colour, clear headings, no text on a background of similar colour. Each build is checked in the dark skin before it ships.

## 2. Bug review

| # | Severity | What is wrong | What it can cause |
|---|---|---|---|
| 1 | High | Auto-match accepts the only money-out of the right amount in a 9-day window. It does not check that the line is a wire, who it went to, or whether a person already categorized it. | A card charge or ACH of the same amount gets recorded as the wire; bills show PAID against the wrong bank line. |
| 2 | High | Two sent wires with the same total compete for one bank line. The first one in the list takes it. | The wrong wire is closed; the other waits forever. This breaks the "never guesses" rule. |
| 3 | High, rare | If the bank sync and a person opening Wires match the same wire in the same second, the loser's clean-up reopens the winner's wire lines. | Bills stay blocked from future wires, or point at cancelled payments. |
| 4 | Medium | "Record a past wire" does not check that the bills belong to the payee picked (a bill paid through NextTrade can be put on an RTM wire), and accepts a future date. | A past wire recorded against the wrong party. |
| 5 | Low | A sent wire can be undone by the owner as well as the super admin; before sending, only the super admin can delete. Inconsistent with what you asked. | Someone other than you reverses a sent wire. |
| 6 | Low | Opening Wires as a view-only person runs the matcher, which writes payments with no person named. | Confusing history ("the Hub" did it because a viewer opened a screen). Intended, but worth a decision. |
| 7 | Low | The READY/SENT status on the bills list reads open wire lines without paging. | Statuses would go missing past 1,000 open wire lines. Far away, cheap to fix. |

## 3. Gap review

**Not proven**
- The AI bill read has never been scored against real bills. Nobody knows its error rate.
- Automatic matching has not been watched on the live bank feed.

**People still do work the Hub could do**
- Vendors are typed text. There is no vendor record holding the usual type, direction, category and payee, so those are picked again on every bill. (NexPac's inbound default is the one exception.)
- Price rules are typed by hand. Hundreds of validated bills already show what each product and service normally costs.
- Every bill is validated by hand, including bills where every check passes.
- Wires are assembled by hand, bill by bill.

**Not connected**
- Bills are not linked to purchase orders. Quantities and prices on a supplier bill are checked against price rules only, not against what was ordered.
- Release numbers are compared between bills, not against the orders and shipments they belong to.

**Work can stall silently**
- I did not find any reminder for: a bill waiting for validation, a wire waiting for a signature, or a wire SENT with no bank line after a week.
- There is no single "what is waiting for me" list per person.

**Smaller**
- Switch changes now reach people in 2 minutes; role changes (staff to admin) still need a sign-out.
- The inventory and spend reports are hidden under Bills → Reports.

**Already there** (the earlier prompt listed it as missing): duplicate-bill detection on import.

## 4. Where people type or click today

| Step | Who | Verdict |
|---|---|---|
| Upload or forward the bill | Staff | Remove where possible: the email scanner already picks bills up hourly. |
| Fix fields the AI left blank | Staff | Keep, but measure how often (build 5). |
| Pick type and direction | Staff | Pre-fill from the vendor record. |
| Pick category and payee (RTM / NextTrade / direct) | Staff | Pre-fill from the vendor record. |
| Resolve price flags | Staff | Keep. It is a control. |
| Three checks + "how I checked" note | Staff | Pre-fill for clean bills; keep for flagged ones. |
| Build the wire | Preparer | Pre-fill: the Hub proposes a wire per payee from validated bills. |
| Open and check each bill, sign (two people) | Signers | Keep. It is the main control. |
| Mark sent + bank confirmation | Sender | Keep. |
| Match the bank line | Nobody, when one line fits | Tighten (bugs 1 and 2). |
| Categorize the bank line | Nobody for RTM / NextTrade and vendor wires | Done. |

## 5. Build order

Each build ships alone, with tests on the real routes and re-runnable SQL.

1. **DONE in v55.83-SB — fix the matcher (bugs 1 to 5, 7).** Wire-looking or exact-amount rule; a line two wires could claim goes to a person; skip lines a person categorized; claim the wire before writing payments; payee and date checks on past wires. *Fewer wrong matches. Undo: none needed, it only matches less.*
2. **"Waiting for me" list and stuck alerts.** One screen per person: bills to validate, flags to resolve, wires to check and sign, wires to send, SENT wires with no bank line after 7 days. Uses the reminder job that already runs every 10 minutes. *Nothing stalls unseen.*
3. **Vendor record.** One row per vendor with usual type, direction, category and payee, proposed from that vendor's validated bills and confirmed once by a person. New bills arrive pre-filled. Vendor names that differ only by spelling are merged by a person, never by the Hub. *Removes four picks per bill.*
4. **Wire proposals.** For each payee, the Hub drafts a wire from validated unpaid bills (by due date). A preparer edits or accepts. Signing is unchanged. *Removes hand assembly.*
5. **AI read scorecard.** Every validation already records what a person changed after the AI read. Report it per field and per vendor: how often blank, how often corrected. No new input from anyone. *Tells us whether question 4(b) is safe.*
6. **Price rules from history.** The Hub proposes a rule when a product or service was billed at the same price on several validated bills; a person approves it. Rules are never created silently. *Fewer unflagged surprises, less typing.*
7. **ON HOLD — link bills to purchase orders and releases** (purchase orders are not complete enough yet). Supplier bill lines are compared with the order: quantity, price, and whether it was already billed. Mismatches become flags like price flags. *Catches over-billing that price rules cannot.*
8. **One-click validation for clean bills.** Clean means: known vendor record, type and direction known, price check clean, no duplicate, order or release matches. The person sees the evidence and confirms in one click; the audit trail records that it was a clean-bill confirmation. Full automatic validation only if you choose 4(b) later. *Risk accepted: less reading of clean bills. The two wire signers still open every bill.*

## 6. How we will know it worked

All readable from the Hub's own records:

- Fields a person changed per bill between import and validation (target: falling).
- Time from bill arrival to validated, and from validated to PAID.
- Share of wires matched by the Hub alone, and how many of those a person later undid (target: zero undone).
- Price flags raised, and how many were resolved as real errors versus "rule was wrong".
- Items older than 3 days on anyone's waiting list.
