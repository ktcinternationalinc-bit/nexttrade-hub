// v55.83-RJ — CRM "added" and "updated" by period (Max, Nov 9 11:16):
// "in the crm i need to see date created of the client in the system. and also
// a way for me to see in periods who was added during the last 7 days 30 days.
// 3 months. 6 months. 1 year. and who created it in the crm. Also any
// updates... same time periods with dates of each updates should be in the crm
// by default"
// Pure functions (the launch test runs them).

export var CRM_PERIODS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '3m', label: 'Last 3 months', months: 3 },
  { key: '6m', label: 'Last 6 months', months: 6 },
  { key: '1y', label: 'Last 12 months', months: 12 },
];
export var CRM_DEFAULT_PERIOD = '30d';

// start of the window (inclusive), as an ISO timestamp
export function periodStart(key, nowMs) {
  var now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
  var p = null; CRM_PERIODS.forEach(function (x) { if (x.key === key) { p = x; } });
  if (!p) { p = CRM_PERIODS[1]; }
  var d = new Date(now.getTime());
  if (p.days) { d = new Date(now.getTime() - p.days * 86400000); }
  else { d.setMonth(d.getMonth() - p.months); }
  return d.toISOString();
}
export function inPeriod(iso, startIso) { return !!iso && String(iso) >= String(startIso); }

// clients added in the window, newest first; unknown dates never count
export function addedIn(customers, startIso) {
  return (customers || []).filter(function (c) { return inPeriod(c.created_at, startIso); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
}

var LABELS = {
  name: 'Name (Arabic)', name_ar: 'Name (Arabic)', name_en: 'Name (English)', phone: 'Phone', email: 'Email', address: 'Address', city: 'City',
  group_name: 'Group', client_type: 'Client type', industry: 'Category', lead_source: 'Lead source', credit_limit: 'Credit limit',
  status: 'Status', assigned_rep: 'Assigned rep', pipeline_stage: 'Pipeline stage', important: 'Important', restricted: 'Restricted',
  whatsapp_number: 'WhatsApp', contact_person: 'Contact person', notes: 'Notes',
};
var CONTACT = { phone: 1, email: 1, address: 1, city: 1, whatsapp_number: 1, contact_person: 1 };
export function fieldLabel(k) { return LABELS[k] || String(k || '').replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }

// one change in plain words. ctx = { userName(id) → name, canSeeContact: bool }
export function describeChange(field, from, to, ctx) {
  var c = ctx || {};
  function show(v) {
    if (v === null || v === undefined || v === '') { return '(empty)'; }
    if (field === 'assigned_rep') { return (c.userName && c.userName(v)) || 'someone'; }
    if (typeof v === 'boolean') { return v ? 'yes' : 'no'; }
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 80 ? s.substring(0, 80) + '…' : s;
  }
  if (CONTACT[field] && c.canSeeContact === false) { return fieldLabel(field) + ' changed (🔒 hidden)'; }
  return fieldLabel(field) + ': ' + show(from) + ' → ' + show(to);
}

// history rows → only the visible clients, newest first
// (deleted clients are no longer in the list — only an admin sees their deletion line)
export function visibleUpdates(rows, visibleIds, includeDeleted) {
  var ok = {}; (visibleIds || []).forEach(function (id) { ok[String(id)] = true; });
  return (rows || []).filter(function (r) { return r.action === 'deleted' ? includeDeleted === true : (r.action !== 'created' && ok[String(r.customer_id)]); })
    .sort(function (a, b) { return String(b.changed_at).localeCompare(String(a.changed_at)); });
}
