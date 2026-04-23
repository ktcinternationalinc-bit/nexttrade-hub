import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET: list all phone numbers
export async function GET() {
  try {
    const { data, error } = await supabase.from('phone_numbers').select('*').order('created_at');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ numbers: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: add or assign a phone number
export async function POST(req) {
  try {
    const { phone_number, assigned_to, label } = await req.json();
    if (!phone_number) return NextResponse.json({ error: 'Phone number required' }, { status: 400 });

    const { data, error } = await supabase.from('phone_numbers').upsert({
      phone_number,
      assigned_to: assigned_to || null,
      label: label || null,
    }, { onConflict: 'phone_number' }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, number: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE: remove a phone number
export async function DELETE(req) {
  try {
    const { id } = await req.json();
    const { error } = await supabase.from('phone_numbers').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
