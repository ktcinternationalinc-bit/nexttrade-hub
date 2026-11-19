// v55.83-UZ (Codex QA 19 Nov 07:36, P2): foam is decided by the LINE (its product name + description) and by nothing a person can
// rename. "No Foam" always wins. Renaming / merging / un-merging a product group never changes pounds, inbound, shipping split or
// cost. One rule for Profitability, the Sales Report and the supplier-cost conversion. Runs the REAL engine and the REAL route.
var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/profitability.js'));
var A = require(path.join(root, 'src/lib/profitability-assemble.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 900))); }
console.log('UZ — foam is decided by the line, never by the group label');

// ── Codex's reproduction: 1,000 yd of "Face Goods- No Foam" on 1002-9001
function one(groupName) {
  return P.buildCells({ invoices: [{ id: 'i', number: 'i', date: '2026-11-01', customer: 'C', basis: 'EXW', releases: ['1002-9001'], lines: [{ id: 'l', description: 'Face Goods- No Foam', qty: 1000, unit: 'yd', unit_price: 1 }] }],
    groupOf: groupName ? function () { return { id: 'g1', name: groupName }; } : null }).cells[0];
}
var u = one(null), g1 = one('Face Goods'), g2 = one('Foam and non-foam materials'), g3 = one('FOAM');
check('"Face Goods- No Foam", ungrouped → 2,500 lb, inbound $50', u.pounds === 2500 && u.inbound_allowance === 50, u);
check('same line grouped as "Face Goods" → 2,500 lb, inbound $50', g1.pounds === 2500 && g1.inbound_allowance === 50);
check('same line grouped as "Foam and non-foam materials" → STILL 2,500 lb, inbound $50 (was 3,000 / $60)', g2.pounds === 2500 && g2.inbound_allowance === 50 && g2.foam === false, g2);
check('same line grouped as "FOAM" → still 2,500 lb', g3.pounds === 2500 && g3.unit_factor === 2.5, g3);
function plain(groupName) { return P.buildCells({ invoices: [{ id: 'i', number: 'i', date: '2026-11-01', customer: 'C', basis: 'EXW', releases: ['1002-9001'], lines: [{ id: 'l', description: 'FL-220 Grey', qty: 1000, unit: 'yd', unit_price: 1 }] }], groupOf: function () { return { id: 'g1', name: groupName }; } }).cells[0]; }
check('a line that does not say foam, in a group called "Foam Laminated" → 2,500 lb (the label does not make it foam)', plain('Foam Laminated').pounds === 2500 && plain('Foam Laminated').foam === false);

// ── the one rule
check('isFoamLine: product name OR description says foam', P.isFoamLine('Foam laminated PVC', 'grey') && P.isFoamLine('Laminated Fabric', 'with FOAM backing 3mm') && !P.isFoamLine('Velvet', 'blue') && !P.isFoamLine(null, null));
check('"No Foam" in EITHER text wins over foam in the other', !P.isFoamLine('Face Goods- No Foam', 'foam grade A') && !P.isFoamLine('Foam vinyl', 'supplied WITHOUT foam') && !P.isFoamLine('PVC w/o foam', '') && !P.isFoamLine('Non-foam vinyl', 'foam'));
check('that disagreement is reported (conflict), a clean line is not', P.foamEvidenceConflict('Face Goods- No Foam', 'foam grade A') && P.foamEvidenceConflict('Foam vinyl', 'without foam') && !P.foamEvidenceConflict('Face Goods- No Foam', 'grey') && !P.foamEvidenceConflict('Foam vinyl', 'grey'));
check('saysNoFoam can be asked twice in a row (no leftover state)', P.saysNoFoam('No Foam') && P.saysNoFoam('No Foam') && !P.saysNoFoam('Foam') && P.saysNoFoam('no foam'));
check('only YARDS become 3: linear metres, pounds, kilos, tons are unchanged', (function () { var f = P.foamFactors({ units: { lb: 1, kg: 2.20462, t: 2204.62, yd: 2.5, lm: 2.5 } }).units; return f.yd === 3 && f.lm === 2.5 && f.lb === 1 && f.kg === 2.20462 && f.t === 2204.62; })());

// ── the whole report: rename / merge / un-merge leaves every number alone
function report(groups, groupNames) {
  return A.assembleProfitability({ date_from: '', date_to: '', windowDays: 90, warehouseOn: false, customerNames: { c: 'C' }, warehouseRows: [],
    invoices: [{ id: 'i1', invoice_number: 'INV 1', accounting_customer_id: 'c', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1002-9001' },
               { id: 'i2', invoice_number: 'INV 2', accounting_customer_id: 'c', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1002-9001' },
               { id: 'i3', invoice_number: 'INV 3', accounting_customer_id: 'c', invoice_date: '2026-11-01', record_status: 'active', currency: 'USD', release_number: '1002-9001' }],
    items: [{ id: 'l1', invoice_id: 'i1', wave_product_name: 'Foam Laminated PVC', description: 'grey', quantity: 1000, unit_price: 2 },
            { id: 'l2', invoice_id: 'i2', wave_product_name: 'Face Goods- No Foam', description: 'beige', quantity: 1000, unit_price: 2 },
            { id: 'l3', invoice_id: 'i3', wave_product_name: 'Face Goods- No Foam', description: 'foam grade A', quantity: 1000, unit_price: 2 }],
    terms: [{ invoice_id: 'i1', shipping_terms: 'EXW' }, { invoice_id: 'i2', shipping_terms: 'EXW' }, { invoice_id: 'i3', shipping_terms: 'EXW' }],
    nameUnits: [{ name_key: 'foam laminated pvc', unit: 'yd' }, { name_key: 'face goods no foam', unit: 'yd' }],
    groups: groups, groupNames: groupNames,
    bills: [{ id: 'b1', bill_number: 'TR-1', vendor_name: 'Trucker', bill_type: 'trucking', shipment_direction: 'outbound', release_number: '1002-9001', total_amount: 1600, record_status: 'active', bill_date: '2026-10-30' },
            { id: 'b2', bill_number: 'P-1', vendor_name: 'Mill', bill_type: 'goods', release_number: '', total_amount: 6000, record_status: 'active', bill_date: '2026-10-01' }],
    billLines: [{ id: 'bl1', bill_id: 'b2', line_kind: 'item', description: 'Vinyl roll', qty: 6000, unit: 'yd', amount: 6000 }] });
}
function snap(r) { return r.by_invoice.map(function (x) { return [x.label, x.pounds, x.inbound_allowance, x.outbound_cost, x.base_cost]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); }
var bill = function (g) { return { group_id: g, source: 'bill', name_key: 'vinyl roll', raw_name: 'Vinyl roll', active: true }; };
var nm = function (g, k, raw) { return { group_id: g, source: 'invoice', name_key: k, raw_name: raw, active: true }; };
var G = function (id, name, at) { return { id: id, display_name: name, active: true, created_at: at }; };
var merged = report([G('g1', 'Vinyl', '2026-01-01')], [nm('g1', 'foam laminated pvc', 'Foam Laminated PVC'), nm('g1', 'face goods no foam', 'Face Goods- No Foam'), bill('g1')]);
var renamed = report([G('g1', 'Foam and non-foam materials', '2026-01-01')], [nm('g1', 'foam laminated pvc', 'Foam Laminated PVC'), nm('g1', 'face goods no foam', 'Face Goods- No Foam'), bill('g1')]);
var renamed2 = report([G('g1', 'FOAM', '2026-01-01')], [nm('g1', 'foam laminated pvc', 'Foam Laminated PVC'), nm('g1', 'face goods no foam', 'Face Goods- No Foam'), bill('g1')]);
var split = report([G('g1', 'Foam', '2026-01-01'), G('g2', 'Face goods', '2026-01-02')], [nm('g1', 'foam laminated pvc', 'Foam Laminated PVC'), bill('g1'), nm('g2', 'face goods no foam', 'Face Goods- No Foam'), bill('g2')]);
var sameName = report([G('g1', 'Foam', '2026-01-01'), G('g2', 'FOAM', '2026-01-02')], [nm('g1', 'foam laminated pvc', 'Foam Laminated PVC'), bill('g1'), nm('g2', 'face goods no foam', 'Face Goods- No Foam'), bill('g2')]); // same-name groups are one product (TB)
var s0 = snap(merged);
check('one group "Vinyl": foam line 3,000 lb, both "No Foam" lines 2,500 lb; inbound 60 / 50 / 50; trucking 1,600 split 600 / 500 / 500', JSON.stringify(s0.map(function (x) { return x.slice(0, 4); })) === JSON.stringify([['INV 1', 3000, 60, 600], ['INV 2', 2500, 50, 500], ['INV 3', 2500, 50, 500]]), s0);
check('supplier cost $1.00 a yard for all three (1,000 each): foam sale and non-foam sale linked to the same supplier yards', s0.every(function (x) { return x[4] === 1000; }), s0);
check('group RENAMED to "Foam and non-foam materials" → every number identical', JSON.stringify(snap(renamed)) === JSON.stringify(s0), snap(renamed));
check('group RENAMED to "FOAM" → every number identical', JSON.stringify(snap(renamed2)) === JSON.stringify(s0), snap(renamed2));
check('UN-MERGED into two groups → every number identical', JSON.stringify(snap(split)) === JSON.stringify(s0), snap(split));
check('two groups with the same name (merged by name) → every number identical', JSON.stringify(snap(sameName)) === JSON.stringify(s0), snap(sameName));
check('no groups at all → pounds, inbound and shipping split identical (cost needs a link)', JSON.stringify(snap(report([], [])).map(function (x) { return x.slice(0, 4); })) === JSON.stringify(s0.map(function (x) { return x.slice(0, 4); })));
check('the line that says "No Foam" in its name and foam in its description is flagged for a person', merged.flags.filter(function (f) { return f.kind === 'foam_evidence_conflict'; }).length === 1 && merged.flags.filter(function (f) { return f.kind === 'foam_evidence_conflict'; })[0].invoice === 'INV 3', merged.flags);
check('totals reconcile in every arrangement', [merged, renamed, split, sameName].every(function (r) { return r.reconciled.product && r.reconciled.customer && r.reconciled.invoice; }));

// ── the Sales Report and the screen use the same rule
var sr = fs.readFileSync(path.join(root, 'src/app/api/accounting/sales-report/route.js'), 'utf8');
check('Sales Report: isFoamLine(product name, description) — no group name in the decision', sr.indexOf('var isFoam = isFoamLine(it.wave_product_name, it.description);') > 0 && !/isFoamName\(gName/.test(sr) && /import \{[^}]*isFoamLine[^}]*foamFactors[^}]*\} from/.test(sr));
var eng = fs.readFileSync(path.join(root, 'src/lib/profitability.js'), 'utf8');
check('engine: the group name is not read for foam anywhere', !/isFoam(Name|Line)\(g\.name/.test(eng));
var asm = fs.readFileSync(path.join(root, 'src/lib/profitability-assemble.js'), 'utf8');
check('assemble: line.foam = isFoamLine(product name, description) and imports it (runtime import present)', asm.indexOf('foam: isFoamLine(it.wave_product_name, it.description)') > 0 && /import \{[^}]*isFoamLine, foamEvidenceConflict, foamFactors[^}]*\} from '.\/profitability'/.test(asm));
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('the screen has plain words for the new flag', tab.indexOf('foam_evidence_conflict:') > 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
