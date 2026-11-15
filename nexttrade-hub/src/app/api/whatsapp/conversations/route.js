// ============================================================
// /api/whatsapp/conversations — LIST WITH FILTER
// ============================================================
// Returns a sorted list of WhatsApp conversations (newest activity
// first) for the inbox UI. Always returns ALL conversations the
// authenticated user can see — the filter parameter narrows the
// list client-side too, but we apply it server-side so the
// payload stays small.
//
// Query params:
//   filter   — 'all' | 'mine' | 'unclaimed' | 'unread' (default: all)
//   archived — '1' to include archived; default: hide archived
//   limit    — page size (default 50, max 200)
//
// Response shape:
//   { conversations: [
//       { id, customer_wa_id, customer_id, customer_name,
//         display_name, assigned_to, assigned_to_name,
//         last_inbound_at, last_outbound_at, last_message_preview,
//         last_message_direction, unread_count, is_pinned,
//         is_archived, in_window }
//     ], total: N }
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../../lib/phone-auth';
import { isInWindow } from '../../../../lib/whatsapp';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export var runtime = 'nodejs';

export async function GET(req) {
  try {
    var auth = await requireUser(req);
    if (!auth.user) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }

    var url = new URL(req.url);
    var filter = url.searchParams.get('filter') || 'all';
    var includeArchived = url.searchParams.get('archived') === '1';
    var limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

    // Pull conversations sorted by most recent inbound first (with outbound
    // as the secondary key for new outbound-only conversations).
    var query = supabase.from('whatsapp_conversations').select('*');
    if (!includeArchived) query = query.eq('is_archived', false);
    if (filter === 'mine') query = query.eq('assigned_to', auth.user.id);
    if (filter === 'unclaimed') query = query.is('assigned_to', null);
    if (filter === 'unread') query = query.gt('unread_count', 0);
    query = query.order('is_pinned', { ascending: false })
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .order('last_outbound_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    var convRes = await query;
    if (convRes.error) {
      return NextResponse.json({ error: convRes.error.message }, { status: 500 });
    }
    var convs = convRes.data || [];

    // Resolve assigned_to and customer_id to display names. Two batched
    // lookups, both small.
    var assigneeIds = [];
    var customerIds = [];
    for (var i = 0; i < convs.length; i++) {
      if (convs[i].assigned_to && assigneeIds.indexOf(convs[i].assigned_to) < 0) {
        assigneeIds.push(convs[i].assigned_to);
      }
      if (convs[i].customer_id && customerIds.indexOf(convs[i].customer_id) < 0) {
        customerIds.push(convs[i].customer_id);
      }
    }

    var userMap = {};
    if (assigneeIds.length > 0) {
      var uRes = await supabase.from('users').select('id, name').in('id', assigneeIds);
      (uRes.data || []).forEach(function (u) { userMap[u.id] = u.name; });
    }

    var customerMap = {};
    if (customerIds.length > 0) {
      var cRes = await supabase.from('customers').select('id, name').in('id', customerIds);
      (cRes.data || []).forEach(function (c) { customerMap[c.id] = c.name; });
    }

    // Decorate the rows
    var decorated = convs.map(function (c) {
      return {
        id: c.id,
        customer_wa_id: c.customer_wa_id,
        customer_id: c.customer_id,
        customer_name: c.customer_id ? (customerMap[c.customer_id] || null) : null,
        display_name: c.display_name,
        assigned_to: c.assigned_to,
        assigned_to_name: c.assigned_to ? (userMap[c.assigned_to] || null) : null,
        last_inbound_at: c.last_inbound_at,
        last_outbound_at: c.last_outbound_at,
        last_message_preview: c.last_message_preview,
        last_message_direction: c.last_message_direction,
        unread_count: c.unread_count || 0,
        is_pinned: !!c.is_pinned,
        is_archived: !!c.is_archived,
        in_window: isInWindow(c.last_inbound_at),
      };
    });

    return NextResponse.json({ conversations: decorated, total: decorated.length });
  } catch (err) {
    console.error('[whatsapp/conversations] error:', err);
    return NextResponse.json({ error: err.message || 'list failed' }, { status: 500 });
  }
}
