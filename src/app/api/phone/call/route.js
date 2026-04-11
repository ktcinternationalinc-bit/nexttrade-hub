import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST: log a call
export async function POST(req) {
  try {
    const body = await req.json();
    const { user_id, phone_number, direction, duration, status, caller_name, call_sid } = body;

    const { data, error } = await supabase.from('call_logs').insert({
      user_id,
      phone_number,
      direction: direction || 'outbound',
      duration: duration || 0,
      status: status || 'completed',
      caller_name: caller_name || null,
      call_sid: call_sid || null,
      called_at: new Date().toISOString(),
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, log: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET: fetch call logs
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');

    let query = supabase.from('call_logs').select('*').order('called_at', { ascending: false }).limit(200);
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ logs: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
