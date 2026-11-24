# Profitability crash hotfix

Max requested this as priority one after Accounting > Profitability failed with
`Maximum call stack size exceeded` on production v55.83-YJ.

Baseline: ee80b6fa682176b8dd48fae9e4f6f6a3142c8538, independently checked against
the production Vercel alias and GitHub main before editing.

Only application change: ProfitabilityTab.jsx usd(n) called itself for every
defined value. It now uses '$' + fmt(n). Undefined remains the lock symbol.
No SQL, financial calculations, report data, auth or permission changes.
The existing YJ badge is retained to avoid claiming another session's letter;
identify this hotfix by its Git/deployment SHA.

Verification:
- Exact production formatter reproduced RangeError with its repeated usd stack.
- Fixed formatter passes positive, zero, negative, null, numeric-string, hidden
  values and 10,000 repeated cells.
- Edge renders the real ProfitabilityTab with synthetic report data and actual
  pure helpers. Visible and revenue-hidden fixtures load and switch product /
  invoice views without page errors. Dialogs/backend clients are stubbed; no live
  financial records are read or changed. This is a functional render test, not
  authenticated production end-to-end verification.

Coordination: preserve this one-line fix when merging any older ProfitabilityTab
branch. Never copy the whole older component over main. This branch was isolated
from all dirty Claude worktrees. Deployment must be a fast-forward from current
main, with production checked again before release; no force pushes or rollbacks.
