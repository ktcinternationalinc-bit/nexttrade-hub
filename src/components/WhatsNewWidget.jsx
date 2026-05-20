'use client';
// ============================================================
// WhatsNewWidget — v55.45.
//
// A small clickable pill on the dashboard that surfaces the latest build
// version + date. Click it to see a full changelog with one expandable
// section per release.
//
// Why this exists: Max asked for a place on the dashboard that "tells you
// the date of the new build, and if you click on it tells you all the
// different things added in that new build with new fixes." This is that.
//
// To add a new release: prepend a new entry to BUILD_HISTORY at the top of
// the array. The widget always shows the FIRST entry as the latest.
// Format:
//   { version: 'v55.45', date: '2026-05-06', label: 'Short label', items: [
//       'Bullet describing fix one',
//       'Bullet describing fix two',
//   ] }
// ============================================================
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// IMPORTANT: latest release goes at the TOP. Newest-first order.
//
// Style guide (per Max, May 6 2026):
//   - Plain everyday language. NO developer jargon.
//   - "Here's what you'll see" not "Here's what we changed in the code."
//   - Anyone on the team should understand without asking what something means.
//   - Avoid: RLS, payload, schema, endpoint, callback, hook, prop, async,
//     z-index, regex, refactor, flag, bool, snapshot, etc.
//   - OK to mention business-side things: invoice, customs, FX rate, EGP, USD,
//     WhatsApp, the calendar, the Sales tab.
export const BUILD_HISTORY = [
  {
    version: 'v55.83-A.6.27.42',
    date: '2026-05-19',
    label: '+ Variant button from Product Master + readability fix on rows',
    items: [
      '**Create a variant without going through Receive Stock.** Every family template row now has a purple "+ Variant" button. Click it to open a modal, pick the 4 specs (Category, Construction, Backing, Pattern), and the system either reuses an existing variant with those specs OR creates a new one with the next sequential suffix (LLBKUS-001, LLBKUS-002, etc.). Same logic as the auto-creation that happens during receipt — just available manually now.',
      '**Smooth-Black soft warning** appears in the variant modal if you pick Category=Smooth on a non-Black template. Override is allowed; just a heads-up.',
      '**Row contrast fixed.** Product Master rows now use solid white background with dark slate text. No more pale-grey text on dark theme — every product row is now easy to read regardless of theme.',
      '**Actions column widened** from 220px to 280px to fit 5 buttons (Star, Edit, + Variant, Copy, Deactivate) without overflow.',
      '**No SQL needed** — pure UI/code build. Just deploy and refresh.',
      { superAdminOnly: true, text: 'InventoryProductMaster.jsx — new state: variantModalOpen (boolean), variantTemplate (the family template being expanded), variantForm (4 spec codes), variantBusy (during RPC). Handlers: openCreateVariant(template) guards on is_family_template===true, sets state, opens modal; closeVariantModal() clears state; saveVariant() validates 4 codes, calls supabase.rpc("get_or_create_variant", {p_template_id, 4 codes, p_user_id}), reloads on success, toasts the resulting variant signature, closes modal.' },
      { superAdminOnly: true, text: 'Row UI: container changed from "border-t border-slate-100 + (active ? "" : bg-slate-50 opacity-60)" to "border-t border-slate-200 bg-white text-slate-900 + (active ? "" : opacity-60)" — forces high-contrast white-row dark-text everywhere. Grid widened from 220px → 280px actions column. New "+ Variant" button rendered only when canEdit && p.is_family_template === true; styled bg-purple-600 hover:bg-purple-700 text-white (high contrast).' },
      { superAdminOnly: true, text: 'Modal UI: bg-white text-slate-900 outer card, bg-purple-700 text-white header banner, slate-100 footer. 4 select dropdowns use border-2 border-slate-300 bg-white text-slate-900 font-semibold (no pale text). Smooth-Black warning extracts color from classification_slug split index 5 — only shows when category SM AND color !== BK. Footer: Cancel (slate-300 text-slate-900) + Create (purple-600 text-white). Both readable.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-42-create-variant.js — 38 assertions across 8 parts: row contrast (3), modal state (4), handlers (6), button UI (4), modal UI (10), Smooth-Black warning (4), footer (3), contrast lint (1) + regression guards (8) + version stamp (1). Sweep: 227/0. 2 prior tests updated to recognize new grid widths and amber-200 styling.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.41',
    date: '2026-05-19',
    label: 'Star button visibility + actions column width fix',
    items: [
      '**Star button is now impossible to miss** — bigger size, clear amber outline when unstarred, filled amber background when starred.',
      '**Actions column widened** so Edit / Copy / Deactivate / Star all fit without crowding.',
    ],
  },
  {
    version: 'v55.83-A.6.27.40',
    date: '2026-05-19',
    label: 'Star toggle + Featured/Type filters in Product Master',
    items: [
      '**Star your favorites right from the Product Master tab.** Each product row has a star (☆) button on the left of the action buttons. Click it to mark featured (⭐). Featured products always rise to the top of search dropdowns in Receive Stock, Adjustments, and (when shipped) Sales Invoice.',
      '**New filter chips in Product Master.** Three new ways to narrow what you see: ⭐ Starred only — only your featured products; All products / Family templates only / Variants only — slice the catalog by type; the search box now supports multi-keyword search (any order, case-insensitive, partial words).',
      '**Quick code now shows variant suffix.** A row like LLBKUS-001 displays the full code in the list. FAMILY and VARIANT badges appear next to the code so you can tell them apart at a glance.',
      '**"Used X times" counter** shown on every product that has been used in a receipt at least once. Higher usage rises higher in the dropdown sort.',
      '**No SQL changes needed.** Pure UI/code build. Just deploy and refresh.',
      { superAdminOnly: true, text: 'InventoryProductMaster.jsx — new toggleFeatured(p) async function (mirrors toggleActive pattern): flips featured boolean via dbUpdate, shows "⭐ Starred:" or "☆ Unstarred:" toast, awaits reload. New ⭐/☆ button in row actions (canEdit gated), amber-themed when starred, slate-themed when not, with title tooltip. New row UI: quick_code display appends "-" + variant_suffix for variants, FAMILY badge for templates, VARIANT badge for non-template + suffix rows, "used N×" for use_count > 0.' },
      { superAdminOnly: true, text: 'New filter state: featuredOnly (boolean), typeFilter ("all"/"templates"/"variants"). UI: amber-bordered ⭐ Starred only checkbox + 3-option select for type. filteredProducts useMemo now layers: showInactive → familyFilter → featuredOnly → typeFilter → multi-keyword search → sort (featured DESC, use_count DESC, name_en ASC). Search rewrite identical to Receive Stock pattern — splits on /\\s+/, every keyword must match as substring in lowercase concat of (quick_code + suffix-tag + name_en + name_ar + design_sku + classification_slug). useMemo deps updated to include featuredOnly + typeFilter.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-40-star-toggle.js — 30 assertions: toggleFeatured (6), star button UI (5), quick_code + badges + use_count display (4), filter state + UI (4), filter logic + smart search + sort (10), regression guards (6) + version stamp (1). Final sweep: 225/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.39',
    date: '2026-05-19',
    label: 'Family templates + auto-variants + smart multi-keyword search',
    items: [
      '**Master catalog stays small.** Instead of importing 684 pre-computed product variations, you now import 27 "family templates" — one per unique quick code (Family + Grade + Color + Country). The master is browseable; specific spec combinations get created automatically as you receive them.',
      '**Variants are born at receive time.** When you receive a shipment of LLBKUS, the form now requires 4 spec dropdowns: Category, Construction, Backing, Pattern. The system either reuses an existing variant that matches OR creates a new one with the next sequential suffix (LLBKUS-001, LLBKUS-002, etc.). No manual variant management needed.',
      '**Smart search.** Type any combination of keywords in any order. "lux brown" finds Luxurious Brown. "LLBK" finds Black Luxurious products. "LLBKUS-002" jumps straight to that variant. Case doesn\'t matter. Order doesn\'t matter. Partial words match.',
      '**Featured + most-used rises to the top.** Search dropdown now sorts: starred ⭐ first, then most-used, then alphabetical. Up to 20 results shown (was 10).',
      '**Soft warning when picking Smooth + non-Black.** Smooth leather is typically only available in Black. If you pick a Smooth variant with a different color, you get a yellow warning banner that you can override if it\'s correct.',
      '**Run the v55.83-A.6.27.39 SQL** before importing the new 27-row catalog. Adds the variant columns + the get_or_create_variant function that automates variant creation.',
      { superAdminOnly: true, text: 'Schema changes on inventory_products: is_family_template boolean NOT NULL DEFAULT false; variant_suffix text; parent_template_id uuid self-FK ON DELETE SET NULL. Three partial indexes. New PL/pgSQL function get_or_create_variant(p_template_id, 4 codes, p_user_id) — validates template + is_family_template flag, resolves codes to list_ids, silent-reuses existing variant or creates with COALESCE(MAX(CAST(variant_suffix AS integer)), 0) + 1 lpad to 3 digits.' },
      { superAdminOnly: true, text: 'InventoryReceiving.jsx — emptyLine() gains 6 fields. saveReceipt validates 4 spec codes when is_family_template. Save flow calls supabase.rpc("get_or_create_variant") before payload build; effectiveProductId replaces L2.product_id in payload. UI: purple 🎯 VARIANT SPECS panel rendered conditional on family template; 4 hardcoded dropdown option sets. Smooth-Black warning conditional on SM category + non-BK color extracted from classification_slug.' },
      { superAdminOnly: true, text: 'Smart search rewrite — suggestionsFor() splits on whitespace, every keyword must match as substring across (quick_code + suffix-displayed + name_en + name_ar + classification_slug). Sort: featured DESC, use_count DESC, name_en localeCompare. Capped at 20. Dropdown render adds ⭐, FAMILY/VARIANT badges, displayCode with suffix, used-N× counter.' },
      { superAdminOnly: true, text: 'Importer: TEMPLATE_HEADERS gains is_family_template + variant_suffix. Payload parses both. Duplicate check uses composite key (quick_code|variant_suffix). findProductByQuickCode extended to 2-arg signature.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-39-variants-smart-search.js — 50 assertions across 5 parts (SQL 16, importer 8, receiving 13, UI 7, smart search 10) + regression guards (4) + version stamp. 4 prior tests bumped to accept the new behavior. Final sweep: 224/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.38',
    date: '2026-05-19',
    label: 'Catalog support — 684-row Leather USA catalog + universal Product Picker + featured (⭐) system',
    items: [
      '**684-row Leather USA catalog ready to import.** Every applicable combination across all 9 classification levels with your filters: 2 categories (Smooth/Embossed), 3 grades, 3 constructions, 4 backings, 9 colors, and Embossed-only patterns (Mechanical Grain + Normal Emboss). Smooth restricted to Black-only + None pattern.',
      '**Universal Product Picker — search any way you like.** New picker screen used everywhere products are selected (Receive Stock, Adjustments, future Sales Invoice). Three modes coexist: (1) type a quick code like LLBKUS to filter by prefix, (2) type any keyword like "embossed" or "brown" or "cotton" and it matches across product names + classification labels, (3) tap "Show cascade filters" to pick Family → Category → Grade → ... step by step.',
      '**Star (⭐) your favorites.** Click the star icon on any product in the picker to mark it featured. Featured products always appear at the top of every picker, regardless of search. After import, all 684 products start unstarred — go to Product Master and star the ones you sell often.',
      '**Use count tracking.** Every time a product is used on a receipt, the system auto-increments its use_count. The picker sorts by featured first, then by use_count (most-used first), then alphabetical. Popular products naturally rise to the top over time.',
      '**Run the consolidated SQL before deploying.** Fixes the Level 9 constraint, adds USA at Level 9, adds featured + use_count columns, drops the UNIQUE constraint on quick_code (multiple master rows can now share a quick code since the 684 catalog has dozens of LLBKUS variants differing in construction/backing/pattern), adds the use_count trigger, and fixes missing Leather Pattern parent rules.',
      '**Importer relaxed.** Only 4 levels required for import: Family (L1), Grade (L3), Color (L6), Origin (L9). The other 5 (Category, Construction, Backing, Pattern, Spec Class) can be left blank in the master and filled at receipt time. The 684-row catalog does fill all 9 levels for completeness, but the importer now accepts partial rows too.',
      { superAdminOnly: true, text: 'SQL migration v55-83-a-6-27-38-catalog-support.sql: (1) ALTER TABLE inventory_lists DROP/ADD constraint inventory_lists_level_check CHECK (level BETWEEN 1 AND 9). (2) INSERT (9, US, United States, ...) ON CONFLICT DO NOTHING. (3) ADD COLUMN featured boolean DEFAULT false + use_count integer DEFAULT 0 on inventory_products. (4) Partial index idx_inv_products_featured WHERE featured=true + idx_inv_products_use_count ON (use_count DESC). (5) DROP INDEX idx_inv_products_quick_code_active (was UNIQUE WHERE active=true) + CREATE non-UNIQUE index idx_inv_products_quick_code ON lower(quick_code) WHERE quick_code IS NOT NULL. (6) increment_product_use_count() PL/pgSQL trigger function + trigger_increment_use_count_on_receipt AFTER INSERT ON inventory_stock_receipts. (7) INSERT inventory_list_rules for Leather Pattern (MG, RG, NA → L) via cross-join ON CONFLICT DO NOTHING. (8) Refresh classification_slug for any existing products.' },
      { superAdminOnly: true, text: 'New component ProductPicker.jsx (~310 lines). Props: onPick(product), onClose, placeholder, filterByStock (boolean — when true, fetches inventory_layers + filters to products with qty_remaining > 0), userProfile, isSuperAdmin, modulePerms. Loads products + lists + rules + layers in parallel. Three search modes coexist: (1) isQuickCodeSearch = /^[A-Za-z0-9]+$/.test(query) → quick_code.indexOf(qLower) === 0 prefix match; (2) keyword search across name_en + name_ar + classification_slug + FK labels (typing "embossed" matches all products where category_list_id.label_en includes "embossed"); (3) cascade dropdowns — Object.keys(cascade) loop filters by each picked level. Family change resets all dependent levels. cascadeOptionsFor(level) respects parent rules: only shows children that have a rule linking them to chosen Family (OR have no rules at all, treated as universal). Universal sort: featured first (1 vs 0), then use_count desc, then alphabetical by quick_code + name. Results capped at first 200 with overflow message. Star toggle via ☆/⭐ buttons calls dbUpdate(inventory_products, id, {featured: !current}) — canEdit gated. Empty-state messaging differs for filterByStock mode.' },
      { superAdminOnly: true, text: 'Catalog generator scripts/generate-leather-usa-full-catalog-v38.js produces 684-row Excel with filters from this conversation: Smooth branch (3 grades × 3 constructions × 4 backings × 1 color × 1 pattern = 36) + Embossed branch (3 × 3 × 4 × 9 × 2 = 648). Quick code formula: Family[0]+Grade[0]+Color(2)+Country(2) = 6 chars. All featured = FALSE initially. Output: KTC-Leather-USA-Full-Catalog-YYYY-MM-DD.xlsx, 700 KB, 4 sheets (Products/Codes Reference/Rules/Instructions).' },
      { superAdminOnly: true, text: 'Importer InventoryImportProducts.jsx changes: REQUIRED_LEVELS constant = [1, 3, 6, 9] (was [1-8]). LEVEL_COL + LEVEL_FK extended to Level 9 (origin_code → origin_list_id). Cascade rule check loops [2-9] (was [2-8]). featured column parsed from TRUE/1/YES → boolean. TEMPLATE_HEADERS includes featured column.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-38-catalog-support.js — 50 assertions across 5 parts: SQL migration (12) covering all constraint/column/index/trigger changes; ProductPicker component (17) covering parallel load + 3 search modes + filterByStock + sort priority + cascade-Family-reset + chip removal + star toggle + 200-row cap; importer relaxation (7) covering REQUIRED_LEVELS + LEVEL_COL + featured parsing; catalog generator (9) covering filter exclusions (no FP/FL/OT/NA-backing/GR-backing/SW/DG/LG/Grade-NA/HC) + Black-only Smooth + featured=FALSE default; regression guards on Builds 4.3/4.4/4.5 + 4.37 (5). Sweep: 223/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.37',
    date: '2026-05-19',
    label: 'Receive Stock fixes — save shipment without products, wider form, US/CA/CN origin only',
    items: [
      '**You can now save a shipment without picking any products yet.** New "📋 Save Shipment Only (no products)" button at the bottom of the New Receipt form. Click it after filling just the shipment info (date, warehouse, shipment reference, supplier, ETA, etc.) — the system saves it as Pending Detail and you can come back later via Edit to add products as they arrive.',
      '**Form is much wider now.** Modal expanded from 1100px to 1400px wide, and the body is taller (scroll bar appears much later). You should be able to see the full Phase 1 + Phase 2 + Variance sections on one screen without scrolling on most monitors.',
      '**Origin Country dropdown added to the shipment header.** Three options for now — 🇺🇸 United States, 🇨🇦 Canada, 🇨🇳 China. Saved with the shipment so you can filter and group shipments by where they came from.',
      '**Run the SQL migration before deploying.** Creates the new inventory_shipment_headers table (where header-only shipments live), adds the optional header_id link to inventory_stock_receipts, and trims the master country list to just US/CA/CN.',
      { superAdminOnly: true, text: 'New table inventory_shipment_headers: receipt_number UNIQUE NOT NULL, status CHECK (pending_detail/received/finalized/cancelled), all shipment fields (shipment_reference/supplier/warehouse_id/freight_forwarder/shipping_line/container_number/eta_date/arrival_date/purchase_currency/origin_country_code/notes), full audit cols + cancelled_at/by/reason. 4 indexes (date/status/warehouse/shipment_ref-partial). RLS enabled with permissive read+write policies. updated_at trigger. inventory_stock_receipts gets new optional header_id FK CASCADE — when a header is deleted, all its product lines cascade. Backfill DO block creates headers for existing receipts (one per distinct receipt_number) so they show up in the same unified list.' },
      { superAdminOnly: true, text: 'Country list trim — Level 9 (Origin Country) soft-disables everything except US/CA/CN via UPDATE inventory_lists SET active=false WHERE level=9 AND code NOT IN (US, CA, CN). Then ensures US/CA/CN exist (ON CONFLICT DO NOTHING) and explicitly reactivates them. Done as soft-disable not DELETE so any inventory_products that might reference an old country code still have a valid FK. Easy to re-expand later by setting active=true.' },
      { superAdminOnly: true, text: 'InventoryReceiving.jsx changes: (1) headers state + parallel fetch in load() and reload() (4-way Promise.all now). (2) origin_country_code: USD default added to header state in 3 places (initial state / openNew / closeModal). (3) New saveShipmentHeaderOnly() function — validates date/warehouse/shipment_reference, upserts via maybeSingle on receipt_number, generates receipt_number via existing RPC, status="pending_detail", inserts into inventory_shipment_headers. (4) Modal footer gets new amber "📋 Save Shipment Only (no products)" button next to "✓ Save Receipt". (5) Origin Country dropdown (US/CA/CN with flag emojis) added to header form Row 2 next to Purchase Currency. (6) Modal widened maxWidth 1100→1400, body maxHeight calc(100vh - 220px) → calc(100vh - 140px). (7) Grouped list logic now merges header-only shells: builds existingNumbers map of receipt_numbers with lines, loops headers and pushes phantom rows for any header not represented, applying all filters (status/warehouse/from/to/search). Phantom rows have isHeaderOnly:true + header_id + header object. Grouped list re-sorted newest-first by date desc then receipt_number desc. (8) openEdit() detects grouped.isHeaderOnly=true and short-circuits — loads header data from grouped.header, sets lines to [emptyLine()], opens modal. Operator picks product and saves with regular Save Receipt.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-37-shipment-headers.js — 41 assertions across 6 parts: SQL migration (16) covering inventory_shipment_headers structure + header_id FK + backfill DO block + status mapping + country trim soft-disable/reactivate; component state (5); saveShipmentHeaderOnly function (7); UI changes (5) covering button + dropdown + 3-country restriction + widened modal; grouped merge logic (5); openEdit shell handling (4); regression guards on Builds 4.3/4.4/4.5 + A.6.27.28 (6). Sweep: 221/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.36',
    date: '2026-05-19',
    label: 'Build 4.5 — Adjustments (damage / theft / transfers / cost restatement)',
    items: [
      '**New tab: 🔧 Adjustments under Inventory.** Records the four kinds of stock changes that aren\'t receipts and aren\'t sales — quantity corrections, damage, theft, warehouse transfers, and cost restatements.',
      '**Quantity Adjustment.** Click "+ Quantity Adjustment" to record damage, theft, or count corrections. Pick increase (found stock, count was under-reported) or decrease (damaged, stolen, count was over-reported). The system shows you current available stock at that warehouse so you know what\'s actually on hand before making the adjustment. Reason is required and goes into the audit trail forever.',
      '**Decreases consume oldest stock first (FIFO).** When you decrease 50 meters of a product, the system walks your cost layers oldest-first, decrementing each one until 50 meters is accounted for. This keeps your inventory valuation accurate — the cost of the damaged/stolen stock matches what you actually paid for that batch, not some made-up average.',
      '**Warehouse Transfer.** Click "+ Warehouse Transfer" to move stock from one warehouse to another. Pick source, destination, product, and quantity. The system creates paired movements (transfer out at source, transfer in at destination) tied together with a transfer reference number, so you can always see both halves of the transfer in the Movements ledger.',
      '**Cost Restatement (super_admin only).** If a supplier sends a corrected invoice or you discover you missed a cost component during finalization, super_admins can restate the cost on a specific FIFO layer. The old and new costs are both saved so you have a complete history. A warning appears explaining that sales already drawn from that layer at the OLD cost will need restatement in reports.',
      '**Insufficient stock protection.** Try to decrease or transfer more than you have, and the system catches it both client-side (warning popup) and server-side (atomic transaction rolls back). You can\'t accidentally end up with negative stock.',
      '**Every adjustment auto-creates movement ledger entries.** No need to manually track these — the Movements screen will show each one with proper color coding (Adjustment In emerald / Out rose / Transfer blue / Reversal slate). Cost Layers screen reflects the FIFO consumption in real time.',
      '**Run the SQL migration before deploying.** Creates inventory_adjustments table + 4 SQL functions (consume_layers_fifo, apply_quantity_adjustment, apply_warehouse_transfer, apply_cost_adjustment) + adds transfer_pair_id column to inventory_movements.',
      { superAdminOnly: true, text: 'New table inventory_adjustments: adjustment_type CHECK (quantity_increase/quantity_decrease/warehouse_transfer/cost_restatement), product_id FK RESTRICT, source + destination warehouse FKs RESTRICT, source_layer_id FK SET NULL (for cost restatements), old_cost_per_uom + new_cost_per_uom for restatement audit, transfer_pair_id uuid for linking transfer_out + transfer_in pairs, reason NOT NULL, notes, full audit cols. 6 indexes (type/date/product/source/dest/transfer_pair-partial). RLS enabled with permissive read+write policies. inventory_movements gets new transfer_pair_id column + partial index.' },
      { superAdminOnly: true, text: 'consume_layers_fifo(product, warehouse, qty, movement_type, date, adjustment_id, transfer_pair, reference, notes, user_id) PL/pgSQL function: walks open layers WHERE product_id+warehouse_id+status=open+qty_remaining>0 ORDER BY receipt_date ASC, created_at ASC, FOR UPDATE. Uses LEAST(qty_remaining, remaining_to_consume) per layer. Decrements qty_remaining and sets status=closed when qty_remaining<=0. Inserts a movement row per layer touched (signed negative quantity, source_layer_id back-reference). Raises exception if insufficient stock with helpful message including shortfall amount. Returns total_cost consumed (used by transfer to compute weighted-avg destination cost).' },
      { superAdminOnly: true, text: 'apply_quantity_adjustment(product, warehouse, qty, direction, uom, reason, notes, user_id, date): validates direction in (increase, decrease) and reason required. Increase = INSERT inventory_adjustments + INSERT adjustment_in movement directly (no FIFO consume — quantity-only adjustments don\'t create new cost basis; the increase quantity exists outside layers until consumed by a future sale or transfer). Decrease = INSERT adjustment + consume_layers_fifo() to deplete oldest layers. Returns adjustment id.' },
      { superAdminOnly: true, text: 'apply_warehouse_transfer(product, source_wh, dest_wh, qty, uom, reason, notes, user_id, date): validates source≠dest and reason required. Generates transfer_pair_id once via gen_random_uuid(). Reads cost_currency from source layer for the destination movement. Calls consume_layers_fifo() to deplete source AS transfer_out movements (each tagged with transfer_pair_id). Computes weighted-avg cost (total_cost / qty) for the destination side. Inserts ONE transfer_in movement at destination with the avg cost. NOTE: does NOT create new inventory_layers rows at destination — layer source_receipt_id is UNIQUE NOT NULL. Stock-on-hand reports must aggregate movements per (product, warehouse) when transfers exist. Build 5 reports will handle this correctly.' },
      { superAdminOnly: true, text: 'apply_cost_adjustment(layer_id, new_cost, reason, notes, user_id, date): SELECT layer FOR UPDATE, validates new_cost >= 0 and reason required. INSERTS inventory_adjustments row with type=cost_restatement, source_layer_id, old_cost_per_uom, new_cost_per_uom. UPDATES inventory_layers.cost_per_uom = new_cost. Does NOT create a movement (cost-only changes don\'t move stock). Future FIFO consumption from this layer uses the new cost. Sales already consumed at the old cost need restatement (flagged in Build 5 reports).' },
      { superAdminOnly: true, text: 'New component InventoryAdjustments.jsx (~560 lines). 3-tier permission: canView (Inventory or Edit Inventory or super_admin) / canEditAdj (Edit Inventory or super_admin) / canCostAdj (super_admin only). Loads adjustments + products + warehouses + open layers in parallel. openStockFor() helper sums qty_remaining for (product, warehouse) — used in modal banners to warn before client-side. Three modals (quantity / transfer / cost) each opened from action buttons in the header. Quantity modal has decrease/increase tab buttons + product/warehouse picker + qty input + reason + UOM + date + available-stock banner. Transfer modal has product + source + dest + qty + reason + UOM + date + source-stock banner. Cost modal (super_admin only) has layer picker dropdown showing receipt# / product / warehouse / qty_remaining / cost_per_uom for each open layer, with current-cost preview when picked + new cost input + reason. Each submit calls the matching RPC and reloads on success. Error path surfaces alert with SQL migration hint.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-36-adjustments.js — 75 assertions across 3 parts: SQL migration (32) covering inventory_adjustments table structure + transfer_pair_id column + 4 functions (consume_layers_fifo with FOR UPDATE + insufficient stock raise + per-slice movements, apply_quantity_adjustment with direction validation + increase-direct-insert vs decrease-FIFO branching, apply_warehouse_transfer with source≠dest + weighted-avg cost + paired pair_id, apply_cost_adjustment with FOR UPDATE lock + old+new recording); component (28) covering permission tiers + 3 modal types + validation per submit + RPC calls + available-stock banners + cost-restatement old→new display + filter bar; InventoryTab wiring (4); regression guards on Builds 4.2/4.3/4.4 + A.6.27.28/31 (5). Sweep: 220/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.35',
    date: '2026-05-19',
    label: 'Build 4.4 — Two-Phase Receiving (save expected totals now, fill rolls later) + Edit + Reopen',
    items: [
      '**The biggest improvement to Receive Stock.** You can now save a receipt with just the headline numbers from the supplier (expected rolls, expected gross kg, expected total in meters/yards) and come back later to enter each individual roll as it physically arrives. No more being blocked at the door because you don\'t have every detail yet.',
      '**Phase 1 — Save the expected totals.** When a shipment is on the way, open New Receipt → fill the shipment header → on each product line, enter what the supplier said they\'re sending (expected rolls + expected gross kg + expected net kg + expected total in your UOM). Click Save. Status becomes "Pending Detail." Done — the system has it on file.',
      '**Phase 2 — Add rolls as they arrive.** Click Edit on the receipt later. The Phase 2 section lets you add each physical roll one at a time: roll #, gross kg, net kg, meters (or yards/sqm), rack, and notes. Add or remove rolls as needed.',
      '**Live variance display.** As you enter rolls, the system shows you exactly how the actuals compare to the expected — by roll count, gross kg, net kg, and UOM total. If there\'s any difference, you see it immediately in red ("⚠ VARIANCE DETECTED") with the exact deltas (e.g. "-2 rolls, -170 kg gross, -250 meters"). If everything matches, you see green ("✓ EXPECTED MATCHES ACTUAL").',
      '**Variance reason or acknowledge required.** When variance exists, you must either type a reason (e.g. "short shipment", "damaged on arrival", "free samples added") OR check the acknowledge box. Either way it\'s saved with full audit trail. You can\'t save a variance silently.',
      '**Edit existing receipts.** Any receipt that\'s NOT cancelled and NOT finalized can be edited — header fields, line fields, rolls, costs, anything. Just click the new ✏️ Edit button on the receipt row. Requires Edit Inventory permission.',
      '**Reopen finalized receipts (super_admin only).** Made a mistake on a finalized receipt? Click 🔓 Reopen. The system reverses the cost layer (full audit), flips status back to Received, and lets you edit. When you re-finalize, a new cost layer is created with the corrected data. Any sales that drew from the original layer get flagged for COGS restatement (Build 4.5 work).',
      '**Editable base cost on receipt lines.** The Cost per UOM field auto-fills from Product Master defaults (with blue background showing it\'s inherited), but you can type over it. If you enter a different price (e.g. supplier raised their rate this shipment), a 📌 button appears letting you push the new cost back to the Product Master too.',
      '**Save partial costs before finalizing.** You can save a receipt with cost data entered, leave, come back tomorrow, edit the costs, and only finalize when everything is correct. Costs stay editable up until the moment you click Confirm in the Finalize Cost dialog.',
      '**Purchase Currency now defaults to USD** (was EGP). Matches your typical international import workflow. Override per-shipment if a particular supplier bills in EGP or EUR.',
      '**Run the SQL migration before deploying.** Adds five new columns to inventory_stock_receipts (4 expected_* + variance_acknowledged), extends the status check to include "pending_detail", creates the new inventory_receipt_rolls child table, and adds the reopen_finalized_receipt() function.',
      { superAdminOnly: true, text: 'New table inventory_receipt_rolls: receipt_id FK to inventory_stock_receipts with ON DELETE CASCADE (rolls disappear if parent receipt is deleted), roll_number text + roll_sequence integer for ordering, gross_kg/net_kg/meters numerics with CHECK >= 0 constraints, rack + notes text, created_by/updated_by + audit timestamps. Indexes on receipt_id and (receipt_id, roll_sequence). RLS enabled with permissive read+write policies. updated_at trigger.' },
      { superAdminOnly: true, text: 'inventory_stock_receipts extensions: 4 new expected_* nullable columns (expected_rolls integer, expected_gross_kg numeric, expected_net_kg numeric, expected_uom_total numeric) + variance_acknowledged boolean. chk_status enum extended to include "pending_detail" alongside existing active/received/finalized/cancelled. New status flow logic in saveReceipt: status = "received" if actual quantity OR rolls present, else "pending_detail". The CHECK constraint on quantity > 0 still applies, so pending_detail rows store 0.001 as a placeholder when neither actual nor expected_uom_total is set (this only happens if user fills ONLY expected_rolls or expected_gross_kg).' },
      { superAdminOnly: true, text: 'reopen_finalized_receipt(p_receipt_id uuid, p_user_id uuid, p_reason text) PL/pgSQL function: 1) validates status=finalized else raises exception, 2) inserts reversal movement with -quantity, 3) updates inventory_layers SET status="reversed" WHERE source_receipt_id matches AND status="open", 4) flips inventory_stock_receipts status back to "received" and clears landed_cost_per_uom/landed_total/finalized_at/finalized_by/allocation_method/fx_rate_used. The Build 4.3 trigger on_receipt_finalize_create_ledger() does NOT fire on this status transition (only on TO finalized or finalized→cancelled).' },
      { superAdminOnly: true, text: 'InventoryReceiving.jsx — emptyLine() extended (expected_rolls/expected_gross_kg/expected_net_kg/expected_uom_total + rolls[] array + existing_id tracker + variance_acknowledged + currency:USD). Header state purchase_currency:"USD" in 3 places (state init / openNew / closeModal). saveReceipt completely rewritten: validation now requires at-least-one-of (actual quantity OR expected totals OR rolls) per line instead of strict quantity > 0; status derived from data (pending_detail vs received); edit-mode uses existing_id to UPDATE vs INSERT; receipt_number reused when editing; rolls saved via delete-then-insert per line for simplicity. New openEdit(grouped) hydrates existing receipt header + lines + rolls (fetched via .in() on all line ids) into modal state. New reopenReceipt(grouped) requires isSuperAdmin, prompts for reason + confirmation, calls reopen_finalized_receipt RPC per finalized line, reloads. List row gets two new buttons: ✏️ Edit (non-finalized non-cancelled, canEdit gate) and 🔓 Reopen (finalized only, super_admin gate). Modal title shows "Edit Receipt RCV-..." when editing.' },
      { superAdminOnly: true, text: 'Modal UI: new amber Phase 1 panel ("📋 PHASE 1 — EXPECTED TOTALS") with 4 input columns for expected_*; new blue Phase 2 panel ("📦 PHASE 2 — INDIVIDUAL ROLLS") with + Add Roll button, condensed 8-column roll grid (#/roll_number/gross/net/meters/rack/notes/✕), inline ✕ remove. Variance summary panel below rolls — green (matches) or red (variance) — 4-column display with current/expected/delta for rolls + gross + net + UOM dimensions. Variance reason input + acknowledge checkbox appear when variance detected. Status filter dropdown extended with "Pending Detail" option (orange bg-orange-100 badge variant added).' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-35-two-phase-receiving.js — 76 assertions across 6 parts: SQL migration (17) covering all expected_* columns + status enum + receipt_rolls table structure + CHECK constraints + RLS + reopen function logic; component state (8) including emptyLine extensions + USD defaults; save flow (10) covering two-phase derivation + edit-mode + rolls insertion + delete-then-insert + variance ack; openEdit/reopenReceipt (11) covering permission gates + hydration + RPC calls; UI (15) covering Phase 1/Phase 2/variance/edit/reopen sections; status badge + filter (3); regression guards on Builds 4.0/4.1/4.2/4.3 + A.6.27.28/31 (6). Updated 5 stale assertions in prior tests (29 B3b/B4b/B11d/B11e for receipt_number + emptyLine expansion + relaxed quantity/batch validation, 32 B2e/B3a/B3b/D1/E8 + V1 for EGP→USD currency flip + status derivation + Received Qty label change). Sweep: 219/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.34',
    date: '2026-05-19',
    label: 'Build 4.3 — Movements Ledger + FIFO Cost Layers (the inventory engine)',
    items: [
      '**The inventory engine is now live.** Two new screens under Inventory: 📜 Movements (every stock change ever, append-only audit trail) and 🧱 Cost Layers (current stock-on-hand with cost per item per warehouse, ordered oldest-first FIFO).',
      '**Auto-populated.** You don\'t have to do anything to fill these screens. When you finalize a receipt in Receive Stock (with Finalize Cost), the system automatically creates one Movement row and one Cost Layer row. When sales start consuming stock (Build 4.6 next), each sale will create its own Movement row and decrement the oldest open Cost Layer first.',
      '**Movements screen — every stock change in one place.** Filter by product, warehouse, type (Receipt In / Sale Out / Transfer / Adjustment / Reversal), and date range. Plus / minus signs and color coding show flow direction (emerald for in, rose for out). Cost columns shown only if you have View Costs permission.',
      '**Cost Layers screen — what you actually have right now.** Two views: Summary shows total stock-on-hand and inventory value per product per warehouse (top of every dashboard). Layers view shows each individual FIFO layer with age in days, quantity remaining vs received, cost per unit, and status (Open / Empty / Closed / Reversed).',
      '**Live inventory valuation.** When you have View Costs permission, the Cost Layers screen shows a grand-total strip at the top: TOTAL INVENTORY VALUE in EGP, number of open layers, total layers all-time. This is your live "what is my warehouse worth right now" number.',
      '**Automatic reversal on cancellation.** If you cancel a finalized receipt, the system automatically creates a Reversal movement (negative quantity) and marks the matching cost layer as Reversed. Full audit trail preserved — nothing is ever deleted.',
      '**Run the SQL migration before deploying.** Creates two new tables, a Postgres trigger that fires on receipt finalization, and a backfill block that creates layers for any receipts already finalized via Build 4.2. Safe to re-run.',
      { superAdminOnly: true, text: 'New table inventory_movements: 7 movement types (receipt/sale/transfer_in/transfer_out/adjustment_in/adjustment_out/reversal) with CHECK constraint, signed quantity, source_receipt_id FK SET NULL, source_layer_id (FK added post-creation via DO block due to forward reference), source_invoice_id (for Build 4.6), source_adjustment_id (for Build 4.4), reference_number + notes for human-readable context, cost frozen at movement time. 6 indexes including composite product+warehouse for fast stock-on-hand queries. RLS enabled.' },
      { superAdminOnly: true, text: 'New table inventory_layers: source_receipt_id UNIQUE FK RESTRICT (prevents duplicate layers per receipt, prevents accidental receipt deletion if layer exists), qty_received CHECK > 0, qty_remaining with CHECK (>=0 AND <= qty_received) so consumption can\'t go negative or exceed received, cost_per_uom NOT NULL (frozen at finalization), status CHECK (open/closed/reversed), fx_rate_used captured for future restatement audits. 5 indexes including the critical partial idx_layers_open_by_product (product_id, warehouse_id, receipt_date) WHERE status=open AND qty_remaining > 0 — this powers FIFO consumption in Build 4.6.' },
      { superAdminOnly: true, text: 'Trigger on_receipt_finalize_create_ledger() fires AFTER UPDATE on inventory_stock_receipts. When status transitions to "finalized" AND landed_cost_per_uom IS NOT NULL AND quantity > 0: idempotently inserts one layer row + one receipt-type movement row. Idempotency: checks for existing layer by source_receipt_id, checks for existing movement by source_receipt_id + movement_type=receipt. When status transitions from "finalized" → "cancelled": auto-inserts reversal movement (-quantity, current date, references cancel_reason) and updates layer status=reversed. Backfill DO block at end of migration handles any receipts already finalized before the trigger existed.' },
      { superAdminOnly: true, text: 'New component InventoryMovementsLedger.jsx (~200 lines). Read-only. canView = isSuperAdmin OR Inventory OR Edit Inventory. seeCosts gates cost columns via canSeeInventoryCosts. Loads up to 1000 most-recent movements + products + warehouses in parallel. Filter bar: search (matches product quick_code/name/reference/notes), product dropdown, warehouse dropdown, movement_type dropdown (all 7 types + all), date from/to. MOVEMENT_LABELS map with emerald/rose/blue/amber/slate color-coded badges per type. Signed quantity colored rose for out (Number < 0) / emerald for in. Cost columns conditional on seeCosts.' },
      { superAdminOnly: true, text: 'New component InventoryCostLayers.jsx (~280 lines). Read-only. Same permission model. Loads layers ORDER BY receipt_date ASC (FIFO oldest first). Two view modes via toggle buttons: "Summary" (roll-up by product × warehouse with qty_remaining sum + total_value sum + layer_count, only counts open layers with qty_remaining > 0) and "Layers" (individual layer rows ordered FIFO). Grand-total strip: TOTAL INVENTORY VALUE EGP (sum of qty_remaining × cost_per_uom over open layers, respects product+warehouse filters), OPEN LAYERS count, TOTAL LAYERS all-time. Strip only visible when seeCosts. Filter bar: search + product + warehouse + status (only shown in Layers view). Layers view shows age in days via ageDays() helper, qty_remaining / qty_received fraction with greyed denominator, cost_per_uom in mono font with currency suffix, status badge (Open=emerald if qty>0, Empty=slate if qty=0, Closed=slate, Reversed=rose).' },
      { superAdminOnly: true, text: 'Wired into InventoryTab.jsx: two new SUBTABS entries under "Engine" stage (movementsledger + costlayers), permission gate accepts super_admin / Inventory / Edit Inventory, render branches mount components with full props (userProfile / modulePerms / isSuperAdmin / toast).' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-34-movements-layers.js — 60 assertions across 6 parts: SQL inventory_movements table (12) including CHECK constraints + 6 indexes + RLS + forward-reference FK via DO block, SQL inventory_layers table (11) including UNIQUE source_receipt_id + qty constraints + partial idx for FIFO + RLS + updated_at trigger, SQL trigger function (10) covering fire condition + idempotency for both layer and movement + cancellation reversal + backfill DO block, MovementsLedger component (11), CostLayers component (14) covering view toggle + summary roll-up + grand-total strip + status badge variants + age + qty fraction, InventoryTab wiring (7). Regression guards on Builds 4.0/4.2/4.5 + old shipments hidden + A.6.27.28/31. Sweep: 218/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.33',
    date: '2026-05-19',
    label: 'Build 4.2 — Finalize Landed Cost (freight, customs, duty, insurance allocated across all lines)',
    items: [
      '**Most important business feature in the rebuild: TRUE landed cost.** When a shipment arrives, the purchase price (what you paid the supplier) is just the start. Freight, customs duty, insurance, clearing fees, local transport — all of those are real costs that need to be added to figure out what each roll actually cost you. Without this, your COGS (cost of goods sold) is undercounted on every sale and your profit numbers are wrong.',
      '**How to use it.** In Inventory → Receive Stock, find a receipt with status "Received" → click the new "Finalize Cost" button. A dialog opens with six cost fields: Freight, Customs Duty, Insurance, Clearing / Broker, Local Transport, Other. Enter each cost in whatever currency you paid in (EGP / USD / EUR). The system fetches today\'s USD→EGP exchange rate automatically (with manual override if you want a specific rate). Pick how to split the costs across the lines — by quantity, by weight (kg), or by value. Preview shows you the final landed cost per line and per UOM. Confirm and you\'re done.',
      '**Three allocation methods so you can pick what makes sense per shipment.** By Quantity is simplest (good when everything is the same product type). By Weight is more accurate for ocean freight where heavier goods deserve more of the freight cost. By Value is right when customs duty is a percentage of declared value.',
      '**Once finalized, status changes from Received → Finalized.** The Total Cost column in the receipt list now shows the FULL landed cost (purchase + freight + customs + everything) instead of just the purchase price. Build 4.3 (Cost Layers + Movements) will use this landed cost as the official COGS basis for any sales that draw from this stock.',
      '**Run the SQL migration before deploying.** New table inventory_landed_costs (one row per receipt with the full cost breakdown), plus six new columns on the receipts table (landed_cost_per_uom, landed_total, finalized_at, finalized_by, allocation_method, fx_rate_used). SQL block in chat for copy-paste.',
      { superAdminOnly: true, text: 'New table inventory_landed_costs: one row per receipt (UNIQUE INDEX on receipt_number) with all 6 cost-component amount+currency pairs (freight, customs_duty, insurance, clearing, local_transport, other) plus other_description text. Stores fx_rate_usd_to_egp, fx_source (api/manual/cached), fx_rate_date, total_usd_value, total_egp_value, base_purchase_total + currency for restatement audits, allocation_method (CHECK by_qty/by_kg/by_value), full audit cols. CHECK constraints on every currency column. RLS enabled. Six new columns on inventory_stock_receipts: landed_cost_per_uom, landed_total, finalized_at, finalized_by, allocation_method, fx_rate_used. Partial index on finalized_at for reports.' },
      { superAdminOnly: true, text: 'New library src/lib/inventory-landed-cost-engine.js — pure functions: toEgp/toUsd currency conversion (USD/EUR both convert via USD→EGP rate for now), rollupCosts (sums all 6 components into {totalEgp, totalUsd}), rollupBasePurchase (sums quantity × cost_per_uom across lines), allocateLandedCost (3 methods with smart fallback to equal-split when basis sum is 0), computeFinalization (aggregates everything for preview), getRateForDate (wraps existing getFxRate from inventory-fx.js). No DB calls — all DB work happens in the dialog component.' },
      { superAdminOnly: true, text: 'New component InventoryFinalizeCostDialog.jsx (~430 lines). Props: shipmentGroup (grouped receipt with .lines), productById, userProfile, toast, onClose, onFinalized. State: 6 component {amount, currency} pairs + other_description, fxRate/fxSource/fxOverride/fxOverrideMode, allocationMethod. useEffect on mount calls getRateForDate using arrival_date if present else receipt_date. effectiveRate uses override when active. Live preview via computeFinalization() shows 3-card totals strip (base/landed/grand total) + per-line breakdown table with qty/UOM/base/+allocated/=landed-per-uom. commitFinalize upserts inventory_landed_costs (insert if no row exists, update if previous finalize attempt left one), then iterates allocations dbUpdate-ing each receipt row with landed_cost_per_uom + landed_total + allocation_method + fx_rate_used + finalized_at/by + status="finalized". If user manually entered an FX rate, saveManualRate persists it. Catch surfaces error via alert + console.error with hint about SQL migration. z-index 210 (above Receive Stock modal at z-200).' },
      { superAdminOnly: true, text: 'InventoryReceiving.jsx wiring: imports InventoryFinalizeCostDialog, adds finalizeTarget state, Finalize Cost button now setFinalizeTarget(g) instead of alert placeholder, conditional dialog mount at end of component passing productById + reload callback. totalCost reduce now prefers landed_total when not null, falls back to total_cost. So receipt list shows true landed cost once finalized.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-33-landed-cost.js — 65 assertions across 4 parts: SQL schema (15) covering table structure + 6 cost components + all CHECK constraints + RLS + 6 new columns on receipts; cost engine library (12) covering toEgp/toUsd/rollupCosts/rollupBasePurchase/allocateLandedCost three methods + equal-split fallback + computeFinalization + getRateForDate; dialog component (22) covering imports + 6 cost-component state + FX auto-fetch with date precedence (arrival > receipt) + manual override + effectiveRate computation + 3 allocation buttons + preview totals strip + per-line breakdown + commitFinalize upsert + per-line dbUpdate with status="finalized" + saveManualRate persistence + validation + error hint + modal z-210 + RULE 6 readability; wiring into InventoryReceiving (5); regression guards (5). Updated 2 prior test files (29 B10c, 32 F8 + stamp) to accept new behavior. Sweep: 217/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.32',
    date: '2026-05-19',
    label: 'Build 4.1 — Receive Stock now captures everything the old Shipments form did',
    items: [
      '**Receive Stock now captures full shipment details.** Added Shipment Reference (container # / PO #), Freight Forwarder, Shipping Line, ETA Date, Arrival Date, Purchase Currency at the shipment level. Per-product line now also captures Ordered Quantity vs Received Quantity (with mandatory variance reason if they differ), Quantity in Kg (for products tracked in two units), Roll Count (number of physical rolls), and per-line notes.',
      '**Variance tracking built in.** Enter what the supplier said they shipped (Ordered Qty) and what actually arrived (Received Qty). If they don\'t match, an amber warning appears with a required reason field — "damaged on arrival," "short shipment," "free samples added," etc. Audit trail captures the discrepancy forever.',
      '**New status flow: Received → Finalized.** New receipts save as "Received" (stock counts toward inventory, cost is provisional). The "Finalize Cost" button (next to Cancel) is a placeholder right now — Build 4.2 will wire it up to let you add freight, customs, duty, insurance, clearing costs, etc., and allocate them across the lines. Once finalized, status flips to "Finalized" and the cost layers are locked in.',
      '**Old never-used tabs hidden from navigation.** The old Inventory View, Master SKUs, Shipments, Cost Layers, Profit by SKU, Movements, Adjustments, and Reports tabs are hidden — you never used them, and the new Phase 1 system replaces them. The old screens stay in the system files for now (in case any data ever turns out to be in those tables), but they\'re not in your nav anymore. Warehouses tab stays (still needed for new receipts).',
      '**Run SQL migration before deploying.** Eleven new columns added to inventory_stock_receipts plus the status enum extended. SQL block in chat for copy-paste.',
      { superAdminOnly: true, text: 'SQL migration v55-83-a-6-27-32-inventory-shipment-fields.sql: 11 ALTER TABLE ADD COLUMN IF NOT EXISTS statements (shipment_reference, freight_forwarder, shipping_line, eta_date, arrival_date, purchase_currency, quantity_kg, roll_count, line_notes, ordered_quantity, variance_reason). DROP + recreate chk_status to add "received" and "finalized" values (kept "active" for backward compat with existing rows). New chk_purchase_currency constraint. Two new partial indexes on shipment_reference and arrival_date. Existing rows unaffected — all new columns are nullable.' },
      { superAdminOnly: true, text: 'InventoryReceiving.jsx — emptyLine() extended with ordered_quantity/variance_reason/quantity_kg/roll_count/line_notes; header state extended with shipment_reference/freight_forwarder/shipping_line/eta_date/arrival_date/purchase_currency; openNew + closeModal updated to initialize/reset all new fields; saveReceipt now validates shipment_reference required, variance_reason required when ordered != received, roll_count must be non-negative integer; payload includes all 11 new fields; status saves as "received" instead of "active". Modal UI: 3-row header grid (4 columns each) showing all new shipment fields; 2-row line grid showing ordered/received/UOM/batch then qty_kg/roll_count/rack/line_notes; conditional amber variance-reason box appears when ordered != received. List view: new Status column with conditional badge variants (Received=amber, Finalized=blue, Active=slate, Cancelled=slate+strikethrough); shipment_reference shown below receipt_number in mono font; Finalize Cost placeholder button shown for received-status receipts with alert explaining Build 4.2 will wire it up. Cancel filter loosened from status===active to status!==cancelled so new received/finalized rows can also be cancelled. filterStatus default switched from "active" to "all" so all rows show by default.' },
      { superAdminOnly: true, text: 'InventoryTab.jsx — old subtabs commented out: inventory, skus, shipments, layers, pnl, movements, adjustments, reports. Components still imported (ShipmentsManager, MovementsLedger, LayersLedger, InventoryPnL, AdjustmentsManager, InventoryView, InventoryReports) — code kept for reference until Builds 4.2-5 fully replace functionality, then a cleanup build will delete. Warehouses + Phase 1 builds (masterlists, productmaster, importproducts, receivestock, importstock) remain.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-32-shipment-fields.js — 64 assertions across 7 groups: SQL migration (15), emptyLine + header state (10), validation on save (3), payload includes all new fields with status received (7), modal UI shows all new fields (12), list view status flow (9), old tabs hidden (13), regression guards on Builds 4.0/4.5/A.6.27.28/A.6.27.31 (6). Sweep: 216/0. Updated 2 prior tests (A.6.27.29) to accept the new gridTemplateColumns + cancel filter pattern, bumped A.6.27.31 stamp regex.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.31',
    date: '2026-05-19',
    label: 'Fix: Add Warehouse button now opens a proper modal (was opening below the fold)',
    items: [
      '**Fixed: "Add Warehouse" button now visibly opens the form.** Previously the form appeared inline below the warehouse list — on tall pages, the user clicked Add Warehouse and the form opened below the visible area, looking like nothing had happened.',
      '**The Add/Edit Warehouse form is now a centered modal** that pops up over everything. Always visible regardless of page length. Click outside the modal or press Escape to close. Same modal pattern used everywhere else in the system now (Master Lists, Product Master, Receive Stock).',
      '**Bigger inputs, clearer labels** — the form fields are now full-size instead of the tiny cramped layout that was there before.',
      '**Validation errors now show as popups instead of just toasts.** If you click Save with a missing name or code, you get a clear popup telling you exactly what to fill in.',
      '**Database errors surface clearly too.** If saving fails for any reason, you get a popup with the exact error message plus a hint about likely causes (missing permission, table not migrated, etc.).',
      { superAdminOnly: true, text: 'Root cause same as A.6.27.24 Master Lists save-button bug: inline form pattern grew page downward, but on viewports where the button position and form-render-position were both below the fold or above respectively, users couldn\'t see the form appear. Fix: wrap form in fixed inset-0 z-200 overlay with bg-black/70 backdrop. Centered white card with three sections — sticky indigo header (RULE 6 defensive readability), scrollable body, sticky footer with Cancel + Save. Modal click-outside-to-close on overlay; inner panel onClick stopPropagation. Esc handler via useEffect dependent on [showAdd].' },
      { superAdminOnly: true, text: 'Diagnostic logging added throughout WarehouseSettings.jsx: + Add Warehouse button click logs, Save button click logs, handleSave entry/exit/error logs with full payload and editing context, console.warn on validation failures. alert() fallbacks added so failures are NEVER silent — validation alerts user with what was entered, catch-block alerts with error message + hint patterns (permission missing, table missing, RLS blocking).' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-31-warehouse-modal.js — 30 assertions: modal overlay structure, click-outside-to-close, dark indigo header with inline white text, close X, scrollable body, sticky footer, OLD inline form pattern verified REMOVED, click logging on Add and Save buttons, handleSave step-by-step logging including SUCCESS markers, alert() fallback for validation + catch errors, Esc key handler with cleanup, all form fields preserved with no regression on dbInsert/dbUpdate calls. Regression guards on Builds 4.0/4.5 + A.6.27.28 closed tickets. Sweep: 215/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.30',
    date: '2026-05-19',
    label: 'Inventory Phase 1 Build 4.5 — Bulk Import Legacy Stock',
    items: [
      '**New: Import Stock tab inside Inventory.** One-time bulk import of your existing inventory. Each row of an Excel file becomes one stock receipt with the type "Legacy Import" — letting you bring all your current rolls into the new classification system in one go.',
      '**The flow mirrors Import Products.** Download a template → fill it offline → upload back → preview screen shows what\'s valid and what has errors → click Commit. Each row becomes one receipt with its own auto-generated number like RCV-2026-05-19-001.',
      '**Smart Excel template with reference sheets.** The template includes a Products Reference sheet (your active products with their quick codes, names, default UOMs) and a Warehouses Reference sheet so you know exactly what to type in each row. Plus an Instructions sheet explaining everything.',
      '**Required columns:** product_quick_code, quantity, warehouse_name. Everything else (supplier, batch number, cost, rack, receipt date, tech-spec overrides) is optional — defaults to whatever\'s on the product master, or blank if not specified.',
      '**Strict validation with row-level errors.** Unknown product quick codes → row rejected with the offending code shown. Unknown warehouse names → rejected with the name. Quantity must be > 0. UOM and currency must match the standard list. Dates parsed flexibly (Excel serial numbers AND YYYY-MM-DD strings supported). All errors shown together so you can fix and re-upload.',
      '**Cost columns gated by permission.** If you have View Costs permission, the template includes cost_per_uom and currency columns. If not, those columns are omitted entirely — your import still works, the cost just stays blank.',
      '**Stops cleanly on database errors.** If something unexpected fails mid-commit, the import stops at that row and tells you exactly what got saved and what didn\'t. No silent half-failures.',
      '**Helper banner explains when to use this vs Receive Stock.** Receive Stock is for new shipments coming in from now on, one at a time. Import Stock is the one-time tool to bring legacy inventory across all your products and warehouses into the new system.',
      '**No new database table needed.** Imported rows go into the same inventory_stock_receipts table from Build 4.0, just tagged with receipt_type = "legacy_import". Filter by the "Legacy" badge in Receive Stock to see them.',
      { superAdminOnly: true, text: 'New component src/components/InventoryStockImport.jsx — ~580 lines. TEMPLATE_HEADERS computed via IIFE so cost columns conditionally included based on seeCosts. asDate() handles both Excel SSF serial numbers (XLSX.SSF.parse_date_code) and string formats with sentinel "INVALID" return. validateRows returns {valid, errors} — each error carries rowNum + raw row + concatenated error list. commitImport calls generate_receipt_number RPC per row (each legacy row gets its own receipt — unlike Build 4.0 where one shipment shares one number across lines). Stops on first DB error with break. Cost forced to null if !seeCosts regardless of file content (defense in depth).' },
      { superAdminOnly: true, text: 'Wired into InventoryTab as "📦 Import Stock" sub-tab under the Receiving stage, gated to super_admin OR Edit Inventory (same gate as Receive Stock). No new SQL — uses inventory_stock_receipts + generate_receipt_number RPC from Build 4.0.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-30-import-stock.js — 56 assertions: component permission gates, template-header conditional cost columns, 4-sheet workbook generation, friendly empty-state alerts (no products / no warehouses), Excel SSF date parsing, full validation matrix (required fields, unknown FKs, numeric validation, date validation, UOM/currency enum), cost-access force-null defense, commit flow with per-row receipt numbers + stop-on-error, preview UI summary + per-row error/success lists with cost gating, helper banner, InventoryTab wiring, regression guards on Builds 1/2/3/4.0 + A.6.27.28 closed-tickets. Sweep: 214/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.29',
    date: '2026-05-18',
    label: 'Inventory Phase 1 Build 4.0 — Receive Stock (everyday warehouse receiving)',
    items: [
      '**New: Receive Stock tab inside Inventory.** When a shipment comes in, click "+ New Receipt" → fill in date, warehouse, supplier → add as many product lines as the shipment contains → save. Each receipt gets an auto-generated number like RCV-2026-05-18-003 (third receipt that day).',
      '**Pick products fast with quick codes.** Type the quick code (like "NM-204") and a dropdown shows matches. Pick one and the form auto-fills with everything you defined in the Product Master: UOM, thickness, width, GSM, density, weight, supplier, default cost, currency, rack location.',
      '**Override any auto-filled value for this specific shipment.** Sometimes a roll comes in at 1.4m wide when the master says 1.65m. Just type the actual measurement in the Tech Specs row — that override saves to this receipt only, the master stays unchanged. Light blue background means "from product master defaults," white means "you changed it."',
      '**Want to update the product master too?** If you change the cost, supplier, or rack location on a receipt, a small 📌 button appears next to the field. Click it → confirm → master gets updated with the new value. Tech specs (width, thickness, GSM, etc.) don\'t get this button because per-roll measurements vary naturally and shouldn\'t change the master.',
      '**One shipment can have many products.** Click "Add another product line" as many times as needed. All lines save under the same receipt number so they\'re grouped as one shipment. Use Duplicate Line when receiving multiple rolls of the same product with different batch numbers.',
      '**Cancel a receipt without losing the record.** Click Cancel → enter a reason → confirmed. The receipt is greyed out with strikethrough in the list, doesn\'t count toward stock-on-hand, but stays in the database. If it was a mistake, click Restore to bring it back.',
      '**Cost fields are gated to users with P&L / Cost access.** Anyone with Inventory permission can view and record receipts. But Cost per UOM, Currency, and Total Cost columns only show for super_admin or users with View Costs permission — matches the existing Cost Layers / P&L gating pattern.',
      '**SQL migration required before deploying this build.** The new inventory_stock_receipts table needs to be created in Supabase first. SQL block pasted in chat as always.',
      { superAdminOnly: true, text: 'New table inventory_stock_receipts: receipt_number (not unique — multi-line shipments share), receipt_type (new_shipment/legacy_import/adjustment), receipt_date, status (active/cancelled), product_id FK→inventory_products RESTRICT, quantity CHECK >0, uom (kg/meter/yard/roll/piece/liter/sqm), six actual_* override cols (thickness/width/gsm/density/weight/length), supplier/batch_number/container_number, cost_per_uom + currency (EGP/USD/EUR) + total_cost computed at save, warehouse_id FK→inv_warehouses RESTRICT, rack, notes, cancellation cols (at/by/reason), audit cols. Indexes on receipt_number/date/product/warehouse/status/batch. updated_at trigger. RLS enabled.' },
      { superAdminOnly: true, text: 'New function generate_receipt_number(p_date date) returns RCV-YYYY-MM-DD-NNN with daily sequence (counts existing receipts that date + 1, zero-padded to 3 digits). Called once per shipment via supabase.rpc — shared across all lines of the receipt.' },
      { superAdminOnly: true, text: 'New component src/components/InventoryReceiving.jsx — ~700 lines. State per line tracks fromMaster flags (visual cue) and updateMaster flags (queued master patches). pickProductForLine() autofills defaults and tags inherited fields. updateLineField() clears fromMaster flag when value diverges from master. saveReceipt() generates ONE receipt_number, iterates lines doing dbInsert per row, then applies queued master updates via dbUpdate on inventory_products. Cancel acts on ALL rows sharing receipt_number (soft delete with audit trail). seeCosts (canSeeInventoryCosts helper) gates cost column in list + cost/currency inputs in modal.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-29-receive-stock.js — 78 assertions: PART A (SQL schema, 17 asserts) locks table structure + CHECK constraints + FK RESTRICTs + indexes + trigger + generate_receipt_number function + RLS. PART B (component, 50 asserts) locks permission gates, multi-line save with shared receipt_number, autocomplete by quick_code/name_en/name_ar/slug, fromMaster visual cue logic, 📌 update-master pattern (present on supplier/cost/rack, ABSENT on tech specs per Max), cost-field gating tied to seeCosts, cancel/restore with audit trail. PART C (InventoryTab wiring, 4 asserts) confirms import + SUBTABS entry + permission gate + render branch. R guards (8 asserts) protect Builds 1/2/3/26/27/28 + A.6.27.21 fixLinksBusy. Sweep: 213/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.28',
    date: '2026-05-18',
    label: 'Closed-ticket search FULLY working + Inventory Phase 1 Build 3 (Import Products)',
    items: [
      '**Closed tickets are now FULLY searchable by the AI.** No more limits. When you ask Nadia or any AI to find an item, ticket, customer, or topic, she now has access to every closed ticket you\'re allowed to see — not just the 25 most recent. This is mandatory and is now locked in permanently.',
      '**New: Import Products tab inside Inventory.** Bulk-import your product catalog from an Excel template. Find it at Inventory → 📥 Import Products.',
      '**How the import works:** Download the template → fill it offline in Excel → upload back → preview screen shows exactly what will happen → click Commit. The template is pre-loaded with all your current classification codes (Family, Category, Grade, Construction, Backing, Color, Pattern, Spec Class) as dropdown choices in each cell, plus a Codes Reference sheet, a Rules Reference sheet, and an Instructions sheet.',
      '**Every row is validated before anything is saved.** Required fields, valid classification codes, family-category compatibility, valid UOM, valid currency, numeric fields, and quick-code uniqueness all checked up front. Errors shown row-by-row with the exact problem.',
      '**Smart duplicate handling.** If your import row has a quick_code that already exists, the system: skips the row entirely if no new information is provided, OR fills in missing fields on the existing product if the import has data the master is missing. Existing values are NEVER overwritten. The preview tells you which rows will be skipped and which will be enriched.',
      '**Stops cleanly on database errors.** If something unexpected happens mid-import (network blip, permission issue, etc.), the import stops at that row and tells you exactly what succeeded so far. You can fix and re-upload — no silent half-failures.',
      '**Build 3.5 (starting stock quantities) coming after Build 4.** I tried to fit it into this build but it really belongs alongside the warehouse-receiving redesign in Build 4 — they share the same data model. Splitting them would mean building infrastructure twice. Doing it right after Build 4.',
      { superAdminOnly: true, text: 'PART A — Closed tickets: page.jsx (lines ~1602-1626) removed .limit(100) from the closed-tickets supabase query. Privacy filter still applied (super_admin sees all, others see tickets where created_by/assigned_to/in additional_assignees). AIGreeter.jsx (lines ~650-672) removed .slice(0, 25) and now emits ALL closed tickets into ctx with format "[customer] title — description-truncated" so AI can match on customer name, title keywords, or description keywords. Memory rule 2 strengthened.' },
      { superAdminOnly: true, text: 'PART B (Build 3) — New component src/components/InventoryImportProducts.jsx (~640 lines). Permission: super_admin OR Edit Product Master. Generates 4-sheet workbook (Products + Codes Reference + Rules Reference + Instructions) via xlsx 0.18.5 with !dataValidations property on code/UOM/currency columns. validateRows() returns {valid, enrich, skipped, errors}. Enrich pattern: only fills fields where existing product has null/empty AND import row has a value; never touches identity fields (quick_code, names, slug, 8 FK columns). commitImport() iterates valid → dbInsert, then enrich → dbUpdate, stops on first DB error, tracks failedRows for surfacing. Wired into InventoryTab as "📥 Import Products" subtab gated to super_admin OR Edit Product Master. No new SQL — uses inventory_products table from Build 2.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-28-closed-tickets-and-import.js — 47 assertions: PART A locks closed-tickets unlimited fetch + AIGreeter all-closed serialization, PART B locks all template generation + validation + enrich pattern + commit logic + InventoryTab wiring, plus 5 regression guards on Builds 1/2/26/27 and A.6.27.21 fixLinksBusy. Sweep: 212/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.27',
    date: '2026-05-18',
    label: 'Product Master list — Arabic description and classification now larger and bolder',
    items: [
      '**The Product Master list is now much easier to read.** Arabic product names and the classification codes are now larger and bolder. Previously they were tiny secondary text — now they\'re full size and stand out clearly next to the English name.',
      '**English product names also bumped up** for visual parity with the Arabic name. Same size, same weight, no language feels secondary.',
      '**Classification column widened** to give the longer code strings (like P.MS.PR.RG.NA.DB.NM.15) more breathing room.',
      { superAdminOnly: true, text: 'Changes to InventoryProductMaster.jsx table row only — modal form untouched: name_ar from text-[11px] font-semibold → text-base font-extrabold; classification_slug from text-[11px] font-mono font-semibold → text-sm font-mono font-extrabold with break-words; name_en from text-sm font-bold → text-base font-extrabold for parity; row + header column widths from 90px 1fr 150px to 90px 1.2fr 180px; row padding 10px → 12px; Arabic text color slate-700 → slate-800 (darker). The mt-0.5 spacer between English and Arabic name preserves vertical rhythm. break-words added to slug so longer codes wrap instead of overflowing.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-27-product-master-readability.js — 15 assertions covering the typography bump, column width changes, modal-form NOT touched, and Build 2/26 cascading-dropdown regression guards. Sweep: 211/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.26',
    date: '2026-05-18',
    label: 'Master Lists — restrict any level to specific Families (smart hierarchy expanded)',
    items: [
      '**Every level can now be restricted to specific Product Families.** Previously only Categories and Colors could be tied to specific Families. Now Grades, Constructions, Backings, Patterns, and Spec Classes can all be restricted the same way.',
      '**Example:** Edit "Luxurious" grade → tick only "Leather" → from now on, Luxurious only appears in Product Master dropdowns when Family = Leather. Same idea for "Honeycomb" pattern (only for PVC Pool), "Foam Perforated" construction (only for Leather and Textile), etc.',
      '**How to use it:** Inventory → Master Lists → click any level in the left sidebar (Grade, Construction, Backing, Pattern, Spec Class) → Edit any option → you\'ll now see "Valid under which Product Family?" checkboxes → tick the families it applies to → Save.',
      '**Leave all unchecked = applies universally to all families.** Most options will stay this way. Only restrict when an option truly doesn\'t make sense outside certain families.',
      '**The Product Master cascading dropdowns automatically respect your new rules.** Pick Family = Leather → only the options you tied to Leather (or left universal) appear in the Grade/Construction/Backing/Pattern/Spec Class dropdowns.',
      { superAdminOnly: true, text: 'Implementation: LEVELS array in InventoryMasterAdmin.jsx now marks every level 2-8 with hasParent: true + parentLevel: 1. Modal UI gating simplified from (hasParentLevel || activeLevel === 6) to just hasParentLevel. Parent-rule sync in save() likewise simplified. No schema changes — uses the existing inventory_list_rules table from Build 1. No Build 2 changes needed: the optionsForLevel function in InventoryProductMaster.jsx already reads parent rules generically (universal pattern: if option has rules, must match one parent; if no rules, universal), so newly-defined rules cascade through automatically. Build 2 was forward-compatible by design.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-26-parent-rules-all-levels.js — 24 assertions: all 8 LEVELS entries verified with correct hasParent/parentLevel values, modal gating simplified to hasParentLevel-only, save-side rule sync simplified, parent options query and rule storage logic intact, Build 2 universal cascade pattern still in place. Sweep: 210/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.25',
    date: '2026-05-18',
    label: 'Master Lists — Add button now tells you why it failed',
    items: [
      '**Fixed: when the "+ Add" button "did nothing," you now see exactly what went wrong.** Previously the button silently failed when there was a validation error or a database issue (most commonly: the SQL migration was never run, so the inventory_lists table didn\'t exist). The error toast may have been hard to see or dismissed too quickly. Now any failure produces a visible alert popup that tells you exactly what to do.',
      '**Most likely cause if you saw "nothing happening":** the SQL migration for Build 1 was not run in Supabase yet. The alert popup will now explicitly tell you that and suggest running the migration.',
      '**Every step of the save process now logs to the browser console.** If something is still going wrong, open the developer console (Cmd+Option+I on Mac), click the Add button, and you\'ll see a complete trace of what happened. Send me the console output and I can pinpoint the issue immediately.',
      '**Validation errors now show as alert popups too.** "Code must be 1-4 uppercase letters/digits — you entered X." "English Label is required." Same for Arabic and duplicate codes. Impossible to miss now.',
      { superAdminOnly: true, text: 'The save() function in InventoryMasterAdmin.jsx now: (1) console.logs the click event the moment the button is pressed (confirms onClick is even firing), (2) console.logs every step of validation with the inputs, (3) calls alert() on every validation failure as a visible fallback for users who can\'t see toasts (dark theme contrast, off-screen toasts, etc.), (4) console.logs dbInsert/dbUpdate progress with savedId, (5) catches errors and pattern-matches the error message for known causes: "inventory_lists does not exist" → "SQL migration not run" hint, "row-level security" → "RLS policies blocking" hint. All errors fall through to alert() so user gets a blocking dialog they can\'t miss.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-25-save-button-diagnostics.js — 30 assertions covering click logging, save() step-by-step logs, validation failure alerts, catch-block hint patterns, and regression guards on A.6.27.21/24 work. Sweep: 209/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.24',
    date: '2026-05-18',
    label: 'Master Lists — Add/Edit form is now a proper modal (Save button always visible)',
    items: [
      '**Fixed: Save button is now always visible when adding or editing an option in Master Lists.** Previously, adding a new option under Category showed an inline form above the table. With the 3 input fields plus the 4 Family checkboxes plus the surrounding chrome, the form grew tall enough to push the Save and Cancel buttons below the visible viewport — you had to scroll to find them, and most reasonable people concluded "there is no save button."',
      '**The add/edit form is now a centered modal** with a sticky footer. Save and Cancel buttons sit at the bottom of the modal and stay visible no matter how tall the form gets. Same pattern as the new Product Master modal from Build 2 — consistent across the inventory screens.',
      '**Big bright close X in the modal header.** White circle on the dark indigo header bar, impossible to miss.',
      '**Press Escape to close the modal.** Guaranteed escape hatch.',
      '**Click outside the modal to close.** Standard modal behavior.',
      '**The Save button now reads "+ Add Option" when adding a new option, "Save Changes" when editing existing.** Clearer about what\'s about to happen.',
      { superAdminOnly: true, text: 'Root cause: the previous inline-form pattern at lines 307-393 of InventoryMasterAdmin.jsx placed save/cancel at the BOTTOM of a vertically-growing form. For Category and other parent-restricted levels, the form expanded to 4-5 rows of content (label inputs + parent-checkbox chip grid). On smaller viewports the buttons fell below the fold. Fix: converted entire form to a fixed-position modal overlay (z-index 200) with three sections — sticky header (dark indigo bar with close X), scrollable body (maxHeight calc(100vh - 220px)), sticky footer (Cancel + Save buttons always visible). Modal wrapper has onClick={cancelEdit} for click-outside-to-close. Inner panel uses onClick stopPropagation so clicks inside the modal don\'t bubble up. Esc handler added via useEffect with [editing] dependency — only fires while modal is open. Defensive readability per RULE 6: header bg uses inline style background #3730a3 and inline color #ffffff so Tailwind class-load failures cannot break the contrast.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-24-master-lists-save-button.js — 18 assertions across modal conversion, sticky footer with save/cancel, Esc key handler with cleanup, form fields preserved (no regression on Code/EN/AR inputs or parent-rule checkboxes), and a guard ensuring the old inline form bg-indigo-50 wrapper is GONE. Sweep: 208/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.23',
    date: '2026-05-18',
    label: 'Inventory Phase 1 Build 2 — Product Master catalog with smart cascading dropdowns',
    items: [
      '**New: Product Master tab inside Inventory.** This is where you define every product you stock. Each product gets its 8-level classification, an optional quick code (like NM-204 or PSL-BK), an optional design SKU, and default specs (UOM, thickness, width, supplier, cost, rack location). Define a product once here, and the rest of the system uses these defaults to speed up day-to-day work.',
      '**The cascading dropdowns are now alive.** Pick "Leather" for Product Family and the Category dropdown only shows Smooth and Embossed. Pick "PVC Pool" and you see Smooth Liner, Roofing, Mosaic, and Anti-Slip. The pool colors (Baby Blue, Sky Blue, Medium Blue, Dark Blue, Navy Blue) only appear when PVC Pool is the selected Family. Every level respects the rules you set in Master Lists — and if no rules exist for a level, all options show. Maximum flexibility.',
      '**Live classification code preview.** As you pick each of the 8 levels in the New Product form, the system shows you the auto-generated code in real time (e.g., "P.MS.PR.RG.NA.DB.NM.15"). When you save, that code is stored on the product and used for reporting filters later.',
      '**Quick codes for fast entry.** Optionally assign each product a short code — anything memorable (NM-204, PSL-BK, the supplier\'s code, your own internal code). When warehouse receiving happens in a later build, typing this code will auto-fill all 8 classification levels and the tech spec defaults. No more re-typing the same info every time a roll comes in.',
      '**Bilingual everywhere.** Both English and Arabic product names are required. Dropdowns show both languages side by side. The form for Arabic names is right-to-left.',
      '**Copy a product as a starting point.** When defining a new product that\'s similar to one you already have, click the Copy button on the existing product. The new form opens with the classification and all defaults pre-filled — just change the name, give it a new quick code, and save.',
      '**Two separate permissions for the inventory classification system.** "Manage Inventory Master" controls who can edit the 8 classification level lists. "Edit Product Master" controls who can create and edit products. Both are separate from the regular Inventory permission. This way you can have someone receive inventory without giving them the ability to change product definitions.',
      '**Soft delete only.** Deactivated products stay in the database. Any existing inventory or sales referencing them remains valid. One click to reactivate.',
      '**Run the SQL migration BEFORE deploying.** Creates the inventory_products table. Purely additive — does not touch any existing data, does not touch the old Master SKUs tab.',
      '**The old Master SKUs tab is left alone for now.** It still works exactly as before. We\'ll address it in a future cleanup build once Builds 3, 4, and 5 are in production and your team has migrated to the new system.',
      '**Coming next: Build 3 (bulk import tool for legacy data), Build 4 (warehouse receiving uses quick codes + roll-specific overrides), Build 4.5 (sales invoices pick line items from the Product Master with stock visibility), and Build 5 (reports across the 8 levels + tech specs + warehouse + supplier).**',
      { superAdminOnly: true, text: 'Table: inventory_products (id uuid PK, name_en NOT NULL, name_ar NOT NULL, quick_code text nullable, design_sku text nullable, 8 classification FK columns each REFERENCES inventory_lists(id) ON DELETE RESTRICT, classification_slug text computed on save by joining the 8 codes with dots, default_uom CHECK kg/meter/yard/roll/piece/liter/sqm, default_thickness_mm/width_m/gsm/density/weight_per_roll/roll_length_m numeric, default_supplier/cost/currency/rack text+numeric, default_currency CHECK EGP/USD/EUR, notes, active, audit columns). Unique index on quick_code WHERE active=true AND quick_code IS NOT NULL AND quick_code != \'\' so deactivated codes can be reused. Indexes on family, category, active, slug, design_sku, lower(name_en). updated_at trigger. RLS enabled.' },
      { superAdminOnly: true, text: 'Component: src/components/InventoryProductMaster.jsx — full CRUD with cascading dropdown logic. optionsForLevel(level, currentForm) filters inventory_lists by level + checks inventory_list_rules: if a child has rules, only shows when ANY of its parents is currently selected upstream; if no rules, universal. handleLevelChange resets invalid downstream selections via resetInvalidChildren when a parent changes. Live slug preview via computeSlug. Permission: canView = isSuperAdmin OR Inventory OR Edit Product Master; canEdit = isSuperAdmin OR Edit Product Master. Quick code uniqueness enforced client-side (excludes self when editing) AND at DB level. Both names required. Soft delete via active flip with confirm. Modal header uses inline color styles (#3730a3 indigo bg + white text) per RULE 6 defensive readability — close X is 36x36 round white button with shadow.' },
      { superAdminOnly: true, text: 'Wiring: InventoryTab gets new "🏷️ Product Master" subtab gated to super_admin OR Inventory OR Edit Product Master permission. Hidden (returns null) for users without any of those. Two new permission keys added to SettingsTab — "Edit Product Master" (separate from "Edit Inventory" per Max\'s call: editing the catalog is more sensitive than receiving day-to-day inventory). Old "Master SKUs" subtab, MasterSKUList component, and inv_skus table all UNTOUCHED.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-23-product-master.js — 50 assertions covering SQL schema (CHECK constraints, FK ON DELETE RESTRICT, unique index condition, all indexes), component behavior (permission gating canView vs canEdit, cascading dropdown universal pattern, 8-level required, slug computation, quick code uniqueness, bilingual required, soft delete, duplicate-as-starting-point), wiring (subtab gating, render branch), Build 1 regression guards (masterlists tab still present, old Master SKUs still there), older work regression guards (A.6.27.19/20/21 still intact). Sweep: 207/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.22',
    date: '2026-05-18',
    label: 'Inventory Phase 1 Build 1 — Master Lists admin (foundation)',
    items: [
      '**New: Inventory Master Lists admin screen.** This is the foundation of the new inventory classification system. Find it under Inventory → Master Lists tab. Super-admin (or anyone granted the new "Manage Inventory Master" permission) manages the 8 classification levels here: Product Family, Category, Grade, Construction, Backing, Color, Pattern, and Spec Class.',
      '**Pre-loaded with your spec.** All 62 options from the spec document are already in the database — Leather, Textile, PVC Pool, Boat Decking; Smooth, Embossed, Mosaic, Anti-Slip, all the grades, constructions, backings, 16 colors (11 standard + 5 pool), 7 patterns, 4 spec classes. You can edit, add to, or deactivate any of them.',
      '**Smart hierarchy is built in.** Category options are tied to their valid Product Families — pick Leather, you only see Smooth and Embossed. Pick PVC Pool, you only see Smooth Liner, Roofing, Mosaic, Anti-Slip. Pool colors (Baby Blue, Sky Blue, Medium Blue, Dark Blue, Navy Blue) only show when PVC Pool is selected. The other 6 levels are universal by default — you can restrict any of them per Family if needed.',
      '**Bilingual everywhere.** Every option has both English and Arabic labels, both required when adding new ones. The screen shows both side by side for easy verification.',
      '**Soft delete protects history.** When you deactivate an option, it disappears from new dropdowns but stays in the database so any existing inventory referencing it remains valid. One click to reactivate if you change your mind.',
      '**Add new options without a build.** Need a new color? New category? Super-admin clicks "+ Add Option," types the code (1-4 uppercase letters/digits), English and Arabic labels, ticks which Product Families it applies to, saves. New option is immediately available across the system — no developer involvement.',
      '**Run the SQL migration BEFORE deploying.** Creates two tables (inventory_lists, inventory_list_rules) and pre-loads the 62 options. Migration is purely additive — does not touch any existing data.',
      '**This is Build 1 of 5.** The Master Lists alone don\'t affect day-to-day operations yet. Coming next: Build 2 (Product Master screen — define each product with quick-code + classification + defaults), Build 3 (bulk import tool for legacy data), Build 4 (warehouse receiving updated to use quick codes), Build 5 (reporting with filter combinations). Each build ships independently and we test before moving to the next.',
      { superAdminOnly: true, text: 'Tables: inventory_lists (id uuid PK, level int 1-8, code text, label_en, label_ar, active, display_order, audit columns; CHECK code ~ \'^[A-Z0-9]{1,4}$\'; UNIQUE INDEX on (level, code) WHERE active=true so deactivated codes can be reused). inventory_list_rules (child_list_id, parent_list_id; rows present → child restricted to those parents; no rows → child applies to all parents at the parent level). Seed data: 62 options across 8 levels + 16 parent rules (11 category-family + 5 pool-color-PVC). New permission key "Manage Inventory Master" added to SettingsTab (both the master array at line 361 and the action permissions render list at line 1368).' },
      { superAdminOnly: true, text: 'UI: src/components/InventoryMasterAdmin.jsx (560 lines). Sidebar lists all 8 levels with active counts and inactive-count badges. Main pane shows search + show-inactive toggle + Add button + inline add/edit form + options table. Form includes parent-rules checkbox grid when relevant. Uses dbInsert/dbUpdate so audit_log captures everything. Code field uppercases on input. Both labels required client-side AND DB level. Duplicate code check excludes self when editing. Soft delete via active toggle with confirm prompt. Component is gated — non-permitted users see "Access restricted" panel.' },
      { superAdminOnly: true, text: 'WIRING: InventoryTab gets new "🗂️ Master Lists" subtab gated to super_admin OR Manage Inventory Master permission. Tab is HIDDEN (returns null) for users without permission, not just disabled. page.jsx now passes isSuperAdmin prop to InventoryTab → InventoryMasterAdmin. Existing inv_skus and existing inventory subtabs untouched — Build 1 is purely additive.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-22-inventory-master-lists.js — 39 assertions covering SQL schema constraints, all 62 seed-data entries, parent rules, component permission gating, code format validation, bilingual requirement, soft delete, duplicate-code check, parent-rule sync (delete-then-insert pattern), regression guards on A.6.27.19/20/21 work. Sweep: 206/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.21',
    date: '2026-05-17',
    label: 'AI Treasury Review — readability + Fix Links + escape hatch',
    items: [
      '**AI Accountant Review modal is now readable.** The header was light purple with text that looked white in some environments — completely unreadable. Now the header is a solid dark indigo bar with white text that\'s impossible to misread regardless of theme or browser quirks.',
      '**Big bright close button at the top right.** The old ✕ was a tiny low-contrast button you could easily miss. Now it\'s a big 40×40 white circle with a dark X and a drop shadow — you can\'t miss it.',
      '**Press Escape to close the modal.** A guaranteed way out, no matter where the close button ends up or whether you can see it. Works from anywhere inside the modal.',
      '**AI summary, verdict, and top actions now render correctly.** The previous version sometimes showed raw computer output instead of the formatted summary — caused by the AI occasionally wrapping its response in extra characters. The system now intelligently extracts the real content and presents it as readable text on a white card with dark text.',
      '**Red error messages are now bigger and bolder.** Errors and critical findings were too small to take seriously. Now: text-base font-extrabold with red background panel.',
      '**Finding titles, impact lines, and recommended actions are all bigger.** All set to text-base with strong font weights. The 💰 emoji marks the financial impact line so it jumps out.',
      '**Metric cards (Treasury Net, Outstanding, Pending Checks, Unmatched Bank) now have a light background with dark text.** Previously light text on dark which could fail to render.',
      '**Fix Links button works again — and shows you it\'s working.** Press it and you see "🔍 Scanning..." immediately, then either "✓ No missing links found" (clear success), or "Cancelled" if you back out of the confirm, or "✓ Linked X rows" when it does work. The button shows "⏳ Working..." while running. Errors are caught and shown explicitly. No more silent button.',
      { superAdminOnly: true, text: 'NINE FIXES: (1) Header now bg #3730a3 with inline-style white text — defends against Tailwind class failures. (2) Close button 40x40 with shadow + onClose wired + Esc key handler in useEffect with cleanup. (3) /api/accountant now uses balanced-brace extractor when JSON.parse fails; system prompt strengthened with explicit "first char must be {" rule; UI also unwraps if summary field itself starts with {. (4) VERDICT/SUMMARY/TOP ACTIONS cards switched from bg-slate-900 + text-white to bg-white + text-slate-900. (5) AI error: text-base font-extrabold + bg-red-50 border-2 border-red-300 panel. (6) Finding title text-sm→text-base, font-bold→font-extrabold; impact text-xs→text-sm font-extrabold with 💰. (7) Metric strip bg-slate-800→bg-slate-50, text-slate-300→text-slate-700, text-*-300→text-*-700. (8) Recommended Action + Affected Records: bg-slate-900/bg-slate-800 → bg-white. (9) Fix Links: fixLinksBusy state, console.log on press, toast.info on scan start, toast.success on no-links, toast.info on cancel, explicit catch + finally release.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-21-readability-and-fix-links.js — 50 assertions across all 9 fixes + 6 regression guards on A.6.27.17/18/19/20. Sweep: 205/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.20',
    date: '2026-05-17',
    label: 'Payment Instruments — now in the New Invoice creation flow',
    items: [
      '**You can now add checks and promissory notes while CREATING a new invoice.** Open "+ New Invoice" — the form now has a "🧾 Payment Instruments / Scheduled Receivables" section right under the line items. Click "+ Add Check / Promissory Note" to enter one inline. Add as many as you need before saving. When you hit "Create Invoice," everything saves together — the invoice first, then each instrument attached to it.',
      '**Same documentation-only rules apply.** Adding instruments here does NOT change the invoice\'s collected amount, does NOT touch treasury, does NOT affect any balance. It\'s just a way to record the checks the customer is giving you at the moment of sale.',
      '**If an instrument fails to save for any reason, the invoice is still created.** A warning toast tells you which ones failed so you can open the new invoice and add them manually. No partial state, no data loss.',
      '**Each instrument shows inline before save.** Type, number, amount, due date, bank — visible as you add them. Click the ✕ to remove any one before hitting Create Invoice.',
      '**Cancel discards everything.** If you close or cancel the New Invoice form, all the queued instruments are discarded along with the rest of the form data. No leaks between invoices.',
      { superAdminOnly: true, text: 'Implementation: instruments queued in formData.draftInstruments[] array. Add-form state in formData.showDraftInstrumentForm + formData.draftInstrumentDraft. Save handler at line ~8830 loops through formData.draftInstruments AFTER newInv is inserted, calling dbInsert(\'checks\', {...}) for each with invoice_id: newInv.id. Per-item try/catch — failures increment instrumentsFailed counter without aborting the loop. Toast varies based on success/fail counts. parseAmount used for instrument amount (Arabic-Indic + comma tolerance, same as A.6.27.19 fix).' },
      { superAdminOnly: true, text: 'Per Max Option (a): atomic from user POV (invoice + instruments save together) but NO transactional rollback. If invoice saves and instruments fail, invoice still exists. User can open invoice → existing-invoice instrument section → add manually. Acceptable failure mode. Alternative (b) atomic-with-rollback was rejected for complexity vs the unlikely failure case. Customer resolution: `resolvedCustomerName || formData.customerName` since customer might be a new customer just created in the same form.' },
      { superAdminOnly: true, text: 'FIVE RULES PRESERVED + NEW RULE 6 (locked in test 9a/9b/9c): instrument save loop inside the new-invoice flow MUST NOT call dbInsert(\'treasury\', ...), MUST NOT call dbUpdate(\'invoices\', ...) on total_collected, MUST NOT call recalcInvoiceCollected. Tests verify by string-anchor: the regex pattern `for (const di of formData.draftInstruments) [\\s\\S]{0,2000}` does NOT contain any of those forbidden calls.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-20-new-invoice-instruments.js — 32 assertions covering: UI placement inside showAddInvoice modal, draftInstruments state shape, type selector with all 3 options, parseAmount validation, list rendering with type icons, no dbInsert in inline add (state only), save-after-invoice loop, audit columns set, status:pending, failure handling without aborting, form reset on close, no treasury mutation from instrument flow, no total_collected mutation, no recalc from instrument flow, regression guards on A.6.27.18 and A.6.27.19. Sweep: 204/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.19',
    date: '2026-05-17',
    label: 'Payment Instruments — code review fixes (10 gaps closed)',
    items: [
      '**The smart popup now fires from EVERY payment entry path.** Before this build, the popup only fired when adding a transaction through the Treasury tab. Adding a payment from inside the invoice screen (the common workflow) silently skipped the popup, so instruments stayed pending even when the customer\'s cash arrived. Now both the Treasury "Add Transaction" flow AND the invoice screen\'s "Add Payment" flow trigger the popup when an amount matches.',
      '**Multiple matching instruments are all shown.** If two checks of the same amount are pending on an invoice, the popup now offers both as separate buttons — pick the right one. Previously only the first match was shown and the second was invisible.',
      '**Arabic and Indo-Arabic numerals now work in the instrument amount field.** Type ٥٠٠٠٠ or 50,000 — both parse correctly. Previously these silently became NaN and the form refused to save.',
      '**Permission gate is consistent across the system.** Users with "Edit Treasury" permission can now add instruments too. Before, the section was gated only to "Treasury" permission — users who had Edit Treasury but not Treasury couldn\'t add instruments.',
      '**Deleting a treasury row that backed a cleared instrument now reverts that instrument back to pending.** Without this, the instrument would stay marked "cleared" with a dangling link to a deleted treasury row. Now it goes back to pending so your team can re-link it properly.',
      '**Closing the invoice modal now resets the instrument form.** Form values no longer leak from one invoice to another.',
      '**SQL migration fix:** the new audit timestamp columns are now nullable. Previously they would have backfilled every legacy check\'s created_at to the migration timestamp — making them all look like they were entered the moment the migration ran. New rows still get a default timestamp; legacy rows keep their truth (null = unknown).',
      { superAdminOnly: true, text: 'CODE REVIEW PASS: 10 findings, 8 fixed in code, 2 documented limitations. (#1) PaymentForm cash+bank channels now use findMatchingInstruments + setPendingInstrumentMatch with onResume callback that handles the dbInsert+recalc+instrument-flip in-place. (#2) Two paths to add a check (Payment Instruments section AND "Add Payment → Check") — documented; same DB target so no functional bug but UX could confuse. (#3) parseAmount replaces Number() in instrument save. (#4) canEditInstruments = canEditTreasury delegation. (#5) Treasury edit doesn\'t re-check instrument match — documented limitation. (#6) handleDeleteTreasury reverts linked instrument to pending, clears collection_date and linked_treasury_id, but ONLY if instrument.linked_treasury_id === txnId (so we don\'t stomp re-linked instruments). (#8) findMatchingInstruments returns array via .filter; popup shows one button per candidate; heading switches singular/plural; key={inst.id} on map. (#9) Modal onClose resets showAddInstrumentForm and instrumentForm to defaults. (#10) created_at/updated_at columns no longer NOT NULL.' },
      { superAdminOnly: true, text: 'ARCHITECTURE: findMatchingInstruments(invoice, amt) is the SINGLE source of truth for popup-match logic. Used from handleAddTreasury (line ~3433) AND PaymentForm cash (line ~2891) AND PaymentForm bank (line ~2975). Popup state shape: { record, amount, invoice, instruments[], isBankPlaceholder, onResume(stamped) }. onResume is caller-supplied — handleAddTreasury supplies commitInstrumentLinkedTreasury; PaymentForm cash supplies an inline closure that does dbInsert + instrument flip + recalc + loadAllData + setShowAddPayment(false). Popup buttons stamp record.source_check_id + record.__instrument_popup_decision then call resume.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-19-code-review-fixes.js — 35 assertions covering each of the 8 fixes plus 5 regression guards on the FIVE rules + 2 regression guards on older builds (A.6.27.14 EgyptBank, A.6.27.16 closed tickets). Sweep: 203/0.' },
      { superAdminOnly: true, text: 'KNOWN LIMITATIONS (documented, not fixed): (a) Editing an existing treasury row doesn\'t re-trigger instrument-match check (would need substantial refactor of handleSaveTreasuryEdit). Workaround: delete + re-add the treasury row. (b) Two entry paths for checks (PaymentForm "Check" method + invoice instrument section) — both write the same DB row so no data corruption, but a user could accidentally add the same check twice through different paths.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.18',
    date: '2026-05-17',
    label: 'Payment Instruments — the entry UI inside the invoice (Phase 2)',
    items: [
      '**You can now actually ADD checks and promissory notes from inside the invoice.** Open any invoice, scroll to the bottom, and you\'ll see a new "Payment Instruments / Scheduled Receivables" section. Click the header to expand or collapse it. Hit the "+ Add Check / Promissory Note" button to enter a new one inline — pick the type (check or promissory note), put in the number, amount, due date, bank, and any notes, then save. It saves as pending and shows up immediately.',
      '**Each instrument shows up with color coding.** Pending instruments due soon are amber. Overdue ones are red. Deposited ones are blue. Cleared ones get a strikethrough plus the date they cleared. Bounced ones are red with the bounce reason. Cancelled and replaced ones are greyed out with a strikethrough.',
      '**Action buttons on each instrument** for documentation transitions: Mark Deposited (when you take it to the bank), Mark Bounced (asks for a reason — required for audit), and Cancel. All three confirm before doing anything. None of them touch any treasury balance, invoice collected amount, or bank/safe — they just change the instrument\'s status.',
      '**No "Mark Cleared" button — clearing happens automatically.** Per your direction: clearing only happens when you enter a real treasury transaction (cash-in or bank-in) and the smart popup matches it to this instrument. The check goes from pending → cleared at that moment, properly linked to the actual money. No manual cleared button anywhere — that\'s the rule that keeps the books honest.',
      '**Status summary at the top of the section.** Shows you "3 pending · 1 deposited · 2 cleared" plus the total pending amount in big numbers, so you can see at a glance what\'s outstanding for this order without scrolling through the list.',
      '**Sorted intelligently.** Overdue pending instruments come first, then pending sorted by due date, then deposited, then cleared, then bounced/cancelled/replaced. The things you need to act on are always at the top.',
      '**Everything shows up everywhere it should.** Add an instrument here and it appears in the Checks tab, the pending checks widget on the dashboard, and the cash-flow forecast (when Phase 3 ships the forecast widget). All these views were already reading from the `checks` table — they pick up promissory notes and the new fields automatically.',
      { superAdminOnly: true, text: 'PHASE 2 SCOPE: invoice-screen entry UI with collapsible "Payment Instruments / Scheduled Receivables" section, inline add form, status badges with color coding, sort by status+due-date, action buttons (Mark Deposited, Mark Bounced with required reason prompt, Cancel — no Mark Cleared per Max\'s direction). State: instrumentSectionExpanded (default true), showAddInstrumentForm (default false), instrumentForm (form fields), instrumentBusy (save spinner). Section appears just before </Modal> on the invoice detail screen.' },
      { superAdminOnly: true, text: 'RULES STILL ENFORCED: entry path uses `dbInsert(\'checks\', ...)` only — never inserts to treasury. Status-transition actions use `dbUpdate(\'checks\', ...)` only — never modify invoices.total_collected, treasury cash/bank, or any other money field. Mark Bounced sets status=\'bounced\' + bounce_reason (required via prompt). Mark Deposited sets status=\'deposited\'. Cancel sets status=\'cancelled\'. Legacy status compatibility: \'collected\'→\'cleared\', \'uncollected\'→\'pending\' at read time. Permission gate: isSuperAdmin || modulePerms[\'Treasury\'] === true.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-18-payment-instruments-ui.js — 35 assertions covering state setup, collapsible structure, permission gate, summary view, list rendering with status badges + color coding, action buttons (with NO Mark Cleared button asserted), the FIVE rules (no treasury insert, no total_collected mutation, status-only changes for transitions), form fields with validation, documentation-only disclaimer, empty state, regression guards on A.6.27.16/17 state. Sweep: 202/0.' },
      { superAdminOnly: true, text: 'PHASE 3 (deferred): dashboard cash-flow forecast widget (due in 7d/30d/60d/90d/6mo bucket counts with totals); replaced-by chain visualization (click an instrument to see its predecessor/successor chain); photo upload (needs Supabase Storage bucket policy); per-role granular permissions beyond the current Treasury-or-super-admin gate.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.17',
    date: '2026-05-17',
    label: 'Phase 1 — Payment Instruments / Scheduled Receivables (smart link popup)',
    items: [
      '**Smart popup when a treasury payment matches a check or promissory note on the same order.** When you add a cash-in or bank-in transaction and the amount matches a pending check (or promissory note) tied to that order, a small popup appears: "This 50,000 EGP looks like Check #1234 due May 30 — does this payment clear it?" Pick Yes → instrument flips to cleared and gets linked to your treasury entry. Pick No → your entry saves as normal, instrument stays pending. Cancel → goes back to the form so you can fix the amount or order number.',
      '**Promissory notes are now first-class.** The system treats checks and promissory notes the same way — they\'re both "instruments" you can track against an order. New instruments get a type selector when you create them.',
      '**Nothing changes in your money math.** Entering an instrument does NOT change any invoice\'s "Collected" amount. Does NOT change your safe balance. Does NOT change your bank balance. Does NOT touch treasury. It\'s pure documentation until either (a) the smart popup links it to a real payment, or (b) you manually mark it cleared from the Checks tab. Even then, the only thing that happens is a status flip plus a metadata link — the money math comes from treasury, exactly as before.',
      '**Run the SQL migration BEFORE deploying this build.** New columns: instrument_type, issue_date, attachment_url, created_by, updated_by, created_at, updated_at, replaced_by_id, bounce_reason. Plus two indexes for fast forecast queries and popup lookup, plus a trigger to keep updated_at fresh.',
      { superAdminOnly: true, text: 'THE FIVE NON-NEGOTIABLE RULES, locked in tests: (1) Entering an instrument NEVER writes to treasury. (2) Entering an instrument NEVER changes invoice.total_collected. (3) Entering an instrument NEVER changes safe or bank balance. (4) The recalc doesn\'t read instruments — it reads treasury only. (5) The popup is a LINK, not a CREATE — stamps source_check_id on the treasury row the accountant was already entering. Exactly ONE treasury row is inserted whether the user picks Yes/No on the popup.' },
      { superAdminOnly: true, text: 'POPUP HOOK: handleAddTreasury at page.jsx ~line 3324, inside the matchingInvoice branch, BEFORE dbInsert. Looks up checks where (invoice_id matches OR order_number matches) AND status is pending|deposited AND linked_treasury_id is null AND |amount - amt| < 1. If a candidate is found AND record.__instrument_popup_decision is unset (avoids re-prompt loop) AND it\'s not a bank placeholder (those go through bank-statement reconciliation), set pendingInstrumentMatch state with the record + invoice + instrument + isBankPlaceholder flag. Form stays open behind the popup. User picks → stamps source_check_id on record + sets __instrument_popup_decision flag → calls commitInstrumentLinkedTreasury(stamped, invoice, isBankPlaceholder) which dbInserts, flips instrument to cleared with linked_treasury_id stamp (if link path), and runs recalcInvoiceCollected.' },
      { superAdminOnly: true, text: 'SQL MIGRATION: sql/v55-83-a-6-27-17-payment-instruments.sql — purely additive, all ALTER TABLE ... ADD COLUMN IF NOT EXISTS. No DROP, no DELETE, no UPDATE of existing data. CHECK constraint on instrument_type enum. New indexes: idx_checks_due_date_status (forecast widget) and idx_checks_invoice_status (popup lookup). Trigger trigger_checks_updated_at fires BEFORE UPDATE to refresh updated_at.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-17-payment-instruments-phase1.js — 30 assertions locking: SQL migration is additive (no destructive statements); state setup; the five rules; popup match criteria; re-entry suppression; instrument flip on link path; popup UI; regression guards on existing logic (recalcInvoiceCollected, handleCollectCheck channel logic, closedTicketsForAI from A.6.27.16). Sweep: 201/0.' },
      { superAdminOnly: true, text: 'PHASE 2 (deferred): dashboard cash-flow forecast widget (due in 7d/30d/60d/90d/6mo bucket counts); replacement chain visualization; promissory note entry UI on the invoice screen (Phase 1 just adds the columns and the popup — the explicit "Payment Instruments" section under the invoice is Phase 2). PHASE 3: photo upload (needs Supabase Storage bucket policy); per-role granular permissions.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.16',
    date: '2026-05-17',
    label: 'Nadia closed-ticket access — actually working this time',
    items: [
      '**Nadia can now reference closed tickets when you ask her about history.** Things like "what was that ticket about leather samples last month" or "did we ever resolve the issue with مصنع الامل" will now actually work. She sees up to your 25 most-recently-closed tickets with descriptions, plus a count of total closed tickets she has access to.',
      '**She still won\'t count closed tickets in active workload.** When she tells you "you have 12 overdue tickets" or "3 due today" she\'s still talking about OPEN tickets only — closed ones don\'t inflate the active numbers. They\'re available for history queries, not active counts.',
      '**Privacy rules still apply.** A regular user only sees closed tickets they created or were assigned to. Super-admin sees all closed tickets. Private and confidential ticket rules carry through unchanged.',
      { superAdminOnly: true, text: 'THIS WAS THE 4TH ATTEMPT AT FIXING THIS. The previous three (in A.6.27.10, A.6.27.11, A.6.27.12) all failed because they tried to filter closed tickets out of an array that never contained closed tickets in the first place. dashTickets is fetched at page.jsx ~line 1446 with `.neq("status", "Closed")` — closed tickets are excluded SERVER-SIDE for dashboard speed, so any client-side filter that branched on t.status === "Closed" was a no-op against an array that never had them. Three superficial fixes shipped without ever testing that closed tickets actually reached the AIGreeter component.' },
      { superAdminOnly: true, text: 'REAL FIX: separate state `closedTicketsForAI` in page.jsx, populated by its own Supabase query that filters `.eq("status", "Closed")`, ordered by updated_at DESC, limit 100, with the same privacy gates as dashTickets (super_admin sees all; others see tickets where they created OR are assigned OR are in additional_assignees). Passed to AIGreeter as a separate `closedTickets` prop. Inside AIGreeter: openMyTickets filters from `tickets` (still open-only), closedMyTickets filters from `closedTickets`, allMyTickets is a union deduped by id. Context block now shows up to 25 closed with description truncated to 80 chars plus total count.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-16-nadia-closed-tickets.js (17 asserts) — locks the FULL data flow chain end-to-end: page.jsx has closedTicketsForAI state ✓ page.jsx has a separate .eq("status","Closed") query with .limit(100) ✓ closed-tickets fetch applies privacy filters ✓ AIGreeter mount receives closedTickets={closedTicketsForAI} ✓ AIGreeter destructures closedTickets from props ✓ openMyTickets reads from tickets, closedMyTickets reads from closedTickets ✓ allMyTickets is a deduped union ✓ recentlyClosed iterates closedMyTickets (NOT a re-filter of allMyTickets) ✓ regression guard: the OLD broken pattern is explicitly absent. Sweep: 200/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.15',
    date: '2026-05-16',
    label: 'Shipping bubbles broken down by port — every port pair is its own card',
    items: [
      '**Shipping rate bubbles now show port AND country, broken down per port pair.** Previously the bubble grouped by country only, so all the USA → Algeria rates collapsed into one card that could only show one port label (or none). Now each unique (origin country, POL, destination country, POD) combination gets its OWN bubble. Houston → Skikda, NYC → Algiers, and Savannah → Oran are three separate cards even though they\'re all USA → Algeria. If a rate has no port recorded, it gets its own country-only bubble — won\'t merge with port-specific ones.',
      '**Bubble label shows the port front and center.** Big bold text on top is the port (Houston). Smaller grey subtext is the country (USA). Same on the destination side. If no port exists for a rate, the country shows alone.',
      '**Transit time, free days, and earliest departure now show on every bubble.** They used to only appear when you turned on a port filter. Now that every bubble is already port-specific, those details are always relevant and always visible.',
      '**Click a bubble to drill into just THAT port-pair\'s rates.** No more "I clicked USA to Algeria and got 47 quotes across 8 ports mixed together." The drill-down view filters to your exact port pair.',
      { superAdminOnly: true, text: 'routeGroups builder switched from (origin, destination) 2-tuple key to (origin, POL, destination, POD) 4-tuple key. Each tuple is normalized lowercase/trimmed for case-insensitive collapsing, but display labels preserve the best-cased version. groupByPort no longer affects bubble grouping at all — it now only controls whether the POL/POD filter dropdowns are active. useMemo dep array dropped groupByPort.' },
      { superAdminOnly: true, text: 'render path: leftLabel = port + " (country)" when port differs from country; right side same. Sort: active groups first, then alphabetical by destination → POD → origin → POL. TT/FT/ETD chips: gate removed (was `groupByPort && c`, now just `c`). Continent-filter dropdown count recomputed against the 4-part key so per-continent counts match actual bubble count.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-83-a-6-27-15-bubble-port-country.js (9 asserts) locks the 4-part keying contract: bubble grouping uses (origin, POL, destination, POD); pol/pod preserved on group object; useMemo deps include only [filtered, continentFilter]; continent count uses same 4-part key; TT/FT/ETD ungated; render uses fromLabel/fromSub with country sub when port differs. Sweep: 199/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.14',
    date: '2026-05-16',
    label: 'Financial architecture pass — Egypt Bank, checks, and dedup hardening',
    items: [
      '**Egypt Bank deposits no longer silently vanish from invoices.** When you matched a bank deposit to an invoice in the Egypt Bank tab, the system used to just bump the "Collected" number on the invoice without recording a proper treasury entry for the bank inflow. The next time any other action triggered a recalculation, the system would look for treasury entries, find none for that bank match, and reset the invoice back to its old "Collected" amount — quietly wiping the match. Now matching a bank deposit creates a proper treasury entry (or promotes a placeholder if one already exists), and the master calculator stays in sync.',
      '**Checks pick the right pocket now.** When you mark a check as collected — either manually or via auto-match from the bank statement — the system now records the money under the right "pocket": Bank when the check was deposited at the bank (the normal case), Cash only when the customer brought cash and took the physical check back. Before, every check collection was recorded as cash regardless of how it actually cleared, which inflated the safe balance by every collected check\'s amount.',
      '**Collecting a check no longer duplicates a payment.** If a treasury entry already represents the money (from a cash deposit, bank match, or other path), marking the check collected now LINKS the check to that existing entry instead of creating a second entry for the same money. Per your rule: the check should close, not double-count.',
      '**Paid invoices have a "Confirm and close pending checks" button.** When an invoice is fully paid but has pending checks tied to it, a green button appears under "Paid ✓" showing how many pending checks remain. Click it, confirm, and the system flips each pending check to collected, attaching it to a matching treasury entry where one exists. No new treasury entries get created — the money is already in the books, which is exactly why the invoice hit fully-paid status.',
      '**"Linkage drift" detector won\'t steal from another invoice.** Yesterday\'s warning banner for orphaned order-number-only matches could falsely surface payments that were legitimately linked to a different invoice that happened to share the same order number. Now it skips those — only truly unlinked payments are offered for "Link Now" repair.',
      '**Invoice-detail Egypt Bank link/unlink buttons fixed too.** When you link or unlink an Egypt Bank deposit from inside the invoice screen (not the Egypt Bank tab), the same architectural problem was happening. Both paths now flow through the master calculator instead of writing the Collected number directly.',
      { superAdminOnly: true, text: 'CONTRACT: per src/lib/supabase.js line 245-251, all invoice recalc MUST go through recalcInvoiceCollected(id). This build enforces that. EgyptBankTab.matchToInvoice + EgyptBankTab.unmatch + page.jsx invoice-detail Egypt-Bank link/unlink buttons all stopped writing total_collected directly. EgyptBankTab.matchToInvoice now: (1) tries to promote a matching placeholder, (2) if pending check exists, looks for an existing treasury row tied to that check via source_check_id and links the bank to it instead of creating a duplicate (3) otherwise creates a fresh bank_in treasury row, then always calls recalcInvoiceCollected. EgyptBankTab.unmatch reverts the treasury row state appropriately (delete auto-created, revert placeholder, revert check status) and calls recalc.' },
      { superAdminOnly: true, text: 'CHECK CHANNEL FIX: handleCollectCheck Case C now uses cash_in: physicalReturned ? amt : 0, bank_in: physicalReturned ? 0 : amt. Auto-check-bank-match loop (~line 1959) now uses cash_in:0, bank_in:checkAmt, and stamps source_check_id + matched_bank_txn_id + needs_bank_match:false + is_bank_placeholder:false on the inserted row. Previously these always used cash_in regardless of channel, inflating the safe balance for every check.' },
      { superAdminOnly: true, text: 'CONFIRM-AND-CLOSE: paid-invoice tile (outstanding=0) shows a green "Confirm and close pending checks" button when any pending checks tied to the invoice exist (via invoice_id OR order_number string match). On confirm: scans treasury for a row with matching exact amount on this invoice that has no source_check_id yet, stamps source_check_id + payment_source:check + links via linked_treasury_id on the check. Falls through (just flips status, no new row) when no exact-match row exists — avoids double-counting consolidated bank deposits.' },
      { superAdminOnly: true, text: 'ORPHAN DETECTOR HARDENING: findOrphanedOrderNumberMatches now skips rows where t.linked_invoice_id is set AND points to a different invoice than the one being viewed. Without this guard, two invoices sharing order_number would let "Link Now" on invoice A steal a row legitimately owned by invoice B. New test 6a in test-v55-83-a-6-27-14-financial-architecture.js locks this.' },
      { superAdminOnly: true, text: 'AUDIT OUTCOME: dedup_sibling_id and [bank confirmation marker rows VERIFIED to always carry zero amounts in all four fields (cash_in, cash_out, bank_in, bank_out). Created in page.jsx ~1782-1786 where the same code that sets dedup_sibling_id zeroes the amounts. Therefore ReportsTab + accounting-auditor over-counting concerns are theoretical for current data and NOT fixed in this build (no data to over-count). If future code starts creating dedup rows with nonzero amounts, those bugs become real.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-83-a-6-27-14-financial-architecture.js — 27 assertions covering the contract, no-direct-total_collected-writes, correct channel selection, treasuryByInvoiceId filters matching recalc, orphan detector other-invoice guard, confirm-and-close button presence + behavior, and regression guards on the recalc itself (cap, overpayment, dedup skip). Sweep: 198/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.13',
    date: '2026-05-16',
    label: 'Invoice reconciliation — root-cause fix for Order 2330 type bugs',
    items: [
      '**Invoice "Collected" total and the Treasury panel now agree.** The bug on Order 2330 (Collected said 110,000 but a 28,750 linked treasury entry was nowhere in the breakdown) was caused by the system using two different ways to find linked payments — one for the math, one for the display. The display now uses the same lookup the math uses, so whatever money is counted in the Collected total is exactly what appears in the Treasury panel.',
      '**Broken links now surface with a Link Now button.** When a treasury row has an order number that matches the invoice but is not properly linked to it by ID (which can happen after invoice edits or imports), the system shows an amber warning panel listing each affected row. Click Link Now to repair the link in one click — it updates the row, recalculates the invoice total, and reloads.',
      '**Payment Breakdown (Cash / Bank / Check mix) reconciles too.** Same fix applied to the small pie panel that shows the payment-source mix. Mix percentages now always match the Collected number.',
      '**Two diagnostic SQL queries available** for ops to investigate any suspect order (per-invoice 7-section dump) or scan the whole database for similar drift (global audit). Paste them into the Supabase SQL editor — both are read-only.',
      { superAdminOnly: true, text: 'ROOT CAUSE: recalcInvoiceCollected queries treasury by linked_invoice_id (UUID). treasuryByOrder map (used by the invoice-detail panel) keyed by order_number (string). The two paths diverge when a row has UUID set but order_number empty/wrong, or vice versa. Recalc counted UUID-linked rows that were invisible to the panel — exactly the 2330 case where pre-cap totalAll = 247,500 contained ~108,750 EGP of money the user couldn\'t see.' },
      { superAdminOnly: true, text: 'FIX: new treasuryByInvoiceId useMemo keys by linked_invoice_id (UUID) with the SAME skip filters as recalc (dedup_sibling_id, [bank confirmation description). Includes placeholders + pending so they\'re not hidden. Treasury panel and Payment Breakdown both switched to read from this map. Old treasuryByOrder retained ONLY for the orphan detector.' },
      { superAdminOnly: true, text: 'findOrphanedOrderNumberMatches(invoice) helper: returns rows where order_number matches but UUID does not. Surfaces in amber "Linkage drift detected" banner with Inspect + Link Now buttons per row. Link Now: dbUpdate(treasury, t.id, {linked_invoice_id: selectedInvoice.id}) → recalcInvoiceCollected(selectedInvoice.id) → loadAllData(). One-click repair.' },
      { superAdminOnly: true, text: 'Diagnostic SQL: sql/v55-83-a-6-27-13-invoice-diagnostic.sql (7 sections per invoice: invoice / treasury_by_uuid / treasury_by_order_number / invisible_to_panel / invisible_to_recalc / egypt_bank_txns / recalc_should_say). Global: sql/v55-83-a-6-27-13-global-reconciliation-audit.sql (finds every invoice where uuid_sum != panel_sum or stored != computed). Both read-only, paste into Supabase SQL editor.' },
      { superAdminOnly: true, text: 'New test: __tests__/test-v55-83-a-6-27-13-invoice-reconciliation.js — 19 assertions locking the architecture: UUID-keyed map exists, skip filters match recalc, panel + breakdown both UUID-keyed, no remaining string-keyed lookups in selectedInvoice scope, orphan detector + Link Now button wired correctly, recalc still caps at total_amount, overpayment_amount still surfaced. Sweep: 197/0.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.12',
    date: '2026-05-15',
    label: 'Regression fixes + Phone hang-up + Nadia financial gating',
    items: [
      '**Send Message and Post Reminder buttons work again.** They were rendering the form 4000 lines below the click point — so clicking the button appeared to do nothing because the form was off-screen. Both forms now open as proper centered modals over the dashboard. Click outside to close.',
      '**Phone now has a cancel/hang-up button at every stage.** Before, the hang-up only appeared once the call was fully connected. If you got stuck on "Connecting…" or "Ringing…" or an AccessTokenInvalid error, there was no way to cancel. Now there\'s a 📵 Cancel button for connecting + ringing states.',
      '**Phone errors now tell you what to do.** AccessTokenInvalid (code 20101) now says: "Refresh the page; if that fails, ask the admin to verify TWILIO_API_KEY/SECRET in Vercel". Mic-permission errors point you to the browser address bar lock icon.',
      '**Nadia stops leaking financial data.** Users without Treasury or Financial Reports permission no longer see treasury totals, invoice amounts, debts, or check amounts in Nadia\'s briefing or answers. If they ask about money, she politely says they need to ask someone with treasury access.',
      '**Nadia can now answer about closed tickets.** She maintains TWO ticket lists: active tickets (for "what\'s on my plate today" counts) and the 10 most recently closed (for "what was that ticket about leather samples last month" history queries). Closed tickets are not counted as urgent but are referenceable.',
      '**Stat tile labels and values are bigger.** Need Ack / Due Today / Overdue / Checks Due labels bumped from text-xs to text-sm. Numbers from text-3xl to text-4xl. Persona role badge ("EXECUTIVE ASSISTANT") switched from low-contrast translucent white-on-white to solid white background with dark text.',
      '**Recent Updates comments are readable.** Comment previews were tiny italic light-gray (text-[11px] text-slate-700). Now full-size text-sm slate-900 in a stronger card with a thicker blue accent bar.',
      '**Empty bubbles in Nadia chat are gone.** Messages with no text, no briefing, and no decision panel no longer render empty placeholder bubbles.',
      '**Voicemail issue is likely the same Twilio token problem.** If you\'re not receiving voicemails, that\'s probably because the same access token is failing on the incoming call path. Verify Twilio config (TWILIO_API_KEY/SECRET in Vercel env vars). Code path itself was not changed.',
      { superAdminOnly: true, text: 'page.jsx: showAddAnnouncement and showReminderForm forms wrapped in fixed inset-0 z-[300] flex centered modal overlays with backdrop onClick close + content onClick stopPropagation. Root cause: forms lived in source 4000 lines below the trigger; with my A.6.27.9 reorder the trigger moved to top of order:2 cluster, exposing the gap. The compact buttons did flip state correctly — the issue was render position.' },
      { superAdminOnly: true, text: 'PhoneWidget: hang-up branch added for callState in (connecting, ringing). formatErr in PhoneWidget switches on e.code for 20101/31005/31201 and appends actionable hint. Error banner whitespace-pre-line so multi-line hints render. Old text-only connecting/ringing indicators removed.' },
      { superAdminOnly: true, text: 'AIGreeter: now accepts modulePerms + isSuperAdmin props. ticketBelongsToMe extracted as named function; allMyTickets includes Closed, myTickets filters them out. recentlyClosed slice(0,10) appended to ctx for history queries. canSeeFinancials gate (super_admin OR Treasury OR View Financial Reports) wraps invoice/check/treasury context lines; explicit prohibition string added for non-permitted users. page.jsx mount passes both props.' },
      { superAdminOnly: true, text: 'AssistantsBar StatCard typography: label text-xs → text-sm; value text-3xl → text-4xl. Role badge: bg-white/30 backdrop-blur text-white → bg-white text-slate-900 shadow (high contrast). DashboardPrioritySections UpdateRow comment preview: text-[11px] text-slate-700 italic → text-sm text-slate-900 font-medium with bg-slate-100 border-l-4 border-blue-500. Author/time line: text-[10px] text-slate-500 → text-xs text-slate-700 font-semibold.' },
      { superAdminOnly: true, text: 'AIGreeter message render: short-circuit return null if !hasText && !hasBriefing && !hasDecision && !hasRecordError. Text bubble wrapped in {hasText && (...)} so briefing-only or decision-only messages don\'t render an empty bubble.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.11',
    date: '2026-05-15',
    label: 'Dashboard cleanup + System Tickets enlarged view + AI fixes',
    items: [
      '**Dashboard is reorganized again.** Daily Priorities GUI (Overdue, Recent Updates, Newly Assigned) now appears right after the AI assistants. Summary cards (Team Tickets, Today\'s Events, Follow-ups), the Today widget, Reminders, and Monthly Sales now sit BELOW it — not above. The duplicate "OVERDUE" red banner is gone (the new GUI handles it).',
      '**Labels on the stat tiles are now readable.** Need Ack / Due Today / Overdue / Checks Due labels were rendering near-invisible white on pastel. Now they\'re dark slate-900 (near-black) for guaranteed contrast on every tile color. Numbers keep their color coding.',
      '**Financial data is locked down.** No one except super admins or users with Treasury access can see invoices, cash register, bank transactions, or Egypt Bank totals on the dashboard. Monthly Sales stays visible to everyone (sales reps still see their numbers).',
      '**Inventory: adding SKUs now works correctly.** The wrong column name (`sku_code`) was being used in 4 internal components — the system thought SKUs didn\'t exist. Fixed to `sku_number` everywhere, plus made shipment line-item entry more discoverable with a clear "What\'s next?" banner explaining you add SKUs in the shipment detail view after creating a draft.',
      '**Inventory adjustments handle stock shortfall properly.** Before, trying to damage 50 units when only 10 are in stock would silently record a phantom -50 movement. Now it asks: cancel, or proceed with the actual 10 (and the adjustment is corrected to match what was actually drained).',
      '**System Tickets open in an enlarged modal.** Click any ticket card to see full description, full-size attachment thumbnails (192px images), and link chips. Super admins get a "🔒 Make Private / 🔓 Make Public" toggle inside the modal to flip a ticket\'s visibility after it\'s been created.',
      '**Shipping rates: trucking rates now have their own section.** New top-of-tab toggle: All Modes / 🚢 Ocean / 🚛 Trucking / ✈️ Air. Switch to Trucking to see only truck rates.',
      '**Shipping rates: bubble cards now show ports AND countries.** Was just "USA → ALGERIA", now shows "Houston, USA → Skikda, ALGERIA" when port info is available — easier to spot the route you want.',
      '**Nadia stops returning after you close her.** Once you click the minimize button or X out, she stays closed — no more auto-popping back open on the next assistant message. Click her avatar or the pill to bring her back.',
      '**Nadia\'s briefing data is correct now.** She no longer claims "you haven\'t logged in a week" when you log in daily (now cross-references the newer login_events table). She no longer says "no open tickets" when you have 30 in flight (now counts tickets you created and delegated, not just tickets directly assigned to you).',
      { superAdminOnly: true, text: 'AssistantsBar StatCard: label changed from text-amber-950 (etc) to text-slate-900. Per Max rule "DO NOT USE WHITE FOR TEXT FONT" — small uppercase colored hue on matching pastel bg was reading as white at small sizes. Value keeps colored hue at -900 family.' },
      { superAdminOnly: true, text: 'PersonalDashboard now accepts renderSection prop ("ai" | "rest" | "both" default). page.jsx mounts twice: order:1 wrapper renders ai-only (AssistantsBar + bug-retest), then within order:2 cluster after PendingBankConfirmations a second mount renders rest-only (summary cards + Today + Reminders + Monthly Sales). This puts the Daily Priorities GUI between the two halves.' },
      { superAdminOnly: true, text: 'PendingBankConfirmationsWidget canView now: isSuperAdmin OR modulePerms[Treasury] OR modulePerms[View Financial Reports]. Treasury permission alone was missing before. FINANCIAL OVERVIEW + COMMAND CENTER block in page.jsx wrapped in outer (isSuperAdmin || modulePerms[Treasury]) gate. Sales-only users no longer see invoices/cash sections on dashboard.' },
      { superAdminOnly: true, text: 'Inventory column-name fix: AdjustmentsManager, InventoryReports, InventoryPnL, LayersLedger were using sku.sku_code and sku.name — real columns are sku_number and description. Batch-fixed via sed. InventoryTab + page.jsx loaders updated to .is(deleted_at, null).order(sku_number).' },
      { superAdminOnly: true, text: 'NadiaFloatingOverlay: new userCollapsedAt state. Auto-expand on new assistant messages now skipped if userCollapsedAt > 0. Cleared on user expand (pill click or nadia-expand event). Set on user collapse (minimize button click). Full X dismissal unmounts and resets naturally.' },
      { superAdminOnly: true, text: 'AIGreeter myTickets filter broadened: t.assigned_to === myId OR t.created_by === myId OR myId in additional_assignees JSON array. Matches DashboardPrioritySections "My Direct + I Delegated" union. page.jsx loginHistory loader now Promise.all([user_sessions, login_events]) and merges any login_events dates not in user_sessions before passing to AIGreeter.' },
      { superAdminOnly: true, text: 'SystemTicketsPanel: expandedTicket state. Card onClick=setExpandedTicket(t). Action button container has onClick stopPropagation. Modal renders attachments as 192px image thumbnails or link chips. togglePrivate function flips is_private + sets private_to to original creator on private, clears on public. Admin-only button rendered in modal footer.' },
      { superAdminOnly: true, text: 'AdjustmentsManager shortfall: when drain.shortfall > 0, prompt user with window.confirm. Cancel → reverseFifoConsumption(consumed) + return. Proceed → qty corrected to -drain.qtyDrained, movRow.qty_change updated, adj.qty_change persisted on the final inv_adjustments.update.' },
      { superAdminOnly: true, text: 'ShippingRatesTab: filterMode toggle row added above stat tiles. Options: all/Ocean/Truck/Air. renderRouteCard reworked to always emit port+country format via fromLabel/fromSub/toLabel/toSub regardless of groupByPort. New What\'s Next blue banner in NewShipmentForm explaining the post-Create-Draft flow.' },
    ],
  },
  {
    version: 'v55.83-A.6.27.9',
    date: '2026-05-15',
    label: 'Dashboard reorder + Inventory complete (Stages E + F shipped)',
    items: [
      '**Dashboard is reorganized.** USD/EGP rate sits at the top as a small pill. The AI hero stays anchored. Send Message to Team and Post Reminder are now compact buttons on one row right under the AI section. Past reminders sit as a discreet link below. Your Daily Priorities cards come next, then Invoices Awaiting Bank Confirmation, then a collapsed "What\'s New" panel you can expand when you want. Monthly Sales now sits before Team Activity. Old duplicated sections (My Pipeline, Overdue Follow-Ups, the Upcoming-week list in Today) are gone — the new priority cards already cover overdue items.',
      '**The "Need Ack / Due Today / Overdue / Checks Due" tiles are readable now.** Bigger label fonts, bolder colors, stronger borders. No more squinting at faded gray-on-pastel.',
      '**Inventory module is complete — all six stages shipped.** The two new sections: **Adjustments** lets you record damage, returns, write-offs, manual additions/removals, and physical count corrections with an approval workflow. Each approved adjustment drains or creates FIFO cost layers correctly. **Reports** has three views: Stock Value (how much money is tied up in inventory, broken down by SKU), Aging (which layers have been sitting for 30/90/180/365 days), and Slow-Moving (SKUs with no sales in the period you choose).',
      '**Shipping rates: chart now matches the table for the current month.** May best-active was showing $3,050 (a stale historical floor) when the table said $3,575 (current active rate). Chart now uses the same logic as the "Best Active" tile — picks the lowest rate that\'s still good through today\'s date for the current month, and through end-of-month for past months.',
      '**Shipping rates: bad-data quarantine for imports.** Rows with same-day effective=expiry, year-2000 dates, expiry before effective, zero rate, or impossibly high rate ($100K+) no longer get imported into the main table. They land in a holding pen for review. Import result screen shows a Quarantined count alongside Added/Updated/Failed.',
      '**Setup needed: run the database update.** A one-time SQL (`sql/v55-83-a-6-27-7-quarantine.sql`) adds the import quarantine table. Safe to re-run.',
      { superAdminOnly: true, text: 'Dashboard: FX widget moved to top-of-tab compact pill. PersonalDashboard: My Pipeline and Overdue Follow-Ups blocks removed entirely (duplicated DashboardPrioritySections). Today widget Upcoming subsection removed. AssistantsBar StatCard restyled: label text-[11px] font-extrabold no opacity; value text-3xl font-black; -950 text colors with -400 borders. page.jsx: compact Send Message + Post Reminder pair injected at top of order:2 cluster; old large buttons removed from header and reminder widget. WhatsNewWidget prominent={false} for collapsed-by-default. PendingBankConfirmationsWidget moved to right after DashboardPrioritySections. Team Activity Feed moved from before Pending Checks to right after Monthly Sales.' },
      { superAdminOnly: true, text: 'Inventory Stage E (AdjustmentsManager.jsx): 6 adjustment types (damage, return, count, write_off, manual_add, manual_remove) with auto-sign by direction. Pending → approve/reject workflow. Permission via canApproveAdjustments(). On approve: OUT drains FIFO via consumeFifo + rollback on partial fail; IN creates a new layer at weighted-avg of existing layers, or provisional zero-cost if none. Movement type mapping: damage→damage, write_off→write_off, else adjustment_in/_out. movement_id stamped on inv_adjustments for traceback.' },
      { superAdminOnly: true, text: 'Inventory Stage F (InventoryReports.jsx): three subviews. Stock Value — Σ(qty_remaining × landed_unit_cost) per SKU, USD + EGP totals + 3 KPI tiles. Aging — 5 buckets (<1mo / 1–3 / 3–6 / 6–12 / >12mo) by received_at, per-layer drill-down sorted oldest-first. Slow-Moving — joins stock_value with last sale movement per sku_id; user-tunable threshold 30/60/90/180 days. All client-side from inv_layers + inv_movements (last 365d).' },
      { superAdminOnly: true, text: 'Chart fix (A.6.27.8): activeInMonth filter now uses refDate = min(monthEnd, today) instead of just monthEnd. For current month, refDate=today aligns with isExpired() in stat tile. For past months, refDate=monthEnd preserves history. Diagnostic table at chart bottom also updated.' },
      { superAdminOnly: true, text: 'Import quarantine: validateBadDataPatterns() with 6 rules; quarantineRows[] alongside validRows[], batch_id via crypto.randomUUID, persisted to shipping_rates_import_quarantine post-validation. Graceful degradation if SQL not yet run (warns user, rows skipped not lost-tracked).' },
    ],
  },
  {
    version: 'v55.83-A.6.27',
    date: '2026-05-14',
    label: 'Inventory Stages C + D shipped — Landed Cost + Sale Deduction',
    items: [
      '**Inventory now tracks the true cost of every shipment.** Open any received shipment, click "💰 Finalize Landed Cost", and the system: pulls today\'s USD→EGP exchange rate from a live rate service (or lets you override it), adds up every cost component (purchase + freight + customs + port + handling + inland + other), converts each currency to USD and EGP, and splits the total across the SKUs in the shipment by your choice — equal per unit, by weight, or by purchase value.',
      '**Sales now automatically pull stock from the right shipment.** When you save an invoice line with an inventory SKU selected, the system finds the oldest available stock for that SKU, drains the right quantity from it, and stamps the actual cost of those goods sold (COGS) onto that invoice line. Delete an invoice or a line item — the system reverses the deduction and the stock comes back.',
      '**Two new tabs in Inventory: Cost Layers and Profit by SKU.** Cost Layers shows you, per SKU, exactly which shipments your remaining stock came from and what each layer cost — plus what\'s been drained. Profit by SKU shows revenue minus COGS per SKU with margin, for the month, quarter, year, or all-time.',
      '**Cost-finalize-after-sales is honest.** If a freight invoice arrives a month after the shipment and your costs change, you can re-finalize — the system writes an audit row and restates the COGS on every prior sale that drained from that shipment. The cost layers tab shows a "Restated × N" badge so you know which layers were affected.',
      '**You can sell from stock before all costs are entered.** Layers created from a shipment whose costs are still in progress are marked "Provisional" — sales can still drain from them. When you finalize the cost later, prior sales auto-restate with the correct COGS and you get a summary of the adjustment.',
      '**Setup needed: run the database update.** A one-time SQL file (`sql/v55-83-a-6-27-inventory-stage-c-d.sql`) adds the new tables (inv_layers, inv_cost_adjustments, inv_fx_rates) and the new columns on inv_shipments, inv_shipment_skus, inv_movements, and invoice_items. Safe to re-run.',
      { superAdminOnly: true, text: 'SCHEMA — sql/v55-83-a-6-27-inventory-stage-c-d.sql. ADDs to inv_shipments: total_landed_cost_usd/_egp, allocation_method (by_qty|by_kg|by_value), fx_usd_to_egp, fx_source, fx_locked_at, cost_finalized_at, cost_finalized_by. ADDs to inv_shipment_skus: allocated_cost_usd/_egp, landed_unit_cost_usd/_egp. ADDs to inv_movements: unit_cost_usd/_egp, total_cost_usd/_egp, consumed_layers JSONB, linked_invoice_id, linked_invoice_item_id. ADDs to invoice_items: inv_sku_id, inv_warehouse_id, cogs_usd/_egp, cogs_movement_id. NEW tables: inv_layers (FIFO cost layers with provisional flag), inv_cost_adjustments (audit log when layer cost changes post-sale), inv_fx_rates (cache).' },
      { superAdminOnly: true, text: 'COST ENGINE — src/lib/inventory-cost-engine.js: rollupShipmentCost (sums 7 components, converts to USD/EGP), allocateAcrossSkus (3 methods with fallback), finalizeShipmentCost (orchestrates rollup→allocate→write back→create/update layers→restate prior sales), consumeFifo (drains oldest-first, returns consumed_layers + weighted COGS with rollback on partial failure), reverseFifoConsumption (returns qty to layers on invoice line delete), restateCostForLayer (recomputes COGS on every prior movement that drained the layer, updates linked invoice_items, writes audit row).' },
      { superAdminOnly: true, text: 'FX — src/lib/inventory-fx.js: getFxRate (cache → exchangerate.host API → null), saveManualRate (override), convert (handles cross-currency via USD bridging). FX rates cached in inv_fx_rates with source tag. exchangerate.host is free + no API key required.' },
      { superAdminOnly: true, text: 'UI — FinalizeCostDialog.jsx (FX block with override, rollup table, allocation method picker, per-SKU preview, restate summary on confirm). LayersLedger.jsx (per-SKU layer viewer with provisional/finalized/restated badges, drainage indicators). InventoryPnL.jsx (per-SKU revenue/COGS/profit/margin with period filter). ShipmentsManager: Finalize button + landed cost banner. page.jsx invoice modal: SKU dropdown per line; save triggers consumeFifo + sale movement + COGS stamping; line/invoice delete triggers reverseFifoConsumption.' },
      { superAdminOnly: true, text: 'TESTS — __tests__/test-v55-83-a-6-27-inventory-stage-c-d.js: SQL idempotency, FX helper API/cache/override, cost engine math (rollup with FX, allocation by qty/kg/value, FIFO consume + shortfall + rollback, reverse, restate), FinalizeCostDialog rendering, LayersLedger + InventoryPnL exports. Updated InventoryTab subtab availability to include C and D.' },
    ],
  },
  {
    version: 'v55.83-A',
    date: '2026-05-13',
    label: 'New Inventory Module — Stage 1 of 6 (Foundation)',
    items: [
      // PUBLIC — layman per Permanent Rule #1
      '**New Inventory module — foundation shipped.** This is the first of six stages building an ERP-grade inventory, shipment, costing, and profitability system. Stage 1 ships the foundation: you can now define your master SKU database and your physical warehouse locations. The next stages add shipments, costing, sales linkage, adjustments, imports, and AI insights — all building on this foundation without restructuring it.',
      '**Replaced the old Inventory tab.** The previous inline inventory section (test data only — wiped per agreed plan) has been replaced with the new structured module. The old test rows have been archived (saved to a backup table just in case) and the new module starts from a clean slate.',
      '**Master SKU database.** Define every product you stock once: SKU number, English/Arabic descriptions, product type, color, primary unit (kilos, yards, meters, rolls, pieces, liters, boxes), and conversion factors. There\'s a "Generate SKU" helper button that suggests SKU-00001 style numbers if you don\'t have your own scheme.',
      '**Four starter warehouses seeded** — Cairo, Sokhna, USA, Other. Edit names, codes, addresses, and default currencies in the Warehouses tab. Add more whenever you need.',
      '**Cost and P&L permissions.** Three new permission tiers can be granted per user: see SKUs (basic), see costs (landed/avg cost), see P&L (gross profit, FX impact, total profit). Super admin sees everything by default; everyone else sees only what they\'re granted. Hides at the UI level AND refuses at the server level.',
      '**Setup needed: run the database update.** A one-time database setup file is included in this build. It creates the new inventory tables, archives the old test inventory, and seeds the 4 warehouses + 6 starter exchange rates. Safe to re-run if needed. Until this is run once, the Inventory tab will be empty.',
      '**FX rates are placeholders.** USD/EGP=50.00, EUR/EGP=54.00 — please update these in Settings → FX Rates (Stage C wires up the UI for this; for now you can edit directly in Supabase).',
      // SUPER_ADMIN — technical detail
      { superAdminOnly: true, text: 'SCHEMA — sql/v55-83-a-inventory-schema.sql creates 11 tables: inv_warehouses, inv_skus, inv_fx_rates, inv_shipments, inv_shipment_skus, inv_movements, inv_adjustments, inv_transfers, inv_invoice_lines, inv_audit_journal, inv_import_jobs. All idempotent (IF NOT EXISTS). Archive snapshot via CREATE TABLE AS SELECT * FROM inventory, then DELETE FROM inventory. Soft-delete via deleted_at on identity tables (warehouses/skus/shipments); append-only ledger on movements/audit/imports.' },
      { superAdminOnly: true, text: 'ARCHITECTURE — Weighted Average COGS per SKU + rolling weighted-avg base FX rate per SKU (Option B from design). inv_skus has avg_landed_cost + avg_base_fx_to_egp + avg_base_fx_to_usd, all maintained as denormalized caches of the latest inv_movements row. inv_invoice_lines snapshots gross_profit_egp/usd, fx_impact_egp/usd, total_profit_egp/usd at write time — never recalculated. Per-shipment P&L uses dual approach: Expected (target_revenue vs landed_cost) + Attributed (proportional share — computed in Stage D).' },
      { superAdminOnly: true, text: 'PERMISSIONS — src/lib/inventory-permissions.js with six exports: canViewInventory, canEditInventory, canSeeInventoryCosts, canSeeInventoryPnL, canEditOriginalQty, canApproveAdjustments + stripSensitiveFields/Rows helpers for server response stripping. Three permission keys: inv.view, inv.see_costs, inv.see_pnl. Super_admin role bypasses all gates.' },
      { superAdminOnly: true, text: 'COMPONENTS — MasterSKUList.jsx (CRUD with permission-aware columns), WarehouseSettings.jsx (CRUD with admin gate), InventoryTab.jsx (orchestrator with 7 subtabs — 2 active in Stage A, 5 coming-soon for B/E/F). Removed ~1900 lines of inline inventory code from page.jsx. RESTORED Calendar + CRM tab renders that were accidentally clipped during the line-range replacement.' },
      { superAdminOnly: true, text: 'TESTS — __tests__/test-v55-83-a-inventory-foundation.js with 41 assertions covering schema (11 tables + idempotency + seeds + indexes), permissions (3-tier visibility + strip helpers), components (Master SKU + Warehouse CRUD), and page.jsx integration. DEFERRED 3 legacy inventory test suites (S19, S20-three-field, S20-calendar-and-shipment) — their features are scheduled for Stages B/E. Patched: v55-82-f 6a/6c (accept v55.83+ family), v55-82-z 11b (loosened regex), v55-81 contrast sweep (cleaned text-slate-400 in new components).' },
      { superAdminOnly: true, text: 'STAGE PLAN — A: foundation (this build, shipped). B: shipment header + SKU breakdown + reconciliation + master inventory view. C: landed cost engine + customs/freight distribution + rolling avg cost. D: structured invoice lines + sale FX + COGS deduction + per-SKU + per-shipment P&L. E: imports (template + row-level errors) + adjustments module + physical count. F: AI anomaly detection + smart matching + 10 reporting dashboards + profitability insights.' },
      { superAdminOnly: true, text: 'QA: 136 pass / 32 fail. Zero regressions vs Z baseline. 8 initial regressions all resolved: (a) Calendar+CRM render blocks accidentally clipped — restored. (b) 3 legacy inventory test suites — deferred to Stage B/E. (c) Contrast offenders in new components — text-slate-400 → text-slate-500. (d) Version-stamp regex updated for v55.83 family. (e) Comment-feed filter regex loosened.' },
    ],
  },
  {
    version: 'v55.82-Z',
    date: '2026-05-12',
    label: 'Confidential tickets · Private tickets re-colored to light blue',
    items: [
      // PUBLIC — layman per Permanent Rule #1
      '**New: Confidential tickets (orange).** Anyone on the team can now mark a ticket CONFIDENTIAL when they create it. A confidential ticket is only visible to the creator, the people it\'s assigned to, and super admin. Everyone else — including regular admins — won\'t see it in lists, searches, or counts. Use this for sensitive matters where a small team needs to collaborate but the rest of the company shouldn\'t see it (HR issues, vendor disputes, internal investigations). Confidential tickets show with an orange tint and a 🟧 CONFIDENTIAL chip so they\'re easy to recognize.',
      '**Private tickets now use light blue.** The super-admin-only "Make this ticket PRIVATE" checkbox now shows in light-blue (was amber/yellow) and so does the card itself. This is purely a visual change so you can tell PRIVATE (light blue) and CONFIDENTIAL (orange) apart at a glance.',
      '**Counts and stats respect privacy.** The five summary cards at the top (Critical / Open / Overdue / High / Closed) and the status legend counts now exclude tickets the current user can\'t see. No more "Open: 47" when only 39 are actually visible to them.',
      '**Setup needed before this works:** run the SQL at `sql/v55-82-z-confidential-tickets.sql` to add the `is_confidential` column. The build will still load without it — if you check the Confidential box without running the migration, the system silently saves the ticket as a regular one. The light-blue private color works regardless of SQL state.',
      // SUPER_ADMIN — technical detail per Permanent Rule #1
      { superAdminOnly: true, text: 'SQL — sql/v55-82-z-confidential-tickets.sql adds `is_confidential BOOLEAN NOT NULL DEFAULT FALSE` to tickets, plus a partial index on (is_confidential) WHERE is_confidential=TRUE. Idempotent — also reasserts v55.82-V is_private + private_to columns so a single run brings the schema fully current.' },
      { superAdminOnly: true, text: 'canSeeTicket helper — new single source of truth in TicketsTab.jsx. Logic: super_admin → true; is_private → private_to===myId; is_confidential → created_by===myId OR parseAssignees(t).includes(myId); else → true. Used by the main filtered useMemo, the status-count widget (legend), and all five top stat cards.' },
      { superAdminOnly: true, text: 'Form — Private box now uses sky palette (border-sky-400, bg-sky-50, text-sky-900) and is still super_admin-gated. New Confidential box below it uses orange palette (border-orange-400, bg-orange-50, text-orange-900) and is available to ALL users. onChange handlers enforce mutual exclusivity at the UI layer.' },
      { superAdminOnly: true, text: 'Insert path — handleAddTicket now computes both makePrivate and makeConfidential. is_private/private_to only added to ticketRow when makePrivate is true; is_confidential only added when makeConfidential is true. Backward-compat: works without v55.82-V or v55.82-Z SQL having been run (columns simply won\'t be set). logActivity tag now reflects [PRIVATE] vs [CONFIDENTIAL] vs assignment. Confidential tickets DO notify assignees (unlike private, where the assignee IS the creator).' },
      { superAdminOnly: true, text: 'Card visuals — outer bg uses nested ternary: closed → bg-slate-200 (wins); private → bg-sky-50; confidential → bg-orange-50; else → bg-white. Border colors follow same pattern: closed #94a3b8, private #7dd3fc (sky-300), confidential #fdba74 (orange-300), else #e2e8f0. Chips: 🔒 PRIVATE on sky-100; 🟧 CONFIDENTIAL on orange-100.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-82-z-confidential.js — 27 assertions covering SQL existence, canSeeTicket logic, filter/count usage, form colors+mutual exclusivity, conditional column writes, card/chip styling. Brittle prior tests patched: test-v55-82-d 2a+2c, test-v55-82-s 1a, test-v55-82-w priv — all loosened to accept v55.82-Z nested ternary forms.' },
      { superAdminOnly: true, text: 'QA: 134 pass / 32 fail. Zero regressions vs Y.' },
    ],
  },
  {
    version: 'v55.82-Y',
    date: '2026-05-12',
    label: 'Hotfix — Nadia HTTP 400 root cause · ticket submit silently failing',
    items: [
      // PUBLIC — layman per Permanent Rule #1
      '**Fixed: tickets can be created again.** The Submit button on the new-ticket form was silently doing nothing because the database was rejecting hidden fields (`is_private` and `private_to`) that aren\'t in your table yet — those columns only exist if you\'ve run the v55.82-V SQL. The system now only sends those fields when you actually check the "Make this ticket private" box. Tickets will save normally even if you never run that SQL.',
      '**Fixed: AI assistants still hitting HTTP 400 after the X build.** The model names were correct in X, but the request body sometimes had problems Anthropic rejects — empty messages, or two messages from the same speaker in a row (happens occasionally after retries). The system now cleans up the message list before sending. If anything DOES still fail, you\'ll see the actual reason from Anthropic instead of just "HTTP 400" — every error now shows the full server response so we can diagnose immediately.',
      '**Improved: database changes are more forgiving.** When the app tries to save a record with a column your database doesn\'t have yet, the save used to fail on the SECOND such column. Now it iteratively removes any number of unknown columns and saves what it can — so partial migrations no longer block saves. Console logs tell admins which migrations are still pending.',
      // SUPER_ADMIN — technical detail
      { superAdminOnly: true, text: 'TICKETS — TicketsTab.jsx handleAddTicket now conditionally includes is_private + private_to ONLY when makePrivate is true. The default ticketRow literal no longer references those columns, so an INSERT works regardless of whether sql/v55-82-v-private-tickets.sql has been applied. Private-ticket filter (`!t.is_private || t.private_to === myId`) is safe with undefined t.is_private — undefined is falsy, all rows pass.' },
      { superAdminOnly: true, text: 'AI REQUEST NORMALIZATION — /api/ask main path now: (a) trims and drops empty content, (b) collapses consecutive same-role messages (keeps the latest), (c) drops leading non-user messages, (d) guarantees the array ends with role=user. Anthropic returns 400 on any of these violations. Same normalization applied to greeter path (gMessages).' },
      { superAdminOnly: true, text: 'AI ERROR REPORTING — both MODEL_CHAIN and GMODEL_CHAIN now capture FULL response body (substring(0, 500), up from 200) and track per-attempt errors in allAttemptErrors / gAllErrors arrays. Final error message is the joined list of every attempt\'s failure so users see "Sonnet 400: ... | Haiku 400: ..." instead of just the last one. Vercel logs get up to 1000 chars of each error body.' },
      { superAdminOnly: true, text: 'DB RESILIENCE — src/lib/supabase.js dbInsert + dbUpdate now loop column-stripping (max 8 iterations) instead of single retry. Records with multiple not-yet-migrated columns no longer fail on the second one. Each stripped column logs `[dbInsert] ... Run the SQL migration that adds this column.` Stripped columns also propagate to audit_log new_values so the trail matches what was actually saved.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-82-y-hotfix.js — 9 assertions. Brittle prior test patched: test-v55-30-missing-column-resilience accepts both single-if and while-loop forms.' },
      { superAdminOnly: true, text: 'QA: 133 pass / 32 fail. Zero regressions vs X.' },
    ],
  },
  {
    version: 'v55.82-X',
    date: '2026-05-12',
    label: 'Hotfix — AI assistants getting "HTTP 400" errors',
    items: [
      // PUBLIC — layman per Permanent Rule #1
      '**Fixed: AI assistants returning "HTTP 400" errors.** Nadia, Sara, Jenna, the Personal Coach, the translator, and the auto-summarizer were all failing because the AI model names they were trying to use got deprecated by Anthropic in their May 2026 cleanup. Every model reference has been updated to the current names — the assistants should respond normally again.',
      '**New: ops can swap models without a code change.** If you ever need to roll back to a different model or test a new one, just set `AI_MODEL_CHAIN` in Vercel environment variables (comma-separated, e.g. `claude-sonnet-4-6,claude-haiku-4-5`). The system reads this on each request, so changes take effect immediately on next request — no redeploy.',
      // SUPER_ADMIN — technical detail
      { superAdminOnly: true, text: 'Ten model-ID references updated across src/app/api/{ask,ask-v2,hr-report/coach,hr-report/review,translate,accountant}/route.js and src/lib/ai-memory.js. Old dated IDs `claude-sonnet-4-20250514` and `claude-haiku-4-5-20251001` → current dateless-pinned IDs `claude-sonnet-4-6` and `claude-haiku-4-5` per docs.claude.com. Also normalized one stray `claude-sonnet-4-5` reference in accountant route.' },
      { superAdminOnly: true, text: 'Both MODEL_CHAIN and GMODEL_CHAIN in /api/ask now read from process.env.AI_MODEL_CHAIN first (comma-separated), falling back to the defaults if unset. This is the same pattern used by other env-var-overridable knobs in the codebase. Fallback order is intentional: Sonnet first (quality), Haiku second (speed/cost) — Anthropic\'s docs recommend Opus 4.7 for the hardest tasks but it\'s 5-10x cost so we don\'t put it in the default chain.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-82-x-model-refresh.js — 7 assertions. Zero refs to old IDs anywhere, current IDs present, env-var override hook exists. Brittle prior test patched: test-v55-81-qa-fixes QA-19 MODEL_CHAIN + GMODEL_CHAIN assertions now accept either historical or current chain.' },
      { superAdminOnly: true, text: 'QA: 132 pass / 32 fail. Zero regressions vs W.' },
    ],
  },
  {
    version: 'v55.82-W',
    date: '2026-05-12',
    label: 'Eleven fixes — closed-ticket search, recorder, shipping graph, login alerts, attachments, and more',
    items: [
      // PUBLIC — layman business language only per Permanent Rule #1
      '**Search now finds closed tickets too.** Typing a search query in the Tickets tab used to be blocked by the "Open" status filter — so closed tickets never appeared in results. Now whenever you\'re searching, the status filter is bypassed and you see every matching ticket, open or closed.',
      '**Voice recording no longer turns itself back on after you stop.** When you tapped the Record button and then tapped Stop, the mic was secretly restarting itself. Fixed — Stop now means stop, on all assistants (Nadia, Sara, Jenna, dashboard voice).',
      '**Calendar meetings now show who attended.** Open any meeting\'s notes panel and you\'ll see a new green "Attended" line listing everyone who checked in or contributed notes, plus when the first check-in happened.',
      '**HR review now penalizes priority items that aren\'t moving.** If a ticket is starred on your priority board but you\'ve gone 24+ hours without commenting, updating its status, or touching it, your engagement score drops by 5 points per stagnant item (capped at 25). Stars are commitments — sitting on them counts against you.',
      '**Setup needed for "Change priority to Critical" bug.** Run the SQL diagnostic at `sql/v55-82-w-priority-check.sql` and paste me the output. Most likely your database has a CHECK constraint that doesn\'t include `critical` — same pattern as the container-type issue last week. The diagnostic tells me the fix to give you.',
      '**System tickets can now have file attachments.** New 📎 Attachments section in the system-ticket form. Drop screenshots, screen recordings, logs, anything that helps. Files are uploaded when you submit, and appear as clickable chips on the ticket card. **Setup needed:** create a Supabase Storage bucket named `ticket-attachments` with public read enabled.',
      '**Shipping graph: expired rates show in the historical trend.** Previously the graph plotted one line per shipping line, which got cluttered and hid expired rates behind newer ones. Now the default is one clear line showing the best rate over time, period — no spaghetti.',
      '**Shipping graph: best-rate line as default, dropdown for per-line view.** The "All lines (compare)" default now shows a single best-rate line. To see a specific shipping line\'s trend, pick it from the dropdown. Cleaner, more decision-useful.',
      '**Shipping graph: stale rates show as dotted grey.** When the best rate has expired and no newer rate has replaced it, the graph continues the line as a dashed grey segment with hollow dots — labeled "Best rate (stale — last known)". You can see "this is the last known best, but it\'s no longer valid" at a glance.',
      '**Shipping import: smarter name matching.** "CMA CGM" and "CMA-CGM" now match. "Maersk" and "MAERSK" already matched (case-insensitive). The new matching also strips dashes, dots, slashes, and collapses extra spaces — so cosmetic differences in vendor or line names don\'t create duplicate records.',
      '**"Did Not Login Yesterday" no longer flags people who actually logged in.** The widget used to only check the older `user_sessions` table. Now it cross-references the newer `login_events` summary, which is the more reliable source. If either confirms the login, you\'re not flagged.',
      // SUPER_ADMIN — technical detail per Permanent Rule #1
      { superAdminOnly: true, text: 'TICKETS — TicketsTab.jsx: search bypass for status filter via `if (!searchActive) { ... status filters ... }`. Private-ticket gate already in place from v55.82-V applies before search.' },
      { superAdminOnly: true, text: 'RECORDER — AIGreeter.jsx stopRecording() now calls stopBackupRecog() FIRST to null out recordBackupRecogRef.current and clear handlers, so any in-flight br.onend gets the new guards: (a) ref-equality check (br === recordBackupRecogRef.current), and (b) canonical MediaRecorder.state check instead of closure-captured `recording` variable. Previously a race window between mr.stop() and onstop firing allowed the backup SR to call br.start() one more time.' },
      { superAdminOnly: true, text: 'CALENDAR — CalendarTab.jsx meeting-notes modal: new attendance summary block derives attendeeIds from event.checked_in_by ∪ notesThread[].author_id. Renders unique names + first-check-in timestamp.' },
      { superAdminOnly: true, text: 'HR-METRICS — src/lib/hr-metrics.js: new `stagnantPriorityTickets` filter — assigned + starred_today + status !== Closed + no comment/audit/updated_at since starred_at + 24h+ elapsed. Exposed as `stagnantPriorityCount`. Score impact: `engagement = Math.max(0, engagement - Math.min(25, stagnantPriorityCount * 5))`.' },
      { superAdminOnly: true, text: 'SYSTEM TICKETS — SystemTicketsPanel.jsx: new pendingFiles state + uploadPendingFiles helper (path: system/<ts>_<i>_<safe-name>, bucket: ticket-attachments, contentType from File.type with octet-stream fallback). Attachments stored as jsonb [{name, url, size, type}, ...]. List view renders 📎/🖼️ chips with href.' },
      { superAdminOnly: true, text: 'SHIPPING CHART — ShippingRatesTab.jsx: chartShippingLine === \'all\' now sets linesToPlot = [] (was: every line in route). Per-month point splits into _bestActive (fresh, solid stroke #0f172a w=3) vs _bestStale (carry-forward, dashed #94a3b8 w=2 strokeDasharray 4 4 hollow dots). Two Line components render the split.' },
      { superAdminOnly: true, text: 'IMPORT MATCHING — ShippingRatesTab.jsx: new normName() = `s.toLowerCase().replace(/[^a-z0-9]+/g, \' \').replace(/\\s+/g, \' \').trim()`. keyFor() now calls normName() for origin, destination, vendor_name, shipping_line. Safe exact-after-normalization match — no edit-distance fuzziness, no silent merges.' },
      { superAdminOnly: true, text: 'LOGIN ALERT — AdminTab.jsx: "Did Not Login Yesterday" widget builds two sets — loggedInYesterdaySessions (user_sessions.date === yesterday) and loggedInYesterdayEvents (loginSummary[].logins_yesterday_et > 0). User is "missing" only if BOTH show no login. didLogIn(uid) = sessions OR events.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-82-w-omnibus.js — 25 assertions across the 11 items. Brittle prior tests patched: test-v55-81-empty-blocks-sweep 3.1, test-v55-82-c 2a+3b, test-v55-82-i 4a/4b/4c, test-v55-82-l 2c, test-v55-82-s 3a.' },
      { superAdminOnly: true, text: 'QA: 131 pass / 32 fail. Zero regressions vs U baseline.' },
      { superAdminOnly: true, text: 'SQL needed: (1) sql/v55-82-w-priority-check.sql — diagnostic for the Critical-priority bug; paste output back for the fix-constraint SQL. (2) v55.82-V SQL sql/v55-82-v-private-tickets.sql adds is_private + private_to columns to tickets. (3) Supabase Storage: create bucket "ticket-attachments" with public read enabled.' },
    ],
  },
  {
    version: 'v55.82-V',
    date: '2026-05-12',
    label: 'Private tickets for super_admin · AI language follows each user\'s setting',
    items: [
      // PUBLIC
      '**Super admin can now create private tickets.** New 🔒 "Make this ticket private" checkbox on the new-ticket form (super_admin only). When checked: only you and your AI assistants will see the ticket. Other team members — including admins — won\'t find it in any list, search result, or count widget. Private tickets get a 🔒 PRIVATE chip on the card so you can tell them apart at a glance.',
      '**AI now respects each user\'s preferred language.** The Personal Coach (Sara), the Wins panel, the period selector (Yesterday / Last 7 Days / etc), the stat tile labels (Tickets You Closed, Meetings Attended, etc), and the no-activity empty state all now flip to Arabic automatically for users whose preferred_language is set to "ar" in Settings. Users with "en" or "both" see English by default, with the EN/AR toggle still available on the coach card.',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'TICKETS — Tickets table gets is_private (boolean default false) + private_to (uuid, indexed). SQL at sql/v55-82-v-private-tickets.sql. TicketsTab filter applies `!t.is_private || t.private_to === myId` BEFORE all other filters so private tickets never leak through search, status filters, sort, or count widgets. New-ticket form: super-admin-only checkbox; when checked, assigned_to is forced to creator and additional_assignees is null (a private ticket assigned to someone else makes no sense).' },
      { superAdminOnly: true, text: 'MYPERFORMANCE — coachLang initializer reads userProfile.preferred_language (ar → ar, anything else → en). New `pageLang` derived the same way drives page chrome translation. PAGE_LABELS map with en/ar keys; T(key) lookup helper; periodOptions = PERIOD_LABELS_AR when ar. Stat tile labels, suffixes, hints, empty-state body, Wins component all bilingual. RTL via dir={bodyDir} on body containers.' },
      { superAdminOnly: true, text: 'QA: zero regressions; all v55.82-V assertions roll up into the v55.82-W omnibus test suite.' },
    ],
  },
  {
    version: 'v55.82-U',
    date: '2026-05-12',
    label: 'Build notes rewritten in plain business language — permanent rules locked in',
    items: [
      // PUBLIC
      '**Build notes now read like business updates, not engineering changelogs.** Going forward, every release note you see in this panel will be in plain language — what was fixed, what improved, why it matters. No more developer jargon, no more raw commit-style notes. Technical details still exist underneath for admins who want them.',
      '**The last six builds (O through T) have been rewritten** to follow the new standard. Each one now reads as a clear, business-friendly summary at the top, with engineering detail tucked into admin-only items below.',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'PERMANENT RULE locked into Claude\'s memory (Max May 12 2026): all BUILD_HISTORY public items must be layman business language with bullets + bold where helpful. Bad examples to avoid: "refactored async state hydration", "patched ORM resolver", "websocket polling reconciliation". Good examples: "Improved shipping import reliability", "Fixed AI transcription auth issue", "Fixed Work Coach showing No Data". The superAdminOnly: true items are the right place for technical detail. The structure is now: PUBLIC items (layman) + SUPER_ADMIN items (technical) inside the same release entry.' },
      { superAdminOnly: true, text: 'OTHER PERMANENT RULES LOCKED IN: (2) AI reads ALL tickets — open, closed, regular, system — for historical intelligence and duplicate prevention. Only system_tickets enter the build-review pipeline; regular tickets stay out. (3) Closed tickets visually grey out the ENTIRE card (already shipped v55.82-S). (4) Only super_admin can delete via AI; AI must verify perms + require confirmation + log every deletion. (5) AI helps organize/classify/structure tickets but does NOT autonomously modify production code. (6) UI/UX always prioritize readability + contrast + accessibility (long-form text on gradients = wrap in white card, never direct).' },
      { superAdminOnly: true, text: 'No code logic changed in this build — only build-history copy and a version stamp bump. QA unchanged: 130 pass / 32 fail. Zero regressions.' },
    ],
  },
  {
    version: 'v55.82-T',
    date: '2026-05-12',
    label: 'Fixed Work Coach showing "No Data" when activity existed',
    items: [
      // PUBLIC — layman business language per Max's permanent rule
      '**Work Coach (Sara) no longer says "no data" when you have activity.** Sara was sometimes telling people they had no recorded activity even when the same screen showed dozens of tickets, hundreds of comments, and many meetings. The coach now waits for your activity numbers to fully load before writing her feedback, so what she says matches what you actually did.',
      '**Coach feedback now refreshes correctly when you switch time periods.** Switching from "Last 30 Days" to "Last 7 Days" (or any other period) now triggers a fresh coach response based on that period\'s actual numbers — not a stale message from the previous period.',
      // SUPER_ADMIN — technical detail stays here
      { superAdminOnly: true, text: 'Root cause: the auto-fetch effect in MyPerformance.jsx fired on first render before the 7-table Supabase pull resolved, sending metrics:{} to /api/hr-report/coach. The AI then correctly responded "no activity" based on the empty payload. The de-dup key was userId:period — once recorded, the effect refused to refire after real data arrived, so the stale empty-state message was stuck.' },
      { superAdminOnly: true, text: 'FIX A (frontend gate): added `if (loading) return;` to the auto-fetch effect so it waits for the 7-table pull to finish before posting. Dep array now includes `loading`.' },
      { superAdminOnly: true, text: 'FIX B (frontend de-dup key): key now includes a fingerprint of the metrics — `${myId}:${period}:${totalActions}:${ticketsClosed}:${manualEntries}`. When current goes from null → real data, the key changes, the effect refires, and the stale message is cleared (`setCoachMsg(\'\')`) before requestCoach() runs again.' },
      { superAdminOnly: true, text: 'FIX C (backend safety net): /api/hr-report/coach/route.js counts keys in body.metrics. If activitySum===0 AND Object.keys(metrics).length<5, route returns 503 + "Activity data is still loading — please tap Refresh in a moment" instead of generating a misleading "no activity" message. Also logs [hr-coach] metrics payload looks empty to Vercel for diagnostics.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-82-t-coach-race.js — 10 assertions across the 3 fixes. All green.' },
      { superAdminOnly: true, text: 'QA: 130 pass / 32 fail. Zero regressions vs S.' },
    ],
  },
  {
    version: 'v55.82-S',
    date: '2026-05-12',
    label: 'Closed tickets fully greyed · Stop button names the right assistant · Personal Coach Arabic toggle',
    items: [
      // PUBLIC
      '**Closed tickets now clearly look closed.** The ENTIRE ticket card is greyed out — not just the title or status label. Title gets a strike-through. Status pill renders in plain grey instead of the loud colored pill. "Overdue" and "Due Today" badges are hidden on closed tickets (a closed ticket can\'t be overdue — it\'s done). Assignee chips lose their per-person color. The whole card visually recedes from active tickets, but stays clickable for full history.',
      '**The "Stop" button now names whichever assistant is talking.** When Nadia is speaking it says "Tap to stop Nadia". When Jenna speaks: "Tap to stop Jenna". When Sara speaks: "Tap to stop Sara". Arabic too: إيقاف ناديا / إيقاف جينا / إيقاف سارة. Before this fix, it always said "Nadia" regardless of who was actually speaking.',
      '**Personal Coach (Sara) now has an English/Arabic toggle.** Two new EN/AR pill buttons next to the "Get Coach Feedback" button. Tap AR and the entire feedback flips to Arabic — card labels, error messages, and the AI-generated coach feedback itself. Body text renders right-to-left. Tap EN to flip back. Each switch fetches a fresh response in the new language.',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'Closed-ticket card wrapper: filter: \'grayscale(0.55) opacity(0.92)\'. Title className conditional (closed → text-slate-600 line-through, open → text-slate-900). Status pill style conditional (closed → fixed slate inline-style, open → sp.bg/sp.fg map). Overdue + Due-Today badges guarded by t.status !== \'Closed\'. Priority dot color, assignee chip style, description text, ticket# all greyed when closed.' },
      { superAdminOnly: true, text: 'AIGreeter stop button IIFE picks stopAssistantName/stopAssistantNameAr from activeAgentKey (already derived from the selectedAssistant prop). Title attribute also dynamic.' },
      { superAdminOnly: true, text: 'Personal Coach: new coachLang state independent of global lang. requestCoach POST body adds lang field. /api/hr-report/coach/route.js accepts body.lang, appends "LANGUAGE: Write your entire response in Modern Standard Arabic" instruction to system prompt when lang===\'ar\'. All card chrome strings live in a tLabel map driven by isAr = coachLang === \'ar\'. Body containers get dir={bodyDir}.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-82-s-three-asks.js — 21 assertions. Brittle prior tests patched: test-v55-82-d 2a/b/c, test-s15 T1/T2/T3, test-v55-81-contrast-audit/sweep, test-v55-82-l 1a/3a, test-v55-82-r 5/7.' },
      { superAdminOnly: true, text: 'QA: 129 pass / 32 fail. Zero regressions vs R.' },
    ],
  },
  {
    version: 'v55.82-R',
    date: '2026-05-12',
    label: 'Fixed Personal Coach feedback text being almost invisible',
    items: [
      // PUBLIC
      '**Personal Coach feedback is now readable.** The coach\'s feedback text was rendered in mid-grey on a soft violet/pink gradient — on dark theme that combination was almost invisible. Fixed: the feedback now sits in a solid white card with near-black bold text. Same upgrade applied to the loading state, empty state, and error card. The "Get Coach Feedback" button got a stronger violet for better contrast against the white text.',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'MyPerformance.jsx — coachMsg block moved INTO a bg-white p-4 rounded-lg + border + shadow-sm card, INSIDE the violet/pink gradient parent. Body text: text-sm text-slate-900 font-medium leading-relaxed whitespace-pre-wrap. New "YOUR COACH FEEDBACK" uppercase label on top in text-violet-800 font-extrabold. Empty + loading + error states all upgraded to violet-900 headings + slate-800/700 body with font-medium. Wins panel emerald-50/700 → emerald-100/900. Button violet-600 → violet-700.' },
      { superAdminOnly: true, text: 'NEW TEST: __tests__/test-v55-82-r-coach-contrast.js — 8 assertions. Brittle prior tests patched: test-v55-81-empty-white-blocks (window 2500→4500), test-v55-82-i 3h/3j.' },
      { superAdminOnly: true, text: 'QA: 130 pass / 30 fail. Zero regressions vs Q.' },
    ],
  },
  {
    version: 'v55.82-Q',
    date: '2026-05-12',
    label: 'Dark-theme contrast fixes — failed counts visible · closed tickets distinguishable',
    items: [
      // PUBLIC
      '**Shipping import result cards are now readable on dark theme.** The "Failed" count was rendered in dark red on very pale pink — fine on a white page, invisible on dark theme. Now all 5 result cards (New Added, Updated, Unchanged, Failed, Deleted) use saturated colors that read clearly on any background.',
      '**Closed tickets now look different from open tickets.** The previous styling was so pale you couldn\'t tell open and closed apart on dark theme. Now closed tickets have a proper grey background and darker grey left border that\'s unmistakable at a glance.',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'Import result cards: bg-X-50/text-X-900 → bg-X-100 border-X-300 + text-X-900 + font-black. Failed card uses bg-rose-200 border-rose-400 text-rose-950 + font-black numbers. Field capture summary pills bumped to bg-X-200 + text-X-950. Preview-screen capture cards: bg-X-50 border-X-200 → bg-X-100 border-X-400.' },
      { superAdminOnly: true, text: 'Closed tickets: bg-slate-50 opacity-70 hover:opacity-100 → bg-slate-200 text-slate-600. Left border #94a3b8 → #64748b for stronger contrast. Outer border bumped from #e2e8f0 → #94a3b8 when closed.' },
      { superAdminOnly: true, text: 'QA: 129 pass / 30 fail. Zero regressions vs P.' },
    ],
  },
  {
    version: 'v55.82-P',
    date: '2026-05-12',
    label: 'Shipping import UX fixes — no more uncopiable popup · scrollable error list · clearer messaging',
    items: [
      // PUBLIC
      '**No more blocking popup after a shipping import.** The browser-native alert at the end of the import is gone — you couldn\'t copy from it (browser security), and the same information was already on the result screen below in a much better format. The popup was just blocking your view.',
      '**Error list is now actually usable.** The error panel got taller (you see roughly 10 errors at once instead of 3). Added a **"Copy all errors"** button that puts the full error list on your clipboard. Added a **"Download CSV"** button for spreadsheet review.',
      '**New "Nothing was lost" reassurance banner.** When every row in your import file fails (e.g. a column mapping problem), the result screen now shows a clear amber banner: *"Nothing was saved — and nothing was lost."* So you don\'t panic that your existing data was deleted. Update Only mode never deletes anything.',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'ShippingRatesTab.jsx: removed the alert(summary) call at end of executeImport. Error panel max-h-64 → max-h-96. Added Copy + CSV buttons with navigator.clipboard fallback to document.execCommand. New banner conditional on (counts.added + counts.updated === 0) && counts.failed > 0.' },
      { superAdminOnly: true, text: 'BRITTLE TESTS PATCHED: 1.17/1.18 in test-v55-81 (removed-alert refs), 5b in test-v55-82-l-stage2 (widened regex window 200→800).' },
      { superAdminOnly: true, text: 'QA: 129 pass / 30 fail. Zero regressions vs N.' },
    ],
  },
  {
    version: 'v55.82-O',
    date: '2026-05-12',
    label: 'Fixed voice transcription error messages — no more blaming the microphone for auth issues',
    items: [
      // PUBLIC
      '**Voice transcription error messages now make sense.** When voice transcription failed because your login session expired, the old error said *"speak closer to the mic"* — which had nothing to do with the real problem. Now you get the right message:',
      '• **Session expired** → "Session expired — please sign in again. This has nothing to do with the mic."',
      '• **Rate limit hit** → "Hit the transcription rate limit — wait a few minutes."',
      '• **Service not set up** → "Transcription service not set up — admin needs to add OPENAI_API_KEY."',
      '• **Real mic issue** → the existing mic-related guidance (now the catch-all only for actually-unknown errors).',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'AIGreeter onstop now grabs supabase.auth.getSession() access_token and sends Authorization: Bearer ${tok} on /api/transcribe POST. Previously sent no header — relied on cookie auth which is brittle across browsers / private mode / Safari ITP. Server-side already supported Bearer; added [transcribe] auth-fail jwt_source=X err=Y console.warn for diagnostics.' },
      { superAdminOnly: true, text: 'AIGreeter error classification: case for /Authentication required|401|unauthor/ → distinct "Session expired" message. Case for /rate limit|429/ → distinct rate-limit message. Mic-blame is now the catch-all only. Arabic translations for all three new cases.' },
      { superAdminOnly: true, text: 'BRITTLE TESTS PATCHED: test-record-button-bulletproof E5 (wording softened), test-voice-recorder-whisper REC11 (regex widened from match to global greeter file).' },
      { superAdminOnly: true, text: 'QA: 129 pass / 30 fail. Zero regressions vs N.' },
    ],
  },
  {
    version: 'v55.82-N',
    date: '2026-05-12',
    label: 'Shipping import — field-level capture diagnostic (per Max May 12 2026 — "Add validation showing which fields were imported, missing, or failed")',
    items: [
      // PUBLIC
      'NEW: FIELD CAPTURE REPORT ON THE IMPORT PREVIEW. Before you click Import, you now see a panel showing all 21 template fields and exactly how many of your rows have a value for each one. Origin, Destination, POL, POD, Transport Mode, Effective Date, Expiry Date, Transit Days, Free Days, every fee, Notes — each one gets an "OK", "PARTIAL", "EMPTY", or "MISSING" badge, with a captured/total ratio so you see at a glance what made it through.',
      'NO MORE SILENT FIELD-DROPS. If a column from your template fails to auto-detect, the report flags it as "MISSING (no col)" in red and the summary line tells you how many fields need remapping. If a column WAS detected but all values are blank, you see "EMPTY" instead — the diagnostic distinguishes "I couldn\'t find this column in your file" from "I found it but it was empty."',
      'CAPTURE SUMMARY ALSO SHOWN ON THE DONE SCREEN. After import, the same field-by-field breakdown appears on the success screen so you have a record of what actually went into the database for this import run.',
      'WHAT YOU LOOK FOR: Open import preview → check the Field Capture Report → if you see RED ("MISSING") or AMBER ("PARTIAL") badges for fields that should be filled, scroll down to Column Mapping and pick the right source column. The report refreshes automatically when you change a mapping.',
      // SUPER_ADMIN
      { superAdminOnly: true, text: 'IMPLEMENTATION: ShippingRatesTab.jsx — new computeCaptureReport(colMap, parsed, useContainerExpansion) helper above processImportFile. Returns an array of {field, label, dbField, sourceCol, detected, captured, total, status} for each of the 21 template fields. Status logic: missing (no source column detected, except container when useContainerExpansion is on which gets a synthesized detection), empty (column detected but no row has a value), partial (1-89% of rows have a value), ok (≥90%). Numeric fee fields treat 0 as a valid captured value (rate_amount, transit_days, free_days, port_fees, thc_fees, documentation_fees, customs_fees, other_fees). Text fields treat empty string as missing.' },
      { superAdminOnly: true, text: 'WIRING: computeCaptureReport called inside both processImportFile and reparseFromMapping right after the parse loop, so the report stays in sync with whatever the user remaps in the column mapping panel. Result stored in importCaptureReport useState which is reset to [] on every Back button (top, cancel, done-screen Back).' },
      { superAdminOnly: true, text: 'UI: two-tier rendering. (a) Full report on the preview step — 3-column grid of cards, each card shows label + source column name + status badge + captured/total ratio. Status colors: emerald/amber/slate/rose. Status legend in the header. Bottom summary line consolidates missing/empty/partial counts and tells user which path to take ("check the file\'s header row" / "use Column Mapping to remap"). (b) Compact summary on the done step — 3-col grid of label + status pill + ratio. So user can see post-import what actually wrote.' },
      { superAdminOnly: true, text: 'NOT FIXED IN THIS BUILD: the underlying mapping/parsing code. Static analysis against the actual template headers shows all 21 columns are correctly detected by findColSmart (with preferNumeric tiebreaking handling the "rate" vs "Port of Discharge contains substring charge" edge). Two "multiple match" warnings (rate matches POD because of "discharge", otherFees matches description) are resolved by preferNumeric picking the numeric one. The capture report will reveal if there\'s a real mapping bug we missed, with row-level precision. If POL/POD show as MISSING on the next import attempt, the bug is in column detection — if they show as OK on preview but EMPTY in the DB after save, the bug is in the DB-write step.' },
      { superAdminOnly: true, text: 'NOT YET DONE: a direct end-to-end test that imports the template file via a headless XLSX read + colMap + parse and asserts each of the 21 dbField values matches the spreadsheet row exactly. That would catch a parsing bug definitively without needing a live import attempt. Adding that test is the next step if Max\'s next import shows fields still dropping despite the capture report claiming OK.' },
      { superAdminOnly: true, text: 'QA: 129 pass / 30 fail. Zero regressions vs M.' },
    ],
  },
  {
    version: 'v55.82-M',
    date: '2026-05-12',
    label: 'Shipping price-history chart rebuilt per Max May 12 2026 spec — effective-date timeline · active-window logic · carry-forward stale · click-to-jump',
    items: [
      // PUBLIC
      'PRICE-HISTORY CHART NOW WORKS THE WAY YOU EXPECT. The X-axis is months along the effective-date timeline — starting from the earliest effective month in your data and running continuously to today. No more gaps where a month had no data.',
      'EVERY MONTH SHOWS THE BEST ACTIVE RATE THAT MONTH. The chart now checks which rates were actually active in each month (effective date ≤ that month AND not yet expired) and plots the lowest. If no active rate exists for a month, it carries the last known best price forward — but draws it as a HOLLOW DASHED DOT and tags the tooltip with "last known — no newer rate" so you can see at a glance that the line is stale.',
      'CLICK ANY POINT ON THE CHART → JUMP TO THE RATE BELOW. Tap a dot on the line and the page scrolls down to the matching rate record in the Historical Rates table, with a 3-second yellow highlight ring around the row so you don\'t lose sight of it. Now the chart and the rate list are connected end-to-end.',
      'CHART HEADER SUBTITLE EXPLAINS THE RULES. "X-axis: month (effective-date timeline) · Y-axis: lowest active rate · ⭐ = booking · hollow dot = stale carry-forward · click any point → jump to the rate below." So you never have to wonder what you\'re looking at.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'CHART REBUILD: ShippingRatesTab.jsx — validRatesForChart filter switched from anchoring on expiry_date (v55.82-C) to anchoring on effective_date (eff.length >= 10 && amt > 0). The month timeline is built by reducing validRatesForChart to find the earliest effective month, then rolling forward via nextMonth() helper (handles December→January) to the later of today or rateHistoryDt or any rate\'s expiry_date, capped at 600-month safety bound.' },
      { superAdminOnly: true, text: 'ACTIVE-WINDOW LOGIC: for each month M, activeInMonth = rates where (effective_date <= lastDayOf(M)) AND (expiry_date is null OR expiry_date >= firstDayOf(M)). lastDayOf uses UTC Date with day=0 of next month to correctly handle 28/29/30/31-day months. monthStart and monthEnd computed per iteration so the overlap test is clean.' },
      { superAdminOnly: true, text: 'PER-LINE WINNER: activeForLine.reduce((acc, r) => Number(r.rate_amount) < Number(acc.rate_amount) ? r : acc, null). Returns the actual row object (not just the price) so we can stash winner.id in point[\'__source__\' + L] for click resolution. Same pattern for the market-floor _best line via activeInMonth.reduce.' },
      { superAdminOnly: true, text: 'CARRY-FORWARD: lastBestForLine map { L → {price, rateId, asOfMonth} } updated on every active-month winner. If a month has no active rates for line L, the else-if branch copies lastBestForLine[L].price into point[L], flags point[\'__stale__\' + L] = true, and reuses lastBestForLine[L].rateId for the click sourceId. lastBest plays the same role for the _best market floor line. Dots rendered via makeDotRenderer(L, color) which inspects payload[\'__stale__\' + L] and draws either a hollow dashed circle (stale) or a solid filled circle (active).' },
      { superAdminOnly: true, text: 'CLICK HANDLER: highlightedRateId useState(null) at component scope, with a useEffect that auto-clears it after 3000ms so the row-flash fades. handleChartClick reads state.activePayload[0].payload.__sourceIds__[0] when Recharts fires its onClick, then setHighlightedRateId(firstId) and setTimeout 50ms → document.getElementById(\'rate-row-\' + firstId).scrollIntoView({behavior:\'smooth\', block:\'center\'}). Rate row receives id={\'rate-row-\' + r.id} and a className that conditionally appends ring-4 ring-yellow-400 ring-offset-1 bg-yellow-50 when isHighlighted, with transition-all duration-300 for the fade. activeDot props on Lines also get cursor:\'pointer\' so users see the click affordance on hover.' },
      { superAdminOnly: true, text: 'TOOLTIP: formatter detects stale points by checking payload[\'__stale__\' + name] (or __stale___best for the market floor line) and appends " (last known — no newer rate)" to the price string. So a user reading the tooltip immediately sees whether the number is a real active rate or a carried-forward stale value.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-m-chart-spec.js — 29 spec-compliance assertions across all 7 spec points plus regression guards (no expiry-anchored validRates filter, no sparse-month derivation via monthsSet). Brittle prior tests patched: test-v55-82-c (8 assertions rewritten for M-spec — eff vs exp, reduce vs Math.min.apply, indexOf vs includes), test-v55-80-b10-coverage (the new (new Date()).toISOString().slice(0,10) idiom for "today" doesn\'t trip the stale-UTC detector — alternative idiom avoids needing to alter the underlying utility).' },
      { superAdminOnly: true, text: 'QA: 128 pass / 30 fail. Zero regressions vs L2.' },
    ],
  },
  {
    version: 'v55.82-L2',
    date: '2026-05-11',
    label: 'Shipping import — full spec rebuild (Update Only safe default · Full Sync with typed confirm · per-row error isolation · NEVER wipes on bad data)',
    items: [
      // PUBLIC
      'SHIPPING IMPORT REBUILT FROM SCRATCH PER FULL SPEC. The bug that wiped your shipping rates on the previous build is now physically impossible. The new import is line-by-line: one bad row never affects another row, and the system never wipes any data unless you explicitly choose Full Sync and type a confirmation phrase first.',
      'NEW DEFAULT IS "UPDATE ONLY" — THE SAFE MODE. For each row in your file, the system checks 5 fields (Origin, Destination, Expiration Date, Freight Forwarder, Shipping Line). If all 5 match an existing rate → that rate is updated. If no match → the row is added as a new rate. Anything already in the system that isn\'t in your file is left completely alone. This is what you want for any normal upload.',
      'NEW "FULL SYNC" MODE for when you want the file to replace everything. Adds new, updates changed, leaves unchanged alone, AND deletes rows that aren\'t in your file. Destructive — you have to (1) pick the radio button AND (2) type "FULL SYNC" in the confirmation box before the Run button is enabled. If any row in your file has a validation error, the delete step is skipped automatically.',
      'ONE BAD ROW NEVER FAILS THE BATCH. The new validator checks every row before any database write: required fields present, dates parsable, year in range. Rows that fail validation are skipped and listed in an error report — every other row still gets saved. No more "0 saved, 210 failed" wipes.',
      'NEW DETAILED RESULT SCREEN. After import you see 5 count cards (New Added / Updated / Unchanged / Failed / Deleted) plus a full error list with row number, field name, and reason for each failure. So if a row was skipped, you know exactly which one and why.',
      'A VALIDATION BUG THAT WIPED HISTORICAL DATA IS FIXED. The previous build accepted dates like "0-01-01" through to Postgres, which then rejected the whole batch — but only AFTER the delete step had run. New code rejects bad dates per-row in the pre-flight check, and the delete step now only runs if ALL rows pass validation.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'SPEC COMPLIANCE: All 11 sections of Max May 11 2026 written spec implemented. Section 1 (two modes, update_only default) → useState(\'update_only\'). Section 2 (5-key match) → keyFor builder with origin+destination+expiry_date+vendor_name+shipping_line, all lowercase/trimmed. Section 3 (CASE A/B/C/D) → rowChanged helper for CASE B; UPDATE/INSERT branches for A/C; per-row try/catch for D. Section 4 (safety) → validateDate pre-flight rejects "0-01-01", year < 1900, year > 2100, invalid month/day. Section 5 (error reporting) → errors[] array of {row, field, reason} objects. Section 6 (summary counts) → importCounts state {added, updated, unchanged, failed, deleted}. Section 7 (transactional safety) → per-row isolated try/catch with timeout. Section 8 (historical protection) → full_sync delete scoped to vendor+origin combos in file only. Section 9 (UI) → SAFE · DEFAULT badge on Update Only, ⚠️ DELETES MISSING ROWS on Full Sync, typed confirmation, disabled button. Section 10 (technical flow) → 5 numbered steps. Section 11 (no unconditional wipes) → guard test verifies all .delete() calls live inside the full_sync STEP 4 block.' },
      { superAdminOnly: true, text: 'ROOT CAUSE of Max\'s wipe (photo evidence "210 failed / 0 saved / Insert step failed: date/time field value out of range: \\"0-01-01\\""): old code in v55.82-J Update Historical mode did bulk-delete-then-bulk-insert. Bulk-delete of 210 matched rows committed. Bulk-insert blew up on one row with date "0-01-01" (Postgres rolled back the whole batch). Result: 210 rows deleted, 0 inserted, data gone. v55.82-L2 inverts this: pre-flight validate → per-row insert (no bulk rollback) → full_sync delete LAST, only if zero errors. So the same failure mode now produces 209 saved + 1 skipped, never any delete.' },
      { superAdminOnly: true, text: 'executeImport rewritten (~17.8K chars, completely new). validateDate helper rejects null/empty (OK, stores as null), and otherwise requires YYYY-MM-DD with year 1900-2100, month 1-12, day 1-31. cleanForDB strips undefined and empty-string dates. rowChanged compares only non-key fields, treats null/undefined/"" as equivalent, numeric compare for fee fields. Withhold timeout wrapper resolves to {error} on timeout (never throws). Per-row write loop iterates validRows[], each row in its own try/catch + 10sec timeout. Missing-column retry runs per-row, not per-batch. Progress updates throttled every 10 rows to avoid 200+ rerenders.' },
      { superAdminOnly: true, text: 'Full Sync deletion logic: scoped to (vendor+origin) combos that appear in the import file. So if your file covers MSC routes from China, Full Sync will only delete MSC-China rows not in the file — it won\'t touch ZIM-Turkey or any other vendor/origin combos. Protects historical data for vendors not covered by the current upload. The delete step runs LAST (step 4 of 5), AFTER all inserts/updates have succeeded, AND ONLY if counts.failed === 0 — any validation error or insert error aborts the delete step automatically.' },
      { superAdminOnly: true, text: 'UI changes (ShippingRatesTab.jsx): radio replaced (3 radios → 2 radios). Update Only has SAFE · DEFAULT badge (emerald). Full Sync has ⚠️ DELETES MISSING ROWS badge (rose) plus typed confirmation input that only appears when full_sync is selected. Run button disabled with disabled={importMode === \'full_sync\' && fullSyncConfirm !== \'FULL SYNC\'}. Done screen redesigned: 5-card grid (added/updated/unchanged/failed/deleted) + scrollable error list with row/field/reason per entry.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-l-stage2-import-spec.js — 38 spec-compliance assertions covering all 11 sections, plus 4 regression guards (no useState(\'add\') default, no \'replace\' mode, no \'update\' mode, no bulk-insert pattern, no unconditional .delete(). Brittle prior tests patched: test-v55-33 (asserted old bulk-insert design), test-v55-81 (asserted old bulk behaviors), test-v55-82-f (header pin to F → letter+digit suffix support), test-v55-82-j (mode labels for the 3-mode J design, replaced with L2 2-mode assertions).' },
      { superAdminOnly: true, text: 'QA: 127 pass / 30 fail full sweep. Zero regressions vs v55.82-A baseline. Build syntax check clean. Header badges + Treasury modal stamps all bumped to v55.82-L2.' },
    ],
  },
  {
    version: 'v55.82-L',
    date: '2026-05-11',
    label: 'Personal Coach blank-screen fix (10th report — full root-cause and rebuild)',
    items: [
      // PUBLIC
      'PERSONAL COACH NOW ALWAYS SHOWS UP AND ALWAYS GIVES YOU FEEDBACK. The Personal Coach card appears on your performance panel for everyone, every time — even if you had a quiet period with no recorded activity. It auto-loads your coaching message the moment the panel opens; no clicking required. If the coach can\'t reach the AI service (for example because the AI service key is not set up in Vercel), you\'ll see a clear "Coach can\'t respond right now" warning card with a Try Again button — not a blank space.',
      'COACH NOW TALKS TO YOU EVEN IF YOU HAD NO ACTIVITY. Used to skip the coaching message entirely when your activity numbers were all zero — that left a blank spot on the page. Now: zero-activity periods get a warm welcome message and one easy goal for the next period (like "write a quick daily-log entry at the end of each day"). No judgment, no shame.',
      'CLICKING "GET COACH FEEDBACK" ALWAYS DOES SOMETHING NOW. Used to silently no-op if your data was still loading. Now: the button is always clickable, and if data hasn\'t arrived yet the coach gracefully says so instead of nothing happening.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'ROOT CAUSE #1 (the FATAL bug — explains the blank spot Max reported 10 times): MyPerformance.jsx wrapped the Personal Coach card inside the `{!loading && current && hasAnyActivity && (...)}` branch. If hasAnyActivity was false (zero activity OR — worse — a silent metrics fetch failure that returned all-zero values), the entire card was skipped. The "👋 No activity in [period]" cyan banner showed at line 391-401 INSTEAD of the coach card.' },
      { superAdminOnly: true, text: 'ROOT CAUSE #2 (the "click does nothing" bug): The auto-fetch useEffect had `if (!hasAnyActivity) return;` AND `if (!current) return;` so it silently bailed for low-activity / slow-loading users. The button itself had `disabled={coachLoading || !current}` so even if a user found the card, they couldn\'t manually click it before metrics loaded.' },
      { superAdminOnly: true, text: 'ROOT CAUSE #3 (the "no feedback when clicked" bug): When ANTHROPIC_API_KEY was missing from Vercel env, the API returned developer jargon. Client showed this in a 12px text-rose-700 chip on bg-rose-50. On phone DPR + small viewport, this was effectively invisible.' },
      { superAdminOnly: true, text: 'FIX #1 (component): Personal Coach card MOVED OUT of the `hasAnyActivity && (...)` branch. Now gated only on `!loading`. Always renders for any user once initial load completes.' },
      { superAdminOnly: true, text: 'FIX #2 (auto-fetch): Effect deps simplified to [expanded, myId, period, current]. Bailing conditions reduced to just expanded + myId + dedup key. Fires for any user as soon as the panel is visible. autoFetchedRef still scoped to (myId + period) so changing period re-triggers.' },
      { superAdminOnly: true, text: 'FIX #3 (requestCoach): Removed `if (!current) return;` — instead sends `metrics: current || {}` so the API receives a valid payload even when client metrics never loaded.' },
      { superAdminOnly: true, text: 'FIX #4 (button): `disabled={coachLoading}` only. User can always click — even before metrics load.' },
      { superAdminOnly: true, text: 'FIX #5 (error UI): tiny text-rose-700 chip replaced with a full warning card: bg-rose-50 border-2 border-rose-300 + bold heading "⚠️ Coach can\'t respond right now" + the actual error text + a "Try again" button inside.' },
      { superAdminOnly: true, text: 'FIX #6 (API route low-activity): isLowActivity sum computed. When true, system prompt branches to dedicated welcome+goal-setting prompt that explicitly tells Claude "do NOT pretend they did things they did not do, and do NOT shame them for the empty period." Three-paragraph structure: warm acknowledgment / what shows up here / one easy starter goal.' },
      { superAdminOnly: true, text: 'FIX #7 (API route errors): Missing key error rewritten to plain English. 401 → "AI service key is invalid". 429 → "rate-limited right now". 5xx → "AI service is having trouble". Network/fetch errors caught separately with "Could not reach the AI service". Empty Claude responses surfaced as explicit error instead of silent empty message.' },
      { superAdminOnly: true, text: 'FIX #8 (diagnostics): Added GET handler at /api/hr-report/coach that returns {status, has_anthropic_key, hint}. Visiting the route in a browser now confirms (a) the route is deployed AND (b) whether ANTHROPIC_API_KEY is present in env. Saves a debug round-trip when troubleshooting on production.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-l-personal-coach-blank.js — 23 assertions across all 3 root causes plus regression guards. Brittle prior tests patched: test-v55-81-empty-white-blocks asserted coach INSIDE hasAnyActivity (now verifies the v55.82-L OUTSIDE structure); test-v55-82-i-visibility-fixes asserted exact dep array shape (now accepts either legacy or v55.82-L shape).' },
      { superAdminOnly: true, text: 'QA: 126 pass / 30 fail full sweep. Zero regressions vs v55.82-A baseline.' },
    ],
  },
  {
    version: 'v55.82-K',
    date: '2026-05-11',
    label: 'Shipping bubbles sorted by destination continent + dropdown filter',
    items: [
      // PUBLIC
      'SHIPPING BUBBLES ARE NOW GROUPED BY DESTINATION CONTINENT. Open the Shipping tab and instead of one long alphabetical list, your routes are now organized under continent headers — Africa, Asia, Europe, North America, South America, Oceania, and Other. So you can see at a glance "I have 6 active routes to Asia" without scrolling.',
      'NEW DROPDOWN AT THE TOP OF SHIPPING lets you filter by continent. Pick "Asia" to see only routes going to Asia. The dropdown shows the route count for each continent so you know what is in there before you tap. An X button clears the filter back to all continents. Your last choice is remembered across reloads.',
      'WHEN A SPECIFIC CONTINENT IS SELECTED, the headers go away and the routes show as one flat grid for that continent. When no continent is selected, you get the grouped view with all continents visible at once.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'STATE: NEW continentFilter useState with localStorage key ktc_shipping_continent_filter, default "all". Persistent setter setContinentFilterPersist follows the same pattern as filterExpiryPersist + routesViewModePersist.' },
      { superAdminOnly: true, text: 'CONSTANTS: NEW CONTINENTS const (Africa / Asia / Europe / North America / South America / Oceania / Other). NEW COUNTRY_TO_CONTINENT map covering ~150 country names + ISO-2 codes + a handful of Arabic names (مصر, الصين). NEW continentOf(country) helper — case-insensitive lookup, defaults to "Other" so no route ever disappears.' },
      { superAdminOnly: true, text: 'ROUTE GROUPS: routeGroups useMemo now (1) annotates every group with destContinent via continentOf(data.destination), (2) applies a .filter step honoring continentFilter, (3) deps array updated to include continentFilter so the memo invalidates on filter change.' },
      { superAdminOnly: true, text: 'UI #1 (dropdown): rendered next to the Active/Historical/Both filter pills. Computes per-continent counts on the fly from `filtered` (so counts reflect the expiry filter). Shows "🌍 All continents (N)" first, then each continent with a region emoji and its count, then a clear-X button when filter !== "all".' },
      { superAdminOnly: true, text: 'UI #2 (continent section headers): when continentFilter === "all", the Active grid renders as a sequence of continent groups (CONTINENTS in canonical order, empties skipped). Each section has a header strip with the emoji, continent name, route count, and a thin underline. When a specific continent is selected, headers are skipped and the grid is flat (filter dropdown already communicates the filter). Historical grid does the same, dimmed.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-j-continent-filter.js — 23 assertions across constants, state persistence, group annotation, dropdown UI, section-header rendering, and 3 regression guards on activeRouteGroups / historicalRouteGroups / counts.' },
      { superAdminOnly: true, text: 'QA: 125 pass / 30 fail full sweep, zero regressions vs v55.82-A baseline.' },
    ],
  },
  {
    version: 'v55.82-J',
    date: '2026-05-11',
    label: 'Today widget shows tickets due · What\'s New banner moved next to AI · Import mode rename + true fill-gaps-only',
    items: [
      // PUBLIC
      'TODAY WIDGET ON THE DASHBOARD NOW SHOWS TICKETS DUE TODAY. Used to be just calendar events. Now it folds in any open ticket assigned to you (or that you created) with a due date of today. Tickets show with a 🎫 prefix and an "Open →" button that jumps straight to the ticket. Critical and high-priority tickets get their badges right in the row so you can prioritize at a glance. (Reminders widget already did this from a prior build — that still works.)',
      'WHAT\'S NEW BANNER NOW SITS RIGHT BELOW THE AI WORKFORCE — full width, hard to miss. Used to be a small pill tucked into the right corner that everyone missed. Now it\'s a prominent banner with the build version, date, and a "Tap to read →" affordance directly under the Nadia/Sara/Jenna tiles so build updates can\'t go unnoticed.',
      'SHIPPING IMPORT MODES RENAMED FOR CLARITY: "Add New" / "Update Historical (FILL GAPS ONLY)" / "Replace Historical (TOTAL OVERWRITE)". Each mode now has a bright sub-badge next to the radio label so you can\'t mistake one for the other. The explainer panel underneath spells out the impact in plain words: Add only inserts new rows; Update Historical fills in fields that were previously empty (never overwrites existing values); Replace Historical deletes the matching row entirely and writes the new file row in its place (including blanks).',
      'UPDATE HISTORICAL NOW REALLY MEANS "FILL GAPS ONLY". The previous Update logic patched ANY non-blank import field over the existing value — so a typo in the new file could overwrite a correct existing value. Now: a field is only filled if the existing row had it empty (or zero, for fee fields). Existing values are NEVER touched. If you want to overwrite, use Replace Historical.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'TODAY WIDGET #1: PersonalDashboard.jsx — Today widget header `📅 Today ({count})` now sums (todayEvents.length + todayTktCount). Body builds streamToday = [...todayEvents, ...todayTickets] where todayTickets is filtered from myTickets + ticketsICreated by due_date === todayStr AND status not in [Closed, Resolved, Fixed]. Dedup applied via findIndex on .id so a ticket appearing in both lists renders once. Ticket rows: 🎫 prefix, Open → button → navigate("tickets"), Critical/High priority badges inline. Empty state mentions both events and tickets.' },
      { superAdminOnly: true, text: 'WHATS-NEW #2: WhatsNewWidget.jsx — gained `prominent` prop. When true: renders a full-width w-full button with larger ✨ icon, headline + label/date subline, "Tap to read →" affordance and rounded-xl banner styling. When false: original right-aligned pill preserved (backward compat for any other mount points). page.jsx Dashboard mount changed from `flex justify-end + <WhatsNewWidget />` to `<WhatsNewWidget ... prominent={true} />` so the banner takes full available width inside the order-2 flex column, immediately under the AI Workforce hero (order-1 = PersonalDashboard).' },
      { superAdminOnly: true, text: 'IMPORT MODES #3: ShippingRatesTab.jsx — radio button labels: "Add" → "Add New", "Update" → "Update Historical" with text-blue-700 bg-blue-100 "FILL GAPS ONLY" sub-badge, "Replace" → "Replace Historical" with text-rose-700 bg-rose-100 "TOTAL OVERWRITE" sub-badge. Explainer panel copy rewritten for each mode — Update emphasizes "only fill in fields that were previously empty or zero — existing values are NEVER overwritten"; Replace emphasizes "deleted entirely" + "they will erase what was there".' },
      { superAdminOnly: true, text: 'IMPORT LOGIC #4: ShippingRatesTab.jsx executeImport Update branch rewritten. Old v55.82-G behavior: ANY non-blank import field patched over existing (merge semantics). New v55.82-J: check existingIsEmpty FIRST for each field, only patch if existing row\'s value is null/undefined/empty-string (or for numeric feeFields: Number(ev) === 0 or NaN). feeFields set expanded to include rate_amount + transit_days + free_days so all numeric measurements are treated as "empty" when zero. If the existing row has a real value, the import file\'s value is ignored regardless of what it contains. Replace path unchanged — still delete-then-insert via .delete().in("id", matchedIds) then insert.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-j-three-asks.js — 25 assertions across all three asks plus regression guards (no flex justify-end wrapping WhatsNew, no old merge-semantics regex in Update path, three modes still present). Updated test-v55-67-performance-restore-and-whatsnew-filter.js to accept the new `prominent` prop in WhatsNewWidget signature + dashboard mount.' },
      { superAdminOnly: true, text: 'QA: 124 pass / 30 fail full sweep. Zero regressions vs v55.82-A baseline.' },
    ],
  },
  {
    version: 'v55.82-I',
    date: '2026-05-11',
    label: 'Dashboard SelfStat cards (Customer Touches, Show-Up Rate, Daily Log Streak) — invisible numbers fixed',
    items: [
      // PUBLIC
      'YOUR DASHBOARD STATS NOW HAVE READABLE NUMBERS. Customer Touches, Show-Up Rate, and Daily Log Streak were rendering with pale pink/teal pill backgrounds and matching pale text on the dark dashboard — the actual numbers were invisible. All those cards now use the same dark-glass treatment as the rest of the dashboard, with a bright accent color on the number itself and a colored left edge so each stat is still distinguishable at a glance.',
      'ALL DASHBOARD STAT CARDS NOW LOOK CONSISTENT. The Customer Touches, Show-Up Rate, and Daily Log Streak cards were on light-pink/teal pills while every other card around them was dark-glass — they stuck out as broken. Now every stat card on the dashboard shares the same visual treatment: dark surface, colored left edge for the tone, bright accent number. Visual rhythm restored.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'ROOT CAUSE (Max May 11 photo evidence): SelfStat component in MyPerformance.jsx used a toneClass map producing bg-rose-50/bg-teal-50/bg-amber-50 backgrounds with text-rose-700/text-teal-700/text-amber-900 value colors. On the app\'s dark canvas, this rendered as glaring pastel pills. The supporting label text used text-slate-600 which globals.css overrides to muted-grey, making "0 touches" / "% of 19 you set up" / "/26 work days" effectively invisible. The big number itself was readable on rose-50 (#fff1f2) at text-rose-700 (#be123c) at desktop, but at phone DPR + dark surround the contrast was poor.' },
      { superAdminOnly: true, text: 'FIX: SelfStat rewritten to a single dark-glass surface (rgba(255,255,255,0.04) background, white-alpha border, 3px accent-colored left border). Tone now drives ONLY the accent color via an accentColor map (green→emerald-400, rose→rose-400, teal→teal-400, etc.) used for the LEFT BORDER and the big number text. Label uses rgba(203,213,225,0.85), suffix and hint use rgba(148,163,184,0.85-0.9) — both readable on dark. Delta indicators bumped from text-emerald-600/slate-500 (washed out on dark) to text-emerald-400/slate-400 (vibrant).' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-h-selfstat-contrast.js — 13 assertions covering the rewrite + 3 regression guards (no pastel bg-*-50, no text-*-700 value class, accent-color map covers all 9 tones).' },
      { superAdminOnly: true, text: 'TEST CLEANUP: brittle prior tests updated to allow the v55.82-H change: test-v55-81-contrast-sweep skips WhatsNewWidget.jsx (BUILD_HISTORY contains historical className references in descriptive prose); test-v55-82-f-nadia-treasury-overlap regex changed from `(?:F|G)` to `[A-Z]` so future build-letter bumps don\'t break it.' },
      { superAdminOnly: true, text: 'QA: 123 pass / 30 fail. Zero regressions vs v55.82-A baseline.' },
    ],
  },
  {
    version: 'v55.82-G',
    date: '2026-05-11',
    label: 'Shipping import Replace/Update modes + yellow-on-yellow contrast fix',
    items: [
      // PUBLIC
      'SHIPPING RATE IMPORT NOW HAS THREE MODES: Add, Update, Replace. Picked via radio buttons in the import preview screen. Add (default) just inserts every row as new. Update finds existing rows with the same vendor+route+container+effective date and fills in missing fields without erasing anything. Replace finds matching rows, deletes them, and writes the file row in their place — file is the source of truth.',
      'EACH MODE SHOWS A PLAIN-LANGUAGE EXPLAINER above the Import All button so you can see exactly what will happen before you commit. The explainer panel is color-coded — green for Add, blue for Update, rose for Replace (so Replace stands out as the destructive one).',
      'YELLOW-ON-YELLOW CONTRAST FIXED EVERYWHERE. Amber-on-amber badges and warning banners across the app (CRM tags, Treasury Instapay pill, ticket retest badges, shipping REQUESTED badge, customs ETA chip, settings labels, performance summaries, HR Desk warnings, etc.) were rendering pale-yellow text on a pale-yellow background. Two underlying causes were both removed: a global style rule that was forcing amber text to a pale color, and the use of light-amber text shades on light-amber backgrounds. All amber pills now render dark-brown text on a light-amber background — high contrast, easy to read.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'IMPORT MODE #1: ShippingRatesTab.jsx — added importMode state (default "add"). Three-radio selector rendered next to Cancel/Import All in the preview action bar. Plain-language explainer panel sits below the action bar, conditional styling by mode.' },
      { superAdminOnly: true, text: 'IMPORT MODE #2: executeImport rewritten to branch on importMode. Match key = (vendor_name + origin + destination + container_type + effective_date), all lowercased/trimmed. UPDATE path: bulk-fetches existing rows scoped to .in() vendor/origin lists, indexes by composite key, partitions import into matched/unmatched, patches matched rows with only non-blank fields (also skips zero values on fee fields to avoid overwriting real fees with import default-0), inserts unmatched. REPLACE path: deletes matched rows by id in one bulk delete, then bulk-inserts matched+unmatched together. Both paths fall back to the missing-column retry logic for resilience. ADD path preserved verbatim.' },
      { superAdminOnly: true, text: 'IMPORT MODE #3: Mode included in audit_log new_values + summary alert. Replace mode aborts the entire import if the delete step fails (no half-applied state). Both Update and Replace report inserted/updated/replaced counts in the success alert.' },
      { superAdminOnly: true, text: 'CONTRAST #4 (root cause): globals.css had three overrides forcing amber text/background pairs to pale-yellow colors regardless of JSX className: (a) `.bg-amber-100 { color: #fde68a }` — produced #fde68a text on a pale amber pill (yellow-on-yellow), (b) `.text-amber-600, .text-amber-700 { color: #fbbf24 }` — overrode JSX text color globally, (c) `.text-amber-800, .text-amber-700 { color: #fde68a }` — same issue. Removed all three overrides; JSX className now decides text color.' },
      { superAdminOnly: true, text: 'CONTRAST #5 (mass promotion): grep+sed across src/ promoted every `text-amber-700`, `text-amber-800`, `text-yellow-700`, `text-yellow-800` className to `-900` variant. 134 occurrences updated. Amber-900 (#78350f) on amber-50 (#fffbeb) is contrast ratio ~10.5:1, passes WCAG AAA. Same for yellow-900 on yellow-50.' },
      { superAdminOnly: true, text: 'QA: 121 pass / 30 fail full sweep, zero regressions vs v55.82-A baseline. Brittle test scaffolding patched in test-v55-75 (3 amber-800 assertions → amber-(?:800|900)), test-v55-77 (5 same), test-v55-81 (1 message-prefix assertion), test-v55-82-f (header-badge pin → F|G).' },
      { superAdminOnly: true, text: 'NOTE: Build stamps bumped header badge + Treasury modal headers from v55.82-F to v55.82-G. If Max\'s dashboard still shows v55.81 after deploying THIS zip, that\'s a deploy-pipeline / Vercel cache / hard-refresh issue, not a code issue — the source is correct.' },
    ],
  },
  {
    version: 'v55.82-F',
    date: '2026-05-11',
    label: 'Nadia must not interfere with Treasury workflow',
    items: [
      // PUBLIC
      'NADIA NOW STAYS ON THE RIGHT SIDE OF THE SCREEN — never covers the Treasury form. The collapsed pill and the expanded panel both anchor to the bottom-right corner now, leaving the entire left and center of your screen free for whatever you\'re working on.',
      'NADIA IS DISABLED BY DEFAULT IN TREASURY. When you open the Treasury tab she stays out of your way. She only comes back when you explicitly tap the new "🤖 Wake Nadia" button next to the Export button. There\'s also a "😴 Sleep Nadia" button to send her away again without leaving the tab.',
      'EVERY VISIT TO TREASURY STARTS WITH NADIA SUPPRESSED. Even if you woke Nadia last time you were in Treasury, leaving and coming back resets her to suppressed — you have to tap Wake Nadia again. So she can never sneak back in unannounced.',
      'NADIA NEVER POPS UP WHILE YOU\'RE ENTERING A TRANSACTION. Whenever the Add Transaction dialog (or the order#-not-found dialog, or the duplicate-confirm dialog, or the Edit dialog) is open, Nadia is hidden across the whole app — even if you\'d woken her up. Any speech she\'s in the middle of is cancelled the instant the dialog opens, so she doesn\'t talk over your data entry.',
      'NADIA\'S EXPANDED CHAT PANEL IS NARROWER. Capped at 360px wide on tablets/desktop, 90% of screen width on phones. Even if you wake her, she physically cannot cover the whole form — there\'s always room next to her to keep working.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'POSITIONING #1: NadiaFloatingOverlay.jsx — moved collapsed pill from `bottom: 76, left: 16` to `bottom: 76, right: 16`. Phone FAB lives at `bottom-4 left-4` so right side is uncontested. Expanded panel matched: `position: fixed, bottom: 76, right: 16, zIndex: 9998, width: min(360px, 90vw)`. Old `width: calc(100vw - 96px)` (which on a 360px phone was 264px ≈ full screen) replaced.' },
      { superAdminOnly: true, text: 'SUPPRESSION #2: page.jsx — already had `suppressNadia = anyTreasuryModalOpen || inTreasuryAndNotWoken` and was passing `suppressed={suppressNadia}` to NadiaFloatingOverlay. anyTreasuryModalOpen covers all 4 modals (showAddTreasury, pendingTreasuryRecord, duplicateConfirm, editTreasuryModal). Overlay\'s suppressed branch returns <NadiaSuppressedKiller /> which (a) cancels speechSynthesis + audio elements, (b) calls setExpanded(false), (c) returns null. AIGreeter is not mounted at all under suppression — no tab-greeting / TTS / Whisper effects can fire. CRITICAL: this code existed in working dir before this session but had NEVER been shipped in any zip Max received. v55.82-A baseline mounts the overlay with zero suppression.' },
      { superAdminOnly: true, text: 'WAKE BUTTON #3: page.jsx Treasury tab toolbar (next to Export) — `🤖 Wake Nadia` button rendered when `greeterSettings.enabled && !greeterDismissed && !nadiaWokenInTab.treasury`. Click → setNadiaWokenInTab(prev => ({...prev, treasury: true})). Sibling `😴 Sleep Nadia` button rendered when woken — drops the flag. Both pre-existed in working dir.' },
      { superAdminOnly: true, text: 'TAB-CHANGE RESET #4: page.jsx — NEW useEffect on [tab] that drops nadiaWokenInTab.treasury whenever tab !== "treasury". The comment on the state declaration promised this reset but no effect was actually wired. Without it, click Wake → leave Treasury → return Treasury found Nadia still woken, violating the default-suppressed spec. Now: every fresh entry to Treasury starts in suppressed mode.' },
      { superAdminOnly: true, text: 'WHY MAX SAW THIS: he is running the v55.82-A production baseline which has none of the suppression code. v55.82-B/C/D/E zips also did not ship the suppression — it lived only in working dir until this build.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-f-nadia-treasury-overlap.js — 23 assertions across the 5 spec items. Includes regression guards on (a) collapsed pill block no longer references left: 16 in style values, (b) expanded panel no longer uses calc(100vw - 96px) as a runtime style (comment-stripping regex used to ignore the historical reference in the migration comment). Updated test-s15-ui-uncollect-context.js S15.D2 to accept the IIFE wrapping that the suppression-computing block introduced (was pinned to direct <NadiaFloatingOverlay mount).' },
      { superAdminOnly: true, text: 'QA: 121 pass / 30 fail full sweep. Zero regressions vs v55.82-A baseline (the same 30 baseline failures, all unrelated to Nadia/Treasury). Build syntax check clean (133 files).' },
    ],
  },
  {
    version: 'v55.82-E',
    date: '2026-05-11',
    label: 'Treasury submission stabilization — amount parsing + modal freeze + recalc-failure recovery',
    items: [
      // PUBLIC
      'TREASURY NOW ACCEPTS AMOUNTS THE WAY YOU TYPE THEM. Before, typing "5,000" with a comma, "5 000" with a space, or "٥٠٠٠" using the Arabic keyboard would silently save the wrong amount (or nothing at all). The form looked like it accepted your input, but the saved row was empty. Fixed across Cash In, Cash Out, Bank In, Bank Out, invoice creation, invoice edits, check entry, and warehouse expenses.',
      'TREASURY TRANSACTIONS NOW SAVE PROPERLY EVEN WHEN THE INVOICE TOTAL CAN\'T REFRESH IMMEDIATELY. The transaction itself is what matters — the row gets recorded, you see the success toast, the form clears. If for any reason the linked invoice\'s collected total can\'t recalculate right then (network blip, permission glitch), you\'ll get a "Saved ✓ — invoice may need a manual refresh" message instead of a confusing error. Hit Fix Links if it does.',
      '"+ NEW TRANSACTION" BUTTON CAN\'T GET STUCK ANYMORE. Clicking it now resets every leftover dialog flag from a previous attempt before opening. The "I click it and nothing happens, have to refresh the whole page" problem is gone — every click starts clean.',
      'CANCEL AND CLOSE BUTTONS CLEAN UP COMPLETELY. Closing the New Transaction dialog (Cancel button, X button, or tapping outside) now wipes every related state flag, not just the form. So whatever you do next opens cleanly.',
      'SAVE BUTTON SHOWS "SAVING…" AND DISABLES ITSELF WHILE THE TRANSACTION IS BEING WRITTEN. No more wondering "did it work?" on a slow connection, and no more accidental double-saves from impatient tapping.',
      'IF SAVE FAILS, THE ERROR STAYS PINNED AT THE TOP OF THE FORM. Used to be a corner toast that disappeared in 2 seconds — easy to miss on mobile. Now the message stays visible until you fix it or close the dialog, and tells you to check the transaction list before retrying in case the row already saved.',
      'CATEGORIZATIONS, ORDER NUMBERS, AND CUSTOMER LINKS UNCHANGED. None of the working pieces were touched — same validation, same auto-link, same duplicate detection. Only the parts that were actually broken were rewritten.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'ROOT CAUSE #0 (amount parsing — primary regression): handleAddTreasury (and 5 sibling money-saving handlers) used Number(formData.amount) to parse the typed amount. Number("5,000") = NaN, Number("٥٠٠٠") = NaN, Number("5 000") = NaN. The validation gate `Number(...) <= 0` evaluates to FALSE for NaN (NaN <= 0 is always false in JS), so the form passed validation and then wrote NaN/0 to cash_in. Postgres either rejected the insert or coerced NaN to 0 depending on column path. Either way, Max\'s typed amount was lost.' },
      { superAdminOnly: true, text: 'FIX #0: NEW src/lib/utils.js exports — parseAmount(raw) and isValidAmount(raw). parseAmount normalizes Arabic-Indic (٠-٩) and Persian/Urdu (۰-۹) digits to ASCII, strips ASCII + non-breaking whitespace, then handles both US (1,234.56) and EU (1.234,56) thousands/decimal conventions before calling Number(). Returns 0 (not NaN) on unparseable input so callers can do arithmetic safely. isValidAmount returns true only for parsed > 0. Applied at 10 call sites: handleAddTreasury validation+amt+dup-recovery, handleEditTreasury cash/bank/expected, handleAddInvoice validation+total, invoice edit modal, checks form, warehouse expense, sales-tab inline-invoice fallback, treasury pending-modal __newInvTotal. Bonus: parseNumberSmart in shipping-import-helpers.js gained the same digit normalization.' },
      { superAdminOnly: true, text: 'ROOT CAUSE #1 (silent-save-after-recalc-fail): handleAddTreasury auto-link branch called dbInsert THEN recalcInvoiceCollected with NO try/catch around the recalc. recalcInvoiceCollected does an internal dbUpdate to invoices.total_collected; if RLS, network, or any other DB error thrown there, control jumped to the outer catch at the END of handleAddTreasury. Row WAS already inserted with cash_in=5000 (or whatever amount). But the outer catch checked unique-violation only — for any other error it just fired toast.error and fell through. Local treasury state never updated, modal stayed open with form filled, user thought save failed, retried → got real duplicate.' },
      { superAdminOnly: true, text: 'FIX #1: recalcInvoiceCollected wrapped in its own try/catch inside the auto-link branch. Failure logs to console as `[treasury-add] insert succeeded but recalcInvoiceCollected threw` and shows toast.warning telling user to use Fix Links. Insert success path completes normally — modal closes, formData clears, treasury state appended.' },
      { superAdminOnly: true, text: 'ROOT CAUSE #2 (modal freeze): "+ New Transaction" button at line 9677 only set showAddTreasury=true and seeded formData. It did NOT clear pendingTreasuryRecord, duplicateConfirm, treasuryFormErrors, isCreatingInvoice, or createInvoiceError. The render gate evaluates `showAddTreasury && !pendingTreasuryRecord && !duplicateConfirm` — any of those left non-null from a prior incomplete flow blocked the new modal from rendering. Button looked dead. The catch block contributed to the stuckness — non-unique-violation errors used `toast.error` with no state cleanup.' },
      { superAdminOnly: true, text: 'FIX #2: "+ New Transaction" button now hard-resets all 5 modal-companion flags BEFORE setShowAddTreasury(true). Idempotent — clean if no stale state existed, recovery if there was. Same hard-reset logic added to: Modal onClose (X + backdrop), Cancel button, both success paths (auto-link, silent-save).' },
      { superAdminOnly: true, text: 'FIX #3 (re-entry guard): NEW useRef addTreasuryRunning + NEW useState treasurySaving. handleAddTreasury extracted into _handleAddTreasuryImpl; thin wrapper at the public name guards re-entry, sets the in-flight flag, and clears via try/finally so guard releases even on thrown error. Save button now disabled={treasurySaving} and renders "Saving… / جاري الحفظ" label.' },
      { superAdminOnly: true, text: 'FIX #4 (catch visibility): outer catch fires both toast.error AND setTreasuryFormErrors with the persistent red banner replacing the disappearing toast. User can\'t miss the failure on mobile anymore.' },
      { superAdminOnly: true, text: 'TESTS: __tests__/test-v55-82-e-amount-parsing-fix.js (60 assertions: 21 parseAmount unit + 9 isValidAmount + 18 source-shape + 9 e2e + 3 category preservation). __tests__/test-v55-82-e-treasury-stabilization.js (34 assertions covering modal-freeze, recalc-failure recovery, re-entry guard, and amount-mapping for every transaction type). Full QA: 120 pass / 30 fail. ZERO regressions vs v55.82-A baseline.' },
    ],
  },
  {
    version: 'v55.82-D',
    date: '2026-05-10',
    label: 'Critical priority + closed-ticket grey-out + two-stage shipping booking',
    items: [
      // PUBLIC
      'CLOSED TICKETS NOW LOOK CLOSED. Tickets with status = Closed are dimmed (light grey background, slate-grey left border, slightly faded) so your eye glides right past them. Hover one and it brightens back up so you can still read it. Open tickets keep their bright priority colors.',
      'NEW "CRITICAL" PRIORITY ABOVE HIGH. For tickets that need to be done within hours — not "today" (that\'s High), not "this week" (Medium). Critical uses a 🚨 icon and a deeper red. New dashboard card on the Tickets tab counts open Critical tickets at a glance. Voice-create now picks Critical when you say "emergency", "drop everything", or "right now".',
      'SHIPPING NOW HAS A TWO-STAGE BOOKING FLOW. Stage 1 — "📨 Request Booking" — opens a pre-filled email/WhatsApp message to the freight forwarder with the rate, route, container, customer, release#, and expected ship date. One click sends; the rate gets stamped "REQUESTED" with an amber badge. Stage 2 — "✅ Confirm Booking" — opens a modal where you enter the booking number the forwarder gave you (required), customer, our order#, customer release#, and expected ship date. On save, the rate flips to BOOKED and gets a gold ⭐ on the trend chart at the booked rate / booked date. Customer info from Stage 1 pre-fills Stage 2 — no retyping.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'TICKETS #1 (closed grey-out): TicketsTab.jsx ticket card className concatenation now branches on t.status === "Closed" → bg-slate-50 opacity-70 hover:opacity-100. Left border switches to slate-grey #94a3b8 instead of priority color. Open tickets keep bg-white + priority leftBorderColor.' },
      { superAdminOnly: true, text: 'TICKETS #2 (Critical priority): PRIORITIES const expanded from 3 to 4 entries. Critical: v=critical, c=#7f1d1d, icon=🚨, sla="within hours". priOrder map prefixed with critical:0 so it sorts to top of every list. Voice-recognition handler regex now /critical|emergency|drop everything|right now/i. Filter dropdown gained <option value="critical">. Dashboard summary card grid expanded to 5 columns (was 4) with the new Critical card on the left.' },
      { superAdminOnly: true, text: 'SHIPPING #3 (Request Booking flow): NEW state bookingRequestModal + handler handleRequestBooking. NEW generateBookingRequest(rate, vendor, customerName, orderNumber, releaseNumber, expectedDate) builds bilingual subject + body with full rate context. Modal renders 2x2 grid of customer/order/release/expected inputs + editable message preview. Action buttons: Email (uses vendor.email), WhatsApp (uses vendor.whatsapp), Copy & Mark Requested (clipboard fallback). All three call submitBookingRequest which stamps booking_requested=true + booking_requested_at + booking_requested_customer + booking_requested_order + booking_requested_release + booking_requested_expected_date. Schema-missing graceful degrade in catch block.' },
      { superAdminOnly: true, text: 'SHIPPING #4 (Confirm Booking flow): NEW state bookingConfirmModal + handler handleConfirmBooking. Modal pre-fills customer/order/release/expected from rate.booking_requested_* if present. Booking Number input is required (autoFocus + disabled save until typed). finalizeBookingConfirm inserts shipping_bookings row (rate_id + shipment_reference + customer_name + order_number + booking_date + composite notes string carrying release# and expected ship date) AND stamps shipping_rates with booked=true + shipment_reference + booking_date + booking_notes + booking_requested=false. Both writes happen in series with shared error handling.' },
      { superAdminOnly: true, text: 'SHIPPING #5 (rate-row UI): rates table now shows three booking states: ✓ BOOKED (green badge with ref + date), ⏳ REQUESTED (amber badge with customer + request date), or — (slate). Action column grows two new buttons that conditionally render: "📨 Request Booking" when !exp && !booked && !booking_requested; "✅ Confirm Booking" when !exp && !booked. So a fresh active rate shows BOTH (forwarder might have given you a number on the spot — skip the request, go straight to confirm).' },
      { superAdminOnly: true, text: 'SCHEMA: NEW migration migrations/v55.82-d-shipping-booking-requested.sql adds 6 columns idempotently to shipping_rates: booking_requested BOOLEAN, booking_requested_at TIMESTAMPTZ, booking_requested_customer TEXT, booking_requested_order TEXT, booking_requested_release TEXT, booking_requested_expected_date DATE. Safe to skip — handler logs warning + continues if columns missing. Run before deploy for the REQUESTED badge to appear.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-d-tickets-and-booking.js — 44 assertions covering all five fixes plus regression guards. test-s15-ui-uncollect-context.js S15.T3 brittle regex updated to accept either bare leftBorderColor (legacy) or the closed-ticket ternary (v55.82-D).' },
    ],
  },
  {
    version: 'v55.82-C',
    date: '2026-05-10',
    label: 'Shipping import (Other Fees Description) + rewritten trend chart with booking stars',
    items: [
      // PUBLIC
      'SHIPPING IMPORT NOW CAPTURES THE "OTHER FEES DESCRIPTION" COLUMN. The template has had a column for the surcharge label (BAF, CAF, ISPS, etc.) since the start, but the import was dropping it on the floor every time. Now the label rides with the rate so when you see the surcharge later you know what it was for.',
      'RATE TREND CHART REWRITTEN. The chart on each route\'s detail page now shows the BEST price of any forwarder for each period — instead of the average. Average smeared one expensive outlier into your floor; this shows the actual lowest price you could have booked.',
      'CHART X-AXIS NOW USES EXPIRATION DATE. Rates are bucketed by the month they EXPIRED, not the month they took effect. That\'s how forwarders quote ("good through end of June") and the right shape for negotiating renewals.',
      'BOOKING STARS ON THE CHART. Every time you booked a rate, a gold ⭐ appears on the chart at the price you booked at, on the month you booked. Multiple bookings = multiple stars. Hover the star to see the vendor, reference number, and exact date.',
      'PERIOD-OVER-PERIOD COMPARISON USES BEST PRICE TOO. The "↗ ↘" banner above the chart now compares the lowest price in the current window vs the lowest price in the prior window of the same length. Matches what the chart shows so the two never disagree.',
      'EMPTY FIELDS NO LONGER BREAK THE CHART. Rows with no expiry date or zero rate are dropped from the trend (we can\'t plot what doesn\'t have an end date). Bookings with no booking date or zero rate are dropped from the stars layer. No more chart crashes from messy import data.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'IMPORT #1: ShippingRatesTab.jsx — added otherFeesDesc to colMap in BOTH processImportFile and reparseFromMapping. Keyword list: "other fees description" / "other fees desc" / "other fees label" / "fee description" / "surcharge label" / "surcharge description". Excludes "amount" + "value" so it doesn\'t grab the numeric column. baseFields now writes other_fees_desc via getVal(row, colMap.otherFeesDesc). Mapping UI label list updated so users can remap if auto-detect missed it.' },
      { superAdminOnly: true, text: 'IMPORT #2: New migration migrations/v55.82-c-shipping-other-fees-desc.sql. ALTER TABLE shipping_rates ADD COLUMN IF NOT EXISTS other_fees_desc TEXT. Idempotent. Run before deploy. If skipped, executeImport\'s retry-without-missing-column loop strips it and the rest of the import still succeeds.' },
      { superAdminOnly: true, text: 'CHART #1 (X-axis): trendRates filtering now anchors to (r.expiry_date || r.effective_date) for both the rateHistoryDf/Dt clamps. monthsSet built from r.expiry_date.substring(0,7). Rows missing expiry_date are excluded from validRatesForChart entirely.' },
      { superAdminOnly: true, text: 'CHART #2 (best price): per-line aggregation switched from sum/length to Math.min.apply(null, amounts). Overall "_avg" series renamed to "_best" with Math.min aggregation. Period-over-period priorAvg/currentAvg → priorBest/currentBest, also Math.min. Banner copy updated to "Period-over-period (best price)".' },
      { superAdminOnly: true, text: 'CHART #3 (booking stars): chart upgraded from <LineChart> to <ComposedChart> so <Scatter> can overlay <Line>. bookingStars array built from trendRatesForChart.filter(r => r.booked && booking_date.length>=7 && rate>0).map → {month, booked_rate, vendor, line, ref, container, full_date}. Custom 5-point StarShape SVG (gold #fbbf24 fill, brown #92400e stroke). Tooltip formatter shows "$2850 ⭐ MSC Egypt (REF-1234) — Booking 2025-03-12".' },
      { superAdminOnly: true, text: 'CHART #4 (NaN safety): validRatesForChart filter checks expiry.length>=7 && amt>0. Math.min calls all guarded by ratesForLine.length > 0 (Math.min on empty = Infinity, would render as a literal "Infinity" tick). StarShape returns null when cx/cy are null/NaN. Booking-month X-axis categories injected into trendPoints if not already there (Recharts can\'t plot Scatter on unknown categories). Empty-state message rewritten to point at missing expiry dates.' },
      { superAdminOnly: true, text: 'CHART #5 (recharts imports): added ComposedChart and Scatter to the import line at top of ShippingRatesTab.jsx — both already in the recharts dependency, no package.json change needed.' },
      { superAdminOnly: true, text: 'TEST: __tests__/test-v55-82-c-shipping-import-and-chart.js — 31 assertions covering all six fixes plus regression guards (no avg-aggregation pattern, no effective_date X-axis pattern). Updated test-v55-33-calendar-shipping-fixes.js to accept either priorAvg/currentAvg (legacy) or priorBest/currentBest (v55.82-C) so the period-over-period assertion isn\'t coupled to the aggregation method.' },
    ],
  },
  {
    version: 'v55.82-B',
    date: '2026-05-10',
    label: 'Treasury workflow QA + Three UI bugs (yellow-on-yellow, active glow, random blinking)',
    items: [
      // PUBLIC
      'TREASURY EDIT NOW LINKS TO THE INVOICE WHEN YOU ADD AN ORDER NUMBER. Used to be: you forget to type the order# on a Cash IN, save it, then come back and edit to add it. Save would write the order# but the row stayed unlinked — the invoice\'s outstanding never moved. Now: typing an order# in edit mode looks up the matching invoice and links it on save. You\'ll see a "Saved + linked to [Customer]" toast, and the invoice\'s collected/outstanding updates immediately.',
      'TREASURY EDIT FORM NOW SHOWS WHO YOU\'LL LINK TO BEFORE YOU SAVE. Below the order# field there\'s now a live indicator. If the number matches an invoice it shows "✓ Will link to [Customer] — [amount]". If it doesn\'t match any invoice it shows an amber warning. If it\'s blank it tells you the row will save unlinked. No more guessing whether you typed the right number.',
      'TREASURY ERROR POPUPS REPLACED WITH NORMAL TOAST MESSAGES. The save / delete / unlink buttons used to throw a system-level browser pop-up on failures (the kind that looks like a website error). Now they show the same calm toast notifications as the rest of Treasury.',
      '"INCOME NEEDS ORDER NUMBER" MESSAGE IS NO LONGER A FLEETING TOAST. Trying to save Cash IN without an order# (and no override category) now shows a persistent red box at the top of the form with the exact field highlighted. Used to disappear in 2 seconds — easy to miss on mobile.',
      'INLINE INVOICE CREATION HANDLES "ALREADY EXISTS" GRACEFULLY. If you create an invoice from the Treasury "Order # not found" dialog and a duplicate cash entry already exists in the database, you now get a plain-language message ("invoice was saved to Sales — to finish, find the existing treasury row and link it") instead of a raw database error.',
      'HR DESK "FILE A REQUEST" CARD IS NOW READABLE. Was yellow text on a yellow gradient — basically illegible from any angle. Now: white card surface, near-black text, thick amber accent border. Same readable treatment for the "File a Concern" sibling. Tested on light + dark wallpapers, both phone and desktop.',
      'ACTIVE ASSISTANT NOW HAS A VISIBLE GLOW THAT BREATHES. Used to be: the active persona looked the same as inactive ones — no visual cue you\'d picked one. Now: the active tile has a soft colored glow that gently pulses while idle, and a stronger faster pulse while she\'s actually speaking. Each persona uses her own color (Nadia indigo, Jenna rose, Sara cyan).',
      'NO MORE RANDOM SYNCHRONIZED BLINKING ON THE THREE AVATAR TILES. They were flickering on every dashboard re-render. The fix swaps a too-broad CSS transition for a narrow one (transform + opacity only), so the glow and tile changes can\'t fight each other anymore.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'TREASURY #1 (root cause Max reported): handleSaveTreasuryEdit now detects order_number changes vs original, looks up matching invoice via invoices.find on trimmed order#, sets updates.linked_invoice_id accordingly. Recalcs both old (if relinking away) and new (if newly linked OR money fields changed) via recalcInvoiceCollected. Toast variants: "Saved + linked to X ✓" / "Saved — but order # X does not match any invoice. Row is unlinked." / "Saved — order# cleared, row unlinked."' },
      { superAdminOnly: true, text: 'TREASURY #2: finalizePendingTreasury catch now distinguishes Postgres 23505 (duplicate key value / unique constraint) from generic errors. On 23505, sets a friendly bilingual createInvoiceError explaining the invoice WAS saved to Sales but a matching cash entry exists, with recovery action (close dialog, find existing row, click link button). Non-23505 errors still surface raw message as before.' },
      { superAdminOnly: true, text: 'TREASURY #3: handleAddTreasury validation block now collects "Income needs Order #" as a banner-level error (treasuryFormErrors entry with field=\'orderNumber\'). Honors same non-order income category exception (Refund / Owner Contribution / Loan / Owner Draw / Inter-Bank Transfer / Bank Fee + Arabic equivalents استرداد / سلفة / إيداع المالك / قرض / دخل آخر). Downstream check at the silent-save gate kept as safety net.' },
      { superAdminOnly: true, text: 'TREASURY #4: Edit modal Order# input now renders an IIFE-computed live link-status chip below the field. Empty → slate text "row will be saved unlinked". Match → emerald chip "Will link on save" + customer + total. No-match → amber warning "No matching invoice. Save will succeed but row will stay unlinked."' },
      { superAdminOnly: true, text: 'TREASURY #5: handleSaveTreasuryEdit / handleDeleteTreasury / unlinkTreasury catch blocks now use toast.error wrapped in defensive try/alert fallback (matches the linkTreasuryToInvoice / handleEditTreasury pattern). Native window.alert() removed from these three paths.' },
      { superAdminOnly: true, text: 'TREASURY #6: closePendingTreasuryModal helper now also strips __newInvCustomerAutoLinked and __newInvSearch from formData. Was leaving these to leak across modal closes; could cause a stale "Auto-linked — confirm or pick another" chip to reappear on a fresh attempt.' },
      { superAdminOnly: true, text: 'TREASURY #7: test-treasury-add-flow.js simulator updated to match real handleAddTreasury blocking behavior (was claiming silent-save for income+no-order#, real code blocks). Tests 1d/1e flipped to expect rejected branch; new 1f/1g cover the category-override bypass for English and Arabic category names.' },
      { superAdminOnly: true, text: 'UI #1 (yellow-on-yellow QA-22): MyHRDesk.jsx — both quick-action buttons (File a Request, File a Concern) rewritten. Card surface bg-gradient-to-br from-amber-50/from-rose-50 → bg-white. Title text-amber-900/text-rose-900 → text-slate-900. Subtitle text-amber-900 → text-slate-700 + font-semibold. Border border-amber-200/border-rose-200 → border-2 border-amber-500/border-rose-500 for action distinction.' },
      { superAdminOnly: true, text: 'UI #2 (active glow QA-23): AssistantsBar.jsx — root cause was inline `boxShadow: isActive ? props.activeGlow` ALWAYS winning over .ktc-assistant-speaking keyframe (inline > class). Removed inline boxShadow entirely. New activeClass var = (isSpeaking ? "ktc-assistant-speaking" : isActive ? "ktc-assistant-active" : ""). globals.css now has TWO keyframes — ktcAssistantActiveBreath (4.5s slow soft pulse) + ktcAssistantSpeakingPulse (1.4s deeper pulse, preserved). Both consume --ktc-glow-color so per-persona color preserved.' },
      { superAdminOnly: true, text: 'UI #3 (random blinking): AssistantsBar.jsx Tile className — `transition-all duration-300` was animating box-shadow on every isActive flip while the keyframes also animated box-shadow → constant fight, visible flicker on all three tiles every parent re-render. Narrowed to `transition-[transform,opacity] duration-300`. Both keyframes verified to ONLY animate box-shadow (no transform / opacity / background) so React state-driven transitions and CSS keyframes can no longer collide.' },
    ],
  },
  {
    version: 'v55.82',
    date: '2026-05-09',
    label: 'QA-pass + Shipping Historical + Cross-device Memory + Crisis Detection',
    items: [
      // PUBLIC
      'SHIPPING RATES NOW SHOWS HISTORICAL ROUTES IN A SEPARATE SECTION. Used to be: open the rates page, expired ones got mixed in with active ones. Now: active rates show first, then a clearly-labeled "Historical Rates" section below at reduced opacity. Hover over a faded one to brighten it back up. Three-button toggle at the top — Active / Historical / Both — and your choice now sticks across reloads.',
      'SHIPPING RATES NOW SORT ALPHABETICALLY BY DESTINATION. Before, busy routes sat at the top because the sort was by count. Now it\'s alphabetical so finding a specific destination is faster.',
      'NEW "RELOAD FOR LATEST" BUTTON IN THE WHAT\'S-NEW POPUP. If you\'ve had the dashboard tab open for a while and you\'re not sure if you\'re seeing the freshest version, click the button at the bottom of the popup. It actually busts the browser cache (not just a regular refresh) so you pick up newer builds. If you\'ve been typing in an HR form, it\'ll warn you before reloading so you don\'t lose your draft.',
      'BUILD VERSION + FRESHNESS NOW VISIBLE. The dashboard pill ("v55.82 · 2 days ago") and the bottom of the popup both tell you which build you\'re on and how recent it is. So if a teammate says "the new feature isn\'t working for me," you can immediately tell whether you\'re on the same build.',
      'CONVERSATIONS WITH NADIA / JENNA / SARA NOW SYNC ACROSS YOUR DEVICES. Used to be: chat with Nadia on your laptop, switch to your phone, history was empty. Now: the conversation tail (last 80 messages per persona) is saved and shows up wherever you log in.',
      'HR CONCERNS THAT MENTION SELF-HARM OR DANGER NOW SURFACE PROFESSIONAL RESOURCES. If your text suggests you\'re in crisis, the system shows hotline numbers (988 in the US, Behman Hospital in Egypt) right after submission, and tags the concern as critical so Mr. Kandil sees it elevated. Submission still goes through normally — the resources are additional, not a gate.',
      'SARA NOW SHOWS A FRIENDLY EMPTY-STATE WHEN YOU HAVE NO ACTIVITY. Used to be: open Sara\'s panel for a slow week, see a wall of zero tiles. Now: Sara says "No activity in this period" and points you at trying a longer time range.',
      'PIPELINE CARD NOW EXPLAINS ITSELF WHEN EMPTY. If you have no clients assigned to you yet, the Pipeline card now shows a friendly message explaining what the section is, instead of seven empty zero-pills.',
      'NEW EMPLOYEE RANKINGS ON ADMIN. Pick a metric, get a top-three list with medals. Login Consistency card shows "logged in N out of 6 expected work days" with a percentage.',
      'TEAM / INDIVIDUAL VIEW IN ADMIN. Pick a person from the dropdown — admin scorecards filter to just that person. Eight-card grid of login stats. Shows date ranges in plain English ("Today — Saturday, May 9, 2026 (ET)").',
      'CONTRAST FIXES. Several status badges that were yellow-on-yellow now read cleanly. Small text on light backgrounds got bumped to a darker shade.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'QA-1 + QA-2 (Reload button): plain location.reload() does NOT bypass the browser cache. Updated to use location.href = pathname + "?_v=" + Date.now() for hard cache-bust. Added confirm dialog when textarea content > 10 chars detected (or [data-ktc-draft-active="true"] marker present). HR Desk textareas now carry the marker.' },
      { superAdminOnly: true, text: 'QA-3 + QA-9 (Sara empty-state): refactored anyActivity from duplicated 14-field IIFE sums into a single useMemo (hasAnyActivity). Added missing meetingsCreated + meetingsCheckedIn signals — without them, a user who only set up meetings would falsely see the empty state.' },
      { superAdminOnly: true, text: 'QA-4 + QA-5 (Shipping historical): "Active Rates" header now shows whenever filterExpiry === "all" (was hidden when historical bucket was empty, making "Both" mode look identical to "Active" mode). List view dividers now have border-t-2 for consistent banding.' },
      { superAdminOnly: true, text: 'QA-6 (filterExpiry persist): wraps useState in a function that reads localStorage["ktc_shipping_filter_expiry"]; setFilterExpiryPersist writes on every change. Default still "active" for new users.' },
      { superAdminOnly: true, text: 'QA-7 (pipeline guard relaxed): outer condition now `myCustomers.length>0 || isAdmin || (Array.isArray(customers) && customers.length>0)` so a regular team member with CRM access but zero assigned customers sees the empty-state.' },
      { superAdminOnly: true, text: 'QA-12 (colSpan magic): replaced bare `colSpan={13}` with `colSpan={LIST_COL_COUNT}`. Defined as 13 inside the IIFE that builds the rows; column-count change requires updating one place.' },
      { superAdminOnly: true, text: 'QA-13 (NaN guard): SelfStat for Customer Touches now uses `(current.contactTouches || 0) + (current.pipelineMoves || 0)` so undefined fields show 0, not NaN.' },
      { superAdminOnly: true, text: 'QA-14 (auth boundary): /api/ask now imports requireUser from src/lib/phone-auth and validates body.userId === session.user.id. Returns 403 on mismatch. Soft-mode during rollout — if no session present, logs warning but doesn\'t hard-fail (some clients haven\'t refreshed yet). Closes the longstanding userId-spoofing audit gap from the v55.79 whitepaper.' },
      { superAdminOnly: true, text: 'QA-15 (rate limit): /api/ask now calls checkRateLimit(userId, "ask") at request entry. 120 calls per user per hour. 121st returns 429 with retry-time message. Caps Anthropic cost-runaway from a buggy or malicious client.' },
      { superAdminOnly: true, text: 'QA-16 (cross-device chat): NEW migration v55.81-qa16-conversation-logs.sql creates `conversation_logs (user_id, persona, messages, ...)` with composite PK. NEW endpoint /api/conversation-log GET validates session + returns byPersona buckets. /api/ask persistConversationTurn helper writes after every successful turn. AIGreeter sends agentKey in payload. page.jsx hydrates from server on cold load and merges with localStorage (longer wins per persona). Trim cap matches localStorage 80-message rolling window.' },
      { superAdminOnly: true, text: 'QA-17 (crisis detection): NEW src/lib/crisis-detection.js — heuristic regex matcher for self-harm / threat / distress patterns (case-insensitive, word-bounded). NEW migration v55.81-qa17-crisis-flag.sql adds crisis_flag column to hr_complaints with CHECK constraint. MyHRDesk runs detector on submit, auto-bumps severity (self_harm → critical, threat/distress → high if not already critical), surfaces overlay with 988 + Behman Hospital + Befrienders Cairo + 988 + 122 emergency. Defensive insert: retries without crisis_flag column if migration not yet applied.' },
      { superAdminOnly: true, text: 'QA-18 (prompt injection): NEW sanitizeFreeText helper in /api/ask. Strips role-prompt prefixes (SYSTEM:/USER:/ASSISTANT:/HUMAN:) → renames to FIELD-suffix, replaces 3+ dashes / equals with single chars, strips invisible unicode tag chars (U+E0000-U+E007F), redacts "ignore prior instructions" phrase variants. Applied to customer.name_en, customer.name, c.industry, c.group_name, t.title, v.company_name, v.contact_name. Defense-in-depth on top of the model\'s built-in injection resistance.' },
      { superAdminOnly: true, text: 'QA-19 (model fallback): /api/ask now tries claude-sonnet-4-20250514 first, falls back to claude-haiku-4-5-20251001 on non-2xx or thrown error. Loop covers both the briefing path (gMessages) and the main /ask path (messages). Logs which model served when fallback used. Eliminates the single-Anthropic-point-of-failure flagged in whitepaper section 9.5.' },
      { superAdminOnly: true, text: 'QA-pass test suite: NEW __tests__/test-v55-81-qa-fixes.js (62 assertions) covers all 18 actionable findings + functional probes for the crisis detector + SWC-constraint check (no template literals / let / const in new API code). Earlier v55.81 tests updated to reflect refactors (useMemo, persisting setter, cache-bust button). 240/240 v55.81 assertions green; zero v55.80 regressions across 20+ test files.' },
      { superAdminOnly: true, text: 'Build stamp bumped from v55.81-CHECKPOINT-1 to v55.82.' },
    ],
  },
  {
    version: 'v55.79',
    date: '2026-05-08',
    label: 'Voice Parity — Animated Avatars + Audio-Reactive Rings',
    items: [
      // PUBLIC
      'JENNA AND SARA NOW LOOK ALIVE WHEN THEY TALK. Before this build, only Nadia had an animated face — Jenna and Sara just had static photos with a colored ring. Now all three personas have living avatars that pulse with their actual voice. When Jenna or Sara speaks, concentric colored rings ripple outward from her photo in real time, driven by the actual audio amplitude. When she\'s listening, a red breathing ring appears. When she\'s thinking, three small dots appear beneath her. Same visual aliveness Nadia has, just adapted to use the real photos instead of an illustrated face.',
      'SUBTLE BREATH WHEN IDLE. Even when no one is speaking, all three avatars now have a barely-noticeable breath animation — they don\'t look frozen anymore. It\'s a small thing but makes the dashboard feel more alive.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'NEW COMPONENT: src/components/PortraitAvatar.jsx (~285 lines). Audio-reactive overlay for any persona photo. Mirrors NadiaFace\'s hardened AudioContext + AnalyserNode pattern (createMediaElementSource → analyser.getByteTimeDomainData → RMS → amplitude 0..1). Concentric rings scale + opacity-modulate with amp. Photo subtly scales with amp. Listening state uses red breathing ring (avatar-listening-pulse CSS class — added to globals.css). Loading state uses pulse dots. Idle uses sine-wave breath animation.' },
      { superAdminOnly: true, text: 'DEFENSIVE DOUBLE-HOOK GUARD (caught in QA): createMediaElementSource throws InvalidStateError if called twice on the same audio element. NadiaFace marks elements with __nadiaHooked. PortraitAvatar marks them with __portraitHooked. If either marker is set, falls back to procedural shimmer instead of crashing. Mobile autoplay-suspended AudioContext gets ctx.resume() before analyser wiring.' },
      { superAdminOnly: true, text: 'AIGreeter conditional render: activeAgentKey === "nadia" → NadiaFace (existing illustrated SVG with lip-sync); else → PortraitAvatar with persona\'s photo + uiColor. Same speaking/listening/loading/audioElement props for both — drop-in compatible API.' },
      { superAdminOnly: true, text: 'NEW CSS in globals.css: @keyframes avatarListeningBreath (1.4s ease-in-out infinite, scale 1.0↔1.08 + opacity 0.85↔1.0). The .avatar-listening-pulse class binds it. Also new: @keyframes avatar-loading-dot (in PortraitAvatar inline style block). 26 new tests in test-v55-79-portrait-avatar.js, all green.' },
    ],
  },
  {
    version: 'v55.78',
    date: '2026-05-08',
    label: 'Voice Parity — Wake Words + Per-Persona History + Persona Persistence',
    items: [
      // PUBLIC
      'EACH ASSISTANT HAS HER OWN WAKE WORD. Before, only "Hey Nadia" worked. Now you can say "Hey Jenna" or "Hey Sara" and that persona becomes active automatically — even if you\'re currently talking to a different one. The wake-word also recognizes common mishearings the recognizer makes (Jenna ↔ Gina/Jenny/Jen, Sara ↔ Sarah, etc.) so you don\'t have to enunciate.',
      'EACH ASSISTANT HAS HER OWN MEMORY THREAD. Before, all three assistants shared one conversation log — so when you talked to Nadia about overdue tickets, then clicked Ms. Jenna, Ms. Jenna would see that whole conversation in her context and might respond confused. Now each persona has her own conversation thread. Talk to Nadia about tickets; Ms. Jenna only sees HR conversations; Sara only sees coaching conversations. Threads are saved across sessions.',
      'YOUR ACTIVE PERSONA STAYS WITH YOU. Before, every page reload reset to Nadia. If you mostly work with Sara for coaching, you had to re-click her every time. Now your last-active persona is remembered across reloads.',
      'AMBIENT NOISE CALIBRATION FOR VOICE CONVERSATIONS. Voice conversation mode used to use a fixed silence threshold — in noisy rooms it would never detect "you stopped talking" and stay recording forever. Now it spends the first ~600ms calibrating to your room\'s ambient noise, then sets a smarter threshold. Works in quiet offices and noisy ones.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'WAKE-WORD ROUTING: src/lib/voice/wake-word.js — WAKE_RE expanded to capture nadia/jenna/sara variants (incl. mishearings: gina, jeanna, jana, gianna, jenn, jenny, jen → jenna; sarah, sarra, sera, sarai → sara). VARIANT_TO_AGENT lookup table maps capture group → canonical agent ID. detectWakeWord() returns {matched, command, rest, agent}. Engine state tracks activeAgent across interim/final. New getActiveAgent() accessor. VoiceController emits agent in hey-bob-command event detail. AIGreeter handler reads detail.agent + dispatches ktc:assistant-changed if different from current.' },
      { superAdminOnly: true, text: 'CRITICAL RACE FIX (caught in QA): When wake-word switches persona AND issues a command in the same utterance ("Hey Jenna, file vacation"), the dispatched ktc:assistant-changed event triggers a React re-render to update activeAgentKey + sysPrompt + voiceId. But doSendRef.current still references the OLD persona\'s closure until that re-render completes. Without the fix, "Hey Jenna, vacation" would route to Nadia\'s brain. Fix: personaWillSwitch flag + setTimeout(doSend, 80) to defer the API call past the re-render. Same-persona wake stays synchronous (no defer needed).' },
      { superAdminOnly: true, text: 'PER-PERSONA HISTORY: page.jsx greeterMessagesByAgent state ({nadia:[], jenna:[], sara:[]}). Computed greeterMessages getter resolves the active slot. setGreeterMessages routes updates into [selectedAssistant] only. Functional updates supported. localStorage hydrates new shape (nadia.messages.byAgent.<uid>); legacy single-array (nadia.messages.<uid>) migrates to Nadia slot only. Each thread trimmed to last 80 entries on persist (~240 messages cap total). AIGreeter consumption unchanged — receives sessionMessages prop, transparent to it.' },
      { superAdminOnly: true, text: 'PERSONA PERSISTENCE: page.jsx selectedAssistant lazy-init reads ktc.lastPersona from localStorage. AssistantsBar openPanel uses the same key for hydration. Persisted on every change via useEffect. Both states stay in sync via the existing ktc:assistant-changed event bus (no new sync mechanism needed).' },
      { superAdminOnly: true, text: 'AMBIENT CALIBRATION: AIGreeter conversation-mode silence detector now collects RMS samples for the first CALIBRATION_MS (~600ms), takes the median (robust to coughs/clicks), multiplies by THRESHOLD_MULTIPLIER (1.8x), clamps to [FLOOR_THRESHOLD, CEILING_THRESHOLD], and assigns the result as SILENCE_THRESHOLD. Calibration phase early-returns from the monitor so silence trigger can\'t fire during it. lastVoice resets at calibration end so the user gets a clean head-start. Works in 0dB silent rooms and 30dB ambient-rumble rooms equally.' },
      { superAdminOnly: true, text: 'TEST COVERAGE: 1,344 total assertions across 53 suites. New: test-v55-78-wake-agent-routing.js (28 tests), test-v55-78-per-persona-history.js (11), test-v55-78-deferred-gaps.js (51 — wake routing + history + portrait avatar + persistence + calibration + carry-forward). Same 6 pre-existing v55.32/33 legacy stamp failures (unrelated).' },
    ],
  },
  {
    version: 'v55.77',
    date: '2026-05-08',
    label: 'A5 Stabilization + Persona Engine Wiring',
    items: [
      // PUBLIC
      'EACH ASSISTANT NOW SOUNDS LIKE HERSELF. Nadia, Ms. Jenna, and Sara each have their own distinct voice now (Nadia keeps her current voice; Jenna got a warm, empathetic voice; Sara got an energetic, encouraging voice). Before this build, all three spoke with the same voice — only the photos changed. Now the audio matches the personality.',
      'EACH ASSISTANT BEHAVES IN CHARACTER. Before, when you clicked Ms. Jenna and asked an HR question, you were really just talking to Nadia in a different photo. Now Ms. Jenna actually responds as HR (warm, supportive, focused on requests and concerns). Sara responds as a coach (energetic, growth-oriented). Nadia stays your operational right hand. Each one even knows when to redirect you — "for HR, check with Ms. Jenna" — instead of trying to handle everything.',
      'CLEAN HANDOFF WHEN YOU SWITCH. Before, switching personas while one was talking left the audio playing in the wrong voice + photo. Now switching cleanly stops the current audio, the recording, and conversation mode — the new persona starts fresh.',
      'STATE STAYS WITH YOU. If you start filling out an HR concern with Ms. Jenna and switch to Sara to check your stats, then come back to Ms. Jenna — your draft is still there. The form no longer wipes when you switch.',
      'SMOOTHER MR. KANDIL EXPERIENCE in the HR inbox: jargon like "anonymous to admins" cleaned up to "identity confidential". Status pills made readable. The cartoon HR mascot that used to overlap Ms. Jenna\'s real photo has been removed.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'A5 STABILIZATION (6 fixes from QA review): #3 AIGreeter outer-border + bubbles now derive from activeAgent.colors.primary not PERSONALITIES tone preset (uiColor variable, replaced 7 raw persona.color usages). #4 MyHRDesk + MyPerformance always-mounted via display:none so form drafts and Sara metrics survive persona switches. #6 AdminHRInbox jargon swept (super_admin → Mr. Kandil; anonymous to admins → identity confidential). #7 Ten more amber-600/700 contrast spots bumped (HR status pills "Under review"/"Investigating", Shipping cost cells, EmailStatusPanel fallback, CustomsTab empty-state, SettingsTab Safari/Reset/Reverse buttons + warn status). #11 Cartoon "Maya" SVG mascot removed from MyHRDesk (real Jenna photo lives in unified module header now). #12 lastSpokenAgentRef tracks last dispatched speaking agent so persona-switch dispatches {oldAgent, false} cleanly without flashing the wrong tile.' },
      { superAdminOnly: true, text: 'PERSONA ENGINE WIRING (5 fixes — the persona swap was largely cosmetic before): #A getElevenLabsVoiceId() resolves the active persona\'s voiceId at TTS call time. User-level voice_settings.voice_id still wins as override. Three distinct ElevenLabs voiceIds now actually used (Nadia EXAVITQu4vr4xnSDxMaL, Jenna pFZP5JQG7iQjIQuC4Bku, Sara XrExE9yKIg1WjnnlVkGX). #B sysPrompt now PREPENDS personaIntro built from activeAgent.personalityPrompt + role declaration + cross-persona handoff hints. Jenna\'s HR-empathetic prompt actually reaches the API. Sara\'s coaching prompt actually reaches the API. #F Persona-switch effect now COMPREHENSIVE: stops TTS audio + cancels speechSynthesis + stops MediaRecorder with discardRecordingRef flag (so captured audio doesn\'t go to wrong persona\'s API) + exits conversationModeRef + tears down endConversationMonitoring + fires nadia-tts-stop event + clears pausedRef + dispatches ktc:assistant-changed-cleanup. #G MyHRDesk got an active prop + hasBeenActive defer-load gate (no more HR table fetch on every dashboard load when user never opened Jenna). #L MyHRDesk listens for ktc:assistant-changed-cleanup and closes openModal on switch — but does NOT reset form state, so the draft is preserved for next time.' },
      { superAdminOnly: true, text: 'TEST COVERAGE: 1,228 total assertions across 50 test suites (2 new suites added — test-v55-77-a5-stabilization.js with 48 assertions, test-v55-77-engine-wiring.js with 31 assertions). Same 6 pre-existing v55.32/33 legacy stamp failures. Touched files: AIGreeter.jsx (+~80 lines for prompt + voice + comprehensive halt), AssistantsBar.jsx (display:none state preservation), MyHRDesk.jsx (defer-load + cleanup listener + Maya removal), AdminHRInbox.jsx (jargon sweep), ShippingRatesTab/EmailStatusPanel/CustomsTab/SettingsTab (contrast).' },
      { superAdminOnly: true, text: 'KNOWN GAPS (deferred to v55.78+): wake-word still hardcoded to "Hey Nadia" (saying "Hey Jenna" or "Hey Sara" does nothing); chat history shared across personas (Jenna sees Nadia conversation in context — mitigated but not eliminated by strong identity prompt); only Nadia has animated NadiaFace SVG (Jenna/Sara use static photo with speaking ring); no persona persistence across page reloads (always defaults back to Nadia); silence-detection threshold hardcoded (no ambient noise calibration). These are the parity items for the next phase.' },
    ],
  },
  {
    version: 'v55.76',
    date: '2026-05-08',
    label: 'Phase A5 — Unified AI Workforce Module',
    items: [
      // PUBLIC
      'ONE UNIFIED AI MODULE. Nadia, Ms. Jenna, and Sara now live inside ONE shared module on the dashboard — three photos at the top, one shared interaction area below. Switching between them no longer feels like opening different sections; it feels like the same intelligent system changing personality. The module color shifts smoothly to match whoever is active (indigo for Nadia, rose for Ms. Jenna, cyan for Sara).',
      'CHAT STAYS IN ONE PLACE. The conversation surface is now the persistent body of the module — whether you\'re talking to Nadia about your day, filing a concern with Ms. Jenna, or getting feedback from Sara, you stay in the same spot on the dashboard. No redirects, no jumps to other sections.',
      'ASSISTANT-AWARE WAKE BUTTON. If you collapse the chat, the "Talk to..." button now shows the active assistant\'s name and her color — so it stays clear who you\'re about to wake up.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'A5 STRUCTURAL: Three separate persona panel cards (each with their own border-2 rounded-2xl shell) consolidated into ONE id="ai-workforce-module" shell. Persona content (Nadia stats / Jenna MyHRDesk / Sara MyPerformance) renders as conditional content inside the same shell. Border + background gradient shifts via single ternary chain on openPanel — transition-all duration-500 for smooth color swap.' },
      { superAdminOnly: true, text: 'A5 CHAT INTEGRATION: chatSurface slot now renders INSIDE the unified module (was previously a sibling outside). Inner chat region gets a subtle persona-matched border-color (indigo-100/rose-100/cyan-100) so the visual continuity is unbroken. AIGreeter still mounted exactly ONCE in page.jsx — passed in as a slot, not duplicated per persona. ONE BRAIN principle preserved.' },
      { superAdminOnly: true, text: 'A5 PERSONA-AWARE WAKE: dismissed-state "Talk to..." button reads selectedAssistant from state, swaps name (Nadia / Ms. Jenna / Sara) and color (indigo/rose/cyan) accordingly. Old hard-coded "Open AI Assistant — Nadia" pill removed.' },
      { superAdminOnly: true, text: 'A5 CARRY-FORWARD: A1 calm-idle + speaking-only pulse intact. Switch event bus (ktc:assistant-changed) intact. AIGreeter persona-prop wiring intact. Voice/listening/recording engine bytes still untouched. 1,149 tests pass; 27 new A5-specific assertions in test-v55-76-a5-unified-module.js.' },
    ],
  },
  {
    version: 'v55.75',
    date: '2026-05-08',
    label: 'Phase A — visible bug fixes (avatars, HR wording, ticket list, contrast)',
    items: [
      // PUBLIC bullets
      'CALMER, CLEANER AVATARS. Only the active assistant glows now. No more all three avatars blinking together. Each one reacts independently when you hover. The active assistant only pulses when she\'s actually speaking — calm idle the rest of the time.',
      'CLEARER HR LANGUAGE. Filing a concern with Ms. Jenna no longer shows technical jargon. Her introduction now reads: "I\'m sorry you\'re dealing with this. I\'ll take it directly to Mr. Kandil." After you submit, you see exactly what was sent and your reference number — for example: "Your reference number is HRC-2026-0001. Mr. Kandil has been notified."',
      'RECENTLY UPDATED TICKETS — show 25, not 1. The dashboard\'s "Recently Updated" sections now default to showing the latest 25 entries (was capped at 5 before, which made it look like only one). "Show all" reveals the rest.',
      'BETTER CONTRAST EVERYWHERE. Hundreds of small badges, hints, and labels were updated to be readable. No more washed-out yellow-on-yellow text. No more invisible pale-grey hints at 9–10px. Status badges (Postponed, Partial, Unclaimed, In Progress, etc.) now use higher-contrast colors with crisp borders so they\'re legible at a glance.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'A1 ARCHITECTURE: avatar pulse moved off transform animation onto box-shadow only — eliminates conflict with the hover scale transform. New CSS class .ktc-assistant-speaking (driven by the speaking prop) replaces the always-on .ktc-assistant-active-pulse. Per-assistant glow color via --ktc-glow-color CSS variable so each persona pulses in her own color.' },
      { superAdminOnly: true, text: 'A1 EVENT BUS: AssistantsBar now listens for ktc:assistant-speaking events; AIGreeter dispatches the event when its speaking state changes. Additive layer — voice/listening engine bytes unchanged.' },
      { superAdminOnly: true, text: 'A2 WORDING: removed "(President)" suffix per Max\'s decision; removed user-visible "anonymous" word from confidentiality toggle (toggle still works under the hood, anonymous_to_admins flag preserved). Reference number surfacing already in place from v55.73.' },
      { superAdminOnly: true, text: 'A3 PAGINATION: CollapsibleSection defaultShow={25} on both Recently Updated sections (was inheriting global default of 5). All other dashboard sections still default to 5 (Newly Assigned, Overdue, All Open).' },
      { superAdminOnly: true, text: 'A4 CONTRAST SWEEP: 15 amber-text-on-amber-bg combos bumped from text-amber-600/700 → text-amber-900 with crisp borders (failed WCAG AA at 9–10px text). 164 small-text text-slate-400 → text-slate-500 bumps across 26 components for legibility at small sizes. Tests pinned in test-v55-75-phase-a-final.js (17 assertions, all green).' },
    ],
  },
  {
    version: 'v55.74',
    date: '2026-05-08',
    label: 'AI assistant experience improvements',
    items: [
      // PUBLIC — high-level only
      'Stability fix for the dashboard so the portal loads cleanly for everyone. Improvements to the AI assistant experience.',
      // SUPER_ADMIN ONLY
      { superAdminOnly: true, text: 'CRITICAL CRASH FIX: NadiaNewBuildCard was rendering BUILD_HISTORY items raw, including the new {text, superAdminOnly} object shape introduced in v55.73 — which crashed React (#31 — "object with keys") and blocked the entire portal at startup. Fix: extract .text safely from each item; also accept isAdmin/isSuperAdmin props and filter items the same way WhatsNewWidget does.' },
      { superAdminOnly: true, text: 'Privacy fix: NadiaNewBuildCard previously read raw BUILD_HISTORY[0] without filtering — non-super-admins could have seen super-admin-only build details in the "new build" highlight card. Now filtered correctly.' },
      { superAdminOnly: true, text: 'Defensive item rendering pattern: any future code reading BUILD_HISTORY items must use typeof item === "string" ? item : item.text — both consumer files (WhatsNewWidget + NadiaNewBuildCard) now follow this pattern.' },
    ],
  },
  {
    version: 'v55.73',
    date: '2026-05-08',
    label: 'AI assistant experience improvements',
    items: [
      // PUBLIC bullet — high-level wording only, no internal details
      'Improvements were made to the AI assistant experience for Nadia, Ms. Jenna, and Sara. The Executive Assistant, HR Representative, and Work Coach experiences are now more polished, more responsive, and easier to use.',
      // SUPER_ADMIN ONLY — confidential AI architecture
      { superAdminOnly: true, text: 'AssistantController architecture: ONE BRAIN, THREE PERSONAS. The existing Nadia voice/listening/recording/execution engine is preserved. A new persona layer reads from src/lib/agent-personalities.js and swaps avatar, name, role, greeting, voice ID, system prompt, allowed actions, forms, dashboard modules, routing rules, and confirmation messages based on which agent is active.' },
      { superAdminOnly: true, text: 'Active-state visual feedback per Max\'s spec: only one assistant active at a time; Nadia is the default; the active tile gets a colored glow, pulsing animation, accent ring, "IN CONTROL" badge, and a top-left "ACTIVE" dot. Inactive tiles are slightly dimmed (opacity-90).' },
      { superAdminOnly: true, text: 'Sara loading hang fixed: when myId hadn\'t hydrated yet (userProfile still loading), the effect bailed at line 54 leaving loading=true forever. Now: clean exit to empty-state UI, 8-second hard timeout with retry button, and a Sara-voiced "I don\'t see enough activity data yet" fallback.' },
      { superAdminOnly: true, text: 'HR Desk routing now actually dispatches /api/notify (was a no-op before — row inserted but nobody notified). Recipients built from radio choice + super_admin always CC\'d, deduped, self excluded. Complaint dispatch always to super_admin only. Routing per persona codified in agent-personalities.js routingRules.' },
      { superAdminOnly: true, text: 'High-contrast radio button picker replaces yellow-on-yellow auto-routing badge in HR forms. Manager radio shows manager name; Mr. Kandil radio shows super_admin name. Friendly heads-up when user picks against category default.' },
      { superAdminOnly: true, text: 'RLS policies for hr_requests + hr_complaints — fixes "TypeError: Load failed" on submit. Complete idempotent SQL bundle delivered (v55_73_SQL_BUNDLE_RUN_THIS.sql) with BEFORE/AFTER state notices.' },
      { superAdminOnly: true, text: 'Voice infrastructure future-ready: each persona has a voice config block (provider, voiceId, pitch, speed, style, browserFallback). ElevenLabs placeholder voice IDs in place; swap to KTC-licensed voices is a one-file edit. See docs/VOICE-INFRASTRUCTURE.md.' },
      { superAdminOnly: true, text: 'Personality intros at top of every panel and modal: photo + "Hi, I\'m [Name]" + role badge + warm greeting from agent-personalities.js. Sara opens with "Hey," (energetic-coach tone) instead of "Hi,".' },
      { superAdminOnly: true, text: 'Build notes filter: introduces superAdminOnly tier on top of existing adminOnly. AI architecture details are super_admin only; admins + employees see only the high-level public bullet.' },
      { superAdminOnly: true, text: 'Clean professional error messages replace raw technical errors: "We couldn\'t submit this right now. Please try again, or contact your manager." Real error stays in console for debug.' },
    ],
  },
  {
    version: 'v55.72',
    date: '2026-05-07',
    label: 'Real photos for the three agents · reminder formatting preserved',
    items: [
      // PUBLIC bullet — high-level wording about AI work, no internals
      'Updates were made to the AI assistant experience for Nadia, Ms. Jenna, and Sara — including how they appear on the dashboard.',
      // PUBLIC bullet — non-AI work everyone can see in detail
      'REMINDERS PRESERVE YOUR FORMATTING. When you post a reminder or announcement, it now lands in your team\'s inboxes formatted exactly the way you typed it. Line breaks are preserved. Blank lines become paragraph breaks. Lines starting with -, *, or • become a clean bulleted list. Lines starting with 1., 2., 3. become a numbered list. No more wall-of-text emails.',
      // PUBLIC — non-AI
      'BIGGER COMPOSE BOXES for reminders and announcements with placeholder text showing examples of bullet and numbered formatting. A small green hint underneath each box confirms "Line breaks, paragraphs, and bullet/numbered lists preserved."',
      // SUPER_ADMIN ONLY — AI internals
      { superAdminOnly: true, text: 'THREE REAL FACES FOR YOUR AGENTS. The illustrated cartoon avatars are replaced. Nadia, Jenna, and Sara now appear as real photographs on the dashboard. Each photo is a circular headshot with a soft inner ring inside its color-themed tile, and tilts gently when you hover. Photos are crisp at 512×512 and load fast (~120KB each).' },
      { superAdminOnly: true, text: 'WHY REMINDERS WERE BROKEN. Three separate places were collapsing formatting: (1) the email body builder dropped raw text into a div which ignores line breaks, (2) the team-reminder send flow was passing only the subject line and not the body, (3) the in-app reminder card view collapsed everything into one line. All three fixed.' },
    ],
  },
  {
    version: 'v55.71',
    date: '2026-05-07',
    label: 'AI assistant experience improvements',
    items: [
      // PUBLIC — high-level only
      'Work was completed on the AI world-class assistant feature. The HR Representative, Work Coach, and Executive AI Assistant experiences are now more visible and easier to use from the dashboard.',
      // SUPER_ADMIN ONLY — internals
      { superAdminOnly: true, text: 'YOU NOW HAVE THREE PARTNERS. Three really big avatar tiles dominate the top of every dashboard: Nadia (Executive Assistant) on the left, Jenna (HR Representative) in the middle, Sara (Work Coach) on the right.' },
      { superAdminOnly: true, text: 'NADIA AUTO-OPENS HER MORNING BRIEF on first daily load — tells you what\'s urgent: tickets needing acknowledgment, items due today, anything overdue, and checks due.' },
      { superAdminOnly: true, text: 'JENNA EXPANDS into the full HR Desk inline — file requests (vacation, sick leave, raise, etc.), raise concerns, see super_admin responses.' },
      { superAdminOnly: true, text: 'SARA IS NEW — your work coach who scores your performance, surfaces growth feedback. Her panel mounts the Performance Coach inline.' },
      { superAdminOnly: true, text: 'NEVER DISAPPEAR. The three tiles are the very first thing on screen and they stay put. Each panel mounts the deeper component only when expanded — single render tree pattern from v55.68.' },
    ],
  },
  {
    version: 'v55.70',
    date: '2026-05-07',
    label: 'Two big assistants on the dashboard: Nadia (executive secretary) + Jenna (HR coach)',
    items: [
      'CLEAN ORGANIZATION FOR THE DASHBOARD. Two big animated avatar tiles now sit at the very top — Nadia on the left (your executive secretary) and Jenna on the right (your HR rep / relationship coach). Each is a friendly illustrated character with their own role badge, a one-line summary of what\'s waiting for you, and a notification count if there\'s something pending. Click either tile to expand into the full experience below.',
      'NADIA gives you a MORNING BRIEF — at a glance you see how many tickets need acknowledgment, how many are due today, how many are overdue, and any checks due. If everything\'s clear, she just says "all caught up — no urgent items today." Click her tile and you scroll straight to her chat surface where she goes deeper.',
      'JENNA gives you TODAY\'S AGENDA — at a glance you see how many HR requests are pending, how many concerns are pending, and especially highlights any new responses from super_admin (with a green pulse so you know there\'s news). Click her tile and you scroll straight to the HR Desk + Performance Coach where you can file requests, see your scoring, and get coaching feedback.',
      'BOTH AVATARS ARE ALIVE — they wave periodically (Nadia tilts her tablet, Jenna waves her hand with motion lines) and respond to hover. The motion is offset so they don\'t move in lock-step — feels like two real people on screen, not a robot.',
      'NEVER DISAPPEAR — the AssistantsBar is rendered outside any loading gate and uses the single-render-tree pattern from v55.68, so the two big avatars are the first thing you see and they stay put no matter what.',
      'CARRIES FORWARD all v55.65/66/67/68/69 work: HR Desk + Performance Coach with no remount disappearance, instant ticket title/description edits with optimistic UI + back button always works, HR routing rules (manager vs super_admin), Shipping list view, Customs Excel import, Nadia anti-repetition + loading-screen presence, voicemail fix, WhatsNew filtering of build internals from non-admins.',
    ],
  },
  {
    version: 'v55.69',
    date: '2026-05-07',
    label: 'Ticket edits instant + Back always works · HR routing auto-picks where to send',
    items: [
      'TICKET EDITS ARE NOW INSTANT. Bug Max May 7 2026: editing a ticket title or description felt slow — the Save button stayed on "Saving..." for 1-3 seconds, and during that time clicking Back did nothing. Root cause: the database write involved THREE round trips to the server (read old values → save the change → write an audit comment), all blocking the UI. Fix: the moment you click Save, the UI exits edit mode immediately and you see your edit applied. The actual database save happens entirely in the background. If anything goes wrong, your text is restored and the editor re-opens with an error message — your work is never lost.',
      'BACK BUTTON ALWAYS WORKS on a ticket. Click Back any time, even mid-save → instantly returns to the ticket list. If you save an edit and immediately click Back (or open a different ticket), the background save still completes correctly because the system snapshots the ticket reference at the moment you clicked Save.',
      'HR REQUESTS NOW ROUTE AUTOMATICALLY based on what you pick. Only the operational topics — vacation, sick leave, schedule change, recognize a teammate — go to your manager. Everything else (raises, promotions, training, expense, transfer, flexible hours, remote work, equipment, other) goes straight to super_admin and stays hidden from regular admins. You no longer have to think about who to route it to — picking the topic IS the routing decision.',
      'NEW ICON-TILE TOPIC PICKER replaces the old dropdown. Two clearly labeled groups: "👤 Goes to your manager" (4 blue tiles) and "🔒 Goes to super_admin only — admins can\'t see" (9 violet tiles). Tap the icon for the topic you want. The selected tile lights up. Below the picker, a colored "📨 Goes to:" badge confirms exactly where the request will land.',
      'AUTO-ROUTING is the single source of truth. Even if the form somehow gets stale, the system re-derives the routing at submit time from your picked topic. No way to accidentally send a raise request to your manager or a vacation request only to super_admin.',
      'COMPLAINTS UNCHANGED — they always go straight to super_admin (sensitive by definition), with anonymous-to-admins on by default. Updated complaint topic dropdown to show the icon next to each label for clarity.',
      'ADMIN HR INBOX shows clear routing badges: "🔒 super_admin only" (violet) for sensitive items, "👤 Manager-handled" (blue) for routine operational ones, so reviewers see at a glance which queue an item is in.',
      'CARRIES FORWARD all v55.65/66/67/68 work: HR Desk + Performance Coach never disappear (single render tree), Maya the HR mascot, Nadia anti-repetition, voicemail fix, Shipping list view, Customs Excel import, System Tickets retest workflow, WhatsNew filtering for non-admins.',
    ],
  },
  {
    version: 'v55.68',
    date: '2026-05-07',
    label: 'HR Desk + Performance Coach NEVER disappear · single render tree fix',
    items: [
      'STOPPED THE DISAPPEARING. Both the HR Desk card and the Performance Coach card were appearing on first load and then vanishing for a moment when the rest of the dashboard data finished loading. Root cause was technical: the dashboard had two different "states" (loading vs loaded) and React was throwing the cards away and re-creating them every time it switched between states. Fixed by rendering them in ONE place that stays mounted no matter what — they appear once on login and stay on screen permanently. No more flicker, no more vanish, no more re-fetching their data every time something on the dashboard updates.',
      'HR DESK WORKFLOW VERIFIED end-to-end: you file a request (vacation, equipment, raise, training, etc.) or a confidential concern → it lands in Admin → HR Inbox with the right visibility (super_admin sees all, admins see admin-visible requests + only non-anonymous complaints) → super_admin reviews, picks a status, writes a decision note → you see the response right back on your dashboard with a colored status badge (Approved, Denied, Investigating, etc.) and a pulse indicator if there is news for you. 26 end-to-end workflow tests + edge-case coverage all pass.',
      'PERFORMANCE COACH ("rah-rah" coach) — visible to every user, fully restored. Shows your activity numbers, scoring tiles, growth deltas, daily-log streak, meeting show-up rate, and an AI-coach-feedback button that gives a personalized pep talk. Fetches its own data so a flaky network on other dashboard queries doesn\'t affect it. Stays put — never blanks out, never flickers.',
      'CARRIES FORWARD all v55.65/66/67 work: HR Desk + AdminHRInbox, Nadia anti-repetition + loading screen pill, voicemail "couldn\'t hear you" fix, Shipping list view, Customs Excel import, System Tickets retest workflow, WhatsNew filtering of build internals from non-admins.',
    ],
  },
  {
    version: 'v55.67',
    date: '2026-05-07',
    label: 'Performance Coach back for everyone · build notes hide internals from non-admins',
    items: [
      'PERFORMANCE COACH RESTORED for all users. The previous build had hidden it behind admin/super_admin only — that was a misread of the request. The coach card, the activity tiles, the streak, the AI pep-talk button — all back the way they were originally. Only the team-wide HR REPORT (in Admin → HR Report) stays admin-gated, which it always has been.',
      'WHAT\'S NEW build notes — items that describe the internal scoring algorithm, HR Coach implementation, retest pipeline mechanics, and similar build internals are now ADMIN/SUPER_ADMIN ONLY. Regular users still see the entry exists ("v55.65 shipped these things") but do not see the internals of how the AI scoring works under the hood.',
      { adminOnly: true, text: 'IMPLEMENTATION NOTE — entries can now be marked { adminOnly: true } to hide individual bullet items from non-admin users while keeping the rest of the build entry visible. Whole entries can also be marked { adminOnlyEntry: true } to hide them entirely.' },
    ],
  },
  {
    version: 'v55.66',
    date: '2026-05-07',
    label: 'HR Desk persistence + Shipping list view restored',
    items: [
      'MY HR DESK NEVER DISAPPEARS. Bug: the HR card was vanishing after the first dashboard load if any other query failed (a flaky network blip on tickets / calendar / follow-ups was enough to send the whole dashboard back to "Loading…"). Three fixes: (1) HR Desk now renders BEFORE the loaded gate so it appears instantly, (2) every dashboard query now has its OWN try/catch so one failure can\'t blank the dashboard, (3) setLoaded(true) ALWAYS fires no matter what. Result: the HR card is the first thing on screen and stays put forever.',
      'SHIPPING RATES — LIST VIEW RESTORED. New "🗂 Routes / 📋 List" toggle pill at the top of the Rates tab. Routes is the bucket card grid (default, unchanged). List is every individual rate as a row in a sortable table — click any column header to sort (ETD, Origin, Destination, POL, POD, Vendor, Line, TT, FT, Rate, Expires). Click any row to jump into the same route detail screen. Inline edit button per row. Expired rates dimmed but still visible. Your view-mode preference is saved per browser so it sticks across sessions.',
      'CARRIES FORWARD all v55.65 work: My HR Desk with animated Maya mascot + request/complaint flow to super_admin, AI Performance Coach scoring with meeting check-ins, System Tickets fix-in-build/retest workflow, Nadia anti-repetition + loading-screen presence pill, voicemail "We couldn\'t hear you" fix.',
    ],
  },
  {
    version: 'v55.65',
    date: '2026-05-07',
    label: 'AI Performance Coach gets a logo + meeting check-ins + bug-report scoring · System Tickets retest workflow · Build highlights auto-pull bug fixes',
    items: [
      // v55.67 — internal scoring/algorithm details are admin/super_admin only.
      // The functionality is for everyone; the build narrative is just hidden
      // for non-admins so they don't see the under-the-hood mechanics.
      { adminOnly: true, text: 'AI PERFORMANCE COACH — new logo (rising bars + coach speech bubble) sits next to the title so the card is unmistakable on the dashboard. Three new metric tiles: "Meetings You Set Up", "Meetings You Signed Into" (the actual check-in count, not just the invite list), and "Show-Up Rate" (of meetings you organized that have already happened, how many you actually attended). The show-up rate is color-coded: green ≥80%, amber 50-79%, rose under 50%.' },
      { adminOnly: true, text: 'AI PERFORMANCE COACH — bug reporting now factors into your score. New tiles: "Bug Reports Filed" (system tickets you opened, with how many already shipped a fix) and "Bugs You Retested" (closing the loop after Claude fixes one).' },
      { adminOnly: true, text: 'SCORING ALGORITHM rebuilt to match what mature HR software (Lattice / 15Five / Culture Amp / Workday Talent) measures: PRODUCTIVITY 35% · QUALITY 15% · TIMELINESS 20% · ENGAGEMENT 20% · RELIABILITY 10%. Quality looks at quote acceptance rate, bug-fix rate on tickets you filed, and meeting show-up. Reliability is meeting show-up + retest follow-through. Score itself stays admin-only on HR Report; the self-view shows growth-oriented coach text only.' },
      { adminOnly: true, text: 'SYSTEM TICKETS — when an admin checks "🤖 Fix next session" on a ticket, that ticket goes into Claude\'s queue. After Claude ships a fix in the next build, the admin clicks "📦 Mark fixed in build", picks the build version, and writes test notes. Three things happen automatically: (1) the ticket is tagged with the build version + fix notes, (2) the original creator sees a pulsing "🔁 Bugs to retest" card on their dashboard, (3) the bug shows up in this What\'s New under "Bugs fixed in this build".' },
      { adminOnly: true, text: 'SYSTEM TICKETS — creator clicks "🔁 Retest now" → picks "✓ Works perfectly", "~ Partly works", or "✗ Still broken" + adds notes. Passed → ticket closes. Failed → ticket reopens AND goes back into Claude\'s queue automatically. Partial → recorded for the record without closing.' },
      'WHAT\'S NEW — this section now auto-pulls bugs fixed in the latest build directly from your system_tickets table. So bug fixes appear here as build highlights without anyone having to copy-paste them.',
      { adminOnly: true, text: 'DATABASE — needs one small SQL run for the new columns (claude_fixed_in_build_version, needs_retest, retest_completed_at, retest_completed_by, retest_outcome, retest_notes). Open Supabase → SQL Editor → paste sql/s40_system_tickets_retest.sql → Run. Idempotent so re-running is safe.' },
      'CARRIES FORWARD all changes from v55.62, v55.63, and v55.64: deactivated-user fixes, Customs tab Excel import + template with Shipment Reference, Shipping Rates port-level filtering with FT/ETD/TT columns, What\'s New since-last-login tracking with 100-build cap.',
      'VOICEMAIL FIX — callers couldn\'t leave a message and kept hearing "We couldn\'t hear you". Root cause: Twilio\'s `trim-silence` setting on the recording was aggressively chopping audio when it detected ambient silence, returning a zero-duration recording. Fix: switched to `do-not-trim`, added a 10-second `timeout` so callers have time to start speaking, and a 1-second `Pause` between the beep and the recording start so the beep audio doesn\'t bleed in. Applied in all three voicemail entry points (incoming-call fallback, no-routing branch, no-answer branch).',
      'MY HR DESK — brand new prominent dashboard card at the very top of every team member\'s home screen. Animated mascot (Maya) with a waving arm that gets attention every 12 seconds. Two big buttons: "📝 File a Request" (vacation, equipment, raise, training, schedule, recognition, expense, etc — 13 categories) and "🛡️ File a Concern" (interpersonal, manager, harassment, discrimination, safety, workload, pay — 11 categories). Each submission gets a friendly reference number (HR-2026-0001, HRC-2026-0001) and shows status updates right on the dashboard. Routine requests visible to admins and super_admin; concerns go straight to super_admin and stay anonymous to other admins by default.',
      { adminOnly: true, text: 'HR INBOX (admin / super_admin tab) — new section in Admin: super_admin sees every request and every complaint with full submitter identity. Regular admins see admin-visible requests + only non-anonymous complaints; everything else is hidden with just a "N confidential complaint(s) visible only to super_admin" counter. Reviewer can update status, write a decision/resolution note that the submitter sees on their dashboard, and the system auto-records who reviewed it and when.' },
      'NADIA SMARTER — Nadia was greeting people the same way every login. Now she varies her openings, picks different items to lead with, and feels like a real colleague noticing new things instead of a stuck record.',
      'NADIA AVAILABLE EARLIER — small "Nadia is here · getting your day ready…" pill now appears on the loading screen so she feels present from the very first second.',
    ],
  },
  {
    version: 'v55.64',
    date: '2026-05-07',
    label: 'Customs — bulk import from Excel + template; AI Performance Coach back on dashboard; Shipping rates by EXACT port + What\'s New consolidates everything since your last login',
    items: [
      'CUSTOMS — Bulk import historical clearances from an Excel file. New green "📥 Import from Excel" button on the Customs tab opens a file picker. The system reads your sheet, shows every row in a preview table where you can edit cells in place and drop bad rows BEFORE saving anything. Status shows green ✓ for valid rows and red ⚠ for rows missing required fields (with a tooltip explaining what\'s wrong).',
      'CUSTOMS — Download a blank template with the new "📄 Download Template" button. The template includes a "Shipment Reference" column as the first field — exactly what you asked for, so each historical clearance is tied to its shipment / invoice / B/L number. Two sheets in the file: "Customs Clearances" with all 20 columns + sample row, and "Read me" with step-by-step instructions and the calculation formulas.',
      'CUSTOMS — Import handles the math automatically. You only need to fill USD/kg, quantity, FX rate, and product (everything else has sensible defaults). VAT, Income Tax, and Bank Commission percentages are pulled from your Customs Settings if blank. Customs Duty % is auto-resolved from your Customs Rates library by Product Name. All eight fixed fees are optional.',
      'CUSTOMS — Header rows in your file are matched flexibly. "Shipment Reference", "B/L", "BL Number", "Invoice Number", "Reference" all map to the same field. "USD/kg", "Price USD", "Price/kg" all map to the price column. So you don\'t have to use the exact template wording if you\'re importing from your own historical spreadsheet.',
      'AI PERFORMANCE COACH IS BACK on the dashboard. The "📊 My Performance · AI Coach" card now opens by default for everyone (was collapsed to a tiny pill before, which is why people thought it was missing). You see your activity numbers for the period you pick, your trend vs the prior period, and the "Get coach feedback" button gives you an AI-generated pep talk with growth-oriented suggestions. Available to every team member, no permission needed.',
      'WHAT\'S NEW pill — when there are builds you haven\'t seen since your last visit, the pill turns red, pulses, and shows "+N new since your last visit" with a count badge. Open the modal and every unseen build is auto-expanded with a NEW tag, so you get one consolidated view of everything that changed instead of having to dig through each version. Closing the modal marks them all as seen.',
      'WHAT\'S NEW history — the changelog now caps display at the most recent 100 builds. Older entries stay in the file but aren\'t rendered, so the modal stays fast even after years of releases.',
      'SHIPPING RATES — filter by EXACT port instead of just country. Two new dropdowns at the top of the Rates tab: "All POL" (loading port) and "All POD" (discharge port). Pick one and the route cards rebuild around the exact port — Damietta and Alexandria become separate cards instead of being lumped into "Egypt". Inside the route detail, the rate history table now shows POL, POD, ETD, TT, and FT as their own columns. A "✕ Clear ports" button snaps you back to country grouping in one click.',
      'SYSTEM TICKETS table — if you\'re still seeing the "table not found" error, run supabase/system-tickets-setup.sql in Supabase SQL Editor (one-time only). The file is included in this build under the supabase/ folder.',
    ],
  },
  {
    version: 'v55.62',
    date: '2026-05-07',
    label: 'Inactive teammates fully hidden + Customs tab crash fix shipping',
    items: [
      'Deactivated teammates were still appearing on the admin scorecard, in team dropdowns, and in the announcement acknowledgment lists. The previous filter checked "is active not equal to false" — but a deactivated user with a missing flag value (NULL) passed that test. Now: deactivated users with EITHER false OR NULL flags are hidden everywhere.',
      'New shared helper file ensures every place that filters team members uses the same rule. Previously this logic was scattered in 11 different files with slightly different versions.',
      'Customs tab "application error" was a real React infinite-loop bug from the v55.51 build that\'s already fixed in v55.61. If you\'re still seeing it, deploy v55.61 or v55.62 and hard-refresh (Cmd+Shift+R).',
      'Server-side email notifications also now skip users with NULL active flag — previously they\'d try to send to deactivated teammates and bounce.',
    ],
  },
  {
    version: 'v55.61',
    date: '2026-05-07',
    label: 'Customs tab — fix "Minified React error #301" + Admin scorecards hide deactivated users',
    items: [
      'Customs tab was crashing with "Minified React error #301" when opened. Root cause: the data loaders ran during the page render itself, which set state, which triggered another render, which fired the loaders again — an infinite loop React shut down with that error code. Fixed: loaders now run AFTER the page draws, never during it.',
      'You should now be able to open the Customs tab and see your Clearances and Shipments lists without the red error screen. The Retry button is no longer needed.',
      'Admin scorecards no longer show deactivated teammates. Before, the main Admin → Scorecards page, the pipeline-by-rep breakdown, and the team-member dropdown filter were all showing every user including deactivated ones — with all-zero metrics. Now active teammates only.',
      'Historical records in the audit log still display deactivated users\' names correctly when they appear in past activity — only the live scorecard tables are filtered.',
    ],
  },
  {
    version: 'v55.61',
    date: '2026-05-07',
    label: 'Admin page — fix "Online status shows Offline when I am online"',
    items: [
      'Online status was showing everyone as Offline even when they were actively logged in. Three fixes shipped together.',
      'Fix 1: When you log in, your Online indicator now flips green within seconds. Before, the system waited 5 minutes before pinging the server with the first heartbeat, so even YOU saw yourself as Offline for the first 5 minutes after login.',
      'Fix 2: The system now pings every 2 minutes (was every 5). Combined with the 10-minute Online window, this means up to 4 missed pings can happen before someone flips to Offline. A single bad WiFi moment will no longer make you look offline to the rest of the team.',
      'Fix 3: If the underlying database table isn\'t set up (which is the actual root cause for most teams), a big amber warning now appears at the top of the Team Login Summary saying "Online status not working — database setup needed" with the exact SQL file to run. Before, the table just silently showed everyone as Offline with no explanation.',
      'IMPORTANT: if you see the amber warning after deploying, run supabase/login-events.sql in Supabase → SQL Editor (one-time setup). Logins going forward will track correctly. Past logins from before the SQL is run won\'t show up in the new view, but the user_sessions table still has them.',
    ],
  },
  {
    version: 'v55.60',
    date: '2026-05-06',
    label: 'Nadia announces new builds + archived ack visibility + Resend setup steps',
    items: [
      'Nadia now greets you on the dashboard when a new build has been deployed. A purple Nadia card appears with the build version, the headline, and the top 3 highlights from the changelog. Tap "✓ Got it" and the card disappears until the next build deploys.',
      'Archived announcements now show acknowledgments more prominently to admins. When you click into the archived list (in the Admin tab → Messages section, or the dashboard archived view), each archived announcement has a clear pull-out box showing exactly who acknowledged (with timestamps) and who didn\'t.',
      'Acknowledgment counts now exclude deactivated teammates. Before, a user who was deactivated AFTER an announcement would show as "didn\'t acknowledge" forever, polluting the unacked list. Their original acknowledgment (if any) still appears correctly.',
      'Resend status panel now shows step-by-step instructions inline when the FROM address is still the default "onboarding@resend.dev." Click the "▸ Step-by-step instructions" disclosure on the Admin tab and you\'ll see exactly what to do at resend.com, Bluehost DNS, and Vercel — no need to ask Claude every time.',
    ],
  },
  {
    version: 'v55.59',
    date: '2026-05-06',
    label: 'System Tickets — actually fix the actually-broken table',
    items: [
      'The System Tickets tab has been broken because the underlying database table either didn\'t exist or was missing columns. Every previous "fix" was code-only. The real root cause was that the database setup SQL was never written. Now it is.',
      'Run the new file at supabase/system-tickets-setup.sql ONCE in Supabase → SQL Editor. It creates the table if missing, adds any missing columns to an existing partial table, and is safe to re-run as many times as you want.',
      'After running the SQL, the System Tickets tab works. + New System Ticket creates a row, the list loads, status changes save, the Claude flag toggles, delete works.',
      'When the table is missing or broken, the tab now shows a BIG amber banner that says exactly what to do: "run system-tickets-setup.sql." Before you saw a 2-second toast then an empty panel and had no idea what was wrong.',
      'When ticket creation fails for any reason, the form now shows the exact error inline (instead of a disappearing toast) so you can see what went wrong without losing your typed text.',
    ],
  },
  {
    version: 'v55.58',
    date: '2026-05-06',
    label: 'Mobile floating buttons — no more overlapping icons',
    items: [
      'On phones, the floating icons in the corners were stepping on each other. The phone (📞), voice indicator, Nadia bubble, the + (Quick Add) button, and the "Synced X minutes ago" pill were all fighting for the same screen space. Cleaned up.',
      'Bottom-LEFT corner is now reserved for the team: phone button at the very bottom, voice indicator just above it, Nadia bubble above that. Stacked vertically with comfortable spacing — no more overlap.',
      'Bottom-RIGHT corner is reserved for the + Quick Add button (and its menu when you tap it). Nothing else lives there now. When you tap +, the menu opens upward without bumping into anything.',
      'When you expand Nadia to chat with her, her panel anchors to the left side and stops short of the right edge so the + button stays reachable.',
      'The "Synced X minutes ago" pill is now hidden on phones (it was overlapping everything). Still shown on desktop where there\'s room. On mobile, just pull-to-refresh if you need to force a reload.',
    ],
  },
  {
    version: 'v55.57',
    date: '2026-05-06',
    label: 'Tickets — fix duplicate tickets on double-tap of Create',
    items: [
      'Tickets were occasionally being created twice when you tapped Create quickly. Two tickets with sequential numbers (like TKT-0042 and TKT-0043) would appear with identical content. Fixed: the Create button now disables on the first tap and shows "⏳ Creating…" while the ticket is saving. The second tap is ignored. Same ticket, one row.',
      'Same protection added to the Close-with-Comment button. Before, a quick double-tap could close the ticket twice and write two closing comments. Now the button shows "⏳ Closing…" and the second tap is ignored.',
      'Note for whoever sees this in the audit trail: nothing in your existing tickets changes. Only NEW ticket creations and closures from this point forward are protected. If you have lingering duplicates from before this fix, you can delete them manually (admin → ticket → Delete) and the system will renumber correctly.',
    ],
  },
  {
    version: 'v55.56',
    date: '2026-05-06',
    label: 'Phone — fix "an application error has occurred" on inbound calls',
    items: [
      'Inbound calls were failing with the dreaded "an application error has occurred" message after the second greeting. The cause: when Twilio tried to verify the call coming into our portal, the security check didn\'t match (a common issue when Vercel\'s internal URL differs from the public URL), so our portal blocked the call — and Twilio plays the application-error message to the caller as a result.',
      'Fix: phone routes now log the signature failure prominently in the Vercel logs, but they DO NOT block the call. The caller hears proper greeting, recording disclaimer, dial routing, voicemail prompt — exactly as configured. Brand-safe behavior. The security exposure is small because the routes don\'t initiate any outbound calls or charge anything.',
      'New diagnostic page: https://nexttrade-hub.vercel.app/api/phone/health — paste it into your browser to check whether the phone system is reachable and what settings are configured. You can also point a test phone number at this URL temporarily to confirm Twilio can reach the portal without involving the real call routing.',
      'After deploying, retry your test call to 17328005428. You should hear the greeting + recording disclaimer + "the team is unavailable" or the voicemail prompt — not "an application error." If it still fails, open https://nexttrade-hub.vercel.app/api/phone/health in your browser and share what it shows — that tells us exactly what setting is missing.',
      'Same fix applied to all four phone handlers (incoming call, outbound call, voicemail recording, call status, recording confirmation). Whichever one was actually erroring will now succeed.',
    ],
  },
  {
    version: 'v55.55',
    date: '2026-05-06',
    label: 'Monthly Sales Report — click any month to see the orders',
    items: [
      'On the dashboard\'s Monthly Sales Report, click any month row and you\'ll jump to the Sales tab pre-filtered to just that month\'s orders. The total at the top of the Sales tab now matches the number you clicked, and you can scroll through every invoice that made up that month\'s revenue.',
      'Same drill-down works on the Monthly Sales table inside the Reports tab too — click any month and land on the filtered Sales view.',
      'Each month row now has a hover hint ("→ view orders") and a tooltip that tells you how many orders the click will open. Cursor changes to a pointer so it\'s obvious the row is clickable.',
      'When you\'re done looking at that month\'s orders, just change the date range at the top of the Sales tab back to YTD or All to see everything again.',
    ],
  },
  {
    version: 'v55.54',
    date: '2026-05-06',
    label: 'Performance Review — fix "disappears when opened"',
    items: [
      'My Performance card on the dashboard — when you tapped Open and it crashed silently, the entire card vanished and you saw nothing. Fixed: the card is now wrapped in a safety net so a single failure shows a friendly error message inside the card instead of making the whole thing disappear.',
      'If the data load fails (a missing table, a network blip, a malformed date in your activity), you now see a red box with the actual error message, plus a hint to check the browser console for diagnostic lines starting with [my-perf]. Before, you saw a blank card with no clue what went wrong.',
      'If the data loads but there\'s nothing to show yet (brand new user, no activity in the period), you see a friendly amber message ("No activity to show yet") instead of an empty card.',
      'Diagnostic logging added — every time you open the card, the browser console gets a [my-perf] log line showing how many tickets, comments, daily-log entries, audit rows, quotes, and calendar events were loaded. If you ever see this card act up again, share those console log lines and I\'ll know exactly what failed.',
    ],
  },
  {
    version: 'v55.53',
    date: '2026-05-06',
    label: 'Cutover playbooks — portal URL move + Resend email change',
    items: [
      'Two planning documents now live in the project under docs/. Both are reference material for cutover days that have not happened yet — nothing changes in the live portal in this build.',
      'docs/CUTOVER-resend-from-address.md — the playbook for switching the email FROM address from "onboarding@resend.dev" to "notifications@ktcus.com" so notifications go out to the whole team. Includes the DNS records you need at Bluehost, the failure modes from the previous attempt, the test, and the rollback. This change is isolated — it does NOT touch the portal URL or anything else.',
      'docs/CUTOVER-hub-ktcus-com.md — the playbook for moving the portal URL from "nexttrade-hub.vercel.app" to "hub.ktcus.com." This is a bigger change that affects the Twilio phone settings, the Gmail sign-in setup, the Supabase login URLs, and a couple of email-template links. Step-by-step in order, every step has a 30-second rollback, nothing touches your data or anyone\'s account. Estimated 1-2 hours of hands-on work on cutover day, plus 1-2 weeks of planning beforehand and 1-2 weeks of soak afterwards.',
      'Both documents stress that the two cutovers are completely independent — the Resend email change does not require the portal URL change, and vice versa. They\'re documented separately so you can do one without the other.',
      'Audit complete: every file in the project that references the portal URL is listed in the playbook. 15 references total. Most already pick up the URL from a single setting (NEXT_PUBLIC_APP_URL) so they auto-update; two email templates have the URL written directly in them and will get a small fix in a future build.',
    ],
  },
  {
    version: 'v55.52',
    date: '2026-05-06',
    label: 'Test email to whole team + hide deactivated users from dropdowns',
    items: [
      'Email Status panel (Admin tab) has a new button: 📬 Test all teammates. Click it, confirm the prompt, and the system sends a real test email to every active teammate one by one. You then get a per-person results table — each row shows the name, email, and either ✅ Sent or ❌ with the exact reason it failed (so you know if someone has a typo in their email, a bounced address, or their company blocks our sender domain).',
      'The original "Send test email to me" button is still there — use that for a quick check, the new button when you want to confirm everyone on the team is set up.',
      'Deactivated team members no longer appear in dropdowns. Before, when you went to assign a ticket, a CRM rep, a calendar attendee, or a daily-log entry, terminated or turned-off teammates were still showing in the picker. Fixed everywhere: Tickets, CRM, Calendar, Daily Log, Translation language settings.',
      'Old records still display the original person\'s name correctly — even if they\'ve been deactivated. So a closed ticket from last year still says "Closed by Ahmed" even after Ahmed leaves.',
      'In Settings → Team & Roles you still see EVERY teammate (active and inactive) — that\'s where you turn people on and off.',
    ],
  },
  {
    version: 'v55.51',
    date: '2026-05-06',
    label: 'New Customs tab — full clearance calculator',
    items: [
      'The Customs tab now has two sections you can switch between: 📋 Clearances and 🚢 Shipments. Shipments looks the same as before. Clearances is brand new.',
      'You can now calculate any customs invoice the same way our PVC invoice 1676 looks: type the price per kilo in dollars, type the quantity in kilos, the system pulls today\'s dollar-to-pound exchange rate automatically, and you pick which product it is. Customs duty, VAT, advance income tax, and bank commission all calculate live as you type.',
      'There are also eight fixed-fee fields ready for you to type into: permit withdrawal, unloading, cranes and loading, storage (leave blank if not used), road fees, pricing committee, miscellaneous and clearance, and transport. The grand total appears in a big black box at the bottom that updates as you type.',
      'In Settings there\'s a new section called 🛃 Customs Rates. This is where you keep the list of products with their customs duty percentage. Add a new product the moment you need it (PVC at 10%, leather at whatever, and so on). The four government rates (VAT 14%, advance income tax 1%, bank commission 10%) live there too — change them once and every new clearance picks them up automatically. Old clearances stay locked at the rates that were in effect when you saved them.',
      'Each clearance can be tagged with a reference number (like 1676) and linked to one of your existing shipments. Clearances have a status: draft → paid → reconciled, plus a cancelled option. You can filter the list by status, product, or date range, and see total customs paid at a glance.',
      'IMPORTANT: before you can use any of this, you have to run the database setup file (supabase/customs-phase-1.sql) in Supabase once. The Customs tab will show a friendly amber banner reminding you if it can\'t find the new tables.',
      'Coming next: putting more than one product on a single clearance, automatically rolling the customs total into your inventory cost so margins reflect true landed cost, and an Excel export that mirrors invoice 1676.',
    ],
  },
  {
    version: 'v55.50',
    date: '2026-05-06',
    label: 'Calendar — fix delete hanging on recurring meetings',
    items: [
      'Deleting a recurring meeting series used to hang for minutes, sometimes never finishing. The Calendar would freeze and you had no way to cancel out of it.',
      'Now: deleting a whole series of meetings (even hundreds of occurrences) finishes in seconds. Same for cancelling.',
      'If something does go wrong (database is down, network is bad), you\'ll see "Delete failed: timed out — try again" after one minute. No more 10-minute waits with a frozen screen.',
      'After a successful delete the success message pops up immediately and the Calendar refreshes in the background. The screen never appears stuck after you\'ve clicked Delete.',
    ],
  },
  {
    version: 'v55.49',
    date: '2026-05-06',
    label: 'Treasury → Create Invoice — fix invisible duplicate prompt',
    items: [
      'When creating a Treasury entry that looked like a duplicate of one already in the system, the "Looks like a duplicate" prompt sometimes appeared invisibly behind the form on iPhone Safari. You\'d tap Confirm, then the next screen never showed up. Fixed — only one prompt is on screen at a time now, and the iPhone Safari display bug can no longer happen.',
      'Friendlier error messages when saving a new invoice. Before, a duplicate order number gave you a scary developer error like "duplicate key value violates unique constraint." Now it just says "Order #2313 already exists as an invoice. Open it from the Sales tab if you want to edit it." Same kind of plain-language wording for permission errors and network errors.',
    ],
  },
  {
    version: 'v55.48',
    date: '2026-05-06',
    label: 'Treasury — "Order # not found" prompt now actually visible',
    items: [
      'When you submitted a Bank In or Cash In with an order number that didn\'t match anything, the "Order # not found — create a new invoice or pick a typo suggestion" prompt was appearing invisibly behind the form. Submit looked like it did nothing. Fixed.',
      'A short message ("Order #2313 not found in your invoice list — see the prompt below") now also pops in the corner so you know exactly what happened.',
    ],
  },
  {
    version: 'v55.47',
    date: '2026-05-06',
    label: 'Treasury + Invoice forms — never silently fail again',
    items: [
      'When you tap Save and something is missing on a Treasury entry, a big red banner now appears at the top of the form listing every missing field. The little corner toasts were vanishing in 2 seconds and getting missed on phones, especially when typing fast.',
      'Required fields now show a red ★ and the missing one gets a red border. The form scrolls automatically to the first missing field — you can\'t miss what needs fixing.',
      'Errors clear automatically as you type into the missing field, so the form goes back to looking normal once it\'s fixed.',
      'Same protection now applies to all four entry types (Cash In, Cash Out, Bank In, Bank Out) and both bank-entry modes (with order number and without).',
      'Invoice form — fixed the bug where you\'d fill in everything (order #, customer name, items) and STILL get told to fill in the customer. The customer search box wasn\'t saving the name unless you tapped a suggestion. Now your typed text is accepted on its own. Plus the error message tells you exactly which field is missing instead of the generic "fill in everything."',
    ],
  },
  {
    version: 'v55.46',
    date: '2026-05-06',
    label: 'Email diagnostics + softer failure mode',
    items: [
      'New Email Status panel at the top of the Admin tab. It shows whether email is set up, recent send results (24-hour count of delivered vs failed), and a "Send test email to me" button that sends a real email and shows the exact result.',
      'When email isn\'t set up, the rest of the app no longer breaks. Notifications still ring the bell inside the app, just not by email. Once you set up Resend in Vercel, every notification automatically starts going out by email — no further action from you.',
      'When email DOES fail, you now see the actual reason (like "domain not verified") instead of a generic "send failed."',
    ],
  },
  {
    version: 'v55.45',
    date: '2026-05-06',
    label: 'System Tickets rewrite + Nadia "Got it" + What\'s New panel',
    items: [
      'System Tickets — the "+ New System Ticket" button now opens reliably every time. Save is disabled while saving so you can\'t accidentally create the same ticket twice. New Delete button (admin only) with a proper confirmation prompt.',
      'Tickets — the Delete confirmation prompt now appears immediately when you tap Delete from inside a ticket. It used to only show after you went back, which was confusing.',
      'Nadia — every pending message and reminder Nadia surfaces now has a "✓ Got it" button. Once you tap it, she stops mentioning that item until something new happens (like the sender adding a reply). Old unanswered items disappear after 7 days so they don\'t haunt you forever.',
      'Dashboard — this very "What\'s New" panel. The latest build always sits at the top of the dashboard with its date; click to expand and see everything that changed.',
    ],
  },
  {
    version: 'v55.44',
    date: '2026-05-05',
    label: 'Shipping import + comment safety + audit log',
    items: [
      'Shipping rates import — a much better Excel template (21 columns, with a Field Guide sheet showing what each column means), an editable preview showing every row before you save, dropdowns to manually re-map columns if the headers don\'t match, and red highlights on rows with missing rates so you can see and remove them.',
      'Ticket comments — the Send button disables on tap and shows "⏳ Sending…" so a triple-tap doesn\'t post your comment three times.',
      'Audit trail — when someone changes a ticket\'s priority or due date, a system entry now appears in the Activity Log: "⚡ Priority changed: MEDIUM → HIGH (by Max)". So you always have a paper trail.',
      'Notifications — every ticket update now reaches the creator + current assignee + any other people assigned to it, with no duplicates and you never get notified about your own actions.',
    ],
  },
  {
    version: 'v55.43',
    date: '2026-05-04',
    label: 'Voice restored + phone "application error" fix',
    items: [
      'Voice — the press-to-record microphone button (🎙) and the hands-free conversation mode (🗣) are both back, with no more "Hey Nadia" wake word.',
      'Phone — fixed the bug where calling our New Jersey numbers played "an application error has occurred" and dropped the call. Now you hear the proper greeting and the call routes correctly.',
    ],
  },
  {
    version: 'v55.42',
    date: '2026-05-02',
    label: 'Bank edit detection',
    items: [
      'When editing an existing bank transaction, the form now correctly detects whether the row was a deposit, withdrawal, or adjustment instead of guessing from the amount. The wrong type was sometimes flipping during edit.',
    ],
  },
  {
    version: 'v55.41',
    date: '2026-05-01',
    label: 'Duplicate-confirm prompt for Treasury',
    items: [
      'When you enter a Treasury transaction that looks like one already in the system (same date + amount + description), a confirmation prompt now shows the matching rows so you can decide before saving. If you confirm "this is genuinely different," the system stamps the entry so the duplicate auditor stops nagging you about it.',
    ],
  },
  {
    version: 'v55.40',
    date: '2026-04-29',
    label: 'Phone — auto-register for inbound calls',
    items: [
      'Phone — when you log in, your browser is now automatically registered to receive incoming calls (provided you\'re set up for browser routing in Settings → Phone). When the phone widget is open, your browser ringer auto-arms.',
      'Voicemail visibility — unread voicemail count now shows on the dashboard widget and on the header bell, polled every 30 seconds.',
    ],
  },
  {
    version: 'v55.39',
    date: '2026-04-28',
    label: 'Voicemail when call forwarding fails',
    items: [
      'Phone — when a forwarded call doesn\'t get answered (busy, no answer, hung up), the caller now hears the proper voicemail prompt and can leave a message. Before they were just hitting a dead line.',
    ],
  },
  {
    version: 'v55.38',
    date: '2026-04-27',
    label: 'Login screen flash fix',
    items: [
      'Login — fixed the brief flash of mismatched layout you saw on the login page right before sign-in finished. Login is smoother and looks consistent now.',
    ],
  },
  {
    version: 'v55.37',
    date: '2026-04-26',
    label: 'WhatsApp inbox',
    items: [
      'WhatsApp — shared company-number inbox in the Communications tab. The team can claim conversations, see which are within the 24-hour reply window, and the inbox refreshes every 20 seconds.',
      'WhatsApp — the wiring behind the inbox (six handlers total) is in place. Once you set up the five Meta credentials in Vercel and tell Meta\'s dashboard where to send incoming messages, customer messages start arriving in the inbox automatically.',
    ],
  },
  {
    version: 'v55.36',
    date: '2026-04-23',
    label: 'AI HR Report — privileged view + scoring formula',
    items: [
      'AI HR Report — Super admin sees every team member including themselves. Other privileged users (with the new "View HR Report" permission) see everyone except themselves.',
      'Scoring formula refined for ticket close-rate, on-time delivery, comment quality, and assignment turnaround. You can pick any time window: yesterday, this week, this month, last 3 months, or this year.',
    ],
  },
  {
    version: 'v55.35',
    date: '2026-04-28',
    label: 'AI HR Report + Emad bounce-out fixes',
    items: [
      'AI HR Report — new tab. Each team member sees their own performance scorecard. Super admins and HR-permitted users see the whole team\'s scorecards.',
      'Login — fixed five bugs that were bouncing Emad out of the system: case-insensitive email matching, browser lock manager fallback, secondary auth-id lookup, voicemail token header, and PWA manifest.',
    ],
  },
  {
    version: 'v55.34',
    date: '2026-04-27',
    label: 'AI HR Report — first version',
    items: [
      'AI HR Report — initial build of the performance dashboard. Pulls together ticket close-rates, on-time delivery, audit-log activity, and comment quality. (Refined further in v55.35 and v55.36.)',
    ],
  },
  {
    version: 'v55.33',
    date: '2026-04-25',
    label: 'Recurring events — three-scope cancel/edit/restore',
    items: [
      'Calendar — when editing or cancelling or restoring a recurring meeting, you now pick the scope: just this one occurrence, this one and all later ones, or the entire series. Previously the only option was "the whole series" which was rarely what you wanted.',
    ],
  },
  {
    version: 'v55.32',
    date: '2026-04-24',
    label: 'WhatsApp inbox UI scaffolding',
    items: [
      'WhatsApp — inbox UI added to the Communications tab. Database tables, send and receive routes, and Nadia commands wired in. (Made fully usable in v55.37.)',
    ],
  },
  {
    version: 'v55.31',
    date: '2026-04-23',
    label: 'WhatsApp scaffolding (Meta Cloud API)',
    items: [
      'WhatsApp — the foundation is in: database tables, helper code, the way Meta sends messages to us, and the way we send messages back. About 40% of the full feature. The on-screen inbox is not in this build.',
      'Customers messaging your WhatsApp number land in the database within seconds, but you can\'t see them in the app yet — wait for v55.32.',
    ],
  },
  {
    version: 'v55.30',
    date: '2026-04-22',
    label: 'Calendar columns + reminder dispatch',
    items: [
      'Calendar — week view shows 7 columns instead of cramming everything into one. Reminder dispatch fires every 10 minutes via the cron job.',
    ],
  },
  {
    version: 'v55.29',
    date: '2026-04-21',
    label: 'Reminders engine + dashboard split',
    items: [
      'Reminders — every event with a reminder gets pre-scheduled. Dispatch cron runs every 10 minutes and sends due reminders. The dashboard splits reminders into urgent (with a pulse animation) and normal.',
    ],
  },
  {
    version: 'v55.28',
    date: '2026-04-20',
    label: 'Calendar event description + meeting notes',
    items: [
      'Calendar — events now have a description/agenda field and a meeting-notes field that you can edit before, during, or after the meeting.',
    ],
  },
  {
    version: 'v55.27',
    date: '2026-04-19',
    label: 'Treasury dedup hardening + ghost-row restoration',
    items: [
      'Treasury — restored 4,020,000 EGP across 3 missing rows that had been removed by an over-aggressive dedup pass. 78 invoices recalculated. New unique-row constraint added so this can\'t happen again.',
      'Treasury — running balance now calculated by transaction date instead of insert order, so backdated entries fall in the right place.',
    ],
  },
  {
    version: 'v55.26',
    date: '2026-04-18',
    label: 'Treasury inspector modal + 90-day window',
    items: [
      'Treasury — click any row to see a full inspector modal: linked invoice, linked check, audit history, related rows. Default view shows the last 90 days; older rows are one filter click away.',
    ],
  },
  {
    version: 'v55.25',
    date: '2026-04-17',
    label: 'Treasury ↔ Sales smart linking',
    items: [
      'Treasury — Order # field auto-suggests existing invoices as you type, suggests typo fixes if no exact match, lets you create a new invoice inline without leaving the form, and back-fills the link the moment a matching invoice is created later.',
    ],
  },
  {
    version: 'v55.24',
    date: '2026-04-16',
    label: 'Egypt Bank tab + Plaid Bank tab',
    items: [
      'Banking — Egypt Bank tab now separates true bank entries from cash-register entries. Plaid Bank tab connects US bank accounts and pulls transactions automatically.',
    ],
  },
  {
    version: 'v55.23',
    date: '2026-04-15',
    label: 'AI Accountant — 14-check auditor',
    items: [
      'AI Accountant — runs 14 reconciliation checks at once: orphan rows, mismatches between invoice and treasury, ambiguous duplicates, stale checks (90+ days), uncategorized expenses, and more. Each check is a one-click fix.',
    ],
  },
  {
    version: 'v55.22',
    date: '2026-04-14',
    label: 'Check reconcile — three modes',
    items: [
      'Checks — the reconcile flow now has three clear modes: exact-amount match, partial match, and "physical check returned." Each match links the check directly to its source row so the audit trail stays clean.',
    ],
  },
  {
    version: 'v55.21',
    date: '2026-04-13',
    label: 'Bilingual categories',
    items: [
      'Categories — every income and expense category now has both an English label and an Arabic label. Arabic is the stable internal key; English is the display label. Add new categories from Settings → Categories and they appear in every dropdown immediately.',
    ],
  },
  {
    version: 'v55.20',
    date: '2026-04-12',
    label: 'Shipping rates / quotes / multi-booking + 1-year history',
    items: [
      'Shipping — quotes can include multiple bookings on one document. Rates history defaults to the last year, with expired rates preserved (struck through). Export to CSV.',
    ],
  },
  {
    version: 'v55.19',
    date: '2026-04-11',
    label: 'CRM 6-stage pipeline + assigned rep',
    items: [
      'CRM — six pipeline stages: Lead → Contacted → Qualified → Proposal → Won → Lost. Each customer can have an assigned rep who always sees their full contact info even when contact masking is on.',
    ],
  },
  {
    version: 'v55.18',
    date: '2026-04-10',
    label: 'CRM contact masking',
    items: [
      'CRM — new "View Contacts" permission. Without it, customer phone and email are masked and the WhatsApp / Call / Email buttons are hidden. Assigned reps always see their own clients in full.',
    ],
  },
  {
    version: 'v55.17',
    date: '2026-04-09',
    label: 'Tickets — detail view, reassign, activity log',
    items: [
      'Tickets — full detail view with opened-by, assigned-to (reassignable), due date with overdue highlighting, color-coded status, and a unified Activity Log that separates system events from user comments.',
    ],
  },
  {
    version: 'v55.16',
    date: '2026-04-08',
    label: 'Calendar with attendees + recurring events',
    items: [
      'Calendar — events have multiple attendees, recurring schedules, and a series ID that ties recurring rows together for clean cancel/edit/delete.',
    ],
  },
  {
    version: 'v55.15',
    date: '2026-04-07',
    label: 'Nadia voice with Whisper + lip-sync face',
    items: [
      'Nadia — voice transcription powered by Whisper. Continuous mode with 3.5-second silence timeout. Animated NadiaFace SVG with lip-sync. Cairo and Eastern timezone awareness so date/time questions answer correctly for both teams.',
    ],
  },
  {
    version: 'v55.14',
    date: '2026-04-06',
    label: 'Nadia proactive ticket surfacing',
    items: [
      'Nadia — proactively surfaces overdue tickets and upcoming due dates on the dashboard. Every user gets relevant items, not just admins.',
    ],
  },
  {
    version: 'v55.13',
    date: '2026-04-05',
    label: 'Wake-word re-engage + cross-team messaging',
    items: [
      'Nadia — say "Hey Nadia" to re-engage after she pauses. Cross-team messaging routes Nadia\'s suggestions to the right person automatically.',
    ],
  },
  {
    version: 'v55.12',
    date: '2026-04-04',
    label: 'Treasury — non-order income guard',
    items: [
      'Treasury — when entering income, the form now requires you to either enter an order number OR pick a "non-order income" category. No more orphan income rows that nobody can trace later.',
    ],
  },
  {
    version: 'v55.11',
    date: '2026-04-03',
    label: 'Announcements/broadcast + login session tracking',
    items: [
      'Dashboard — admin-posted announcements (urgent, warning, info) targetable to all or to specific users, with email/WhatsApp notification, pin, and archive.',
      'Login — every login records its time. Heartbeat updates last_seen every 5 minutes. Logout time is stamped. Team daily-log cards show login/logout/duration.',
    ],
  },
  {
    version: 'v55.10',
    date: '2026-04-02',
    label: 'Quotes tab — company profiles + PDF + VAT',
    items: [
      'Quotes — new tab. Build company profiles with logos, create line-item quotes, toggle 14% VAT (editable), set validity/expiry dates, preview and print as PDF, and review your quote history.',
    ],
  },
  {
    version: 'v55.09',
    date: '2026-04-01',
    label: 'Audit trail — late edits flagged',
    items: [
      'Audit — any change made 24+ hours after the original creation is flagged with 🚨. Sensitive fields (amount, price, date, description, qty) get an extra ⚠️ badge. The before-and-after values are stored so you can see exactly what was changed.',
    ],
  },
  {
    version: 'v55.08',
    date: '2026-03-31',
    label: 'Read-only mode',
    items: [
      'Permissions — when a tab is on but the Edit permission is off, you can view but not change. The header pattern is now consistent across every module.',
    ],
  },
  {
    version: 'v55.07',
    date: '2026-03-30',
    label: 'Inventory — unit of measure + linear density + P&L per unit',
    items: [
      'Inventory — every product has a unit of measure (kg, ton, meter, yard) and an optional linear density. Profit/loss now shows per-kg, per-ton, per-meter, or per-yard automatically based on the product\'s unit.',
      'Inventory — manual Expected Inventory entry form for opening stock counts. Breakdown panel as a unified table with dimension tabs.',
    ],
  },
  {
    version: 'v55.06',
    date: '2026-03-29',
    label: 'Inventory — split permissions + audit journal',
    items: [
      'Inventory — Edit Inventory permission and Adjust Inventory Quantities permission are now separate. Every quantity adjustment writes an audit journal entry with the user, the before/after, and a reason field.',
    ],
  },
  {
    version: 'v55.05',
    date: '2026-03-28',
    label: 'Priority Board + ticket creation buttons',
    items: [
      'Tickets — priority-ranked board with drag-to-reorder. Unranked items live in a pile at the bottom and can also be reordered. "+ Add first ticket" and "+ New ticket for [Name]" buttons follow your permissions.',
    ],
  },
  {
    version: 'v55.04',
    date: '2026-03-27',
    label: 'Admin dashboard — drill-downs + login tracking',
    items: [
      'Admin — every scorecard pill drill-downs into the underlying rows. Preset date filters (today is the default). Login tracking columns in Eastern Time. Bubble charts for activity drill-down.',
    ],
  },
  {
    version: 'v55.03',
    date: '2026-03-26',
    label: 'Settings — team profiles for Nadia',
    items: [
      'Settings → Team Profiles — fields for nickname, birthday, location, phone, job title, years at the company, family, interests, favorite food, personality, strengths, weaknesses, conversation starters, notes, and preferred language. Nadia uses these for personalized conversations.',
    ],
  },
  {
    version: 'v55.02',
    date: '2026-03-25',
    label: 'Notifications fixed (4 bugs at once)',
    items: [
      'Notifications — fixed four problems that were silently swallowing tickets, CRM, and reminder emails: wrong table name, fragile filter, the literal string "all" breaking a database call, and zero log output to debug from. Notifications now reliably reach the bell + email.',
    ],
  },
  {
    version: 'v55.01',
    date: '2026-03-24',
    label: 'Treasury data cleanup — 154 transactions fixed',
    items: [
      'Treasury — 126 future-dated transactions corrected (year shifts like 2026→2025), 22 individual bad dates fixed (typos: 2044→2024, 5025→2025; pre-2014 drag errors), 6 April 2026→2025 entries fixed. Validation pass: 0 future dates, 0 pre-2014 dates remain. 5,799 rows (93%) match Excel exactly. 41 "missing" rows confirmed as Arabic name variants already in the database. 601 zero-EGP rows identified as legitimate USD-column entries.',
    ],
  },
];

// v55.64 — cap how many builds we render to keep the modal snappy.
// Older entries stay in the array (good for searchability and history)
// but only the most recent N are shown in the UI.
var DISPLAY_LIMIT = 100;

export default function WhatsNewWidget({ isAdmin, isSuperAdmin, prominent } = {}) {
  // v55.67 — non-admin users should not see implementation details.
  // v55.73 — Three tiers per Max May 8 2026:
  //   PUBLIC      — everyone sees this (default)
  //   adminOnly   — admins + super_admin only
  //   superAdminOnly — super_admin ONLY (AI architecture details)
  // For AI-related changes (Nadia/Jenna/Sara/HR Rep/Work Coach internals),
  // Max's rule: "Only super admin sees all details. He sees all details
  // regardless. For all other team members they will see the build with
  // the exception of any AI-related changes, in which use only high-level
  // wording." So AI internals are superAdminOnly; a high-level public
  // bullet should also be present so non-super-admins see something.
  var canSeeAdminInternals = !!(isAdmin || isSuperAdmin);
  var canSeeAiConfidential = !!isSuperAdmin;

  var filterEntry = function (entry) {
    // Drop entirely-superAdminOnly entries for non-super-admins.
    if (entry.superAdminOnlyEntry && !canSeeAiConfidential) return null;
    // Drop entirely-admin entries for non-admins.
    if (entry.adminOnlyEntry && !canSeeAdminInternals) return null;
    // Filter individual bullet items inside the entry.
    var visibleItems = entry.items.filter(function (it) {
      if (typeof it === 'string') return true;
      // superAdminOnly bullets only visible to super_admin
      if (it.superAdminOnly && !canSeeAiConfidential) return false;
      // adminOnly bullets visible to admin + super_admin
      if (it.adminOnly && !canSeeAdminInternals) return false;
      return true;
    });
    // If filtering left nothing visible, drop the entire entry.
    if (visibleItems.length === 0) return null;
    return Object.assign({}, entry, { items: visibleItems });
  };

  var [open, setOpen] = useState(false);
  var [expanded, setExpanded] = useState({}); // map of version → bool
  // v55.64 — track which version this user has already seen (per browser).
  // We compare BUILD_HISTORY against this to figure out which entries are
  // NEW since their last visit. Closing the modal saves the latest as seen.
  var [lastSeen, setLastSeen] = useState(null);
  var [hasMounted, setHasMounted] = useState(false);
  // v55.65 — live-pull bugs that Claude fixed for each build version.
  // Shape: { 'v55.65': [{title, ticket_number, claude_fix_notes, ...}, ...] }
  var [bugsByBuild, setBugsByBuild] = useState({});

  var STORAGE_KEY = 'ktc_whatsnew_last_seen_version';

  useEffect(function () {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      setLastSeen(v || null);
    } catch (_) {}
    setHasMounted(true);
    // v55.65 — fetch the bug-fixes attached to recent builds. Independent
    // try/catch so a missing system_tickets table doesn't break What's New.
    (async function () {
      try {
        var res = await supabase.from('system_tickets')
          .select('id,ticket_number,title,claude_fix_notes,claude_fixed_in_build_version,created_by,retest_outcome')
          .not('claude_fixed_in_build_version', 'is', null)
          .order('claude_last_fixed_at', { ascending: false })
          .limit(200);
        if (res && res.data) {
          var grouped = {};
          res.data.forEach(function (b) {
            var v = b.claude_fixed_in_build_version;
            if (!v) return;
            if (!grouped[v]) grouped[v] = [];
            grouped[v].push(b);
          });
          setBugsByBuild(grouped);
        }
      } catch (e) {
        // Table missing or RLS blocked — fail silent, this is decorative.
      }
    })();
  }, []);

  var latest = BUILD_HISTORY[0];
  // v55.67 — apply admin/non-admin filtering to BUILD_HISTORY before rendering.
  // Drops entries that have nothing visible left, drops admin-only items
  // inside otherwise-visible entries.
  var filteredHistory = BUILD_HISTORY.map(filterEntry).filter(function (e) { return e !== null; });
  // Only render the most recent N visible builds.
  var visibleBuilds = filteredHistory.slice(0, DISPLAY_LIMIT);
  // Re-anchor "latest" against the filtered list so the pill label and the
  // unseen-tracking compare against what THIS user can actually see.
  if (visibleBuilds.length > 0) latest = visibleBuilds[0];

  // Build the list of "unseen" version strings — every version published
  // AFTER (i.e. higher up in the array than) the last one this user saw.
  // If they've never opened it before, EVERYTHING since their first visit
  // counts as new (we cap to most-recent build to avoid overwhelming them).
  var unseenVersions = [];
  if (hasMounted) {
    if (!lastSeen) {
      // First-time visitor — only flag the most recent build so they're
      // not buried in years of history on day one.
      unseenVersions = [latest.version];
    } else {
      for (var i = 0; i < visibleBuilds.length; i++) {
        if (visibleBuilds[i].version === lastSeen) break;
        unseenVersions.push(visibleBuilds[i].version);
      }
    }
  }
  var unseenCount = unseenVersions.length;
  var hasUnseen = unseenCount > 0;

  var fmtDate = function (iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) { return iso; }
  };

  // v55.81 #23 (Max May 9 2026): relative-time helper so the user sees
  // "shipped 2 days ago" next to the version date, not just the date.
  // Builds older than ~30 days fall back to the date format.
  // v55.81 QA-8: also log a console.warn when the date is in the future
  // (build-date typo, timezone weirdness) so it's debuggable. Returns
  // empty so the caller falls back to the absolute date format silently.
  var relativeTime = function (iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var now = new Date();
      var diffMs = now.getTime() - d.getTime();
      if (diffMs < 0) {
        try { console.warn('[whatsnew] build date is in the future:', iso, '— check the BUILD_HISTORY entry.'); } catch (_) {}
        return '';
      }
      var oneDay = 24 * 60 * 60 * 1000;
      var days = Math.floor(diffMs / oneDay);
      if (days === 0) {
        var hours = Math.floor(diffMs / (60 * 60 * 1000));
        if (hours < 1) return 'just now';
        if (hours === 1) return '1 hour ago';
        return hours + ' hours ago';
      }
      if (days === 1) return 'yesterday';
      if (days < 7) return days + ' days ago';
      if (days < 14) return '1 week ago';
      if (days < 30) return Math.floor(days / 7) + ' weeks ago';
      return ''; // older — caller will show absolute date instead
    } catch (_) { return ''; }
  };

  var togglePanel = function (v) {
    setExpanded(function (prev) {
      var next = Object.assign({}, prev);
      next[v] = !prev[v];
      return next;
    });
  };

  // When opening the modal, auto-expand every unseen build so the user
  // can scan everything that changed since they were last here without
  // clicking each one.
  var openModal = function () {
    var initialExpand = {};
    if (unseenVersions.length > 0) {
      unseenVersions.forEach(function (v) { initialExpand[v] = true; });
    } else {
      initialExpand[latest.version] = true;
    }
    setExpanded(initialExpand);
    setOpen(true);
  };

  // When closing, mark everything as seen by remembering the latest version.
  var closeModal = function () {
    try { window.localStorage.setItem(STORAGE_KEY, latest.version); } catch (_) {}
    setLastSeen(latest.version);
    setOpen(false);
  };

  return (
    <>
      {/* v55.82-J — Prominent mode renders a full-width banner instead of a
          small pill. Used on the Dashboard immediately after the AI Workforce
          hero (per Max May 11 2026: "the bill what's in the bill should be
          right after the AI"). Pill mode is preserved for anywhere else the
          widget shows up. */}
      {prominent ? (
        <button
          onClick={openModal}
          title={hasUnseen ? (unseenCount + ' update' + (unseenCount === 1 ? '' : 's') + ' since you were last here') : "What's new in this build"}
          className={'w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-white font-bold shadow-md hover:shadow-lg transition text-left ' + (hasUnseen ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 ring-2 ring-rose-200' : 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600')}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl">✨</span>
            <div className="min-w-0">
              <div className="text-sm font-extrabold truncate">
                {hasUnseen
                  ? (unseenCount + ' new update' + (unseenCount === 1 ? '' : 's') + ' since you were last here')
                  : ('What\'s new in ' + latest.version)}
              </div>
              <div className="text-[11px] font-normal opacity-90 truncate">
                {latest.label || ''}
                {latest.label ? ' · ' : ''}
                {fmtDate(latest.date)}
                {(function () { var rel = relativeTime(latest.date); return rel ? ' · ' + rel : ''; })()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasUnseen && (
              <span className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded-full bg-white text-rose-600 text-xs font-extrabold">
                +{unseenCount}
              </span>
            )}
            <span className="text-xs opacity-90">Tap to read →</span>
          </div>
        </button>
      ) : (
      /* Inline pill — visible on the dashboard. */
      <button
        onClick={openModal}
        title={hasUnseen ? (unseenCount + ' update' + (unseenCount === 1 ? '' : 's') + ' since you were last here') : "What's new in this build"}
        className={'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-white text-xs font-bold shadow hover:shadow-md transition ' + (hasUnseen ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 ring-2 ring-rose-200 animate-pulse' : 'bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600')}
      >
        <span>✨</span>
        <span>
          {hasUnseen
            ? ('+' + unseenCount + ' new since your last visit')
            : ('What\'s new in ' + latest.version)}
        </span>
        <span className="opacity-70 text-[10px] font-normal">· {fmtDate(latest.date)}{(function () { var rel = relativeTime(latest.date); return rel ? ' · ' + rel : ''; })()}</span>
        {hasUnseen && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white text-rose-600 text-[10px] font-extrabold">
            {unseenCount}
          </span>
        )}
      </button>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
            style={{ maxHeight: '85vh' }}
            onClick={function (e) { e.stopPropagation(); }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                  <span>✨</span> What's new in NextTrade Hub
                  {hasUnseen && (
                    <span className="ml-2 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold uppercase tracking-wide">
                      {unseenCount} new for you
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {hasUnseen
                    ? ('Highlights below are everything that changed since you were last here. They\'ll be marked as seen when you close this.')
                    : 'Latest builds and what changed in each.'}
                </p>
              </div>
              <button
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none px-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="overflow-auto p-5" style={{ flex: '1 1 auto', minHeight: 0 }}>
              <div className="space-y-3">
                {visibleBuilds.map(function (b, i) {
                  var isOpen = !!expanded[b.version];
                  var isLatest = i === 0;
                  var isNewForUser = unseenVersions.indexOf(b.version) !== -1;
                  return (
                    <div
                      key={b.version + '_' + i}
                      className={'rounded-xl border ' + (isNewForUser ? 'border-rose-300 bg-gradient-to-br from-rose-50/60 to-pink-50/40 shadow-sm' : isLatest ? 'border-indigo-200 bg-gradient-to-br from-indigo-50/40 to-violet-50/40' : 'border-slate-200 bg-white')}
                    >
                      <button
                        onClick={function () { togglePanel(b.version); }}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50/40 transition rounded-xl"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className={'text-xs font-mono font-bold px-2 py-0.5 rounded ' + (isNewForUser ? 'bg-rose-500 text-white' : isLatest ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-700')}>
                            {b.version}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0">{fmtDate(b.date)}</span>
                          {isNewForUser && <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wide flex-shrink-0">NEW for you</span>}
                          {!isNewForUser && isLatest && <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide flex-shrink-0">Latest</span>}
                          <span className="text-xs text-slate-700 truncate">{b.label}</span>
                        </div>
                        <span className="text-slate-400 ml-2 flex-shrink-0">{isOpen ? '▾' : '▸'}</span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1">
                          <ul className="space-y-2">
                            {b.items.map(function (item, idx) {
                              // v55.67 — items can be a plain string OR an
                              // object { text, adminOnly }. Filtering already
                              // happened upstream (filterEntry); this is just
                              // about extracting the visible text safely.
                              var itemText = typeof item === 'string' ? item : (item && item.text) || '';
                              return (
                                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                                  <span className={(isNewForUser ? 'text-rose-400' : 'text-indigo-400') + ' mt-0.5 flex-shrink-0'}>•</span>
                                  <span>{itemText}</span>
                                </li>
                              );
                            })}
                          </ul>
                          {/* v55.65 — live bug-fixes pulled from system_tickets */}
                          {bugsByBuild[b.version] && bugsByBuild[b.version].length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <div className="text-[10px] font-bold text-violet-700 uppercase tracking-wide mb-2">
                                🐛 Bug fixes shipped in this build ({bugsByBuild[b.version].length})
                              </div>
                              <ul className="space-y-1.5">
                                {bugsByBuild[b.version].map(function (bug) {
                                  return (
                                    <li key={bug.id} className="flex items-start gap-2 text-xs text-slate-700 bg-violet-50/40 rounded p-2">
                                      <span className="text-violet-400 mt-0.5">🐛</span>
                                      <div className="flex-1">
                                        <span className="font-bold">{bug.title}</span>
                                        {bug.ticket_number && <span className="text-[9px] text-violet-500 ml-2 font-mono">{bug.ticket_number}</span>}
                                        {bug.retest_outcome === 'passed' && <span className="ml-2 text-[9px] text-emerald-700 font-bold">✓ verified</span>}
                                        {bug.retest_outcome === 'failed' && <span className="ml-2 text-[9px] text-rose-700 font-bold">✗ retest failed</span>}
                                        {bug.claude_fix_notes && (
                                          <div className="text-[10px] text-slate-600 mt-0.5 whitespace-pre-wrap">{bug.claude_fix_notes}</div>
                                        )}
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredHistory.length > DISPLAY_LIMIT && (
                  <div className="text-center text-[10px] text-slate-500 pt-2">
                    Older entries ({filteredHistory.length - DISPLAY_LIMIT}) are archived in the source file but not shown here.
                  </div>
                )}
              </div>
            </div>

            {/* Footer
                v55.81 #23 (Max May 9 2026): added a "Reload page to get
                the latest" button. Browsers cache the JS bundle, so a
                user who left the tab open from yesterday may still be
                running yesterday's build. The button forces a refresh
                so they pick up any newer build that has shipped since
                they opened the tab, without making them close the
                browser. We also show the current build + how fresh it
                is right next to the button so they can decide whether
                to bother. */}
            <div className="border-t border-slate-100 p-3 flex justify-between items-center gap-3 flex-wrap">
              <span className="text-[10px] text-slate-500">
                You're on <span className="font-mono font-bold text-slate-700">{latest.version}</span>{(function () { var rel = relativeTime(latest.date); return rel ? ' · shipped ' + rel : ' · ' + fmtDate(latest.date); })()}
                {hasUnseen ? ' · closing this marks all ' + unseenCount + ' as seen.' : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={function () {
                    // v55.81 #23 + QA-1/QA-2 (Max May 9 2026): two fixes here.
                    //   (a) plain location.reload() doesn't actually bypass
                    //       the browser's HTTP cache — modern browsers may
                    //       still serve the old JS bundle. Append a cache-
                    //       bust query string so the reload pulls fresh.
                    //   (b) v55.77 specifically protects HR draft text on
                    //       persona switch. The reload kills that draft.
                    //       Confirm with the user before reloading if a
                    //       draft is detected (open modal, draft body in
                    //       state). The check is best-effort — looks for
                    //       any element with data-ktc-draft-active="true"
                    //       or any visible textarea with content.
                    var hasUnsavedDraft = false;
                    try {
                      var markedDraft = document.querySelector('[data-ktc-draft-active="true"]');
                      if (markedDraft) hasUnsavedDraft = true;
                      if (!hasUnsavedDraft) {
                        var areas = document.querySelectorAll('textarea');
                        for (var ti = 0; ti < areas.length; ti++) {
                          var ta = areas[ti];
                          if (ta && ta.value && ta.value.trim().length > 10 && ta.offsetParent !== null) {
                            hasUnsavedDraft = true;
                            break;
                          }
                        }
                      }
                    } catch (_) {}
                    if (hasUnsavedDraft) {
                      var ok = window.confirm('Reloading will discard anything you\u2019ve been typing in an open form. Continue?');
                      if (!ok) return;
                    }
                    try {
                      // Cache-bust: append a unique query string so the
                      // browser must re-fetch instead of serving from cache.
                      var u = new URL(window.location.href);
                      u.searchParams.set('_v', Date.now().toString());
                      window.location.href = u.toString();
                    } catch (_) {
                      try { window.location.reload(); } catch (__) {}
                    }
                  }}
                  title="Reloads the dashboard so you pick up any newer build that has shipped since you opened this tab. Will warn you first if a form has unsaved text."
                  className="px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50">
                  ↻ Reload for latest
                </button>
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-bold hover:bg-slate-800"
                >
                  {hasUnseen ? 'Got it — mark all seen' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
