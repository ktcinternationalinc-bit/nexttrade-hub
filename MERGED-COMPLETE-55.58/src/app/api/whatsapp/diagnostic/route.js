// ============================================================
// /api/whatsapp/diagnostic — HEALTH CHECK
// ============================================================
// Returns a snapshot of WhatsApp integration health so the team
// can see at a glance whether everything's wired up:
//   • env vars present (without leaking values)
//   • total conversations
//   • last inbound timestamp (proves webhook deliveries are landing)
//   • last outbound timestamp
//   • count of messages by status (sent/delivered/read/failed)
//
// Use case: after Meta dashboard setup, hit this URL to confirm
// you didn't miss any env var. Also useful when troubleshooting
// "messages aren't coming in".
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../../lib/phone-auth';

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

    var env = {
      WHATSAPP_PHONE_NUMBER_ID: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_BUSINESS_ACCOUNT_ID: !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      WHATSAPP_ACCESS_TOKEN: !!process.env.WHATSAPP_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: !!process.env.WHATSAPP_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
    };
    var allConfigured = env.WHATSAPP_PHONE_NUMBER_ID
      && env.WHATSAPP_ACCESS_TOKEN
      && env.WHATSAPP_APP_SECRET
      && env.WHATSAPP_VERIFY_TOKEN;

    // Counts and timestamps. All best-effort — partial failures are OK.
    var stats = {
      conversations_total: 0,
      conversations_unread: 0,
      conversations_unclaimed: 0,
      last_inbound_at: null,
      last_outbound_at: null,
      message_counts_by_status: {},
    };
    try {
      var c1 = await supabase.from('whatsapp_conversations').select('id', { count: 'exact', head: true });
      stats.conversations_total = c1.count || 0;
    } catch (_) {}
    try {
      var c2 = await supabase.from('whatsapp_conversations').select('id', { count: 'exact', head: true }).gt('unread_count', 0);
      stats.conversations_unread = c2.count || 0;
    } catch (_) {}
    try {
      var c3 = await supabase.from('whatsapp_conversations').select('id', { count: 'exact', head: true }).is('assigned_to', null);
      stats.conversations_unclaimed = c3.count || 0;
    } catch (_) {}
    try {
      var lin = await supabase.from('whatsapp_conversations').select('last_inbound_at').order('last_inbound_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      stats.last_inbound_at = (lin.data && lin.data.last_inbound_at) || null;
    } catch (_) {}
    try {
      var lout = await supabase.from('whatsapp_conversations').select('last_outbound_at').order('last_outbound_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      stats.last_outbound_at = (lout.data && lout.data.last_outbound_at) || null;
    } catch (_) {}

    // Status counts — pull recent messages and bucket by status
    try {
      var statusRes = await supabase.from('whatsapp_messages').select('status').limit(2000);
      var counts = {};
      (statusRes.data || []).forEach(function (m) {
        counts[m.status] = (counts[m.status] || 0) + 1;
      });
      stats.message_counts_by_status = counts;
    } catch (_) {}

    return NextResponse.json({
      ok: true,
      env_configured: allConfigured,
      env: env,
      stats: stats,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[whatsapp/diagnostic] error:', err);
    return NextResponse.json({ error: err.message || 'diagnostic failed' }, { status: 500 });
  }
}
