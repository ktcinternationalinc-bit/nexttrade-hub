# Nexpack Reconciliation Business Requirements

Date: 2026-08-28

Status: Draft for business review

## 1. Business Need

KHC Hub needs a new tab called **Nexpack Reconciliation** where the team can import Nexpack invoices, confirm what products were billed, compare those billed products against what was actually received in the NexTrade system, validate invoice prices against expected prices, and track whether invoices have been paid.

The goal is to give the business one reliable place to answer:

- What did Nexpack invoice us for?
- Did we actually receive those products?
- Were the prices correct?
- Which invoices have been paid, unpaid, partially paid, or need review?
- How much are we buying from Nexpack over any selected time period?
- How much are we being invoiced over any selected time period?

## 2. Objectives

1. Create a dedicated **Nexpack Reconciliation** tab in KHC Hub.
2. Allow users to import Nexpack invoices, including QuickBooks-style invoice files.
3. Extract invoice header details and line-item product details from each invoice.
4. Store every imported invoice in the Hub as a searchable invoice record.
5. Let users confirm or correct the products detected from the invoice.
6. Compare invoice line items against expected pricing maintained inside the Hub.
7. Compare invoice line items against actual NexTrade receiving or scan-in data.
8. Track invoice payment status and optionally match payments from Wave or manual entries.
9. Provide reporting by daily, weekly, monthly, yearly, and custom date ranges.
10. Highlight mismatches clearly so users can quickly review pricing, quantity, receiving, and payment issues.

## 3. In Scope

- New KHC Hub tab: **Nexpack Reconciliation**.
- Invoice file import.
- Invoice document storage and history.
- Invoice parsing into header and product line items.
- Product confirmation workflow.
- Expected price setup and price variance checks.
- Receiving confirmation using NexTrade scan-in/import files.
- Payment confirmation using Wave export files or manual payment records.
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

### 6.1 Nexpack Invoice

The user can import an invoice received from Nexpack. Expected formats may include:

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

### 6.3 NexTrade Receiving Or Scan-In File

The user can upload a file from the NexTrade system showing actual inbounds or scan-ins for the relevant dates.

The system should use this file to confirm:

- Products were actually received.
- Received quantity matches the invoice quantity.
- Received weight, rolls, units, or other measurements match the invoice when available.
- Received date falls within an acceptable range of the invoice date.
- Any product on the invoice that was not found in receiving data.
- Any received product that does not appear on a Nexpack invoice.

The exact scan-in format will be finalized after sample files are provided.

### 6.4 Payment Evidence

The system should support payment confirmation through one or more methods:

- Manual payment entry.
- Wave export file import.
- Bank/payment file import in a future phase.
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

## 7. Core Workflow

1. User opens **Nexpack Reconciliation** tab.
2. User imports a Nexpack invoice.
3. System reads the invoice and shows a preview of invoice header and product lines.
4. User confirms, edits, or maps each product line.
5. System saves the invoice and original file.
6. System compares each invoice line against expected pricing.
7. System marks price matches as clear and price mismatches as warnings.
8. User imports NexTrade scan-in data for the same period or links an existing receiving file.
9. System compares invoice lines against actual received products.
10. System flags missing, short, over, duplicate, or uncertain receiving matches.
11. User imports payment evidence from Wave or enters payment manually.
12. System links payment evidence to the invoice and updates payment status.
13. User reviews dashboard totals and filters by date, product, status, or issue type.
14. User exports a reconciliation report when needed.

## 8. Functional Requirements

### 8.1 Tab And Navigation

- The Hub must include a new tab named **Nexpack Reconciliation**.
- The tab must be visible to approved KHC Hub users.
- The tab must include sections for invoice import, invoice list, issue review, product totals, price setup, receiving match, and payment status.

### 8.2 Invoice Import

- Users must be able to upload one or more Nexpack invoices.
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

- Users must be able to upload NexTrade scan-in or inbound files.
- The system must store each uploaded scan-in file.
- The system must parse scan-in records and match them against invoice product lines.
- Matching should consider product, SKU, alias, date range, quantity, unit, weight, rolls, and invoice reference when available.
- The system must show receiving status for every invoice line:
  - Received and matched.
  - Partially received.
  - Not received.
  - Over received.
  - Possible match needs review.
  - No scan-in data available.
- Users must be able to manually approve or reject uncertain matches.

### 8.7 Payment Match

- Users must be able to mark an invoice as unpaid, partially paid, paid, overpaid, or needs review.
- Users must be able to manually enter payment details.
- Users must be able to attach payment evidence.
- Users should be able to import Wave payment/export files when available.
- The system must match payments to invoices by invoice number, amount, date, vendor, memo, and reference where possible.
- The system must warn when:
  - Payment amount does not match invoice total.
  - Payment is missing.
  - Payment appears to match more than one invoice.
  - Invoice appears paid more than once.
  - Payment currency differs from invoice currency.

### 8.8 Dashboards And Reporting

- The tab must show total invoice amount over selected dates.
- The tab must show total purchased quantity over selected dates.
- The tab must show totals by product over selected dates.
- The tab must show invoice count over selected dates.
- The tab must show open/unpaid amount.
- The tab must show paid amount.
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

### 8.10 Export Output File

- Users must be able to generate an output file for a selected period, invoice, or issue set.
- The output should include:
  - Invoice header.
  - Invoice line items.
  - Expected price comparison.
  - Receiving match result.
  - Payment match result.
  - Open warnings.
  - User notes.
  - Export date and exported-by user.

## 9. Key Business Rules

1. An imported invoice must not be considered reconciled until products, pricing, receiving, and payment are all confirmed or intentionally dismissed.
2. Expected price comparison must use the expected price effective on the invoice date unless the user selects a different rule.
3. Product aliases must not overwrite the original invoice product description.
4. Original invoice files and uploaded proof files must remain attached for audit history.
5. Payment status must be separate from receiving status.
6. A paid invoice can still have price or receiving issues.
7. A fully received invoice can still be unpaid.
8. Users must be warned before importing a likely duplicate invoice.
9. Manual overrides must store the user, date, reason, and before/after value.
10. Reconciliation reports must preserve the values as they existed at export time.

## 10. Recommended Screens

### 10.1 Overview

- Date range selector.
- Total invoice amount.
- Invoice count.
- Paid amount.
- Unpaid amount.
- Total quantity purchased.
- Total price variance.
- Open issue count.
- Recently imported invoices.

### 10.2 Import Invoice

- Upload area.
- Import preview.
- Header confirmation.
- Product line confirmation.
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
- Notes and audit history.

### 10.5 Expected Prices

- Product price table.
- Add/edit expected price.
- Effective dates.
- Tolerance settings.
- Product alias management.

### 10.6 Receiving Imports

- Upload NexTrade scan-in file.
- Imported receiving file history.
- Match summary.
- Unmatched invoice lines.
- Unmatched received lines.

### 10.7 Payments

- Manual payment entry.
- Wave file import.
- Payment attachment area.
- Payment-to-invoice matching review.

### 10.8 Issues

- List of all warnings and exceptions.
- Filter by issue type and status.
- Click issue to see explanation and affected invoice lines.
- Add notes and mark resolved.

## 11. High-Level Data Needed

- Nexpack invoices.
- Nexpack invoice line items.
- Original invoice files.
- Internal product catalog or product mapping.
- Product alias table.
- Expected price table.
- Receiving scan-in imports.
- Receiving scan-in line items.
- Invoice-to-receiving matches.
- Payment records.
- Payment attachments.
- Invoice-to-payment matches.
- Reconciliation issues.
- Audit log.

## 12. Permissions

- View-only users can see invoices, reports, and issues.
- Operations users can import invoices and receiving files.
- Accounting users can add or import payments.
- Purchasing or admin users can manage expected pricing.
- Admin users can override reconciliation statuses, dismiss issues, and manage product mappings.

## 13. Audit And Compliance

- The system must keep the original uploaded invoice file.
- The system must keep the original uploaded receiving/payment file.
- The system must log manual edits and overrides.
- The system must identify who imported each file.
- The system must identify who resolved or dismissed each issue.
- The system must keep a timestamp for every major action.

## 14. Success Metrics

- Reduced time spent manually checking Nexpack invoices.
- Fewer missed price discrepancies.
- Fewer paid invoices with unresolved receiving issues.
- Clear visibility into purchases by product and date range.
- Clear visibility into invoices received, paid, unpaid, and disputed.
- Better audit trail for vendor invoice review.

## 15. Open Questions

1. What exact invoice formats will Nexpack send: PDF only, QuickBooks export, CSV, Excel, or multiple formats?
2. What fields are available in the NexTrade scan-in file?
3. What is the preferred matching key between invoice products and NexTrade products?
4. Should expected prices be by pound, roll, unit, case, pallet, or flexible by product?
5. What price tolerance should be allowed before the system warns the user?
6. Should receiving match by invoice date, delivery date, container, PO, product, or a combination?
7. Will Wave payment data be imported manually by file, connected by API, or entered manually at first?
8. Should the system allow one payment to cover multiple Nexpack invoices?
9. Should the system allow one Nexpack invoice to be paid by multiple payments?
10. Which users should be allowed to dismiss warnings?

## 16. Suggested Build Phases

### Phase 1: Invoice Filing And Product Breakdown

- Add Nexpack Reconciliation tab.
- Upload and store invoice files.
- Parse invoice headers and product lines.
- Save invoices and invoice lines.
- Search and filter invoices.
- Manual product confirmation and correction.

### Phase 2: Expected Price Validation

- Add expected price setup.
- Add product alias mapping.
- Compare invoice prices against expected prices.
- Show warning indicators and issue explanations.
- Add issue list.

### Phase 3: Receiving Confirmation

- Import NexTrade scan-in files.
- Parse receiving lines.
- Match invoice lines against receiving lines.
- Show received, partial, missing, over, and needs-review statuses.
- Allow manual match approval.

### Phase 4: Payment Matching

- Add manual payment entry.
- Add payment attachments.
- Add Wave export import if needed.
- Match payments to invoices.
- Show paid, unpaid, partial, overpaid, and needs-review statuses.

### Phase 5: Reporting And Export

- Add dashboard totals.
- Add daily, weekly, monthly, yearly, and custom reporting.
- Export reconciliation reports.
- Add management summary views.

## 17. Acceptance Criteria

1. A user can open the KHC Hub and access the **Nexpack Reconciliation** tab.
2. A user can import a Nexpack invoice and see invoice details and product lines before saving.
3. A user can save the invoice and later find it in the invoice list.
4. A user can confirm or correct product lines.
5. A user can enter expected prices for products.
6. The system flags invoice lines where the price does not match the expected price.
7. Clicking a price warning explains the expected price, actual price, and variance.
8. A user can import a NexTrade scan-in file.
9. The system can show whether invoice products were actually received.
10. The system flags products that were invoiced but not received.
11. A user can enter or import payment evidence.
12. The system shows whether each invoice is unpaid, partially paid, paid, overpaid, or needs review.
13. A user can filter purchases and invoice totals by daily, weekly, monthly, yearly, and custom date ranges.
14. A user can export a reconciliation output file containing invoice, pricing, receiving, payment, and issue details.
15. Manual overrides are logged with user, time, and reason.

## 18. Initial MVP Recommendation

The first useful version should focus on:

- Import invoice.
- Save original invoice.
- Break down product lines.
- Confirm products.
- Maintain expected prices.
- Flag price issues.
- Show invoice totals by date range.

After that is stable, add NexTrade scan-in matching and payment matching. This avoids making the first version too large while still giving the team immediate value.
