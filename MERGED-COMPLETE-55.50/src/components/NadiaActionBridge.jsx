'use client';
// ============================================================
// src/components/NadiaActionBridge.jsx
//
// Global bridge between the Decision Engine's action chips and the rest
// of the app. Mounted once at root. Listens to `nadia-decision-action`
// CustomEvents and turns them into real things:
//
//   draft_email       → dispatch 'open-email-composer' with prefilled fields
//   draft_whatsapp    → dispatch 'open-whatsapp-composer' with prefilled fields
//   create_event      → dispatch 'open-event-form' with prefilled fields
//   create_reminder   → insert row into reminders table, toast confirm
//   flag_invoice      → set invoices.at_risk = true, toast confirm
//   ask_assistant     → dispatch 'nadia-push-question' so greeter asks it
//
// Why a dedicated bridge instead of inline listeners in page.jsx:
//   1. Keeps page.jsx from growing past 10k lines.
//   2. The bridge gets toast / supabase / userId once; handlers are tiny.
//   3. When we add new action types, we only touch one file.
//   4. Easy to unit test — each handler is a plain async function.
//
// Each handler MUST:
//   - return `{ ok, message }` so we can toast success/failure.
//   - never throw — wrap your own errors.
//   - be idempotent enough that a double-click doesn't do harm.
// ============================================================

import { useEffect } from 'react';
import { supabase, dbInsert, dbUpdate, logActivity } from '../lib/supabase';

// ----- Individual action handlers ---------------------------------------

async function handleDraftEmail(params /*, ctx */) {
  // params may contain: invoice_id | customer_id, tone, template
  // We don't send the email — we open the composer prefilled. The user must
  // review + hit send. This is by design: AI drafts, human approves.
  var payload = {
    invoice_id: params.invoice_id || null,
    customer_id: params.customer_id || null,
    tone: params.tone || 'firm_polite',
    template: params.template || 'reminder',
    // Let whatever opens the composer decide subject/body from the template
    // and the invoice/customer lookup.
  };
  try { window.dispatchEvent(new CustomEvent('open-email-composer', { detail: payload })); } catch (e) {}
  return { ok: true, message: 'Email draft ready — review in the composer' };
}

async function handleDraftWhatsApp(params) {
  var payload = {
    invoice_id: params.invoice_id || null,
    customer_id: params.customer_id || null,
    tone: params.tone || 'friendly',
  };
  try { window.dispatchEvent(new CustomEvent('open-whatsapp-composer', { detail: payload })); } catch (e) {}
  return { ok: true, message: 'WhatsApp draft ready' };
}

async function handleCreateEvent(params, ctx) {
  // params: { title, event_type, event_date? }
  // We prefer to OPEN the event form with prefilled fields rather than silently
  // create, because calendar events have time + location + attendees that the
  // decision engine doesn't know.
  var payload = {
    title: params.title || 'Follow-up',
    event_type: params.event_type || 'call',
    event_date: params.event_date || null,
    assigned_to: ctx.userId || null,
  };
  try { window.dispatchEvent(new CustomEvent('open-event-form', { detail: payload })); } catch (e) {}
  return { ok: true, message: 'Event form open — set time + save' };
}

async function handleCreateReminder(params, ctx) {
  // params: { note, due_days }
  if (!ctx.userId) return { ok: false, message: 'Not signed in' };
  var note = String(params.note || 'Follow-up').slice(0, 500);
  var dueDays = Math.max(0, Math.min(365, Number(params.due_days) || 1));
  var due = new Date(); due.setDate(due.getDate() + dueDays);
  try {
    await dbInsert('reminders', {
      user_id: ctx.userId,
      task: note,
      due_date: due.toISOString().substring(0, 10),
      completed: false,
      source: 'nadia_decision',
    }, ctx.userId);
    await logActivity(ctx.userId, 'Reminder created by Nadia: ' + note, 'reminder');
    return { ok: true, message: 'Reminder set for ' + due.toDateString() };
  } catch (e) {
    return { ok: false, message: 'Reminder failed: ' + (e.message || 'unknown') };
  }
}

async function handleFlagInvoice(params, ctx) {
  // params: { invoice_id, flag: 'at_risk' }
  if (!params.invoice_id) return { ok: false, message: 'Missing invoice_id' };
  if (!ctx.userId) return { ok: false, message: 'Not signed in' };
  try {
    var fields = {};
    if (!params.flag || params.flag === 'at_risk') fields.at_risk = true;
    if (params.flag === 'priority') fields.priority = 'high';
    fields.updated_at = new Date().toISOString();
    fields.updated_by = ctx.userId;
    await dbUpdate('invoices', params.invoice_id, fields, ctx.userId);
    await logActivity(ctx.userId, 'Flagged invoice ' + params.invoice_id + ' as ' + (params.flag || 'at_risk'), 'invoice');
    return { ok: true, message: 'Invoice flagged' };
  } catch (e) {
    return { ok: false, message: 'Flag failed: ' + (e.message || 'unknown') };
  }
}

async function handleAskAssistant(params) {
  // "Open decision panel" chip — re-asks the AI a related question.
  if (!params.question) return { ok: false, message: 'No question provided' };
  try { window.dispatchEvent(new CustomEvent('nadia-push-question', { detail: { question: params.question } })); } catch (e) {}
  return { ok: true, message: 'Asking Nadia...' };
}

// ----- Dispatch table ---------------------------------------------------

var HANDLERS = {
  draft_email:     handleDraftEmail,
  draft_whatsapp:  handleDraftWhatsApp,
  create_event:    handleCreateEvent,
  create_reminder: handleCreateReminder,
  flag_invoice:    handleFlagInvoice,
  ask_assistant:   handleAskAssistant,
};

// Exported so unit tests (Section 47) can import the table shape.
// The actual handlers close over `ctx` inside the component.
export var KNOWN_ACTIONS = Object.keys(HANDLERS);

// ----- The bridge component --------------------------------------------

export default function NadiaActionBridge({ userId, toast }) {
  useEffect(function() {
    var onAction = async function(ev) {
      var a = ev && ev.detail && ev.detail.action;
      if (!a || !a.action) return;
      var fn = HANDLERS[a.action];
      if (!fn) {
        if (toast) toast.warning('Nadia: action "' + a.action + '" not wired yet');
        return;
      }
      var res;
      try {
        res = await fn(a.params || {}, { userId: userId });
      } catch (e) {
        res = { ok: false, message: 'Action crashed: ' + (e.message || 'unknown') };
      }
      if (!res) return;
      if (toast) {
        if (res.ok) toast.success(res.message || 'Done');
        else toast.error(res.message || 'Failed');
      }
    };
    window.addEventListener('nadia-decision-action', onAction);
    return function() { window.removeEventListener('nadia-decision-action', onAction); };
  }, [userId, toast]);

  return null; // headless
}
