// v55.83-TI — order lifecycle rules (Max, Nov 16). Run: node __tests__/test-v55-83-ti-order-lifecycle.js
var path = require('path');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var L = require(path.join(root, 'src/lib/order-lifecycle.js'));
var pass = 0; var failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
function item(ev, key) { return ev.items.filter(function (i) { return i.key === key; })[0]; }
var NOW = L.nyLocalToUtcMs('2026-11-16 12:00:00'); // Mon 16 Nov, noon New York

console.log('time');
check('New York local → UTC (winter, UTC−5)', new Date(L.nyLocalToUtcMs('2026-11-18 09:00:00')).toISOString() === '2026-11-18T14:00:00.000Z');
check('New York local → UTC (summer, UTC−4)', new Date(L.nyLocalToUtcMs('2026-07-01 09:00:00')).toISOString() === '2026-07-01T13:00:00.000Z');

console.log('destination (Egypt / Kenya only, no port)');
check('Egypt and Kenya → ACID applies; Ghana → no; blank → unknown', L.acidCountry('Egypt') === 'yes' && L.acidCountry(' kenya ') === 'yes' && L.acidCountry('Ghana') === 'no' && L.acidCountry('') === 'unknown');
var base = { order: { id: 1, release_number: '1002-1201', customer_name: 'Example A', country: 'Egypt', status: 'preload' }, rows: { preload: { deposit_received: 'yes', deposit_amount: '12500' }, shipping_in_process: {} } };
var e1 = L.evaluateOrder(base, NOW);
check('Egypt: ACID Number applies and is missing', item(e1, 'acid_number').applies && item(e1, 'acid_number').status === 'waiting');
var gh = L.evaluateOrder({ order: Object.assign({}, base.order, { country: 'Ghana' }), rows: base.rows }, NOW);
check('Ghana: ACID and CargoX are Not Applicable', item(gh, 'acid_number').status === 'na' && item(gh, 'final_document_to_cargox').status === 'na');
var nc = L.evaluateOrder({ order: Object.assign({}, base.order, { country: '' }), rows: base.rows }, NOW);
check('no country: ACID is flagged (destination missing), never assumed N/A', item(nc, 'acid_number').applies && /destination country missing/.test(item(nc, 'acid_number').why));

console.log('BL type and CAD — each controls its own item, never defaulted');
function endFor(doc, pay) { return L.evaluateOrder({ order: Object.assign({}, base.order, { status: 'end_stage' }), rows: { preload: base.rows.preload, shipping_in_process: { shipping_doc_type: doc, order_payment_type: pay }, end_stage: {} } }, NOW); }
var sw = endFor('swb', 'non_bank'); var ob = endFor('original_bl', 'cad'); var blank = endFor('', '');
check('SWB → BL Received N/A · Non-bank → bank docs N/A', item(sw, 'bl_received').status === 'na' && item(sw, 'final_document_to_bank').status === 'na');
check('Original BL → BL Received required · CAD → bank docs required', item(ob, 'bl_received').status === 'missing' && item(ob, 'final_document_to_bank').status === 'missing');
check('not chosen → both selections show missing, and the dependent items stay required', item(blank, 'shipping_doc_type').status === 'missing' && item(blank, 'order_payment_type').status === 'missing' && item(blank, 'bl_received').status === 'missing' && item(blank, 'final_document_to_bank').status === 'missing');
check('Nextrade Paid and NEXPAC are not on the checklist any more', !item(ob, 'nextrade_paid') && !item(ob, 'nexpac_report_sent'));

console.log('obsolete report');
var obs1 = L.evaluateOrder({ order: Object.assign({}, base.order, { status: 'post_loading_documentation' }), rows: { preload: base.rows.preload, post_loading_documentation: {} }, obsolete: true }, NOW);
var obs0 = L.evaluateOrder({ order: Object.assign({}, base.order, { status: 'post_loading_documentation' }), rows: { preload: base.rows.preload, post_loading_documentation: {} }, obsolete: false }, NOW);
check('obsolete goods → required; none → Not Applicable', item(obs1, 'obsolete_report').status === 'missing' && item(obs0, 'obsolete_report').status === 'na');

console.log('Pre-Shipping Docs moved to Post-loading');
var mv = L.evaluateOrder({ order: Object.assign({}, base.order, { status: 'post_loading_documentation' }), rows: { preload: base.rows.preload, shipping_in_process: { pre_shipping_docs: 'yes' }, post_loading_documentation: {} } }, NOW);
check('the old Shipping-In-Process "yes" still counts (history kept)', item(mv, 'pre_shipping_docs').stage === 'post_loading_documentation' && item(mv, 'pre_shipping_docs').status === 'done' && /kept/.test(item(mv, 'pre_shipping_docs').why));
check('it is no longer a Shipping-In-Process item', !mv.items.some(function (i) { return i.stage === 'shipping_in_process' && i.key === 'pre_shipping_docs'; }));

console.log('invoice: current or not (age never matters)');
var inv = function (o) { return Object.assign({ id: 'i', number: 'INV-1', record_status: 'active', approval_status: 'approved', total: 100, paid: 0 }, o); };
check('approved + active = current', L.invoiceState({ status: 'preload' }, [inv({})]).state === 'current');
check('only a draft → "draft only"', L.invoiceState({ status: 'preload' }, [inv({ approval_status: 'draft' })]).state === 'draft_only');
check('only void → "cancelled only"', L.invoiceState({ status: 'shipped' }, [inv({ record_status: 'void' })]).state === 'cancelled_only');
check('release only in the PO/SO field → wrongly linked', L.invoiceState({ status: 'shipped' }, [inv({ po_so_only: true })]).state === 'po_so_only');
check('none before shipping → awaiting (not an alarm)', L.invoiceState({ status: 'preload' }, []).state === 'awaiting' && !L.invoiceState({ status: 'preload' }, []).severe);
check('none after shipping → missing, overdue (an alarm)', L.invoiceState({ status: 'shipped' }, []).state === 'missing_overdue' && L.invoiceState({ status: 'shipped' }, []).severe);
check('a void invoice + an approved one → current (the void one is history)', L.invoiceState({ status: 'shipped' }, [inv({ record_status: 'void', number: 'INV-0' }), inv({})]).state === 'current');
check('two current invoices (partial shipments) are both kept', L.invoiceState({ status: 'shipped' }, [inv({}), inv({ id: 'j', number: 'INV-2' })]).current.length === 2);
check('reopened and not re-sent to Wave → flagged', L.invoiceState({ status: 'shipped' }, [inv({ wave_sync_status: 'pending_sync' })]).flags.length === 1);
check('invoice for another customer → flagged', L.invoiceState({ status: 'shipped', customer_name: 'Kenya Plastics Ltd' }, [inv({ customer_name: 'Mumbai Polymers' })]).flags.length === 1);
check('release splitting: "1001-1567 / 1001-1570" → two releases', L.releasesOf('1001-1567 / 1001-1570').length === 2);

console.log('deposit');
check('payments matched to the order’s invoice reach the amount → Received', L.depositState({ deposit_amount: '9000' }, null, [{ bank_transaction_id: 'b1', amount: 9000 }], [], 0).status === 'received');
var part = L.depositState({ deposit_amount: '9000' }, null, [{ bank_transaction_id: 'b1', amount: 6000 }], [], 0);
check('partial → stays incomplete and blocks shipping', part.status === 'partial' && part.blocked && /6000\.00 of \$9000\.00/.test(part.words));
check('nothing matched → "Waiting for deposit — shipping blocked"', /^Waiting for deposit — shipping blocked/.test(L.depositState({ deposit_amount: '9000' }, null, [], [], 0).words));
check('proforma deposit matched straight to the order → Received', L.depositState({ deposit_amount: '9000' }, null, [], [{ bank_transaction_id: 'b2', amount: 9000 }], 0).status === 'received');
check('the SAME bank money linked to the order AND matched to its invoice counts once', L.depositState({ deposit_amount: '9000' }, null, [{ bank_transaction_id: 'b2', amount: 5000 }], [{ bank_transaction_id: 'b2', amount: 5000 }], 0).status === 'partial');
check('Not Required with a note → complete; without a note → not complete', L.depositState({}, { status: 'not_required', note: 'open account customer' }).complete === true && L.depositState({}, { status: 'not_required' }).complete === false);
check('no amount set → unknown (shown as missing information)', L.depositState({}, null, [], [], 0).status === 'unknown');

console.log('30-hour deadline (New York time)');
function dl(status, load, hist, setAt, now) { return L.deadlineState({ id: 7, status: status }, { load_date: load, updated_at: setAt || '2026-11-10 10:00:00' }, hist || [], now || NOW); }
check('ships Wed 09:00, now Mon noon → deadline Tue 03:00 is 15 h away → due soon', dl('preload', '2026-11-18 09:00:00').state === 'due_soon');
check('ships Fri → on track', dl('preload', '2026-11-20 09:00:00').state === 'on_track');
check('ships Tue 09:00 (deadline Mon 03:00, passed) → MISSED, alert', dl('preload', '2026-11-17 09:00:00').state === 'missed' && dl('preload', '2026-11-17 09:00:00').alert === true);
check('scheduled time passed, not shipped → overdue unshipped', dl('preload', '2026-11-16 08:00:00').state === 'overdue_unshipped');
var sn = dl('preload', '2026-11-17 09:00:00', [], '2026-11-16 11:00:00', L.nyLocalToUtcMs('2026-11-16 11:30:00'));
check('booked Mon 11:00 for Tue 09:00 (22 h notice) → SHORT NOTICE, alert at once', sn.state === 'short_notice' && sn.alert === true && sn.short_notice === true, sn);
check('booked well ahead, then the deadline passes → MISSED (not short notice)', dl('preload', '2026-11-17 09:00:00', [], '2026-11-10 10:00:00').state === 'missed');
check('reached Shipping In Process in time → reached (no alert)', dl('shipping_in_process', '2026-11-18 09:00:00', [{ changed_to: 'shipping_in_process', created_at: '2026-11-15 10:00:00' }]).state === 'reached');
check('reached after the deadline → recorded as reached late', dl('shipping_in_process', '2026-11-17 09:00:00', [{ changed_to: 'shipping_in_process', created_at: '2026-11-16 10:00:00' }]).state === 'reached_late');
check('rescheduled → a new alert key (old alert stops, new time is checked)', dl('preload', '2026-11-17 09:00:00').alert_key !== dl('preload', '2026-11-19 09:00:00').alert_key);
check('shipped → no deadline', dl('shipped', '2026-11-10 09:00:00').state === 'shipped');
check('a deadline passing never ticks anything off', item(L.evaluateOrder({ order: { id: 7, status: 'preload', country: 'Egypt' }, rows: { preload: { deposit_amount: '1' }, shipping_in_process: { load_date: '2026-11-16 08:00:00' } } }, NOW), 'acid_number').status !== 'done');

console.log('shipped with gaps keeps its factual status');
var sh = L.evaluateOrder({ order: { id: 9, status: 'shipped', release_number: '1001-1655', country: 'India', shipped_date: '2026-11-04' }, rows: { preload: { deposit_amount: '100' }, shipping_in_process: {}, shipped: { item_shipped_scanned_out: 'yes' } }, invoicePayments: [{ bank_transaction_id: 'x', amount: 100 }], invoices: [] }, NOW);
check('"Shipped — outstanding requirements", stage stays Shipped', sh.readiness.words === 'Shipped — outstanding requirements' && sh.stage === 'shipped' && sh.invoice.state === 'missing_overdue');
check('next action: create the KTC invoice', /Create the KTC invoice/.test(sh.next_action));

console.log('stage and readiness kept apart');
var blk = L.evaluateOrder({ order: { id: 3, status: 'shipping_in_process', country: 'Egypt' }, rows: { preload: { deposit_amount: '12500' }, shipping_in_process: { load_date: '2026-11-25 09:00:00' } } }, NOW);
check('in Shipping In Process AND blocked by its deposit', blk.stage === 'shipping_in_process' && blk.readiness.key === 'blocked' && blk.readiness.words === 'Blocked — deposit');
check('Not Applicable items do not count in progress', blk.groups.documents.total === blk.items.filter(function (i) { return (i.stage === 'post_loading_documentation' || i.stage === 'end_stage') && i.applies; }).length);

console.log('automatic closure');
var full = { preload: { deposit_amount: '100' }, shipping_in_process: { shipping_doc_type: 'swb', order_payment_type: 'non_bank', freight_forwarder: 'F', best_rate_received: '1', shipping_line: 'L', booking_completed: 'yes', booking_number: 'B', erd: '2026-11-01', sailing_date: '2026-11-03', load_date: '2026-11-02 09:00:00', truker_name: 'T', trucker_quote: '1', release_notes: 'yes', arrival_date: '2026-11-30', america_reference: 'A' },
  shipped: { item_shipped_scanned_out: 'yes' }, post_loading_documentation: { pre_shipping_docs: 'yes', final_doc_submitted_to_ff: 'yes', ktc_report_sent: 'yes', customer_email_all_paper_work: 'yes' },
  end_stage: { final_bl_draft_to_customer: 'yes', release_requested: 'yes', final_document_to_customer: 'yes', final_payment: 'paid' } };
var paidInv = [{ id: 'i', number: 'INV-9', record_status: 'active', approval_status: 'approved', total: 1000, paid: 1000 }];
var paidBills = [{ bill_type: 'shipping', total: 500, paid: 500, number: 'F1' }, { bill_type: 'trucking', total: 200, paid: 200, number: 'T1' }];
var okClose = L.evaluateOrder({ order: { id: 5, status: 'end_stage', country: 'India', shipped_date: '2026-11-02' }, rows: full, invoices: paidInv, invoicePayments: [{ bank_transaction_id: 'x', amount: 100 }], bills: paidBills }, NOW);
check('everything done, invoice paid, both bills paid → eligible', okClose.closure.eligible === true, okClose.closure.missing);
var wired = L.evaluateOrder({ order: { id: 5, status: 'end_stage', country: 'India', shipped_date: '2026-11-02' }, rows: full, invoices: paidInv, invoicePayments: [{ bank_transaction_id: 'x', amount: 100 }], bills: [{ bill_type: 'shipping', total: 500, paid: 0, number: 'F1' }, paidBills[1]] }, NOW);
check('a forwarder bill on a SENT wire but with no posted payment → not eligible', !wired.closure.eligible && wired.closure.missing.some(function (m) { return /forwarder/.test(m); }));
var exw = L.evaluateOrder({ order: { id: 5, status: 'end_stage', country: 'India', shipped_date: '2026-11-02' }, rows: full, invoices: paidInv, invoicePayments: [{ bank_transaction_id: 'x', amount: 100 }], bills: [], exw: true }, NOW);
check('EXW with no shipping by us → no bills needed', exw.closure.eligible === true, exw.closure.missing);
var unpaid = L.evaluateOrder({ order: { id: 5, status: 'end_stage', country: 'India', shipped_date: '2026-11-02' }, rows: full, invoices: [Object.assign({}, paidInv[0], { paid: 400 })], invoicePayments: [{ bank_transaction_id: 'x', amount: 100 }], bills: paidBills }, NOW);
check('customer invoice not fully paid → not eligible', !unpaid.closure.eligible);
var held = L.closureCheck({ status: 'end_stage' }, [], { state: 'current', current: [] }, paidBills, false, [], { kind: 'keep_open', reason: 'dispute with customer', by_name: 'Max' });
check('a person’s "keep open" survives (overnight review respects it)', held.eligible === false && held.held === true);
var forced = L.closureCheck({ status: 'shipped' }, [], { state: 'missing_overdue', current: [] }, [], false, [], { kind: 'force_close', reason: 'written off', by_name: 'Max' });
check('a person’s "close anyway" closes but keeps the open exceptions listed', forced.eligible === true && forced.missing.length > 0);
check('an N/A override on one item counts as N/A, with who and why', item(L.evaluateOrder({ order: { id: 1, status: 'preload', country: 'Egypt' }, rows: base.rows, itemOverrides: [{ item_key: 'acid_number', reason: 'customer handles ACID', by_name: 'Max' }] }, NOW), 'acid_number').status === 'na');

console.log('alert email');
var em = L.alertEmail(L.evaluateOrder({ order: { id: 1733, release_number: '1002-1201', customer_name: 'Example A', country: 'Egypt', status: 'preload' }, rows: { preload: { deposit_amount: '12500' }, shipping_in_process: { load_date: '2026-11-17 09:00:00' } } }, NOW), 'https://hub.ktcus.com/?order=1733');
check('subject names the release; body has customer, time, stage, what is missing and the link', /1002-1201/.test(em.subject) && /Example A/.test(em.text) && /2026-11-17 09:00 New York time/.test(em.text) && /Pre-load Ready/.test(em.text) && /Waiting for deposit/.test(em.text) && /hub\.ktcus\.com/.test(em.html));

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
