// ============================================================
// src/lib/whatsapp.js — META CLOUD API HELPERS
// ============================================================
// Centralizes all interaction with Meta's WhatsApp Cloud API so the
// /api/whatsapp/* routes stay focused on their own logic.
//
// What lives here:
//   • verifyMetaSignature() — validates X-Hub-Signature-256 on
//     incoming webhooks (Meta uses HMAC-SHA256 with WHATSAPP_APP_SECRET)
//   • sendText() / sendMedia() / sendTemplate() — outbound API calls
//   • getMediaUrl() — exchange a media_id for a temporary download URL
//   • normalizePhone() — canonical E.164 conversion for matching to CRM
//
// Required env vars:
//   WHATSAPP_PHONE_NUMBER_ID — your Phone Number ID from Meta dashboard
//                              (NOT the actual phone number; it's an ID)
//   WHATSAPP_BUSINESS_ACCOUNT_ID — for templates list endpoint
//   WHATSAPP_ACCESS_TOKEN — long-lived system user token (or per-app token)
//   WHATSAPP_APP_SECRET — for signature verification on webhooks
//   WHATSAPP_VERIFY_TOKEN — string YOU pick; Meta uses it to confirm
//                            your webhook URL during initial setup
// ============================================================

import crypto from 'crypto';

var GRAPH_API_VERSION = 'v21.0'; // Meta's stable Graph API version as of 2026-04
var GRAPH_BASE = 'https://graph.facebook.com/' + GRAPH_API_VERSION;

// Read env vars at call time (not module load) so changes via Vercel
// redeploy take effect without code changes. Helps the diagnostic
// endpoint surface "not set" cleanly.
function getEnv() {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  };
}

// ----------------------------------------------------------------
// Webhook signature verification
// ----------------------------------------------------------------
// Meta signs every webhook POST with HMAC-SHA256 using your app secret.
// Header is X-Hub-Signature-256: sha256=HEX_DIGEST.
//
// We must verify EVERY inbound call before trusting the body, otherwise
// any internet-facing client could fake "customer messages" and pollute
// our DB or trigger expensive flows.
//
// rawBody must be the EXACT bytes Meta sent — JSON-parsing first and then
// re-stringifying breaks the signature because key order or whitespace
// can differ.
export function verifyMetaSignature(rawBody, signatureHeader) {
  var env = getEnv();
  if (!env.appSecret) {
    console.warn('[whatsapp-sig] WHATSAPP_APP_SECRET not set — cannot verify; failing closed');
    return false;
  }
  if (!signatureHeader) return false;
  // Header looks like "sha256=<hex>"
  var parts = String(signatureHeader).split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;
  var expectedHex = parts[1];
  var hmac = crypto.createHmac('sha256', env.appSecret);
  hmac.update(rawBody, 'utf8');
  var computedHex = hmac.digest('hex');
  // Constant-time compare — protects against timing-attack length probing
  try {
    var a = Buffer.from(expectedHex, 'hex');
    var b = Buffer.from(computedHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// ----------------------------------------------------------------
// Phone number normalization
// ----------------------------------------------------------------
// Meta sends customer phones in WhatsApp ID format which is digits-only
// (no +). Our CRM stores phones in mixed formats. This canonicalizes
// everything to E.164 ("+201234567890") so matches work.
export function normalizePhone(raw) {
  if (!raw) return null;
  var s = String(raw).trim();
  if (s.startsWith('+')) {
    var afterPlus = s.slice(1).replace(/\D/g, '');
    if (afterPlus.length < 7 || afterPlus.length > 15) return null;
    return '+' + afterPlus;
  }
  var digits = s.replace(/\D/g, '');
  // Common patterns we need to handle:
  //   "201234567890"    (Egypt with country code) → +201234567890
  //   "1234567890"      (US 10-digit) → +11234567890
  //   "11234567890"     (US 11-digit starting with 1) → +11234567890
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  if (digits.length >= 10 && digits.length <= 15) return '+' + digits;
  return null;
}

// Strip + for Meta's "to" field, which expects digits only
function stripPlus(e164) {
  if (!e164) return '';
  var s = String(e164).trim();
  if (s.startsWith('+')) s = s.slice(1);
  return s.replace(/\D/g, '');
}

// ----------------------------------------------------------------
// Outbound — text message
// ----------------------------------------------------------------
// Sends a plain text message to a customer. Only valid INSIDE the
// 24-hour window after their last inbound message — outside that
// window, Meta will reject with error 131047 "Re-engagement message"
// and you need a template instead. Caller should check the window
// before calling this.
export async function sendText(toE164, body) {
  var env = getEnv();
  if (!env.phoneNumberId || !env.accessToken) {
    throw new Error('WhatsApp not configured (missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN)');
  }
  if (!toE164 || !body) {
    throw new Error('sendText requires toE164 and body');
  }
  var url = GRAPH_BASE + '/' + env.phoneNumberId + '/messages';
  var payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: stripPlus(toE164),
    type: 'text',
    text: { preview_url: true, body: String(body) },
  };
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  var json = await res.json().catch(function() { return {}; });
  if (!res.ok) {
    var err = (json && json.error) || {};
    var e = new Error(err.message || ('Meta API error ' + res.status));
    e.code = err.code;
    e.subcode = err.error_subcode;
    e.details = err.error_data;
    throw e;
  }
  return {
    wa_message_id: json && json.messages && json.messages[0] && json.messages[0].id,
    raw: json,
  };
}

// ----------------------------------------------------------------
// Outbound — media message (image, document, audio, video)
// ----------------------------------------------------------------
// Two-step: first upload the media to Meta's CDN (returns a media_id),
// then reference that media_id when sending the message. We accept either
// a buffer (for files we have in memory) or a URL (for "Send this Twilio
// voicemail to the customer" scenarios).
//
// kind: 'image' | 'document' | 'audio' | 'video'
// caption: optional text shown alongside the media (image/video only)
// filename: required for documents (shown to recipient)
export async function uploadMedia(buffer, mimeType, filename) {
  var env = getEnv();
  if (!env.phoneNumberId || !env.accessToken) {
    throw new Error('WhatsApp not configured');
  }
  var url = GRAPH_BASE + '/' + env.phoneNumberId + '/media';
  // Build multipart form data manually because Node's fetch+FormData
  // boundary handling is fiddly. We need: messaging_product=whatsapp,
  // file=<bytes>, type=<mime>.
  var form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  // Convert Node Buffer to Blob for fetch()
  var blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, filename || 'upload');
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.accessToken },
    body: form,
  });
  var json = await res.json().catch(function() { return {}; });
  if (!res.ok || !json.id) {
    var err = (json && json.error) || {};
    var e = new Error(err.message || ('Media upload failed: ' + res.status));
    e.code = err.code;
    throw e;
  }
  return json.id; // the media_id you'll pass to sendMedia
}

export async function sendMedia(toE164, kind, mediaId, opts) {
  var env = getEnv();
  if (!env.phoneNumberId || !env.accessToken) {
    throw new Error('WhatsApp not configured');
  }
  opts = opts || {};
  var validKinds = ['image', 'document', 'audio', 'video'];
  if (validKinds.indexOf(kind) < 0) {
    throw new Error('sendMedia kind must be one of: ' + validKinds.join(', '));
  }
  var mediaObj = { id: mediaId };
  // image and video accept a caption; document accepts filename + optional caption
  if ((kind === 'image' || kind === 'video') && opts.caption) {
    mediaObj.caption = String(opts.caption);
  }
  if (kind === 'document') {
    if (opts.filename) mediaObj.filename = String(opts.filename);
    if (opts.caption) mediaObj.caption = String(opts.caption);
  }
  var payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: stripPlus(toE164),
    type: kind,
  };
  payload[kind] = mediaObj;
  var res = await fetch(GRAPH_BASE + '/' + env.phoneNumberId + '/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  var json = await res.json().catch(function() { return {}; });
  if (!res.ok) {
    var err = (json && json.error) || {};
    var e = new Error(err.message || ('Meta API error ' + res.status));
    e.code = err.code;
    throw e;
  }
  return {
    wa_message_id: json && json.messages && json.messages[0] && json.messages[0].id,
    raw: json,
  };
}

// ----------------------------------------------------------------
// Outbound — template message
// ----------------------------------------------------------------
// Templates are the ONLY way to message a customer outside the 24-hour
// window. They must be pre-approved by Meta. We pass the variables in
// order matching {{1}}, {{2}}, etc. in the template body.
//
// templateName: the template's name in Meta dashboard
// langCode: 'en', 'ar', etc.
// variables: array of strings, in order (will fill {{1}}, {{2}}, ...)
// headerImageMediaId: optional, only if the template has an image header
export async function sendTemplate(toE164, templateName, langCode, variables, headerImageMediaId) {
  var env = getEnv();
  if (!env.phoneNumberId || !env.accessToken) {
    throw new Error('WhatsApp not configured');
  }
  var components = [];
  // Header (image only — text headers go in the template, not the variables)
  if (headerImageMediaId) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { id: headerImageMediaId } }],
    });
  }
  // Body — pass each variable as a parameter
  if (Array.isArray(variables) && variables.length > 0) {
    components.push({
      type: 'body',
      parameters: variables.map(function(v) {
        return { type: 'text', text: String(v == null ? '' : v) };
      }),
    });
  }
  var payload = {
    messaging_product: 'whatsapp',
    to: stripPlus(toE164),
    type: 'template',
    template: {
      name: templateName,
      language: { code: langCode || 'en' },
      components: components,
    },
  };
  var res = await fetch(GRAPH_BASE + '/' + env.phoneNumberId + '/messages', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  var json = await res.json().catch(function() { return {}; });
  if (!res.ok) {
    var err = (json && json.error) || {};
    var e = new Error(err.message || ('Meta API error ' + res.status));
    e.code = err.code;
    throw e;
  }
  return {
    wa_message_id: json && json.messages && json.messages[0] && json.messages[0].id,
    raw: json,
  };
}

// ----------------------------------------------------------------
// Get media URL (download proxy)
// ----------------------------------------------------------------
// When the customer sends us a photo, the webhook gives us a media_id
// but NOT the actual file. We have to make a separate Graph API call
// to get a temporary download URL (lasts ~5 min), then fetch the
// actual bytes with our access token.
//
// This is a 2-step process:
//   1. GET /{media_id} → returns { url, mime_type, file_size, ... }
//   2. GET that url with Bearer auth → returns the bytes
//
// We expose step 1 here; step 2 happens in /api/whatsapp/media.
export async function getMediaInfo(mediaId) {
  var env = getEnv();
  if (!env.accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN not set');
  var res = await fetch(GRAPH_BASE + '/' + mediaId, {
    headers: { 'Authorization': 'Bearer ' + env.accessToken },
  });
  var json = await res.json().catch(function() { return {}; });
  if (!res.ok) {
    var err = (json && json.error) || {};
    throw new Error(err.message || ('getMediaInfo failed: ' + res.status));
  }
  return json; // { url, mime_type, sha256, file_size, id, messaging_product }
}

// ----------------------------------------------------------------
// List templates (for refresh-from-Meta)
// ----------------------------------------------------------------
// Pulls every template from Meta and returns them in a normalized shape.
// Caller upserts into the whatsapp_templates table.
export async function listTemplates() {
  var env = getEnv();
  if (!env.businessAccountId || !env.accessToken) {
    throw new Error('WhatsApp not configured (missing WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_ACCESS_TOKEN)');
  }
  var url = GRAPH_BASE + '/' + env.businessAccountId + '/message_templates?limit=200';
  var res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + env.accessToken },
  });
  var json = await res.json().catch(function() { return {}; });
  if (!res.ok) {
    var err = (json && json.error) || {};
    throw new Error(err.message || ('listTemplates failed: ' + res.status));
  }
  // Each template has: id, name, language, status, category, components[]
  // Components is an array of { type: 'HEADER'|'BODY'|'FOOTER', text, format }
  var rows = (json.data || []).map(function(t) {
    var headerComp = (t.components || []).find(function(c) { return c.type === 'HEADER'; });
    var bodyComp   = (t.components || []).find(function(c) { return c.type === 'BODY';   });
    var footerComp = (t.components || []).find(function(c) { return c.type === 'FOOTER'; });
    return {
      meta_template_id: t.id,
      template_name: t.name,
      language_code: t.language,
      category: t.category,
      status: t.status,
      body_text: bodyComp ? bodyComp.text : '',
      header_type: headerComp ? headerComp.format : null,
      header_text: headerComp && headerComp.format === 'TEXT' ? headerComp.text : null,
      footer_text: footerComp ? footerComp.text : null,
    };
  });
  return rows;
}

// ----------------------------------------------------------------
// 24-hour window check
// ----------------------------------------------------------------
// Returns TRUE if we can send free-text right now (customer messaged us
// within the last 24 hours). Returns FALSE if we'd need a template.
//
// Per Meta's policy, the window is 24 hours from the LAST inbound message,
// not from the conversation's first message. Each new inbound resets it.
export function isInWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  var t = new Date(lastInboundAt).getTime();
  if (isNaN(t)) return false;
  var hoursAgo = (Date.now() - t) / 3600000;
  return hoursAgo < 24;
}
