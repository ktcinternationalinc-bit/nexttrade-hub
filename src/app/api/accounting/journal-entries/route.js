// v55.83-SL — journal entries from a screen, with a second person's approval.
// Max, Nov 13 12:50: "we should be able to do a journal entry. I agree."
// The caller is verified from the SIGNED-IN SESSION (never a user id sent by the browser):
//   list / accounts — "Journals: write" or "Journals: approve" (owners / admins / super admin always)
//   create / cancel — "Journals: write"
//   approve / reject — "Journals: approve", and NEVER the person who wrote it (also a database rule)
// The ledger's own rules still apply on approval (balanced, month not closed, approved accounts). Var + concat only.
import { createClient } from '@supabase/supabase-js';
import { authorizeBankVisibility, bankVisibilityJson, bankVisibilityErrorResponse, readBankJson } from '../../../../lib/bank-visibility.js';
import { assertPermission } from '../../../../lib/server-permissions';

export var dynamic = 'force-dynamic';
export var revalidate = 0;

function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
function cents(v) { var raw = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (raw === '') { return 0; } if (!/^\d+(\.\d{1,2})?$/.test(raw)) { return null; } return Math.round(Number(raw) * 100); }
function words(e) {
  var m = String((e && e.message) || 'The ledger refused the request.');
  if (/clickbooks_us_mj_/i.test(m) && /not exist|not find|PGRST202|schema cache/i.test(m)) { return 'Run sql/v55-83-SL-journal-entries.sql in Supabase first.'; }
  if (/CB_PERIOD_LOCKED/.test(m)) { return 'That month is closed — date the entry after the closed period.'; }
  if (/CB_POSTING_DISABLED/.test(m)) { return 'Posting to the ledger is switched off right now.'; }
  return m;
}
async function can(db, access, key, request) {
  if (access.isVerifiedSuperAdmin === true) { return true; }
  var g = await assertPermission(db, access.profileId, key, request);
  return !!(g && g.ok);
}

export async function POST(request) {
  try {
    var access = await authorizeBankVisibility(request, createClient, process.env);
    var body = await readBankJson(request);
    var db = access.db; var action = body.action;
    var canWrite = await can(db, access, 'journals.prepare', request);
    var canApprove = await can(db, access, 'journals.approve', request);
    if (!canWrite && !canApprove) { return bankVisibilityJson({ ok: false, error: 'This needs “Journals: write” or “Journals: approve” — Settings → 🏦 Banking & Accounting Access.' }, 403); }
    var me = access.authUserId; var myName = null;
    try { var u = await db.from('users').select('name').eq('id', access.profileId).limit(1); myName = (u && u.data && u.data[0] && u.data[0].name) || null; } catch (eN) { myName = null; }

    if (action === 'list') {
      var l = await db.rpc('clickbooks_us_mj_list');
      if (l.error) { return bankVisibilityJson({ ok: false, error: words(l.error) }, 400); }
      var a = await db.rpc('clickbooks_us_mj_accounts');
      return bankVisibilityJson({ ok: true, me: me, can_write: canWrite, can_approve: canApprove, entries: l.data || [], accounts: (a && !a.error && a.data) || [] });
    }

    if (action === 'create') {
      if (!canWrite) { return bankVisibilityJson({ ok: false, error: 'Writing a journal entry needs “Journals: write”.' }, 403); }
      if (!isDate(body.date)) { return bankVisibilityJson({ ok: false, error: 'Pick the date of the entry.' }, 400); }
      var desc = String(body.description || '').trim();
      if (desc.length < 5) { return bankVisibilityJson({ ok: false, error: 'Say what the entry is for (at least 5 characters).' }, 400); }
      var inL = Array.isArray(body.lines) ? body.lines : []; var lines = [];
      for (var i = 0; i < inL.length; i++) {
        var d = cents(inL[i].debit); var c = cents(inL[i].credit);
        if (!inL[i].account_id && !d && !c) { continue; } // an empty row
        if (!isUuid(inL[i].account_id)) { return bankVisibilityJson({ ok: false, error: 'Line ' + (i + 1) + ': pick the account.' }, 400); }
        if (d === null || c === null) { return bankVisibilityJson({ ok: false, error: 'Line ' + (i + 1) + ': amounts are numbers like 1250.00.' }, 400); }
        lines.push({ account_id: inL[i].account_id, debit_cents: d, credit_cents: c, memo: String(inL[i].memo || '').substring(0, 200) });
      }
      var rev = body.reverses && isUuid(body.reverses) ? body.reverses : null;
      var r = await db.rpc('clickbooks_us_mj_create', { p_date: body.date, p_description: desc, p_lines: lines, p_actor: me, p_actor_name: myName, p_reverses: rev });
      if (r.error) { return bankVisibilityJson({ ok: false, error: words(r.error) }, 400); }
      return bankVisibilityJson(r.data || { ok: true });
    }

    if (action === 'approve' || action === 'reject') {
      if (!canApprove) { return bankVisibilityJson({ ok: false, error: 'Approving a journal entry needs “Journals: approve”.' }, 403); }
      if (!isUuid(body.id)) { return bankVisibilityJson({ ok: false, error: 'Which entry?' }, 400); }
      var note = String(body.note || '').trim();
      if (action === 'reject' && note.length < 5) { return bankVisibilityJson({ ok: false, error: 'Say why it is rejected (at least 5 characters).' }, 400); }
      var dcd = await db.rpc('clickbooks_us_mj_decide', { p_id: body.id, p_approve: action === 'approve', p_note: note, p_actor: me, p_actor_name: myName });
      if (dcd.error) { return bankVisibilityJson({ ok: false, error: words(dcd.error) }, 409); }
      return bankVisibilityJson(dcd.data || { ok: true });
    }

    if (action === 'cancel') {
      if (!isUuid(body.id)) { return bankVisibilityJson({ ok: false, error: 'Which entry?' }, 400); }
      var cn = await db.rpc('clickbooks_us_mj_cancel', { p_id: body.id, p_actor: me });
      if (cn.error) { return bankVisibilityJson({ ok: false, error: words(cn.error) }, 409); }
      return bankVisibilityJson(cn.data || { ok: true });
    }
    return bankVisibilityJson({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e) { return bankVisibilityErrorResponse(e); }
}
