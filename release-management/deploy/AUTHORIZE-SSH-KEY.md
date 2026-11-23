# Live deploy key — AUTHORIZED 22 Nov 2026

**Status: the `ktc-live-deploy` public key is now authorized on the live cPanel**
(confirmed: "The key 'ktc-live-deploy.pub' has been authorized"). Connection details
are wired into `config.json`:

- Host: `premium224.web-hosting.com` (the live nextradeindustries.com box; Namecheap Stellar Plus)
- cPanel user: `nextueoa` · **SSH port 21098** (Namecheap shared — NOT 22) · key-based auth
- cPanel-only, no root; deploys operate within the account home.

**The scripts still stay in SAFE MODE** (they print the manual cPanel steps and change
nothing) until BOTH of these are done:

1. **Confirm the private key path.** The `ktc-live-deploy` private key was generated on
   this PC in an earlier session. Locate it, keep it OFF any repo/commit, and set
   `key.privateKeyPath` in `config.json`. Verify the connection by hand first:
   `ssh -i <privkey> -p 21098 nextueoa@premium224.web-hosting.com "echo ok"`.
2. **Codex re-reviews the live-execution block** in `deploy.js` / `rollback.js` (the
   block that runs ssh/scp against production) and it is enabled deliberately. Until
   then that block is intentionally a stop (`die`), so even with SSH reachable nothing
   mutates live.

Then set `config.json "sshAuthorized": true` and run a **dry run** first:
`node release-management/deploy/deploy.js --item <id> --target production --confirm "…"`
(dry-run is the default; `--live` is required to act, and the per-change gate — Codex
PASS by SHA + QA + Max's named go — still applies).

Every production move is still: works on staging → **Codex PASS** → **Max names the
change** → backups first → deploy → verify. **Nothing here handles Max's password.**

---

## The key (for reference)

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcKsvA3sVnlslrTUtoNEZDgsI3fNH2vSzWaxklLEeYo ktc-live-deploy
```

## How it was authorized (done, for the record)

The matching **private** key stays on the deploy machine only and is never committed.
These were the cPanel steps Max took in his own Chrome:

1. Namecheap → **Hosting List** → **Go to cPanel** for nextradeindustries.com.
2. In cPanel, open **SSH Access** (under *Security*). If SSH is disabled on this
   plan, open a support ticket to enable SSH/Jailed Shell for user `nextueoa`
   first — this is the real blocker.
3. Open **Manage SSH Keys** → **Import Key**.
4. Leave the private-key box empty. Paste the public key above into the
   **public key** box. Name it `ktc-live-deploy`. Click **Import**.
5. Back on Manage SSH Keys, find `ktc-live-deploy` and click **Manage** →
   **Authorize**.

## What's left (see the two conditions at the top)

The key is authorized; the scripts stay in **safe mode** until the private key path is
confirmed in `config.json` AND the live-execution block has had its Codex re-review and
`"sshAuthorized": true` is set deliberately. Then dry-run first. That is intentional.
