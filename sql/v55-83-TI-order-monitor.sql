-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-TI — ORDER LIFECYCLE, DEPOSITS, 30-HOUR ALERT, OVERNIGHT REVIEW (Max, Nov 16 2026)
-- Adds NEW tables only. Nothing existing is changed or deleted. Safe to run more than once.
-- Written only by the Hub server (service key); signed-in users read through the Hub's own checks.
-- ═══════════════════════════════════════════════════════════════════════════

-- settings: who gets the 30-hour alert, and whether alerts are switched on (OFF until Max switches them on)
CREATE TABLE IF NOT EXISTS public.order_monitor_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.order_monitor_settings (key, value) VALUES ('alerts_enabled', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.order_monitor_settings (key, value) VALUES ('alert_recipients', '["support@ktcus.com","hsaad@ktcus.com","Jasmine@ktcus.com"]'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.order_monitor_settings (key, value) VALUES ('auto_close_enabled', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;

-- deposit decision per warehouse order: "not required" needs a note
CREATE TABLE IF NOT EXISTS public.order_deposit_status (
  source      text NOT NULL,
  order_id    integer NOT NULL,
  status      text NOT NULL CHECK (status IN ('not_required', 'required')),
  note        text,
  set_by      text,
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, order_id),
  CHECK (status <> 'not_required' OR length(btrim(coalesce(note, ''))) >= 5)
);

-- a customer payment matched STRAIGHT to an order (e.g. a deposit paid against a proforma, before the KTC invoice exists).
-- A reference only: it does not post a payment or change any accounting; undone = voided (kept).
CREATE TABLE IF NOT EXISTS public.order_deposit_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source               text NOT NULL,
  order_id             integer NOT NULL,
  release_number       text,
  bank_transaction_id  uuid NOT NULL,
  amount               numeric NOT NULL CHECK (amount > 0),
  note                 text,
  linked_by            text,
  linked_at            timestamptz NOT NULL DEFAULT now(),
  voided               boolean NOT NULL DEFAULT false,
  voided_by            text,
  voided_at            timestamptz,
  void_reason          text
);
CREATE INDEX IF NOT EXISTS order_deposit_links_order ON public.order_deposit_links (source, order_id) WHERE NOT voided;
CREATE INDEX IF NOT EXISTS order_deposit_links_txn ON public.order_deposit_links (bank_transaction_id) WHERE NOT voided;

-- a person's decision: keep open / close anyway / mark one requirement N/A — with a reason, who and when
CREATE TABLE IF NOT EXISTS public.order_monitor_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  order_id    integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('keep_open', 'force_close', 'item_na')),
  item_key    text,
  reason      text NOT NULL CHECK (length(btrim(reason)) >= 5),
  set_by      text,
  set_at      timestamptz NOT NULL DEFAULT now(),
  active      boolean NOT NULL DEFAULT true,
  ended_by    text,
  ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS order_monitor_overrides_order ON public.order_monitor_overrides (source, order_id) WHERE active;

-- every 30-hour alert: one per order + scheduled time (alert_key); resolved_at set when it no longer applies
CREATE TABLE IF NOT EXISTS public.order_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  order_id     integer NOT NULL,
  alert_key    text NOT NULL,
  kind         text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  recipients   jsonb NOT NULL DEFAULT '[]'::jsonb,
  send_error   text,
  resolved_at  timestamptz,
  resolved_why text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source, alert_key)
);

-- every run of the 15-minute check and the overnight review
CREATE TABLE IF NOT EXISTS public.order_review_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('deadline', 'nightly', 'manual')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  error        text,
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS order_review_runs_started ON public.order_review_runs (kind, started_at DESC);

-- every closure the Hub made or asked Nextrade to make
CREATE TABLE IF NOT EXISTS public.order_closures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text NOT NULL,
  order_id           integer NOT NULL,
  release_number     text,
  mode               text NOT NULL CHECK (mode IN ('auto', 'manual', 'override')),
  reason             text,
  closed_by          text,
  closed_at          timestamptz NOT NULL DEFAULT now(),
  written_to_nextrade boolean NOT NULL DEFAULT false,
  nextrade_response  jsonb,
  open_exceptions    jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS order_closures_order ON public.order_closures (source, order_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_monitor_settings', 'order_deposit_status', 'order_deposit_links', 'order_monitor_overrides', 'order_alerts', 'order_review_runs', 'order_closures'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- proof: should list 7 tables
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN
  ('order_monitor_settings', 'order_deposit_status', 'order_deposit_links', 'order_monitor_overrides', 'order_alerts', 'order_review_runs', 'order_closures')
ORDER BY table_name;
