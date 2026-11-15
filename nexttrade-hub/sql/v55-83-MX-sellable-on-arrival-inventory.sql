-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-MX — Sales invoices actually deduct inventory
--
-- SCHEMA AUDIT (Max, Aug 10 2026) proved the real cause. The invoice->inventory
-- link migration was NEVER RUN in production. invoice_items is missing every
-- column that ties a sale to a product: uses_inventory, variant_id,
-- warehouse_id, uom, sale_quantity, sale_price_per_uom, inventory_status,
-- consumed_layers, cogs_total, gross_profit, inventory_consumed_at,
-- backorder_qty. inventory_backorders doesn't exist either.
--
-- WHY NOBODY NOTICED
-- dbInsert() has a self-healing loop: when an insert fails on an unknown
-- column it strips that column and retries, up to 8 times. An inventory line
-- sets exactly 7 of these. So all 7 were stripped one by one and the line saved
-- as an ordinary manual line. The invoice looked perfect. The link to the
-- product was thrown away every single time, silently.
--
-- Then consume_invoice_item_inventory (which DOES exist) was called and threw
-- immediately, because its %ROWTYPE has no inventory_status field. And
-- InventoryOverview's sales query selects those same columns, so it errored and
-- returned nothing — which is why sold quantity and roll counts have always
-- read zero no matter what you sold.
--
-- PART 1 builds the missing schema. PART 2 is the engine fix Max asked for:
-- stock sellable on arrival, real landed cost entered later, P&L restated.
--
-- SAFE TO RE-RUN. Read the verification output at the very bottom.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — THE MISSING FOUNDATION (this is what was never run)         ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ── 1.1 invoice_items: the sale -> product link ───────────────────────────
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS uses_inventory        boolean NOT NULL DEFAULT false;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS variant_id            uuid;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS warehouse_id          uuid;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS uom                   text;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sale_quantity         numeric;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sale_price_per_uom    numeric;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS inventory_status      text;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS consumed_layers       jsonb;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cogs_total            numeric;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS gross_profit          numeric;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS inventory_consumed_at timestamptz;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS backorder_qty         numeric DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost_restated_at      timestamptz;
-- rolls_sold already exists in production; included for fresh installs.
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS rolls_sold            numeric;

-- Foreign keys (added separately so a re-run can't fail on "already exists")
DO $$ BEGIN
  ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_variant
    FOREIGN KEY (variant_id) REFERENCES inventory_products(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice_items_warehouse
    FOREIGN KEY (warehouse_id) REFERENCES inv_warehouses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS chk_item_inventory_status;
ALTER TABLE invoice_items ADD CONSTRAINT chk_item_inventory_status
  CHECK (inventory_status IS NULL OR inventory_status IN ('draft','consumed','reversed'));

CREATE INDEX IF NOT EXISTS idx_invoice_items_variant    ON invoice_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_inv_status ON invoice_items (inventory_status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_uses_inv   ON invoice_items (uses_inventory) WHERE uses_inventory = true;

COMMENT ON COLUMN invoice_items.uses_inventory IS
  'true = this line was picked from the inventory list and must draw stock. Manual lines (freight, fees) stay false.';
COMMENT ON COLUMN invoice_items.inventory_status IS
  'NULL/draft = not yet drawn from stock. consumed = stock deducted. reversed = stock given back.';

-- ── 1.2 inventory_backorders (missing table) ──────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_backorders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid,
  variant_id    uuid REFERENCES inventory_products(id) ON DELETE RESTRICT,
  warehouse_id  uuid REFERENCES inv_warehouses(id) ON DELETE SET NULL,
  qty_short     numeric NOT NULL CHECK (qty_short > 0),
  uom           text,
  status        text NOT NULL DEFAULT 'open',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_backorder_status CHECK (status IN ('open','fulfilled','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_backorders_invoice ON inventory_backorders (invoice_id);
CREATE INDEX IF NOT EXISTS idx_backorders_open    ON inventory_backorders (variant_id) WHERE status = 'open';

-- RLS (PERMANENT RULE 9 — every new table gets it in the same block)
ALTER TABLE inventory_backorders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "backorders_select" ON inventory_backorders FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "backorders_insert" ON inventory_backorders FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "backorders_update" ON inventory_backorders FOR UPDATE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "backorders_delete" ON inventory_backorders FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1.3 inventory_movements: link a movement to its invoice line ──────────
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source_invoice_item_id uuid;
CREATE INDEX IF NOT EXISTS idx_movements_invoice_item ON inventory_movements (source_invoice_item_id);

-- ── 1.4 inventory_layers: provisional-cost flag ───────────────────────────
ALTER TABLE inventory_layers ADD COLUMN IF NOT EXISTS is_provisional boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN inventory_layers.is_provisional IS
  'true = stock is on hand and sellable but its landed cost is not final yet. Cleared by finalize, which also restates COGS on any sale that already drew from this layer.';

CREATE INDEX IF NOT EXISTS idx_layers_provisional ON inventory_layers (product_id) WHERE is_provisional = true;

ALTER TABLE inventory_layers DROP CONSTRAINT IF EXISTS chk_layer_cost_nonneg;
ALTER TABLE inventory_layers ADD CONSTRAINT chk_layer_cost_nonneg CHECK (cost_per_uom >= 0);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — THE ENGINE (sellable on arrival, cost + P&L updated later)  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ── 2.1 Helpers ───────────────────────────────────────────────────────────
-- Mirrors src/lib/inventory-receipts.js INVALID_RECEIPT_STATUSES exactly.
-- 'pending_detail' is excluded on purpose: that quantity is the supplier's
-- expected figure or a placeholder, not counted goods.
CREATE OR REPLACE FUNCTION fn_receipt_is_countable(p_status text)
RETURNS boolean AS $$
BEGIN
  IF p_status IS NULL THEN RETURN true; END IF;
  RETURN p_status NOT IN ('cancelled', 'pending_detail', 'merged', 'reversed');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- inventory_movements.uom has a CHECK list; receipts can carry 'unit' or other
-- values outside it. Coerce anything unrecognised to NULL rather than failing
-- the whole sale on a cosmetic field.
CREATE OR REPLACE FUNCTION fn_safe_movement_uom(p_uom text)
RETURNS text AS $$
BEGIN
  IF p_uom IS NULL THEN RETURN NULL; END IF;
  IF lower(p_uom) IN ('kg','meter','yard','roll','piece','liter','sqm') THEN
    RETURN lower(p_uom);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 2.2 Restate cost on sales that already drew from a layer ──────────────
CREATE OR REPLACE FUNCTION restate_cogs_for_layer(p_layer_id uuid)
RETURNS integer AS $$
DECLARE
  v_item       record;
  v_entry      jsonb;
  v_new_cogs   numeric;
  v_layer_cost numeric;
  v_count      integer := 0;
BEGIN
  FOR v_item IN
    SELECT id, line_total, consumed_layers
    FROM invoice_items
    WHERE inventory_status = 'consumed'
      AND consumed_layers IS NOT NULL
      AND jsonb_typeof(consumed_layers) = 'array'
      AND consumed_layers @> jsonb_build_array(jsonb_build_object('layer_id', p_layer_id::text))
    FOR UPDATE
  LOOP
    v_new_cogs := 0;
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_item.consumed_layers)
    LOOP
      SELECT cost_per_uom INTO v_layer_cost
      FROM inventory_layers WHERE id = (v_entry->>'layer_id')::uuid;
      v_new_cogs := v_new_cogs
        + (COALESCE(v_entry->>'qty_consumed','0')::numeric * COALESCE(v_layer_cost, 0));
    END LOOP;

    UPDATE invoice_items
    SET cogs_total       = v_new_cogs,
        gross_profit     = COALESCE(line_total, 0) - v_new_cogs,
        cost_restated_at = now()
    WHERE id = v_item.id;

    UPDATE inventory_movements
    SET total_cost = v_new_cogs
    WHERE source_invoice_item_id = v_item.id AND movement_type = 'sale';

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ── 2.3 Create the stock layer on ARRIVAL, not on finalize ────────────────
CREATE OR REPLACE FUNCTION on_receipt_create_provisional_layer()
RETURNS TRIGGER AS $$
DECLARE
  v_layer inventory_layers%ROWTYPE;
BEGIN
  IF NOT fn_receipt_is_countable(NEW.status) THEN RETURN NEW; END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN RETURN NEW; END IF;
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_layer FROM inventory_layers WHERE source_receipt_id = NEW.id;

  IF NOT FOUND THEN
    INSERT INTO inventory_layers (
      source_receipt_id, product_id, warehouse_id, receipt_date,
      receipt_number, batch_number,
      qty_received, qty_remaining, uom,
      cost_per_uom, cost_currency, fx_rate_used,
      status, is_provisional
    ) VALUES (
      NEW.id, NEW.product_id, NEW.warehouse_id,
      COALESCE(NEW.receipt_date, CURRENT_DATE),
      NEW.receipt_number, NEW.batch_number,
      NEW.quantity, NEW.quantity, NEW.uom,
      COALESCE(NEW.landed_cost_per_uom, 0),
      COALESCE(NEW.currency, 'EGP'), NEW.fx_rate_used,
      'open',
      (NEW.landed_cost_per_uom IS NULL)
    );
    RETURN NEW;
  END IF;

  -- Layer exists. Keep the received quantity in step ONLY while none of it has
  -- been sold — resizing a layer goods have already left would corrupt the sale
  -- history. A correction after selling is an Adjustment: deliberate, audited.
  IF v_layer.qty_remaining = v_layer.qty_received
     AND NEW.quantity <> v_layer.qty_received THEN
    UPDATE inventory_layers
    SET qty_received  = NEW.quantity,
        qty_remaining = NEW.quantity,
        uom           = NEW.uom,
        warehouse_id  = NEW.warehouse_id,
        receipt_date  = COALESCE(NEW.receipt_date, receipt_date),
        updated_at    = now()
    WHERE id = v_layer.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_receipt_provisional_layer ON inventory_stock_receipts;
CREATE TRIGGER trigger_receipt_provisional_layer
AFTER INSERT OR UPDATE OF status, quantity, uom, warehouse_id, receipt_date
ON inventory_stock_receipts
FOR EACH ROW EXECUTE FUNCTION on_receipt_create_provisional_layer();

-- ── 2.4 Finalize UPDATES the layer + restates every affected sale ─────────
CREATE OR REPLACE FUNCTION on_receipt_finalize_create_ledger()
RETURNS TRIGGER AS $$
DECLARE
  v_layer_id uuid;
  v_layer    inventory_layers%ROWTYPE;
  v_restated integer := 0;
BEGIN
  IF NEW.status = 'finalized'
     AND (OLD.status IS NULL OR OLD.status != 'finalized')
     AND NEW.landed_cost_per_uom IS NOT NULL
     AND NEW.quantity > 0
  THEN
    SELECT * INTO v_layer FROM inventory_layers WHERE source_receipt_id = NEW.id;

    IF NOT FOUND THEN
      INSERT INTO inventory_layers (
        source_receipt_id, product_id, warehouse_id, receipt_date,
        receipt_number, batch_number,
        qty_received, qty_remaining, uom,
        cost_per_uom, cost_currency, fx_rate_used,
        status, is_provisional
      ) VALUES (
        NEW.id, NEW.product_id, NEW.warehouse_id, NEW.receipt_date,
        NEW.receipt_number, NEW.batch_number,
        NEW.quantity, NEW.quantity, NEW.uom,
        NEW.landed_cost_per_uom, COALESCE(NEW.currency, 'EGP'), NEW.fx_rate_used,
        'open', false
      ) RETURNING id INTO v_layer_id;
    ELSE
      -- THE KEY CHANGE: put the real cost on the EXISTING layer. Never touch
      -- qty_remaining — goods may already have been sold out of it.
      v_layer_id := v_layer.id;
      UPDATE inventory_layers
      SET cost_per_uom   = NEW.landed_cost_per_uom,
          cost_currency  = COALESCE(NEW.currency, cost_currency, 'EGP'),
          fx_rate_used   = COALESCE(NEW.fx_rate_used, fx_rate_used),
          is_provisional = false,
          updated_at     = now()
      WHERE id = v_layer_id;

      -- Max's "costs can be later entered and pnl updated".
      v_restated := restate_cogs_for_layer(v_layer_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM inventory_movements
      WHERE source_receipt_id = NEW.id AND movement_type = 'receipt'
    ) THEN
      INSERT INTO inventory_movements (
        movement_type, movement_date, product_id, warehouse_id,
        quantity, uom, cost_per_uom, cost_currency, total_cost,
        source_receipt_id, source_layer_id, reference_number, notes, created_by
      ) VALUES (
        'receipt', COALESCE(NEW.receipt_date, CURRENT_DATE),
        NEW.product_id, NEW.warehouse_id,
        NEW.quantity, fn_safe_movement_uom(NEW.uom),
        NEW.landed_cost_per_uom, COALESCE(NEW.currency, 'EGP'),
        NEW.quantity * NEW.landed_cost_per_uom,
        NEW.id, v_layer_id, NEW.receipt_number,
        CASE WHEN v_restated > 0
             THEN 'Cost finalized; ' || v_restated || ' earlier sale line(s) restated'
             ELSE 'Cost finalized' END,
        NEW.finalized_by
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2.5 Consumption — FIFO + sale movement ────────────────────────────────
CREATE OR REPLACE FUNCTION consume_invoice_item_inventory(p_item_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_item             invoice_items%ROWTYPE;
  v_resolved_variant uuid;
  v_layer            record;
  v_remaining        numeric;
  v_consumed_qty     numeric;
  v_consumed_cost    numeric;
  v_total_cogs       numeric := 0;
  v_total_consumed   numeric := 0;
  v_consumed_layers  jsonb := '[]'::jsonb;
  v_backorder_qty    numeric := 0;
  v_backorder_id     uuid;
  v_template_row     inventory_products%ROWTYPE;
  v_provisional      boolean := false;
  v_invoice_no       text;
  v_last_layer       uuid;
BEGIN
  SELECT * INTO v_item FROM invoice_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice item % not found', p_item_id; END IF;

  -- Idempotency — saving, reopening or refreshing must never deduct twice.
  IF v_item.inventory_status = 'consumed' THEN
    RETURN jsonb_build_object('already_consumed', true,
      'consumed_layers', v_item.consumed_layers,
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
    RAISE EXCEPTION 'Invoice item % is linked to family template % (% - %) - pick a specific variant instead, or use Manual mode',
      p_item_id, v_item.variant_id, v_template_row.quick_code, v_template_row.name_en;
  END IF;

  v_remaining := v_item.sale_quantity;

  FOR v_layer IN
    SELECT id, product_id, warehouse_id, cost_per_uom, qty_remaining, receipt_date, is_provisional
    FROM inventory_layers
    WHERE product_id = v_resolved_variant
      AND (v_item.warehouse_id IS NULL OR warehouse_id = v_item.warehouse_id)
      AND qty_remaining > 0
      AND status = 'open'
    ORDER BY receipt_date ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_consumed_qty   := LEAST(v_layer.qty_remaining, v_remaining);
    v_consumed_cost  := v_consumed_qty * COALESCE(v_layer.cost_per_uom, 0);
    v_total_cogs     := v_total_cogs + v_consumed_cost;
    v_total_consumed := v_total_consumed + v_consumed_qty;
    v_remaining      := v_remaining - v_consumed_qty;
    v_last_layer     := v_layer.id;
    IF v_layer.is_provisional THEN v_provisional := true; END IF;

    UPDATE inventory_layers
    SET qty_remaining = qty_remaining - v_consumed_qty,
        status = CASE WHEN qty_remaining - v_consumed_qty <= 0 THEN 'closed' ELSE status END,
        updated_at = now()
    WHERE id = v_layer.id;

    v_consumed_layers := v_consumed_layers || jsonb_build_object(
      'layer_id', v_layer.id, 'qty_consumed', v_consumed_qty,
      'cost_per_uom', COALESCE(v_layer.cost_per_uom, 0),
      'total_cost', v_consumed_cost, 'received_at', v_layer.receipt_date,
      'provisional', v_layer.is_provisional
    );
  END LOOP;

  IF v_remaining > 0 THEN
    v_backorder_qty := v_remaining;
    INSERT INTO inventory_backorders (
      invoice_id, variant_id, warehouse_id, qty_short, uom, status, notes
    ) VALUES (
      v_item.invoice_id, v_resolved_variant, v_item.warehouse_id,
      v_backorder_qty, v_item.uom, 'open',
      'Auto-created at invoice submit - sale qty (' || v_item.sale_quantity ||
      ') exceeded available stock (' || v_total_consumed || ')'
    ) RETURNING id INTO v_backorder_id;
  END IF;

  UPDATE invoice_items
  SET consumed_layers       = v_consumed_layers,
      cogs_total            = v_total_cogs,
      gross_profit          = COALESCE(line_total, 0) - v_total_cogs,
      inventory_consumed_at = now(),
      inventory_status      = 'consumed',
      backorder_qty         = v_backorder_qty
  WHERE id = p_item_id;

  -- Outbound ledger row — sales previously left no trail at all.
  IF v_total_consumed > 0 THEN
    SELECT order_number INTO v_invoice_no FROM invoices WHERE id = v_item.invoice_id;
    INSERT INTO inventory_movements (
      movement_type, movement_date, product_id, warehouse_id,
      quantity, uom, cost_per_uom, cost_currency, total_cost,
      source_invoice_id, source_invoice_item_id, source_layer_id,
      reference_number, notes
    ) VALUES (
      'sale', CURRENT_DATE, v_resolved_variant, v_item.warehouse_id,
      -v_total_consumed, fn_safe_movement_uom(v_item.uom),
      CASE WHEN v_total_consumed > 0 THEN v_total_cogs / v_total_consumed ELSE 0 END,
      'EGP', v_total_cogs,
      v_item.invoice_id, p_item_id, v_last_layer,
      v_invoice_no,
      CASE WHEN v_provisional
           THEN 'Sold from stock whose landed cost is not final yet - COGS will be restated on finalize'
           ELSE 'Sale' END
    );
  END IF;

  RETURN jsonb_build_object(
    'item_id', p_item_id, 'consumed_layers', v_consumed_layers,
    'total_consumed', v_total_consumed, 'cogs_total', v_total_cogs,
    'gross_profit', COALESCE(v_item.line_total, 0) - v_total_cogs,
    'backorder_qty', v_backorder_qty, 'backorder_id', v_backorder_id,
    'provisional_cost', v_provisional
  );
END;
$$ LANGUAGE plpgsql;

-- ── 2.6 Reversal — give the stock back ────────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_invoice_item_inventory(p_item_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_item     invoice_items%ROWTYPE;
  v_entry    jsonb;
  v_layer_id uuid;
  v_qty      numeric;
  v_restored numeric := 0;
BEGIN
  SELECT * INTO v_item FROM invoice_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('reversed', false, 'reason', 'item_not_found');
  END IF;

  -- Not consumed → nothing to give back. Return quietly rather than raising, so
  -- deleting a plain manual line can never be blocked by this.
  IF v_item.inventory_status IS DISTINCT FROM 'consumed' THEN
    RETURN jsonb_build_object('reversed', false, 'reason', 'not_consumed');
  END IF;

  IF v_item.consumed_layers IS NOT NULL AND jsonb_typeof(v_item.consumed_layers) = 'array' THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_item.consumed_layers)
    LOOP
      v_layer_id := (v_entry->>'layer_id')::uuid;
      v_qty := COALESCE(v_entry->>'qty_consumed','0')::numeric;
      UPDATE inventory_layers
      SET qty_remaining = LEAST(qty_received, qty_remaining + v_qty),
          status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
          updated_at = now()
      WHERE id = v_layer_id;
      v_restored := v_restored + v_qty;
    END LOOP;
  END IF;

  UPDATE inventory_backorders
  SET status = 'cancelled',
      notes = COALESCE(notes,'') || ' | Auto-cancelled when invoice line was reversed at ' || now()::text
  WHERE invoice_id = v_item.invoice_id AND status = 'open' AND variant_id = v_item.variant_id;

  DELETE FROM inventory_movements
  WHERE source_invoice_item_id = p_item_id AND movement_type = 'sale';

  UPDATE invoice_items
  SET inventory_status      = 'reversed',
      consumed_layers       = NULL,
      cogs_total            = NULL,
      gross_profit          = NULL,
      inventory_consumed_at = NULL,
      backorder_qty         = 0
  WHERE id = p_item_id;

  RETURN jsonb_build_object('reversed', true, 'qty_restored', v_restored);
END;
$$ LANGUAGE plpgsql;

-- ── 2.7 BACKFILL — give existing on-hand stock its layers ─────────────────
INSERT INTO inventory_layers (
  source_receipt_id, product_id, warehouse_id, receipt_date,
  receipt_number, batch_number,
  qty_received, qty_remaining, uom,
  cost_per_uom, cost_currency, fx_rate_used, status, is_provisional
)
SELECT r.id, r.product_id, r.warehouse_id, COALESCE(r.receipt_date, CURRENT_DATE),
       r.receipt_number, r.batch_number,
       r.quantity, r.quantity, r.uom,
       COALESCE(r.landed_cost_per_uom, 0), COALESCE(r.currency, 'EGP'), r.fx_rate_used,
       'open', (r.landed_cost_per_uom IS NULL)
FROM inventory_stock_receipts r
WHERE fn_receipt_is_countable(r.status)
  AND r.quantity > 0
  AND r.product_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_layers l WHERE l.source_receipt_id = r.id)
ON CONFLICT (source_receipt_id) DO NOTHING;

UPDATE inventory_layers SET is_provisional = false
WHERE is_provisional = true AND cost_per_uom > 0;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  VERIFICATION — read every line of this output                        ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
SELECT '1. Sale->product link columns now present (need 12)' AS check_name,
       COUNT(*)::text AS result
FROM information_schema.columns
WHERE table_schema='public' AND table_name='invoice_items'
  AND column_name IN ('uses_inventory','variant_id','warehouse_id','uom','sale_quantity',
                      'sale_price_per_uom','inventory_status','consumed_layers','cogs_total',
                      'gross_profit','inventory_consumed_at','backorder_qty')
UNION ALL
SELECT '2. Engine functions installed (need 5)',
       COUNT(*)::text FROM pg_proc WHERE proname IN
       ('consume_invoice_item_inventory','reverse_invoice_item_inventory',
        'on_receipt_finalize_create_ledger','on_receipt_create_provisional_layer',
        'restate_cogs_for_layer')
UNION ALL
SELECT '3. Arrival trigger attached (need 1)',
       COUNT(*)::text FROM pg_trigger WHERE tgname = 'trigger_receipt_provisional_layer'
UNION ALL
SELECT '4. Countable receipts still missing a stock layer (want 0)',
       COUNT(*)::text FROM inventory_stock_receipts r
WHERE fn_receipt_is_countable(r.status) AND r.quantity > 0 AND r.product_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inventory_layers l WHERE l.source_receipt_id = r.id)
UNION ALL
SELECT '5. Products with sellable stock right now',
       COUNT(DISTINCT product_id)::text FROM inventory_layers
WHERE status='open' AND qty_remaining > 0
UNION ALL
SELECT '6. Of that stock, layers awaiting final cost',
       COUNT(*)::text FROM inventory_layers WHERE is_provisional = true AND qty_remaining > 0
UNION ALL
SELECT '7. Past invoice lines linked to a product (expect 0 - link never saved)',
       COUNT(*)::text FROM invoice_items WHERE variant_id IS NOT NULL;
