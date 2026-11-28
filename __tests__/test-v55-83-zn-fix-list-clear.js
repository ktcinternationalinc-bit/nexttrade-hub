// v55.83-ZN — Profitability → P&L by period → "Lines to fix" (Max, 26 Nov, June 2026 screenshot: "what is 3 and 4 … message are not
// clear … a button to take you to the exact place … with direction and then a back button … and it updates correctly on this blotter").
// Runs the REAL openTasks on made-up lines shaped like the live case (invoice America 1747: one goods line "STOCK PVC ROLLS BY KGs" with
// no unit, plus a shipping charge) and every other kind of row; then checks the screen wiring in the real component sources.
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var P = require(path.join(root, 'src/lib/pnl-period.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }
console.log('ZN — the fix list: one plain what + what-to-do, one button to the exact place, the way back');
function cell(o) { return Object.assign({ invoice_date: '2026-06-10', release: '1002-1158', pounds: 1000, base_cost: 100, transport_revenue: 0, trucking_cost: 10, freight_cost: 10, goods_revenue: 500, goods_profit: 1, transport_profit: 1, profit: 2, flags: [] }, o); }

// 1) the live case: #3 and #4 of Max's screenshot
var kg = cell({ invoice: 'America 1747', invoice_id: 'i1747', description: 'STOCK PVC ROLLS BY KGs', product: 'STOCK PVC ROLLS BY KGs', pounds: null, base_cost: null, transport_revenue: null, goods_revenue: null, goods_profit: null, transport_profit: null, profit: null, flags: ['unit_unknown', 'allocation_unresolved_missing_weight'] });
var other = cell({ invoice: 'B2', invoice_id: 'iB2', description: 'Foam', product: 'Foam', trucking_cost: null, release: '1002-2000', transport_profit: null, profit: null });
var o = P.openTasks([other, kg], false, {});
function T(k) { return o.tasks.filter(function (t) { return t.key === k; })[0]; }
var unit = T('pounds:STOCK PVC ROLLS BY KGs'); var terms = T('terms:America 1747');
check('every row has ONE sentence of what is wrong, ONE of what to do, and ONE place to fix it', o.tasks.every(function (t) { return t.what && t.todo && (t.fix || t.kind === 'trucking' || t.kind === 'freight') && t.how === t.what + ' ' + t.todo; }), o.tasks.map(function (t) { return [t.key, !!t.what, !!t.todo, !!t.fix]; }));
check('no row says "either … or" any more', !o.tasks.some(function (t) { return /\bEither\b|\beither\b/.test(t.how); }));
check('#3 (no weight): says the description has no unit and why that matters, in plain words', unit && /“STOCK PVC ROLLS BY KGs” has no unit, so the Hub cannot work out its weight or profit\./.test(unit.what), unit && unit.what);
check('…the name says the unit ("BY KGs") → it proposes kilos as ONE click ("Yes, kilos")', unit.suggest && unit.suggest.unit === 'kg' && unit.suggest.name === 'STOCK PVC ROLLS BY KGs' && /click “Yes, kilos”/.test(unit.todo), unit.suggest);
check('…its button opens the unit box of THAT description in Set-up, with a line of direction for there', unit.fix.go === 'unit' && unit.fix.name === 'STOCK PVC ROLLS BY KGs' && /Pick what “STOCK PVC ROLLS BY KGs” is sold in from the highlighted box/.test(unit.fix.direction), unit.fix);
var nUnit = o.tasks.indexOf(unit) + 1;
check('#4 (shipping charged on America 1747): worked out — it is because of THAT line with no unit (not "either the terms or…")', terms && /Invoice America 1747 charges shipping, but it cannot be shared between its goods lines because “STOCK PVC ROLLS BY KGs” has no unit/.test(terms.what), terms && terms.what);
check('…what to do points to the other row by its number, says it clears by itself, and that the invoice needs nothing', new RegExp('Give “STOCK PVC ROLLS BY KGs” its unit \\(number ' + nUnit + ' in this list\\) — this row then clears by itself\\. Nothing needs changing on the invoice\\.').test(terms.todo) && terms.after === nUnit, terms.todo);
check('…and its one button goes to the SAME unit box (not to the invoice), with the same one-click proposal', terms.fix.go === 'unit' && terms.fix.name === 'STOCK PVC ROLLS BY KGs' && terms.suggest && terms.suggest.unit === 'kg');
// fixed → both rows leave the list
var kgFixed = Object.assign({}, kg, { pounds: 50677.6, base_cost: 9000, transport_revenue: 5250, goods_revenue: 22757.13, goods_profit: 100, transport_profit: 10, profit: 110, flags: [] });
var o2 = P.openTasks([other, kgFixed], false, {});
check('AFTER the unit is set (report reloaded): #3 and #4 are both gone, the other row stays', !o2.tasks.some(function (t) { return /America 1747|STOCK PVC/.test(t.key); }) && o2.tasks.length === 1, o2.tasks.map(function (t) { return t.key; }));

// 2) the terms row when every line HAS its weight: then it is the invoice's terms, and the button opens the invoice
var o3 = P.openTasks([cell({ invoice: 'C3', invoice_id: 'iC3', description: 'Foam', product: 'Foam', transport_revenue: null, transport_profit: null, profit: null })], false, {});
var t3 = o3.tasks[0];
check('terms row with every weight known: one case — check the shipping terms — and the button opens THAT invoice with a direction', t3.kind === 'transport_revenue' && /The shipping charged on invoice C3 cannot be worked out\./.test(t3.what) && /shipping terms \(EXW \/ CNF\)/.test(t3.todo) && t3.fix.go === 'invoice' && t3.fix.invoice_id === 'iC3' && t3.fix.direction.length > 10, t3);

// 3) every other kind of row
var all = P.openTasks([
  cell({ invoice: 'D4', invoice_id: 'iD4', description: 'Foam', product: 'Foam', release: '', release_raw: '', trucking_cost: null, freight_cost: null, transport_profit: null, profit: null }),
  cell({ invoice: 'E5', invoice_id: 'iE5', description: 'Plain PVC', product: 'Plain PVC', group_id: 'g1', base_cost: null, goods_profit: null, profit: null }),
  cell({ invoice: 'F6', invoice_id: 'iF6', description: 'Loose cloth', product: 'Loose cloth', base_cost: null, goods_profit: null, profit: null }),
  cell({ invoice: 'G7', invoice_id: 'iG7', description: 'Foam', product: 'Foam', release: '', release_raw: '', trucking_cost: null, freight_cost: null, transport_profit: null, profit: null, flags: ['release_split_missing'], releases_on_invoice: 2 }),
  cell({ invoice: 'H8', invoice_id: 'iH8', description: 'Rolls', product: 'Rolls', release: '1002-3000', freight_cost: null, transport_profit: null, profit: null })
], false, {});
function A(k) { return all.tasks.filter(function (t) { return t.key === k; })[0]; }
check('no release number: says so, says what to do, button opens the invoice', /Invoice D4 has no release number/.test(A('norelease:D4').what) && /Put the release number on the invoice/.test(A('norelease:D4').todo) && A('norelease:D4').fix.go === 'invoice' && A('norelease:D4').fix.invoice_id === 'iD4');
check('no supplier cost (in a product): button opens its supplier-bill link in Set-up, direction names the "Link ticked" button', A('base_cost:Plain PVC').fix.go === 'link' && A('base_cost:Plain PVC').fix.group_id === 'g1' && /Link ticked/.test(A('base_cost:Plain PVC').fix.direction) && /per POUND/.test(A('base_cost:Plain PVC').todo));
check('not under a product yet: button opens the names list filtered to it, direction says how to group it', A('base_cost:Loose cloth').fix.go === 'names' && A('base_cost:Loose cloth').fix.name === 'Loose cloth' && /Save group/.test(A('base_cost:Loose cloth').fix.direction));
check('pounds not divided between releases: plain sentence, button opens its row in By invoice', /Invoice G7 is on 2 releases, and its pounds are not divided between them\./.test(A('relsplit:G7').what) && A('relsplit:G7').fix.go === 'invoice_row' && A('relsplit:G7').fix.invoice === 'G7');
check('no freight cost: what it COSTS US, typed in the row (0 is a figure), and the button opens the invoice to set EXW', /Release 1002-3000 has no freight \/ shipping cost: no bill, no typed figure and no estimate\./.test(A('freight:1002-3000').what) && /Type it here — 0 if there was none/.test(A('freight:1002-3000').todo) && A('freight:1002-3000').fix.go === 'invoice' && /EXW/.test(A('freight:1002-3000').fix.direction));

// 4) the unit read from a name — only when the name says ONE unit
var U = P.unitFromName;
check('unit from the name: KGs→kilos, LBS→pounds, yd→yards, MT→tons; nothing when it names two or none', U('STOCK PVC ROLLS BY KGs') === 'kg' && U('Foam 10 LBS') === 'lb' && U('PVC 54in per yd') === 'yd' && U('2 MT coil') === 't' && U('KG and LB mix') === null && U('Headliner') === null && U('MTX roll') === null, [U('STOCK PVC ROLLS BY KGs'), U('MTX roll')]);
var many = P.openTasks([cell({ invoice: 'J1', description: 'Grey A', product: 'Grey', pounds: null, transport_profit: null, profit: null, goods_profit: null }), cell({ invoice: 'J2', description: 'Grey B', product: 'Grey', pounds: null, transport_profit: null, profit: null, goods_profit: null })], false, {}).tasks.filter(function (t) { return t.kind === 'pounds'; })[0];
check('two descriptions of one product with no unit: one row naming both, no guessed unit, the button lists that product', many && /2 descriptions of “Grey” have no unit/.test(many.what) && many.suggest === null && many.fix.go === 'names' && many.fix.name === 'Grey', many);

// 5) the screen
var tab = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
var acc = fs.readFileSync(path.join(root, 'src/components/AccountingTab.jsx'), 'utf8');
check('SCREEN: each row shows the what, then "What to do:", and its buttons', tab.indexOf("<div className=\"mt-0.5\">{t.what || t.how}</div>") > 0 && tab.indexOf("<b style={{ color: '#92400e' }}>What to do: </b>{t.todo}") > 0 && tab.indexOf('{sugBtn(t)}') > 0 && tab.indexOf('{fixBtn(t)}</span>;') > 0);
check('SCREEN: "✓ Yes, kilos" saves that unit with the existing action and reloads the list', tab.indexOf("act({ action: 'set_name_unit', names: [s0.name], unit: s0.unit }") > 0 && tab.indexOf("'✓ Yes, ' + s0.words") > 0);
check('SCREEN: the fix button goes to the exact place: the unit box (highlighted + cursor), the link, the invoice, its row', tab.indexOf("setNameQ(f.name || ''); setFocusName(f.go === 'unit' ? (f.name || '') : '')") > 0 && tab.indexOf('data-unit-name={n.name}') > 0 && tab.indexOf("if (hit) { markEl(hit); if (hit.focus) { hit.focus({ preventScroll: true }); } }") > 0 && tab.indexOf("if (f.go === 'link') { openSetupFor(f.name, f.group_id); return; }") > 0 && tab.indexOf("editInvoice(f.invoice_id, { backLabel: backWords, note: f.direction || '' })") > 0 && tab.indexOf("var backWords = b.formula ? '“How ' + b.formulaLabel + ' is worked out”' : 'the fix list';") > 0 && tab.indexOf("if (f.go === 'invoice_row') { setSearchQ(String(f.invoice || '')); setView('invoice');") > 0);
check('SCREEN: on that screen a bar says "Fixing: …", the direction, and "← Back to the fix list"', tab.indexOf("{fixFrom && view !== 'period' && <div role=\"status\"") > 0 && tab.indexOf("{'← Back to ' + (fixFrom.formula ? '“How ' + fixFrom.formulaLabel + ' is worked out”' : 'the fix list')}</button>") > 0 && tab.indexOf("'What to do here: ' + fixFrom.direction") > 0);
check('SCREEN: Back returns to the same period opened and lands on the same row (by its key)', tab.indexOf("setView('period'); setPOpen(f.pOpen);") > 0 && tab.indexOf('data-task-key={t.key}') > 0 && tab.indexOf("el.getAttribute('data-task-key') === f.key") > 0);
check('SCREEN: back on the list it says "✓ Fixed … it has left the list" or "⚠ Still open: …" from the reloaded report', tab.indexOf("'✓ Fixed: ' + fixReturned.title + ' — it has left the list.'") > 0 && tab.indexOf("'⚠ Still open: ' + still.title") > 0 && tab.indexOf("st === 'loading' ? 'Checking the list again…'") > 0);
check('SCREEN: picking another view from the strip forgets the way back (no stale bar)', (tab.match(/setView\(v\[0\]\); setOpen\(null\); setFixFrom\(null\); setFixReturned\(null\);/g) || []).length === 2);
check('ACCOUNTING: Profitability stays alive while the invoice is edited; Back says "the fix list" and shows the direction', acc.indexOf("{alive('profitability') && <div className=\"p-3\" style={shown('profitability')}><ProfitabilityTab {...props} onGo={goFrom} /></div>}") > 0 && acc.indexOf("← Back to {back.label || labelOfSub(tabs, back.sub)}") > 0 && acc.indexOf("'What to do here: ' + back.note") > 0 && acc.indexOf("setBack({ sub: sub, y: y0, label: (opts && opts.backLabel) || '', note: (opts && opts.note) || '' })") > 0);
check('…and on that Back the report reloads (the invoice may have changed) and lands on the row', tab.indexOf("if (!ev || !ev.detail || ev.detail.sub !== 'profitability' || !fixFrom) { return; } backToFixList(); /* ZN rev2: backToFixList reloads once itself */") > 0 && acc.indexOf("window.dispatchEvent(new CustomEvent('nt-acct-returned', { detail: { sub: b0.sub } }))") > 0);

// 6) the "How Jun 2026 is worked out" pop-up (Max, 26 Nov: "these orange buttons have no real use especially the last one")
var React = require('react'); global.React = React; var RS = require('react-dom/server');
var D = require(path.join(root, 'src/lib/pnl-expense-detail.js'));
var PnlFormula = require(path.join(root, 'src/components/PnlFormula.jsx')).default;
// 25 goods lines with no cost (5 products: 2 need a unit, 3 need a supplier cost) + ONE line with no shipping cost and $0 charged
var gl = []; for (var gi = 0; gi < 25; gi++) { var pr = 'Prod ' + (gi % 5); gl.push(cell({ invoice: 'G' + gi, invoice_id: 'ig' + gi, description: pr, product: pr, group_id: gi % 5 >= 2 ? 'g' + (gi % 5) : null, pounds: gi % 5 < 2 ? null : 100, base_cost: null, goods_profit: null, profit: null, transport_revenue: gi % 5 < 2 ? 0 : 0 })); }
var tl = cell({ invoice: 'T1', invoice_id: 'it1', description: 'Rolls', product: 'Rolls', release: '1002-7777', trucking_cost: null, transport_revenue: 0, transport_profit: null, profit: null });
var pc = gl.concat([tl]);
var pot = P.openTasks(pc, false, {}); var ff = P.formulaFixes(pc, pot);
check('POP-UP data: the goods side counts the same 25 lines as the pop-up and says what fixing means, by kind', ff.goods.count === 25 + 0 && ff.goods.means === 'Fixing means: give 2 products a unit; link a supplier bill or type a cost for 3 products.' && ff.goods.lines.length === 0, ff.goods.means);
check('POP-UP data: the ONE transport line is listed right there: invoice, release, product, what is missing, and its own row of the fix list', ff.transport.count >= 1 && ff.transport.lines.some(function (l) { return l.invoice === 'T1' && l.release === '1002-7777' && /No trucking cost/.test(l.missing) && l.task && l.task.kind === 'trucking' && l.n > 0; }), ff.transport);
var row = P.blankPeriodRow('2026-06', 'Jun 2026'); pc.forEach(function (c) { P.addPeriodCell(row, c); }); P.settlePeriodRow(row);
var fo = D.pnlFormula(row, { status: 'ok', cols: { A: { cents: 0, cats: [] }, C: { cents: 0, cats: [] }, D: { cents: 0, cats: [] }, E: { cents: 0, cats: [] }, unassigned: { cents: 0, cats: [] }, in_profit: { cents: 18784494, cats: [] }, total: 0, held: { cents: 0 } }, detail: null }, false);
var html = RS.renderToStaticMarkup(React.createElement(PnlFormula, { title: 'Jun 2026', formula: fo, onShowOpen: function () {}, onFix: function () {}, fixesFor: function (sd) { return ff[sd]; } }));
check('POP-UP: the goods button names the action and the count — "Fix 25 lines with no cost →" — with the one line of what fixing means under it', html.indexOf('Fix 25 lines with no cost →') > 0 && html.indexOf('Fixing means: give 2 products a unit; link a supplier bill or type a cost for 3 products.') > 0);
check('POP-UP: the old "Show these lines and fix them →" button is gone', html.indexOf('Show these lines and fix them') < 0);
check('POP-UP: the transport row shows its one line (invoice T1 · release 1002-7777 · what is missing) and a button to type it in the fix list', html.indexOf('Invoice T1') > 0 && html.indexOf('release 1002-7777') > 0 && /Type it in the fix list \(number \d+\) →/.test(html));
var html0 = RS.renderToStaticMarkup(React.createElement(PnlFormula, { title: 'Jun 2026', formula: fo, onShowOpen: function () {}, fixesFor: function () { return { count: 1, tasks: [], means: '', lines: [] }; } }));
check('POP-UP: a row with nothing to fix gets NO button, just "Nothing to fix here."', html0.indexOf('Nothing to fix here.') > 0 && html0.indexOf('with no cost →') < 0);
check('POP-UP: shipment payments explain the category exclusion, verification at the sale or release, and how to correct a category', html.includes('These categories are excluded from the operating expense columns.') && html.includes('the sale or release to verify an individual cost') && html.includes('open it and change its category'));
var tab2 = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
check('POP-UP wiring: its fix opens the exact place and comes BACK to the pop-up; opening the list from it shows "← Back to “How … is worked out”"', tab2.indexOf("goPlace(t, { pOpen: fr.key, formula: fr.key, formulaLabel: fr.label })") > 0 && tab2.indexOf("if (f.formula) { setFShow({ key: f.formula, pinned: true }); }") > 0 && tab2.indexOf("'← Back to “How ' + fromFormula.label + ' is worked out”'") > 0 && tab2.indexOf("return formulaFixes(fc, openTasks(fc, revH ? false : hidden, { revenueHidden: revH }))[side];") > 0);
// after the fix the counts drop by themselves: the pop-up is worked out from the reloaded report
var pc2 = pc.map(function (c) { return c.invoice === 'T1' ? Object.assign({}, c, { trucking_cost: 0, transport_profit: 0, profit: 1 }) : c; });
var row2 = P.blankPeriodRow('2026-06', 'Jun 2026'); pc2.forEach(function (c) { P.addPeriodCell(row2, c); }); P.settlePeriodRow(row2);
var fo2 = D.pnlFormula(row2, null, false);
check('AFTER the trucking is typed (report reloaded): the transport row leaves NOT USED by itself; the goods row still says 25', !fo2.not_used.some(function (x) { return x.side === 'transport'; }) && fo2.not_used.filter(function (x) { return x.side === 'goods'; })[0].count === 25, fo2.not_used.map(function (x) { return x.label; }));

// 7) rev2 (Codex 26 Nov HOLD): the LAST issue of a period, and a reload that fails
var RV = P.returnVerdict;
var ret = { key: 'pounds:STOCK PVC ROLLS BY KGs', title: 'STOCK PVC ROLLS BY KGs — no weight', seq: 5 };
var after = P.openTasks([kgFixed], false, {}).tasks; // America 1747 fixed, and it was the only issue in the period
check('REV2 last issue: the reload finished OK and the period has NO issue left → "fixed", and "nothing left" is known', after.length === 0 && RV(ret, { seq: 5, state: 'ok' }, after).state === 'fixed' && RV(ret, { seq: 5, state: 'ok' }, after).none_left === true);
check('REV2 refresh error: the reload made on the way back FAILED → "failed" (retry), never Fixed or Still open, even though the old list would say still open', RV(ret, { seq: 5, state: 'failed', error: 'The report did not load.' }, o.tasks).state === 'failed' && RV(ret, { seq: 5, state: 'failed', error: 'x' }, o.tasks).still === null && RV(ret, { seq: 5, state: 'failed', error: 'The report did not load.' }, o.tasks).error === 'The report did not load.');
check('REV2: while that reload runs, or when only an OLDER load is known (e.g. the save’s own), it says "checking", not a verdict', RV(ret, { seq: 5, state: 'loading' }, after).state === 'loading' && RV(ret, { seq: 4, state: 'ok' }, after).state === 'loading' && RV(ret, { seq: 4, state: 'ok' }, o.tasks).state === 'loading');
check('REV2: a later successful reload counts (seq 6 ≥ 5); still open is only said from it', RV(ret, { seq: 6, state: 'ok' }, o.tasks).state === 'still_open' && RV(ret, { seq: 6, state: 'ok' }, o.tasks).still.key === ret.key);
var tab3 = fs.readFileSync(path.join(root, 'src/components/ProfitabilityTab.jsx'), 'utf8');
var bxA = tab3.indexOf('var fixBox = fx.rows.length === 0 ? null :'); var bxB = tab3.indexOf('      return <div>', bxA); var retAt = tab3.indexOf("{fixReturned && (function () {", bxB); var boxAt = tab3.indexOf('        {fixBox}', bxB);
check('REV2 last issue (screen): the Fixed / Still open note and the Back-to-pop-up button are OUTSIDE the fix box (rendered before {fixBox} in the period, not in it), so they stay when the box is gone', bxA > 0 && bxB > bxA && tab3.substring(bxA, bxB).indexOf('fixReturned') < 0 && tab3.substring(bxA, bxB).indexOf('fromFormula') < 0 && retAt > bxB && retAt < boxAt && tab3.indexOf("{fromFormula && fromFormula.key === r.key && <div", bxB) < boxAt);
check('REV2 (screen): load() is numbered and records ok / failed; the way back reloads once and waits for THAT load; a failure shows "Try again", which reloads', tab3.indexOf('return runReportLoad({ seqRef: loadSeq, call: call, setRefresh: setRefresh') > 0 /* v55.83-ZQ: the numbered load lives in src/lib/report-load.js (tested in test-v55-83-zq-load-order.js) */ && tab3.indexOf("setFixReturned({ key: f.key, title: f.title, seq: loadSeq.current + 1 }); load(applied.from, applied.to);") > 0 && tab3.indexOf("var vd = returnVerdict(fixReturned, refresh, ot.tasks);") > 0 && tab3.indexOf("setFixReturned(Object.assign({}, fixReturned, { seq: loadSeq.current + 1 })); load(applied.from, applied.to); }} className=\"px-2 py-0.5 rounded font-extrabold\" style={{ background: '#1d4ed8', color: '#ffffff' }}>Try again</button>") > 0 && tab3.indexOf('backToFixList(); /* ZN rev2: backToFixList reloads once itself */') > 0);

console.log('\nZN: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
