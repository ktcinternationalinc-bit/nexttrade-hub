// ============================================================
// /api/whatsapp/conversations/[id] — SINGLE CONVERSATION + MESSAGES
// ============================================================
// Returns a single conversation with its full message thread,
// sorted oldest first (so the UI can render top-down). Includes
// the conversation row itself, all messages, customer name (if
// linked), assigned-to name (if claimed), and the 24h-window
// status flag.
//
// Query params:
//   limit  — max messages (default 200, max 500)
//   before — ISO timestamp; load messages before this point (paging)
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../../../lib/phone-auth';
import { isInWindow } from '../../../../../lib/whatsapp';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export var runtime = 'nodejs';

export async function GET(req, ctx) {
  try {
    var auth = await requireUser(req);
    if (!auth.user) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }

    var conversationId = ctx && ctx.params && ctx.params.id;
    if (!conversationId) {
      return NextResponse.json({ error: 'missing conversation id' }, { status: 400 });
    }

    var url = new URL(req.url);
    var limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);
    var before = url.searchParams.get('before');

    // Conversation
    var convRes = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('id', conversationId)
      .maybeSingle();
    if (convRes.error) {
      return NextResponse.json({ error: convRes.error.message }, { status: 500 });
    }
    if (!convRes.data) {
      return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
    }
    var conv = convRes.data;

    // Resolve names
    var assignedName = null;
    if (conv.assigned_to) {
      var uRes = await supabase.from('users').select('name').eq('id', conv.assigned_to).maybeSingle();
      assignedName = (uRes.data && uRes.data.name) || null;
    }
    var customerName = null;
    if (conv.customer_id) {
      var cRes = await supabase.from('customers').select('name').eq('id', conv.customer_id).maybeSingle();
      customerName = (cRes.data && cRes.data.name) || null;
    }

    // Messages (oldest first for display)
    var msgQuery = supabase.from('whatsapp_messages')
      .select('*')
      .eq('conversation_id', conversationId);
    if (before) msgQuery = msgQuery.lt('created_at', before);
    msgQuery = msgQuery.order('created_at', { ascending: true }).limit(limit);

    var msgRes = await msgQuery;
    if (msgRes.error) {
      return NextResponse.json({ error: msgRes.error.message }, { status: 500 });
    }

    // Resolve sent_by to names for outbound messages so the UI can show
    // who on the team sent each reply.
    var senderIds = [];
    (msgRes.data || []).forEach(function (m) {
      if (m.sent_by && senderIds.indexOf(m.sent_by) < 0) senderIds.push(m.sent_by);
    });
    var senderMap = {};
    if (senderIds.length > 0) {
      var sRes = await supabase.from('users').select('id, name').in('id', senderIds);
      (sRes.data || []).forEach(function (u) { senderMap[u.id] = u.name; });
    }

    var messages = (msgRes.data || []).map(function (m) {
      return {
        id: m.id,
        wa_message_id: m.wa_message_id,
        direction: m.direction,
        message_type: m.message_type,
        body: m.body,
        media_id: m.media_id,
        media_url: m.media_url,
        media_mime_type: m.media_mime_type,
        media_filename: m.media_filename,
        template_name: m.template_name,
        status: m.status,
        error_code: m.error_code,
        error_message: m.error_message,
        sent_by: m.sent_by,
        sent_by_name: m.sent_by ? (senderMap[m.sent_by] || null) : null,
        wa_timestamp: m.wa_timestamp,
        created_at: m.created_at,
      };
    });

    return NextResponse.json({
      conversation: {
        id: conv.id,
        customer_wa_id: conv.customer_wa_id,
        customer_id: conv.customer_id,
        customer_name: customerName,
        display_name: conv.display_name,
        assigned_to: conv.assigned_to,
        assigned_to_name: assignedName,
        last_inbound_at: conv.last_inbound_at,
        last_outbound_at: conv.last_outbound_at,
        unread_count: conv.unread_count || 0,
        is_pinned: !!conv.is_pinned,
        is_archived: !!conv.is_archived,
        in_window: isInWindow(conv.last_inbound_at),
      },
      messages: messages,
      message_count: messages.length,
    });
  } catch (err) {
    console.error('[whatsapp/conversations/:id] error:', err);
    return NextResponse.json({ error: err.message || 'fetch failed' }, { status: 500 });
  }
}
