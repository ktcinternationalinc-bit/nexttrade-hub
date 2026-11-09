-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RJ — CRM: when each client was added, by whom, and every update
-- (Max, Nov 9 11:16): "in the crm i need to see date created of the client in
--  the system. and also a way for me to see in periods who was added during
--  the last 7 days 30 days. 3 months. 6 months. 1 year. and who created it in
--  the crm. Also any updates... same time periods with dates of each updates
--  should be in the crm by default"
--
--  • customers.created_at / created_by / updated_at / updated_by — stamped by
--    the DATABASE on every insert / real change (whoever is signed in), so no
--    screen, import or AI path can skip it.
--  • customer_history — one row per creation, per real change (which fields,
--    from → to), per deletion. Written only by the trigger.
--  • Backfill: who created each client and every past edit, from the
--    existing audit_log (the Hub has been logging CRM writes there).
-- SAFE TO RE-RUN.
-- ═══════════════════════════════════════════════════════════════════════════

-- no default while adding: existing clients must NOT get today's date as their creation date
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.customers ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_by uuid;
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON public.customers (created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL,
  customer_name text,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  fields text[],
  source text NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS idx_cust_hist_when ON public.customer_history (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_hist_cust ON public.customer_history (customer_id, changed_at DESC);

ALTER TABLE public.customer_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_history_select ON public.customer_history;
DROP POLICY IF EXISTS customer_history_insert ON public.customer_history;
DROP POLICY IF EXISTS customer_history_update ON public.customer_history;
DROP POLICY IF EXISTS customer_history_delete ON public.customer_history;
CREATE POLICY customer_history_select ON public.customer_history FOR SELECT TO authenticated USING (true);
-- history is written ONLY by the trigger below (append-only: nobody edits or deletes it)
CREATE POLICY customer_history_insert ON public.customer_history FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY customer_history_update ON public.customer_history FOR UPDATE TO authenticated USING (false);
CREATE POLICY customer_history_delete ON public.customer_history FOR DELETE TO authenticated USING (false);

-- ── backfill BEFORE the triggers exist (so the backfill itself is not logged as edits) ──
DROP TRIGGER IF EXISTS trg_customers_stamp ON public.customers;
DROP TRIGGER IF EXISTS trg_customers_history ON public.customers;

DO $bf$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    -- who created each client (and when, if the date was never stored)
    UPDATE public.customers c
       SET created_by = COALESCE(c.created_by, a.changed_by),
           -- the EARLIER of the stored date and the logged creation
           created_at = CASE WHEN a.created_at IS NOT NULL AND (c.created_at IS NULL OR a.created_at < c.created_at) THEN a.created_at ELSE c.created_at END
      FROM (SELECT DISTINCT ON (record_id::text) record_id::text AS rid, changed_by, created_at
              FROM public.audit_log
             WHERE table_name = 'customers' AND action = 'create'
             ORDER BY record_id::text, created_at) a
     WHERE a.rid = c.id::text AND (c.created_by IS NULL OR c.created_at IS NULL OR a.created_at < c.created_at);

    -- every past edit the Hub logged
    INSERT INTO public.customer_history (customer_id, customer_name, action, changed_at, changed_by, changes, fields, source)
    SELECT a.record_id::text, COALESCE(c.name_en, c.name), 'updated', a.created_at, a.changed_by, d.changes, d.fields, 'audit_log'
      FROM public.audit_log a
      LEFT JOIN public.customers c ON c.id::text = a.record_id::text
      CROSS JOIN LATERAL (
        SELECT jsonb_object_agg(n.key, jsonb_build_object('from', COALESCE(a.old_values::jsonb, '{}'::jsonb) -> n.key, 'to', n.value)) AS changes,
               array_agg(n.key ORDER BY n.key) AS fields
          FROM jsonb_each(COALESCE(a.new_values::jsonb, '{}'::jsonb)) n
         WHERE n.key NOT IN ('id', 'created_at', 'created_by', 'updated_at', 'updated_by')
           AND n.value IS DISTINCT FROM (COALESCE(a.old_values::jsonb, '{}'::jsonb) -> n.key)
      ) d
     WHERE a.table_name = 'customers' AND a.action = 'update' AND d.fields IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.customer_history h
                        WHERE h.source = 'audit_log' AND h.customer_id = a.record_id::text AND h.changed_at = a.created_at);
  END IF;
  -- a "created" line for every client that has none yet — only when the date is KNOWN
  -- (an unknown date must never show up as "added this week")
  INSERT INTO public.customer_history (customer_id, customer_name, action, changed_at, changed_by, source)
  SELECT c.id::text, COALESCE(c.name_en, c.name), 'created', c.created_at, c.created_by, 'backfill'
    FROM public.customers c
   WHERE c.created_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customer_history h WHERE h.customer_id = c.id::text AND h.action = 'created');
END $bf$;

-- ── stamps: created_* on insert, updated_* on every REAL change ──
CREATE OR REPLACE FUNCTION public.customers_stamp() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE who uuid; real_change boolean;
BEGIN
  BEGIN who := auth.uid(); EXCEPTION WHEN OTHERS THEN who := NULL; END;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.created_by := COALESCE(NEW.created_by, who);
    RETURN NEW;
  END IF;
  -- creation facts never change
  NEW.created_at := COALESCE(OLD.created_at, NEW.created_at);
  NEW.created_by := COALESCE(OLD.created_by, NEW.created_by);
  real_change := (to_jsonb(NEW) - 'created_at' - 'created_by' - 'updated_at' - 'updated_by')
                 IS DISTINCT FROM (to_jsonb(OLD) - 'created_at' - 'created_by' - 'updated_at' - 'updated_by');
  IF real_change THEN
    NEW.updated_at := now();
    -- the signed-in person; a server job may name the person itself; otherwise unknown (never a stale name)
    NEW.updated_by := COALESCE(who, CASE WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END);
  ELSE
    NEW.updated_at := OLD.updated_at;
    NEW.updated_by := OLD.updated_by;
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_customers_stamp BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.customers_stamp();

-- ── history: one line per creation / real change / deletion ──
CREATE OR REPLACE FUNCTION public.customers_history_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE ch jsonb; fl text[]; who uuid;
BEGIN
  BEGIN who := auth.uid(); EXCEPTION WHEN OTHERS THEN who := NULL; END;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.customer_history (customer_id, customer_name, action, changed_at, changed_by)
    VALUES (NEW.id::text, COALESCE(NEW.name_en, NEW.name), 'created', COALESCE(NEW.created_at, now()), NEW.created_by);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.customer_history (customer_id, customer_name, action, changed_by, changes)
    VALUES (OLD.id::text, COALESCE(OLD.name_en, OLD.name), 'deleted', who, jsonb_build_object('name', jsonb_build_object('from', to_jsonb(OLD.name), 'to', NULL)));
    RETURN OLD;
  END IF;
  SELECT jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)), array_agg(n.key ORDER BY n.key)
    INTO ch, fl
    FROM jsonb_each(to_jsonb(NEW)) n
    LEFT JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.key NOT IN ('created_at', 'created_by', 'updated_at', 'updated_by')
     AND n.value IS DISTINCT FROM o.value;
  IF fl IS NOT NULL THEN
    INSERT INTO public.customer_history (customer_id, customer_name, action, changed_by, changes, fields)
    VALUES (NEW.id::text, COALESCE(NEW.name_en, NEW.name), 'updated', NEW.updated_by, ch, fl);
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_customers_history AFTER INSERT OR UPDATE OR DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.customers_history_log();

SELECT 'customers.created_at / created_by / updated_at / updated_by' AS check_name,
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers'
                   AND column_name IN ('created_at', 'created_by', 'updated_at', 'updated_by')) = 4 THEN 'OK' ELSE 'MISSING' END AS result
UNION ALL SELECT 'customer_history', CASE WHEN to_regclass('public.customer_history') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'clients with a known creator', (SELECT count(*) FILTER (WHERE created_by IS NOT NULL) || ' of ' || count(*) FROM public.customers)
UNION ALL SELECT 'history lines', (SELECT count(*)::text FROM public.customer_history);
