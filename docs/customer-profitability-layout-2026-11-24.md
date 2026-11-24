# Customer profitability layout correction

Requested by Max on November 24, 2026. Claude checks remain paused.

## Problem

Profitability > By customer rendered the entire customer balance panel before
the actual customer profitability table. The long balance list pushed P&L
below the visible screen and made the tab appear to be an accounts-receivable report.

## Change

- Render the existing customer P&L table first, using the same calculations and
  financial columns as By product.
- Place Held / owed today beside the customer name instead of at the far right.
- Keep the full invoice/credit breakdown below the P&L in a collapsed section.
- Show the product-only drill-down hint only on By product.
- Do not change amounts, data, category rules, or permission checks.

This is a separate commit on top of phone fix ecd7a6cf. No rollback or force push.

## Verification

- Browser regression uses real ProfitabilityTab and CustomerBalances components
  with synthetic data, no production writes.
- Covers P&L ordering, separate credit/debt, detail expansion, search, full screen,
  table/header alignment, and full/restricted margin/restricted revenue roles.
- Also exercises Books and Accounting Dashboard permission behavior.
- Currency/profit formatter regression passes, including 10,000 repeated cells.
- Desktop/mobile layout assertions and production build must pass before release.
