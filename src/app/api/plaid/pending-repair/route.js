import { authorizePlaidOperation, plaidJson, plaidError } from '../_auth';
import { readBankJson } from '../../../../lib/bank-visibility';
import { storedPendingReplacements, pendingRepairRow } from '../../../../lib/pending-repair-server';

export var maxDuration = 60;
// Repair is deliberately super-admin-only. Cron and a generic admin role cannot invoke it.
export async function POST(req) {
  try {
    var access = await authorizePlaidOperation(req, 'bank.connections', false);
    if (access.isVerifiedSuperAdmin !== true) { return plaidJson({ error: 'Only the verified super admin can preview or repair pending bank records.' }, { status: 403 }); }
    var body = await readBankJson(req);
    if (!body || (body.action !== 'preview' && body.action !== 'repair')) { return plaidJson({ error: 'Choose preview or repair.' }, { status: 400 }); }
    var ids = [];
    if (body.action === 'repair') {
      if (body.confirm !== true || !Array.isArray(body.pending_ids) || !body.pending_ids.length || body.pending_ids.length > 25 ||
          body.pending_ids.some(function (id) { return typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id); })) {
        return plaidJson({ error: 'Confirm between 1 and 25 pending records from the preview.' }, { status: 400 });
      }
      ids = Array.from(new Set(body.pending_ids));
    }
    var query = access.db.from('bank_transactions').select('*').eq('pending', true).order('date', { ascending: true }).limit(501);
    if (ids.length) { query = query.in('id', ids); }
    var pending = await query;
    if (pending.error) { return plaidJson({ error: 'Could not read pending records. Nothing repaired.' }, { status: 503 }); }
    var rows = (pending.data || []).slice(0, 500);
    var replacements = await storedPendingReplacements(access.db, rows);
    var plan = rows.map(function (p) { return pendingRepairRow(p, replacements[p.plaid_transaction_id]); });
    if (body.action === 'preview') { return plaidJson({ ok: true, records: plan, truncated: (pending.data || []).length > 500 }); }
    var results = [];
    for (var i = 0; i < ids.length; i++) {
      var candidate = plan.find(function (p) { return p.pending_id === ids[i]; });
      if (!candidate) { results.push({ pending_id: ids[i], ok: false, reason: 'No longer pending. Refresh the preview; no changes made by this request.' }); continue; }
      if (candidate.status !== 'replacement_found') { results.push({ pending_id: ids[i], ok: false, reason: candidate.explanation }); continue; }
      var r = await access.db.rpc('hub_reconcile_pending', { p_pending: candidate.pending_id, p_posted: candidate.posted_id,
        p_reason: 'Super-admin confirmed repair of existing pending record; exact bank replacement reference. Actor: ' + access.profileId });
      if (r.error) {
        results.push({ pending_id: ids[i], ok: false, reason: /PGRST202|does not exist|schema cache/i.test(String(r.error.code || '') + ' ' + r.error.message) ?
          'The WC pending-identity database update is not installed. Nothing repaired for this record.' : 'Database repair failed; this record was not changed.' });
      } else {
        results.push({ pending_id: ids[i], ok: !!(r.data && r.data.ok), links_preserved: !!(r.data && r.data.links_preserved), reason: r.data && r.data.why || null });
      }
    }
    return plaidJson({ ok: results.every(function (r) { return r.ok; }), results: results, repaired: results.filter(function (r) { return r.ok; }).length });
  } catch (e) { return plaidError(e); }
}
