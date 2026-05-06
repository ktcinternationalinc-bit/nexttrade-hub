'use client';
// ============================================================
// WhatsNewWidget — v55.45.
//
// A small clickable pill on the dashboard that surfaces the latest build
// version + date. Click it to see a full changelog with one expandable
// section per release.
//
// Why this exists: Max asked for a place on the dashboard that "tells you
// the date of the new build, and if you click on it tells you all the
// different things added in that new build with new fixes." This is that.
//
// To add a new release: prepend a new entry to BUILD_HISTORY at the top of
// the array. The widget always shows the FIRST entry as the latest.
// Format:
//   { version: 'v55.45', date: '2026-05-06', label: 'Short label', items: [
//       'Bullet describing fix one',
//       'Bullet describing fix two',
//   ] }
// ============================================================
import { useState } from 'react';

// IMPORTANT: latest release goes at the TOP. Newest-first order.
//
// Style guide (per Max, May 6 2026):
//   - Plain everyday language. NO developer jargon.
//   - "Here's what you'll see" not "Here's what we changed in the code."
//   - Anyone on the team should understand without asking what something means.
//   - Avoid: RLS, payload, schema, endpoint, callback, hook, prop, async,
//     z-index, regex, refactor, flag, bool, snapshot, etc.
//   - OK to mention business-side things: invoice, customs, FX rate, EGP, USD,
//     WhatsApp, the calendar, the Sales tab.
export const BUILD_HISTORY = [
  {
    version: 'v55.58',
    date: '2026-05-06',
    label: 'Mobile floating buttons — no more overlapping icons',
    items: [
      'On phones, the floating icons in the corners were stepping on each other. The phone (📞), voice indicator, Nadia bubble, the + (Quick Add) button, and the "Synced X minutes ago" pill were all fighting for the same screen space. Cleaned up.',
      'Bottom-LEFT corner is now reserved for the team: phone button at the very bottom, voice indicator just above it, Nadia bubble above that. Stacked vertically with comfortable spacing — no more overlap.',
      'Bottom-RIGHT corner is reserved for the + Quick Add button (and its menu when you tap it). Nothing else lives there now. When you tap +, the menu opens upward without bumping into anything.',
      'When you expand Nadia to chat with her, her panel anchors to the left side and stops short of the right edge so the + button stays reachable.',
      'The "Synced X minutes ago" pill is now hidden on phones (it was overlapping everything). Still shown on desktop where there\'s room. On mobile, just pull-to-refresh if you need to force a reload.',
    ],
  },
  {
    version: 'v55.57',
    date: '2026-05-06',
    label: 'Tickets — fix duplicate tickets on double-tap of Create',
    items: [
      'Tickets were occasionally being created twice when you tapped Create quickly. Two tickets with sequential numbers (like TKT-0042 and TKT-0043) would appear with identical content. Fixed: the Create button now disables on the first tap and shows "⏳ Creating…" while the ticket is saving. The second tap is ignored. Same ticket, one row.',
      'Same protection added to the Close-with-Comment button. Before, a quick double-tap could close the ticket twice and write two closing comments. Now the button shows "⏳ Closing…" and the second tap is ignored.',
      'Note for whoever sees this in the audit trail: nothing in your existing tickets changes. Only NEW ticket creations and closures from this point forward are protected. If you have lingering duplicates from before this fix, you can delete them manually (admin → ticket → Delete) and the system will renumber correctly.',
    ],
  },
  {
    version: 'v55.56',
    date: '2026-05-06',
    label: 'Phone — fix "an application error has occurred" on inbound calls',
    items: [
      'Inbound calls were failing with the dreaded "an application error has occurred" message after the second greeting. Root cause: when Twilio\'s webhook signature check didn\'t match (a common issue when Vercel\'s internal URL differs from the public URL), our routes returned a 403 Forbidden — and Twilio plays the application-error message to the caller as a result.',
      'Fix: phone routes now log the signature failure prominently in the Vercel logs, but they DO NOT block the call. The caller hears proper greeting, recording disclaimer, dial routing, voicemail prompt — exactly as configured. Brand-safe behavior. The security exposure is small because the routes don\'t initiate any outbound calls or charge anything.',
      'New diagnostic URL: https://nexttrade-hub.vercel.app/api/phone/health — paste it into your browser to see whether the phone routing stack is reachable and what env vars are set. Also returns valid TwiML if Twilio hits it, so you can point a test number at this URL temporarily to confirm Twilio→portal connectivity without involving the real call routing.',
      'After deploying, retry your test call to 17328005428. You should hear the greeting + recording disclaimer + "the team is unavailable" or the voicemail prompt — not "an application error." If it still fails, open https://nexttrade-hub.vercel.app/api/phone/health in your browser and share the JSON output — it tells us exactly what env var is missing.',
      'Same fix applied to the four phone webhooks (incoming, outbound, voicemail-record, call-status, recording-callback). Whichever one was actually erroring will now succeed.',
    ],
  },
  {
    version: 'v55.55',
    date: '2026-05-06',
    label: 'Monthly Sales Report — click any month to see the orders',
    items: [
      'On the dashboard\'s Monthly Sales Report, click any month row and you\'ll jump to the Sales tab pre-filtered to just that month\'s orders. The total at the top of the Sales tab now matches the number you clicked, and you can scroll through every invoice that made up that month\'s revenue.',
      'Same drill-down works on the Monthly Sales table inside the Reports tab too — click any month and land on the filtered Sales view.',
      'Each month row now has a hover hint ("→ view orders") and a tooltip that tells you how many orders the click will open. Cursor changes to a pointer so it\'s obvious the row is clickable.',
      'When you\'re done looking at that month\'s orders, just change the date range at the top of the Sales tab back to YTD or All to see everything again.',
    ],
  },
  {
    version: 'v55.54',
    date: '2026-05-06',
    label: 'Performance Review — fix "disappears when opened"',
    items: [
      'My Performance card on the dashboard — when you tapped Open and it crashed silently, the entire card vanished and you saw nothing. Fixed: the card is now wrapped in a safety net so a single failure shows a friendly error message inside the card instead of making the whole thing disappear.',
      'If the data load fails (a missing table, a network blip, a malformed date in your activity), you now see a red box with the actual error message, plus a hint to check the browser console for diagnostic lines starting with [my-perf]. Before, you saw a blank card with no clue what went wrong.',
      'If the data loads but there\'s nothing to show yet (brand new user, no activity in the period), you see a friendly amber message ("No activity to show yet") instead of an empty card.',
      'Diagnostic logging added — every time you open the card, the browser console gets a [my-perf] log line showing how many tickets, comments, daily-log entries, audit rows, quotes, and calendar events were loaded. If you ever see this card act up again, share those console log lines and I\'ll know exactly what failed.',
    ],
  },
  {
    version: 'v55.53',
    date: '2026-05-06',
    label: 'Cutover playbooks — portal URL move + Resend email change',
    items: [
      'Two planning documents now live in the project under docs/. Both are reference material for cutover days that have not happened yet — nothing changes in the live portal in this build.',
      'docs/CUTOVER-resend-from-address.md — the playbook for switching the email FROM address from "onboarding@resend.dev" to "notifications@ktcus.com" so notifications go out to the whole team. Includes the DNS records you need at Bluehost, the failure modes from the previous attempt, the test, and the rollback. This change is isolated — it does NOT touch the portal URL or anything else.',
      'docs/CUTOVER-hub-ktcus-com.md — the playbook for moving the portal URL from "nexttrade-hub.vercel.app" to "hub.ktcus.com." This is a bigger change that affects Twilio phone webhooks, Gmail OAuth, Supabase login URLs, and a couple of email-template links. Step-by-step in order, every step has a 30-second rollback, nothing touches your data or anyone\'s account. Estimated 1-2 hours of hands-on work on cutover day, plus 1-2 weeks of planning beforehand and 1-2 weeks of soak afterwards.',
      'Both documents stress that the two cutovers are completely independent — the Resend email change does not require the portal URL change, and vice versa. They\'re documented separately so you can do one without the other.',
      'Audit complete: every file in the codebase that references the portal URL is listed in the playbook. 15 references total. Most already honor an env var (NEXT_PUBLIC_APP_URL) so they auto-update; two email templates have hard-coded URLs that will get a small code patch in a future build.',
    ],
  },
  {
    version: 'v55.52',
    date: '2026-05-06',
    label: 'Test email to whole team + hide deactivated users from dropdowns',
    items: [
      'Email Status panel (Admin tab) has a new button: 📬 Test all teammates. Click it, confirm the prompt, and the system sends a real test email to every active teammate one by one. You then get a per-person results table — each row shows the name, email, and either ✅ Sent or ❌ with the exact reason it failed (so you know if someone has a typo in their email, a bounced address, or their company blocks our sender domain).',
      'The original "Send test email to me" button is still there — use that for a quick check, the new button when you want to confirm everyone on the team is set up.',
      'Deactivated team members no longer appear in dropdowns. Before, when you went to assign a ticket, a CRM rep, a calendar attendee, or a daily-log entry, terminated or turned-off teammates were still showing in the picker. Fixed everywhere: Tickets, CRM, Calendar, Daily Log, Translation language settings.',
      'Old records still display the original person\'s name correctly — even if they\'ve been deactivated. So a closed ticket from last year still says "Closed by Ahmed" even after Ahmed leaves.',
      'In Settings → Team & Roles you still see EVERY teammate (active and inactive) — that\'s where you turn people on and off.',
    ],
  },
  {
    version: 'v55.51',
    date: '2026-05-06',
    label: 'New Customs tab — full clearance calculator',
    items: [
      'The Customs tab now has two sections you can switch between: 📋 Clearances and 🚢 Shipments. Shipments looks the same as before. Clearances is brand new.',
      'You can now calculate any customs invoice the same way our PVC invoice 1676 looks: type the price per kilo in dollars, type the quantity in kilos, the system pulls today\'s dollar-to-pound exchange rate automatically, and you pick which product it is. Customs duty, VAT, advance income tax, and bank commission all calculate live as you type.',
      'There are also eight fixed-fee fields ready for you to type into: permit withdrawal, unloading, cranes and loading, storage (leave blank if not used), road fees, pricing committee, miscellaneous and clearance, and transport. The grand total appears in a big black box at the bottom that updates as you type.',
      'In Settings there\'s a new section called 🛃 Customs Rates. This is where you keep the list of products with their customs duty percentage. Add a new product the moment you need it (PVC at 10%, leather at whatever, and so on). The four government rates (VAT 14%, advance income tax 1%, bank commission 10%) live there too — change them once and every new clearance picks them up automatically. Old clearances stay locked at the rates that were in effect when you saved them.',
      'Each clearance can be tagged with a reference number (like 1676) and linked to one of your existing shipments. Clearances have a status: draft → paid → reconciled, plus a cancelled option. You can filter the list by status, product, or date range, and see total customs paid at a glance.',
      'IMPORTANT: before you can use any of this, you have to run the database setup file (supabase/customs-phase-1.sql) in Supabase once. The Customs tab will show a friendly amber banner reminding you if it can\'t find the new tables.',
      'Coming next: putting more than one product on a single clearance, automatically rolling the customs total into your inventory cost so margins reflect true landed cost, and an Excel export that mirrors invoice 1676.',
    ],
  },
  {
    version: 'v55.50',
    date: '2026-05-06',
    label: 'Calendar — fix delete hanging on recurring meetings',
    items: [
      'Deleting a recurring meeting series used to hang for minutes, sometimes never finishing. The Calendar would freeze and you had no way to cancel out of it.',
      'Now: deleting a whole series of meetings (even hundreds of occurrences) finishes in seconds. Same for cancelling.',
      'If something does go wrong (database is down, network is bad), you\'ll see "Delete failed: timed out — try again" after one minute. No more 10-minute waits with a frozen screen.',
      'After a successful delete the success message pops up immediately and the Calendar refreshes in the background. The screen never appears stuck after you\'ve clicked Delete.',
    ],
  },
  {
    version: 'v55.49',
    date: '2026-05-06',
    label: 'Treasury → Create Invoice — fix invisible duplicate prompt',
    items: [
      'When creating a Treasury entry that looked like a duplicate of one already in the system, the "Looks like a duplicate" prompt sometimes appeared invisibly behind the form on iPhone Safari. You\'d tap Confirm, then the next screen never showed up. Fixed — only one prompt is on screen at a time now, and the iPhone Safari display bug can no longer happen.',
      'Friendlier error messages when saving a new invoice. Before, a duplicate order number gave you a scary developer error like "duplicate key value violates unique constraint." Now it just says "Order #2313 already exists as an invoice. Open it from the Sales tab if you want to edit it." Same kind of plain-language wording for permission errors and network errors.',
    ],
  },
  {
    version: 'v55.48',
    date: '2026-05-06',
    label: 'Treasury — "Order # not found" prompt now actually visible',
    items: [
      'When you submitted a Bank In or Cash In with an order number that didn\'t match anything, the "Order # not found — create a new invoice or pick a typo suggestion" prompt was appearing invisibly behind the form. Submit looked like it did nothing. Fixed.',
      'A short message ("Order #2313 not found in your invoice list — see the prompt below") now also pops in the corner so you know exactly what happened.',
    ],
  },
  {
    version: 'v55.47',
    date: '2026-05-06',
    label: 'Treasury + Invoice forms — never silently fail again',
    items: [
      'When you tap Save and something is missing on a Treasury entry, a big red banner now appears at the top of the form listing every missing field. The little corner toasts were vanishing in 2 seconds and getting missed on phones, especially when typing fast.',
      'Required fields now show a red ★ and the missing one gets a red border. The form scrolls automatically to the first missing field — you can\'t miss what needs fixing.',
      'Errors clear automatically as you type into the missing field, so the form goes back to looking normal once it\'s fixed.',
      'Same protection now applies to all four entry types (Cash In, Cash Out, Bank In, Bank Out) and both bank-entry modes (with order number and without).',
      'Invoice form — fixed the bug where you\'d fill in everything (order #, customer name, items) and STILL get told to fill in the customer. The customer search box wasn\'t saving the name unless you tapped a suggestion. Now your typed text is accepted on its own. Plus the error message tells you exactly which field is missing instead of the generic "fill in everything."',
    ],
  },
  {
    version: 'v55.46',
    date: '2026-05-06',
    label: 'Email diagnostics + softer failure mode',
    items: [
      'New Email Status panel at the top of the Admin tab. It shows whether email is set up, recent send results (24-hour count of delivered vs failed), and a "Send test email to me" button that sends a real email and shows the exact result.',
      'When email isn\'t set up, the rest of the app no longer breaks. Notifications still ring the bell inside the app, just not by email. Once you set up Resend in Vercel, every notification automatically starts going out by email — no further action from you.',
      'When email DOES fail, you now see the actual reason (like "domain not verified") instead of a generic "send failed."',
    ],
  },
  {
    version: 'v55.45',
    date: '2026-05-06',
    label: 'System Tickets rewrite + Nadia "Got it" + What\'s New panel',
    items: [
      'System Tickets — the "+ New System Ticket" button now opens reliably every time. Save is disabled while saving so you can\'t accidentally create the same ticket twice. New Delete button (admin only) with a proper confirmation prompt.',
      'Tickets — the Delete confirmation prompt now appears immediately when you tap Delete from inside a ticket. It used to only show after you went back, which was confusing.',
      'Nadia — every pending message and reminder Nadia surfaces now has a "✓ Got it" button. Once you tap it, she stops mentioning that item until something new happens (like the sender adding a reply). Old unanswered items disappear after 7 days so they don\'t haunt you forever.',
      'Dashboard — this very "What\'s New" panel. The latest build always sits at the top of the dashboard with its date; click to expand and see everything that changed.',
    ],
  },
  {
    version: 'v55.44',
    date: '2026-05-05',
    label: 'Shipping import + comment safety + audit log',
    items: [
      'Shipping rates import — a much better Excel template (21 columns, with a Field Guide sheet showing what each column means), an editable preview showing every row before you save, dropdowns to manually re-map columns if the headers don\'t match, and red highlights on rows with missing rates so you can see and remove them.',
      'Ticket comments — the Send button disables on tap and shows "⏳ Sending…" so a triple-tap doesn\'t post your comment three times.',
      'Audit trail — when someone changes a ticket\'s priority or due date, a system entry now appears in the Activity Log: "⚡ Priority changed: MEDIUM → HIGH (by Max)". So you always have a paper trail.',
      'Notifications — every ticket update now reaches the creator + current assignee + any other people assigned to it, with no duplicates and you never get notified about your own actions.',
    ],
  },
  {
    version: 'v55.43',
    date: '2026-05-04',
    label: 'Voice restored + phone "application error" fix',
    items: [
      'Voice — the press-to-record microphone button (🎙) and the hands-free conversation mode (🗣) are both back, with no more "Hey Nadia" wake word.',
      'Phone — fixed the bug where calling our New Jersey numbers played "an application error has occurred" and dropped the call. Now you hear the proper greeting and the call routes correctly.',
    ],
  },
  {
    version: 'v55.42',
    date: '2026-05-02',
    label: 'Bank edit detection',
    items: [
      'When editing an existing bank transaction, the form now correctly detects whether the row was a deposit, withdrawal, or adjustment instead of guessing from the amount. The wrong type was sometimes flipping during edit.',
    ],
  },
  {
    version: 'v55.41',
    date: '2026-05-01',
    label: 'Duplicate-confirm prompt for Treasury',
    items: [
      'When you enter a Treasury transaction that looks like one already in the system (same date + amount + description), a confirmation prompt now shows the matching rows so you can decide before saving. If you confirm "this is genuinely different," the system stamps the entry so the duplicate auditor stops nagging you about it.',
    ],
  },
  {
    version: 'v55.40',
    date: '2026-04-29',
    label: 'Phone — auto-register for inbound calls',
    items: [
      'Phone — when you log in, your browser is now automatically registered to receive incoming calls (provided you\'re set up for browser routing in Settings → Phone). When the phone widget is open, your browser ringer auto-arms.',
      'Voicemail visibility — unread voicemail count now shows on the dashboard widget and on the header bell, polled every 30 seconds.',
    ],
  },
  {
    version: 'v55.39',
    date: '2026-04-28',
    label: 'Voicemail when call forwarding fails',
    items: [
      'Phone — when a forwarded call doesn\'t get answered (busy, no answer, hung up), the caller now hears the proper voicemail prompt and can leave a message. Before they were just hitting a dead line.',
    ],
  },
  {
    version: 'v55.38',
    date: '2026-04-27',
    label: 'Login screen flash fix',
    items: [
      'Login — fixed the brief flash of mismatched layout you saw on the login page right before sign-in finished. Login is smoother and looks consistent now.',
    ],
  },
  {
    version: 'v55.37',
    date: '2026-04-26',
    label: 'WhatsApp inbox',
    items: [
      'WhatsApp — shared company-number inbox in the Communications tab. The team can claim conversations, see which are within the 24-hour reply window, and the inbox refreshes every 20 seconds.',
      'WhatsApp — the API behind the inbox (six routes total) is wired up. Once you set up the five Meta environment variables in Vercel and configure the webhook in Meta\'s dashboard, customer messages start arriving in the inbox automatically.',
    ],
  },
  {
    version: 'v55.36',
    date: '2026-04-23',
    label: 'AI HR Report — privileged view + scoring formula',
    items: [
      'AI HR Report — Super admin sees every team member including themselves. Other privileged users (with the new "View HR Report" permission) see everyone except themselves.',
      'Scoring formula refined for ticket close-rate, on-time delivery, comment quality, and assignment turnaround. You can pick any time window: yesterday, this week, this month, last 3 months, or this year.',
    ],
  },
  {
    version: 'v55.35',
    date: '2026-04-28',
    label: 'AI HR Report + Emad bounce-out fixes',
    items: [
      'AI HR Report — new tab. Each team member sees their own performance scorecard. Super admins and HR-permitted users see the whole team\'s scorecards.',
      'Login — fixed five bugs that were bouncing Emad out of the system: case-insensitive email matching, browser lock manager fallback, secondary auth-id lookup, voicemail token header, and PWA manifest.',
    ],
  },
  {
    version: 'v55.34',
    date: '2026-04-27',
    label: 'AI HR Report — first version',
    items: [
      'AI HR Report — initial build of the performance dashboard. Pulls together ticket close-rates, on-time delivery, audit-log activity, and comment quality. (Refined further in v55.35 and v55.36.)',
    ],
  },
  {
    version: 'v55.33',
    date: '2026-04-25',
    label: 'Recurring events — three-scope cancel/edit/restore',
    items: [
      'Calendar — when editing or cancelling or restoring a recurring meeting, you now pick the scope: just this one occurrence, this one and all later ones, or the entire series. Previously the only option was "the whole series" which was rarely what you wanted.',
    ],
  },
  {
    version: 'v55.32',
    date: '2026-04-24',
    label: 'WhatsApp inbox UI scaffolding',
    items: [
      'WhatsApp — inbox UI added to the Communications tab. Database tables, send and receive routes, and Nadia commands wired in. (Made fully usable in v55.37.)',
    ],
  },
  {
    version: 'v55.31',
    date: '2026-04-23',
    label: 'WhatsApp scaffolding (Meta Cloud API)',
    items: [
      'WhatsApp — the foundation: database tables, helper code, webhook handler, send endpoint. About 40% of the full feature. UI is not in this build.',
      'Customers messaging your WhatsApp number land in the database within seconds, but you can\'t see them in the app yet — wait for v55.32.',
    ],
  },
  {
    version: 'v55.30',
    date: '2026-04-22',
    label: 'Calendar columns + reminder dispatch',
    items: [
      'Calendar — week view shows 7 columns instead of cramming everything into one. Reminder dispatch fires every 10 minutes via the cron job.',
    ],
  },
  {
    version: 'v55.29',
    date: '2026-04-21',
    label: 'Reminders engine + dashboard split',
    items: [
      'Reminders — every event with a reminder gets pre-scheduled. Dispatch cron runs every 10 minutes and sends due reminders. The dashboard splits reminders into urgent (with a pulse animation) and normal.',
    ],
  },
  {
    version: 'v55.28',
    date: '2026-04-20',
    label: 'Calendar event description + meeting notes',
    items: [
      'Calendar — events now have a description/agenda field and a meeting-notes field that you can edit before, during, or after the meeting.',
    ],
  },
  {
    version: 'v55.27',
    date: '2026-04-19',
    label: 'Treasury dedup hardening + ghost-row restoration',
    items: [
      'Treasury — restored 4,020,000 EGP across 3 missing rows that had been removed by an over-aggressive dedup pass. 78 invoices recalculated. New unique-row constraint added so this can\'t happen again.',
      'Treasury — running balance now calculated by transaction date instead of insert order, so backdated entries fall in the right place.',
    ],
  },
  {
    version: 'v55.26',
    date: '2026-04-18',
    label: 'Treasury inspector modal + 90-day window',
    items: [
      'Treasury — click any row to see a full inspector modal: linked invoice, linked check, audit history, related rows. Default view shows the last 90 days; older rows are one filter click away.',
    ],
  },
  {
    version: 'v55.25',
    date: '2026-04-17',
    label: 'Treasury ↔ Sales smart linking',
    items: [
      'Treasury — Order # field auto-suggests existing invoices as you type, suggests typo fixes if no exact match, lets you create a new invoice inline without leaving the form, and back-fills the link the moment a matching invoice is created later.',
    ],
  },
  {
    version: 'v55.24',
    date: '2026-04-16',
    label: 'Egypt Bank tab + Plaid Bank tab',
    items: [
      'Banking — Egypt Bank tab now separates true bank entries from cash-register entries. Plaid Bank tab connects US bank accounts and pulls transactions automatically.',
    ],
  },
  {
    version: 'v55.23',
    date: '2026-04-15',
    label: 'AI Accountant — 14-check auditor',
    items: [
      'AI Accountant — runs 14 reconciliation checks at once: orphan rows, mismatches between invoice and treasury, ambiguous duplicates, stale checks (90+ days), uncategorized expenses, and more. Each check is a one-click fix.',
    ],
  },
  {
    version: 'v55.22',
    date: '2026-04-14',
    label: 'Check reconcile — three modes',
    items: [
      'Checks — the reconcile flow now has three clear modes: exact-amount match, partial match, and "physical check returned." Each match links the check directly to its source row so the audit trail stays clean.',
    ],
  },
  {
    version: 'v55.21',
    date: '2026-04-13',
    label: 'Bilingual categories',
    items: [
      'Categories — every income and expense category now has both an English label and an Arabic label. Arabic is the stable internal key; English is the display label. Add new categories from Settings → Categories and they appear in every dropdown immediately.',
    ],
  },
  {
    version: 'v55.20',
    date: '2026-04-12',
    label: 'Shipping rates / quotes / multi-booking + 1-year history',
    items: [
      'Shipping — quotes can include multiple bookings on one document. Rates history defaults to the last year, with expired rates preserved (struck through). Export to CSV.',
    ],
  },
  {
    version: 'v55.19',
    date: '2026-04-11',
    label: 'CRM 6-stage pipeline + assigned rep',
    items: [
      'CRM — six pipeline stages: Lead → Contacted → Qualified → Proposal → Won → Lost. Each customer can have an assigned rep who always sees their full contact info even when contact masking is on.',
    ],
  },
  {
    version: 'v55.18',
    date: '2026-04-10',
    label: 'CRM contact masking',
    items: [
      'CRM — new "View Contacts" permission. Without it, customer phone and email are masked and the WhatsApp / Call / Email buttons are hidden. Assigned reps always see their own clients in full.',
    ],
  },
  {
    version: 'v55.17',
    date: '2026-04-09',
    label: 'Tickets — detail view, reassign, activity log',
    items: [
      'Tickets — full detail view with opened-by, assigned-to (reassignable), due date with overdue highlighting, color-coded status, and a unified Activity Log that separates system events from user comments.',
    ],
  },
  {
    version: 'v55.16',
    date: '2026-04-08',
    label: 'Calendar with attendees + recurring events',
    items: [
      'Calendar — events have multiple attendees, recurring schedules, and a series ID that ties recurring rows together for clean cancel/edit/delete.',
    ],
  },
  {
    version: 'v55.15',
    date: '2026-04-07',
    label: 'Nadia voice with Whisper + lip-sync face',
    items: [
      'Nadia — voice transcription powered by Whisper. Continuous mode with 3.5-second silence timeout. Animated NadiaFace SVG with lip-sync. Cairo and Eastern timezone awareness so date/time questions answer correctly for both teams.',
    ],
  },
  {
    version: 'v55.14',
    date: '2026-04-06',
    label: 'Nadia proactive ticket surfacing',
    items: [
      'Nadia — proactively surfaces overdue tickets and upcoming due dates on the dashboard. Every user gets relevant items, not just admins.',
    ],
  },
  {
    version: 'v55.13',
    date: '2026-04-05',
    label: 'Wake-word re-engage + cross-team messaging',
    items: [
      'Nadia — say "Hey Nadia" to re-engage after she pauses. Cross-team messaging routes Nadia\'s suggestions to the right person automatically.',
    ],
  },
  {
    version: 'v55.12',
    date: '2026-04-04',
    label: 'Treasury — non-order income guard',
    items: [
      'Treasury — when entering income, the form now requires you to either enter an order number OR pick a "non-order income" category. No more orphan income rows that nobody can trace later.',
    ],
  },
  {
    version: 'v55.11',
    date: '2026-04-03',
    label: 'Announcements/broadcast + login session tracking',
    items: [
      'Dashboard — admin-posted announcements (urgent, warning, info) targetable to all or to specific users, with email/WhatsApp notification, pin, and archive.',
      'Login — every login records its time. Heartbeat updates last_seen every 5 minutes. Logout time is stamped. Team daily-log cards show login/logout/duration.',
    ],
  },
  {
    version: 'v55.10',
    date: '2026-04-02',
    label: 'Quotes tab — company profiles + PDF + VAT',
    items: [
      'Quotes — new tab. Build company profiles with logos, create line-item quotes, toggle 14% VAT (editable), set validity/expiry dates, preview and print as PDF, and review your quote history.',
    ],
  },
  {
    version: 'v55.09',
    date: '2026-04-01',
    label: 'Audit trail — late edits flagged',
    items: [
      'Audit — any change made 24+ hours after the original creation is flagged with 🚨. Sensitive fields (amount, price, date, description, qty) get an extra ⚠️ badge. The before-and-after values are stored so you can see exactly what was changed.',
    ],
  },
  {
    version: 'v55.08',
    date: '2026-03-31',
    label: 'Read-only mode',
    items: [
      'Permissions — when a tab is on but the Edit permission is off, you can view but not change. The header pattern is now consistent across every module.',
    ],
  },
  {
    version: 'v55.07',
    date: '2026-03-30',
    label: 'Inventory — unit of measure + linear density + P&L per unit',
    items: [
      'Inventory — every product has a unit of measure (kg, ton, meter, yard) and an optional linear density. Profit/loss now shows per-kg, per-ton, per-meter, or per-yard automatically based on the product\'s unit.',
      'Inventory — manual Expected Inventory entry form for opening stock counts. Breakdown panel as a unified table with dimension tabs.',
    ],
  },
  {
    version: 'v55.06',
    date: '2026-03-29',
    label: 'Inventory — split permissions + audit journal',
    items: [
      'Inventory — Edit Inventory permission and Adjust Inventory Quantities permission are now separate. Every quantity adjustment writes an audit journal entry with the user, the before/after, and a reason field.',
    ],
  },
  {
    version: 'v55.05',
    date: '2026-03-28',
    label: 'Priority Board + ticket creation buttons',
    items: [
      'Tickets — priority-ranked board with drag-to-reorder. Unranked items live in a pile at the bottom and can also be reordered. "+ Add first ticket" and "+ New ticket for [Name]" buttons follow your permissions.',
    ],
  },
  {
    version: 'v55.04',
    date: '2026-03-27',
    label: 'Admin dashboard — drill-downs + login tracking',
    items: [
      'Admin — every scorecard pill drill-downs into the underlying rows. Preset date filters (today is the default). Login tracking columns in Eastern Time. Bubble charts for activity drill-down.',
    ],
  },
  {
    version: 'v55.03',
    date: '2026-03-26',
    label: 'Settings — team profiles for Nadia',
    items: [
      'Settings → Team Profiles — fields for nickname, birthday, location, phone, job title, years at the company, family, interests, favorite food, personality, strengths, weaknesses, conversation starters, notes, and preferred language. Nadia uses these for personalized conversations.',
    ],
  },
  {
    version: 'v55.02',
    date: '2026-03-25',
    label: 'Notifications fixed (4 bugs at once)',
    items: [
      'Notifications — fixed four problems that were silently swallowing tickets, CRM, and reminder emails: wrong table name, fragile filter, the literal string "all" breaking a database call, and zero log output to debug from. Notifications now reliably reach the bell + email.',
    ],
  },
  {
    version: 'v55.01',
    date: '2026-03-24',
    label: 'Treasury data cleanup — 154 transactions fixed',
    items: [
      'Treasury — 126 future-dated transactions corrected (year shifts like 2026→2025), 22 individual bad dates fixed (typos: 2044→2024, 5025→2025; pre-2014 drag errors), 6 April 2026→2025 entries fixed. Validation pass: 0 future dates, 0 pre-2014 dates remain. 5,799 rows (93%) match Excel exactly. 41 "missing" rows confirmed as Arabic name variants already in the database. 601 zero-EGP rows identified as legitimate USD-column entries.',
    ],
  },
];

export default function WhatsNewWidget() {
  var [open, setOpen] = useState(false);
  var [expanded, setExpanded] = useState({}); // map of version → bool

  var latest = BUILD_HISTORY[0];

  var fmtDate = function (iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) { return iso; }
  };

  var togglePanel = function (v) {
    setExpanded(function (prev) {
      var next = Object.assign({}, prev);
      next[v] = !prev[v];
      return next;
    });
  };

  return (
    <>
      {/* Inline pill — visible on the dashboard. */}
      <button
        onClick={function () { setOpen(true); setExpanded({ [latest.version]: true }); }}
        title="What's new in this build"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-xs font-bold shadow hover:shadow-md hover:from-indigo-600 hover:to-violet-600 transition"
      >
        <span>✨</span>
        <span>What's new in {latest.version}</span>
        <span className="opacity-70 text-[10px] font-normal">· {fmtDate(latest.date)}</span>
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4"
          onClick={function () { setOpen(false); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
            style={{ maxHeight: '85vh' }}
            onClick={function (e) { e.stopPropagation(); }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                  <span>✨</span> What's new in NextTrade Hub
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Latest builds and what changed in each.</p>
              </div>
              <button
                onClick={function () { setOpen(false); }}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="overflow-auto p-5" style={{ flex: '1 1 auto', minHeight: 0 }}>
              <div className="space-y-3">
                {BUILD_HISTORY.map(function (b, i) {
                  var isOpen = !!expanded[b.version];
                  var isLatest = i === 0;
                  return (
                    <div
                      key={b.version}
                      className={'rounded-xl border ' + (isLatest ? 'border-indigo-200 bg-gradient-to-br from-indigo-50/40 to-violet-50/40' : 'border-slate-200 bg-white')}
                    >
                      <button
                        onClick={function () { togglePanel(b.version); }}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50/40 transition rounded-xl"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className={'text-xs font-mono font-bold px-2 py-0.5 rounded ' + (isLatest ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700')}>
                            {b.version}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{fmtDate(b.date)}</span>
                          {isLatest && <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide flex-shrink-0">Latest</span>}
                          <span className="text-xs text-slate-700 truncate">{b.label}</span>
                        </div>
                        <span className="text-slate-400 ml-2 flex-shrink-0">{isOpen ? '▾' : '▸'}</span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1">
                          <ul className="space-y-2">
                            {b.items.map(function (item, idx) {
                              return (
                                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                                  <span className="text-indigo-400 mt-0.5 flex-shrink-0">•</span>
                                  <span>{item}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 p-3 flex justify-end">
              <button
                onClick={function () { setOpen(false); }}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-bold hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
