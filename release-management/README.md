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

## v55.83-YJ — sign-off, roll back, and the live steps

### Last five verified Warehouse code versions

Use **Record production verification** on each deployed change after checking it on the live Warehouse. Once all deployed changes in the release history have been checked, Change Schedule records their combined code state as a verified version. It lists the five most recent distinct verified code states. The version number is the history entry that completed verification.

**Review restore** presents the next code backup needed to return to a verified version. Approve each step separately, newest change first. The worker checks the approved backup and current file fingerprints before restoring. Restores use the code backups and never run database migrations or restore business records. Change Schedule blocks a version restore across later data changes or unconfirmed recovery. Files outside the recorded release history require a separately reviewed release.

**On the screen (super admin only).** A waiting change with a recorded Codex PASS for production
(`codexRef {sha, target:"production", feedbackRef}`) gets **Sign off: go to production**; a live change gets
**Ask to roll this back**; either can be taken back. Each click is one append-only row in
`public.release_signoffs` (`sql/v55-83-YJ-release-signoffs.sql`: UPDATE / DELETE / TRUNCATE refused). The row
is ONLY Max's go — it moves nothing. The stored sentence is made by the server:
`Max: yes, put <id> on production @ <sha>` / `Max: roll <id> back`.

**From the row to the move (office PC).**
1. Read the row (Supabase, read-only): `select * from release_signoffs where item_id = '<id>' order by id desc limit 3`.
2. Record it: `register.recordMaxApproval(id, approval_text)` (go) or `register.recordRollbackApproval(id, approval_text)` (roll back).
3. `node release-management/deploy/deploy.js --item <id> --sha <sha> --confirm "<approval_text>" --files a,b,c [--live]`
   or `node release-management/deploy/rollback.js --item <id> --confirm "<approval_text>" [--live]`.
A go given in chat skips step 1: record Max's quoted words with the same helper.

**The live steps (`lib/remote.js`), run only with `--live` AND `sshAuthorized` AND `liveExecutionEnabled`
(both ship `false`) AND `key.privateKeyPath`, `live.appRoot`, `live.checkUrl` set:**
- files: explicit `--files`, each on the item's `deployFiles` list, exactly as committed in the
  warehouse repo at `--sha`; `.env`, `storage/`, `vendor/`, `..`, absolute paths and odd characters refused;
- backup first to `~/code-backups/<topic>-<YYYYMMDDHHMMSS>/files/…` + `MANIFEST.json` (per file: existed,
  sha256 before, sha256 after); every backup copy is proven identical before anything is replaced;
- upload to `<file>.yj-new`, prove sha256, `mv` into place, prove again; then the cache clear(s) and the site check;
- any failure after the first replace → automatic restore from that backup (the failed files are kept in
  `<topic>-failed-<stamp>/`);
- roll back: needs the recorded roll-back go and the `backupDir` the move recorded; saves the current live
  files to `<topic>-undo-<stamp>/` first, restores and proves each file, and MOVES a file the change added
  into that folder (never deletes). After a roll back both go's are used up (`usedApprovals`).
Code only: no SQL, no migration, no delete is ever sent.

**The Hub itself is not handled here** (Max, 24 Nov): Hub builds go out the way they always have — Codex
pass, then push to main — and there is no Hub roll-back button. This layer is for WAREHOUSE changes.

**Added after Codex's design feedback (24 Nov):**
- one release at a time: `~/code-backups/.release-lock/` (made with `mkdir`, released by moving it into
  `.release-locks-done/`). A run that died leaves the lock; the next run refuses until a person has looked.
- an undo never restores over a file that is neither this release's file (`after` in the manifest) nor the
  one before it (`before`): something else changed it, so the whole undo is refused and nothing is touched.
- a move ends in state **deployed** ("files in place, site answers"), NOT live. A page that answers is not
  proof the change works. After a person has checked the change itself:
  `deploy.js --item <id> --sha <sha> --confirm "<go>" --mark-live --checked-by "<who checked what>"`.

**Keeping the history current (Max, 24 Nov: "accurate change mgmt history at all times").** The screen's
Change history and each change's place (staging / on production not yet checked / on production) come from
`release_signoffs`, not only from this register file. After every real step the office PC adds ONE row:
`node release-management/deploy/history-row.js --item <id> --action moved|checked_live|failed|rolled_back|rollback_failed --ref <row number of the go / roll-back request> [--note "..."]`
prints the INSERT (build and backup folder are read from the register, never typed); it is run through the
database connection as part of carrying out Max's go for that change. Then the register is committed so the
Codex / test evidence in the history follows on the next Hub release.

**Revision 3 (Codex 24 Nov findings):**
- A roll-back request always names what it undoes: the build, the backup folder and the move row, taken from the
  recorded history (it wins over this register) or, for an older item, from a build + `backupDir` that deploy.js
  itself recorded. A change moved by hand has neither and cannot be requested for roll back on the screen.
  The sentence carries the build (`Max: roll <id> back @ <sha>`). On the PC: `register.recordRollbackApproval(id,
  text, { sha, backup })` copies the target from the request row, and `gate.rollbackProblems` refuses unless that
  build and backup are the ones this PC moved.
- A failed move ends one of three ways (`gate.attemptRecord`, saved as `lastAttempt` before the script exits):
  `not_replaced` and `restored` -> state `failed` (production is as it was); `recovery_incomplete` -> state
  `needs-attention` (the restore is NOT confirmed, even if the files are back). Nothing else can be done to that
  change until a person checks the live site and `register.recordRecovery(id, "staging"|"live", "<who checked
  what>")` is recorded. `history-row.js` derives the row from that recorded outcome: an unconfirmed restore can
  only be written as `recovery_incomplete` / `rollback_failed`, never as "failed / put back".
