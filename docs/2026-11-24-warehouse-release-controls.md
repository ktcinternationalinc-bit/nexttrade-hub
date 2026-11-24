# NT Warehouse Release Controls

Owner: Codex, at Max's explicit request to build, QA, commit and deploy while Claude is away.
Scope: warehouse code release management inside the Hub. No financial calculations, warehouse business records, uploads or migrations are deployed/rolled back by this worker.

## Operator Workflow

- Every active signed-in Hub user can view Change Schedule and its history.
- Super admin can act. Other users, including admin/owner, need the explicit `releases.manage` grant in Settings. Only super admin can grant it.
- Select specific fixes, review their exact builds/files, then confirm deployment or code rollback. Unselected fixes are not queued.
- Confirmation queues a request, not a claim that deployment already succeeded. History records the signer, requested build, execution result, backup, timestamps and verification notes.
- The office worker checks the queue each minute while this PC is signed in and awake. Offline requests stay queued; the screen reports last contact.
- After a completed deployment, use Record production verification to record what was tested. Deployment and functional verification remain distinct.
- Pending requests can be withdrawn before the worker claims them. Running requests cannot be cancelled halfway through file replacement.

## Candidate Contract

Register: `release-management/release-register.json`. Publish candidate metadata in the Hub build; execution results come from the database, not this snapshot.
Each warehouse candidate needs:

1. A full committed warehouse SHA, with files under `nextrade-app/`.
2. `manifest: {sha, target: "production", dataCompatible: true, files: [{path, before, after}]}`. SHA256 fingerprints; before `""` explicitly means absent.
3. Both `codexRef` and `behavioralQa` bound to that SHA, target and `manifestDigest` (SHA256 of JSON.stringify(manifest)). Code review needs feedbackRef; staging QA needs kind `behavioral` and result `PASS`.
4. Explicit `dependsOn` IDs when required. Shared-file selections must become one integrated, reviewed candidate. No automatic dependency guessing.

Existing register entries were NOT given invented PASS records. Entries without exact-build review/QA/file evidence remain blocked with an explanation. A historical manual deployment without a recorded backup cannot be automatically rolled back.

## Data and Overwrite Protection

- Only explicitly listed application code/assets are transferred. `.env`, storage/uploads, database migrations, vendor and staging paths are refused.
- Exact committed blobs are extracted, never the dirty warehouse checkout.
- Under a server release lock, all current file fingerprints must match the reviewed baseline before any replacement.
- Verified code backups precede replacement. Failed replacement/HTTP checks trigger code restoration. Added code files are moved aside on rollback, not deleted.
- Rollback refuses files changed by newer work. Rollback keeps an undo copy and never restores a database snapshot.
- An interrupted worker or unconfirmed restore blocks further execution. Do not automatically expire its database claim or remove the server lock. An operator must inspect the recorded backup, actual file fingerprints, HTTP and functional behavior, then append `recovery_confirmed` and explicitly finish the affected claim. No blanket retry.
- Semantic data compatibility is a required review attestation; fingerprints alone cannot prove that application code has no business behavior changes.

## AI / Claude Coordination

Use the same authenticated `/api/releases` and `/api/releases/signoff` workflow, not ad hoc live copies. Obtain the current head/build/manifestDigest, preserve the user's explicit approval and submit only named IDs. The API enforces server-side permission and rejects stale state. No chat message is itself interpreted as an automatic deployment command without an acting agent.
Never force-push or replace a current Hub build with this worktree if main has advanced. Fetch and integrate first. The worker's local runtime is pinned to a committed version and stops if its source changes.

## Runtime

- SQL: `sql/warehouse-release-execution.sql`, additive release-management tables/functions; browsers have no direct table/RPC privileges.
- Office entry: `release-management/deploy/worker.js`.
- Windows installer: `release-management/deploy/install-worker.ps1`; task `NextTrade-Warehouse-Release-Worker`.
- Runtime folder: `D:/GITHUB/nextrade-hubA/output/warehouse-release-worker`; private credential is gitignored and ACL-restricted. It is a dedicated random worker token, NOT a Supabase service-role key. Only its hash is stored in the database.
- Worker API allows heartbeat, approved-request history, approver check, claim and completion. No arbitrary SQL or access to business tables.
- Repository deploy switches remain OFF for legacy manual scripts. The tested scheduled worker has its own explicit runtime config.
- Pause: disable the Windows task and/or set this worker credential `enabled=false`. Do not erase its history.

## Verification

- Full Next production build with existing placeholder local environment: PASS (existing metadata/Browserslist warnings).
- Remote engine regression: 97 original checks passed; additional stale-baseline/artifact/data-path checks added.
- Queue SQL executed twice in PGlite: 25 checks, including atomic batch, claim serialization, non-replay, attribution and denied browser access.
- Real route/permission tests: 23 checks.
- Worker endpoint tests: 10 checks.
- Real React screen, synthetic API: desktop 1440 and mobile 390; manager selections/blocked candidates and view-only staff passed without overflow or page errors.
- Existing revenue permission regression: 44 checks passed before integrating newer main.
- Real SSH isolated fixture (outside all websites): `/home/nextueoa/release-qa-20261124115833` PASS for backed-up deployment, exact bytes, selected rollback, stale-baseline refusal and unchanged data sentinel. HTTP 200. No live application files changed by this test.
- Earlier fixture `/home/nextueoa/release-qa-20261124115107` stopped during an SSH connection timeout. Evidence retained outside websites. Replaced per-command SSH connections with a single persistent authenticated SSH session; the subsequent real server test passed.

No authenticated production browser session was available in this chat. Do not describe fixture browser tests as a signed-in production walkthrough.
