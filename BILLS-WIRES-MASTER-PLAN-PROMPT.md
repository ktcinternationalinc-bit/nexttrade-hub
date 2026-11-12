# Prompt: master plan for Bills, Wires and bank matching (KTC NextTrade Hub)

Paste everything below this line into the AI, with the current source zip attached.

---

You are the lead architect for the buying side of the KTC NextTrade Hub, an internal Next.js + Supabase app used by KTC International (US company, super admin: Max). Your job is to write a master plan that makes the Bills → Wires → bank matching → ClickBooks workflow more automatic, more accurate, faster, and less dependent on people typing things in. Another Claude session will write the code from your plan, one build at a time, so the plan must be specific enough to build from without guessing.

Read the attached source before you plan. Do not plan from this description alone; where the code and this description disagree, the code is right, and say so.

## What exists today (v55.83-SA)

**Bills come in** by upload, by an email scanner (read-only on the mailbox), or by an inbound route. An AI read pulls out vendor, bill number, date, amount, line items, release number and other reference. It never guesses: anything it cannot read is left blank.

**The import sorts each bill.** Type is Trucking, Shipping, Bonded/Brokerage or Supplier. Direction is outbound when there is a release number; otherwise it is left blank, except vendors with a default (NexPac bills are always inbound, changeable by hand).

**NexPac bills** are cost plus a 12.5% commission. The Hub splits the commission across each product line (cost line + commission line) and ClickBooks books commission to its own account.

**Price rules.** Staff enter expected prices for products and services. Every imported bill is checked against the rules and anything off is flagged with exactly what is off (issue, where, billed, expected, difference). A flagged bill needs a written resolution.

**Validation.** A person confirms type, direction, three checks and a short "how I checked" note. Progress is saved as they go. Only validated bills can go on a wire. Outbound bills need a release number; inbound bills need a reference and a bill number.

**Wires.** A preparer builds a wire (to RTM Capital, to NextTrade, or straight to one vendor) from validated bills, in full or in part. Two different people must each open and check every bill, then sign. Signatures are bound to the wire's exact contents. After both signatures only the super admin can delete or cancel. Then it is sent (to RTM / NextTrade / the vendor) and marked sent with the bank confirmation.

**Bill status** follows the wire: OPEN → READY (both signatures) → SENT (waiting for the bank line) → PAID or PARTIAL.

**Bank matching.** On every bank sync, statement import and when Wires is opened, the Hub looks for the money-out. Exactly one fitting line → matched automatically and the bills are marked paid. More than one → it lists them and a person picks. A line up to $50 over the wire is accepted: on a vendor wire the extra is booked with the bill it paid (cost of goods by default); on an RTM/NextTrade wire the whole line goes under professional fees. Over $50 needs the super admin and a reason. The sent date can be corrected, and the super admin can record a wire that was sent before this system existed.

**Reports.** Product inventory (quantity, cost, commission, paid, per product) and spend by service/vendor/type over periods, under Bills → Reports.

**Not yet proven or not yet built** (treat these as open, verify in the code):
- The AI bill read has not been measured against a set of real bills for accuracy.
- Automatic bank matching has not been observed against the live bank feed.
- Bills are not linked to Purchase Orders, shipments, or the Order Reconciliation screen, although release numbers exist on both sides.
- Price rules are typed in by hand; nothing learns them from past validated bills.
- Vendors are free text; there is no vendor master record with defaults.

## Rules you may not break

1. Extraction never guesses. A blank is better than a wrong value.
2. No fuzzy matching of money. Exactly one candidate matches automatically; anything else goes to a person.
3. Two-person control on wires stays, enforced on the server and in the database, not only on screen.
4. Audit trails are append-only. Posted ledger entries are never edited, only reversed.
5. Automation never changes anything a person has verified or validated.
6. Bill documents stay private (signed links only). No secrets in browser-exposed variables. Never copy bank account or routing numbers.
7. Bank balances are visible only to the super admin or by explicit grant.
8. No browser pop-ups; no silently disabled buttons — every refusal says why, on the screen.
9. Every screen must be readable in the dark skin.
10. Every build ships with tests that run the real routes, registered in the regression runner, and re-runnable SQL.

## What I want from you

A master plan with these parts:

1. **Where people still type or click today.** Walk the workflow from "bill arrives" to "ledger posted" and list every human input, with who does it and why it exists. Mark each one: keep (it is a control), remove (the Hub can know it), or pre-fill (the Hub proposes, a person confirms).
2. **Where it can go wrong today.** Gaps, double entry, places a wrong value can pass, places work can stall silently.
3. **Proposals**, each tied to one of these goals: fewer human inputs, more automation, higher accuracy, faster, better connected. For each: what changes for the person doing the work, what the Hub decides on its own and on what evidence, what still needs a person, and how it could fail safely. Consider at least: a vendor master with learned defaults (type, direction, category, usual payee); price rules proposed from past validated bills; linking bills to purchase orders and releases so quantities and prices check themselves (three-way match); auto-validation for bills that pass every check, if and only if you can state the exact conditions and keep an audit record; duplicate-bill detection; a "what needs me" queue per person; reminders when a wire or bill is stuck; a measured accuracy test for the AI read.
4. **Build order.** Small builds, each shippable alone, safest and highest-value first. For each build: database changes, server routes, screens, tests, what to check on live data after deploy, and how to undo it.
5. **How we will know it worked.** A few numbers we can read from the Hub's own data: inputs per bill, time from arrival to validated, share of wires matched automatically, flags raised versus real errors.
6. **Questions for Max.** Anything that is a business decision, not a technical one. Ask; do not assume. Keep the list short and put it first in your answer.

Write for an owner who is not an accountant: plain words, the conclusion first, no jargon without a one-line explanation. Where you recommend less human checking, say plainly what risk that accepts.
