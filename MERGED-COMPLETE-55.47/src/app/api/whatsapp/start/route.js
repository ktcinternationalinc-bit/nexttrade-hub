// ============================================================
// /api/whatsapp/start — START A NEW CONVERSATION
// ============================================================
// Used when the team wants to message a customer we haven't been
// in contact with before (or whose 24h window has lapsed). Required
// because Meta's policy is: outbound-first messages MUST be templates.
//
// POST body:
//   { to: '+201234567890',
//     template_name: 'shipping_update',
//     language_code: 'en',           (default 'en')
//     variables: ['Joe', 'ABC123'],  (fills {{1}}, {{2}} in template)
//     customer_id?: UUID             (link to a CRM customer)
//   }
//
// Side effects:
//   • Finds or creates the whatsapp_conversations row (one per phone)
//   • Sends the template via /api/whatsapp/send mechanics
//   • Records the outbound message
//   • Returns the conversation id so the UI can open it immediately
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../../lib/phone-auth';
import { normalizePhone, sendTemplate } from '../../../../lib/whatsapp';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export var runtime = 'nodejs';
export var maxDuration = 30;

export async function POST(req) {
  try {
    var auth = await requireUser(req);
    if (!auth.user) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }

    var body = await req.json();
    var to = body.to;
    var templateName = body.template_name;
    var langCode = body.language_code || 'en';
    var variables = Array.isArray(body.variables) ? body.variables : [];
    var customerId = body.customer_id || null;

    if (!to) return NextResponse.json({ error: 'to (phone number) required' }, { status: 400 });
    if (!templateName) return NextResponse.json({ error: 'template_name required (outbound-first must use template)' }, { status: 400 });

    var normalized = normalizePhone(to);
    if (!normalized) {
      return NextResponse.json({ error: 'could not normalize phone number ' + to }, { status: 400 });
    }

    // Find or create the conversation row for this phone
    var existing = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('customer_wa_id', normalized)
      .maybeSingle();
    if (existing.error) {
      return NextResponse.json({ error: existing.error.message }, { status: 500 });
    }

    var conv = existing.data;
    if (!conv) {
      // Create the conversation. Auto-claim by the user starting it.
      var insRes = await supabase.from('whatsapp_conversations').insert({
        customer_wa_id: normalized,
        customer_id: customerId,
        assigned_to: auth.user.id,
        assigned_at: new Date().toISOString(),
      }).select('*').maybeSingle();
      if (insRes.error) {
        return NextResponse.json({ error: insRes.error.message }, { status: 500 });
      }
      conv = insRes.data;
    } else if (customerId && !conv.customer_id) {
      // Link to CRM customer if provided and not already linked
      await supabase.from('whatsapp_conversations')
        .update({ customer_id: customerId })
        .eq('id', conv.id);
      conv.customer_id = customerId;
    }

    // Send the template via Meta Cloud API
    var metaRes;
    try {
      metaRes = await sendTemplate(normalized, templateName, langCode, variables, null);
    } catch (sendErr) {
      // Persist the failure so the user can see it in the thread
      await supabase.from('whatsapp_messages').insert({
        conversation_id: conv.id,
        direction: 'outbound',
        message_type: 'template',
        body: '[template ' + templateName + ' to ' + normalized + ']',
        template_name: templateName,
        template_lang: langCode,
        template_variables: variables,
        status: 'failed',
        error_message: sendErr.message || String(sendErr),
        sent_by: auth.user.id,
      });
      return NextResponse.json({ error: 'send failed: ' + (sendErr.message || sendErr) }, { status: 500 });
    }

    // Record the outbound message + update conversation timestamps
    var nowIso = new Date().toISOString();
    var preview = '[Template] ' + templateName +
      (variables.length > 0 ? ' — ' + variables.slice(0, 2).join(', ') : '');
    var msgIns = await supabase.from('whatsapp_messages').insert({
      conversation_id: conv.id,
      wa_message_id: (metaRes && metaRes.messages && metaRes.messages[0] && metaRes.messages[0].id) || null,
      direction: 'outbound',
      message_type: 'template',
      body: preview,
      template_name: templateName,
      template_lang: langCode,
      template_variables: variables,
      status: 'sent',
      sent_by: auth.user.id,
      wa_timestamp: nowIso,
    }).select('*').maybeSingle();

    await supabase.from('whatsapp_conversations').update({
      last_outbound_at: nowIso,
      last_message_preview: preview.substring(0, 100),
      last_message_direction: 'outbound',
    }).eq('id', conv.id);

    return NextResponse.json({
      ok: true,
      conversation_id: conv.id,
      message: msgIns.data || null,
    });
  } catch (err) {
    console.error('[whatsapp/start] error:', err);
    return NextResponse.json({ error: err.message || 'start failed' }, { status: 500 });
  }
}
