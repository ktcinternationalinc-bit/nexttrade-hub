-- ============================================================
-- s35_whatsapp_tables.sql
-- v55.31 — WhatsApp Business integration via Meta Cloud API
-- Date: 2026-04-28
--
-- Adds the data layer for the WhatsApp inbox. Three new tables:
--
--   whatsapp_conversations — one row per customer phone, tracks who
--                            "claimed" the conversation, last in/out
--                            timestamps, and the 24-hour reply window
--   whatsapp_messages      — every message in/out (text, media,
--                            template), with delivery status, ties
--                            to a conversation
--   whatsapp_templates     — local cache of Meta-approved templates
--                            (refreshed via Meta Graph API)
--
-- Run this BEFORE deploying the WhatsApp code or the API routes
-- will fail with "table does not exist" errors.
--
-- Safe to re-run (every CREATE uses IF NOT EXISTS).
-- ============================================================

-- =============================================================
-- 1. whatsapp_conversations — one per customer phone
-- =============================================================
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Customer's WhatsApp number in E.164 (e.g. "+201234567890")
  -- This is the conversation key — one customer = one conversation row.
  customer_wa_id TEXT NOT NULL UNIQUE,
  -- If we matched the WA number to a customer in our CRM, link it
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  -- Display name from WhatsApp profile (may differ from CRM name)
  display_name TEXT,
  -- The team member who "owns" this conversation. NULL = unclaimed.
  -- First click on "Claim" stamps this. Other team members still see
  -- the thread but it's marked as another rep's territory.
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  -- Timestamps for ordering + 24h-window calculation
  last_inbound_at TIMESTAMPTZ,        -- last message FROM the customer
  last_outbound_at TIMESTAMPTZ,       -- last message FROM us
  last_message_preview TEXT,          -- first ~100 chars of the most recent message
  last_message_direction TEXT,        -- 'inbound' or 'outbound'
  -- Unread counter — incremented on every inbound that arrives while
  -- conversation is not actively being viewed. Reset to 0 when opened.
  unread_count INTEGER NOT NULL DEFAULT 0,
  -- Pin a conversation to keep it on top of the list
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  -- Archive removes from the default inbox view (keeps history)
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_customer_id ON whatsapp_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_assigned_to ON whatsapp_conversations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_last_in ON whatsapp_conversations(last_inbound_at DESC);

COMMENT ON TABLE whatsapp_conversations IS 'WhatsApp conversation per customer phone number (v55.31)';
COMMENT ON COLUMN whatsapp_conversations.customer_wa_id IS 'Customer phone in E.164, e.g. +201234567890';
COMMENT ON COLUMN whatsapp_conversations.assigned_to IS 'Team member who claimed this conversation; NULL = unclaimed';

-- =============================================================
-- 2. whatsapp_messages — every message in or out
-- =============================================================
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  -- Meta's unique ID for this message (wamid.XXX). Unique per direction
  -- so we can dedupe webhook re-deliveries from Meta.
  wa_message_id TEXT UNIQUE,
  -- 'inbound' (customer → us) or 'outbound' (us → customer)
  direction TEXT NOT NULL,
  -- 'text', 'image', 'document', 'audio', 'video', 'template', 'sticker', 'location', 'contact'
  message_type TEXT NOT NULL DEFAULT 'text',
  -- The text body (for text messages, or the caption on media messages,
  -- or the rendered template body for outbound templates).
  body TEXT,
  -- Media-specific fields. Meta's Cloud API gives us a media_id we can
  -- exchange for a temporary download URL via the Graph API.
  media_id TEXT,
  media_url TEXT,           -- our cached download URL (lasts ~5min from Meta)
  media_mime_type TEXT,
  media_filename TEXT,      -- for documents
  media_size_bytes BIGINT,
  -- Template-specific fields (for outbound only)
  template_name TEXT,
  template_lang TEXT,
  template_variables JSONB,
  -- Status lifecycle for outbound: 'sending' → 'sent' → 'delivered' → 'read'
  -- Or terminal: 'failed' (with error_code + error_message)
  -- Inbound messages are stamped 'received' on creation.
  status TEXT NOT NULL DEFAULT 'sent',
  error_code TEXT,
  error_message TEXT,
  -- Who on the team sent this (NULL for inbound)
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- WhatsApp's reported send timestamp (ms since epoch from Meta)
  wa_timestamp TIMESTAMPTZ,
  -- Our DB timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_conv_id ON whatsapp_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_direction ON whatsapp_messages(direction);
CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_status ON whatsapp_messages(status);

COMMENT ON TABLE whatsapp_messages IS 'Individual WhatsApp messages within conversations (v55.31)';
COMMENT ON COLUMN whatsapp_messages.wa_message_id IS 'Meta wamid (unique) — used to dedupe webhook redelivery';
COMMENT ON COLUMN whatsapp_messages.status IS 'sending | sent | delivered | read | failed | received';

-- =============================================================
-- 3. whatsapp_templates — cached approved templates from Meta
-- =============================================================
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Meta's template ID + name. Name + language is unique in Meta.
  meta_template_id TEXT,
  template_name TEXT NOT NULL,
  language_code TEXT NOT NULL DEFAULT 'en',
  -- Meta's category: UTILITY, MARKETING, AUTHENTICATION
  category TEXT,
  -- Status from Meta: APPROVED, PENDING, REJECTED, DISABLED
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- The full template body with placeholders ({{1}}, {{2}}, ...)
  body_text TEXT NOT NULL,
  -- Header text or media template (optional)
  header_type TEXT,             -- 'TEXT', 'IMAGE', 'DOCUMENT', null
  header_text TEXT,
  -- Footer text (optional)
  footer_text TEXT,
  -- Variable hints — array of human-friendly names matching {{1}}, {{2}}
  -- e.g. ["customer_name", "order_number"] for "Hi {{1}}, your order {{2}}..."
  variable_hints JSONB,
  -- When refreshed from Meta
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_templates_name_lang
  ON whatsapp_templates(template_name, language_code);

COMMENT ON TABLE whatsapp_templates IS 'Cached approved WhatsApp message templates from Meta (v55.31)';

-- =============================================================
-- 4. Updated-at triggers — auto-touch updated_at on UPDATE
-- =============================================================
CREATE OR REPLACE FUNCTION whatsapp_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_conversations_touch ON whatsapp_conversations;
CREATE TRIGGER whatsapp_conversations_touch
  BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

DROP TRIGGER IF EXISTS whatsapp_messages_touch ON whatsapp_messages;
CREATE TRIGGER whatsapp_messages_touch
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION whatsapp_touch_updated_at();

-- =============================================================
-- 5. RLS — service role bypasses; logged-in users see everything
-- =============================================================
-- Like the phone tables: API routes use the service-role key (bypasses RLS).
-- Direct browser queries via supabase-js need a permissive read policy.
-- We let any logged-in user SELECT — granular per-rep visibility is
-- enforced in the API layer for routes that need it.
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_conv_select ON whatsapp_conversations;
CREATE POLICY whatsapp_conv_select ON whatsapp_conversations FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS whatsapp_msg_select ON whatsapp_messages;
CREATE POLICY whatsapp_msg_select ON whatsapp_messages FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS whatsapp_tpl_select ON whatsapp_templates;
CREATE POLICY whatsapp_tpl_select ON whatsapp_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Refresh PostgREST schema cache so the API picks up the new tables
NOTIFY pgrst, 'reload schema';
