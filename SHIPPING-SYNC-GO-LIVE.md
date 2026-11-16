# Shipping costs from the warehouse → Hub P&L: how it goes live (v55.83-TG)

Prepared 16 Nov 2026 by the Nextrade warehouse Claude session. Codex review is PARTIAL (not a launch sign-off); its findings are answered in
`D:\GITHUB\nextrade_WAREHOUSE\CLAUDE_HANDOFF.md`, at the end.

## Where things stand
| Piece | State |
| --- | --- |
| Warehouse read-only feed on **fix staging** (`/api/hub-feed/shipping`) | **Deployed and tested.** Only this one address opens without the staging password, and it needs a secret token. Backup: `~/code-backups/hubfeed-2026-11-16/` |
| Hub code (branch `feature/warehouse-shipping-sync`, folder `D:\GITHUB\nexttrade-hub-shipsync`) | **Built (`next build` exit 0) and tested** (63 + 121 rule tests, 15 database tests). **Not committed, not deployed.** |
| Hub database tables | **Not created yet.** Max runs the SQL file. |
| Daily check | Written (11:00 UTC every day = 6 am New York in winter). **Starts only after the deploy.** |
| Profit numbers | Unchanged until Max switches the warehouse costs on. |

## Step 1: proof on staging (done on the warehouse side)
- The dry run against warehouse staging reproduces both of Max's screenshots:
  - **1002-1156** (order 1519): freight 3,475 final + trucking 1,850 quote = **5,325, partly provisional**. The 20,121 trucker wire is not accepted: it is more than 3× the quote and was paid before the load date. It sits in the review list.
  - **1001-1669** (order 1695): 1,950 + 741 = **2,691, provisional**.

## Step 2: go live in the Hub, reading warehouse STAGING (needs Max's OK at each ★)
1. ★ Max runs `sql/v55-83-TG-warehouse-shipping.sql` in Supabase. It only ADDS four tables and two functions; nothing existing changes.
2. ★ Two Vercel settings: `NEXTRADE_FEED_URL` (the staging feed address) and `NEXTRADE_FEED_TOKEN` (the secret). Claude can add them with the Vercel tool so the secret never appears in chat, but only with Max's yes.
3. ★ Max says "yes commit". Claude merges the branch onto the latest Hub version, builds again, and pushes. That push is the production deploy.
4. Claude or Max opens Accounting → Profitability → Containers and presses **↻ Sync Shipping Costs**. This fills only the new tables.
5. Max looks at the lists: **Shipped since 2026-06-01**, **Open Orders — Last 2 Years**, **Review queue**.
6. ★ Max presses **Use them in the P&L**. Only then do the profit numbers change. It can be switched off again at any time.

## Step 3: production warehouse (later, only when Max asks)
1. Backup of live Nextrade, then the same read-only feed file is added there (a code-only change, no data change). Only that one address is opened, with its own new token.
2. The two Vercel settings are pointed at live, plus `NEXTRADE_FEED_ALLOW_LIVE=yes`, and the Hub's active source is switched to `nextrade-live` (one setting). Staging rows are kept, never mixed in.
3. Sync, check, done.

## Max's decisions (16 Nov) — now built in
1. **Currency:** all USD, Canada included → stored as confirmed USD, no currency flag.
2. **Canada orders with empty shipping boxes:** usually domestic customers (e.g. Vinyl Trend) who handle their own transport → a SHIPPED 1001- order with every shipping box empty = "customer's own transport", cost 0, labelled inferred; flagged if the invoice charges shipping. Staging backfill: 62 such orders; missing drops from 90 to 28.
3. **1002-1156 wire 20,121:** one payment for several orders → quote kept. New rule: the same wire amount + date on several orders is never one order's final (5 found on staging).
4. **CNF / EXW:** the invoice should say it. CNF with or without a shipping line (none = in the price; with a line, the price is not split). EXW should have a shipping line, else flagged. Says neither → guessed by the old rule and always flagged "not stated on invoice". Later: learn each customer's history (follow-up).
5. **Obsolete-section orders:** same container, costs on the main order — confirmed.
6. **Customer names:** the Hub may keep them; a warehouse ↔ invoice name difference is noted only, matching stays release number only.
