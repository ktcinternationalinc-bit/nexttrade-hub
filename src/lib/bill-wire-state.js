// v55.83-RZ — Max, Nov 10 00:17: "when it is ready to make payment by bank.. that in the status of each bill — that it goes
//  from OPEN to READY... and then when the wire is actually sent and you see a transaction for that amount in clickbooks...
//  you automatically match those underlying bills to that transaction and the status of the bills become PAID."
// Pure: given the open wire lines and their wires, what each bill's wire step is.
//   on a wire still being built / signed → OPEN · on WP-0007
//   both signatures in (approved)       → READY · WP-0007 → RTM Capital
//   marked sent                         → SENT · waiting for the bank line
// After the bank line is matched the wire line closes and the bill's own payments make it PAID (or PARTIAL).
import { packageFingerprint, packageStatus, packageLabel } from './wire-audit';

function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

export var WIRE_STATE_LABEL = { on_wire: 'OPEN', ready: 'READY', sent: 'SENT' }; // on_wire = on a PRE-WIRE (v55.83-SD)

// packages: wire_packages rows; lines: ALL lines of those packages (wire_package_lines rows); bills: { id → bill } (optional)
export function billWireStates(packages, lines, bills) {
  var out = {};
  var byPkg = {}; (lines || []).forEach(function (l) { (byPkg[l.package_id] = byPkg[l.package_id] || []).push(l); });
  (packages || []).forEach(function (p) {
    if (p.status !== 'draft' && p.status !== 'sent') { return; }
    var ls = (byPkg[p.id] || []).map(function (l) { return { line_id: l.id, bill_id: l.bill_id, amount: r2(l.amount), payment_id: l.payment_id, bill: (bills && bills[l.bill_id]) || {}, rtm: { confirmed_at: l.rtm_confirmed_at }, is_open: l.is_open }; });
    var st = packageStatus(p, packageFingerprint(p, ls), 0);
    var state = st === 'sent' ? 'sent' : (st === 'ready_to_send' ? 'ready' : 'on_wire');
    ls.forEach(function (l) {
      if (l.is_open === false) { return; }
      out[l.bill_id] = { state: state, label: WIRE_STATE_LABEL[state], wire: packageLabel(p), package_id: p.id, payee: p.payee_name, payee_kind: p.payee_kind,
        amount: l.amount, sent_date: p.sent_date || null, step: st };
    });
  });
  return out;
}

// the words on the bill's chip
export function wireStateWords(ws, billOpen) {
  if (!ws) { return null; }
  var part = billOpen != null && ws.amount < r2(billOpen) - 0.005 ? ' ($' + ws.amount.toFixed(2) + ' of $' + r2(billOpen).toFixed(2) + ')' : '';
  if (ws.state === 'ready') { return 'READY · ' + ws.wire + ' → ' + (ws.payee || '?') + part; }
  if (ws.state === 'sent') { return 'SENT · ' + ws.wire + (ws.sent_date ? ' on ' + ws.sent_date : '') + ' — waiting for the bank line' + part; }
  return 'OPEN · on ' + ws.wire + ' (pre-wire — can still change)' + part;
}
