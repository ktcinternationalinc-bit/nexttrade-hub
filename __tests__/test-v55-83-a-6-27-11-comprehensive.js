// v55.83-A.6.27.11 — comprehensive test for this session's fixes

var fs = require('fs');
var path = require('path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pd = read('src/components/PersonalDashboard.jsx');
var ab = read('src/components/AssistantsBar.jsx');
var pbc = read('src/components/PendingBankConfirmationsWidget.jsx');
var srt = read('src/components/ShippingRatesTab.jsx');
var sm = read('src/components/ShipmentsManager.jsx');
var ag = read('src/components/AIGreeter.jsx');
var nfo = read('src/components/NadiaFloatingOverlay.jsx');
var stp = read('src/components/SystemTicketsPanel.jsx');
var adj = read('src/components/AdjustmentsManager.jsx');
var pnl = read('src/components/InventoryPnL.jsx');
var ll = read('src/components/LayersLedger.jsx');
var rep = read('src/components/InventoryReports.jsx');
var it = read('src/components/InventoryTab.jsx');

var failures = [];
function ok(label, cond, hint) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

// ── 1. StatCard contrast: label is slate-900 (NEVER white) ─────────
ok('1a: StatCard label uses text-slate-900 (high contrast, never white)',
  // Accepted forms: text-xs (A.6.27.11) or text-sm (A.6.27.12 bump)
  /<div className="text-(xs|sm) font-black uppercase tracking-wide text-slate-900">\{props\.label\}<\/div>/.test(ab));
ok('1b: StatCard value uses dark colored hue per palette',
  /amber: 'text-amber-900'/.test(ab) && /blue: 'text-sky-900'/.test(ab));
ok('1c: regression — no white text classes for label',
  !/<div className="[^"]*text-white[^"]*">\{props\.label\}</.test(ab));

// ── 2. Duplicate OVERDUE banner removed ────────────────────────────
ok('2a: PersonalDashboard OVERDUE banner removed',
  !/🚨 OVERDUE \(\{allOverdue\.length\}\)/.test(pd) &&
  /REMOVED the entire OVERDUE/.test(pd));

// ── 3. Financial gating: super_admin + Treasury only ──────────────
ok('3a: FINANCIAL OVERVIEW wrapped in super_admin+Treasury gate',
  /\(isSuperAdmin \|\| modulePerms\['Treasury'\]\) && \(<>[\s\S]{0,200}Section: Financial/.test(page));
ok('3b: PendingBankConfirmationsWidget requires Treasury OR Financial Reports',
  /modulePerms\['Treasury'\] === true[\s\S]{0,200}modulePerms\['View Financial Reports'\] === true/.test(pbc));

// ── 4. Inventory column-name fix: sku_number not sku_code ─────────
ok('4a: page.jsx loads inv_skus by sku_number, filtered by deleted_at',
  /from\('inv_skus'\)\.select\('\*'\)\.is\('deleted_at', null\)\.order\('sku_number'\)/.test(page));
ok('4b: page.jsx SKU dropdown uses s.sku_number',
  /<option key=\{s\.id\} value=\{s\.id\}>\{s\.sku_number\}<\/option>/.test(page));
ok('4c: InventoryTab loader uses sku_number + deleted_at',
  /from\('inv_skus'\)\.select\('\*'\)\.is\('deleted_at', null\)\.order\('sku_number'\)/.test(it));
ok('4d: AdjustmentsManager uses .sku_number not .sku_code',
  !/sku_code/.test(adj));
ok('4e: InventoryPnL uses .sku_number not .sku_code',
  !/sku_code/.test(pnl));
ok('4f: LayersLedger uses .sku_number not .sku_code',
  !/sku_code/.test(ll));
ok('4g: InventoryReports uses .sku_number not .sku_code',
  !/sku_code/.test(rep));

// ── 5. Shipment SKU discoverability ───────────────────────────────
ok('5a: ShipmentsManager has prominent "What\'s next?" banner',
  /What's next\?[\s\S]{0,800}Add SKU/.test(sm));

// ── 6. Dashboard reorder: renderSection prop ─────────────────────
ok('6a: PersonalDashboard accepts renderSection prop',
  /renderSection \}\)/.test(pd) && /renderSection \|\| 'both'/.test(pd));
ok('6b: showAI/showRest gates declared',
  /var showAI = section === 'both' \|\| section === 'ai'/.test(pd) &&
  /var showRest = section === 'both' \|\| section === 'rest'/.test(pd));
ok('6c: page.jsx mounts PersonalDashboard with renderSection="ai"',
  /chatSurface=\{nadiaChatSurface\} renderSection="ai"/.test(page));
ok('6d: page.jsx mounts PersonalDashboard with renderSection="rest"',
  /renderSection="rest"/.test(page));

// ── 7. Bubble cards POL/POD with country ──────────────────────────
ok('7a: route card always shows port + country format',
  /Always show port \+ country[\s\S]{0,50}format/.test(srt) &&
  /var fromLabel, fromSub, toLabel, toSub/.test(srt));

// ── 8. Trucking tab in Shipping Rates ─────────────────────────────
ok('8a: Transport mode toggle (Ocean/Trucking/Air)',
  /🚛 Trucking/.test(srt) && /setFilterMode\('Truck'\)/.test(srt));

// ── 9. AI login history: cross-references login_events ───────────
ok('9a: page.jsx loginHistory loader queries login_events',
  /from\('login_events'\)[\s\S]{0,300}event_type.*login/.test(page));
ok('9b: merges login_events dates not already in user_sessions',
  /if \(!haveDates\[d\]\) \{[\s\S]{0,200}merged\.push\(/.test(page));

// ── 10. AI "no open tickets" — broaden filter ─────────────────────
ok('10a: AIGreeter myTickets includes created_by and additional_assignees',
  /if \(t\.created_by === myId\) return true/.test(ag) &&
  /additional_assignees/.test(ag));

// ── 11. AI persistence: stays dismissed after X ──────────────────
ok('11a: NadiaFloatingOverlay tracks userCollapsedAt',
  /var \[userCollapsedAt, setUserCollapsedAt\] = useState\(0\)/.test(nfo));
ok('11b: auto-expand gated by userCollapsedAt',
  /!expanded && !userCollapsedAt/.test(nfo));
ok('11c: collapse button sets userCollapsedAt',
  /setExpanded\(false\); setUserCollapsedAt\(Date\.now\(\)\)/.test(nfo));
ok('11d: expand click clears userCollapsedAt',
  /setExpanded\(true\); setUserCollapsedAt\(0\)/.test(nfo));

// ── 12. System Tickets: enlarged modal + private toggle ──────────
ok('12a: SystemTicketsPanel has expandedTicket state',
  /var \[expandedTicket, setExpandedTicket\] = useState\(null\)/.test(stp));
ok('12b: ticket card click opens modal',
  /onClick=\{function \(\) \{ setExpandedTicket\(t\); \}\}/.test(stp));
ok('12c: enlarged modal rendered with attachments',
  /expandedTicket && \([\s\S]{0,500}Click outside to close/.test(stp) ||
  /\{expandedTicket && \(/.test(stp));
ok('12d: togglePrivate function exists for super-admin',
  /var togglePrivate = async function/.test(stp) &&
  /Make Private/.test(stp) && /Make Public/.test(stp));
ok('12e: action buttons stop click propagation',
  /flex flex-col gap-1 flex-shrink-0 ml-2"[\s\S]{0,100}onClick=\{function \(e\) \{ e\.stopPropagation\(\)/.test(stp));

// ── 13. Inventory adjustments shortfall handling ──────────────────
ok('13a: AdjustmentsManager handles shortfall with user confirm',
  /Only ' \+ drain\.qtyDrained \+ ' units in stock/.test(adj));
ok('13b: AdjustmentsManager rolls back drain on cancel',
  /reverseFifoConsumption\(consumed\)[\s\S]{0,200}setBusyApproveId\(null\);\s*return;/.test(adj));
ok('13c: qty_change persisted on approval',
  /qty_change: qty,/.test(adj));

// ── 14. Version stamp ─────────────────────────────────────────────
ok('14a: version stamp v55.83-A.6.27.11 or later',
  /BUILD v55\.83-A\.6\.27\.1[12]/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.11 tests passed');
