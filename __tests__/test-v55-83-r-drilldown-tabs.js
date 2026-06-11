// v55.83-R — tabbed product drill-down + click-to-open.
const fs = require('fs');
const p = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } };
const ov = p('src/components/InventoryOverview.jsx');

// tab state + reset
ok(/var \[historyTab, setHistoryTab\] = useState\('summary'\)/.test(ov), 'historyTab state present');
ok(/setHistoryProduct\(product\);\s*\n\s*setHistoryTab\('summary'\)/.test(ov), 'openHistory resets to summary tab');

// tab bar with three tabs + live counts
ok(/k: 'summary', label: 'Summary'/.test(ov), 'Summary tab defined');
ok(/k: 'inbound', label: 'Inbound Orders \(' \+ historyReceipts\.length/.test(ov), 'Inbound Orders tab with count');
ok(/k: 'sales', label: 'Sales \(' \+ historyMovements\.length/.test(ov), 'Sales tab with count');
ok(/onClick=\{function \(\) \{ setHistoryTab\(t\.k\); \}\}/.test(ov), 'tab buttons switch historyTab');

// sections gated by tab
ok(/\{historyTab === 'summary' && \(function \(\) \{/.test(ov), 'summary section gated to summary tab');
ok(/\{historyTab === 'summary' && historyIntakeByCountry\.length > 0/.test(ov), 'intake gated to summary tab');
ok(/\{historyTab === 'inbound' && \(\s*\n\s*<div>/.test(ov), 'inbound section gated to inbound tab');
ok(/\{historyTab === 'sales' && \(\s*\n\s*<div>/.test(ov), 'sales section gated to sales tab');

// click-to-open discoverability
ok(/<td onClick=\{function \(\) \{ openHistory\(p\); \}\}[^>]*cursor-pointer/.test(ov), 'product code cell opens drill-down');
ok(/<div onClick=\{function \(\) \{ openHistory\(p\); \}\}[^>]*font-bold text-white text-\[13px\] cursor-pointer/.test(ov), 'product name opens drill-down');
ok(/Inbound &amp; sales/.test(ov), 'History link upgraded to a labelled button');
ok(/bg-indigo-500\/15 hover:bg-indigo-500\/30 border border-indigo-500\/40/.test(ov), 'drill-down button is a real bordered button');

// no leftover light footer
ok(!/bg-slate-50 rounded-b-2xl/.test(ov), 'modal footer no longer light');

// version
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')), 'page.jsx has a v55.83 build stamp');
ok(/version: 'v55\.83-R'/.test(p('src/components/WhatsNewWidget.jsx')), 'WhatsNew has the v55.83-R entry');

console.log('\nv55.83-R drill-down tabs: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL PASS');
