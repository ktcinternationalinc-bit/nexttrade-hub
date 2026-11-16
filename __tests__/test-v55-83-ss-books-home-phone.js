// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SS — Max, Nov 15 2026 09:45 (phone screenshot of the Books home): "What is going on here. And when I click on cards
// this is what I am seeing" — the rows behind a card showed only Ref and Who (no amounts), and "Due in this period" was a
// long run of dark-red text on the dark page.
// Standing rule: "make it very user-friendly and make the GUI professional looking … keep an eye on the fonts and the
// background colors".
// The grouping is RUN; the screen checks are pins (the screen itself was checked in a phone-width dark-skin screenshot).
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'node_modules/sucrase/register'));
var V = require(path.join(root, 'src/lib/books-home-view.js'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 600))); }

console.log('SS — A. bills due, one line per vendor');
var due = [{ vendor_name: 'NexPac Corporation', open: 8422.17, due_date: '2026-07-02' }, { vendor_name: 'NexPac Corporation', open: 18369.34, due_date: '2026-07-02' }, { vendor_name: 'nexpac  corporation', open: 2019.88, due_date: '2026-07-31' },
  { vendor_name: 'Trinity Logistics', open: 0.1, due_date: '2026-07-12' }, { vendor_name: 'Trinity Logistics', open: 0.2, due_date: null }, { vendor_name: '', open: 5, due_date: '2026-07-01' }];
var g = V.groupBillsDue(due);
check('A1: three vendors instead of six entries; biggest first', g.groups.length === 3 && g.groups[0].vendor === 'NexPac Corporation' && g.groups[0].count === 3, g.groups);
check('A2: the vendor total is exact ($28,811.39) with its first and last due date', g.groups[0].total === 28811.39 && g.groups[0].first_due === '2026-07-02' && g.groups[0].last_due === '2026-07-31', g.groups[0]);
check('A3: cents never drift (0.1 + 0.2 = 0.30) and a bill with no date is still counted', g.groups.filter(function (x) { return x.vendor === 'Trinity Logistics'; })[0].total === 0.3 && g.groups.filter(function (x) { return x.vendor === 'Trinity Logistics'; })[0].count === 2);
check('A4: the grand total and count equal the original list to the cent', g.count === 6 && g.total === Math.round(due.reduce(function (s, b) { return s + Math.round(b.open * 100); }, 0)) / 100, g);
check('A5: a bill with no vendor name is shown as "Unknown vendor", not dropped', g.groups.some(function (x) { return x.vendor === 'Unknown vendor' && x.total === 5; }));
check('A6: an empty list gives nothing', V.groupBillsDue([]).groups.length === 0 && V.groupBillsDue(null).total === 0);

console.log('SS — B. the screen (pins)');
var BH = R('src/components/BooksHomeTab.jsx');
check('B1: on a phone each row behind a card is stacked with the amount always visible; the nine-column table is for wide screens only', /className="md:hidden" style=\{\{ maxHeight: 420/.test(BH) && /className="hidden md:block overflow-x-auto"/.test(BH) && /r7\.sign < 0 \? '−\$' : '\+\$'\) \+ fmt\(r7\.amount\)/.test(BH));
check('B2: tapping a card brings its rows into view (they open below all the cards)', /drillRef\.current\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/.test(BH) && /ref=\{drillRef\}/.test(BH) && /scrollMarginTop: 90/.test(BH));
check('B3: a proper Close button on both drill-downs', (BH.match(/✕ Close<\/button>/g) || []).length === 2 && !/✕ close<\/button>/.test(BH));
check('B3b: the overdue / forecast cards get the same phone layout and scroll', /ref=\{fcRef\}/.test(BH) && /fcRef\.current\.scrollIntoView/.test(BH) && /className="hidden md:table w-full text-\[10px\]"/.test(BH) && (BH.match(/className="md:hidden" style=\{\{ maxHeight: 420/g) || []).length === 2);
check('B4: "bills due" is a white panel with dark text, grouped by vendor, with a way to see every bill — the dark-red run of text is gone', /groupBillsDue\(cf\.bills_due\)/.test(BH) && /background: '#ffffff', border: '1px solid #fdba74', color: '#0f172a'/.test(BH) && /See every bill/.test(BH) && !/<b>Due in this period:<\/b>/.test(BH) && !/className="mt-2 text-\[11px\]" style=\{\{ color: '#431407' \}\}/.test(BH));
check('B5: section headings and "all caught up" carry their own background, so they read in the dark skin', (BH.match(/color: '#0f172a', background: '#e2e8f0', display: 'inline-block'/g) || []).length === 3 && (BH.match(/color: '#065f46', background: '#d1fae5'/g) || []).length >= 1 && !/style=\{\{ color: '#64748b' \}\}>🏦 1 · BANK REALITY/.test(BH));
check('B6: no browser pop-ups', !/window\.(prompt|confirm|alert)\(/.test(BH));
var wn = R('src/components/WhatsNewWidget.jsx');
check('B7: What’s New has v55.83-SS with one technical line', /version: 'v55\.83-SS'/.test(wn) && /superAdminOnly: true/.test(wn.substring(wn.indexOf("version: 'v55.83-SS'"), wn.indexOf("version: 'v55.83-SR'"))));
check('B8: the build badge is at v55.83-SS or later (v55.83-ST realign)', />v55\.83-(?:S[S-Z]|T[A-Z])<\/span>/.test(R('src/app/page.jsx')));
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
