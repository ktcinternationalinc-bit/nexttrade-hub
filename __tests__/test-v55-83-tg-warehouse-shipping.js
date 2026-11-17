// ═══════════════════════════════════════════════════════════════════════════
// v55.83-TG — shipping costs from the Nextrade warehouse (Max, Nov 16 2026). Everything here is RUN (pure functions).
// Uses the two orders from Max's screenshots exactly as they are stored on warehouse staging (orders 1519 and 1695).
// Optional: node __tests__/test-v55-83-tg-warehouse-shipping.js <feed.json>  also checks a real feed (dry run, no writes).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var W = require(path.join(root, 'src/lib/warehouse-shipping.js'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }

console.log('amounts');
check('"3475" → 3475', W.parseAmount('3475').value === 3475);
check('"$3,475.00" → 3475', W.parseAmount('$3,475.00').value === 3475);
check('"0" = not recorded, never zero', W.parseAmount('0').value === null && W.parseAmount('0').problem === 'not_recorded');
check('"NA" = missing', W.parseAmount('NA').problem === 'missing');
check('"1400+150" is never summed', W.parseAmount('1400+150').value === null && W.parseAmount('1400+150').problem === 'not_a_plain_number');
check('"1" is a placeholder', W.parseAmount('1').problem === 'placeholder');
check('"-1" is refused', W.parseAmount('-1').problem === 'negative');

// ── the two orders from the screenshots, as stored on staging ──
var FEED = {
  ok: true, site: 'fix.nextrade-staging.com',
  orders: [
    { id: 1519, release_number: '1002-1156', customer_name: 'Kenya buyer', warehouse_name: 'Houston', status: 'closed', is_bonded_order: 1, country: 'Kenya', shipped_date: '2026-06-30 12:43:09', created_at: '2026-05-28 19:40:33' },
    { id: 1695, release_number: '1001-1669', customer_name: 'India buyer', warehouse_name: 'Canada', status: 'shipped', is_bonded_order: 0, country: 'India', shipped_date: '2026-11-12 05:30:00', created_at: '2026-11-03 00:00:00' },
    { id: 1700, release_number: '1001-0077', customer_name: 'Zero lead', warehouse_name: 'Canada', status: 'closed', shipped_date: '2026-07-02 10:00:00', created_at: '2026-06-20 00:00:00' },
    { id: 1701, release_number: '1002-2000', customer_name: 'Half', status: 'closed', shipped_date: '2026-08-01 10:00:00', created_at: '2026-07-20 00:00:00' },
    { id: 1702, release_number: '1002-3000', customer_name: 'Dup A', status: 'shipped', shipped_date: '2026-08-03 10:00:00', created_at: '2026-07-21 00:00:00' },
    { id: 1703, release_number: '1002 3000', customer_name: 'Dup B', status: 'shipped', shipped_date: '2026-08-04 10:00:00', created_at: '2026-07-22 00:00:00' },
    { id: 1704, release_number: '1002-4000', customer_name: 'Pending', status: 'pending', shipped_date: null, created_at: '2025-01-05 00:00:00' }
  ],
  stages: [
    { id: 4564, order_id: 1519, order_status: 'shipping_in_process', freight_forwarder: 'Seamates', best_rate_received: '3475', shipping_line: 'CMA CGM', truker_name: 'AMB', trucker_quote: '1850', load_date: '2026-06-29 09:00:00', sailing_date: '2026-07-08', ff_wire_amount: '0', trucker_wire_amount: '0', updated_at: '2026-06-29 15:15:30' },
    { id: 4911, order_id: 1519, order_status: 'closed', ff_invoivce: 'INTE282231A', ff_paid: 'yes', ff_date_paid: '2026-09-04', ff_invoice: '34224', trucker_paid: 'yes', trucker_date: '2026-06-26', ff_wire_bank: 'Chase', ff_wire_amount: '3475', trucker_wire_bank: 'Chase', trucker_wire_amount: '20121', final_payment_closed: 'paid', updated_at: '2026-09-04 16:29:19' },
    { id: 5223, order_id: 1695, order_status: 'shipping_in_process', freight_forwarder: 'ONTREK', best_rate_received: '1950', shipping_line: 'Maersk', truker_name: 'AMB', trucker_quote: '741', load_date: '2026-11-10 09:00:00', sailing_date: '2026-11-19', ff_wire_amount: '0', trucker_wire_amount: '0', updated_at: '2026-11-12 17:32:48' },
    { id: 9001, order_id: 1700, order_status: 'shipping_in_process', best_rate_received: '2000', trucker_quote: '800', load_date: '2026-07-01 09:00:00', updated_at: '2026-07-01' },
    { id: 9002, order_id: 1700, order_status: 'closed', ff_wire_amount: '2100', ff_paid: 'yes', ff_date_paid: '2026-07-20', trucker_wire_amount: '850', trucker_paid: 'yes', trucker_date: '2026-07-10', updated_at: '2026-07-21' },
    { id: 9003, order_id: 1701, order_status: 'shipping_in_process', best_rate_received: '2000', trucker_quote: 'NA', load_date: '2026-08-01 09:00:00', updated_at: '2026-08-01' },
    { id: 9004, order_id: 1701, order_status: 'closed', ff_wire_amount: '2050', ff_paid: 'yes', ff_date_paid: '2026-08-20', trucker_wire_amount: '0', updated_at: '2026-08-21' }
  ],
  obsolete_orders: [{ id: 50, release_number: '1002-1156', customer_name: 'Kenya buyer', status: 'Shipped', shiped_date: '2026-06-30', created_at: '2026-05-28' }]
};
var recs = W.buildRecords(FEED, { source: 'nextrade-staging', today: '2026-11-16' });
function rec(rel) { return recs.filter(function (r) { return r.release_number === rel && r.section === 'main'; })[0]; }

console.log('screenshot order 1519 = release 1002-1156 (closed)');
var a = rec('1002-1156');
check('Max workflow: paid freight wire 3475 but NO bill → estimate 3475 used, not final, "waiting for bill"', a.freight.used === 3475 && a.freight.kind === 'estimate' && a.freight.warehouse_kind === 'final' && a.flags.indexOf('freight_paid_waiting_for_bill') >= 0, a.freight);
check('trucking wire 20121 is NOT accepted (more than 3× the 1850 quote, paid before loading) — quote kept', a.trucking.used === 1850 && a.trucking.kind === 'estimate' && a.trucking.final === 20121 && a.trucking.suspicious.length === 2, a.trucking);
check('combined = 3475 + 1850 = 5325, provisional (no bills yet)', a.combined_used === 5325 && a.cost_status === 'provisional');
check('trucking flagged for review', a.flags.indexOf('trucking_final_suspicious') >= 0);
check('ship date = shipped date 2026-06-30, not the sailing date', a.ship_date === '2026-06-30' && a.sailing_date === '2026-07-08' && a.ship_date_basis === 'shipped date');
check('FF invoice from ff_invoivce, trucker invoice from ff_invoice', a.freight.invoice === 'INTE282231A' && a.trucking.invoice === '34224');
check('source link points at staging order 1519', a.source_link === 'https://fix.nextrade-staging.com/admin/orders/edit-order/1519');
check('Max 16 Nov: all amounts USD, confirmed (no currency flag)', a.currency === 'USD' && a.currency_confirmed === true && a.flags.indexOf('currency_not_recorded_assumed_usd') < 0);
check('obsolete-section twin is not a conflict and carries no cost', !a.conflict && recs.filter(function (r) { return r.section === 'obsolete'; })[0].combined_used === null);

console.log('screenshot order 1695 = release 1001-1669 (shipped, not closed)');
var b = rec('1001-1669');
check('1950 + 741 = 2691 provisional', b.combined_used === 2691 && b.cost_status === 'provisional' && b.freight.kind === 'estimate' && b.trucking.kind === 'estimate');
check('open, shipped, in the backfill', b.is_open && b.is_shipped && b.in_backfill);

console.log('other rules');
var c = rec('1001-0077');
check('paid wires without bills → the quotes 2000 + 800 are used (estimate), variance kept for review', c.combined_used === 2800 && c.cost_status === 'provisional' && c.freight.variance === 100 && c.trucking.variance === 50, c);
check('leading zero kept in the stored release', c.release_number === '1001-0077' && c.release_key === '10010077');
var d = rec('1002-2000');
check('closed with trucking quote "NA" and no wire → trucking MISSING, total missing (never zero)', d.trucking.used === null && d.combined_used === null && d.cost_status === 'missing' && d.flags.indexOf('trucking_missing') >= 0);
check('its freight: quote 2000 used until the bill (wire 2050 kept for comparison)', d.freight.kind === 'estimate' && d.freight.used === 2000 && d.freight.final === 2050);
var e1 = recs.filter(function (r) { return r.order_id === 1702; })[0]; var e2 = recs.filter(function (r) { return r.order_id === 1703; })[0];
check('"1002-3000" and "1002 3000" on two orders = conflict on both', e1.conflict && e2.conflict && e1.flags.indexOf('release_on_two_warehouse_orders') >= 0);
var f = rec('1002-4000');
check('pending order: open, not shipped, not in the backfill', f.is_open && !f.is_shipped && !f.in_backfill);

console.log('Codex 16 Nov: a wire is final only when it is also marked paid');
var u1 = W.decideComponent({ name: 'freight', estimate_raw: '1000', final_raw: '1100', paid_raw: 'no', load_date: '2026-06-01' });
check('wire 1100 marked "no" → quote 1000 stays, not final', u1.used === 1000 && u1.kind === 'estimate' && u1.flags.indexOf('freight_wire_not_marked_paid') >= 0, u1);
var u2 = W.decideComponent({ name: 'freight', estimate_raw: '1000', final_raw: '1100', paid_raw: '', load_date: '2026-06-01' });
check('paid flag missing → quote stays', u2.used === 1000 && u2.kind === 'estimate');
var u3 = W.decideComponent({ name: 'freight', estimate_raw: '1000', final_raw: '1100', paid_raw: 'Yes', paid_date: '2026-06-10', load_date: '2026-06-01' });
check('paid "Yes" → final 1100, variance +100', u3.used === 1100 && u3.kind === 'final' && u3.variance === 100);
var u4 = W.decideComponent({ name: 'trucking', estimate_raw: 'NA', final_raw: '900', paid_raw: 'no' });
check('no quote, unpaid wire → used as PROVISIONAL, never final', u4.used === 900 && u4.kind === 'estimate');
var u5 = W.decideComponent({ name: 'trucking', estimate_raw: '', final_raw: '900', paid_raw: 'yes', paid_date: '2026-05-01', load_date: '2026-06-01' });
check('no quote, paid before loading → final but flagged', u5.kind === 'final' && u5.flags.indexOf('trucking_final_suspicious_no_quote') >= 0);

console.log('Codex 16 Nov: one release in both sections');
var x = W.buildRecords({ site: 's', orders: [{ id: 1, release_number: '1001-123', status: 'shipped', shipped_date: '2026-07-01', created_at: '2026-06-01' }], stages: [], obsolete_orders: [{ id: 2, release_number: '1001-123', status: 'Shipped', shiped_date: '2026-07-01', created_at: '2026-06-01' }] }, { today: '2026-11-16' });
check('main + obsolete on one release is NOT a conflict (by design: 132 releases on staging carry obsolete goods in the same container; costs live only on the main order)', !x[0].conflict && x[1].combined_used === null && x[1].flags.indexOf('obsolete_section_costs_are_on_the_main_order') >= 0);
check('only the main order can carry a cost into the P&L', W.warehouseOutboundForRelease([{ section: 'obsolete', freight_used: 5, trucking_used: 5 }], {}).usable === false);

console.log('matching to Hub invoices — release number only');
var INV = [
  { id: 'i1', invoice_number: 'INV-1', release_number: '1002-1156', invoice_date: '2026-07-01', total_amount: 50000, currency: 'USD', record_status: 'active' },
  { id: 'i2', invoice_number: 'INV-2', release_number: '1002-1156 / 1002-1157', invoice_date: '2026-07-02', total_amount: 20000, currency: 'USD', record_status: 'active' },
  { id: 'i3', invoice_number: 'INV-3', release_number: '', po_so_number: '1001-1669', invoice_date: '2026-11-13', total_amount: 9000, currency: 'USD', record_status: 'active' },
  { id: 'i4', invoice_number: 'INV-4', release_number: '1001-77', invoice_date: '2026-07-03', total_amount: 1, currency: 'USD', record_status: 'active' },
  { id: 'i5', invoice_number: 'INV-5', release_number: '1002-1156', invoice_date: '2026-07-01', total_amount: 1, currency: 'USD', record_status: 'void' }
];
W.matchInvoices(recs, INV);
check('1002-1156 → INV-1 and INV-2 (two releases on one invoice), void ignored', a.invoices.map(function (x) { return x.number; }).sort().join(',') === 'INV-1,INV-2' && a.flags.indexOf('several_invoices_share_this_release') >= 0);
check('1001-1669 found ONLY in the PO/SO field → listed for review, not used', b.invoices.length === 0 && b.review_only_invoices.length === 1 && b.flags.indexOf('invoice_only_by_po_so_field') >= 0);
check('"1001-77" does NOT match "1001-0077" (no zero-stripping guess)', c.invoices.length === 0 && c.flags.indexOf('no_hub_invoice_for_release') >= 0);

console.log('Hub bills vs the warehouse quote');
W.compareBills(recs, [
  { id: 'b1', bill_number: 'AMB-77', vendor_name: 'AMB', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-1156', total_amount: 2350, record_status: 'active' },
  { id: 'b2', bill_number: 'SEA-1', vendor_name: 'Seamates', bill_type: 'shipping', shipment_direction: 'outbound', release_number: '1002-1156', total_amount: 3475, record_status: 'active' }
]);
var tc = a.bill_checks.filter(function (x) { return x.part === 'trucking'; })[0]; var fc = a.bill_checks.filter(function (x) { return x.part === 'freight'; })[0];
check('trucker bill 2350 vs quote 1850 → +500 flagged (demurrage?)', tc.status === 'bill_above_quote' && tc.difference === 500 && a.flags.indexOf('trucking_bill_differs_from_quote') >= 0);
check('Max workflow: both bills in → FINAL from the bills: 3475 + 2350 = 5825', a.freight.kind === 'bill' && a.trucking.kind === 'bill' && a.combined_used === 5825 && a.cost_status === 'final', { s: a.cost_status, c: a.combined_used });
check('warehouse trucking wire 20,121 ≠ trucker bill 2,350 → flagged, bill used', tc.final_check && tc.final_check.matches === false && a.flags.indexOf('trucking_warehouse_final_differs_from_bill') >= 0 && a.flags.indexOf('trucking_paid_waiting_for_bill') < 0);
check('freight wire 3475 = forwarder bill 3475 → no mismatch flag', fc.final_check && fc.final_check.matches === true && a.flags.indexOf('freight_warehouse_final_differs_from_bill') < 0);
check('forwarder bill 3475 = quote → matches', fc.status === 'bill_matches_quote');

console.log('re-sync safety');
var row = W.toRow(a, '2026-11-16T12:00:00Z', 'run1');
check('stored row read back = no change (no duplicate history)', Object.keys(W.diffComparable(W.rowComparable(row), W.comparable(a))).length === 0);
check('a sync row never carries the manual_* columns', !('manual_freight' in row) && !('manual_trucking' in row));
var a2 = JSON.parse(JSON.stringify(a)); a2.trucking.used = 2000; a2.combined_used = 5475; // (row above holds the billed 2350)
var dd = W.diffComparable(W.rowComparable(row), W.comparable(a2));
check('a changed amount shows from → to', dd.trucking_used && dd.trucking_used.from === 2350 && dd.trucking_used.to === 2000 && dd.combined_used.to === 5475, dd);

console.log('what the P&L takes from the warehouse');
var R = { section: 'main', order_id: 1, source_link: 'x', freight_used: 3475, freight_kind: 'final', trucking_used: 1850, trucking_kind: 'estimate', manual_freight: null, manual_trucking: null };
var w1 = W.warehouseOutboundForRelease([R], {});
check('no Hub bills → 3475 + 1850 = 5325, not final', w1.usable && w1.amount === 5325 && !w1.final);
var w2 = W.warehouseOutboundForRelease([R], { trucking: true });
check('Hub trucking bill in → only the freight is added (no double count); not final until the freight bill too', w2.usable && w2.amount === 3475 && !w2.final);
var w3 = W.warehouseOutboundForRelease([Object.assign({}, R, { manual_trucking: 2100 })], {});
check('a person’s correction wins over the warehouse', w3.amount === 5575 && w3.trucking.kind === 'manual');
var w4 = W.warehouseOutboundForRelease([Object.assign({}, R, { trucking_used: null })], {});
check('a missing part → not usable (stays missing in the P&L)', !w4.usable);
check('two warehouse orders on a release → not usable', !W.warehouseOutboundForRelease([R, R], {}).usable);
check('CNF / EXW rule', W.inferBasis(true, true) === 'EXW' && W.inferBasis(false, true) === 'CNF' && W.inferBasis(false, false) === null);

console.log('the profitability engine with and without the switch');
var base = {
  date_from: '2026-06-01', date_to: '', windowDays: 90,
  invoices: [{ id: 'i1', invoice_number: 'INV-1', accounting_customer_id: 'c1', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1002-1156' }],
  items: [{ id: 'l1', invoice_id: 'i1', description: 'PVC Auto Seconds', quantity: 40000, unit_price: 0.5 }],
  customerNames: { c1: 'Kenya buyer' }, nameUnits: [{ name_key: 'pvc auto seconds', unit: 'lb' }],
  bills: [{ id: 'b1', bill_number: 'AMB-77', vendor_name: 'AMB', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-1156', total_amount: 2350, record_status: 'active', bill_date: '2026-06-30' }], billLines: [],
  warehouseRows: [Object.assign({ id: 'w1', release_key: '10021156', release_number: '1002-1156', superseded: false }, R)]
};
var off = A.assembleProfitability(Object.assign({}, base, { warehouseOn: false }));
var on = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true }));
var cOff = off.containers[0]; var cOn = on.containers[0];
check('switch OFF: only the Hub trucking bill 2350 (as before)', cOff.status === 'bill' && cOff.shipping_actual === 2350, cOff);
check('switch OFF: warehouse figures still shown on Containers', cOff.warehouse.length === 1 && cOff.warehouse[0].freight_used === 3475);
check('switch ON: trucking bill 2350 + warehouse freight estimate 3475 = 5825 ESTIMATE (freight not billed yet)', cOn.status === 'warehouse_estimate' && cOn.shipping_estimate === 5825 && cOn.parts.trucking.bill === 2350 && cOn.parts.trucking.status === 'final_billed' && cOn.parts.freight.status === 'estimate' && !cOn.parts.final_confirmed, cOn.parts);
check('Containers: trucking estimate 1850 vs bill 2350 → difference +500 flagged', cOn.parts.trucking.estimate === 1850 && cOn.parts.trucking.difference === 500 && cOn.parts.trucking.differs === true, cOn.parts.trucking);
check('switch ON: no basis typed, no shipping line, warehouse cost → CNF inferred', on.by_invoice[0].invoice.basis === 'CNF' && on.by_invoice[0].invoice.basis_source === 'inferred', on.by_invoice[0].invoice);
check('switch OFF: basis not inferred', off.by_invoice[0].invoice.basis === null);
var est = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [] }));
check('no Hub bills: 3475 final + 1850 quote = 5325 as an ESTIMATE', est.containers[0].status === 'warehouse_estimate' && est.containers[0].shipping_estimate === 5325, est.containers[0]);
var typed = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], estimates: [{ release_key: '10021156', outbound_estimate: 6000 }] }));
check('TK (Max, Nov 17): the warehouse figure wins over an older estimate typed in the Hub (no manual updates)', typed.containers[0].status === 'warehouse_estimate' && typed.containers[0].shipping_estimate === 5325, typed.containers[0]);
var typedNoWh = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], warehouseRows: [], estimates: [{ release_key: '10021156', outbound_estimate: 6000 }] }));
check('TK: a typed estimate is only a fallback when the warehouse has nothing', typedNoWh.containers[0].status === 'estimate' && typedNoWh.containers[0].shipping_estimate === 6000, typedNoWh.containers[0]);
var exw = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], items: base.items.concat([{ id: 'l2', invoice_id: 'i1', description: 'Ocean freight', quantity: 1, unit_price: 5000 }]) }));
check('shipping charge line with an amount → EXW (TJ: Max’s shipping-line rule)', exw.by_invoice[0].invoice.basis === 'EXW' && exw.by_invoice[0].invoice.basis_source === 'shipping_line_rule', exw.by_invoice[0].invoice);
var conflict = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], terms: [{ invoice_id: 'i1', basis: 'CNF' }], items: base.items.concat([{ id: 'l2', invoice_id: 'i1', description: 'Ocean freight', quantity: 1, unit_price: 5000 }]) }));
check('Max 16 Nov: CNF WITH a shipping line is allowed (no conflict), typed basis kept, price not split', conflict.by_invoice[0].invoice.basis === 'CNF' && !conflict.flags.some(function (x) { return /^basis_/.test(x.kind); }) && !conflict.by_invoice[0].invoice.embedded_transport, conflict.flags);
check('basis guessed by the rule → flagged "not stated on the invoice"', on.flags.some(function (x) { return x.kind === 'basis_not_stated_on_invoice'; }) && !off.flags.some(function (x) { return x.kind === 'basis_not_stated_on_invoice'; }));

console.log('Max 16 Nov: the invoice should SAY CNF or EXW');
check('statedBasis reads CNF / C&F / CFR / EXW / Ex Works', W.statedBasis('Price CNF Mombasa') === 'CNF' && W.statedBasis('C&F Nhava Sheva') === 'CNF' && W.statedBasis('Ex-Works Houston') === 'EXW' && W.statedBasis('EXW') === 'EXW' && W.statedBasis('PVC regrind') === null && W.statedBasis('CNF … EXW') === 'BOTH');
var sCnf = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], items: [{ id: 'l1', invoice_id: 'i1', description: 'PVC Auto Seconds CNF Mombasa', quantity: 40000, unit_price: 0.5 }] }));
check('invoice says CNF, no shipping line → CNF (stated), shipping inside the price, no review flag', sCnf.by_invoice[0].invoice.basis === 'CNF' && sCnf.by_invoice[0].invoice.basis_source === 'invoice_text' && !sCnf.flags.some(function (x) { return /^basis_/.test(x.kind); }), sCnf.flags);
var sExw = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], items: [{ id: 'l1', invoice_id: 'i1', description: 'PVC Auto Seconds EXW Houston', quantity: 40000, unit_price: 0.5 }] }));
check('invoice says EXW but has no shipping line (warehouse shows costs) → flagged', sExw.by_invoice[0].invoice.basis === 'EXW' && sExw.flags.some(function (x) { return x.kind === 'basis_exw_without_shipping_line'; }), sExw.flags);
var sDiff = A.assembleProfitability(Object.assign({}, base, { warehouseOn: true, bills: [], terms: [{ invoice_id: 'i1', basis: 'EXW' }], items: [{ id: 'l1', invoice_id: 'i1', description: 'PVC Auto Seconds CNF', quantity: 40000, unit_price: 0.5 }] }));
check('basis set in the Hub differs from the invoice text → flagged, the Hub setting kept', sDiff.by_invoice[0].invoice.basis === 'EXW' && sDiff.flags.some(function (x) { return x.kind === 'basis_set_differs_from_invoice_text'; }));

console.log('Max 16 Nov: one wire paying several orders');
var sw = W.buildRecords({ site: 's', orders: [
  { id: 1, release_number: '1002-1', customer_name: 'A', status: 'closed', shipped_date: '2026-07-01', created_at: '2026-06-01' },
  { id: 2, release_number: '1002-2', customer_name: 'B', status: 'closed', shipped_date: '2026-07-01', created_at: '2026-06-01' },
  { id: 3, release_number: '1002-3', customer_name: 'C', status: 'closed', shipped_date: '2026-07-01', created_at: '2026-06-01' }],
  stages: [
  { id: 11, order_id: 1, order_status: 'shipping_in_process', best_rate_received: '1000', trucker_quote: '600', load_date: '2026-06-30' },
  { id: 12, order_id: 1, order_status: 'closed', ff_wire_amount: '1000', ff_paid: 'yes', ff_date_paid: '2026-07-05', trucker_wire_amount: '1800', trucker_paid: 'yes', trucker_date: '2026-07-06' },
  { id: 21, order_id: 2, order_status: 'shipping_in_process', best_rate_received: '1000', trucker_quote: '', load_date: '2026-06-30' },
  { id: 22, order_id: 2, order_status: 'closed', ff_wire_amount: '1000', ff_paid: 'yes', ff_date_paid: '2026-07-09', trucker_wire_amount: '1800', trucker_paid: 'yes', trucker_date: '2026-07-06' },
  { id: 31, order_id: 3, order_status: 'shipping_in_process', best_rate_received: '1000', trucker_quote: '600', load_date: '2026-06-30' },
  { id: 32, order_id: 3, order_status: 'closed', ff_wire_amount: '1000', ff_paid: 'yes', ff_date_paid: '2026-07-10', trucker_wire_amount: '600', trucker_paid: 'yes', trucker_date: '2026-07-07' }] }, { today: '2026-11-16' });
check('same trucking wire 1800 on the same date on 2 orders → never final; quote 600 kept', sw[0].trucking.used === 600 && sw[0].trucking.kind === 'estimate' && sw[0].flags.indexOf('trucking_wire_shared_by_several_orders') >= 0, sw[0].trucking);
check('…and with no quote the share is unknown → MISSING, never the whole wire', sw[1].trucking.used === null && sw[1].cost_status === 'missing' && sw[1].flags.indexOf('trucking_wire_shared_by_several_orders') >= 0);
check('same amount on DIFFERENT dates is not "shared" (no shared flag on freight)', sw[0].flags.indexOf('freight_wire_shared_by_several_orders') < 0 && sw[2].flags.indexOf('trucking_wire_shared_by_several_orders') < 0);

console.log('Max 16 Nov: Canada domestic customer arranging their own transport');
var ot = W.buildRecords({ site: 's', orders: [
  { id: 1, release_number: '1001-500', customer_name: 'Vinyl Trend', status: 'shipped', shipped_date: '2026-07-01', created_at: '2026-06-01' },
  { id: 2, release_number: '1002-500', customer_name: 'X', status: 'shipped', shipped_date: '2026-07-01', created_at: '2026-06-01' },
  { id: 3, release_number: '1001-501', customer_name: 'Y', status: 'pending', created_at: '2026-06-01' },
  { id: 4, release_number: '1001-502', customer_name: 'Z', status: 'shipped', shipped_date: '2026-07-01', created_at: '2026-06-01' }],
  stages: [{ id: 41, order_id: 4, order_status: 'shipping_in_process', best_rate_received: '', trucker_quote: '', truker_name: 'AMB', load_date: '2026-06-30' }] }, { today: '2026-11-16' });
check('shipped 1001- order, every shipping box empty → own transport, 0, inferred, not "missing"', ot[0].cost_status === 'customer_own_transport' && ot[0].combined_used === 0 && ot[0].flags.indexOf('canada_customer_own_transport_inferred') >= 0 && ot[0].flags.indexOf('freight_missing') < 0, ot[0]);
check('a Houston (1002-) order with empty boxes stays MISSING', ot[1].cost_status === 'missing');
check('an unshipped Canada order stays MISSING (costs may still come)', ot[2].cost_status === 'missing');
check('a Canada order with a trucker named but no amounts stays MISSING', ot[3].cost_status === 'missing');
var otw = W.warehouseOutboundForRelease([{ section: 'main', freight_used: 0, freight_kind: 'own_transport', trucking_used: 0, trucking_kind: 'own_transport' }], {});
check('own transport feeds the P&L as 0 — an estimate (only a bill confirms final)', otw.usable && otw.amount === 0 && !otw.final && otw.own_transport);

console.log('Codex 16 Nov (P1): paid-shipment evidence blocks the own-transport rule');
function canada(stages) { return W.buildRecords({ site: 's', orders: [{ id: 9, release_number: '1001-9000', customer_name: 'K', status: 'closed', shipped_date: '2026-10-01', created_at: '2026-09-01' }], stages: stages }, { today: '2026-11-16' })[0]; }
[['ff_paid', 'yes'], ['ff_date_paid', '2026-10-02'], ['ff_invoivce', 'FREIGHT-999'], ['ff_wire_bank', 'Bank'], ['trucker_paid', 'yes'], ['trucker_date', '2026-10-03'], ['ff_invoice', 'TRK-1'], ['trucker_wire_bank', 'Chase']].forEach(function (p) {
  var st = { id: 1, order_id: 9, order_status: 'closed', ff_wire_amount: '0', trucker_wire_amount: '0' }; st[p[0]] = p[1];
  var x = canada([st]);
  check('closed-stage ' + p[0] + ' set, no amount → NOT own transport, stays missing + flagged', x.cost_status === 'missing' && x.flags.indexOf('canada_shipping_recorded_but_no_amount') >= 0, { s: x.cost_status, f: x.flags });
});
var older = canada([{ id: 1, order_id: 9, order_status: 'shipping_in_process', truker_name: 'AMB', updated_at: '2026-09-01' }, { id: 2, order_id: 9, order_status: 'shipping_in_process', truker_name: '', updated_at: '2026-09-05' }]);
check('an OLDER stage row naming a trucker also blocks it', older.cost_status === 'missing');
var trulyEmpty = canada([{ id: 1, order_id: 9, order_status: 'closed', ff_wire_amount: '0', trucker_wire_amount: '0', ff_paid: 'no', trucker_paid: '' }]);
check('truly empty (paid "no", amounts "0") → own transport', trulyEmpty.cost_status === 'customer_own_transport');
var contra = A.assembleProfitability({ date_from: '2026-06-01', windowDays: 90, warehouseOn: true,
  invoices: [{ id: 'I', invoice_number: 'I', accounting_customer_id: 'c', invoice_date: '2026-10-01', record_status: 'active', currency: 'USD', release_number: '1001-9000' }],
  items: [{ id: 'L', invoice_id: 'I', description: 'Goods', quantity: 1000, unit_price: 1 }], customerNames: { c: 'C' }, nameUnits: [{ name_key: 'goods', unit: 'lb' }], lineCosts: [{ invoice_item_id: 'L', cost_per_lb: 0.2, commission_per_lb: 0 }], bills: [], billLines: [],
  warehouseRows: [W.toRow(Object.assign(canada([{ id: 1, order_id: 9, order_status: 'closed', ff_paid: 'yes', ff_wire_amount: '0' }]), {}), 'now', 'r')].map(function (x) { return Object.assign({ id: 'w', superseded: false }, x); }) });
check('…and in the P&L that contradictory case is NOT a confirmed zero cost', contra.containers[0].status !== 'warehouse_final' && contra.totals.complete !== true, contra.containers[0]);

console.log('Codex 16 Nov (P1): a test order cannot change anything in the P&L');
function tfx(withTest, billOn, est) {
  var rows = withTest ? [{ id: 'w', section: 'main', order_id: 1701, release_key: '10011675', superseded: false, conflict: true, flags: ['test_order_not_used'], freight_used: 1000, freight_kind: 'estimate', trucking_used: 500, trucking_kind: 'estimate' }] : [];
  return A.assembleProfitability({ date_from: '2026-06-01', windowDays: 90, warehouseOn: true,
    invoices: [{ id: 'I', invoice_number: 'I', accounting_customer_id: 'c', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1001-1675' }],
    items: [{ id: 'L', invoice_id: 'I', description: 'Goods', quantity: 1000, unit_price: 1 }], customerNames: { c: 'C' }, nameUnits: [{ name_key: 'goods', unit: 'lb' }], lineCosts: [{ invoice_item_id: 'L', cost_per_lb: 0.2, commission_per_lb: 0 }],
    estimates: est ? [{ release_key: '10011675', outbound_estimate: 300 }] : [],
    bills: billOn ? [{ id: 'B', bill_number: 'B', vendor_name: 'V', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001-1675', total_amount: 100, record_status: 'active', bill_date: '2026-07-01' }] : [], billLines: [], warehouseRows: rows });
}
[[true, false], [false, false], [true, true], [false, true]].forEach(function (c) {
  var a0 = tfx(false, c[0], c[1]); var a1 = tfx(true, c[0], c[1]);
  var same = JSON.stringify([a0.by_invoice[0].invoice.basis, a0.containers[0].status, a0.containers[0].shipping_actual, a0.containers[0].shipping_estimate, a0.totals]) === JSON.stringify([a1.by_invoice[0].invoice.basis, a1.containers[0].status, a1.containers[0].shipping_actual, a1.containers[0].shipping_estimate, a1.totals]);
  check('test row changes nothing (bill ' + c[0] + ', typed estimate ' + c[1] + ')', same, { without: [a0.by_invoice[0].invoice.basis, a0.containers[0].status], with: [a1.by_invoice[0].invoice.basis, a1.containers[0].status] });
});
var tm = W.buildRecords({ site: 's', orders: [{ id: 5, release_number: '1001-1675', customer_name: 'Test', status: 'shipped', shipped_date: '2026-11-14', created_at: '2026-11-14' }], stages: [] }, { today: '2026-11-16' });
W.matchInvoices(tm, [{ id: 'q', invoice_number: 'Q', release_number: '1001-1675', currency: 'USD', record_status: 'active' }]);
check('a test order is not matched to Hub invoices', tm[0].invoices.length === 0);

console.log('Max 16 Nov: shipping terms on the invoice');
var ST = require(path.join(root, 'src/lib/shipping-terms.js')); var P0 = require(path.join(root, 'src/lib/profitability.js'));
var L = function (d, a) { return { description: d, amount: a }; };
check('no choice → refused', !ST.checkShippingTerms('', null, [], P0.isTransportLine).ok);
check('EXW, no shipping line, no cost → ok', ST.checkShippingTerms('EXW', '', [L('PVC', 1000)], P0.isTransportLine).ok);
check('EXW, no shipping line, but a cost → refused', !ST.checkShippingTerms('EXW', '500', [L('PVC', 1000)], P0.isTransportLine).ok);
check('EXW + shipping line needs the cost', !ST.checkShippingTerms('EXW', '', [L('PVC', 1000), L('Ocean freight', 600)], P0.isTransportLine).ok);
var e7 = ST.checkShippingTerms('EXW', '600', [L('PVC', 1000), L('Ocean freight', 620)], P0.isTransportLine);
check('EXW + shipping line 620 on cost 600 → warned (minimum 642)', e7.ok && e7.warnings.length === 1 && /642\.00/.test(e7.warnings[0]), e7);
check('CNF needs a cost', !ST.checkShippingTerms('CNF_INCLUDED', '', [L('PVC', 1000)], P0.isTransportLine).ok);
var c7 = ST.checkShippingTerms('CNF_SEPARATE', '1000', [L('PVC', 9000), L('Freight charges', 1070)], P0.isTransportLine);
check('CNF separate: line 1070 on cost 1000 → exactly +7%, no warning', c7.ok && c7.warnings.length === 0, c7);
var c8 = ST.checkShippingTerms('CNF_SEPARATE', '1000', [L('PVC', 9000)], P0.isTransportLine);
check('CNF separate with no shipping line → warned', c8.ok && c8.warnings.length === 1);
check('one value ↔ basis', ST.basisOfTerms('CNF_SEPARATE') === 'CNF' && ST.basisOfTerms('EXW') === 'EXW' && ST.termsOfBasis('CNF', 'CNF_SEPARATE') === 'CNF_SEPARATE' && ST.termsOfBasis('TRUCKING_INCLUDED', 'EXW') === null);
function stFx(terms, est, lines, bills) { return A.assembleProfitability({ date_from: '2026-06-01', windowDays: 90, warehouseOn: false,
  invoices: [{ id: 'I', invoice_number: 'I', accounting_customer_id: 'c', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1002-77' }],
  items: lines, customerNames: { c: 'C' }, nameUnits: [{ name_key: 'goods', unit: 'lb' }], lineCosts: [{ invoice_item_id: 'L', cost_per_lb: 0.2, commission_per_lb: 0 }],
  terms: [{ invoice_id: 'I', basis: ST.basisOfTerms(terms), shipping_terms: terms, shipping_cost_estimate: est }], bills: bills || [], billLines: [] }); }
var GOODS = { id: 'L', invoice_id: 'I', description: 'Goods', quantity: 10000, unit_price: 1 };
var s1 = stFx('CNF_INCLUDED', 800, [GOODS]);
check('CNF in price, no bill → the invoice-form 800 is the shipping ESTIMATE and is taken out of the price', s1.containers[0].shipping_estimate === 800 && s1.by_invoice[0].invoice.basis === 'CNF' && s1.by_invoice[0].invoice.basis_source === 'invoice_form' && s1.by_invoice[0].invoice.embedded_used === 800, { c: s1.containers[0], i: s1.by_invoice[0].invoice });
var s2 = stFx('CNF_INCLUDED', 800, [GOODS], [{ id: 'B1', bill_number: 'T1', vendor_name: 'AMB', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-77', total_amount: 900, record_status: 'active', bill_date: '2026-07-02' }]);
check('a bill replaces the invoice-form estimate (900 used, not 800)', s2.containers[0].shipping_actual === 900 && s2.containers[0].status === 'bill');
var s3 = stFx('CNF_SEPARATE', 1000, [GOODS, { id: 'L2', invoice_id: 'I', description: 'Ocean freight', quantity: 1, unit_price: 1050 }]);
check('CNF separate: shipping line 1050 < cost 1000 + 7% → flagged, short by 20', s3.flags.some(function (f) { return f.kind === 'shipping_charged_below_cost_plus_7pct' && f.short_by === 20; }), s3.flags);
check('CNF separate: the price is NOT split (shipping is on its own line)', !s3.by_invoice[0].invoice.embedded_used);
var s4 = stFx('CNF_SEPARATE', 1000, [GOODS, { id: 'L2', invoice_id: 'I', description: 'Ocean freight', quantity: 1, unit_price: 1100 }]);
check('CNF separate: 1100 ≥ 1070 → no flag', !s4.flags.some(function (f) { return f.kind === 'shipping_charged_below_cost_plus_7pct'; }));
var s5 = stFx('EXW', null, [GOODS], [{ id: 'B1', bill_number: 'T1', vendor_name: 'AMB', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-77', total_amount: 900, record_status: 'active', bill_date: '2026-07-02' }]);
check('EXW with no shipping line but a shipping bill on the release → flagged', s5.flags.some(function (f) { return f.kind === 'exw_but_shipping_cost_on_release'; }));

console.log('Codex 15:05–15:15 fixes');
check('"Infinity" and 1e309 refused as a cost', !ST.checkShippingTerms('CNF_INCLUDED', 'Infinity', [L('PVC', 1)], P0.isTransportLine).ok && !ST.checkShippingTerms('CNF_INCLUDED', '1e309', [L('PVC', 1)], P0.isTransportLine).ok && !ST.checkShippingTerms('CNF_INCLUDED', 'abc', [L('PVC', 1)], P0.isTransportLine).ok && !ST.checkShippingTerms('CNF_INCLUDED', '-5', [L('PVC', 1)], P0.isTransportLine).ok && ST.checkShippingTerms('CNF_INCLUDED', '1,250.50', [L('PVC', 1)], P0.isTransportLine).value.shipping_cost_estimate === 1250.5);
var m1 = ST.invoiceEstimatesByRelease([{ invoice_id: 'I', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 1000, releases: ['A', 'B'] }], { A: 3000, B: 1000 });
check('one invoice on 2 releases: 1000 split 750 / 250 by pounds (total kept, not doubled)', m1.A.amount === 750 && m1.B.amount === 250 && m1.__unresolved.length === 0, m1);
var m2 = ST.invoiceEstimatesByRelease([{ invoice_id: 'I', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 1000, releases: ['A', 'B'] }], { A: 2000, B: 2000 });
check('equal pounds → 500 / 500', m2.A.amount === 500 && m2.B.amount === 500);
var m3 = ST.invoiceEstimatesByRelease([{ invoice_id: 'I', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 1000, releases: ['A', 'B'] }], { A: 2000 });
check('a release with no pounds → nothing used, listed as unresolved', !m3.A && !m3.B && m3.__unresolved.length === 1);
var m4 = ST.invoiceEstimatesByRelease([{ invoice_id: 'I', shipping_terms: 'CNF_INCLUDED', shipping_cost_estimate: 1000, releases: ['A', 'B', 'C'] }], { A: 1, B: 1, C: 1 });
check('3-way split keeps the exact total (333.33 + 333.33 + 333.34)', Math.round((m4.A.amount + m4.B.amount + m4.C.amount) * 100) === 100000);
var exwI = A.assembleProfitability({ date_from: '2026-06-01', windowDays: 90, warehouseOn: false,
  invoices: [{ id: 'I', invoice_number: 'I', accounting_customer_id: 'c', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1001-9000' }],
  items: [{ id: 'L', invoice_id: 'I', description: 'Goods', quantity: 1000, unit_price: 1 }, { id: 'L2', invoice_id: 'I', description: 'Shipping', quantity: 1, unit_price: 107 }], customerNames: { c: 'C' }, nameUnits: [{ name_key: 'goods', unit: 'lb' }],
  lineCosts: [{ invoice_item_id: 'L', cost_per_lb: 0.2, commission_per_lb: 0 }], terms: [{ invoice_id: 'I', basis: 'EXW', shipping_terms: 'EXW', shipping_cost_estimate: 100 }], bills: [], billLines: [] });
check('EXW + shipping line + estimate 100 → the 100 reaches the report (Codex repro)', exwI.containers[0].shipping_estimate === 100 && exwI.containers[0].status === 'estimate', exwI.containers[0]);
check('…and 107 charged vs 100 cost → exactly +7%, no flag', !exwI.flags.some(function (f) { return f.kind === 'shipping_charged_below_cost_plus_7pct'; }));
var VC = require(path.join(root, 'src/lib/verified-caller.js'));
function fakeReq(h) { var hh = Object.assign({ origin: 'https://hub.example', 'content-type': 'application/json' }, h || {}); return { method: 'POST', url: 'https://hub.example/api/accounting/profitability', headers: { get: function (k) { return hh[k.toLowerCase()] || null; } } }; }
var envSave = Object.assign({}, process.env); process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'a'; process.env.SUPABASE_SERVICE_ROLE_KEY = 's';
function fakeClient(uid, profile) { return function () { return { auth: { getUser: function () { return Promise.resolve(uid ? { data: { user: { id: uid } } } : { error: { message: 'bad' }, data: {} }); } }, rpc: function () { return Promise.resolve({ data: profile ? [{ profile_id: profile }] : [] }); } }; }; }
var U1 = '11111111-1111-4111-8111-111111111111'; var P1 = '22222222-2222-4222-8222-222222222222'; var P2 = '33333333-3333-4333-8333-333333333333';
var vcTests = [
  VC.verifiedCaller(fakeReq({}), { user_id: P2 }, fakeClient(U1, P1)).then(function (r) { check('no token → refused (401), forged super-admin id ignored', r.status === 401, r); }),
  VC.verifiedCaller(fakeReq({ authorization: 'Bearer bad' }), {}, fakeClient(null, null)).then(function (r) { check('invalid token → refused (401)', r.status === 401, r); }),
  VC.verifiedCaller(fakeReq({ authorization: 'Bearer good' }), { user_id: P2 }, fakeClient(U1, P1)).then(function (r) { check("a regular user's token + an admin's id → refused (403)", r.status === 403, r); }),
  VC.verifiedCaller(fakeReq({ authorization: 'Bearer good' }), { user_id: P1 }, fakeClient(U1, P1)).then(function (r) { check('own token + own id → that verified user', r.userId === P1, r); })
];

console.log('Max 16 Nov: profit / margin hidden without the permission');
var MV = require(path.join(root, 'src/lib/margin-visibility.js'));
var hid = MV.stripProfit(s4);
var leak = JSON.stringify(hid).match(/"[a-z_]*(profit|margin)[a-z_]*":/gi);
check('server strip removes every profit/margin field from a full report', !leak, leak);
check('…and keeps revenue and costs', hid.totals && hid.totals.goods_revenue !== undefined && hid.cells.length === s4.cells.length);
check('super admin always sees; others need the grant', MV.canSeeMargin(true, {}) && !MV.canSeeMargin(false, {}) && MV.canSeeMargin(false, { 'pnl.view_margin': true }));

console.log('Max 16 Nov: customer names — note only, never used to match');
check('"Vinyl Trend Inc." agrees with "VINYL TREND"', W.namesAgree('Vinyl Trend Inc.', 'VINYL TREND'));
check('different companies disagree', !W.namesAgree('Kenya Plastics Ltd', 'Mumbai Polymers'));
var nm = W.buildRecords({ site: 's', orders: [{ id: 9, release_number: '1002-9', customer_name: 'Kenya Plastics Ltd', status: 'shipped', shipped_date: '2026-07-01', created_at: '2026-06-01' }], stages: [] }, { today: '2026-11-16' });
W.matchInvoices(nm, [{ id: 'q', invoice_number: 'Q', release_number: '1002-9', accounting_customer_id: 'cx', currency: 'USD', record_status: 'active' }], { cx: 'Mumbai Polymers' });
check('name differs → noted, invoice still matched by release number', nm[0].invoices.length === 1 && nm[0].flags.indexOf('customer_name_differs_from_hub_invoice') >= 0);

console.log('Codex 16 Nov (P1): a missing warehouse part never leaves a partial bill looking complete');
function fx(billType, wh) {
  return A.assembleProfitability({ date_from: '2026-06-01', windowDays: 90, warehouseOn: true,
    invoices: [{ id: 'I', invoice_number: 'I', accounting_customer_id: 'c', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1001-1' }],
    items: [{ id: 'L', invoice_id: 'I', description: 'Goods', quantity: 1000, unit_price: 1 }], customerNames: { c: 'C' }, nameUnits: [{ name_key: 'goods', unit: 'lb' }],
    lineCosts: [{ invoice_item_id: 'L', cost_per_lb: 0.2, commission_per_lb: 0 }],
    bills: [{ id: 'B', bill_number: 'B', vendor_name: 'V', bill_type: billType, shipment_direction: 'outbound', release_number: '1001-1', total_amount: 100, record_status: 'active', bill_date: '2026-07-01' }], billLines: [],
    warehouseRows: [Object.assign({ id: 'w', section: 'main', order_id: 1, release_key: '10011', superseded: false, manual_freight: null, manual_trucking: null }, wh)] });
}
var p1 = fx('trucking', { freight_used: null, freight_kind: 'missing', trucking_used: 100, trucking_kind: 'final' });
check('trucking bill $100 + warehouse freight MISSING → not complete', p1.totals.complete !== true && p1.containers[0].status !== 'bill', { complete: p1.totals.complete, st: p1.containers[0].status });
check('…the known $100 is kept, as an estimate', p1.containers[0].shipping_estimate === 100);
check('…and flagged', p1.flags.some(function (x) { return x.kind === 'warehouse_cost_not_usable'; }));
var p2 = fx('shipping', { freight_used: 100, freight_kind: 'final', trucking_used: null, trucking_kind: 'missing' });
check('reverse: freight bill + warehouse trucking MISSING → not complete', p2.totals.complete !== true && p2.containers[0].shipping_estimate === 100);
var p3 = A.assembleProfitability(Object.assign({}, { date_from: '2026-06-01', windowDays: 90, warehouseOn: true,
  invoices: [{ id: 'I', invoice_number: 'I', accounting_customer_id: 'c', invoice_date: '2026-07-01', record_status: 'active', currency: 'USD', release_number: '1001-1' }],
  items: [{ id: 'L', invoice_id: 'I', description: 'Goods', quantity: 1000, unit_price: 1 }], customerNames: { c: 'C' }, nameUnits: [{ name_key: 'goods', unit: 'lb' }],
  terms: [{ invoice_id: 'I', basis: 'CNF' }],
  bills: [{ id: 'B', bill_number: 'B', vendor_name: 'V', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1001-1', total_amount: 100, record_status: 'active', bill_date: '2026-07-01' }], billLines: [],
  warehouseRows: [{ id: 'w', section: 'main', order_id: 1, release_key: '10011', superseded: false, freight_used: null, trucking_used: 100, trucking_kind: 'final' }] }));
check('a CNF price is NOT separated using a partial shipping cost', p3.by_invoice[0].invoice.embedded_used === null || p3.by_invoice[0].invoice.embedded_used === undefined, p3.by_invoice[0].invoice);
var p4 = fx('trucking', { freight_used: 2000, freight_kind: 'final', trucking_used: 100, trucking_kind: 'final' });
check('trucking bill + warehouse freight paid (no freight bill) → 2,100 ESTIMATE, not complete', p4.containers[0].status === 'warehouse_estimate' && p4.containers[0].shipping_estimate === 2100 && p4.totals.complete !== true, p4.containers[0]);

console.log('test orders on the warehouse copy');
var tr = W.buildRecords({ site: 's', orders: [{ id: 1701, release_number: '1001-1675', customer_name: 'Test', status: 'shipped', shipped_date: '2026-11-14', created_at: '2026-11-14' }], stages: [{ id: 1, order_id: 1701, order_status: 'shipping_in_process', best_rate_received: '1000', trucker_quote: '500', load_date: '2026-11-14' }] }, { today: '2026-11-16' })[0];
check('customer "Test" → flagged and marked not usable', tr.conflict === true && tr.flags.indexOf('test_order_not_used') >= 0);
check('a stored conflict/test row never feeds the P&L', W.warehouseOutboundForRelease([{ section: 'main', conflict: true, freight_used: 1000, trucking_used: 500 }], {}).usable === false);

// optional: a real feed (dry run)
if (process.argv[2]) {
  console.log('real feed: ' + process.argv[2]);
  var feed = require(path.resolve(process.argv[2]));
  var all = W.buildRecords(feed, { source: 'nextrade-staging' });
  var k1 = all.filter(function (r) { return r.release_number === '1002-1156' && r.section === 'main'; })[0];
  var k2 = all.filter(function (r) { return r.release_number === '1001-1669' && r.section === 'main'; })[0];
  check('feed: 1002-1156 → 5325 provisional (no bills on staging feed)', k1 && k1.combined_used === 5325 && k1.cost_status === 'provisional');
  check('feed: 1001-1669 → 2691 provisional', k2 && k2.combined_used === 2691 && k2.cost_status === 'provisional');
  var keys = {}; var dup = 0; all.forEach(function (r) { var k = r.source + '|' + r.section + '|' + r.order_id; if (keys[k]) { dup++; } keys[k] = true; });
  check('feed: every record has a unique key (no duplicates on import)', dup === 0);
}
Promise.all(vcTests).then(function () {
  console.log('\n' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
});
