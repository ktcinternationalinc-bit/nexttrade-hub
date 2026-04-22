# AI Pipeline Review — Plain English

**What this document is:** the complete walkthrough of how Nadia thinks, every place she can fail silently, every safeguard now in place, and what every button does.

---

## 1. The two AI surfaces in the app

| Where | Component file | What it is |
|---|---|---|
| **Dashboard greeter** (top of homepage) | `AIGreeter.jsx` | Nadia's always-on presence. Greets you, remembers session, takes questions inline. |
| **AI Assistant tab** (left nav) | `AIAssistant.jsx` | Dedicated full-tab AI chat. Voice commands, actions, longer conversations. |

Both call the same backend — `/api/ask`. If that backend breaks, both surfaces go silent.

---

## 2. The request flow — step by step

```
┌────────────────────┐
│  User types:       │
│  "what invoices    │
│   are overdue?"    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────────────────────────┐
│  AIGreeter / AIAssistant packages it:  │
│   { question, history, userId }        │
└─────────┬──────────────────────────────┘
          │  POST /api/ask
          ▼
┌────────────────────────────────────────────────┐
│  /api/ask route handler:                       │
│   1. Check env vars                            │
│   2. If mode=greeter → short path              │
│   3. Else → fetch live business data           │
│      (invoices, treasury, customers,           │
│       tickets, debts, shipping, etc.)          │
│   4. Build system prompt with that data        │
│   5. Call Anthropic API                        │
│   6. Parse response — may contain action JSON  │
│   7. If action → execute + return result       │
│      Else → return text answer                 │
└─────────┬──────────────────────────────────────┘
          │
          ▼
┌────────────────────┐
│  { answer: "...",  │
│    pending_action, │
│    decision }      │
└─────────┬──────────┘
          │
          ▼
  User sees the answer.
  If pending_action → confirm button.
  If decision → action chips.
```

---

## 3. Every place this can fail — and what I've added to catch each

### Layer 1: Environment variables
**What can break:** `ANTHROPIC_API_KEY` not set in Vercel, or SUPABASE keys missing, or typo in env var name.
**Old behavior:** silent empty answer, UI shows "Hey Max!" fallback.
**Now:** visit `/api/ask/diag` in browser → see exactly which env vars are missing.

### Layer 2: Library imports
**What can break:** Any of the three imports in `/api/ask/route.js` (`notify-server`, `ai-memory`, `decision-engine`) throws at module-load time. The WHOLE ROUTE fails to cold-boot on Vercel. Every request returns 500.
**Old behavior:** silent.
**Now:** `/api/ask/diag` catches each import individually and reports which one crashed.

### Layer 3: Anthropic API
**What can break:** invalid API key, model name deprecated, rate limit, bad payload shape (like assistant-first history), network timeout.
**Old behavior:** 400/500 response → code caught the error and returned empty `answer: ""` → UI fallback to greeting.
**Now:** `/api/ask/diag` does a live round-trip to Anthropic and reports HTTP status + error body.

### Layer 4: System prompt construction
**What can break:** context grows too large (all your customers + invoices + treasury), exceeds 200k token context window, Anthropic rejects.
**Old behavior:** opaque failure.
**Now:** `/api/ask/diag` could be extended to log prompt size; for now, watch for `token_exceeded` in the error field.

### Layer 5: Supabase data fetch
**What can break:** RLS blocks anon key, wrong table name, slow query times out.
**Old behavior:** `safe()` wrapper swallows the error and passes `[]`. Nadia gets a prompt with empty data and honestly says "I don't see anything."
**Now:** `/api/ask/diag` hits Supabase directly and returns the ticket count. If that's 0 when you know you have tickets, RLS is the problem.

### Layer 6: Frontend message shape
**What can break:** AIGreeter or AIAssistant sends history with wrong role values, empty content, or first-turn assistant (Anthropic rejects).
**Old behavior:** silent 400 → empty answer.
**Now:** `test-ai-smoke.js` POSTs exactly this shape and asserts non-empty answers come back.

---

## 4. What `/api/ask/diag` tells you

Visit `https://nexttrade-hub.vercel.app/api/ask/diag`. You get JSON like this:

```json
{
  "timestamp": "2026-04-21T...",
  "env": {
    "has_anthropic_key": true,
    "has_supabase_url": true,
    "has_service_role": true,
    "has_anon_key": true
  },
  "imports": {
    "notify_server": "ok",
    "ai_memory": "ok",
    "decision_engine": "ok"
  },
  "anthropic": {
    "ok": true,
    "status": 200,
    "reply": "OK"
  },
  "supabase": {
    "ok": true,
    "count": 47
  },
  "notes": [],
  "overall_health": "HEALTHY"
}
```

If `overall_health` is `DEGRADED`, scroll to `notes` — plain-English description of what broke. Screenshot that and send to me. No more guessing.

---

## 5. What got reverted vs kept

### REVERTED to the exact working state from MERGED-COMPLETE-14b (your last good build before Session 5):
- `src/components/AIGreeter.jsx`
- `src/app/api/ask/route.js`

These are **byte-identical to what worked**. I confirmed this with md5 checksums.

### KEPT from Session 5 (because they don't touch the AI path):
- `src/components/NadiaActionBridge.jsx` — headless event bridge (waits for events, nothing dispatches them yet in this build, harmless)
- `src/lib/nadia-tools.js` — tool schema file, pure data, no imports
- `src/app/api/ask-v2/route.js` — separate endpoint, nothing in the UI calls it right now
- `src/components/CalendarTab.jsx` — ticket pseudo-events + meeting notes thread
- `src/components/PhoneWidget.jsx` — position change
- `src/components/ShippingRatesTab.jsx` — rate import fix
- Treasury bug fixes in `src/app/page.jsx`

### NEW diagnostic infrastructure:
- `src/app/api/ask/diag/route.js` — the health endpoint above
- `__tests__/test-ai-smoke.js` — integration test that catches empty-answer regressions

---

## 6. Why the Session 5 AI work broke (my honest theory, stated as theory)

I can see from diffs that my AIGreeter changes were "additive" (added a v2 opt-in path, defaulting OFF). The direct POST to `/api/ask` for normal users should have been byte-identical in payload shape.

BUT — **something in production didn't behave like my offline diffs suggested**. Possibilities I cannot rule out without live logs:

1. The Vercel build cached an older bundle and the two files I changed weren't actually redeployed together (stale import chain).
2. A side effect of one of the new imports (`NadiaActionBridge`) somehow affected the React render tree for AIGreeter — unlikely but not impossible.
3. The `userProfile` prop shape changed in a way I missed, causing `userProfile?.id` to be undefined and something downstream to crash silently.
4. I'm wrong about diffs being byte-identical in intent, and there's a subtle behavior change I still don't see.

**What matters:** reverting to 14b restores known-good behavior. Adding `/api/ask/diag` + the smoke test means next time something like this happens, I'll see the truth instead of guessing. And if it happens to you again before I can look, you can hit `/api/ask/diag` yourself and see what's wrong.

---

## 7. Everything the dashboard AI does — full catalog (post-revert)

Here is what Nadia can do once you deploy 18. All of this existed in 14b and is preserved here.

### Conversational
- Greet you by name, time of day, day count since last login
- Warn you about overdue invoices, stale tickets, checks due today
- Remember session context (last 8 messages)

### Data-aware intelligence (calls `/api/ask`, pulls live data)
- Answer "who owes us the most?" by querying invoices table
- Answer "what's my treasury balance?" by summing treasury
- List overdue tickets by status
- Surface debt aging
- Summarize shipping rates by route

### Actions (pending_action flow — Nadia proposes, you confirm)
- Create a ticket — "Nadia, create a ticket to call the warehouse tomorrow"
- Update a ticket — reassign, change status, bump priority
- Schedule an event — "add a meeting with Omar tomorrow at 10"
- Set a reminder
- Send an email (draft first, you confirm before send)
- Send a WhatsApp (draft first, you confirm before send)
- Request a quote from vendors

### Voice
- Push-to-talk in AIAssistant tab
- TTS readback of answers (Settings → AI → Voice on/off)

### Memory
- Remembers facts across sessions via `ai_memory` table
- Auto-extracts preferences from conversation

---

## 8. Deploy checklist for 18

1. **Unzip MERGED-COMPLETE-18.zip, GitHub Desktop, push.**
2. Wait for Vercel deploy (~90 seconds).
3. **Visit `https://nexttrade-hub.vercel.app/api/ask/diag`**. Confirm `overall_health: HEALTHY`. If not, screenshot and send me.
4. **Ask Nadia "what invoices are overdue?"** — should get a real answer referencing real invoice data, not "Hey Max!".
5. **Ask Nadia "who owes us the most?"** — real name + amount from debts table.
6. **Try the dashboard AI tab.** Same AI, same intelligence, should work.

If step 3 shows DEGRADED, the `notes` array tells you exactly what to fix.
If step 4 or 5 give "Hey Max!" style non-responses, the diag is still healthy but the Anthropic response may be empty — that would be a new, different failure and I'll debug with the full report.

---

## 9. My commitment going forward

1. **I will not touch AIGreeter.jsx or /api/ask/route.js without running test-ai-smoke.js against a local dev server first.** This is non-negotiable from now on.
2. **Every PR that touches AI path must keep `/api/ask/diag` healthy.**
3. **I will not declare "tests pass, shipping" on AI work without a live round-trip test, ever again.**

The class of failure you experienced — silent empty answer masquerading as working code — is exactly what `/api/ask/diag` + `test-ai-smoke.js` are designed to catch at commit time. It shouldn't have happened. It won't happen the same way again.
