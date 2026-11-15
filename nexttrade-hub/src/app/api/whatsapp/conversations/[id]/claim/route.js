// ============================================================
// /api/whatsapp/conversations/[id]/claim — CLAIM / RELEASE
// ============================================================
// POST body modes:
//   {} or { action: 'claim' }       — assign this conversation to me
//   { action: 'release' }            — unassign (back to unclaimed)
//   { action: 'assign', user_id: X } — assign to someone else
//                                      (super-admin only)
//
// Anyone can claim an unclaimed conversation. Anyone can take over
// from another user (we don't lock — collaborative ownership). The
// assigned_at timestamp gets refreshed on every claim/reassign.
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
    try { body = await req.json(); } catch (_) { /* empty body = claim self */ }
    var action = body.action || 'claim';

    var patch = {};
    if (action === 'release') {
      patch.assigned_to = null;
      patch.assigned_at = null;
    } else if (action === 'assign') {
      // Reassigning to another user requires super_admin.
      if (!body.user_id) {
        return NextResponse.json({ error: 'user_id required for assign action' }, { status: 400 });
      }
      // Look up the caller's role
      var meRes = await supabase.from('users').select('role').eq('id', auth.user.id).maybeSingle();
      var myRole = (meRes.data && meRes.data.role) || null;
      if (myRole !== 'super_admin') {
        return NextResponse.json({ error: 'only super admin can reassign to another user' }, { status: 403 });
      }
      patch.assigned_to = body.user_id;
      patch.assigned_at = new Date().toISOString();
    } else {
      // Default: claim for self
      patch.assigned_to = auth.user.id;
      patch.assigned_at = new Date().toISOString();
    }

    var upRes = await supabase.from('whatsapp_conversations').update(patch).eq('id', conversationId).select('*').maybeSingle();
    if (upRes.error) {
      return NextResponse.json({ error: upRes.error.message }, { status: 500 });
    }
    if (!upRes.data) {
      return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, action: action, conversation: upRes.data });
  } catch (err) {
    console.error('[whatsapp/claim] error:', err);
    return NextResponse.json({ error: err.message || 'claim failed' }, { status: 500 });
  }
}
