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
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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
    version: 'v55.73',
    date: '2026-05-08',
    label: 'AI assistant experience improvements',
    items: [
      // PUBLIC bullet — high-level wording only, no internal details
      'Improvements were made to the AI assistant experience for Nadia, Ms. Jenna, and Sara. The Executive Assistant, HR Representative, and Work Coach experiences are now more polished, more responsive, and easier to use.',
      // SUPER_ADMIN ONLY — confidential AI architecture
      { superAdminOnly: true, text: 'AssistantController architecture: ONE BRAIN, THREE PERSONAS. The existing Nadia voice/listening/recording/execution engine is preserved. A new persona layer reads from src/lib/agent-personalities.js and swaps avatar, name, role, greeting, voice ID, system prompt, allowed actions, forms, dashboard modules, routing rules, and confirmation messages based on which agent is active.' },
      { superAdminOnly: true, text: 'Active-state visual feedback per Max\'s spec: only one assistant active at a time; Nadia is the default; the active tile gets a colored glow, pulsing animation, accent ring, "IN CONTROL" badge, and a top-left "ACTIVE" dot. Inactive tiles are slightly dimmed (opacity-90).' },
      { superAdminOnly: true, text: 'Sara loading hang fixed: when myId hadn\'t hydrated yet (userProfile still loading), the effect bailed at line 54 leaving loading=true forever. Now: clean exit to empty-state UI, 8-second hard timeout with retry button, and a Sara-voiced "I don\'t see enough activity data yet" fallback.' },
      { superAdminOnly: true, text: 'HR Desk routing now actually dispatches /api/notify (was a no-op before — row inserted but nobody notified). Recipients built from radio choice + super_admin always CC\'d, deduped, self excluded. Complaint dispatch always to super_admin only. Routing per persona codified in agent-personalities.js routingRules.' },
      { superAdminOnly: true, text: 'High-contrast radio button picker replaces yellow-on-yellow auto-routing badge in HR forms. Manager radio shows manager name; Mr. Kandil radio shows super_admin name. Friendly heads-up when user picks against category default.' },
      { superAdminOnly: true, text: 'RLS policies for hr_requests + hr_complaints — fixes "TypeError: Load failed" on submit. Complete idempotent SQL bundle delivered (v55_73_SQL_BUNDLE_RUN_THIS.sql) with BEFORE/AFTER state notices.' },
      { superAdminOnly: true, text: 'Voice infrastructure future-ready: each persona has a voice config block (provider, voiceId, pitch, speed, style, browserFallback). ElevenLabs placeholder voice IDs in place; swap to KTC-licensed voices is a one-file edit. See docs/VOICE-INFRASTRUCTURE.md.' },
      { superAdminOnly: true, text: 'Personality intros at top of every panel and modal: photo + "Hi, I\'m [Name]" + role badge + warm greeting from agent-personalities.js. Sara opens with "Hey," (energetic-coach tone) instead of "Hi,".' },
      { superAdminOnly: true, text: 'Build notes filter: introduces superAdminOnly tier on top of existing adminOnly. AI architecture details are super_admin only; admins + employees see only the high-level public bullet.' },
      { superAdminOnly: true, text: 'Clean professional error messages replace raw technical errors: "We couldn\'t submit this right now. Please try again, or contact your manager." Real error stays in console for debug.' },
    ],
  },
  {
    version: 'v55.72',
    date: '2026-05-07',
    label: 'Real photos for the three agents · reminder formatting preserved',
    items: [
      // PUBLIC bullet — high-level wording about AI work, no internals
      'Updates were made to the AI assistant experience for Nadia, Ms. Jenna, and Sara — including how they appear on the dashboard.',
      // PUBLIC bullet — non-AI work everyone can see in detail
      'REMINDERS PRESERVE YOUR FORMATTING. When you post a reminder or announcement, it now lands in your team\'s inboxes formatted exactly the way you typed it. Line breaks are preserved. Blank lines become paragraph breaks. Lines starting with -, *, or • become a clean bulleted list. Lines starting with 1., 2., 3. become a numbered list. No more wall-of-text emails.',
      // PUBLIC — non-AI
      'BIGGER COMPOSE BOXES for reminders and announcements with placeholder text showing examples of bullet and numbered formatting. A small green hint underneath each box confirms "Line breaks, paragraphs, and bullet/numbered lists preserved."',
      // SUPER_ADMIN ONLY — AI internals
      { superAdminOnly: true, text: 'THREE REAL FACES FOR YOUR AGENTS. The illustrated cartoon avatars are replaced. Nadia, Jenna, and Sara now appear as real photographs on the dashboard. Each photo is a circular headshot with a soft inner ring inside its color-themed tile, and tilts gently when you hover. Photos are crisp at 512×512 and load fast (~120KB each).' },
      { superAdminOnly: true, text: 'WHY REMINDERS WERE BROKEN. Three separate places were collapsing formatting: (1) the email body builder dropped raw text into a div which ignores line breaks, (2) the team-reminder send flow was passing only the subject line and not the body, (3) the in-app reminder card view collapsed everything into one line. All three fixed.' },
    ],
  },
  {
    version: 'v55.71',
    date: '2026-05-07',
    label: 'AI assistant experience improvements',
    items: [
      // PUBLIC — high-level only
      'Work was completed on the AI world-class assistant feature. The HR Representative, Work Coach, and Executive AI Assistant experiences are now more visible and easier to use from the dashboard.',
      // SUPER_ADMIN ONLY — internals
      { superAdminOnly: true, text: 'YOU NOW HAVE THREE PARTNERS. Three really big avatar tiles dominate the top of every dashboard: Nadia (Executive Assistant) on the left, Jenna (HR Representative) in the middle, Sara (Work Coach) on the right.' },
      { superAdminOnly: true, text: 'NADIA AUTO-OPENS HER MORNING BRIEF on first daily load — tells you what\'s urgent: tickets needing acknowledgment, items due today, anything overdue, and checks due.' },
      { superAdminOnly: true, text: 'JENNA EXPANDS into the full HR Desk inline — file requests (vacation, sick leave, raise, etc.), raise concerns, see super_admin responses.' },
      { superAdminOnly: true, text: 'SARA IS NEW — your work coach who scores your performance, surfaces growth feedback. Her panel mounts the Performance Coach inline.' },
      { superAdminOnly: true, text: 'NEVER DISAPPEAR. The three tiles are the very first thing on screen and they stay put. Each panel mounts the deeper component only when expanded — single render tree pattern from v55.68.' },
    ],
  },
  {
    version: 'v55.70',
    date: '2026-05-07',
    label: 'Two big assistants on the dashboard: Nadia (executive secretary) + Jenna (HR coach)',
    items: [
      'CLEAN ORGANIZATION FOR THE DASHBOARD. Two big animated avatar tiles now sit at the very top — Nadia on the left (your executive secretary) and Jenna on the right (your HR rep / relationship coach). Each is a friendly illustrated character with their own role badge, a one-line summary of what\'s waiting for you, and a notification count if there\'s something pending. Click either tile to expand into the full experience below.',
      'NADIA gives you a MORNING BRIEF — at a glance you see how many tickets need acknowledgment, how many are due today, how many are overdue, and any checks due. If everything\'s clear, she just says "all caught up — no urgent items today." Click her tile and you scroll straight to her chat surface where she goes deeper.',
      'JENNA gives you TODAY\'S AGENDA — at a glance you see how many HR requests are pending, how many concerns are pending, and especially highlights any new responses from super_admin (with a green pulse so you know there\'s news). Click her tile and you scroll straight to the HR Desk + Performance Coach where you can file requests, see your scoring, and get coaching feedback.',
      'BOTH AVATARS ARE ALIVE — they wave periodically (Nadia tilts her tablet, Jenna waves her hand with motion lines) and respond to hover. The motion is offset so they don\'t move in lock-step — feels like two real people on screen, not a robot.',
      'NEVER DISAPPEAR — the AssistantsBar is rendered outside any loading gate and uses the single-render-tree pattern from v55.68, so the two big avatars are the first thing you see and they stay put no matter what.',
      'CARRIES FORWARD all v55.65/66/67/68/69 work: HR Desk + Performance Coach with no remount disappearance, instant ticket title/description edits with optimistic UI + back button always works, HR routing rules (manager vs super_admin), Shipping list view, Customs Excel import, Nadia anti-repetition + loading-screen presence, voicemail fix, WhatsNew filtering of build internals from non-admins.',
    ],
  },
  {
    version: 'v55.69',
    date: '2026-05-07',
    label: 'Ticket edits instant + Back always works · HR routing auto-picks where to send',
    items: [
      'TICKET EDITS ARE NOW INSTANT. Bug Max May 7 2026: editing a ticket title or description felt slow — the Save button stayed on "Saving..." for 1-3 seconds, and during that time clicking Back did nothing. Root cause: the database write involved THREE round trips to the server (read old values → save the change → write an audit comment), all blocking the UI. Fix: the moment you click Save, the UI exits edit mode immediately and you see your edit applied. The actual database save happens entirely in the background. If anything goes wrong, your text is restored and the editor re-opens with an error message — your work is never lost.',
      'BACK BUTTON ALWAYS WORKS on a ticket. Click Back any time, even mid-save → instantly returns to the ticket list. If you save an edit and immediately click Back (or open a different ticket), the background save still completes correctly because the system snapshots the ticket reference at the moment you clicked Save.',
      'HR REQUESTS NOW ROUTE AUTOMATICALLY based on what you pick. Only the operational topics — vacation, sick leave, schedule change, recognize a teammate — go to your manager. Everything else (raises, promotions, training, expense, transfer, flexible hours, remote work, equipment, other) goes straight to super_admin and stays hidden from regular admins. You no longer have to think about who to route it to — picking the topic IS the routing decision.',
      'NEW ICON-TILE TOPIC PICKER replaces the old dropdown. Two clearly labeled groups: "👤 Goes to your manager" (4 blue tiles) and "🔒 Goes to super_admin only — admins can\'t see" (9 violet tiles). Tap the icon for the topic you want. The selected tile lights up. Below the picker, a colored "📨 Goes to:" badge confirms exactly where the request will land.',
      'AUTO-ROUTING is the single source of truth. Even if the form somehow gets stale, the system re-derives the routing at submit time from your picked topic. No way to accidentally send a raise request to your manager or a vacation request only to super_admin.',
      'COMPLAINTS UNCHANGED — they always go straight to super_admin (sensitive by definition), with anonymous-to-admins on by default. Updated complaint topic dropdown to show the icon next to each label for clarity.',
      'ADMIN HR INBOX shows clear routing badges: "🔒 super_admin only" (violet) for sensitive items, "👤 Manager-handled" (blue) for routine operational ones, so reviewers see at a glance which queue an item is in.',
      'CARRIES FORWARD all v55.65/66/67/68 work: HR Desk + Performance Coach never disappear (single render tree), Maya the HR mascot, Nadia anti-repetition, voicemail fix, Shipping list view, Customs Excel import, System Tickets retest workflow, WhatsNew filtering for non-admins.',
    ],
  },
  {
    version: 'v55.68',
    date: '2026-05-07',
    label: 'HR Desk + Performance Coach NEVER disappear · single render tree fix',
    items: [
      'STOPPED THE DISAPPEARING. Both the HR Desk card and the Performance Coach card were appearing on first load and then vanishing for a moment when the rest of the dashboard data finished loading. Root cause was technical: the dashboard had two different "states" (loading vs loaded) and React was throwing the cards away and re-creating them every time it switched between states. Fixed by rendering them in ONE place that stays mounted no matter what — they appear once on login and stay on screen permanently. No more flicker, no more vanish, no more re-fetching their data every time something on the dashboard updates.',
      'HR DESK WORKFLOW VERIFIED end-to-end: you file a request (vacation, equipment, raise, training, etc.) or a confidential concern → it lands in Admin → HR Inbox with the right visibility (super_admin sees all, admins see admin-visible requests + only non-anonymous complaints) → super_admin reviews, picks a status, writes a decision note → you see the response right back on your dashboard with a colored status badge (Approved, Denied, Investigating, etc.) and a pulse indicator if there is news for you. 26 end-to-end workflow tests + edge-case coverage all pass.',
      'PERFORMANCE COACH ("rah-rah" coach) — visible to every user, fully restored. Shows your activity numbers, scoring tiles, growth deltas, daily-log streak, meeting show-up rate, and an AI-coach-feedback button that gives a personalized pep talk. Fetches its own data so a flaky network on other dashboard queries doesn\'t affect it. Stays put — never blanks out, never flickers.',
      'CARRIES FORWARD all v55.65/66/67 work: HR Desk + AdminHRInbox, Nadia anti-repetition + loading screen pill, voicemail "couldn\'t hear you" fix, Shipping list view, Customs Excel import, System Tickets retest workflow, WhatsNew filtering of build internals from non-admins.',
    ],
  },
  {
    version: 'v55.67',
    date: '2026-05-07',
    label: 'Performance Coach back for everyone · build notes hide internals from non-admins',
    items: [
      'PERFORMANCE COACH RESTORED for all users. The previous build had hidden it behind admin/super_admin only — that was a misread of the request. The coach card, the activity tiles, the streak, the AI pep-talk button — all back the way they were originally. Only the team-wide HR REPORT (in Admin → HR Report) stays admin-gated, which it always has been.',
      'WHAT\'S NEW build notes — items that describe the internal scoring algorithm, HR Coach implementation, retest pipeline mechanics, and similar build internals are now ADMIN/SUPER_ADMIN ONLY. Regular users still see the entry exists ("v55.65 shipped these things") but do not see the internals of how the AI scoring works under the hood.',
      { adminOnly: true, text: 'IMPLEMENTATION NOTE — entries can now be marked { adminOnly: true } to hide individual bullet items from non-admin users while keeping the rest of the build entry visible. Whole entries can also be marked { adminOnlyEntry: true } to hide them entirely.' },
    ],
  },
  {
    version: 'v55.66',
    date: '2026-05-07',
    label: 'HR Desk persistence + Shipping list view restored',
    items: [
      'MY HR DESK NEVER DISAPPEARS. Bug: the HR card was vanishing after the first dashboard load if any other query failed (a flaky network blip on tickets / calendar / follow-ups was enough to send the whole dashboard back to "Loading…"). Three fixes: (1) HR Desk now renders BEFORE the loaded gate so it appears instantly, (2) every dashboard query now has its OWN try/catch so one failure can\'t blank the dashboard, (3) setLoaded(true) ALWAYS fires no matter what. Result: the HR card is the first thing on screen and stays put forever.',
      'SHIPPING RATES — LIST VIEW RESTORED. New "🗂 Routes / 📋 List" toggle pill at the top of the Rates tab. Routes is the bucket card grid (default, unchanged). List is every individual rate as a row in a sortable table — click any column header to sort (ETD, Origin, Destination, POL, POD, Vendor, Line, TT, FT, Rate, Expires). Click any row to jump into the same route detail screen. Inline edit button per row. Expired rates dimmed but still visible. Your view-mode preference is saved per browser so it sticks across sessions.',
      'CARRIES FORWARD all v55.65 work: My HR Desk with animated Maya mascot + request/complaint flow to super_admin, AI Performance Coach scoring with meeting check-ins, System Tickets fix-in-build/retest workflow, Nadia anti-repetition + loading-screen presence pill, voicemail "We couldn\'t hear you" fix.',
    ],
  },
  {
    version: 'v55.65',
    date: '2026-05-07',
    label: 'AI Performance Coach gets a logo + meeting check-ins + bug-report scoring · System Tickets retest workflow · Build highlights auto-pull bug fixes',
    items: [
      // v55.67 — internal scoring/algorithm details are admin/super_admin only.
      // The functionality is for everyone; the build narrative is just hidden
      // for non-admins so they don't see the under-the-hood mechanics.
      { adminOnly: true, text: 'AI PERFORMANCE COACH — new logo (rising bars + coach speech bubble) sits next to the title so the card is unmistakable on the dashboard. Three new metric tiles: "Meetings You Set Up", "Meetings You Signed Into" (the actual check-in count, not just the invite list), and "Show-Up Rate" (of meetings you organized that have already happened, how many you actually attended). The show-up rate is color-coded: green ≥80%, amber 50-79%, rose under 50%.' },
      { adminOnly: true, text: 'AI PERFORMANCE COACH — bug reporting now factors into your score. New tiles: "Bug Reports Filed" (system tickets you opened, with how many already shipped a fix) and "Bugs You Retested" (closing the loop after Claude fixes one).' },
      { adminOnly: true, text: 'SCORING ALGORITHM rebuilt to match what mature HR software (Lattice / 15Five / Culture Amp / Workday Talent) measures: PRODUCTIVITY 35% · QUALITY 15% · TIMELINESS 20% · ENGAGEMENT 20% · RELIABILITY 10%. Quality looks at quote acceptance rate, bug-fix rate on tickets you filed, and meeting show-up. Reliability is meeting show-up + retest follow-through. Score itself stays admin-only on HR Report; the self-view shows growth-oriented coach text only.' },
      { adminOnly: true, text: 'SYSTEM TICKETS — when an admin checks "🤖 Fix next session" on a ticket, that ticket goes into Claude\'s queue. After Claude ships a fix in the next build, the admin clicks "📦 Mark fixed in build", picks the build version, and writes test notes. Three things happen automatically: (1) the ticket is tagged with the build version + fix notes, (2) the original creator sees a pulsing "🔁 Bugs to retest" card on their dashboard, (3) the bug shows up in this What\'s New under "Bugs fixed in this build".' },
      { adminOnly: true, text: 'SYSTEM TICKETS — creator clicks "🔁 Retest now" → picks "✓ Works perfectly", "~ Partly works", or "✗ Still broken" + adds notes. Passed → ticket closes. Failed → ticket reopens AND goes back into Claude\'s queue automatically. Partial → recorded for the record without closing.' },
      'WHAT\'S NEW — this section now auto-pulls bugs fixed in the latest build directly from your system_tickets table. So bug fixes appear here as build highlights without anyone having to copy-paste them.',
      { adminOnly: true, text: 'DATABASE — needs one small SQL run for the new columns (claude_fixed_in_build_version, needs_retest, retest_completed_at, retest_completed_by, retest_outcome, retest_notes). Open Supabase → SQL Editor → paste sql/s40_system_tickets_retest.sql → Run. Idempotent so re-running is safe.' },
      'CARRIES FORWARD all changes from v55.62, v55.63, and v55.64: deactivated-user fixes, Customs tab Excel import + template with Shipment Reference, Shipping Rates port-level filtering with FT/ETD/TT columns, What\'s New since-last-login tracking with 100-build cap.',
      'VOICEMAIL FIX — callers couldn\'t leave a message and kept hearing "We couldn\'t hear you". Root cause: Twilio\'s `trim-silence` setting on the recording was aggressively chopping audio when it detected ambient silence, returning a zero-duration recording. Fix: switched to `do-not-trim`, added a 10-second `timeout` so callers have time to start speaking, and a 1-second `Pause` between the beep and the recording start so the beep audio doesn\'t bleed in. Applied in all three voicemail entry points (incoming-call fallback, no-routing branch, no-answer branch).',
      'MY HR DESK — brand new prominent dashboard card at the very top of every team member\'s home screen. Animated mascot (Maya) with a waving arm that gets attention every 12 seconds. Two big buttons: "📝 File a Request" (vacation, equipment, raise, training, schedule, recognition, expense, etc — 13 categories) and "🛡️ File a Concern" (interpersonal, manager, harassment, discrimination, safety, workload, pay — 11 categories). Each submission gets a friendly reference number (HR-2026-0001, HRC-2026-0001) and shows status updates right on the dashboard. Routine requests visible to admins and super_admin; concerns go straight to super_admin and stay anonymous to other admins by default.',
      { adminOnly: true, text: 'HR INBOX (admin / super_admin tab) — new section in Admin: super_admin sees every request and every complaint with full submitter identity. Regular admins see admin-visible requests + only non-anonymous complaints; everything else is hidden with just a "N confidential complaint(s) visible only to super_admin" counter. Reviewer can update status, write a decision/resolution note that the submitter sees on their dashboard, and the system auto-records who reviewed it and when.' },
      'NADIA SMARTER — Nadia was greeting people the same way every login. Now she varies her openings, picks different items to lead with, and feels like a real colleague noticing new things instead of a stuck record.',
      'NADIA AVAILABLE EARLIER — small "Nadia is here · getting your day ready…" pill now appears on the loading screen so she feels present from the very first second.',
    ],
  },
  {
    version: 'v55.64',
    date: '2026-05-07',
    label: 'Customs — bulk import from Excel + template; AI Performance Coach back on dashboard; Shipping rates by EXACT port + What\'s New consolidates everything since your last login',
    items: [
      'CUSTOMS — Bulk import historical clearances from an Excel file. New green "📥 Import from Excel" button on the Customs tab opens a file picker. The system reads your sheet, shows every row in a preview table where you can edit cells in place and drop bad rows BEFORE saving anything. Status shows green ✓ for valid rows and red ⚠ for rows missing required fields (with a tooltip explaining what\'s wrong).',
      'CUSTOMS — Download a blank template with the new "📄 Download Template" button. The template includes a "Shipment Reference" column as the first field — exactly what you asked for, so each historical clearance is tied to its shipment / invoice / B/L number. Two sheets in the file: "Customs Clearances" with all 20 columns + sample row, and "Read me" with step-by-step instructions and the calculation formulas.',
      'CUSTOMS — Import handles the math automatically. You only need to fill USD/kg, quantity, FX rate, and product (everything else has sensible defaults). VAT, Income Tax, and Bank Commission percentages are pulled from your Customs Settings if blank. Customs Duty % is auto-resolved from your Customs Rates library by Product Name. All eight fixed fees are optional.',
      'CUSTOMS — Header rows in your file are matched flexibly. "Shipment Reference", "B/L", "BL Number", "Invoice Number", "Reference" all map to the same field. "USD/kg", "Price USD", "Price/kg" all map to the price column. So you don\'t have to use the exact template wording if you\'re importing from your own historical spreadsheet.',
      'AI PERFORMANCE COACH IS BACK on the dashboard. The "📊 My Performance · AI Coach" card now opens by default for everyone (was collapsed to a tiny pill before, which is why people thought it was missing). You see your activity numbers for the period you pick, your trend vs the prior period, and the "Get coach feedback" button gives you an AI-generated pep talk with growth-oriented suggestions. Available to every team member, no permission needed.',
      'WHAT\'S NEW pill — when there are builds you haven\'t seen since your last visit, the pill turns red, pulses, and shows "+N new since your last visit" with a count badge. Open the modal and every unseen build is auto-expanded with a NEW tag, so you get one consolidated view of everything that changed instead of having to dig through each version. Closing the modal marks them all as seen.',
      'WHAT\'S NEW history — the changelog now caps display at the most recent 100 builds. Older entries stay in the file but aren\'t rendered, so the modal stays fast even after years of releases.',
      'SHIPPING RATES — filter by EXACT port instead of just country. Two new dropdowns at the top of the Rates tab: "All POL" (loading port) and "All POD" (discharge port). Pick one and the route cards rebuild around the exact port — Damietta and Alexandria become separate cards instead of being lumped into "Egypt". Inside the route detail, the rate history table now shows POL, POD, ETD, TT, and FT as their own columns. A "✕ Clear ports" button snaps you back to country grouping in one click.',
      'SYSTEM TICKETS table — if you\'re still seeing the "table not found" error, run supabase/system-tickets-setup.sql in Supabase SQL Editor (one-time only). The file is included in this build under the supabase/ folder.',
    ],
  },
  {
    version: 'v55.62',
    date: '2026-05-07',
    label: 'Inactive teammates fully hidden + Customs tab crash fix shipping',
    items: [
      'Deactivated teammates were still appearing on the admin scorecard, in team dropdowns, and in the announcement acknowledgment lists. The previous filter checked "is active not equal to false" — but a deactivated user with a missing flag value (NULL) passed that test. Now: deactivated users with EITHER false OR NULL flags are hidden everywhere.',
      'New shared helper file ensures every place that filters team members uses the same rule. Previously this logic was scattered in 11 different files with slightly different versions.',
      'Customs tab "application error" was a real React infinite-loop bug from the v55.51 build that\'s already fixed in v55.61. If you\'re still seeing it, deploy v55.61 or v55.62 and hard-refresh (Cmd+Shift+R).',
      'Server-side email notifications also now skip users with NULL active flag — previously they\'d try to send to deactivated teammates and bounce.',
    ],
  },
  {
    version: 'v55.61',
    date: '2026-05-07',
    label: 'Customs tab — fix "Minified React error #301" + Admin scorecards hide deactivated users',
    items: [
      'Customs tab was crashing with "Minified React error #301" when opened. Root cause: the data loaders ran during the page render itself, which set state, which triggered another render, which fired the loaders again — an infinite loop React shut down with that error code. Fixed: loaders now run AFTER the page draws, never during it.',
      'You should now be able to open the Customs tab and see your Clearances and Shipments lists without the red error screen. The Retry button is no longer needed.',
      'Admin scorecards no longer show deactivated teammates. Before, the main Admin → Scorecards page, the pipeline-by-rep breakdown, and the team-member dropdown filter were all showing every user including deactivated ones — with all-zero metrics. Now active teammates only.',
      'Historical records in the audit log still display deactivated users\' names correctly when they appear in past activity — only the live scorecard tables are filtered.',
    ],
  },
  {
    version: 'v55.61',
    date: '2026-05-07',
    label: 'Admin page — fix "Online status shows Offline when I am online"',
    items: [
      'Online status was showing everyone as Offline even when they were actively logged in. Three fixes shipped together.',
      'Fix 1: When you log in, your Online indicator now flips green within seconds. Before, the system waited 5 minutes before pinging the server with the first heartbeat, so even YOU saw yourself as Offline for the first 5 minutes after login.',
      'Fix 2: The system now pings every 2 minutes (was every 5). Combined with the 10-minute Online window, this means up to 4 missed pings can happen before someone flips to Offline. A single bad WiFi moment will no longer make you look offline to the rest of the team.',
      'Fix 3: If the underlying database table isn\'t set up (which is the actual root cause for most teams), a big amber warning now appears at the top of the Team Login Summary saying "Online status not working — database setup needed" with the exact SQL file to run. Before, the table just silently showed everyone as Offline with no explanation.',
      'IMPORTANT: if you see the amber warning after deploying, run supabase/login-events.sql in Supabase → SQL Editor (one-time setup). Logins going forward will track correctly. Past logins from before the SQL is run won\'t show up in the new view, but the user_sessions table still has them.',
    ],
  },
  {
    version: 'v55.60',
    date: '2026-05-06',
    label: 'Nadia announces new builds + archived ack visibility + Resend setup steps',
    items: [
      'Nadia now greets you on the dashboard when a new build has been deployed. A purple Nadia card appears with the build version, the headline, and the top 3 highlights from the changelog. Tap "✓ Got it" and the card disappears until the next build deploys.',
      'Archived announcements now show acknowledgments more prominently to admins. When you click into the archived list (in the Admin tab → Messages section, or the dashboard archived view), each archived announcement has a clear pull-out box showing exactly who acknowledged (with timestamps) and who didn\'t.',
      'Acknowledgment counts now exclude deactivated teammates. Before, a user who was deactivated AFTER an announcement would show as "didn\'t acknowledge" forever, polluting the unacked list. Their original acknowledgment (if any) still appears correctly.',
      'Resend status panel now shows step-by-step instructions inline when the FROM address is still the default "onboarding@resend.dev." Click the "▸ Step-by-step instructions" disclosure on the Admin tab and you\'ll see exactly what to do at resend.com, Bluehost DNS, and Vercel — no need to ask Claude every time.',
    ],
  },
  {
    version: 'v55.59',
    date: '2026-05-06',
    label: 'System Tickets — actually fix the actually-broken table',
    items: [
      'The System Tickets tab has been broken because the underlying database table either didn\'t exist or was missing columns. Every previous "fix" was code-only. The real root cause was that the database setup SQL was never written. Now it is.',
      'Run the new file at supabase/system-tickets-setup.sql ONCE in Supabase → SQL Editor. It creates the table if missing, adds any missing columns to an existing partial table, and is safe to re-run as many times as you want.',
      'After running the SQL, the System Tickets tab works. + New System Ticket creates a row, the list loads, status changes save, the Claude flag toggles, delete works.',
      'When the table is missing or broken, the tab now shows a BIG amber banner that says exactly what to do: "run system-tickets-setup.sql." Before you saw a 2-second toast then an empty panel and had no idea what was wrong.',
      'When ticket creation fails for any reason, the form now shows the exact error inline (instead of a disappearing toast) so you can see what went wrong without losing your typed text.',
    ],
  },
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

// v55.64 — cap how many builds we render to keep the modal snappy.
// Older entries stay in the array (good for searchability and history)
// but only the most recent N are shown in the UI.
var DISPLAY_LIMIT = 100;

export default function WhatsNewWidget({ isAdmin, isSuperAdmin } = {}) {
  // v55.67 — non-admin users should not see implementation details.
  // v55.73 — Three tiers per Max May 8 2026:
  //   PUBLIC      — everyone sees this (default)
  //   adminOnly   — admins + super_admin only
  //   superAdminOnly — super_admin ONLY (AI architecture details)
  // For AI-related changes (Nadia/Jenna/Sara/HR Rep/Work Coach internals),
  // Max's rule: "Only super admin sees all details. He sees all details
  // regardless. For all other team members they will see the build with
  // the exception of any AI-related changes, in which use only high-level
  // wording." So AI internals are superAdminOnly; a high-level public
  // bullet should also be present so non-super-admins see something.
  var canSeeAdminInternals = !!(isAdmin || isSuperAdmin);
  var canSeeAiConfidential = !!isSuperAdmin;

  var filterEntry = function (entry) {
    // Drop entirely-superAdminOnly entries for non-super-admins.
    if (entry.superAdminOnlyEntry && !canSeeAiConfidential) return null;
    // Drop entirely-admin entries for non-admins.
    if (entry.adminOnlyEntry && !canSeeAdminInternals) return null;
    // Filter individual bullet items inside the entry.
    var visibleItems = entry.items.filter(function (it) {
      if (typeof it === 'string') return true;
      // superAdminOnly bullets only visible to super_admin
      if (it.superAdminOnly && !canSeeAiConfidential) return false;
      // adminOnly bullets visible to admin + super_admin
      if (it.adminOnly && !canSeeAdminInternals) return false;
      return true;
    });
    // If filtering left nothing visible, drop the entire entry.
    if (visibleItems.length === 0) return null;
    return Object.assign({}, entry, { items: visibleItems });
  };

  var [open, setOpen] = useState(false);
  var [expanded, setExpanded] = useState({}); // map of version → bool
  // v55.64 — track which version this user has already seen (per browser).
  // We compare BUILD_HISTORY against this to figure out which entries are
  // NEW since their last visit. Closing the modal saves the latest as seen.
  var [lastSeen, setLastSeen] = useState(null);
  var [hasMounted, setHasMounted] = useState(false);
  // v55.65 — live-pull bugs that Claude fixed for each build version.
  // Shape: { 'v55.65': [{title, ticket_number, claude_fix_notes, ...}, ...] }
  var [bugsByBuild, setBugsByBuild] = useState({});

  var STORAGE_KEY = 'ktc_whatsnew_last_seen_version';

  useEffect(function () {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      setLastSeen(v || null);
    } catch (_) {}
    setHasMounted(true);
    // v55.65 — fetch the bug-fixes attached to recent builds. Independent
    // try/catch so a missing system_tickets table doesn't break What's New.
    (async function () {
      try {
        var res = await supabase.from('system_tickets')
          .select('id,ticket_number,title,claude_fix_notes,claude_fixed_in_build_version,created_by,retest_outcome')
          .not('claude_fixed_in_build_version', 'is', null)
          .order('claude_last_fixed_at', { ascending: false })
          .limit(200);
        if (res && res.data) {
          var grouped = {};
          res.data.forEach(function (b) {
            var v = b.claude_fixed_in_build_version;
            if (!v) return;
            if (!grouped[v]) grouped[v] = [];
            grouped[v].push(b);
          });
          setBugsByBuild(grouped);
        }
      } catch (e) {
        // Table missing or RLS blocked — fail silent, this is decorative.
      }
    })();
  }, []);

  var latest = BUILD_HISTORY[0];
  // v55.67 — apply admin/non-admin filtering to BUILD_HISTORY before rendering.
  // Drops entries that have nothing visible left, drops admin-only items
  // inside otherwise-visible entries.
  var filteredHistory = BUILD_HISTORY.map(filterEntry).filter(function (e) { return e !== null; });
  // Only render the most recent N visible builds.
  var visibleBuilds = filteredHistory.slice(0, DISPLAY_LIMIT);
  // Re-anchor "latest" against the filtered list so the pill label and the
  // unseen-tracking compare against what THIS user can actually see.
  if (visibleBuilds.length > 0) latest = visibleBuilds[0];

  // Build the list of "unseen" version strings — every version published
  // AFTER (i.e. higher up in the array than) the last one this user saw.
  // If they've never opened it before, EVERYTHING since their first visit
  // counts as new (we cap to most-recent build to avoid overwhelming them).
  var unseenVersions = [];
  if (hasMounted) {
    if (!lastSeen) {
      // First-time visitor — only flag the most recent build so they're
      // not buried in years of history on day one.
      unseenVersions = [latest.version];
    } else {
      for (var i = 0; i < visibleBuilds.length; i++) {
        if (visibleBuilds[i].version === lastSeen) break;
        unseenVersions.push(visibleBuilds[i].version);
      }
    }
  }
  var unseenCount = unseenVersions.length;
  var hasUnseen = unseenCount > 0;

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

  // When opening the modal, auto-expand every unseen build so the user
  // can scan everything that changed since they were last here without
  // clicking each one.
  var openModal = function () {
    var initialExpand = {};
    if (unseenVersions.length > 0) {
      unseenVersions.forEach(function (v) { initialExpand[v] = true; });
    } else {
      initialExpand[latest.version] = true;
    }
    setExpanded(initialExpand);
    setOpen(true);
  };

  // When closing, mark everything as seen by remembering the latest version.
  var closeModal = function () {
    try { window.localStorage.setItem(STORAGE_KEY, latest.version); } catch (_) {}
    setLastSeen(latest.version);
    setOpen(false);
  };

  return (
    <>
      {/* Inline pill — visible on the dashboard. */}
      <button
        onClick={openModal}
        title={hasUnseen ? (unseenCount + ' update' + (unseenCount === 1 ? '' : 's') + ' since you were last here') : "What's new in this build"}
        className={'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-white text-xs font-bold shadow hover:shadow-md transition ' + (hasUnseen ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 ring-2 ring-rose-200 animate-pulse' : 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600')}
      >
        <span>✨</span>
        <span>
          {hasUnseen
            ? ('+' + unseenCount + ' new since your last visit')
            : ('What\'s new in ' + latest.version)}
        </span>
        <span className="opacity-70 text-[10px] font-normal">· {fmtDate(latest.date)}</span>
        {hasUnseen && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white text-rose-600 text-[10px] font-extrabold">
            {unseenCount}
          </span>
        )}
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4"
          onClick={closeModal}
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
                  {hasUnseen && (
                    <span className="ml-2 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold uppercase tracking-wide">
                      {unseenCount} new for you
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {hasUnseen
                    ? ('Highlights below are everything that changed since you were last here. They\'ll be marked as seen when you close this.')
                    : 'Latest builds and what changed in each.'}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="overflow-auto p-5" style={{ flex: '1 1 auto', minHeight: 0 }}>
              <div className="space-y-3">
                {visibleBuilds.map(function (b, i) {
                  var isOpen = !!expanded[b.version];
                  var isLatest = i === 0;
                  var isNewForUser = unseenVersions.indexOf(b.version) !== -1;
                  return (
                    <div
                      key={b.version + '_' + i}
                      className={'rounded-xl border ' + (isNewForUser ? 'border-rose-300 bg-gradient-to-br from-rose-50/60 to-pink-50/40 shadow-sm' : isLatest ? 'border-indigo-200 bg-gradient-to-br from-indigo-50/40 to-violet-50/40' : 'border-slate-200 bg-white')}
                    >
                      <button
                        onClick={function () { togglePanel(b.version); }}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50/40 transition rounded-xl"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className={'text-xs font-mono font-bold px-2 py-0.5 rounded ' + (isNewForUser ? 'bg-rose-500 text-white' : isLatest ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700')}>
                            {b.version}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{fmtDate(b.date)}</span>
                          {isNewForUser && <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wide flex-shrink-0">NEW for you</span>}
                          {!isNewForUser && isLatest && <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide flex-shrink-0">Latest</span>}
                          <span className="text-xs text-slate-700 truncate">{b.label}</span>
                        </div>
                        <span className="text-slate-400 ml-2 flex-shrink-0">{isOpen ? '▾' : '▸'}</span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1">
                          <ul className="space-y-2">
                            {b.items.map(function (item, idx) {
                              // v55.67 — items can be a plain string OR an
                              // object { text, adminOnly }. Filtering already
                              // happened upstream (filterEntry); this is just
                              // about extracting the visible text safely.
                              var itemText = typeof item === 'string' ? item : (item && item.text) || '';
                              return (
                                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                                  <span className={(isNewForUser ? 'text-rose-400' : 'text-indigo-400') + ' mt-0.5 flex-shrink-0'}>•</span>
                                  <span>{itemText}</span>
                                </li>
                              );
                            })}
                          </ul>
                          {/* v55.65 — live bug-fixes pulled from system_tickets */}
                          {bugsByBuild[b.version] && bugsByBuild[b.version].length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <div className="text-[10px] font-bold text-violet-700 uppercase tracking-wide mb-2">
                                🐛 Bug fixes shipped in this build ({bugsByBuild[b.version].length})
                              </div>
                              <ul className="space-y-1.5">
                                {bugsByBuild[b.version].map(function (bug) {
                                  return (
                                    <li key={bug.id} className="flex items-start gap-2 text-xs text-slate-700 bg-violet-50/40 rounded p-2">
                                      <span className="text-violet-400 mt-0.5">🐛</span>
                                      <div className="flex-1">
                                        <span className="font-bold">{bug.title}</span>
                                        {bug.ticket_number && <span className="text-[9px] text-violet-500 ml-2 font-mono">{bug.ticket_number}</span>}
                                        {bug.retest_outcome === 'passed' && <span className="ml-2 text-[9px] text-emerald-700 font-bold">✓ verified</span>}
                                        {bug.retest_outcome === 'failed' && <span className="ml-2 text-[9px] text-rose-700 font-bold">✗ retest failed</span>}
                                        {bug.claude_fix_notes && (
                                          <div className="text-[10px] text-slate-600 mt-0.5 whitespace-pre-wrap">{bug.claude_fix_notes}</div>
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredHistory.length > DISPLAY_LIMIT && (
                  <div className="text-center text-[10px] text-slate-400 pt-2">
                    Older entries ({filteredHistory.length - DISPLAY_LIMIT}) are archived in the source file but not shown here.
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 p-3 flex justify-between items-center">
              <span className="text-[10px] text-slate-400">
                {hasUnseen ? 'Closing this marks all ' + unseenCount + ' as seen.' : ''}
              </span>
              <button
                onClick={closeModal}
                className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-bold hover:bg-slate-800"
              >
                {hasUnseen ? 'Got it — mark all seen' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
