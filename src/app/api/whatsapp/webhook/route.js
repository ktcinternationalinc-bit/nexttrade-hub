// ============================================================
// /api/whatsapp/webhook — META CLOUD API WEBHOOK
// ============================================================
// What this does:
//   This is the URL you configure in Meta's WhatsApp dashboard. Meta
//   sends every incoming message AND every outbound status update
//   (sent/delivered/read/failed) here.
//
// Two HTTP methods on the same URL:
//
//   GET  — Meta's webhook verification handshake (only happens once,
//          when you first set up the webhook in Meta dashboard). Meta
//          sends ?hub.mode=subscribe&hub.verify_token=X&hub.challenge=Y.
//          We must check that X matches our WHATSAPP_VERIFY_TOKEN env
//          var, and echo back Y as plain text. After this, GET is
//          never called again.
//
//   POST — Every actual webhook event. Body is JSON. We must verify
//          the X-Hub-Signature-256 header before trusting it.
//
// What POST events we handle:
//
//   1. Inbound message — customer sent us text/image/doc/etc.
//      → Find or create the conversation
//      → Create whatsapp_messages row
//      → Update conversation timestamps + unread count
//      → Match to CRM customer by phone
//
//   2. Status update — Meta confirms our outbound message was
//      sent / delivered / read / failed
//      → Find the message by wa_message_id
//      → Update status field
//
// CRITICAL: Meta retries webhooks on non-2xx response, sometimes
// REPEATEDLY. We MUST return 200 quickly (under 5s) and dedupe by
// wa_message_id so we don't duplicate rows on retry.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMetaSignature, normalizePhone } from '../../../../lib/whatsapp';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const runtime = 'nodejs';

// --------------------------------------------------------------
// GET — webhook verification handshake (one-time)
// --------------------------------------------------------------
export async function GET(req) {
  try {
    var url = new URL(req.url);
    var mode = url.searchParams.get('hub.mode');
    var token = url.searchParams.get('hub.verify_token');
    var challenge = url.searchParams.get('hub.challenge');

    var verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) {
      console.warn('[whatsapp/webhook] WHATSAPP_VERIFY_TOKEN not set — verification will fail');
      return new Response('Verify token not configured on server', { status: 500 });
    }
    if (mode === 'subscribe' && token === verifyToken && challenge) {
      // Meta expects the challenge echoed back as plain text, NOT JSON
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  } catch (e) {
    console.error('[whatsapp/webhook GET] error:', e.message);
    return new Response('Server error', { status: 500 });
  }
}

// --------------------------------------------------------------
// POST — actual webhook events (signed)
// --------------------------------------------------------------
export async function POST(req) {
  try {
    // Read the raw body BEFORE parsing — needed for signature verification.
    // Re-stringifying the parsed JSON is NOT equivalent (whitespace differs).
    var rawBody = await req.text();
    var sig = req.headers.get('x-hub-signature-256');

    if (!verifyMetaSignature(rawBody, sig)) {
      console.warn('[whatsapp/webhook] signature check FAILED — rejecting');
      return new Response('Forbidden', { status: 403 });
    }

    var body;
    try { body = JSON.parse(rawBody); }
    catch (e) {
      console.warn('[whatsapp/webhook] non-JSON body');
      return NextResponse.json({ ok: true }); // 200 so Meta doesn't retry
    }

    // Meta's webhook envelope:
    //   { object: 'whatsapp_business_account',
    //     entry: [ { id, changes: [ { value, field: 'messages' } ] } ] }
    var entries = (body && body.entry) || [];
    for (var ei = 0; ei < entries.length; ei++) {
      var entry = entries[ei];
      var changes = entry.changes || [];
      for (var ci = 0; ci < changes.length; ci++) {
        var change = changes[ci];
        if (change.field !== 'messages') continue; // ignore other fields for now
        var value = change.value || {};
        // Inbound messages
        var messages = value.messages || [];
        var contacts = value.contacts || [];
        for (var mi = 0; mi < messages.length; mi++) {
          await handleInboundMessage(messages[mi], contacts, value.metadata || {});
        }
        // Status updates (sent / delivered / read / failed)
        var statuses = value.statuses || [];
        for (var si = 0; si < statuses.length; si++) {
          await handleStatusUpdate(statuses[si]);
        }
      }
    }

    // Return 200 even if we hit individual errors above — we don't want
    // Meta to redeliver the entire batch because one message failed.
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[whatsapp/webhook POST] error:', e.message);
    // Even on unexpected errors, return 200 so Meta doesn't retry forever.
    // Operators monitor logs separately.
    return NextResponse.json({ ok: true, error: e.message });
  }
}

// --------------------------------------------------------------
// Handle one inbound message
// --------------------------------------------------------------
async function handleInboundMessage(msg, contacts, metadata) {
  try {
    var waMsgId = msg.id; // wamid.XXX — unique
    if (!waMsgId) return;

    // Idempotency check — if we've already saved this message, skip.
    // Meta retries on any non-2xx, so the same message can arrive twice.
    var existing = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('wa_message_id', waMsgId)
      .maybeSingle();
    if (existing.data) return; // already processed

    // Customer's WhatsApp ID is digits-only in Meta's format. Normalize
    // to E.164 so it matches the format we store.
    var fromRaw = msg.from || '';
    var customerWaId = normalizePhone(fromRaw) || ('+' + String(fromRaw).replace(/\D/g, ''));

    // Display name from Meta's contacts array (may be missing if customer
    // has no WA profile name set)
    var displayName = null;
    var contact = contacts.find(function(c) { return c.wa_id === fromRaw; });
    if (contact && contact.profile && contact.profile.name) {
      displayName = contact.profile.name;
    }

    // Find or create the conversation row
    var conv = await findOrCreateConversation(customerWaId, displayName);
    if (!conv) {
      console.error('[whatsapp/webhook] could not get conversation for', customerWaId);
      return;
    }

    // Pull message-type-specific fields. Meta's payload shape varies by type.
    var messageType = msg.type || 'text';
    var bodyText = null;
    var mediaId = null;
    var mediaMime = null;
    var mediaFilename = null;

    if (messageType === 'text' && msg.text) {
      bodyText = msg.text.body || '';
    } else if (messageType === 'image' && msg.image) {
      mediaId = msg.image.id;
      mediaMime = msg.image.mime_type;
      bodyText = msg.image.caption || null;
    } else if (messageType === 'video' && msg.video) {
      mediaId = msg.video.id;
      mediaMime = msg.video.mime_type;
      bodyText = msg.video.caption || null;
    } else if (messageType === 'audio' && msg.audio) {
      mediaId = msg.audio.id;
      mediaMime = msg.audio.mime_type;
    } else if (messageType === 'document' && msg.document) {
      mediaId = msg.document.id;
      mediaMime = msg.document.mime_type;
      mediaFilename = msg.document.filename || null;
      bodyText = msg.document.caption || null;
    } else if (messageType === 'sticker' && msg.sticker) {
      mediaId = msg.sticker.id;
      mediaMime = msg.sticker.mime_type;
    } else if (messageType === 'location' && msg.location) {
      bodyText = '📍 Location: ' + (msg.location.latitude || '?') + ', ' + (msg.location.longitude || '?')
        + (msg.location.name ? ' (' + msg.location.name + ')' : '');
    } else if (messageType === 'contacts' && msg.contacts) {
      bodyText = '👤 Contact card shared';
    } else if (messageType === 'interactive' && msg.interactive) {
      // Reply to a button or list message we sent earlier
      var ir = msg.interactive;
      if (ir.button_reply) bodyText = '[Button reply] ' + (ir.button_reply.title || ir.button_reply.id || '');
      else if (ir.list_reply) bodyText = '[List reply] ' + (ir.list_reply.title || ir.list_reply.id || '');
      else bodyText = '[Interactive reply]';
    } else if (messageType === 'reaction' && msg.reaction) {
      // Customer reacted with an emoji to one of our messages — store as text
      bodyText = '[Reaction] ' + (msg.reaction.emoji || '?');
    } else {
      // Unknown type — log it but still save so nothing is lost
      bodyText = '[Unsupported message type: ' + messageType + ']';
    }

    var waTimestamp = msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString() : new Date().toISOString();

    var insertRes = await supabase.from('whatsapp_messages').insert({
      conversation_id: conv.id,
      wa_message_id: waMsgId,
      direction: 'inbound',
      message_type: messageType,
      body: bodyText,
      media_id: mediaId,
      media_mime_type: mediaMime,
      media_filename: mediaFilename,
      status: 'received',
      wa_timestamp: waTimestamp,
    });
    if (insertRes.error) {
      console.error('[whatsapp/webhook] insert message failed:', insertRes.error.message);
      return;
    }

    // Update conversation timestamps + unread count + last preview
    var preview = bodyText
      ? String(bodyText).slice(0, 100)
      : (mediaFilename ? '📎 ' + mediaFilename : (mediaId ? '📷 [' + messageType + ']' : '[' + messageType + ']'));
    await supabase
      .from('whatsapp_conversations')
      .update({
        last_inbound_at: waTimestamp,
        last_message_preview: preview,
        last_message_direction: 'inbound',
        unread_count: (conv.unread_count || 0) + 1,
        // Refresh display_name if Meta gave us a new one
        display_name: displayName || conv.display_name,
      })
      .eq('id', conv.id);
  } catch (e) {
    console.error('[whatsapp/webhook handleInbound] error:', e.message);
  }
}

// --------------------------------------------------------------
// Find or create a conversation row
// --------------------------------------------------------------
// Critical: the unique constraint on customer_wa_id makes this race-safe.
// If two inbound messages arrive simultaneously, only one INSERT wins;
// the other gets the existing row via the upsert returning clause.
async function findOrCreateConversation(customerWaId, displayName) {
  // Try to find first
  var found = await supabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('customer_wa_id', customerWaId)
    .maybeSingle();
  if (found.data) return found.data;

  // Try to match to a CRM customer by phone (last 10 digits, like phone calls)
  var customerId = null;
  try {
    var digits = String(customerWaId).replace(/\D/g, '');
    var last10 = digits.slice(-10);
    if (last10.length >= 7) {
      var custLookup = await supabase
        .from('customers')
        .select('id')
        .or('phone.ilike.%' + last10 + '%,whatsapp.ilike.%' + last10 + '%')
        .limit(1);
      if (custLookup.data && custLookup.data.length > 0) {
        customerId = custLookup.data[0].id;
      }
    }
  } catch (e) {}

  // Insert. If a race happens, we catch the duplicate-key error and re-fetch.
  var ins = await supabase
    .from('whatsapp_conversations')
    .insert({
      customer_wa_id: customerWaId,
      customer_id: customerId,
      display_name: displayName,
      unread_count: 0,
    })
    .select()
    .single();
  if (ins.error) {
    // Race: someone else inserted first. Re-fetch.
    var refetch = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('customer_wa_id', customerWaId)
      .maybeSingle();
    return refetch.data || null;
  }
  return ins.data;
}

// --------------------------------------------------------------
// Handle status update (sent → delivered → read → failed)
// --------------------------------------------------------------
async function handleStatusUpdate(status) {
  try {
    var waMsgId = status.id;
    if (!waMsgId) return;
    var newStatus = status.status; // 'sent' | 'delivered' | 'read' | 'failed'
    if (!newStatus) return;

    var updates = { status: newStatus };
    if (newStatus === 'failed' && status.errors && status.errors.length > 0) {
      var err = status.errors[0];
      updates.error_code = String(err.code || '');
      updates.error_message = err.title || err.message || '';
    }
    await supabase
      .from('whatsapp_messages')
      .update(updates)
      .eq('wa_message_id', waMsgId);
  } catch (e) {
    console.error('[whatsapp/webhook handleStatus] error:', e.message);
  }
}
