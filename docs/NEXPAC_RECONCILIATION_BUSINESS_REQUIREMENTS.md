# NEXPAC Reconciliation Business Requirements

Date: 2026-08-28

Status: Draft for business review

## 1. Business Need

KTC Hub needs a new tab called **NEXPAC Reconciliation** where the team can import NEXPAC invoices, confirm what products were billed, compare those billed products against what was actually received in the NexTrade system, validate invoice prices against expected prices, and track whether invoices have been paid.

The goal is to give the business one reliable place to answer:

- What did NEXPAC invoice us for?
- Did we actually receive those products?
- Were the prices correct?
- Which invoices have been paid, unpaid, partially paid, or need review?
- How much are we buying from NEXPAC over any selected time period?
- How much are we being invoiced over any selected time period?

## 2. Objectives

1. Create a dedicated **NEXPAC Reconciliation** tab in KTC Hub.
2. Allow users to import NEXPAC invoices, including QuickBooks-style invoice files.
3. Extract invoice header details and line-item product details from each invoice.
4. Store every imported invoice in the Hub as a searchable invoice record.
5. Let users confirm or correct the products detected from the invoice.
6. Compare invoice line items against expected pricing maintained inside the Hub.
7. Compare invoice line items against actual NexTrade receiving or scan-in data.
8. Track invoice payment status and optionally match payments from Wave or manual entries.
9. Generate payable reports showing which NEXPAC invoices need to be wired by a selected date or date range.
10. Provide reporting by daily, weekly, monthly, yearly, and custom date ranges.
11. Highlight mismatches clearly so users can quickly review pricing, quantity, receiving, and payment issues.

## 3. In Scope

- New KTC Hub tab: **NEXPAC Reconciliation**.
- Invoice file import.
- Invoice document storage and history.
- Invoice parsing into header and product line items.
- Product confirmation workflow.
- Expected price setup and price variance checks.
- Direct NexTrade receiving-data lookup when NexTrade data is available to the Hub.
- Receiving confirmation using NexTrade scan-in/import files.
- Payment confirmation using Wave export files or manual payment records.
- Payable report creation for selecting invoices that need to be wired.
- Invoice and product exclusions from payable reports.
- Payment proof import from Wave or bank statements after wire/payment is made.
- Dashboard totals for purchases, invoice amounts, quantities, price variances, receiving variances, and payment status.
- Filters for vendor, product, invoice date, received date, payment status, issue status, and custom date ranges.
- Exportable reconciliation output file.

## 4. Out of Scope For Initial Build

- Automatic payment execution.
- Automatic posting of invoices into QuickBooks, Wave, or another accounting system.
- Automatic product receiving into inventory.
- Vendor communication or dispute emails.
- Full accounting general ledger reconciliation.
- OCR perfection for every possible invoice layout without user review.

These can be considered later after the core reconciliation workflow is working.

## 5. Main Users

- Operations team: imports invoices and scan-in files, confirms received products.
- Purchasing team: maintains expected pricing and reviews purchase volume.
- Accounting team: confirms invoice totals, payment status, and payment matches.
- Management: reviews totals, variances, trends, and exceptions.
- Admin users: manage expected pricing, product mapping rules, and permissions.

## 6. Source Files And Inputs

### 6.1 NEXPAC Invoice

The user can import an invoice received from NEXPAC. Expected formats may include:

- PDF invoice.
- QuickBooks-style invoice export.
- CSV or Excel invoice export if available.
- Manual invoice entry as a fallback.

The system should capture:

- Vendor name.
- Invoice number.
- Invoice date.
- Due date, if present.
- Currency.
- Subtotal.
- Tax.
- Shipping or other fees.
- Invoice total.
- Line-item product name or description.
- Product code, SKU, grade, color, size, roll count, weight, or other identifiers when available.
- Quantity.
- Unit of measure.
- Unit price.
- Line total.
- Original uploaded file.

### 6.2 Expected Price List

The user can maintain expected pricing inside the Hub. Expected pricing should support:

- Product or SKU.
- Product aliases or alternate vendor names.
- Unit of measure.
- Expected unit price.
- Currency.
- Effective start date.
- Effective end date, if applicable.
- Optional tolerance, such as allowed dollar difference or percentage difference.
- Notes.
- Active/inactive status.

### 6.3 NexTrade Receiving Data

NexTrade is an external web system with its own database. The preferred setup is for the NEXPAC Reconciliation tab to pull receiving and scan-in data directly from the NexTrade database or backend, instead of requiring the user to upload a file every time.

Known NexTrade source screen:

- `https://nextradeindustries.com/admin/scan-in/scanInLogs`

This appears to be the admin scan-in logs page. The Hub should not depend on manually opening this page for reconciliation; it should retrieve the same underlying scan-in log data through a secure backend connection.

Direct NexTrade access should be supported through one of these options:

- A read-only database connection to the NexTrade database.
- A read-only NexTrade database view created specifically for KTC Hub reconciliation.
- A NexTrade API endpoint that returns scan-in and receiving records.
- A scheduled NexTrade export that lands in the Hub automatically.
- Same database tables already available to KTC Hub, if both systems share infrastructure.

Manual file upload should remain available as a fallback when direct access is unavailable, delayed, or needs troubleshooting.

The direct integration should be handled through the KTC Hub backend. The frontend should not store NexTrade database credentials, and users should not need to log into the NexTrade website separately just to confirm invoice receiving.

The user can also upload a file from the NexTrade system showing actual inbounds or scan-ins for the relevant dates.

The first sample scan-in file reviewed was `scan_in_details_exported_data (7).csv`. It contains 1,000 scan-in detail rows with these fields:

- `Reference No`
- `7501 WHSE Entry ID`
- `Warehouse`
- `Supplier`
- `NEXPAC Bill`
- `Skew No`
- `Roll #`
- `Weight`
- `Yards`
- `Product`
- `Color`
- `CGT Grade`
- `NT Grade`
- `Date`
- `Days in Warehouse`
- `7512 IE/IT Entry ID`
- `Internal Control #`
- `Scanned Out`
- `Release Number`
- `Release Date`
- `Notes`

The system should use this file to confirm:

- Products were actually received.
- Received quantity matches the invoice quantity.
- Received weight, rolls, units, or other measurements match the invoice when available.
- Received date falls within an acceptable range of the invoice date.
- Any product on the invoice that was not found in receiving data.
- Any received product that does not appear on a NEXPAC invoice.

Important sample-file finding: the `NEXPAC Bill` field may be blank, `-`, `TBA`, or otherwise not usable at the time the scan-in file is exported. Therefore, the receiving confirmation cannot depend only on invoice number. The system must be able to match invoice lines using a combination of reference number, scan-in date, warehouse, supplier, SKU/skew number, product, color, CGT grade, NT grade, roll number, weight, yards, release number, and invoice date range.

Scan-in rows should remain available as receiving proof even when they are not immediately matched to an invoice.

### 6.4 Payment Evidence

The system should support payment confirmation through one or more methods:

- Manual payment entry.
- Wave export file import.
- Bank statement or bank transaction import.
- Attachment upload, such as payment confirmation, receipt, or screenshot.

The system should capture:

- Payment date.
- Payment amount.
- Currency.
- Payment source.
- Reference number.
- Memo or notes.
- Matched invoice number or invoices.
- Payment attachment.
- Payment status: unpaid, partially paid, paid, overpaid, or needs review.

### 6.5 Payable Report Inputs

The system should let users create a payable report before payment is made. This report answers: **what NEXPAC invoices do we need to wire?**

The user should be able to choose:

- Due up to a selected date.
- Invoice date range.
- Due date range.
- Last week.
- Last month.
- Current week.
- Current month.
- Year to date.
- Custom date range.

The user should be able to exclude:

- A specific invoice.
- Multiple selected invoices.
- Any invoice containing a selected product.
- Any invoice containing a selected SKU, grade, color, product type, or product alias.
- Any invoice with unresolved receiving issues.
- Any invoice with unresolved price issues.
- Any invoice already marked paid.
- Any invoice already included in another open payable report.

The payable report should show:

- Vendor.
- Invoice number.
- Invoice date.
- Due date.
- Invoice total.
- Open amount.
- Currency.
- Payment status.
- Receiving confirmation status.
- Price confirmation status.
- Product lines included on each invoice.
- Exclusion reason for any invoice removed from the report.
- Total amount to wire.

## 7. Core Workflow

1. User opens **NEXPAC Reconciliation** tab.
2. User imports a NEXPAC invoice.
3. System reads the invoice and shows a preview of invoice header and product lines.
4. User confirms, edits, or maps each product line.
5. System saves the invoice and original file.
6. System compares each invoice line against expected pricing.
7. System marks price matches as clear and price mismatches as warnings.
8. System checks NexTrade directly for matching receiving or scan-in records.
9. System compares invoice lines against actual received products.
10. System flags missing, short, over, duplicate, or uncertain receiving matches.
11. If direct NexTrade data is not available or the user wants to compare a specific export, user imports NexTrade scan-in data for the same period or links an existing receiving file.
12. User imports payment evidence from Wave or enters payment manually.
13. System links payment evidence to the invoice and updates payment status.
14. User creates a payable report for invoices due up to a selected date or within a selected period.
15. User reviews invoice numbers, amounts, excluded invoices/products, and total amount to wire.
16. User wires the payment outside the Hub.
17. User imports bank or Wave proof showing the wire/payment.
18. System matches the payment proof back to the payable report and invoice records.
19. User reviews dashboard totals and filters by date, product, status, or issue type.
20. User exports a reconciliation report when needed.

## 8. Functional Requirements

### 8.1 Tab And Navigation

- The Hub must include a new tab named **NEXPAC Reconciliation**.
- The tab must be visible to approved KTC Hub users.
- The tab must include sections for invoice import, invoice list, issue review, product totals, price setup, receiving match, and payment status.

### 8.2 Invoice Import

- Users must be able to upload one or more NEXPAC invoices.
- The system must store the original invoice file.
- The system must attempt to extract invoice header data and line items.
- The system must show an import preview before final save.
- Users must be able to correct parsed values before saving.
- The system must prevent duplicate invoice imports when invoice number, vendor, date, and amount appear to match an existing invoice.
- If a possible duplicate exists, the system must warn the user and allow approved users to continue or cancel.

### 8.3 Invoice Filing And History

- Every saved invoice must appear in an invoice list.
- Users must be able to open an invoice detail page or panel.
- Users must be able to view the original uploaded file from the invoice record.
- Users must be able to search by invoice number, vendor, product, SKU, date, amount, and status.
- Users must be able to filter invoice records by daily, weekly, monthly, yearly, and custom date ranges.

### 8.4 Product Confirmation

- The system must break each invoice into product line items.
- Users must be able to confirm whether each product line is correct.
- Users must be able to map vendor product names to internal NexTrade products.
- Users must be able to save product aliases so future invoices match automatically.
- Lines that are not confirmed must remain visible as needing review.

### 8.5 Expected Price Management

- Users must be able to enter expected prices by product.
- Expected prices must live in an **Expected Prices** area inside the NEXPAC Reconciliation tab.
- The invoice detail screen must also allow an approved user to add or update an expected price when an invoice line has no expected price.
- The product confirmation screen must show the current expected price beside the invoice price before the invoice is finalized.
- Expected prices must support effective dates so historical invoices can be checked against the correct price at that time.
- Expected prices must support optional tolerance rules.
- The system must compare invoice unit price and line total against expected price.
- If the invoice price is outside tolerance, the invoice and line item must be visually flagged.
- Clicking the warning must explain the issue in plain language, such as:
  - Expected price was $2.50 per lb, but invoice price was $2.75 per lb.
  - Invoice line total does not equal quantity multiplied by unit price.
  - No expected price exists for this product and date.
  - Currency or unit of measure does not match expected pricing.

### 8.6 Receiving Match

- The system must first attempt to use direct NexTrade receiving or scan-in data when available.
- Users must be able to upload NexTrade scan-in or inbound files as a fallback or supplemental proof source.
- The system must store each uploaded scan-in file.
- The system must parse scan-in records or direct NexTrade records and match them against invoice product lines.
- Matching must consider product, SKU/skew number, alias, date range, quantity, unit, weight, yards, roll count, roll number, warehouse, supplier, release number, reference number, and invoice reference when available.
- The system must not mark an invoice line as confirmed only because the invoice was imported.
- The system must keep each invoice line as **Not Confirmed** until receiving proof is matched or a user manually confirms it.
- The system must support automatic confidence-based matching:
  - High confidence: strong match on product or SKU/skew, grade, color, date range, and quantity/weight/rolls.
  - Medium confidence: likely match, but one or more important fields differ or are missing.
  - Low confidence: weak possible match only.
  - No match: no reasonable scan-in row or group found.
- High-confidence matches may be marked as confirmed automatically if business users approve that rule.
- Medium-confidence and low-confidence matches must require user review before they count as confirmed.
- When multiple scan-in rows represent one invoice line, the system must group scan-in rows and compare totals.
- When one scan-in row could apply to multiple invoice lines, the system must mark it as an ambiguous match and require review.
- Scan-in rows that are already matched to an invoice line must not be silently reused for another invoice line unless the user approves a split or duplicate use.
- The system must show receiving status for every invoice line:
  - Confirmed received.
  - Partially received.
  - Not confirmed.
  - Over received.
  - Possible match needs review.
  - No scan-in data available.
- The invoice header must show an overall receiving status:
  - Fully confirmed.
  - Partially confirmed.
  - Not confirmed.
  - Needs review.
- Users must be able to manually approve or reject uncertain matches.
- Manual confirmation must require a note explaining why the line was confirmed.
- Manual confirmation must store the user, timestamp, and linked scan-in rows.

### 8.6.1 Direct NexTrade Data Pull

- The system should provide a direct **Pull From NexTrade** action inside the NEXPAC Reconciliation tab.
- The direct pull should connect to the NexTrade web system's database or backend service using approved server-side credentials.
- The direct pull should target the same scan-in log records shown in the NexTrade admin page at `https://nextradeindustries.com/admin/scan-in/scanInLogs`.
- The user should be able to pull NexTrade receiving data by invoice number, reference number, release number, product, warehouse, supplier, scan-in date range, or custom date range.
- The system should automatically check NexTrade receiving data after an invoice is imported.
- The system should show when NexTrade data was last refreshed.
- The system should show whether a confirmation came from direct NexTrade data, uploaded CSV data, or manual confirmation.
- Direct NexTrade results must use the same **Confirmed**, **Not Confirmed**, **Partially Confirmed**, **Over Received**, and **Needs Review** statuses as uploaded scan-in files.
- If the same receiving row appears from both direct NexTrade access and uploaded CSV, the system must deduplicate it instead of double-counting the receipt.
- Direct NexTrade access must be read-only for reconciliation unless a later phase explicitly approves writing back to NexTrade.
- Direct database/API credentials must be stored only in secure server environment variables or approved secret storage.
- If NexTrade does not have an API, the preferred technical fallback is a read-only database view or scheduled export. Website screen-scraping should be considered only as a last resort.
- If direct NexTrade access fails, the invoice lines must remain **Not Confirmed** or **Needs Review** and the UI must show that NexTrade data could not be refreshed.
- The system must keep a log of each NexTrade pull, including date range, filters, record count, user, timestamp, success/failure, and error message if applicable.

### 8.6.2 Scan-In Confirmation Rules

- A product line is **Confirmed** only when the invoice line has matching scan-in proof or an approved manual confirmation.
- A product line is **Not Confirmed** when no scan-in proof has been matched yet.
- A product line is **Partially Confirmed** when scan-in proof exists but quantity, weight, yards, or roll count is short.
- A product line is **Over Received** when scan-in proof exceeds invoice quantity, weight, yards, or roll count beyond allowed tolerance.
- A product line is **Needs Review** when the system finds possible matches but cannot confidently decide.
- If `NEXPAC Bill` is blank or unavailable in the scan-in file, the system must still try to match using the other scan-in fields.
- If an invoice line has no confirmed receiving match, the invoice cannot be marked fully reconciled.
- If a scan-in row exists but `Scanned Out` is filled, the UI should show that the item may have moved after receipt, but the row can still count as received if the scan-in date confirms inbound receipt.

### 8.7 Payment Match

- Users must be able to mark an invoice as unpaid, partially paid, paid, overpaid, or needs review.
- Users must be able to manually enter payment details.
- Users must be able to attach payment evidence.
- Users should be able to import Wave payment/export files when available.
- Users must be able to import bank statements or bank transaction exports when available.
- The system must match payments to invoices and payable reports by invoice number, amount, date, vendor, memo, bank reference, Wave reference, and wire reference where possible.
- The system must warn when:
  - Payment amount does not match invoice total.
  - Payment is missing.
  - Payment appears to match more than one invoice.
  - Invoice appears paid more than once.
  - Payment currency differs from invoice currency.

### 8.7.1 Payable Report And Wire Planning

- Users must be able to create a payable report for NEXPAC invoices that need to be paid.
- The report must support date presets and custom dates:
  - Up to selected date.
  - Last week.
  - Current week.
  - Last month.
  - Current month.
  - Year to date.
  - Custom invoice date range.
  - Custom due date range.
- The report must list invoice numbers and amounts that should be paid.
- The report must show the total amount to wire.
- The report must show whether each invoice is fully confirmed, partially confirmed, not confirmed, or needs review.
- Users must be able to exclude selected invoices from the payable report.
- Users must be able to exclude invoices that contain selected products, SKUs, grades, colors, product types, or product aliases.
- Users must be able to exclude invoices with unresolved price issues.
- Users must be able to exclude invoices with unresolved receiving confirmation issues.
- Users must be able to save the payable report as a payment batch or wire plan.
- Saved payable reports must preserve the invoice list, excluded invoices, exclusion rules, totals, created-by user, and created timestamp.
- The system must prevent confusion between planned payment and actual payment:
  - Planned means selected for wire/payment.
  - Paid means matched to payment proof or manually marked paid by an approved user.
- After payment is made, users must be able to attach or import bank/Wave proof to the payable report.
- The system must update the invoices in the payable report once payment proof is confirmed.
- If a payment proof amount differs from the payable report total, the system must flag the report as needing review.
- If one wire covers multiple invoices, the system must allocate the payment across those invoices and show the allocation.

### 8.8 Dashboards And Reporting

- The tab must show total invoice amount over selected dates.
- The tab must show total purchased quantity over selected dates.
- The tab must show totals by product over selected dates.
- The tab must show invoice count over selected dates.
- The tab must show open/unpaid amount.
- The tab must show paid amount.
- The tab must show planned-to-pay amount from open payable reports.
- The tab must show total amount due up to a selected date.
- The tab must show total variance caused by unexpected prices.
- The tab must support daily, weekly, monthly, yearly, and custom date filters.
- Users must be able to export a reconciliation report.

### 8.9 Issue Review

- The system must maintain an issue list across invoices.
- Issues must be grouped by type:
  - Price issue.
  - Product mapping issue.
  - Quantity issue.
  - Receiving issue.
  - Payment issue.
  - Duplicate invoice issue.
  - Missing data issue.
- Issues must have statuses:
  - Open.
  - In review.
  - Resolved.
  - Dismissed.
- Users must be able to add notes to an issue.
- The system must keep a history of issue changes.

### 8.10 Visual Highlighting And Status Colors

- Confirmed lines should use a clear success treatment, such as green status text or a green check.
- Not confirmed lines should use a strong warning treatment, such as amber highlighting.
- Price mismatches should use a red or high-severity warning treatment.
- Receiving quantity, weight, yards, or roll variances should use amber for review-level differences and red for severe differences.
- Missing expected price should be highlighted as a setup issue, not as a vendor overcharge.
- Paid invoices with unresolved price or receiving issues must still show those unresolved issue colors.
- Clicking any warning must open a plain-language explanation with:
  - What the system expected.
  - What was found on the invoice.
  - What was found in scan-in data or payment data.
  - What action is needed to resolve it.
- The invoice list should show compact badges for price status, receiving status, payment status, and overall reconciliation status.

### 8.11 Export Output File

- Users must be able to generate an output file for a selected period, invoice, or issue set.
- The output should include:
  - Invoice header.
  - Invoice line items.
  - Expected price comparison.
  - Receiving match result.
  - Payment match result.
  - Payable report or wire plan details, if included.
  - Open warnings.
  - User notes.
  - Export date and exported-by user.

## 9. Key Business Rules

1. An imported invoice must not be considered reconciled until products, pricing, receiving, and payment are all confirmed or intentionally dismissed.
2. Expected price comparison must use the expected price effective on the invoice date unless the user selects a different rule.
3. Receiving confirmation must come from matched scan-in data or approved manual confirmation.
4. If an invoice line has not been confirmed from scan-in data or manual confirmation, it must say **Not Confirmed**.
5. Product aliases must not overwrite the original invoice product description.
6. Original invoice files and uploaded proof files must remain attached for audit history.
7. Payment status must be separate from receiving status.
8. A paid invoice can still have price or receiving issues.
9. A fully received invoice can still be unpaid.
10. A payable report is not proof that an invoice was paid.
11. A payment must be confirmed by bank proof, Wave proof, or an approved manual payment confirmation.
12. Product-based exclusions must exclude the whole invoice unless the business later approves partial invoice payment.
13. Excluded invoices must keep the exclusion reason.
14. Users must be warned before importing a likely duplicate invoice.
15. Manual overrides must store the user, date, reason, and before/after value.
16. Reconciliation reports must preserve the values as they existed at export time.

## 10. Recommended Screens

### 10.1 Overview

- Date range selector.
- Total invoice amount.
- Invoice count.
- Paid amount.
- Unpaid amount.
- Due up to selected date amount.
- Planned wire amount.
- Total quantity purchased.
- Total price variance.
- Open issue count.
- Recently imported invoices.

### 10.2 Import Invoice

- Upload area.
- Import preview.
- Header confirmation.
- Product line confirmation.
- Expected price shown beside each invoice line.
- Quick add expected price option when no expected price exists.
- Save invoice button.
- Duplicate warning.

### 10.3 Invoice List

- Search.
- Filters.
- Invoice number.
- Invoice date.
- Total amount.
- Payment status.
- Receiving status.
- Price status.
- Issue count.
- Link to original file.

### 10.4 Invoice Detail

- Invoice header.
- Original invoice preview.
- Product line table.
- Expected price comparison.
- Receiving match panel.
- Payment match panel.
- Confirmation status for every invoice line.
- Warning drawer explaining price, receiving, product, or payment issues.
- Notes and audit history.

### 10.5 Expected Prices

This should be a dedicated sub-section inside the **NEXPAC Reconciliation** tab, not hidden inside Settings. Users will need it while reviewing invoices, so the price table must be close to the invoice workflow.

- Product price table.
- Add/edit expected price.
- Effective dates.
- Tolerance settings.
- Product alias management.
- Import expected prices from CSV or Excel.
- Inline link from invoice review when a product has no price.
- History showing who changed each price and when.

### 10.6 Receiving Imports

- Upload NexTrade scan-in file.
- Pull latest receiving data directly from NexTrade.
- Imported receiving file history.
- Direct NexTrade pull history.
- Match summary.
- Unmatched invoice lines.
- Unmatched received lines.
- Scan-in detail table showing reference number, NEXPAC bill, skew number, roll number, weight, yards, product, color, grade, date, release number, and match status.
- Match review panel for confirming or rejecting possible matches.

### 10.7 Payments

- Manual payment entry.
- Wave file import.
- Bank statement import.
- Payment attachment area.
- Payment-to-invoice matching review.

### 10.7.1 Payable Report

- Date preset selector.
- Custom date controls.
- Filters for due date, invoice date, payment status, receiving status, price status, product, SKU, grade, color, and product alias.
- Exclude invoice control.
- Exclude product control.
- Invoice list showing invoice number, invoice date, due date, amount, open amount, confirmation status, and issue badges.
- Total amount to wire.
- Save payable report button.
- Export payable report button.
- Attach payment proof after wire is sent.
- Payment proof matching result.

### 10.8 Issues

- List of all warnings and exceptions.
- Filter by issue type and status.
- Click issue to see explanation and affected invoice lines.
- Add notes and mark resolved.

## 11. High-Level Data Needed

- NEXPAC invoices.
- NEXPAC invoice line items.
- Original invoice files.
- Internal product catalog or product mapping.
- Product alias table.
- Expected price table.
- Expected price change history.
- Receiving scan-in imports.
- Receiving scan-in line items.
- Direct NexTrade pull logs.
- Direct NexTrade receiving snapshot records, if needed for audit history.
- Invoice-to-receiving matches.
- Payment records.
- Payment attachments.
- Invoice-to-payment matches.
- Payable reports or wire plans.
- Payable report invoice selections.
- Payable report exclusion rules.
- Payable report payment proof matches.
- Reconciliation issues.
- Audit log.

## 12. Permissions

- View-only users can see invoices, reports, and issues.
- Operations users can import invoices and receiving files.
- Accounting users can add or import payments.
- Accounting users can create payable reports and attach payment proof.
- Purchasing or admin users can manage expected pricing.
- Admin users can override reconciliation statuses, dismiss issues, and manage product mappings.

## 13. Audit And Compliance

- The system must keep the original uploaded invoice file.
- The system must keep the original uploaded receiving/payment file.
- The system must log manual edits and overrides.
- The system must identify who imported each file.
- The system must identify who resolved or dismissed each issue.
- The system must identify who created each payable report.
- The system must identify who excluded each invoice or product from a payable report.
- The system must identify who confirmed payment proof.
- The system must keep a timestamp for every major action.

## 14. Success Metrics

- Reduced time spent manually checking NEXPAC invoices.
- Fewer missed price discrepancies.
- Fewer paid invoices with unresolved receiving issues.
- Clear visibility into purchases by product and date range.
- Clear visibility into invoices received, paid, unpaid, and disputed.
- Better audit trail for vendor invoice review.

## 15. Open Questions

1. What exact invoice formats will NEXPAC send: PDF only, QuickBooks export, CSV, Excel, or multiple formats?
2. What exact invoice fields are available from NEXPAC invoices, especially invoice number, product code, unit, quantity, weight, yards, rolls, and line total?
3. What database does the NexTrade website use, and can KTC Hub receive read-only access to the scan-in records behind `https://nextradeindustries.com/admin/scan-in/scanInLogs`?
4. Does the NexTrade scan-in logs page already have an internal API endpoint, or should a read-only database view be created for KTC Hub?
5. How often should the Hub refresh direct NexTrade data: on invoice import, on demand, scheduled, or all three?
6. What is the preferred matching key between invoice products and NexTrade scan-in products when `NEXPAC Bill` is blank?
7. Should expected prices be by pound, yard, roll, unit, case, pallet, or flexible by product?
8. What price tolerance should be allowed before the system warns the user?
9. What receiving tolerance should be allowed for weight, yards, quantity, or roll count?
10. Should high-confidence scan-in matches be confirmed automatically, or should every receiving match require user approval?
11. Should receiving match by invoice date, scan-in date, delivery date, release number, reference number, product, or a combination?
12. Will Wave payment data be imported manually by file, connected by API, or entered manually at first?
13. What bank statement or bank transaction export format will be used to confirm wires?
14. Should payable reports include only fully confirmed invoices by default, or should they include unresolved invoices with warnings?
15. Should product-based exclusions exclude the whole invoice or only the affected product line?
16. Should the system allow one payment to cover multiple NEXPAC invoices?
17. Should the system allow one NEXPAC invoice to be paid by multiple payments?
18. Which users should be allowed to dismiss warnings?

## 16. Suggested Build Phases

### Phase 1: Invoice Filing And Product Breakdown

- Add NEXPAC Reconciliation tab.
- Upload and store invoice files.
- Parse invoice headers and product lines.
- Save invoices and invoice lines.
- Search and filter invoices.
- Manual product confirmation and correction.

### Phase 2: Expected Price Validation

- Add expected price setup.
- Add product alias mapping.
- Add expected price quick-add from invoice detail.
- Compare invoice prices against expected prices.
- Show warning indicators and issue explanations.
- Add issue list.

### Phase 3: Receiving Confirmation

- Pull receiving data directly from NexTrade where available.
- Import NexTrade scan-in files as fallback.
- Parse receiving lines.
- Match invoice lines against receiving lines.
- Use scan-in fields including reference number, NEXPAC bill, skew number, roll number, weight, yards, product, color, grade, date, and release number.
- Show confirmed, not confirmed, partial, over, and needs-review statuses.
- Allow manual match approval.

### Phase 4: Payment Matching

- Add manual payment entry.
- Add payment attachments.
- Add Wave export import if needed.
- Add bank statement import if needed.
- Match payments to invoices.
- Show paid, unpaid, partial, overpaid, and needs-review statuses.

### Phase 4B: Payable Reports And Wire Planning

- Create payable report by due date, invoice date, preset period, or custom date range.
- Show invoice numbers, open amounts, and total amount to wire.
- Add invoice exclusions.
- Add product/SKU/grade/color exclusions.
- Save payable report as a wire plan.
- Export payable report.
- Attach bank or Wave proof after wire is sent.
- Match payment proof back to the payable report and included invoices.

### Phase 5: Reporting And Export

- Add dashboard totals.
- Add daily, weekly, monthly, yearly, and custom reporting.
- Export reconciliation reports.
- Add management summary views.

## 17. Acceptance Criteria

1. A user can open the KTC Hub and access the **NEXPAC Reconciliation** tab.
2. A user can import a NEXPAC invoice and see invoice details and product lines before saving.
3. A user can save the invoice and later find it in the invoice list.
4. A user can confirm or correct product lines.
5. A user can enter expected prices for products.
6. The system flags invoice lines where the price does not match the expected price.
7. Clicking a price warning explains the expected price, actual price, and variance.
8. A user can import a NexTrade scan-in file in the sample format provided.
9. The system can show whether invoice products were actually confirmed from scan-in data.
10. Invoice lines that are not matched to scan-in proof remain marked **Not Confirmed**.
11. The system flags products that were invoiced but not confirmed as received.
12. A user can manually confirm a receiving match with a required note.
13. A user can enter or import payment evidence.
14. The system shows whether each invoice is unpaid, partially paid, paid, overpaid, or needs review.
15. A user can create a payable report up to a selected date and see invoice numbers, invoice amounts, and total amount to wire.
16. A user can exclude a selected invoice from a payable report.
17. A user can exclude invoices containing a selected product, SKU, grade, color, or product alias from a payable report.
18. A saved payable report keeps its selected invoices, excluded invoices, exclusion reasons, and total amount.
19. A user can attach or import bank/Wave proof after the wire is made.
20. The system can match payment proof back to the payable report and invoice records.
21. A user can filter purchases and invoice totals by daily, weekly, monthly, yearly, and custom date ranges.
22. A user can export a reconciliation output file containing invoice, pricing, receiving, payment, payable report, and issue details.
23. Manual overrides are logged with user, time, and reason.

## 18. Initial MVP Recommendation

The first useful version should focus on:

- Import invoice.
- Save original invoice.
- Break down product lines.
- Confirm products.
- Maintain expected prices.
- Flag price issues.
- Show invoice totals by date range.

Because receiving confirmation is central to this request, the MVP should also include a basic scan-in import and **Not Confirmed** status even if automatic matching starts simple. After that is stable, add advanced matching and payment matching.
