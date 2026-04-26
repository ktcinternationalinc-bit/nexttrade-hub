// ============================================================
// /api/phone/numbers — PHONE NUMBER REGISTRATION
// ============================================================
// What this does:
//   CRUD for the phone_numbers table — your KTC Twilio numbers
//   and which team member each one is assigned to.
//
//   Used by the Settings → Phone Numbers UI (built in Phase B).
//   For now you can also POST directly to seed your 4 numbers.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET: list all phone numbers
export async function GET() {
  try {
    var res = await supabase
      .from('phone_numbers')
      .select('id, phone_number, label, number_type, assigned_to, recording_enabled, voicemail_enabled, created_at, updated_at')
      .order('number_type', { ascending: true })
      .order('created_at', { ascending: true });
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ numbers: res.data || [] });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: add or upsert a phone number
// Body: { phone_number, label?, number_type?, assigned_to?, recording_enabled?, voicemail_enabled? }
export async function POST(req) {
  try {
    var body = await req.json();
    var phone_number = body.phone_number;
    if (!phone_number) {
      return NextResponse.json({ error: 'phone_number is required' }, { status: 400 });
    }

    // Normalize phone number to E.164 (must start with +)
    if (!phone_number.startsWith('+')) {
      return NextResponse.json({ error: 'phone_number must be in E.164 format (e.g. +18886007096)' }, { status: 400 });
    }

    var record = {
      phone_number: phone_number,
      label: body.label || null,
      number_type: body.number_type || 'personal',
      assigned_to: body.assigned_to || null,
      recording_enabled: body.recording_enabled !== false, // default TRUE
      voicemail_enabled: body.voicemail_enabled !== false, // default TRUE
      twilio_account_sid: process.env.TWILIO_ACCOUNT_SID || null,
      updated_at: new Date().toISOString(),
    };

    var res = await supabase
      .from('phone_numbers')
      .upsert(record, { onConflict: 'phone_number' })
      .select()
      .single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, number: res.data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH: update a single field on a phone number (e.g. assign to user, toggle recording)
// Body: { id, ...fields_to_update }
export async function PATCH(req) {
  try {
    var body = await req.json();
    var id = body.id;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    var allowed = ['label', 'number_type', 'assigned_to', 'recording_enabled', 'voicemail_enabled'];
    var updates = { updated_at: new Date().toISOString() };
    for (var i = 0; i < allowed.length; i++) {
      var k = allowed[i];
      if (body[k] !== undefined) updates[k] = body[k];
    }

    var res = await supabase.from('phone_numbers').update(updates).eq('id', id).select().single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, number: res.data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE: remove a phone number record
// Body: { id }
export async function DELETE(req) {
  try {
    var body = await req.json();
    var id = body.id;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    var res = await supabase.from('phone_numbers').delete().eq('id', id);
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
