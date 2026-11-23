// /api/accounting/customer-language — v55.83-XY (Max, 23 Nov 2026: "need in customer list in hub radio box to indicate the language to
// use with correspondce" · "default language is eglish").
//   POST { customer_id, language }   language = en | es | fr | ar
// Saves the language the Hub writes to this customer in (the arrival / final-payment reminders use it: pre-selected when a person
// sends by hand, used as it is by the automatic morning run). Nothing chosen = English.
// Who may change it: the people who may edit a customer today ("accounting.customers.edit"); the super admin always.
// The signed-in person is taken from their verified sign-in, never from the request; every change is written to hub_audit_log.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { audit } from '../../../../lib/audit-server';
import { LANGS, LANG_NAMES } from '../../../../lib/arrival-reminders';

var API_BUILD_MARKER = 'v55.83-XY-customer-language';
var SQL_HINT = 'Run sql/v55-83-XY-reminder-language-cc-attachments.sql in Supabase first (it adds the language to the customer).';
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }
function bad(msg, st) { return NextResponse.json({ ok: false, error: msg, api_build_marker: API_BUILD_MARKER }, { status: st || 400 }); }
function missingColumn(m) { return /correspondence_language/.test(String(m || '')) && /column|schema cache|does not exist/i.test(String(m || '')); }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json().catch(function () { return {}; });
    var who = await verifiedCaller(req, body, createClient);
    if (who.error) { return bad(who.error, who.status || 401); }
    var userId = who.userId; if (!userId) { return bad('Sign in again.', 401); }
    var gate = await assertPermission(db, userId, 'accounting.customers.edit', req);
    if (!gate || gate.ok !== true) { return bad('Changing a customer needs the "Accounting customers: edit" permission — Settings → Module Access.', gate && gate.status ? gate.status : 403); }
    var id = String(body.customer_id || '').trim(); var lang = String(body.language || '');
    if (!id) { return bad('Which customer?'); }
    if (LANGS.indexOf(lang) < 0) { return bad('The language must be English, Spanish, French or Arabic.'); }
    var cur = await db.from('accounting_customers').select('id, company_name, correspondence_language').eq('id', id).maybeSingle();
    if (cur.error) { return bad(missingColumn(cur.error.message) ? SQL_HINT : cur.error.message, missingColumn(cur.error.message) ? 503 : 500); }
    if (!cur.data) { return bad('That customer was not found.', 404); }
    var before = cur.data.correspondence_language || null;
    if (before === lang) { return NextResponse.json({ ok: true, customer_id: id, language: lang, unchanged: true, api_build_marker: API_BUILD_MARKER }); }
    var up = await db.from('accounting_customers').update({ correspondence_language: lang }).eq('id', id).select('id');
    if (up.error) { return bad(missingColumn(up.error.message) ? SQL_HINT : 'The language was not saved: ' + up.error.message, missingColumn(up.error.message) ? 503 : 500); }
    if (!up.data || !up.data.length) { return bad('The language was not saved (the customer was not found).', 404); }
    try { await audit(db, userId, 'customer_correspondence_language_set', 'accounting_customer', id, { customer: cur.data.company_name || null, from: before, to: lang, language: LANG_NAMES[lang] }); } catch (eA) { /* fail-soft by design */ }
    return NextResponse.json({ ok: true, customer_id: id, language: lang, from: before, api_build_marker: API_BUILD_MARKER });
  } catch (e) {
    return bad((e && e.message) || 'The language could not be saved.', 500);
  }
}
