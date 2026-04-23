// ============================================================
// src/lib/nadia-tools.js
//
// Tool definitions for Nadia (the AI Secretary) — Anthropic "tool use" API
// schema format. Each tool is:
//   - queried by name via the model
//   - executed by a handler in /api/ask-v2/route.js
//   - results fed back to the model so it can multi-step reason
//
// TIER 1 focus: read-only data tools + safe "draft" tools. No tool here can
// silently send an email, post to a customer, or mutate money data without
// the user confirming in the UI.
//
// Write tools that DO mutate (create_ticket, set_reminder, flag_invoice) are
// marked {danger: true} so the server-side handler can enforce extra checks.
// ============================================================

export var NADIA_TOOLS = [

  // ---------- READ TOOLS (safe, free to call) ----------

  {
    name: 'search_customers',
    description: "Look up customers by name. Returns up to 10 matches with their id, name (Arabic + English), phone, email, assigned rep, and last contact date. Use this FIRST whenever the user mentions a customer by name — you need the customer_id for other tools.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Customer name or partial name (Arabic or English)' },
        limit: { type: 'integer', description: 'Max results, default 10', default: 10 },
      },
      required: ['query'],
    },
  },

  {
    name: 'query_invoices',
    description: "Fetch invoices by customer, status, date range, or overdue state. Returns order_number, date, customer, total, outstanding, due_date, days_overdue. Use when the user asks about an order, outstanding balance, or to make decisions about chasing payment.",
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'Customer UUID (from search_customers)' },
        order_number: { type: 'string', description: 'Specific order number if known' },
        status: { type: 'string', enum: ['open', 'paid', 'overdue', 'all'], description: 'Filter state', default: 'all' },
        date_from: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        date_to: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        limit: { type: 'integer', default: 25 },
      },
    },
  },

  {
    name: 'query_checks',
    description: "Fetch checks by customer or status. Returns check_number, amount, due_date, status (pending/cleared/bounced), customer. Use to answer questions about checks clearing soon or bounced.",
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'cleared', 'bounced', 'all'], default: 'all' },
        clearing_within_days: { type: 'integer', description: 'Return only checks clearing within N days from today' },
        limit: { type: 'integer', default: 25 },
      },
    },
  },

  {
    name: 'query_treasury',
    description: "Fetch treasury transactions in a date range, optionally by category or customer. Returns transaction_date, cash_in, cash_out, description, category, linked_invoice. Use to answer cash flow questions.",
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        category: { type: 'string' },
        customer_id: { type: 'string' },
        limit: { type: 'integer', default: 50 },
      },
      required: ['date_from', 'date_to'],
    },
  },

  {
    name: 'search_tickets',
    description: "Search open/closed tickets by status, assignee, or text. Returns ticket_number, title, priority, status, assigned_to, due_date. Use when user asks about tickets.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        assigned_to: { type: 'string', description: 'User UUID' },
        query: { type: 'string', description: 'Title/description search' },
        limit: { type: 'integer', default: 20 },
      },
    },
  },

  {
    name: 'get_calendar',
    description: "Fetch calendar events in a date range. Returns title, event_date, event_type, assigned_to, location. Use for 'what's on my calendar' questions.",
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        user_id: { type: 'string', description: 'Filter to events for a specific user' },
        limit: { type: 'integer', default: 30 },
      },
      required: ['date_from', 'date_to'],
    },
  },

  {
    name: 'get_ai_alerts',
    description: "Fetch the proactive alerts (ai_alerts table) the background scanner has written. Returns severity, subject, body, recommendation, related entity. Use to proactively brief the user on overdue invoices, checks clearing soon, and other flagged items.",
    input_schema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'all'], default: 'all' },
        limit: { type: 'integer', default: 20 },
      },
    },
  },

  {
    name: 'predict_category',
    description: "Given an invoice (by id OR by description+customer), predict the most likely category and subcategory based on learned patterns. Returns category, subcategory, confidence. Use when the user asks how to categorize an expense.",
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string' },
        description: { type: 'string' },
        customer_id: { type: 'string' },
      },
    },
  },

  // ---------- DRAFT TOOLS (safe — UI catches the event, human approves) ----------

  {
    name: 'draft_email',
    description: "Open the email composer prefilled with a draft for the user to review. Does NOT send. Use when user asks to email a customer/vendor.",
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        invoice_id: { type: 'string' },
        tone: { type: 'string', enum: ['friendly', 'firm_polite', 'firm', 'escalation'], default: 'firm_polite' },
        template: { type: 'string', enum: ['reminder', 'nudge', 'escalation', 'check_in', 'confirmation'], default: 'reminder' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
    },
  },

  {
    name: 'draft_whatsapp',
    description: "Open the WhatsApp composer prefilled. Does NOT send.",
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        invoice_id: { type: 'string' },
        body: { type: 'string' },
      },
    },
  },

  // ---------- WRITE TOOLS (dangerous — require confirmation at handler level) ----------

  {
    name: 'create_ticket',
    description: "Create a new system ticket. Use when user says 'create a ticket for X' or 'Nadia, track this issue'.",
    danger: true,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
        due_date: { type: 'string', description: 'ISO YYYY-MM-DD' },
        assigned_to: { type: 'string', description: 'User UUID' },
      },
      required: ['title'],
    },
  },

  {
    name: 'create_reminder',
    description: "Create a personal reminder for the current user.",
    danger: true,
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        due_date: { type: 'string', description: 'ISO YYYY-MM-DD' },
      },
      required: ['task', 'due_date'],
    },
  },

  {
    name: 'create_event',
    description: "Open the calendar form prefilled to create an event. Does NOT save until user confirms in the UI.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        event_type: { type: 'string', enum: ['call', 'meeting', 'deadline', 'followup'], default: 'call' },
        event_date: { type: 'string', description: 'ISO YYYY-MM-DD' },
      },
      required: ['title'],
    },
  },

  {
    name: 'flag_invoice',
    description: "Mark an invoice as at-risk or priority. Updates the DB and activity log.",
    danger: true,
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string' },
        flag: { type: 'string', enum: ['at_risk', 'priority'], default: 'at_risk' },
      },
      required: ['invoice_id'],
    },
  },

];

// Helper — validate a tool call against the schema (name exists, required
// fields present). Returns { ok, error? }.
export function validateToolCall(name, input) {
  var tool = NADIA_TOOLS.find(function(t) { return t.name === name; });
  if (!tool) return { ok: false, error: 'Unknown tool: ' + name };
  var required = (tool.input_schema && tool.input_schema.required) || [];
  for (var i = 0; i < required.length; i++) {
    if (input == null || input[required[i]] == null || input[required[i]] === '') {
      return { ok: false, error: 'Missing required field: ' + required[i] };
    }
  }
  return { ok: true, tool: tool };
}

// Helper — expose just the {name, description, input_schema} fields to the API
export function getToolsForAPI() {
  return NADIA_TOOLS.map(function(t) {
    return { name: t.name, description: t.description, input_schema: t.input_schema };
  });
}
