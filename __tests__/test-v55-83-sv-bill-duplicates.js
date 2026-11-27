// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SV — Max, Nov 15 2026: "14481 - did you not check if there are duplicates ... this is core functionality
// to check for duplicates. How was this missed ... and how to prevent this from happening again! remember 1 trucking
// for each release number allowed. as a rule in addition to looking for similar invoice numbers, dates of invoice or
// date of service or amounts. you need to look at all logically and assess possible duplicates to flag.. and flag
// with a different background color"
// The scan itself is RUN (pure functions). Checks marked (pin) read the source.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var S = require(path.join(root, 'src/lib/bill-dup-scan.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 700))); }
var n = 0;
function bill(x) { n++; return Object.assign({ id: 'b' + n, record_status: 'active', vendor_name: 'Vendor ' + n, bill_number: 'N' + n + '-000', bill_date: '2026-01-01', total_amount: 100 + n }, x); }

console.log('SV — every bill compared with every other bill');

// A. the exact case from the screen: NexPac 14481 twice, one OUT with a release #, one IN with the same code as a reference
var a1 = bill({ vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, bill_type: 'supplier', shipment_direction: 'outbound', release_number: '1001-1567' });
var a2 = bill({ vendor_name: 'NexPac Corporation', bill_number: '14481', bill_date: '2026-06-02', total_amount: 2831, bill_type: 'supplier', shipment_direction: 'inbound', other_reference: '1001-1567' });
var rA = S.scanBills([a1, a2, bill({}), bill({})], {});
check('A1: NexPac 14481 entered twice — BOTH rows are flagged', !!rA.byId[a1.id] && !!rA.byId[a2.id], rA);
check('A2: it is a STRONG flag and says same vendor + same bill #', rA.byId[a1.id].level === 'strong' && /Same vendor and same bill #/.test(rA.byId[a1.id].reasons.join(' ')), rA.byId[a1.id]);
check('A3: each row names the other one', rA.byId[a1.id].others[0] === a2.id && rA.byId[a2.id].others[0] === a1.id);
check('A4: unrelated bills are not flagged', Object.keys(rA.byId).length === 2, Object.keys(rA.byId));

// B. ONE trucking bill per release number — any vendor, any amount, any date
var t1 = bill({ vendor_name: 'Fast Freight LLC', bill_number: 'FF-100', bill_date: '2026-03-01', total_amount: 900, bill_type: 'trucking', release_number: 'REL-7001' });
var t2 = bill({ vendor_name: 'Other Haulage Inc', bill_number: 'OH-555', bill_date: '2026-05-20', total_amount: 1250, bill_type: 'trucking', release_number: 'rel 7001' });
var t3 = bill({ vendor_name: 'Fast Freight LLC', bill_number: 'FF-101', bill_date: '2026-03-02', total_amount: 910, bill_type: 'trucking', release_number: 'REL-7002' });
var s1 = bill({ vendor_name: 'Ocean Line', bill_number: 'OL-9', bill_date: '2026-03-01', total_amount: 3000, bill_type: 'shipping', release_number: 'REL-7001' });
var rB = S.scanBills([t1, t2, t3, s1], {});
check('B1: two trucking bills on one release are flagged STRONG even with different vendors, amounts and dates', rB.byId[t1.id] && rB.byId[t2.id] && rB.byId[t1.id].level === 'strong' && /ONE trucking bill is allowed per release/.test(rB.byId[t1.id].reasons[0]), rB);
check('B2: a trucking bill on a DIFFERENT release is not flagged', !rB.byId[t3.id], rB.byId[t3.id]);
check('B3: a shipping bill on the same release is not a second trucking bill', !rB.byId[s1.id], rB.byId[s1.id]);

// C. similar invoice numbers, dates, amounts
var c1 = bill({ vendor_name: 'Acme Supply Inc.', bill_number: 'INV-20455', bill_date: '2026-04-10', total_amount: 5120.5 });
var c2 = bill({ vendor_name: 'ACME SUPPLY', bill_number: '20455', bill_date: '2026-04-10', total_amount: 5120.5 });
check('C1: INV-20455 vs 20455, same vendor (spelled differently), same amount → STRONG', S.pairVerdict(c1, c2).level === 'strong', S.pairVerdict(c1, c2));
var c3 = bill({ vendor_name: 'Acme Supply', bill_number: '20545', bill_date: '2026-04-12', total_amount: 5120.5 });
check('C2: same vendor, same amount, dated 2 days apart is normal (Max: "can happen and likely to happen") — NOT flagged', S.pairVerdict(c2, c3).level === null, S.pairVerdict(c2, c3));
var c4 = bill({ vendor_name: 'Acme Supply', bill_number: '77001', bill_date: '2026-04-10', total_amount: 5120.5 });
check('C3: same vendor, same amount, SAME date, different number → POSSIBLE only (never refused at save)', S.pairVerdict(c2, c4).level === 'possible', S.pairVerdict(c2, c4));
var j1 = bill({ vendor_name: 'Fast Freight LLC', bill_number: 'FF-300', bill_date: '2026-07-01', total_amount: 900, bill_type: 'trucking', release_number: 'REL-9001' }); var j2 = bill({ vendor_name: 'Fast Freight LLC', bill_number: 'FF-301', bill_date: '2026-07-01', total_amount: 900, bill_type: 'trucking', release_number: 'REL-9002' });
check('C3b: same trucker, same rate, same day, two DIFFERENT releases = two jobs — NOT flagged', S.pairVerdict(j1, j2).level === null, S.pairVerdict(j1, j2));
var c5 = bill({ vendor_name: 'Totally Different Co', bill_number: '20455', bill_date: '2026-09-01', total_amount: 5120.5 });
check('C4: same bill # and amount under another vendor name → STRONG', S.pairVerdict(c2, c5).level === 'strong', S.pairVerdict(c2, c5));
var c6 = bill({ vendor_name: 'Acme Supply', bill_number: '20456', bill_date: '2026-04-25', total_amount: 88 });
check('C5: 20455 vs 20456 with DIFFERENT amounts is the vendor’s next invoice — NOT flagged', S.pairVerdict(c2, c6).level === null, S.pairVerdict(c2, c6));
var c7 = bill({ vendor_name: 'Acme Supply', bill_number: '20456', bill_date: '2026-06-30', total_amount: 5120.5 });
check('C5b: 20455 vs 20456 with the same amount on different dates is the next invoice at a standard rate — NOT flagged', S.pairVerdict(c2, c7).level === null, S.pairVerdict(c2, c7));
var c8 = bill({ vendor_name: 'Acme Supply', bill_number: 'INV-100', bill_date: '2026-04-10', total_amount: 10 }); var c9 = bill({ vendor_name: 'Acme Supply', bill_number: 'INV-1000', bill_date: '2026-04-11', total_amount: 20 });
check('C5c: INV-100 vs INV-1000 are different invoices — NOT flagged', S.pairVerdict(c8, c9).level === null, S.pairVerdict(c8, c9));
var c10 = bill({ vendor_name: 'Acme Supply', bill_number: '0020455', bill_date: '2026-04-20', total_amount: 9 });
check('C5d: 20455 vs 0020455 (leading zeros), same vendor, within a month → flagged', !!S.pairVerdict(c2, c10).level, S.pairVerdict(c2, c10));
var m1 = bill({ vendor_name: 'Landlord LLC', bill_number: 'RENT-JAN', bill_date: '2026-01-01', total_amount: 4000 });
var m2 = bill({ vendor_name: 'Landlord LLC', bill_number: 'RENT-FEB', bill_date: '2026-02-01', total_amount: 4000 });
check('C6: monthly rent (same amount, a month apart, different numbers) is NOT flagged', S.pairVerdict(m1, m2).level === null, S.pairVerdict(m1, m2));
var x1 = bill({ vendor_name: 'Broker A', bill_number: 'BA-1', bill_date: '2026-02-01', total_amount: 640, release_number: 'REL-8100' });
var x2 = bill({ vendor_name: 'Broker B', bill_number: 'BB-9', bill_date: '2026-02-20', total_amount: 640, other_reference: 'REL8100' });
check('C7: same release / reference code and same amount under two vendors → flagged', !!S.pairVerdict(x1, x2).level, S.pairVerdict(x1, x2));

// D. only live bills; a person can say "these are different"; nothing is removed
var v1 = bill({ vendor_name: 'NexPac Corporation', bill_number: '9001', total_amount: 50, record_status: 'void' });
var v2 = bill({ vendor_name: 'NexPac Corporation', bill_number: '9001', total_amount: 50 });
check('D1: a VOID bill is never flagged and never flags another', Object.keys(S.scanBills([v1, v2], {}).byId).length === 0);
var dis = {}; dis[S.pairKey(a1.id, a2.id)] = true;
check('D2: a pair marked "not a duplicate" is no longer flagged', Object.keys(S.scanBills([a1, a2], dis).byId).length === 0);
check('D3: the scan returns flags only — the list of bills is untouched', (function () { var arr = [a1, a2]; S.scanBills(arr, {}); return arr.length === 2 && arr[0] === a1 && !('dup_flag' in a1); })());

// E. the check on SAVE (typed by hand / copied) — this is where 14481 slipped through
var onFile = [a1, t1, c2];
check('E1: typing NexPac 14481 again is caught as STRONG before it is saved', S.checkOne({ vendor_name: 'nexpac corp', bill_number: ' 14481 ', bill_date: '2026-06-02', total_amount: 2831 }, onFile, {}).level === 'strong');
check('E2: a second trucking bill for release REL-7001 is caught as STRONG', S.checkOne({ vendor_name: 'Brand New Trucker', bill_number: 'ZZ-1', bill_date: '2026-08-08', total_amount: 10, bill_type: 'trucking', release_number: 'REL-7001' }, onFile, {}).level === 'strong');
check('E3: editing a bill never compares it with itself', S.checkOne(Object.assign({}, a1), onFile, {}).level === null);
check('E4: a genuinely new bill passes clean', S.checkOne({ vendor_name: 'New Vendor', bill_number: 'NV-1', bill_date: '2026-10-10', total_amount: 123.45 }, onFile, {}).level === null);

// F. scale: 3,000 bills from one vendor finish quickly
(function () {
  var many = []; for (var i = 0; i < 3000; i++) { many.push({ id: 'm' + i, record_status: 'active', vendor_name: 'Big Vendor', bill_number: 'BV-' + (100000 + i * 7), bill_date: '2025-01-01', total_amount: 10 + i }); }
  var t0 = Date.now(); var r = S.scanBills(many, {}); var ms = Date.now() - t0;
  check('F1: 3,000 bills from one vendor scan in under 8 seconds (' + ms + ' ms)', ms < 8000, ms);
  check('F2: distinct numbers, amounts on the same vendor are not flagged just for sharing a vendor', Object.keys(r.byId).length < 3000, Object.keys(r.byId).length);
})();

// G. (pin) it is wired in everywhere it has to be
var route = R('src/app/api/accounting/bills/route.js');
var tab = R('src/components/BillsTab.jsx');
check('G1 (pin): the Bills list runs the scan on every load and sends each flag to the screen', /scanBills\(rows, await loadDupDismissed\(db\)\)/.test(route) && /b\.dup_flag = df/.test(route));
check('G2 (pin): save_bill checks BEFORE saving and refuses a strong duplicate until confirmed', /checkOne\(\{ id: bl\.id \|\| null/.test(route) && /duplicate: true/.test(route) && /confirm_duplicate !== true/.test(route) && route.indexOf('checkOne({ id: bl.id') < route.indexOf("var ins = await db.from('vendor_bills').insert(fields)"));
check('G3 (pin): overriding is written to the audit trail with the reasons', /bill_duplicate_override/.test(route) && /bill_duplicate_dismissed/.test(route));
check('G4 (pin): "not a duplicate" needs a written reason and only ADDS an event (nothing deleted)', /dismiss_bill_dup/.test(route) && /ddReason\.length < 10/.test(route) && /kind: 'dup_dismissed'/.test(route) && !/dismiss_bill_dup[\s\S]{0,1500}\.delete\(/.test(route));
check('G5 (pin): flagged rows get their own background colour (purple), different from late (orange) and normal (white)', /dupStrong \? '#e9d5ff' : '#f3e8ff'/.test(tab) && /'#ffedd5'/.test(tab));
check('G6 (pin): a POSSIBLE DUPLICATES filter with a count, and the reasons shown under the row', /POSSIBLE DUPLICATES \(' \+ dupN \+ '\)'/.test(tab) && /filter === 'duplicates'/.test(tab) && /b\.dup_flag\.reasons\.map/.test(tab));
check('G7 (pin): a refused save shows why next to Save, with "Save anyway"', /saveBillAnyway/.test(tab) && /confirm_duplicate: sendForce/.test(tab) && /dupBlockBox/.test(tab));
check('G8 (pin): a clear Close at the top of the validation panel and of the bill details', /onClick=\{closeV\} title="Close this panel/.test(tab) && /setExpanded\(null\); \}\} title="Close the bill details"/.test(tab));
check("G9 (pin): a bill file that did not upload is said out loud, never silent", /FILE DID NOT UPLOAD/.test(tab) && /fileLost = true/.test(tab));
var wui = R('src/components/WirePackagesPanel.jsx');
check('H1 (pin): Record a past wire offers the companies again ("paid the vendors for us") and opens the request steps with the company picked', /paid the vendors for us/.test(wui) && /onParty=\{startPaidFor\}/.test(wui) && /paidFor: true/.test(wui) && /loadFunding\(kind, name\)/.test(wui.substring(wui.indexOf('function startPaidFor'), wui.indexOf('function startPast()'))));
check('H2 (pin): a company payment still needs two signatures — it never goes through the no-signature past wire', !/function startPaidFor[\s\S]{0,600}record_past_wire/.test(wui) && /Two people sign/.test(wui));
check('H3 (pin): the steps are explained in plain words, including what to do when the transfer is not listed', /How this works — nothing is sent to the bank from here/.test(wui) && /mark that line as sent to/.test(wui) && /Which transfer paid these bills\?/.test(wui));
var lib = R('src/lib/bill-dup-scan.js');
check('G10 (pin): house rules in the new code — var only, no template strings, no pop-ups', !/\b(let|const)\s/.test(lib) && lib.indexOf('`') < 0 && !/window\.(prompt|confirm|alert)/.test(lib) && !/window\.(prompt|confirm|alert)\([^)]*dup/i.test(tab));
var wn = R('src/components/WhatsNewWidget.jsx');
check('G11 (pin): What’s New has v55.83-SV with one technical line; badge at SV or later', /version: 'v55\.83-SV'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-SV'"), wn.indexOf("version: 'v55.83-SU'"))) && />v55\.83-(?:S[V-Z]|[T-Z][A-Z]|AA[A-Z])<\/span>/.test(R('src/app/page.jsx')));

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
// v55.83-UB realign: badge letters now run past T (UA, UB …) — the badge checks accept T–Z
