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
export const BUILD_HISTORY = [
  {
    version: 'v55.50',
    date: '2026-05-06',
    label: 'Calendar — fix "delete hangs for 10 minutes" on recurring meetings',
    items: [
      'Calendar delete + cancel for recurring series — was running a sequential loop that did one round-trip to the database per occurrence. For a daily meeting going back a year (365 occurrences) that\'s 365+ round-trips before the actual delete even started. On a slow connection this took minutes — sometimes never finishing — and there was no way to cancel out of it.',
      'Now: delete + cancel both run in ONE bulk database call regardless of how many occurrences are in the series. A 365-event series now finishes in seconds.',
      'Hard 60-second timeout added to both delete and cancel operations. If anything is still hung after a minute, you\'ll see "Delete failed: timed out — try again on a better connection" instead of a frozen UI. No more 10-minute waits.',
      'Calendar refresh after delete/cancel runs in the background so the success toast appears instantly even if the refresh is slow. UI never appears hung after a successful action.',
      'Permission check on delete now also checks the actual count of rows that came back from the database. If RLS silently blocks some rows, you\'ll see "Deleted 12 but 3 still remain — likely a permissions issue" instead of a false success.',
    ],
  },
  {
    version: 'v55.49',
    date: '2026-05-06',
    label: 'Treasury → Create Invoice — fix invisible duplicate-confirm modal + friendly error messages',
    items: [
      'The duplicate-confirm modal ("This looks like a duplicate transaction") had the SAME iOS Safari stacking bug that v55.48 fixed for the not-found modal. v55.48 only fixed half of the problem. Now: when EITHER the duplicate-confirm OR the not-found modal opens, the New Transaction form hides itself entirely. Only one modal on screen at a time — no z-index war possible on any device.',
      'Removed backdrop-blur from both modals. backdrop-blur is what triggers iOS Safari\'s stacking-context bug — without it, the iOS issue can\'t happen even if there were a future overlap.',
      'Bumped duplicate-confirm modal\'s z-index from 70 to 200 (matching the not-found modal) — belt-and-suspenders.',
      'Friendlier error messages on standalone Add Invoice. Previously, hitting a duplicate order number showed a raw database error: "duplicate key value violates unique constraint \'invoices_order_number_key\'". Now it says "Order #2313 already exists as an invoice. Open it from the Sales tab if you want to edit it." Same for permission errors and network errors.',
      'Build stamp on the duplicate-confirm modal now reads BUILD v55.49 (was hardcoded v55.41) — so you can confirm at a glance that the latest fix is actually deployed.',
    ],
  },
  {
    version: 'v55.48',
    date: '2026-05-06',
    label: 'Treasury — "Order # not found" modal now actually visible',
    items: [
      'When you submit a Bank In or Cash In transaction with an Order # that doesn\'t match any existing invoice, the "Order # not found — create new invoice or pick a typo suggestion" modal now actually appears. Previously it was rendering invisibly behind the form modal due to a stacking-context issue (Amad reported "I fill in everything, tap Submit, and nothing happens" — actually the create-invoice modal was opening but hidden).',
      'Fix: when the order-not-found modal opens, the New Transaction form now hides itself entirely. Only one modal on screen — no z-index war possible. When you cancel out of the order-not-found modal, the New Transaction form re-appears with all your typed values intact.',
      'Visible toast confirms what happened: "Order #2313 not found in your invoice list — see modal to create or pick a typo suggestion."',
      'Bumped the order-not-found modal\'s z-index from 60 to 200 as belt-and-suspenders so it\'s unambiguously on top even on devices with quirky stacking behavior.',
    ],
  },
  {
    version: 'v55.47',
    date: '2026-05-06',
    label: 'Treasury + Invoice forms — visible validation errors (no more silent submit)',
    items: [
      'New Transaction modal — when you tap Save and something is missing, a big red banner now appears at the TOP of the form listing every missing field with what to do. Toasts at the corner were getting missed on mobile (Amad reported "I tap Submit and nothing happens" — actually the Amount field was blank, but the toast popped and died in 2 seconds).',
      'Required fields are now marked with a red ★, get a red border when missing, and show "⚠️ Required" inline when you try to submit without them.',
      'Submit failure scrolls the first missing field into view automatically — you can\'t miss what needs fixing.',
      'Errors clear automatically as you type into the missing field, so the form goes back to normal as you fix things.',
      'Same fix protects all four transaction types (Cash In, Cash Out, Bank In, Bank Out) and both bank-entry modes (Order, Non-Order).',
      'Invoice form — Fixed the bug where you\'d fill in everything (order#, customer, items, total) and STILL get "Please fill order#, customer, and add items." Root cause: the customer search field stored typed text in a separate `custSearch` field — `customerName` only got set when you explicitly tapped a row in the dropdown. Now: typed text auto-commits when you click away, AND the submit validation falls back to the typed text if no dropdown row was picked. Plus the error message now lists the SPECIFIC missing field instead of the generic "fill all" message.',
    ],
  },
  {
    version: 'v55.46',
    date: '2026-05-06',
    label: 'Resend diagnostic + Email Status panel + soft-degrade',
    items: [
      'Email — New Email Status panel at the top of the Admin tab. Shows whether Resend is configured, recent send stats (24h success/fail), and a "Send test email to me" button that sends a real email and shows the exact result (delivered / Resend error message / network failure).',
      'Email — Legacy direct-send path (used by announcements) no longer returns a 500 error when Resend isn\'t configured. Both paths now soft-degrade to "bell only" so the rest of the app keeps working.',
      'Email — Failure responses now surface Resend\'s actual error message (e.g. "domain not verified", "FROM not allowed") instead of a generic "send failed" so problems are diagnosable.',
      'No code changes for the user — once you set RESEND_API_KEY in Vercel and redeploy, every notification (ticket changes, comments, priority/due-date, announcements) automatically starts sending email. No further action needed.',
    ],
  },
  {
    version: 'v55.45',
    date: '2026-05-06',
    label: 'System Tickets rewrite + delete-modal lift + Nadia ack + What\'s New',
    items: [
      'System Tickets — clean rewrite as its own component. The "+ New System Ticket" button now opens the form reliably (removed the React anti-pattern that could silently fail). Submit button now disables while saving — no double-submit. New Delete button (admin-only) with proper confirmation modal.',
      'Tickets — Delete confirmation modal lifted to a shared block, so it now appears immediately when you click Delete from inside a ticket. Previously it only appeared after pressing Back (same bug pattern as the close-with-comment fix from April).',
      'Nadia — Acknowledge button on every pending message + reminder she surfaces. Once you tap "✓ Got it," she stops mentioning that message until something new happens (e.g. the sender adds a reply). Unacknowledged messages auto-drop after 7 days so they don\'t haunt you forever.',
      'Dashboard — This very "What\'s New" panel. Always shows the latest build at the top of the dashboard with a date stamp; click to expand the full changelog.',
      'Notify — Resend is now optional (bell still works without it). Bell now reaches users without email addresses too.',
    ],
  },
  {
    version: 'v55.44',
    date: '2026-05-05',
    label: 'Shipping import overhaul + comment double-submit guard + audit comments + notification fan-out',
    items: [
      'Shipping rates import — full 21-column template (with a Field Guide sheet), editable preview showing every field, manual column-remap dropdowns, zero-rate red-row highlights, per-row remove button.',
      'Ticket comments — Send button disables on tap, shows "⏳ Sending…" so triple-tap can\'t post the same comment 3 times. Same protection on Ctrl+Enter.',
      'Audit trail — Priority and due-date changes now post a system entry to the ticket\'s Activity Log: "⚡ Priority changed: MEDIUM → HIGH (by Max)".',
      'Notifications — Every ticket update now hits creator + current assignee + additional assignees, deduped, never self. Dashboard bell works even when Resend isn\'t configured.',
    ],
  },
  {
    version: 'v55.43',
    date: '2026-05-04',
    label: 'Voice restored + phone signature fix',
    items: [
      'Voice — Press-to-record button (🎙) and ChatGPT-style hands-free conversation mode (🗣) restored. No more "Hey Nadia" wake word.',
      'Phone — Fixed "an application error has occurred" on incoming calls (Twilio webhook signature was checking against a Vercel-mangled URL).',
    ],
  },
  {
    version: 'v55.42',
    date: '2026-05-02',
    label: 'Bank edit detection',
    items: [
      'Bank — When editing a bank transaction, correctly detect the row type (deposit vs withdrawal vs adjustment) instead of guessing from amount sign.',
    ],
  },
  {
    version: 'v55.41',
    date: '2026-05-01',
    label: 'Duplicate-confirm helper',
    items: [
      'Treasury — When entering a transaction that looks like an existing one, show a confirmation prompt with the matching rows so you can decide before saving.',
    ],
  },
  {
    version: 'v55.40',
    date: '2026-04-29',
    label: 'Phone auto-inbound features',
    items: [
      'Phone — Auto-register for incoming call routing on login. Browser ringer auto-arms when the phone widget is open.',
    ],
  },
  {
    version: 'v55.39',
    date: '2026-04-28',
    label: 'Voicemail dial-failed branch',
    items: [
      'Phone — When a forwarded call fails (no answer, busy, etc.), the caller now reaches a voicemail prompt instead of a dead line.',
    ],
  },
  {
    version: 'v55.38',
    date: '2026-04-27',
    label: 'Login hydration fix',
    items: [
      'Login — Fixed a hydration mismatch on the login page that caused a brief flash of mismatched UI before sign-in.',
    ],
  },
  {
    version: 'v55.37',
    date: '2026-04-26',
    label: 'WhatsApp inbox',
    items: [
      'WhatsApp — Shared company-number inbox with conversation claiming, 24h-window awareness, and 20s polling.',
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
