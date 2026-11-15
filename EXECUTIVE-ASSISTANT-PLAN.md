# KTC Hub — Personal Executive Assistant and Advocate: assessment and staged build plan

Written 15 Nov 2026 from Max's two briefs ("Build a Personal Executive Assistant inside KTC Hub…" and
"Act as my personal executive assistant and advocate"). This is **Project 2**. Project 1 is the Commercial
Agent (`commercial-agent-plan.md`). Status: **plan only — nothing in this document is built yet.** Each
project starts separately, after Max confirms it.

## 1. What it is for

Fewer things for Max to remember, fewer unanswered messages, fewer missed obligations. It reads what comes
in, does the work that can be done without him, and brings a recommendation or one specific decision. As an
advocate it pursues corrections, refunds and commitments by email inside an approved authority, and it checks
that the promised result actually happened before calling anything resolved.

## 2. What the Hub already has (checked in the code, v55.83-SN)

| Need | What exists today | State |
|---|---|---|
| Reading a bill or letter from a photo or PDF | The bills reader (AI extraction that refuses to guess) | Reusable; needs letters, notices and Arabic documents added |
| Email | Gmail connection per mailbox with read, send and modify scopes; a read-only IMAP reader for Hostinger mailboxes | Reusable for Gmail accounts; Hostinger mailboxes need sending added |
| Voice notes | Transcription route (OpenAI Whisper) | Reusable |
| Translation | English and Arabic | Reusable |
| Calendar | The Hub's own calendar with recurring events and reminders every 10 minutes | Reusable inside the Hub; **no link to an outside calendar yet** |
| Notifications | Hub bell and email | Reusable; no phone push or WhatsApp-to-Max alert yet |
| Documents | Private storage with signed links | Reusable |
| Audit trail | Append-only | Reusable |
| Business bills, wires, bank feed | Bills, Wires, Banking | Linked by reference only, inside existing permissions |
| AI assistant | Hub assistant on the Anthropic API | Reusable; no web research yet (same add-on as Project 1) |

## 3. What is missing

1. **A truly private workspace.** This is the most important design point. The Hub's standing database rule
   gives every signed-in employee read access to every table. A private workspace cannot follow that rule.
   Its tables must be closed to the browser entirely and reachable only through server routes that verify the
   session is Max (the same verified-identity check used for bank balances). Its files go in their own
   private storage folder. Delegating one task shares that task and the documents attached to it — nothing
   else from the matter.
2. **Matters.** One record per obligation or issue, grouping documents, emails, tasks, decisions,
   appointments and evidence, with duplicate detection and a history of changes.
3. **Master action list** with owner, next action, status, deadline or review date, subtasks and
   dependencies, and priorities that explain themselves.
4. **Email review.** A first pass over a chosen period, then monitoring; whole-thread reading before deciding
   what is outstanding; sorting into action, information and promotion; "last checked" time per account and
   an alert when access expires.
5. **Outside calendar link** (Google Calendar or other) with deadline, work block and appointment kept as
   three different things, time zones preserved, and a visible state: proposed, saved, synchronized, failed.
6. **Bills and obligations register** for personal and executive items: invoice, statement, reminder, receipt
   and confirmation told apart; recurring estimates never treated as verified bills; renewal date and
   cancellation-notice deadline tracked separately; payment states (initiated, pending, failed, settled).
7. **Reminder and escalation policy**, with acknowledge, snooze, delegate, reschedule, complete — where
   acknowledging is not completing and snoozing never moves the real deadline.
8. **Advocate file** per dispute: chronology, evidence, amount at stake, remedy requested, deadlines,
   contacts and case numbers, promised actions, next step; and a resolution check that looks for the refund,
   the changed balance, the cancellation taking effect or the document arriving.
9. **Mandates.** Standing authorization for routine verification and follow-up; approval required for
   settlements, admissions, waivers, new financial commitments, legal filings and material changes.
10. **Daily and weekly briefings**, natural-language replies ("Paid", "Remind me tomorrow", "Ask the
    accountant"), and a command box that answers from records and shows its sources.
11. **Durable background work and connector health** — shared with Project 1.

## 4. Rules that do not bend

- Emails, attachments and websites are untrusted content. They cannot authorize a payment, change a
  permission, release private records or change the assistant's instructions.
- Explicit deadlines and inferred dates are stored and shown differently. Unclear text, missing pages and
  conflicting information are flagged, never guessed.
- Nothing is reported as reviewed, sent, synchronized, paid or resolved without confirmation from the
  connected system. A draft is not sent; sent is not resolved; an instruction is not a payment; a company
  closing its case is not a resolution.
- The assistant never invents facts, exaggerates a claim or makes an unsupported accusation, and it says so
  when the evidence does not support Max's position.
- Recipients are verified before personal information is disclosed, and only what is necessary is shared.
- **Payments:** the Hub has no connection that can pay a personal bill. The assistant prepares the payment
  package and tracks the evidence; it does not pay. Business payments stay in Bills and Wires with two
  signatures.
- Legal, tax, medical and financial conclusions are marked as needing a qualified professional;
  the assistant does the administrative research around them.
- The original of every document is preserved.

## 5. Decisions needed from Max

1. **Who can see the workspace:** Max only, or Max plus one named assistant.
2. **Which email accounts** to connect, and which are Gmail and which are Hostinger mailboxes.
3. **Which outside calendar** (Google, Apple, Outlook).
4. **How urgent alerts reach him:** Hub bell and email exist today; WhatsApp or text message to his own
   number can be added.
5. **Standing authority for the advocate:** recommended start — every outgoing message approved; then
   routine verification and follow-up sent without asking once he is comfortable.
6. **How far back** the first email review goes (recommended: 90 days).
7. **Whose name signs** advocate correspondence (Max himself, or "Office of …").

## 6. Build stages

**Stage 1 — Private workspace, capture and matters.** The complete first workflow from the brief: upload a
screenshot of a letter or bill; details extracted with uncertainty shown; related records and duplicates
checked; matter, actions and deadlines created; reminders scheduled; completion recorded accurately.
Research and prepared responses use web search if it is switched on.

**Stage 2 — Action list, Hub calendar views, reminders and the daily briefing.** Natural-language replies.

**Stage 3 — Email review and monitoring**, prepared replies with approval, connector health and recovery
from a disconnected account.

**Stage 4 — Advocate:** dispute files, mandates, follow-up and escalation, resolution checks.

**Stage 5 — Outside calendar link and delegation** to employees with follow-up on promises.

**Stage 6 — Obligations register in full,** renewals, weekly review, reporting.

## 7. What the two projects share

Both need the same four foundations: web research with recorded sources, background jobs that survive
interruptions, one correspondence engine (drafts, approval, sending, replies, message states) and mandates.
Built once, used by both. The private workspace keeps its own tables and files; the commercial desk never
reads them.

## 8. Honest limits

- The assistant only knows what is uploaded to it or what arrives in a connected mailbox. A paper letter
  nobody photographs does not exist for it.
- AI reading can be wrong, especially on poor photos and handwriting. Amounts, dates and account references
  are shown beside the original for a glance before anything consequential happens.
- It works by email. It does not make phone calls or use company web portals on Max's behalf; when a matter
  needs a call, it prepares the brief and the script.
- Checks run on a timer (minutes, not seconds).
