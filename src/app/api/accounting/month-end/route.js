// v55.83-SK — month-end: reconcile each bank account to its statement, then close (lock) the month.
// Max, Nov 13 12:50: "we should be able to reconcile things at month-end ... create something for the bank reconciliation".
// Bank balances are shown here, so the caller is verified from the SIGNED-IN SESSION (never a user id sent by the browser):
//   overview / save  — needs "see bank balances" (super admin, or an explicit grant)
//   close / reopen   — the verified super admin only
// Nothing is ever adjusted to make the statement and the books agree. Var + concat only.
import { createClient } from '@supabase/supabase-js';
import { authorizeBankVisibility, bankVisibilityJson, bankVisibilityErrorResponse, readBankJson } from '../../../../lib/bank-visibility.js';

export var dynamic = 'force-dynamic';
export var revalidate = 0;

function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
function words(e) {
  var m = String((e && e.message) || 'The ledger refused the request.');
  if (/clickbooks_us_(recon|close|reopen)|PGRST202|schema cache/i.test(m) && /not exist|not find|PGRST202|schema cache/i.test(m)) { return 'Run sql/v55-83-SK-reconcile-close.sql in Supabase first.'; }
  return m;
}

export async function POST(request) {
  try {
    var access = await authorizeBankVisibility(request, createClient, process.env);
    var body = await readBankJson(request);
    var db = access.db; var action = body.action;
    if (!access.canViewBankBalances && !access.isVerifiedSuperAdmin) { return bankVisibilityJson({ ok: false, error: 'Month-end shows bank balances — it needs the “see bank balances” permission (Settings → Financial data access).' }, 403); }

    if (action === 'overview') {
      if (!isDate(body.date)) { return bankVisibilityJson({ ok: false, error: 'Pick the statement date.' }, 400); }
      var o = await db.rpc('clickbooks_us_recon_overview', { p_date: body.date });
      if (o.error) { return bankVisibilityJson({ ok: false, error: words(o.error) }, 400); }
      return bankVisibilityJson(Object.assign({ ok: true, can_close: access.isVerifiedSuperAdmin === true }, o.data || {}));
    }

    if (action === 'save') {
      if (!isUuid(body.account_id)) { return bankVisibilityJson({ ok: false, error: 'Pick the bank account.' }, 400); }
      if (!isDate(body.date)) { return bankVisibilityJson({ ok: false, error: 'Pick the statement date.' }, 400); }
      var raw = String(body.statement == null ? '' : body.statement).replace(/[$,\s]/g, '');
      if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) { return bankVisibilityJson({ ok: false, error: 'Type the statement’s ending balance as a number, like 125743.45.' }, 400); }
      var s = await db.rpc('clickbooks_us_recon_save', { p_account: body.account_id, p_date: body.date, p_statement: Number(raw), p_note: String(body.note || '').substring(0, 500), p_actor: access.authUserId });
      if (s.error) { return bankVisibilityJson({ ok: false, error: words(s.error) }, 400); }
      return bankVisibilityJson(s.data || { ok: true });
    }

    if (action === 'close' || action === 'reopen') {
      if (access.isVerifiedSuperAdmin !== true) { return bankVisibilityJson({ ok: false, error: 'Only the super admin can close or reopen a month.' }, 403); }
      if (action === 'close') {
        if (!isDate(body.through)) { return bankVisibilityJson({ ok: false, error: 'Pick the month-end to close.' }, 400); }
        var c = await db.rpc('clickbooks_us_close_period', { p_through: body.through, p_actor: access.authUserId });
        if (c.error) { return bankVisibilityJson({ ok: false, error: words(c.error) }, 409); }
        return bankVisibilityJson(c.data || { ok: true });
      }
      var why = String(body.reason || '').trim();
      if (why.length < 10) { return bankVisibilityJson({ ok: false, error: 'Say why the closed period is being reopened (at least 10 characters).' }, 400); }
      var to = body.to == null || body.to === '' ? null : String(body.to);
      if (to !== null && !isDate(to)) { return bankVisibilityJson({ ok: false, error: 'Pick the last month-end that stays closed, or leave it empty.' }, 400); }
      var r = await db.rpc('clickbooks_us_reopen_period', { p_to: to, p_reason: why, p_actor: access.authUserId });
      if (r.error) { return bankVisibilityJson({ ok: false, error: words(r.error) }, 409); }
      return bankVisibilityJson(r.data || { ok: true });
    }
    return bankVisibilityJson({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e) { return bankVisibilityErrorResponse(e); }
}
