// ============================================================
// /api/whatsapp/conversations/[id]/read — MARK READ
// ============================================================
// POST body: optional { is_pinned, is_archived } — toggles those
// flags too in the same call. With no body, just resets the
// unread_count to 0.
//
// Called by the inbox UI whenever a conversation is opened.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../../../../lib/phone-auth';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export var runtime = 'nodejs';

export async function POST(req, ctx) {
  try {
    var auth = await requireUser(req);
    if (!auth.user) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }
    var conversationId = ctx && ctx.params && ctx.params.id;
    if (!conversationId) {
      return NextResponse.json({ error: 'missing conversation id' }, { status: 400 });
    }

    var body = {};
    try { body = await req.json(); } catch (_) {}

    var patch = { unread_count: 0 };
    if (typeof body.is_pinned === 'boolean') patch.is_pinned = body.is_pinned;
    if (typeof body.is_archived === 'boolean') patch.is_archived = body.is_archived;

    var upRes = await supabase.from('whatsapp_conversations').update(patch).eq('id', conversationId).select('id, unread_count, is_pinned, is_archived').maybeSingle();
    if (upRes.error) {
      return NextResponse.json({ error: upRes.error.message }, { status: 500 });
    }
    if (!upRes.data) {
      return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, conversation: upRes.data });
  } catch (err) {
    console.error('[whatsapp/read] error:', err);
    return NextResponse.json({ error: err.message || 'read failed' }, { status: 500 });
  }
}
