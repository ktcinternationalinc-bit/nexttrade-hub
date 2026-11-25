-- Shared invoice review status for Orders and No KTC Invoice.
CREATE TABLE IF NOT EXISTS public.order_invoice_reviews (
  source text NOT NULL CHECK (source IN ('nextrade-live', 'nextrade-staging')),
  section text NOT NULL CHECK (section IN ('main', 'obsolete')),
  order_id integer NOT NULL CHECK (order_id > 0),
  release_key text NOT NULL CHECK (char_length(release_key) <= 256),
  choice text NOT NULL CHECK (choice IN ('open', 'corrected', 'invoice_created', 'non_issue')),
  note text CHECK (char_length(note) <= 1000),
  reviewed_by text NOT NULL,
  reviewed_by_name text,
  reviewed_at timestamptz NOT NULL,
  revision uuid NOT NULL,
  PRIMARY KEY (source, section, order_id, release_key)
);

ALTER TABLE public.order_invoice_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_invoice_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.order_invoice_reviews TO service_role;
