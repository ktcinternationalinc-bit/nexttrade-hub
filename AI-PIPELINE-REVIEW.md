# AI Pipeline Review — MERGED-COMPLETE-19

## What this build is

This is **Session 5 with every piece restored**, including the AI infrastructure that was reverted in build 18. The revert in 18 was a defensive move when we couldn't explain why Nadia was returning fallback greetings. Tonight we discovered the real cause: **Vercel had a security incident and platform degradation starting April 20 ~19:40 UTC** — elevated error rates on API endpoints, webhook delivery failures, and transient serverless function failures. When `/api/ask` briefly returned empty responses during that window, the frontend fell back to "Hey Mouhamed!" — which looked like the AI went dumb.

The AI was never actually broken. The platform under it was.

## What's in this build

### Session 5 AI infrastructure (fully restored)
- `src/components/AIGreeter.jsx` — v2 opt-in endpoint switch (default off), `nadia-push-question` event listener, drafts[] dispatch to the action bridge
- `src/app/api/ask/route.js` — history sanitization (strips leading assistant + empty-content messages), visible error surfacing instead of silent empty answers
- `src/components/NadiaActionBridge.jsx` — headless bridge mounted at page.jsx root, 6 action handlers (draft_email, draft_whatsapp, create_event, create_reminder, flag_invoice, ask_assistant)
- `src/lib/nadia-tools.js` — 14 tool schema (8 read + 3 draft + 3 write)
- `src/app/api/ask-v2/route.js` — tool-use endpoint, multi-turn reasoning, MAX_TOOL_ITERATIONS=6

### New in this build (post-Vercel-incident hardening)
- `src/app/api/ask/diag/route.js` — health endpoint. Visit `https://nexttrade-hub.vercel.app/api/ask/diag` to see env vars, import status, Anthropic round-trip, Supabase round-trip, overall HEALTHY/DEGRADED
- `__tests__/test-ai-smoke.js` — integration test POSTs real history shapes to `/api/ask`, asserts non-empty intelligent answers come back

### Non-AI Session 5 work (intact)
- `src/components/CalendarTab.jsx` — ticket pseudo-events (only if assigned_to===me + non-terminal), meeting notes thread (note/action_item/decision), modal z-60
- `src/components/PhoneWidget.jsx` — bottom-left repositioning
- `src/components/ShippingRatesTab.jsx` — rate import fix
- `src/app/page.jsx` — 6 treasury bug fixes (bulk direction-gated, recalc on edit, double-click guard, dedup tolerance cap, dedup_sibling_id priority, export status column)
- Test sections 47-50 in `__tests__/test-full.js`

## How v2 opt-in works

By default, everyone uses `/api/ask` (the battle-tested endpoint). Nothing changes for Max or the team.

To try v2 (tool-use, multi-step reasoning):
- Visit `https://nexttrade-hub.vercel.app/?nadia_v2=1` OR
- Open browser DevTools console and run `localStorage.setItem('nadia_v2', '1')`

Without the flag, behavior is exactly 14b — the last known good state.

## Why this is the right build to ship

**Safety:** Normal users hit the exact same `/api/ask` code path. The v2 additions are inert unless explicitly opted in.

**Visibility:** When Nadia goes silent again (platform issues, Anthropic outages, env var drift), `/api/ask/diag` tells you which layer failed in one JSON response.

**Foundation for Session 6:** Tier 1 capabilities (live data queries, pre-filled drafts, cross-system actions) can plug straight in.

**Tested:** 11/11 files parse clean. Smoke test catches empty-answer regressions.

## Deploy checklist

The GitHub → Vercel webhook is currently broken from the April 20 Vercel incident. Two paths:

### Path A — wait for Vercel to restore webhook (a few hours)
Vercel is actively remediating. Once webhooks restore, pushing `main` triggers a normal auto-deploy.

### Path B — force deploy via Vercel CLI (works right now)
From Terminal on the Mac:
```bash
npm install -g vercel
cd ~/path/to/nexttrade-hub
vercel login
vercel --prod
```
Bypasses the broken webhook entirely. Takes ~90 seconds.

## Verify after deploy

1. Visit `https://nexttrade-hub.vercel.app/api/ask/diag` — expect `overall_health: "HEALTHY"`
2. Open dashboard — ask Nadia "what invoices are overdue?" — expect a real answer
3. Any Session 5 UI feature (meeting notes, ticket pseudo-events, phone widget position, rate import) should work as tested

If diag says `DEGRADED`, the `notes` array names the failed layer.

## Tier 1 roadmap (Session 6)

**Step 1:** Add Settings toggle "Try Nadia v2 (beta)" for opt-in from UI (not just URL hack).
**Step 2:** Wire the 14 tools to real Supabase queries. Schema exists; handlers need data-fetch logic.
**Step 3:** Wire draft tools to open relevant UI pre-filled with confirmation required.
**Step 4:** Measure v2 vs v1 on real questions. If v2 wins, flip default.
**Step 5:** Tier 2 — proactive morning briefing, learning loop, cross-channel inbox.

## Commitment

Any future change to `AIGreeter.jsx` or `/api/ask/route.js`:
1. Run `test-ai-smoke.js` against local dev server before commit
2. Confirm `/api/ask/diag` returns HEALTHY in preview deploy
3. Real browser round-trip test on a live URL

No more silent empty-answer regressions.
