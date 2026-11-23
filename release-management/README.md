# Release Management (KTC)

One governance layer so warehouse + Hub rollouts never break and **data is never
lost**. Three parts, one shared release log.

```
release-management/
  release-register.json     ← the ONE release log (hand-editable). The Hub screen reads it; the scripts append to it.
  qa/
    cases.json              ← editable QA cases (plain English rules)
    run-qa.js               ← one command: node release-management/qa/run-qa.js  → writes qa-result.json
    qa-result.json          ← pass/fail the gate reads (generated)
  deploy/
    config.json             ← deploy settings (sshAuthorized=false until Max authorizes the key)
    AUTHORIZE-SSH-KEY.md     ← one-time steps for Max to turn on automated deploy
    deploy.js               ← gated deploy (safe mode until SSH authorized)
    rollback.js             ← gated rollback (safe mode until SSH authorized)
  lib/register.js           ← shared append-only helpers for the register
```

## Part 1 — the Change Schedule screen
In the Hub under **SYSTEM → Change Schedule** (super admin + anyone given the
`releases.access` switch in Settings). It reads `release-register.json` through the
**authenticated, read-only** `/api/releases` route (verifiedCaller + assertPermission,
**fails closed** — an unauthenticated request gets 401; a signed-in user without the
switch gets 403) and shows, in plain English: what's live on production, what's queued
on fix staging, what each change still needs (Codex pass · Max's go · data flag), and
how a move happens and rolls back. The register is a plain file you can edit by hand —
**"we can change it manually."** The screen is a **maintained plan / snapshot** (labelled
as-of a date, **not a live deployment feed**): the file ships with the Hub build, so the
deployed copy refreshes on the next Hub deploy.

## Part 2 — the QA suite + gate
`node release-management/qa/run-qa.js` runs every case in `cases.json` and writes
`qa-result.json`. Cases assert that a RULE still holds in the source (present / absent
/ count / json_ok), so it catches removed guards and silent fallbacks, not just the
presence of a string. Each case is labelled **lint** (source check — useful, but *not*
executed PHP/staging behaviour), **governance** (Hub wiring + JSON we can actually
verify here), or **manual** (a human reminder). Warehouse cases **skip** (not fail) when
that repo isn't on the machine. Edit `cases.json` to add or change rules — no code change.

A release whose only checks are source lint reports **LINT-ONLY**, never PASS — source
lint cannot certify warehouse behaviour (that comes from Codex + a PHP/staging run).

**The gate ([`lib/gate.js`](lib/gate.js), used by BOTH `deploy.js` and
`register.markVerifiedLive`, tested in `__tests__/test-v55-83-xh-release-gate.js`):**
each item carries **recorded evidence**, and one shared validator compares that evidence
against the **exact candidate** (`{sha, target}`) and the operator's `confirm` against the
**existing recorded approval**. A change moves to production only when ALL bind to the
candidate:
1. **`codexRef {sha, target, feedbackRef}`** — Codex PASS for this exact SHA + env (recorded
   by `recordCodexPass`). A changed/rebased SHA or a different target invalidates it.
2. **`behavioralQa {sha, target, result:'PASS'}`** — a **separate executed behavioral result**
   (PHP/staging/browser), bound to this SHA + env (recorded by `recordBehavioralQA`). The
   `run-qa.js` output is **source lint only** (`SOURCE-OK`, `behavioral:false`) and never
   satisfies this — stale/wrong-env/source-only all **stop**.
3. **`maxApproval {text}`** — Max's recorded named go (recorded by `recordMaxApproval`); the
   operator's `--confirm` must equal it. The gate **never manufactures or overwrites** approval.

`deploy.js` resolves the **actual checked-out commit** (`git rev-parse HEAD`) and refuses if it
isn't the `--sha` — it binds to the real artifact, not a supplied string. `markVerifiedLive`
runs the **same validator** against the loaded item inside the lock before any write; on any
mismatch the item and event history are unchanged, and it never writes approval. The manual
cPanel checklist is gated the same way; an SSH refusal is **never** approval. Register writes
take a cross-process **lock**; **dry-run and safe-mode paths are side-effect-free**.

## Part 3 — deploy / rollback (safe mode until SSH is authorized)
`deploy.js` / `rollback.js` implement CHANGE-MANAGEMENT.md A–F: **back up first**
(files → `~/code-backups/<topic>-<timestamp>/` with a **unique per-release id** so a
second same-day change never overwrites the first, data → `zz_<topic>_<table>_before_…`,
never dropped), deploy = upload only the **allowlisted** files + `php artisan view:clear`
(+ config:/route: clear if relevant) + verify, rollback = restore those backups + clear
caches. `deploy.js` **defaults to a dry run** (`--live` is required to act, and even then
the SSH safe-mode gate still blocks). Rollback restores **code only**; a data reversal is
a reviewed per-row/per-column op — the scripts **never auto-run restore SQL or migrations**
and never delete data. Each run records a distinct state (planned / deploying / verified /
failed / rolled-back) and appends to the register atomically.

**They cannot touch production yet.** The live warehouse has cPanel only — no SSH. Both
scripts stay in **safe mode** (print the manual cPanel steps, change nothing) until Max
authorizes the deploy key per `deploy/AUTHORIZE-SSH-KEY.md` and `config.sshAuthorized`
is set true. They contain **no delete/DROP** of any kind. Data is never deleted.

## House rules baked in
- Nothing reaches production without: works on staging → Codex PASS → Max names the change.
- Back up before every change; data is never deleted; every release is reversible.
- The scripts never handle Max's password — SSH uses the authorized key only.
