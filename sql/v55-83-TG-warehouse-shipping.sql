-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TG — SHIPPING COSTS FROM THE NEXTRADE WAREHOUSE (Max, Nov 16 2026)
-- "retrieve shipping information, cross-reference it with the existing Hub release numbers and invoices, and populate
--  the shipping P&L … Total shipping expense = freight/shipping cost + trucking cost … Make repeated imports safe …
--  Keep source references and a change history."
--
-- WHAT THIS ADDS: four NEW tables. It changes NO existing table and NO existing row.
--   pl_warehouse_shipping          one row per warehouse order (source + section + warehouse order id = the key)
--   pl_warehouse_shipping_history  every change a sync or a person made to a row (from → to), never deleted
--   pl_warehouse_sync_runs         every sync: when, who/what started it, ok or failed, counts
--   pl_warehouse_settings          the switch that lets the P&L use these costs (starts OFF)
-- Written ONLY by the Hub server (service key). No direct read for signed-in users: the Hub route checks
-- "P&L: View" before showing anything. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pl_warehouse_sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  trigger       text NOT NULL CHECK (trigger IN ('daily', 'button')),
  triggered_by  text,
  source        text NOT NULL,
  source_host   text,
  ok            boolean,
  error         text,
  counts        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS pl_warehouse_sync_runs_started ON public.pl_warehouse_sync_runs (started_at DESC);
-- ONE sync at a time (Codex 16 Nov): a second unfinished run cannot even be inserted
CREATE UNIQUE INDEX IF NOT EXISTS pl_warehouse_one_active_run ON public.pl_warehouse_sync_runs ((true)) WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS public.pl_warehouse_shipping (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL,                 -- 'nextrade-staging' now; 'nextrade-live' only when Max asks
  section               text NOT NULL CHECK (section IN ('main', 'obsolete')),
  order_id              integer NOT NULL,              -- the warehouse's own order id (never changes)
  release_number        text,                          -- exactly as typed in the warehouse (leading zeros kept)
  release_key           text,                          -- for comparison only (relKey)
  customer_name         text, warehouse_name text, status text, is_bonded boolean, country text,
  order_created         date, shipped_date date, load_date date, ship_date date, ship_date_basis text,
  sailing_date          date, arrival_date date,
  freight_forwarder     text, shipping_line text, trucker_name text, booking_number text,
  freight_estimate      numeric, freight_estimate_raw text, freight_final numeric, freight_final_raw text,
  freight_paid          text, freight_paid_date date, freight_invoice text, freight_used numeric, freight_kind text,
  trucking_estimate     numeric, trucking_estimate_raw text, trucking_final numeric, trucking_final_raw text,
  trucking_paid         text, trucking_paid_date date, trucking_invoice text, trucking_used numeric, trucking_kind text,
  combined_used         numeric, combined_estimate numeric,
  cost_status           text,                          -- final · partly_provisional · provisional · missing · customer_own_transport · not_applicable
  currency              text, currency_confirmed boolean NOT NULL DEFAULT false,
  is_shipped            boolean, is_closed boolean, is_open boolean, in_backfill boolean, conflict boolean NOT NULL DEFAULT false,
  invoice_matches       jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_only_invoices  jsonb NOT NULL DEFAULT '[]'::jsonb,
  bill_checks           jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail                jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_link           text,
  -- a PERSON's corrections: a sync never writes these columns
  manual_freight        numeric, manual_trucking numeric, manual_note text, manual_by text, manual_at timestamptz,
  superseded            boolean NOT NULL DEFAULT false,  -- set when the live warehouse replaces the staging source; rows are kept
  in_latest_feed        boolean NOT NULL DEFAULT true,   -- false = the last successful sync no longer contained this order; not used
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_checked_at       timestamptz,
  last_changed_at       timestamptz,
  last_run_id           uuid,
  UNIQUE (source, section, order_id)
);
CREATE INDEX IF NOT EXISTS pl_warehouse_shipping_release ON public.pl_warehouse_shipping (release_key);
CREATE INDEX IF NOT EXISTS pl_warehouse_shipping_open ON public.pl_warehouse_shipping (is_open, order_created);

CREATE TABLE IF NOT EXISTS public.pl_warehouse_shipping_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id   uuid NOT NULL REFERENCES public.pl_warehouse_shipping(id),
  run_id      uuid,
  changed_by  text,                                    -- null = the sync; a user id = a person's correction
  changed_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL,                           -- 'created' · 'sync_change' · 'manual_correction'
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS pl_warehouse_shipping_history_rec ON public.pl_warehouse_shipping_history (record_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.pl_warehouse_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- the P&L does NOT use warehouse costs until Max turns this on (after looking at the synced list)
INSERT INTO public.pl_warehouse_settings (key, value) VALUES ('use_in_pnl', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
-- which copy of the warehouse the P&L and the lists read. Changing it is ONE row, so staging and live rows never mix.
INSERT INTO public.pl_warehouse_settings (key, value) VALUES ('active_source', '"nextrade-staging"'::jsonb) ON CONFLICT (key) DO NOTHING;

-- ── PUBLISH ONE SYNC ATOMICALLY (Codex 16 Nov, P1): every row, its history and the run's "ok" are written in ONE transaction.
-- If anything fails, NOTHING of this run is kept, so a retry sees the old values and writes the history then.
-- Fencing: only the run that holds the lock (still unfinished) may publish.
CREATE OR REPLACE FUNCTION public.pl_warehouse_publish(p_run_id uuid, p_source text, p_rows jsonb, p_changes jsonb, p_counts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run public.pl_warehouse_sync_runs%ROWTYPE; v_rows int; v_hist int;
BEGIN
  SELECT * INTO v_run FROM public.pl_warehouse_sync_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.finished_at IS NOT NULL OR v_run.source IS DISTINCT FROM p_source THEN
    RAISE EXCEPTION 'sync run % no longer holds the lock (or is for another source)', p_run_id;
  END IF;
  WITH src AS (SELECT * FROM jsonb_populate_recordset(NULL::public.pl_warehouse_shipping, p_rows)),
  up AS (
    INSERT INTO public.pl_warehouse_shipping AS t (source, section, order_id, release_number, release_key, customer_name, warehouse_name, status, is_bonded, country,
      order_created, shipped_date, load_date, ship_date, ship_date_basis, sailing_date, arrival_date, freight_forwarder, shipping_line, trucker_name, booking_number,
      freight_estimate, freight_estimate_raw, freight_final, freight_final_raw, freight_paid, freight_paid_date, freight_invoice, freight_used, freight_kind,
      trucking_estimate, trucking_estimate_raw, trucking_final, trucking_final_raw, trucking_paid, trucking_paid_date, trucking_invoice, trucking_used, trucking_kind,
      combined_used, combined_estimate, cost_status, currency, currency_confirmed, is_shipped, is_closed, is_open, in_backfill, conflict,
      invoice_matches, review_only_invoices, bill_checks, flags, detail, source_link, last_checked_at, last_changed_at, last_run_id, in_latest_feed)
    SELECT source, section, order_id, release_number, release_key, customer_name, warehouse_name, status, is_bonded, country,
      order_created, shipped_date, load_date, ship_date, ship_date_basis, sailing_date, arrival_date, freight_forwarder, shipping_line, trucker_name, booking_number,
      freight_estimate, freight_estimate_raw, freight_final, freight_final_raw, freight_paid, freight_paid_date, freight_invoice, freight_used, freight_kind,
      trucking_estimate, trucking_estimate_raw, trucking_final, trucking_final_raw, trucking_paid, trucking_paid_date, trucking_invoice, trucking_used, trucking_kind,
      combined_used, combined_estimate, cost_status, currency, COALESCE(currency_confirmed, false), is_shipped, is_closed, is_open, in_backfill, COALESCE(conflict, false),
      COALESCE(invoice_matches, '[]'::jsonb), COALESCE(review_only_invoices, '[]'::jsonb), COALESCE(bill_checks, '[]'::jsonb), COALESCE(flags, '[]'::jsonb), COALESCE(detail, '{}'::jsonb),
      source_link, last_checked_at, last_changed_at, p_run_id, true
    FROM src WHERE source = p_source
    ON CONFLICT (source, section, order_id) DO UPDATE SET
      release_number = EXCLUDED.release_number, release_key = EXCLUDED.release_key, customer_name = EXCLUDED.customer_name, warehouse_name = EXCLUDED.warehouse_name,
      status = EXCLUDED.status, is_bonded = EXCLUDED.is_bonded, country = EXCLUDED.country, order_created = EXCLUDED.order_created, shipped_date = EXCLUDED.shipped_date,
      load_date = EXCLUDED.load_date, ship_date = EXCLUDED.ship_date, ship_date_basis = EXCLUDED.ship_date_basis, sailing_date = EXCLUDED.sailing_date, arrival_date = EXCLUDED.arrival_date,
      freight_forwarder = EXCLUDED.freight_forwarder, shipping_line = EXCLUDED.shipping_line, trucker_name = EXCLUDED.trucker_name, booking_number = EXCLUDED.booking_number,
      freight_estimate = EXCLUDED.freight_estimate, freight_estimate_raw = EXCLUDED.freight_estimate_raw, freight_final = EXCLUDED.freight_final, freight_final_raw = EXCLUDED.freight_final_raw,
      freight_paid = EXCLUDED.freight_paid, freight_paid_date = EXCLUDED.freight_paid_date, freight_invoice = EXCLUDED.freight_invoice, freight_used = EXCLUDED.freight_used, freight_kind = EXCLUDED.freight_kind,
      trucking_estimate = EXCLUDED.trucking_estimate, trucking_estimate_raw = EXCLUDED.trucking_estimate_raw, trucking_final = EXCLUDED.trucking_final, trucking_final_raw = EXCLUDED.trucking_final_raw,
      trucking_paid = EXCLUDED.trucking_paid, trucking_paid_date = EXCLUDED.trucking_paid_date, trucking_invoice = EXCLUDED.trucking_invoice, trucking_used = EXCLUDED.trucking_used, trucking_kind = EXCLUDED.trucking_kind,
      combined_used = EXCLUDED.combined_used, combined_estimate = EXCLUDED.combined_estimate, cost_status = EXCLUDED.cost_status, currency = EXCLUDED.currency, currency_confirmed = EXCLUDED.currency_confirmed,
      is_shipped = EXCLUDED.is_shipped, is_closed = EXCLUDED.is_closed, is_open = EXCLUDED.is_open, in_backfill = EXCLUDED.in_backfill, conflict = EXCLUDED.conflict,
      invoice_matches = EXCLUDED.invoice_matches, review_only_invoices = EXCLUDED.review_only_invoices, bill_checks = EXCLUDED.bill_checks, flags = EXCLUDED.flags, detail = EXCLUDED.detail,
      source_link = EXCLUDED.source_link, last_checked_at = EXCLUDED.last_checked_at, last_changed_at = EXCLUDED.last_changed_at, last_run_id = EXCLUDED.last_run_id, in_latest_feed = true
      -- manual_*, superseded and first_seen_at are deliberately NOT here: a sync never overwrites a person's correction
    RETURNING t.id, t.section, t.order_id
  ),
  h AS (
    INSERT INTO public.pl_warehouse_shipping_history (record_id, run_id, kind, changes)
    SELECT up.id, p_run_id, c.value->>'kind', COALESCE(c.value->'changes', '{}'::jsonb)
    FROM up JOIN jsonb_each(COALESCE(p_changes, '{}'::jsonb)) c ON c.key = up.section || '|' || up.order_id
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up), (SELECT count(*) FROM h) INTO v_rows, v_hist;
  -- orders no longer in the feed stay stored (never deleted) but are no longer used
  UPDATE public.pl_warehouse_shipping SET in_latest_feed = false WHERE source = p_source AND last_run_id IS DISTINCT FROM p_run_id AND in_latest_feed;
  UPDATE public.pl_warehouse_sync_runs SET finished_at = now(), ok = true, counts = COALESCE(p_counts, '{}'::jsonb) || jsonb_build_object('rows_published', v_rows, 'history_written', v_hist) WHERE id = p_run_id;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows, 'history', v_hist);
END $$;

-- a person's correction and its history in ONE transaction
CREATE OR REPLACE FUNCTION public.pl_warehouse_set_manual(p_record_id uuid, p_by text, p_freight numeric, p_trucking numeric, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev public.pl_warehouse_shipping%ROWTYPE;
BEGIN
  SELECT * INTO v_prev FROM public.pl_warehouse_shipping WHERE id = p_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'record not found'; END IF;
  UPDATE public.pl_warehouse_shipping SET manual_freight = p_freight, manual_trucking = p_trucking, manual_note = p_note, manual_by = p_by, manual_at = now() WHERE id = p_record_id;
  INSERT INTO public.pl_warehouse_shipping_history (record_id, changed_by, kind, changes)
  VALUES (p_record_id, p_by, 'manual_correction', jsonb_build_object(
    'manual_freight', jsonb_build_object('from', v_prev.manual_freight, 'to', p_freight),
    'manual_trucking', jsonb_build_object('from', v_prev.manual_trucking, 'to', p_trucking),
    'note', jsonb_build_object('from', v_prev.manual_note, 'to', p_note)));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.pl_warehouse_publish(uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pl_warehouse_set_manual(uuid, text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pl_warehouse_publish(uuid, text, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pl_warehouse_set_manual(uuid, text, numeric, numeric, text) TO service_role;

-- server only: RLS on with NO policy for signed-in users (the Hub server's service key is not limited by RLS)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pl_warehouse_sync_runs', 'pl_warehouse_shipping', 'pl_warehouse_shipping_history', 'pl_warehouse_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- proof
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'pl\_warehouse%' ORDER BY table_name;
