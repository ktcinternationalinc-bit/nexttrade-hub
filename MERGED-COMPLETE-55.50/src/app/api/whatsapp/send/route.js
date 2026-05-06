// ============================================================
// /api/whatsapp/send — OUTBOUND MESSAGES
// ============================================================
// Single endpoint that handles all three send modes:
//
//   1. Text message  — { conversation_id, body }
//      Only works inside the 24-hour window. We check it first
//      and return a clear error if expired.
//
//   2. Media message — { conversation_id, kind: 'image|document|audio|video',
//                        upload: { base64, mime_type, filename } | media_id,
//                        caption? }
//      Same 24-hour window rule. Either upload base64 bytes (we
//      forward to Meta's media endpoint) OR pass a Meta media_id
//      that's already been uploaded.
//
//   3. Template — { conversation_id, template_name, language_code,
//                   variables: [...], header_image_media_id? }
//      Works at ANY time (templates are how you re-engage outside
//      the 24h window). Variables fill {{1}}, {{2}}, ... in the
//      template body in order.
//
// All three return the saved whatsapp_messages row so the UI can
// render it immediately without waiting for the next page reload.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../../lib/phone-auth';
import {
  sendText, sendMedia, sendTemplate, uploadMedia, isInWindow,
} from '../../../../lib/whatsapp';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const runtime = 'nodejs';
export const maxDuration = 30; // allow time for media upload to Meta

export async function POST(req) {
  try {
    var auth = await requireUser(req);
    if (!auth.user) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }

    var body = await req.json();
    var conversationId = body.conversation_id;
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
    }

    // Look up the conversation to get the recipient phone + window state
    var convRes = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('id', conversationId)
      .maybeSingle();
    if (!convRes.data) {
      return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
    }
    var conv = convRes.data;

    // Branch on the request shape
    var hasText = !!body.body && !body.kind && !body.template_name;
    var hasMedia = !!body.kind && !body.template_name;
    var hasTemplate = !!body.template_name;

    if (!hasText && !hasMedia && !hasTemplate) {
      return NextResponse.json({
        error: 'request must include either { body }, { kind, ... }, or { template_name, ... }'
      }, { status: 400 });
    }

    // ---- 24-hour window enforcement (skip for templates) ----
    if ((hasText || hasMedia) && !isInWindow(conv.last_inbound_at)) {
      return NextResponse.json({
        error: 'Outside 24-hour reply window. Send a template instead.',
        code: 'WINDOW_EXPIRED',
        last_inbound_at: conv.last_inbound_at,
      }, { status: 400 });
    }

    // ---- Dispatch to the right Meta API call ----
    var sendResult;
    var rowToInsert = {
      conversation_id: conv.id,
      direction: 'outbound',
      sent_by: auth.user.id,
      status: 'sending',
      wa_timestamp: new Date().toISOString(),
    };

    try {
      if (hasText) {
        sendResult = await sendText(conv.customer_wa_id, body.body);
        rowToInsert.message_type = 'text';
        rowToInsert.body = body.body;
      } else if (hasMedia) {
        var mediaId = body.media_id;
        var mimeType = body.upload && body.upload.mime_type;
        var filename = body.upload && body.upload.filename;
        // If the caller passed raw bytes, upload to Meta first to get media_id
        if (!mediaId && body.upload && body.upload.base64) {
          var buf = Buffer.from(body.upload.base64, 'base64');
          // Sanity-check size — Meta's limits are 5MB image, 16MB video,
          // 100MB document. We refuse anything over 16MB to keep upload
          // latency reasonable; admins can override by going to Meta directly.
          if (buf.length > 16 * 1024 * 1024) {
            return NextResponse.json({ error: 'Media too large (>16MB). Use a smaller file.' }, { status: 413 });
          }
          mediaId = await uploadMedia(buf, mimeType, filename);
        }
        if (!mediaId) {
          return NextResponse.json({ error: 'media_id or upload.base64 required for media send' }, { status: 400 });
        }
        sendResult = await sendMedia(conv.customer_wa_id, body.kind, mediaId, {
          caption: body.caption,
          filename: filename,
        });
        rowToInsert.message_type = body.kind;
        rowToInsert.body = body.caption || null;
        rowToInsert.media_id = mediaId;
        rowToInsert.media_mime_type = mimeType || null;
        rowToInsert.media_filename = filename || null;
      } else {
        // Template
        sendResult = await sendTemplate(
          conv.customer_wa_id,
          body.template_name,
          body.language_code || 'en',
          body.variables || [],
          body.header_image_media_id
        );
        rowToInsert.message_type = 'template';
        rowToInsert.template_name = body.template_name;
        rowToInsert.template_lang = body.language_code || 'en';
        rowToInsert.template_variables = body.variables || [];
        // Build a readable preview body with variables substituted in
        // (best-effort — the actual text the customer sees is rendered
        // by Meta from the approved template).
        rowToInsert.body = '[Template: ' + body.template_name + ']';
      }
    } catch (sendErr) {
      // Log a failed-send row so the team sees what happened
      rowToInsert.status = 'failed';
      rowToInsert.error_code = String(sendErr.code || '');
      rowToInsert.error_message = sendErr.message || 'Send failed';
      var failIns = await supabase.from('whatsapp_messages').insert(rowToInsert).select().single();
      return NextResponse.json({
        error: sendErr.message || 'Send failed',
        code: sendErr.code,
        message: failIns.data || null,
      }, { status: 502 });
    }

    // Success — stamp the wamid + sent status + insert
    rowToInsert.wa_message_id = sendResult.wa_message_id;
    rowToInsert.status = 'sent';

    var ins = await supabase.from('whatsapp_messages').insert(rowToInsert).select().single();
    if (ins.error) {
      console.error('[whatsapp/send] insert sent message failed:', ins.error.message);
    }

    // Update conversation: outbound timestamps + last preview + reset unread
    // (sending a message implies the team has seen the inbound thread)
    var preview = rowToInsert.body
      ? String(rowToInsert.body).slice(0, 100)
      : '[' + rowToInsert.message_type + ']';
    await supabase
      .from('whatsapp_conversations')
      .update({
        last_outbound_at: new Date().toISOString(),
        last_message_preview: preview,
        last_message_direction: 'outbound',
        unread_count: 0,
      })
      .eq('id', conv.id);

    return NextResponse.json({
      ok: true,
      message: ins.data,
      wa_message_id: sendResult.wa_message_id,
    });
  } catch (e) {
    console.error('[whatsapp/send] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
