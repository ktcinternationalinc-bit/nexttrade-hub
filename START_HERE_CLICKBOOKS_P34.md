# Latest ClickBooks release: priorities 3 and 4

Read `clickbooks/docs/CLAUDE_HANDOFF_P34.md` and `clickbooks/docs/DEPLOYMENT_RUNBOOK_P34.md` first. Older root-level handoffs are historical context, not the current activation record.

Eight new SQL migrations are installed in the connected project. The new frontend is NOT deployed, financial journals remain empty, posting is disabled, and no business rules or new scheduler are active. One audit-only snapshot is retained.

Use the migration register to avoid replaying already installed SQL. Merge changes into the current repository rather than replacing newer production with this reference snapshot. The focused P3/P4 package depends on the P1/P2 source and protected identity/permission prerequisites; the full source contains those references but is not a verified production commit.

58 database checks and 62 handler tests passed. Full build, one required legacy regression case and signed-in browser QA remain blocked/unverified. Do not turn on financial posting to make a preview appear complete.

US Accounting only. Do not import Egyptian Sales/Treasury data or turn off Wave during review.
