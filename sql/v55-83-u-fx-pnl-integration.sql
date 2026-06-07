-- v55.83-U — FX P&L INTEGRATION (COGS in EGP at entry-rate + realized FX)
-- ──────────────────────────────────────────────────────────────────
-- WHAT THIS DOES (plain English)
--   When you SELL inventory-linked goods, the system already knew the native
--   (USD/EUR/EGP) cost via FIFO. This makes it also record, on each sold line:
--     • EGP cost locked the day the goods were RECEIVED  (cogs_egp_at_receipt)
--     • EGP gross profit = EGP sale - that EGP cost       (gross_profit_egp = REAL MARGIN)
--     • Realized FX gain/(loss) from the pound moving between buy and sell
--       (realized_fx_egp = cost@receipt - cost@sale ; NEGATIVE when EGP devalued)
--   Identity (validated in __tests__/mock-fx-pnl-model.js, 22/22):
--     gross_profit_egp + realized_fx_egp = EGP sale - EGP cost@sale  (economic GP)
--   Requires the FX rate for the receipt date and the invoice date to exist in
--   fx_rates (sql .63). If a rate is missing for a USD layer, that line falls
--   back to native EGP-equivalent with FX delta 0 (never invents a rate).
-- ALL ADDITIVE — older consumed lines keep their values; new columns are NULL
-- until a line is re-consumed.

-- 1) EGP P&L columns on the sold line
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cogs_egp_at_receipt NUMERIC(14,2);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS gross_profit_egp    NUMERIC(14,2);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS realized_fx_egp     NUMERIC(14,2);

-- 2) Corrected consumption function — single inventory engine (System A).
--    Adds entry-rate EGP COGS accumulation + the EGP profit split. Keeps the
--    existing native cogs_total / gross_profit / cost_egp_at_sale fields intact.
CREATE OR REPLACE FUNCTION consume_invoice_item_inventory(p_item_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_item                invoice_items%ROWTYPE;
  v_resolved_variant    uuid;
  v_layer               record;
  v_remaining           numeric;
  v_consumed_qty        numeric;
  v_consumed_cost       numeric;
  v_total_cogs          numeric := 0;
  v_total_consumed      numeric := 0;
  v_consumed_layers     jsonb := '[]'::jsonb;
  v_backorder_qty       numeric := 0;
  v_backorder_id        uuid;
  v_template_row        inventory_products%ROWTYPE;
  v_invoice_date        date;
  v_fx_rate_at_sale     numeric;
  v_cost_egp_at_sale    numeric := 0;
  v_cost_egp_at_receipt numeric := 0;   -- v55.83-U: real EGP cost, locked at purchase
  v_layer_fx            numeric;
  v_line_total          numeric;
  v_entry_egp_slice     numeric;
BEGIN
  SELECT * INTO v_item FROM invoice_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice item % not found', p_item_id; END IF;

  IF v_item.inventory_status = 'consumed' THEN
    RETURN jsonb_build_object('already_consumed', true, 'consumed_layers', v_item.consumed_layers,
      'cogs_total', v_item.cogs_total, 'item_id', p_item_id);
  END IF;
  IF v_item.uses_inventory IS NOT TRUE THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_uses_inventory');
  END IF;
  IF v_item.variant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice item % marked uses_inventory but has no variant_id', p_item_id;
  END IF;
  IF v_item.sale_quantity IS NULL OR v_item.sale_quantity <= 0 THEN
    RAISE EXCEPTION 'Invoice item % has invalid sale_quantity (%)', p_item_id, v_item.sale_quantity;
  END IF;

  v_resolved_variant := v_item.variant_id;
  SELECT * INTO v_template_row FROM inventory_products WHERE id = v_item.variant_id;
  IF v_template_row.is_family_template = true THEN
    RAISE EXCEPTION 'Invoice item % is linked to family template % — pick a specific variant', p_item_id, v_item.variant_id;
  END IF;

  SELECT invoice_date INTO v_invoice_date FROM invoices WHERE id = v_item.invoice_id;
  IF v_invoice_date IS NULL THEN v_invoice_date := CURRENT_DATE; END IF;
  v_line_total := COALESCE(v_item.line_total, 0);
  v_remaining  := v_item.sale_quantity;

  BEGIN
    FOR v_layer IN
      SELECT id, product_id, warehouse_id, cost_per_uom, cost_currency, qty_remaining,
             receipt_date, cost_egp_at_receipt
      FROM inventory_layers
      WHERE product_id = v_resolved_variant
        AND (v_item.warehouse_id IS NULL OR warehouse_id = v_item.warehouse_id)
        AND qty_remaining > 0
      ORDER BY receipt_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_consumed_qty   := LEAST(v_layer.qty_remaining, v_remaining);
      v_consumed_cost  := v_consumed_qty * v_layer.cost_per_uom;
      v_total_cogs     := v_total_cogs + v_consumed_cost;
      v_total_consumed := v_total_consumed + v_consumed_qty;
      v_remaining      := v_remaining - v_consumed_qty;

      -- Entry-rate EGP cost for this slice (cost_egp_at_receipt is PER-UOM).
      -- Fall back to native cost only when the receipt FX snapshot is missing.
      v_entry_egp_slice := v_consumed_qty * COALESCE(v_layer.cost_egp_at_receipt, v_layer.cost_per_uom);
      v_cost_egp_at_receipt := v_cost_egp_at_receipt + v_entry_egp_slice;

      -- Sale-rate EGP value of the SAME native cost (FX revaluation at invoice date)
      IF v_layer.cost_currency = 'EGP' OR v_layer.cost_currency IS NULL THEN
        v_cost_egp_at_sale := v_cost_egp_at_sale + v_consumed_cost;
      ELSE
        BEGIN
          v_layer_fx := fx_rate_for_date(v_layer.cost_currency, 'EGP', v_invoice_date);
          IF v_layer_fx IS NOT NULL THEN
            v_cost_egp_at_sale := v_cost_egp_at_sale + (v_consumed_cost * v_layer_fx);
            v_fx_rate_at_sale  := v_layer_fx;
          ELSE
            v_cost_egp_at_sale := v_cost_egp_at_sale + v_entry_egp_slice;  -- no rate: FX delta 0
          END IF;
        EXCEPTION WHEN undefined_function THEN
          v_cost_egp_at_sale := v_cost_egp_at_sale + v_entry_egp_slice;
        END;
      END IF;

      UPDATE inventory_layers
        SET qty_remaining = qty_remaining - v_consumed_qty, updated_at = now()
        WHERE id = v_layer.id;

      v_consumed_layers := v_consumed_layers || jsonb_build_object(
        'layer_id', v_layer.id, 'qty_consumed', v_consumed_qty,
        'cost_per_uom', v_layer.cost_per_uom, 'cost_currency', v_layer.cost_currency,
        'cost_egp_at_receipt_per_uom', v_layer.cost_egp_at_receipt,
        'total_cost', v_consumed_cost, 'receipt_date', v_layer.receipt_date);
    END LOOP;
  EXCEPTION WHEN undefined_table THEN
    RAISE EXCEPTION 'inventory_layers table missing — run Build 4.3 SQL before consuming';
  END;

  IF v_remaining > 0 THEN
    v_backorder_qty := v_remaining;
    INSERT INTO inventory_backorders (invoice_id, variant_id, warehouse_id, qty_short, uom, status, notes)
    VALUES (v_item.invoice_id, v_resolved_variant, v_item.warehouse_id, v_backorder_qty, v_item.uom, 'open',
      'Auto-created at invoice submit — sale qty (' || v_item.sale_quantity || ') exceeded stock (' || v_total_consumed || ')')
    RETURNING id INTO v_backorder_id;
  END IF;

  UPDATE invoice_items
  SET consumed_layers       = v_consumed_layers,
      cogs_total            = v_total_cogs,                              -- native (USD/etc)
      gross_profit          = v_line_total - v_total_cogs,              -- legacy (kept)
      inventory_consumed_at = now(),
      inventory_status      = 'consumed',
      backorder_qty         = v_backorder_qty,
      cost_egp_at_sale      = CASE WHEN v_cost_egp_at_sale    > 0 THEN v_cost_egp_at_sale    ELSE NULL END,
      fx_rate_at_sale       = v_fx_rate_at_sale,
      cogs_egp_at_receipt   = CASE WHEN v_cost_egp_at_receipt > 0 THEN v_cost_egp_at_receipt ELSE NULL END,
      gross_profit_egp      = v_line_total - v_cost_egp_at_receipt,     -- REAL MARGIN
      realized_fx_egp       = v_cost_egp_at_receipt - v_cost_egp_at_sale -- NEG = FX loss
  WHERE id = p_item_id;

  RETURN jsonb_build_object(
    'item_id', p_item_id, 'total_consumed', v_total_consumed,
    'cogs_total', v_total_cogs, 'cogs_egp_at_receipt', v_cost_egp_at_receipt,
    'cost_egp_at_sale', v_cost_egp_at_sale, 'fx_rate_at_sale', v_fx_rate_at_sale,
    'gross_profit_egp', v_line_total - v_cost_egp_at_receipt,
    'realized_fx_egp', v_cost_egp_at_receipt - v_cost_egp_at_sale,
    'backorder_qty', v_backorder_qty, 'backorder_id', v_backorder_id);
END;
$$ LANGUAGE plpgsql;

-- VERIFY after running:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='invoice_items' AND column_name IN ('cogs_egp_at_receipt','gross_profit_egp','realized_fx_egp');
--   -- and confirm THIS is the deployed function (no plain 44c override after it):
--   SELECT pg_get_functiondef('consume_invoice_item_inventory(uuid)'::regprocedure) LIKE '%cogs_egp_at_receipt%';
