// ============================================================
// /api/phone/voicemails — VOICEMAIL LIST + READ STATUS
// ============================================================
// What this does:
//   GET: list voicemails, filterable by assigned_to, customer_id,
//        or unread-only. Powers the dashboard voicemail widget.
//   PATCH: mark a voicemail as read.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(req) {
  try {
    var url = new URL(req.url);
    var assignedTo = url.searchParams.get('assigned_to');
    var customerId = url.searchParams.get('customer_id');
    var unreadOnly = url.searchParams.get('unread') === 'true';
    var limit = parseInt(url.searchParams.get('limit') || '50', 10);
    if (limit > 200) limit = 200;

    var query = supabase
      .from('phone_voicemails')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (assignedTo) query = query.eq('assigned_to', assignedTo);
    if (customerId) query = query.eq('customer_id', customerId);
    if (unreadOnly) query = query.eq('is_read', false);

    var res = await query;
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ voicemails: res.data || [] });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH: mark voicemail read/unread
// Body: { id, is_read }
export async function PATCH(req) {
  try {
    var body = await req.json();
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    var res = await supabase
      .from('phone_voicemails')
      .update({ is_read: !!body.is_read })
      .eq('id', body.id)
      .select()
      .single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, voicemail: res.data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
