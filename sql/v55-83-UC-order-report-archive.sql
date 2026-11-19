-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-UC — ORDERS REPORT ARCHIVE: "Non issue" / "Corrected" (Max, Nov 18 2026)
-- A row on Accounting → 🚚 Orders that someone marks "Non issue" or "Corrected" leaves the report and its counts, and is kept
-- here: who, when, which choice, an optional note, and what the row showed at that moment. NOTHING IS EVER DELETED:
--   • archiving ADDS a row;
--   • "Put back" only fills restored_at / restored_by / restore_note on that row (once) — the archive history stays;
--   • deleting a row, or changing anything else on it, is refused by the database itself.
-- Adds ONE new table. Nothing existing is changed. Safe to run more than once.
-- Written only by the Hub server (service key); signed-in users read through the Hub's own checks.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.order_report_archive (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL,                       -- 'nextrade-staging' or 'nextrade-live' (which warehouse copy)
  order_id          integer NOT NULL,                    -- the warehouse order id
  release_number    text,
  choice            text NOT NULL CHECK (choice IN ('non_issue', 'corrected')),
  note              text,
  snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- what the row showed when it was archived (stage, invoice, outstanding…)
  archived_by       text,
  archived_by_name  text,
  archived_at       timestamptz NOT NULL DEFAULT now(),
  request_id        text UNIQUE,                         -- one click = one archive (a retry never makes two)
  restored_at       timestamptz,
  restored_by       text,
  restored_by_name  text,
  restore_note      text
);
-- one ACTIVE archive per order and warehouse copy; earlier (put back) ones stay as history
CREATE UNIQUE INDEX IF NOT EXISTS order_report_archive_one_active ON public.order_report_archive (source, order_id) WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS order_report_archive_order ON public.order_report_archive (source, order_id, archived_at DESC);

-- the guard: no delete; the only change allowed is "put back", once, filling the restored_* columns
CREATE OR REPLACE FUNCTION public.order_report_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HUB_GUARD: archived order rows are never deleted — use Put back.';
  END IF;
  IF OLD.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: this archive entry was already put back; it is kept as history and cannot be changed.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.source IS DISTINCT FROM OLD.source OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.release_number IS DISTINCT FROM OLD.release_number OR NEW.choice IS DISTINCT FROM OLD.choice OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
     OR NEW.archived_by_name IS DISTINCT FROM OLD.archived_by_name OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'HUB_GUARD: an archive entry cannot be edited — only put back.';
  END IF;
  IF NEW.restored_at IS NULL THEN
    RAISE EXCEPTION 'HUB_GUARD: put back needs the time it was put back.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS order_report_archive_guard ON public.order_report_archive;
CREATE TRIGGER order_report_archive_guard BEFORE UPDATE OR DELETE ON public.order_report_archive
  FOR EACH ROW EXECUTE FUNCTION public.order_report_archive_guard();

ALTER TABLE public.order_report_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_report_archive FROM anon, authenticated;

-- proof: should show 1 table, its 2 indexes and the guard
SELECT 'table' AS what, table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_report_archive'
UNION ALL SELECT 'index', indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'order_report_archive' AND indexname LIKE 'order_report_archive_%'
UNION ALL SELECT 'guard', tgname FROM pg_trigger WHERE tgname = 'order_report_archive_guard'
ORDER BY 1, 2;
