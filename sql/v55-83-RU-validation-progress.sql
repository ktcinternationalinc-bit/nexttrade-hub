-- ═══════════════════════════════════════════════════════════════════════════
-- v55.83-RU — Max, Nov 9 21:48: "please save entries when we validate even if we have not yet fully validated.
-- such as just entering the type or the direction."
-- The type and the direction are saved on the bill itself the moment they are picked (no SQL needed for that).
-- This column keeps the rest of an unfinished validation — the ticks, the HOW note, the price-issue note — as a DRAFT,
-- so whoever opens it next picks up where it was left. A draft never counts as validated; it is cleared on validation.
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.vendor_bills ADD COLUMN IF NOT EXISTS validation_draft jsonb;
