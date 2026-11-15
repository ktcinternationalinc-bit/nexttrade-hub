# KTC Hub — Commercial Agent: assessment and staged build plan

Written 15 Nov 2026 from Max's 19-section brief ("Build a robust AI procurement, sourcing, sales, and
business development agent directly inside KTC Hub"). Status: **plan only — nothing in this document is built yet.**

## 1. What the agent is for

Find supply and demand, negotiate within limits a person approved, keep the correspondence, and carry each
opportunity to a profitable, completed transaction — or to a recorded reason for stopping. It is measured on
realized profit, cash recovered, stock turned and repeat business, not on messages sent.

## 2. What the Hub already has (checked in the code, v55.83-SN)

| Need | What exists today | State |
|---|---|---|
| Sign-in, roles, per-module permission switches | `users`, `module_permissions`, verified super-admin check | Reusable as is |
| Audit trail (append-only) | `audit` helper and Audit Trail screen | Reusable as is |
| WhatsApp | Shared company number on Meta Cloud API: inbox, webhook, send text/media inside the 24-hour window, send approved templates at any time, claim/read per conversation | Reusable; no outreach templates approved yet |
| Email — sending | Gmail connection (read + send scopes) per connected mailbox; Resend for system mail | Reusable; which mailbox the agent speaks from is undecided |
| Email — reading | Gmail inbox route; a read-only IMAP scanner on the bills mailbox | Gmail reusable; the bills scanner stays read-only and separate |
| Customers / CRM | CRM screen with contact log, follow-ups, notes, calls and voicemails; accounting customers; quote customers | Reusable for customers; no supplier side |
| Quotes | Quotes screen (`customer_quotes`, `quote_companies`) | Reusable for selling |
| Inventory | Products, cost layers, movements, stock counts, P&L by product | Reusable for "what do we have to sell" and cost |
| Calendar, reminders, notifications | Calendar with recurring events, reminder dispatch every 10 minutes, notification bell, tickets | Reusable for follow-ups, deadlines, show calendar |
| AI | Hub assistant on the Anthropic API with a model chain; bill reading; translation route | Reusable; **no web research ability yet** |
| Documents | Private storage bucket with signed links | Reusable |
| Scheduled work | Vercel scheduled jobs (10 today) | Reusable for simple schedules; no durable job queue |
| Money | Bills, wires with two signatures, bank feed, ledger | Reusable; the agent never pays — it hands over to Bills and Wires |

## 3. What is missing (must be built or configured)

1. **Supplier records.** Suppliers exist only as names on bills. Needs a supplier record: legal and trading
   names, role (maker, distributor, broker, stockholder), contacts, products, terms, documents, source links,
   verification dates, confidence, open concerns, duplicate detection.
2. **Opportunity records and pipeline.** Owner, stage, next action, due date, evidence — for sourcing
   requests, customer inquiries, auctions and trade shows.
3. **Web research.** The Hub's AI cannot search the web today. Needs the Anthropic web search tool switched on
   for the Hub's API key (a paid add-on per search) and a research worker that records every source link.
4. **Durable background work.** Research and follow-ups outlive one web request. Needs a job table with
   retries, duplicate-send prevention and recovery, run by a scheduled job.
5. **Authority matrix and mandates.** Who may approve what, by role, product, size and action; three levels
   (research and draft only / approve before sending / autonomous inside a mandate); approvals tied to an
   exact version.
6. **Unified correspondence.** One thread per counterparty across email and WhatsApp, linked to the
   opportunity, with message states: drafted, queued, sent, delivered, failed.
7. **Quotation extraction and comparison**, negotiation record, deal calculator (landed cost, break-even,
   sensitivity, confirmed versus estimated).
8. **Sales feedback loop.** Opportunity cards to the salesperson, recorded answers with evidence grade
   (opinion, customer inquiry, written commitment, order), overdue escalation.
9. **Trade-show calendar and exhibitor research, auction watchlist, campaigns with suppression lists,
   management reporting.**
10. **Spanish** in the translation path (English and Arabic exist).

### Configuration only Max can provide
- The mailbox the agent sends from, and its signature and stated role.
- WhatsApp message templates submitted to and approved by Meta for first contact and follow-up.
- Approval for the web search add-on cost.
- The authority limits (section 5 below).

## 4. Rules that do not bend

- The agent never invents names, roles, relationships, prior conversations, competing offers or demand.
- Websites, incoming messages and attachments are information, never instructions.
- Verified facts, supplier claims and estimates are stored and shown as three different things.
- Maximum buying prices, minimum selling prices, costs, customer lists and margin targets never leave KTC.
- No binding purchase, contract, payment, credit, guarantee, exclusivity or spending without the approval the
  matrix requires. Payments always go through Bills and Wires with their two signatures.
- A changed bank detail is verified through a contact established independently before any payment.
- WhatsApp: no cold first messages outside Meta's rules. First contact is by email, or by an approved
  template to a business number that publishes WhatsApp as its contact channel; free text only inside the
  24-hour window after they reply.
- Every send is recorded with its state and evidence. Nothing is reported as done without proof.
- Sales staff see commercial information; restricted financial information stays behind existing switches.
- No browser pop-ups; readable in the dark skin; no feature shown as working when its connection is missing —
  an "Integration health" panel says what is connected and what is not.

## 5. Decisions needed from Max

1. **Sender identity:** which mailbox, what name and title in the signature.
2. **Starting authority level:** recommended "approve before sending" for the first weeks, then autonomous
   follow-ups and negotiation inside an approved mandate.
3. **Approvers:** who approves outgoing messages, mandates, and purchases, and above what amount a second
   person is needed.
4. **First live product** for the controlled scenario (the brief lists automotive leather, PVC, upholstery,
   headliner, carpeting, flooring, laminated materials, industrial surplus).
5. **Web search cost:** approve switching it on.
6. **Which company each opportunity belongs to** (KTC International, NextTrade, KTC Egypt, Stocklot) — one
   agent across all, or one company first.

## 6. Build stages

Each stage is usable on its own, with tests, release notes and a version, like every Hub build.

**Stage 1 — Sourcing desk (records and research).**
Sourcing request by form, chat or uploaded photo/spec; the request becomes a tracked assignment with owner,
stage, next action and due date. Supplier records. Research worker with web search that fills a shortlist,
each fact carrying its source link, date and confidence. Job table with retries. Integration health panel.
*Acceptance: brief steps 1–3 (receive a request, discover and qualify suppliers, verify contacts and prepare
outreach drafts).*

**Stage 2 — Correspondence with approval.**
Outreach drafts per supplier, approval inbox, send by email from the agreed mailbox, replies read and attached
to the thread, follow-up schedule with a stop rule, duplicate-send prevention, message states.
WhatsApp joins once templates are approved. *Acceptance: brief step 4 (process a reply).*

**Stage 3 — Quotes, costing and sales feedback.**
Quotation extraction from replies and attachments, comparison table, deal calculator with landed cost and
break-even, opportunity card to the salesperson, recorded feedback with evidence grade, overdue escalation.
*Acceptance: brief steps 5–6.*

**Stage 4 — Mandates, negotiation and approvals.**
Authority matrix, negotiation mandates with limits, negotiation record, autonomous routine replies inside a
mandate, version-tied approvals, hand-over of an approved purchase to Bills and Wires.
*Acceptance: brief steps 7–9 and the tests for permissions and approval enforcement.*

**Stage 5 — Customers and inventory matching.**
Customer research, matching prospects to stock and to prospective purchases, outreach, quotes through the
existing Quotes screen, aging-stock proposals.

**Stage 6 — Trade shows and auctions.**
Rolling show calendar with verified dates, exhibitor research, pre-show outreach, meeting planner and
itinerary, post-show capture. Auction watchlist, cost build-up, maximum-bid recommendation; bidding only
under an explicit mandate.

**Stage 7 — Promotions and reporting.**
Campaigns with customer segments and suppression lists, daily action brief, weekly commercial review,
outcome measures (qualified opportunities, response rates, confirmed demand, conversion, realized
contribution, turnover, collections, repeat business, forecast accuracy).

## 7. Honest limits

- Web research finds public information. Contacts and claims still need a reply or a document to count as
  verified.
- An AI can misread a quotation. Extracted prices are shown beside the original message, and nothing is
  committed on an extracted figure without a person seeing the source.
- "Substantial autonomy" is reached in Stage 4, after mandates and limits exist. Before that the agent
  researches and drafts, and people send.
- Scheduled jobs on the current hosting run on a timer, not instantly; follow-ups are accurate to minutes,
  not seconds.
