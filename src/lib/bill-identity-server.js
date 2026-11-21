// v55.83-WZ (Codex 21 Nov 10:22 P1) — for the wire checks: every ACTIVE bill that is the SAME bill as one on the wire by the WZ
// identity (same company + same vendor written any way + same number with dashes / spaces ignored), whatever its date or amount.
// The old lookup matched the exact number text only, so "14-481" or a copy with another date was never seen as a duplicate.
// Fails closed: a read error is thrown (a duplicate must never look like "nothing found"). Server only. var + concat.
import { billIdentity } from './bill-duplicates';

// lineBills: the bills on the wire (full rows). → { identity: [{ bill_id, vendor_name, bill_number, bill_date, total_amount, created_at }] }
export async function sameIdentityFor(db, lineBills) {
  var want = {}; var n = 0;
  (lineBills || []).forEach(function (b) { var k = billIdentity(b); if (k && !want[k]) { want[k] = true; n++; } });
  var out = {};
  if (!n) { return out; }
  for (var pg = 0; pg < 50; pg++) {
    var r = await db.from('vendor_bills').select('id, vendor_name, bill_number, bill_date, total_amount, record_status, wave_business_id, bill_type, created_at').eq('record_status', 'active').order('id', { ascending: true }).range(pg * 1000, pg * 1000 + 999);
    if (r.error) { throw new Error('Could not read vendor_bills: ' + r.error.message); }
    (r.data || []).forEach(function (b) {
      var k = billIdentity(b); if (!k || !want[k]) { return; }
      (out[k] = out[k] || []).push({ bill_id: b.id, vendor_name: b.vendor_name, bill_number: b.bill_number, bill_date: b.bill_date || null, total_amount: b.total_amount, created_at: b.created_at || null });
    });
    if (!r.data || r.data.length < 1000) { break; }
  }
  return out;
}
