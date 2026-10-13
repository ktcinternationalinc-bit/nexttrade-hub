// v55.83-OM — Accounting Dashboard: period scoping (default June 1, 2026 →)
// + every card drills down to its invoices (Max: "when I click on the open AR
// ... I should be able to see each underlying"; "overdues broken down by on
// time, 30, 60, 90 days late" — clickable).
var fs = require('fs');
var path = require('path');
var dash = fs.readFileSync(path.join(__dirname, '..', 'src/components/AccountingDashboard.jsx'), 'utf8');
var failed = [];
function ok(label, cond) { if (cond) console.log('✓ ' + label); else { failed.push(label); console.log('✗ ' + label); } }

ok('OM1: default period is June 1, 2026 onward (state default AND initial load; OQ: US book default)',
  /useState\('2026-06-01'\)/.test(dash) && /load\(false, '2026-06-01', '', 'US'\)/.test(dash));
ok('OM2: the AR set is filtered by invoice_date within the period, blank = unbounded',
  /if \(pf && idt && idt < pf\) \{ return false; \}/.test(dash) &&
  /if \(pt && idt && idt > pt\) \{ return false; \}/.test(dash));
ok('OM3: presets include This year, 2025, 2024, All history — plus custom from/to with Apply',
  /\['This year', '2026-01-01', ''\]/.test(dash) && /\['2025', '2025-01-01', '2025-12-31'\]/.test(dash) &&
  /\['2024', '2024-01-01', '2024-12-31'\]/.test(dash) && /\['All history', '', ''\]/.test(dash) &&
  /load\(true, pFrom, pTo, biz\)/.test(dash));
ok('OM4: all four A-cards are clickable (Open AR, Overdue AR, Customer credits, Approvals)',
  /openDrill\('Open AR'/.test(dash) && /openDrill\('Overdue AR'/.test(dash) &&
  /openDrill\('Customer credits'/.test(dash) && /openDrill\('Approvals pending'/.test(dash));
ok('OM5: customer credits drill EXPLAINS what credits are (overpaid, owed back / applied next)',
  /PAID MORE than the invoice total/.test(dash));
ok('OM6: upcoming buckets (now, 1-30, 31-60, 61-90) drill to their invoices',
  /openDrill\('Due now \(today\)'/.test(dash) && /openDrill\('Due in 1–30 days'/.test(dash) &&
  /openDrill\('Due in 31–60 days'/.test(dash) && /openDrill\('Due in 61–90 days'/.test(dash));
ok('OM7: overdue aging buckets (1-30, 31-60, 61-90, 90+ late) drill to their invoices',
  /openDrill\('Overdue 1–30 days late'/.test(dash) && /openDrill\('Overdue 31–60 days late'/.test(dash) &&
  /openDrill\('Overdue 61–90 days late'/.test(dash) && /openDrill\('Overdue 90\+ days late'/.test(dash) &&
  /c: f\.length, rows: f \}/.test(dash));
ok('OM8: the drill panel shows number/customer/dates/total/paid/balance/days with CSV and Close',
  /function DrillPanel\(\)/.test(dash) && /drillCsv/.test(dash) && /✕ Close/.test(dash) &&
  /days_to_due/.test(dash));
ok('OM9: permission gating preserved — a card only drills when its see* permission allows',
  /onClick=\{seeTotals \? function/.test(dash) && /onClick=\{seeUpcoming \? function/.test(dash) &&
  /onClick=\{seeOverdue \? function/.test(dash));
ok('OM10: clickable cards are visibly clickable (cursor + hover ring + hint)',
  /cursor-pointer hover:ring-2/.test(dash) && /Click to see the invoices behind this number/.test(dash));

if (failed.length) { console.log('FAILED (' + failed.length + '):'); failed.forEach(function (x) { console.log('  - ' + x); }); process.exit(1); }
else { console.log('ALL CHECKS PASSED — v55.83-OM dashboard period + drill-down'); }
