// ============================================================
// /api/phone/call — CALL LOG QUERY
// ============================================================
// What this does:
//   GET: returns recent calls, optionally filtered by user_id
//        or customer_id.
//   POST: log a call manually (used when the team adds a call
//        that wasn't placed via the system).
//
//   The webhooks (/api/phone/incoming + /api/phone/call-status)
//   handle the bulk of automatic call logging.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET: list calls (filterable)
export async function GET(req) {
  try {
    var url = new URL(req.url);
    var userId = url.searchParams.get('user_id');
    var customerId = url.searchParams.get('customer_id');
    var limit = parseInt(url.searchParams.get('limit') || '100', 10);
    if (limit > 500) limit = 500;

    var query = supabase
      .from('phone_calls')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (userId) query = query.eq('user_id', userId);
    if (customerId) query = query.eq('customer_id', customerId);

    var res = await query;
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ calls: res.data || [] });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: log a call manually
// Body: { user_id, customer_id?, ktc_number, customer_number, direction, status?, duration_seconds?, notes? }
export async function POST(req) {
  try {
    var body = await req.json();
    if (!body.ktc_number || !body.customer_number) {
      return NextResponse.json({ error: 'ktc_number and customer_number are required' }, { status: 400 });
    }

    var record = {
      direction: body.direction || 'outbound',
      ktc_number: body.ktc_number,
      customer_number: body.customer_number,
      customer_id: body.customer_id || null,
      user_id: body.user_id || null,
      status: body.status || 'completed',
      duration_seconds: body.duration_seconds || 0,
      caller_name: body.caller_name || null,
      notes: body.notes || null,
      started_at: body.started_at || new Date().toISOString(),
      ended_at: body.ended_at || new Date().toISOString(),
    };

    var res = await supabase.from('phone_calls').insert(record).select().single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, call: res.data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
