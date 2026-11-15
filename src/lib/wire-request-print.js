// v55.83-SQ — the two printable copies of a payment request (Max, Nov 15 2026):
//   the company's copy (RTM / NextTrade): each vendor, the number of bills and the total, with a reference per vendor;
//   KTC's copy: the same, plus the bill-by-bill breakdown underneath.
// Both carry the same reference numbers. Pure — builds an HTML page; no bank account numbers are printed.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function money(n) { var v = Math.round((Number(n) || 0) * 100) / 100; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function vKey(s) { return String(s || 'Unknown vendor').toUpperCase().replace(/\s+/g, ' ').trim(); }

// model: { label, payee, kind:'payee'|'ktc', total, bills_total, fee, fee_note, by_vendor:[{ref,vendor,bills,amount,partial}],
//          lines:[{vendor, bill_number, bill_total, amount, reference}], transfer:{date, amount}, sent_date, planned_date,
//          signoff1:{name,at}, signoff2:{name,at}, printed_at }
export function requestCopyModel(pkg, lines, audit, kind, printedAt) {
  var p = pkg || {};
  return {
    kind: kind === 'ktc' ? 'ktc' : 'payee', label: p.label || '', payee: p.payee_name || '', total: Number(p.total) || 0, bills_total: Number(p.bills_total) || 0,
    fee: Number(p.fee_amount) || 0, fee_note: p.fee_note || '', by_vendor: p.by_vendor || [],
    lines: (lines || []).map(function (l) { var b = l.bill || {}; return { vendor: b.vendor_name || 'Unknown vendor', bill_number: b.bill_number || '', bill_total: Number(b.total_amount) || 0, amount: Number(l.amount) || 0, reference: b.other_reference || '' }; }),
    transfer: p.funding && !p.funding.missing ? { date: p.funding.date, amount: Number(p.funding.amount) || 0 } : null,
    sent_date: (p.sent && p.sent.date) || null, planned_date: p.planned_send_date || null,
    signoff1: audit && audit.signoff1 && audit.signoff1.valid ? { name: audit.signoff1.name, at: audit.signoff1.at } : null,
    signoff2: audit && audit.signoff2 && audit.signoff2.valid ? { name: audit.signoff2.name, at: audit.signoff2.at } : null,
    printed_at: printedAt || '',
  };
}

export function requestCopyHtml(m) {
  var ktc = m.kind === 'ktc';
  var rows = '';
  (m.by_vendor || []).forEach(function (v) {
    rows += '<tr class="v"><td class="ref">' + esc(v.ref) + '</td><td>' + esc(v.vendor) + (v.partial ? ' <span class="note">(' + v.partial + ' bill paid in part)</span>' : '') + '</td><td class="n">' + esc(v.bills) + '</td><td class="n b">' + money(v.amount) + '</td></tr>';
    if (ktc) {
      (m.lines || []).filter(function (l) { return vKey(l.vendor) === vKey(v.vendor); }).forEach(function (l) {
        var part = Math.round(l.amount * 100) < Math.round(l.bill_total * 100);
        rows += '<tr class="d"><td></td><td>Bill ' + esc(l.bill_number || '—') + (l.reference ? ' · ref ' + esc(l.reference) : '') + (part ? ' · part payment of ' + money(l.bill_total) : '') + '</td><td></td><td class="n">' + money(l.amount) + '</td></tr>';
      });
    }
  });
  var sig = function (s, n) { return '<div class="sig"><div class="lbl">Signature ' + n + '</div><div class="who">' + (s ? esc(s.name) + '<br><span class="note">' + esc(String(s.at || '').substring(0, 16).replace('T', ' ')) + '</span>' : '<span class="note">not signed yet</span>') + '</div></div>'; };
  var status = m.sent_date ? 'Sent ' + esc(m.sent_date) : (m.signoff1 && m.signoff2 ? 'Approved — not sent yet' : 'DRAFT — not approved');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(m.label) + ' — payment request to ' + esc(m.payee) + '</title><style>'
    + '@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#ffffff;font-size:12px;margin:0;padding:18px}'
    + 'h1{font-size:20px;margin:0 0 2px}h2{font-size:12px;margin:0;color:#475569;font-weight:normal}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:12px}'
    + '.refbig{font-size:22px;font-weight:bold;text-align:right}.tag{display:inline-block;margin-top:4px;padding:2px 8px;border:1px solid #0f172a;font-size:10px;font-weight:bold;letter-spacing:.5px}'
    + 'table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-size:10px;letter-spacing:.5px;color:#475569;border-bottom:1px solid #0f172a;padding:6px 4px}'
    + 'td{padding:6px 4px;border-bottom:1px solid #e2e8f0;vertical-align:top}tr.d td{border-bottom:1px dotted #e2e8f0;color:#334155;font-size:11px;padding:3px 4px}'
    + '.n{text-align:right;white-space:nowrap}.b{font-weight:bold}.ref{font-weight:bold;white-space:nowrap}.note{color:#64748b;font-size:10px;font-weight:normal}'
    + 'tr.t td{border-bottom:none;border-top:1px solid #0f172a;font-weight:bold}tr.g td{border-top:2px solid #0f172a;border-bottom:none;font-size:14px;font-weight:bold}'
    + '.meta{display:flex;gap:28px;flex-wrap:wrap;margin-bottom:6px}.meta div span{display:block;font-size:10px;color:#475569;letter-spacing:.5px}'
    + '.sigs{display:flex;gap:24px;margin-top:26px}.sig{flex:1;border-top:1px solid #0f172a;padding-top:6px}.lbl{font-size:10px;color:#475569;letter-spacing:.5px}.who{font-weight:bold;margin-top:2px}'
    + '.foot{margin-top:22px;font-size:10px;color:#64748b}</style></head><body>'
    + '<div class="top"><div><h1>Payment request to ' + esc(m.payee) + '</h1><h2>KTC International Enterprises LLC</h2><div class="tag">' + (ktc ? 'KTC COPY — WITH BILL BREAKDOWN' : 'COPY FOR ' + esc(String(m.payee).toUpperCase())) + '</div></div>'
    + '<div><div class="refbig">' + esc(m.label) + '</div><div class="note" style="text-align:right">' + status + '</div></div></div>'
    + '<div class="meta">' + (m.transfer ? '<div><span>FROM OUR TRANSFER OF</span><b>' + esc(m.transfer.date) + ' · ' + money(m.transfer.amount) + '</b></div>' : '')
    + '<div><span>VENDORS</span><b>' + (m.by_vendor || []).length + '</b></div><div><span>BILLS</span><b>' + (m.lines || []).length + '</b></div><div><span>REQUEST TOTAL</span><b>' + money(m.total) + '</b></div>'
    + (!m.sent_date && m.planned_date ? '<div><span>PLANNED FOR</span><b>' + esc(m.planned_date) + '</b></div>' : '') + '</div>'
    + '<div>Please pay the vendors below from the funds already sent. Quote the reference on each wire and return a copy of each wire.</div>'
    + '<table><thead><tr><th>REFERENCE</th><th>VENDOR TO PAY</th><th class="n">BILLS</th><th class="n">AMOUNT</th></tr></thead><tbody>' + rows
    + '<tr class="t"><td colspan="3">Total to vendors</td><td class="n">' + money(m.bills_total) + '</td></tr>'
    + '<tr><td colspan="3">' + esc(m.payee) + ' service fee' + (m.fee_note ? ' (' + esc(m.fee_note) + ')' : '') + '</td><td class="n b">' + money(m.fee) + '</td></tr>'
    + '<tr class="g"><td colspan="3">Request total</td><td class="n">' + money(m.total) + '</td></tr></tbody></table>'
    + '<div class="sigs">' + sig(m.signoff1, 1) + sig(m.signoff2, 2) + '</div>'
    + '<div class="foot">' + esc(m.label) + ' · printed ' + esc(m.printed_at) + (ktc ? ' · internal copy — the bill breakdown is not sent to ' + esc(m.payee) : '') + '</div></body></html>';
}
