// ============================================================
// src/lib/decision-engine.js
//
// The "billion-dollar" core — what separates us from a generic chat assistant.
// Instead of "answer a question", this produces a recommendation with:
//   - a confidence score
//   - explicit reasoning
//   - 1-3 one-click next actions
//
// Inputs are pulled live from the user's actual business data (invoices,
// customers, treasury, tickets, shipments, checks). No hallucinated facts.
//
// Used from two places:
//   1. /api/ask — when the model classifies a question as decision-oriented,
//      it calls runDecisionEngine() and returns the structured output
//      ALONGSIDE the chat answer, so the UI can render action buttons.
//   2. /api/nadia/watch — the proactive cron runs every N minutes and for
//      each "at risk" data pattern, calls runDecisionEngine() and writes
//      the result to ai_alerts for the user to wake up to.
//
// ============================================================

import { createClient } from '@supabase/supabase-js';

var _client = null;
function sb() {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  return _client;
}

// ------------------------------------------------------------
// Intent detection — what kind of decision is the user asking about?
// Returns one of: 'chase_invoice', 'chase_customer', 'delegate_ticket',
// 'escalate_shipment', 'follow_up_check', 'generic', 'unknown'
// ------------------------------------------------------------
export function detectIntent(question) {
  // Normalize unicode smart quotes → ASCII, so "haven't" and "haven\u2019t"
  // both match the same regex. Real users paste from email/iMessage/WhatsApp
  // which auto-substitute curly quotes.
  var q = String(question || '').toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');

  // Invoice / payment patterns
  if (/\b(chase|collect|pay(ment)?|overdue|outstanding|invoice #?\d+|order #?\d+)\b/.test(q)
      && /\b(should|what.*do|follow.?up|go after|recommend)\b/.test(q)) {
    return 'chase_invoice';
  }
  // Customer silence
  if (/\b(silent|haven'?t heard|no response|ghosting|quiet|lost contact)\b/.test(q)) {
    return 'chase_customer';
  }
  // Ticket delegation
  if (/\b(assign|delegate|give (this|it) to|hand (off|over))\b/.test(q)
      && /\bticket\b/.test(q)) {
    return 'delegate_ticket';
  }
  // Shipment risk
  if (/\b(shipment|delivery|cargo|container|air.?freight|sea.?freight)\b/.test(q)
      && /\b(delay|late|stuck|risk|cost|reroute)\b/.test(q)) {
    return 'escalate_shipment';
  }
  // Check follow-up
  if (/\bcheck (\#|number|\d)/.test(q) && /\b(clear|bounce|deposit|cash)/.test(q)) {
    return 'follow_up_check';
  }
  // Generic decision ("what should I do", "recommend")
  if (/\b(what should|should i|recommend|suggest|advise|next step)\b/.test(q)) {
    return 'generic';
  }
  return 'unknown';
}

// ------------------------------------------------------------
// Scoring primitives
// ------------------------------------------------------------
// Risk score 0..1 — how bad would ignoring this be?
function scoreRisk(signals) {
  var r = 0;
  if (signals.days_overdue)     r += Math.min(0.4, signals.days_overdue / 90 * 0.4);
  if (signals.amount_at_risk)   r += Math.min(0.3, Math.log10(Math.max(1, signals.amount_at_risk)) / 8 * 0.3);
  if (signals.silence_days)     r += Math.min(0.2, signals.silence_days / 30 * 0.2);
  if (signals.unusual_pattern)  r += 0.2;
  if (signals.critical_flag)    r += 0.3;
  return Math.min(1, r);
}

// Opportunity score 0..1 — upside from acting now vs. waiting
function scoreOpportunity(signals) {
  var o = 0;
  if (signals.customer_value)      o += Math.min(0.4, Math.log10(Math.max(1, signals.customer_value)) / 8 * 0.4);
  if (signals.recent_positive)     o += 0.2;
  if (signals.competitive_window)  o += 0.2;
  if (signals.expected_close)      o += 0.3;
  return Math.min(1, o);
}

function confidenceFrom(signals, evidenceCount) {
  // More evidence rows → higher confidence in the recommendation.
  var base = 0.5;
  base += Math.min(0.3, (evidenceCount || 0) * 0.05);
  if (signals.historical_pattern) base += 0.15;
  if (signals.critical_flag)      base += 0.05;
  return Math.min(0.98, Math.max(0.1, base));
}

// ------------------------------------------------------------
// Data pullers — each intent pulls its own slice, no overfetching
// ------------------------------------------------------------
async function pullInvoiceContext(question) {
  // Try to extract an order/invoice number from the question
  var num = (question.match(/(?:order|invoice)\s*#?\s*(\d{3,6})/i) || [])[1];
  if (!num) return null;

  var invRes = await sb().from('invoices').select('*').or('order_number.eq.' + num + ',invoice_number.eq.' + num).limit(5);
  if (invRes.error || !invRes.data || invRes.data.length === 0) return null;

  var inv = invRes.data[0];
  var now = Date.now();
  var dueMs  = inv.due_date ? new Date(inv.due_date).getTime() : null;
  var daysOverdue = dueMs ? Math.max(0, Math.floor((now - dueMs) / 86400000)) : 0;

  // Customer history — recent invoices for the same customer
  var history = null;
  if (inv.customer_id) {
    var histRes = await sb().from('invoices')
      .select('id, total_amount, total_collected, outstanding, invoice_date, due_date, total_collected')
      .eq('customer_id', inv.customer_id)
      .order('invoice_date', { ascending: false }).limit(20);
    if (!histRes.error) history = histRes.data || [];
  }

  // Recent treasury touches on this invoice
  var tx = null;
  var txRes = await sb().from('treasury').select('transaction_date, cash_in, bank_in, description')
    .eq('linked_invoice_id', inv.id).order('transaction_date', { ascending: false }).limit(10);
  if (!txRes.error) tx = txRes.data || [];

  return { invoice: inv, customer_history: history || [], recent_payments: tx || [], days_overdue: daysOverdue };
}

async function pullCustomerSilenceContext(question) {
  // "silent customer X" — extract a name hint
  var nameHint = (question.match(/(?:customer|client|from)\s+([A-Za-z][A-Za-z\s-]{2,})/i) || [])[1];
  var custRes = null;
  if (nameHint) {
    custRes = await sb().from('customers').select('*').ilike('name', '%' + nameHint.trim() + '%').limit(5);
  }
  if (!custRes || custRes.error || !custRes.data || custRes.data.length === 0) return null;
  var cust = custRes.data[0];

  // Most recent contact events: last invoice, last follow-up, last note
  var lastInv = await sb().from('invoices').select('invoice_date').eq('customer_id', cust.id)
    .order('invoice_date', { ascending: false }).limit(1);
  var lastNote = await sb().from('client_notes').select('created_at').eq('customer_id', cust.id)
    .order('created_at', { ascending: false }).limit(1);

  var lastContact = null;
  [lastInv.data && lastInv.data[0] && lastInv.data[0].invoice_date,
   lastNote.data && lastNote.data[0] && lastNote.data[0].created_at]
    .forEach(function(d) { if (d && (!lastContact || d > lastContact)) lastContact = d; });

  var silenceDays = lastContact ? Math.floor((Date.now() - new Date(lastContact).getTime()) / 86400000) : null;
  return { customer: cust, last_contact: lastContact, silence_days: silenceDays || 0 };
}

// ------------------------------------------------------------
// Recommenders — take context, produce recommendation text + action list
// ------------------------------------------------------------
function recommendForInvoice(ctx) {
  var inv = ctx.invoice;
  var hist = ctx.customer_history || [];
  var outstanding = Number(inv.outstanding || 0);
  var onTimeCount = hist.filter(function(h) {
    return h.due_date && h.total_collected >= h.total_amount
      && new Date(h.due_date).getTime() >= Date.now() - 365 * 86400000;
  }).length;

  var signals = {
    days_overdue: ctx.days_overdue,
    amount_at_risk: outstanding,
    unusual_pattern: (ctx.days_overdue > 15 && onTimeCount >= 3), // normally pays on time
    customer_value: hist.reduce(function(a, h) { return a + Number(h.total_amount || 0); }, 0),
    historical_pattern: hist.length >= 3,
    critical_flag: ctx.days_overdue > 60 && outstanding > 100000,
  };

  var risk = scoreRisk(signals);
  var opp  = scoreOpportunity(signals);
  var conf = confidenceFrom(signals, hist.length + ctx.recent_payments.length);

  var reasoning = [];
  if (ctx.days_overdue > 0) reasoning.push('Invoice is ' + ctx.days_overdue + ' days past due.');
  if (signals.unusual_pattern) reasoning.push('Unusual — this customer normally pays on time (' + onTimeCount + ' recent on-time invoices).');
  if (outstanding > 0) reasoning.push('Outstanding balance: ' + outstanding.toLocaleString() + ' EGP.');
  if (ctx.recent_payments.length === 0 && ctx.days_overdue > 7) reasoning.push('No payments logged on this invoice yet.');

  var recText, actions;
  if (risk > 0.7) {
    recText = 'Escalate now — call the owner directly today and send a formal demand letter.';
    actions = [
      { label: 'Draft escalation email', action: 'draft_email', params: { tone: 'firm', template: 'escalation', invoice_id: inv.id } },
      { label: 'Schedule escalation call today', action: 'create_event', params: { title: 'Escalation call: ' + (inv.customer_name || inv.order_number), event_type: 'call' } },
      { label: 'Flag invoice as at-risk', action: 'flag_invoice', params: { invoice_id: inv.id, flag: 'at_risk' } },
    ];
  } else if (risk > 0.4) {
    recText = 'Follow up firmly — send a reminder email today, schedule a call this week if no response.';
    actions = [
      { label: 'Draft reminder email', action: 'draft_email', params: { tone: 'firm_polite', template: 'reminder', invoice_id: inv.id } },
      { label: 'Draft WhatsApp to customer', action: 'draft_whatsapp', params: { invoice_id: inv.id } },
      { label: 'Schedule follow-up call', action: 'create_event', params: { title: 'Follow-up: ' + (inv.customer_name || inv.order_number), event_type: 'call' } },
    ];
  } else {
    recText = 'Low urgency — send a friendly nudge or wait 3-5 days before contacting.';
    actions = [
      { label: 'Draft friendly reminder', action: 'draft_email', params: { tone: 'friendly', template: 'nudge', invoice_id: inv.id } },
      { label: 'Mark for 5-day review', action: 'create_reminder', params: { due_days: 5, note: 'Check status of ' + inv.order_number } },
    ];
  }

  return {
    intent: 'chase_invoice',
    risk_score: risk,
    opportunity_score: opp,
    confidence: conf,
    recommendation: recText,
    reasoning: reasoning,
    suggested_actions: actions,
    evidence: { invoice_id: inv.id, order_number: inv.order_number, customer_id: inv.customer_id, history_count: hist.length },
  };
}

function recommendForSilentCustomer(ctx) {
  var signals = {
    silence_days: ctx.silence_days,
    customer_value: 0, // not computed in this slice
    historical_pattern: true,
  };
  var risk = scoreRisk(signals);
  var conf = confidenceFrom(signals, 3);

  var reasoning = [];
  if (ctx.silence_days > 0) reasoning.push(ctx.customer.name + ' last contacted ' + ctx.silence_days + ' days ago.');
  if (ctx.silence_days > 30) reasoning.push('30+ days silent — above typical range.');

  var recText = ctx.silence_days > 30
    ? 'Reach out today with a personalized message — silence this long is unusual and often signals dissatisfaction or competitor poaching.'
    : 'Send a warm check-in message when convenient.';

  return {
    intent: 'chase_customer',
    risk_score: risk,
    opportunity_score: scoreOpportunity(signals),
    confidence: conf,
    recommendation: recText,
    reasoning: reasoning,
    suggested_actions: [
      { label: 'Draft check-in email', action: 'draft_email', params: { customer_id: ctx.customer.id, tone: 'warm', template: 'check_in' } },
      { label: 'Draft WhatsApp message', action: 'draft_whatsapp', params: { customer_id: ctx.customer.id } },
      { label: 'Schedule 10-min call', action: 'create_event', params: { title: 'Check-in: ' + ctx.customer.name, event_type: 'call' } },
    ],
    evidence: { customer_id: ctx.customer.id, silence_days: ctx.silence_days, last_contact: ctx.last_contact },
  };
}

// ------------------------------------------------------------
// Main entry
// ------------------------------------------------------------
export async function runDecisionEngine(question) {
  var intent = detectIntent(question);
  if (intent === 'unknown') {
    return { intent: 'unknown', ok: false, reason: 'no_decision_intent_detected' };
  }

  try {
    if (intent === 'chase_invoice') {
      var ctx = await pullInvoiceContext(question);
      if (!ctx) return { intent: intent, ok: false, reason: 'invoice_not_found', hint: 'Include an invoice or order number.' };
      return Object.assign({ ok: true }, recommendForInvoice(ctx));
    }
    if (intent === 'chase_customer') {
      var cctx = await pullCustomerSilenceContext(question);
      if (!cctx) return { intent: intent, ok: false, reason: 'customer_not_found', hint: 'Include the customer name.' };
      return Object.assign({ ok: true }, recommendForSilentCustomer(cctx));
    }
    // generic / delegate_ticket / escalate_shipment / follow_up_check:
    // For V1, return a structured skeleton that the chat answer can still
    // anchor itself to, even without domain-specific data slice.
    return {
      intent: intent, ok: true,
      risk_score: 0.3, opportunity_score: 0.3, confidence: 0.35,
      recommendation: 'Not enough specific data to give a high-confidence recommendation. Share more detail (invoice #, customer name, ticket id) for a precise call.',
      reasoning: ['Intent detected: ' + intent, 'No domain-specific data slice pulled for this intent yet.'],
      suggested_actions: [],
      evidence: {},
    };
  } catch (e) {
    return { intent: intent, ok: false, reason: 'exception', error: e.message };
  }
}

// ------------------------------------------------------------
// Proactive scanner — run over ALL open data for a user and emit alerts.
// Called by /api/nadia/watch (cron).
// ------------------------------------------------------------
export async function scanForAlerts(userId) {
  var alerts = [];
  try {
    // 1. Overdue invoices > 30 days, outstanding > 0
    var now = Date.now();
    var invRes = await sb().from('invoices')
      .select('id, order_number, customer_name, customer_id, total_amount, outstanding, due_date, invoice_date')
      .gt('outstanding', 0)
      .limit(500);
    if (!invRes.error && invRes.data) {
      invRes.data.forEach(function(inv) {
        if (!inv.due_date) return;
        var daysOver = Math.floor((now - new Date(inv.due_date).getTime()) / 86400000);
        if (daysOver < 30) return;
        var sev = daysOver > 90 ? 'critical' : daysOver > 60 ? 'high' : 'medium';
        alerts.push({
          target_user_id: userId,
          alert_type: 'overdue_invoice',
          severity: sev,
          subject: 'Invoice #' + (inv.order_number || inv.id) + ' is ' + daysOver + ' days overdue',
          body: (inv.customer_name || 'Customer') + ' — ' + Number(inv.outstanding).toLocaleString() + ' EGP outstanding.',
          related_entity_type: 'invoice',
          related_entity_id: inv.id,
          confidence: 0.9,
          recommendation: daysOver > 60 ? 'Escalate via call + written demand.' : 'Send firm reminder + follow up within 48h.',
          suggested_actions: [
            { label: 'Open decision panel', action: 'ask_assistant', params: { question: 'what should I do about order #' + inv.order_number } },
          ],
        });
      });
    }

    // 2. Checks near clearing (due in 3 days or less, still pending)
    var checkRes = await sb().from('checks').select('id, check_number, amount, due_date, customer_name, status').eq('status', 'pending').limit(200);
    if (!checkRes.error && checkRes.data) {
      checkRes.data.forEach(function(c) {
        if (!c.due_date) return;
        var daysUntil = Math.floor((new Date(c.due_date).getTime() - now) / 86400000);
        if (daysUntil < 0 || daysUntil > 3) return;
        alerts.push({
          target_user_id: userId,
          alert_type: 'check_clearing_soon',
          severity: daysUntil === 0 ? 'high' : 'medium',
          subject: 'Check #' + c.check_number + ' clears in ' + daysUntil + ' day(s)',
          body: (c.customer_name || '') + ' — ' + Number(c.amount || 0).toLocaleString() + ' EGP',
          related_entity_type: 'check', related_entity_id: c.id, confidence: 0.95,
          recommendation: 'Confirm the invoice link is correct before clearing.',
          suggested_actions: [],
        });
      });
    }
  } catch (e) {
    // Don't throw — the cron should never crash
  }
  return alerts;
}
