-- ════════════════════════════════════════════════════════════════════════
-- v55.83-XG — ARRIVAL + FINAL-PAYMENT REMINDERS: the log (Max, 22 Nov 2026)
-- One row per reminder: which order, which phase and slot, which language,
-- to whom, the exact subject and text, the balance as it was stated, who
-- sent it and what the mail server answered.
-- ADDS one new table and its indexes. Changes no existing table, no existing
-- row. Nothing is ever deleted from this table (no DELETE right is given).
-- SAFE TO RE-RUN.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.arrival_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,                       -- which warehouse copy: nextrade-live / nextrade-staging
  order_id bigint NOT NULL,                   -- the warehouse order
  release_number text,
  release_key text,
  customer_name text,
  invoice_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp')),
  mode text NOT NULL CHECK (mode IN ('manual','auto','test')),
  phase text NOT NULL CHECK (phase IN ('friendly','firmer','urgent','overdue')),
  slot text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','es','fr','ar')),
  sent_to text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  arrival_date date,
  days_to_arrival integer,
  total numeric(14,2),
  received numeric(14,2),
  remaining numeric(14,2),
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed','unknown')),   -- unknown = delivery unconfirmed (the mail server never answered)
  error text,
  message_id text,
  smtp_response text,
  sent_by uuid,
  sent_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_arrival_reminders_order ON public.arrival_reminders (source, order_id, created_at);

-- The automatic schedule (not switched on in this build) can never send the same slot of the same order twice on one
-- channel: a second row for that slot is refused by the database itself while the first is being sent, was sent, or its
-- delivery is unconfirmed (it may have reached the customer).
CREATE UNIQUE INDEX IF NOT EXISTS uq_arrival_reminders_auto_slot
  ON public.arrival_reminders (source, order_id, channel, slot)
  WHERE mode = 'auto' AND status IN ('sending','sent','unknown');

-- Read and written only by the Hub server (the screen asks the server; nobody reads the table directly).
ALTER TABLE public.arrival_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arrival_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.arrival_reminders TO service_role;
