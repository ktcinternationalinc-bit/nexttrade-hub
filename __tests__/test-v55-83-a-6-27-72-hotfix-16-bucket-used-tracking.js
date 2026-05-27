/* v72 HOTFIX 16 — Two big asks from screenshot review:
 *
 *   1. Warehouse Buckets: show how much has been USED (and remaining) per bucket
 *      and per recipient — not just the headline advance amount. Max: "there
 *      should be somewhere in the bubble saying how much has already been used
 *      as well as in the stats... what has been spent for each bucket created
 *      so far... so far Abdelnassar for example and Mouhamed for example."
 *
 *   2. Inventory GUI polish: centered "What's in stock right now" title,
 *      sleeker filter section with numbered level badges, professional-looking
 *      stat cards (dark slate with colored left-border accents + icons).
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var list   = fs.readFileSync(path.join(__dirname, '..', 'src/components/WarehouseBucketList.jsx'), 'utf8');
var hist   = fs.readFileSync(path.join(__dirname, '..', 'src/components/WarehouseBucketsHistory.jsx'), 'utf8');
var inv    = fs.readFileSync(path.join(__dirname, '..', 'src/components/InventoryOverview.jsx'), 'utf8');

console.log('\n── Buckets: spent-per-bucket map (cards) ──');

ok('A1: WarehouseBucketList loads entries to build spentByBucket map',
  /var \[spentByBucket, setSpentByBucket\] = useState\(\{\}\)/.test(list));

ok('A2: Map is populated by querying warehouse_bucket_entries after buckets load',
  /supabase\.from\('warehouse_bucket_entries'\)[\s\S]{0,400}\.in\('bucket_id', ids\)/.test(list));

ok('A3: Card computes spent + remaining + percentage from the map',
  /var spent = Number\(spentByBucket\[b\.id\] \|\| 0\)/.test(list) &&
  /var remaining = Math\.max\(0, advance - spent\)/.test(list) &&
  /var pct = advance > 0 \? Math\.min\(100, \(spent \/ advance\) \* 100\)/.test(list));

ok('A4: Card shows USED label with money + percentage',
  /Used[\s\S]{0,200}fmtMoney\(spent, b\.currency\)[\s\S]{0,200}pct\.toFixed\(0\)/.test(list));

ok('A5: Card shows LEFT label with remaining amount',
  /Left[\s\S]{0,200}fmtMoney\(remaining, b\.currency\)/.test(list));

ok('A6: Card has a progress bar with status-aware color',
  /barColor =[\s\S]{0,400}b\.status === 'closed'[\s\S]{0,200}'bg-emerald-500'[\s\S]{0,200}b\.status === 'fully_spent'[\s\S]{0,200}'bg-blue-500'/.test(list));

ok('A7: Arabic labels for مستخدم (used) and متبقي (left)',
  /مستخدم/.test(list) && /متبقي/.test(list));

console.log('\n── Buckets: per-currency Actually Used + Remaining tiles ──');

ok('B1: Summary memo computes actualUsed by walking filteredEntries',
  /actualUsed: 0, totalRemaining: 0/.test(hist) &&
  /filteredEntries\.forEach\(function \(e\) \{[\s\S]{0,300}byCurrency\[cur\]\.actualUsed \+= Number\(e\.amount \|\| 0\)/.test(hist));

ok('B2: Summary memo computes totalRemaining = advanced − used (floored at 0)',
  /b\.totalRemaining = Math\.max\(0, b\.totalAdvanced - b\.actualUsed\)/.test(hist));

ok('B3: Per-currency grid expanded from 5 columns to 7 columns',
  /grid grid-cols-2 md:grid-cols-7 gap-2/.test(hist));

ok('B4: "Actually Used" tile renders amber with percentage of advanced',
  /Actually Used[\s\S]{0,400}fmtMoney\(s\.actualUsed\)[\s\S]{0,400}of advanced/.test(hist));

ok('B5: "Remaining" tile renders purple with "unspent" subtitle',
  /Remaining[\s\S]{0,400}fmtMoney\(s\.totalRemaining\)[\s\S]{0,400}unspent/.test(hist));

console.log('\n── Buckets: per-recipient Used + Remaining ──');

ok('C1: perRecipient memo initializes actualUsed + remaining to 0',
  /actualUsed: 0, remaining: 0/.test(hist));

ok('C2: perRecipient walks entries to sum actualUsed per recipient+currency',
  /var bucketMeta = \{\};[\s\S]{0,400}filteredBuckets\.forEach\(function \(b\) \{[\s\S]{0,300}bucketMeta\[b\.id\] = \{[\s\S]{0,200}recipient/.test(hist) &&
  /filteredEntries\.forEach\(function \(e\) \{[\s\S]{0,400}bucket\[key\]\.actualUsed \+= Number\(e\.amount/.test(hist));

ok('C3: perRecipient computes remaining = advanced − used',
  /r\.remaining = Math\.max\(0, r\.totalAdvanced - r\.actualUsed\)/.test(hist));

ok('C4: By Recipient table has "Used" column header (amber)',
  /text-amber-800[\s\S]{0,400}'مستخدم' : 'Used'/.test(hist));

ok('C5: By Recipient table has "Remaining" column header (purple)',
  /text-purple-800[\s\S]{0,400}'متبقي' : 'Remaining'/.test(hist));

ok('C6: Table renders r.actualUsed in amber-800 mono',
  /text-amber-800[\s\S]{0,300}fmtMoney\(r\.actualUsed\)/.test(hist));

ok('C7: Table renders r.remaining in purple-800 mono',
  /text-purple-800[\s\S]{0,300}fmtMoney\(r\.remaining\)/.test(hist));

ok('C8: Excel export includes Actually Used + Remaining columns',
  /'Actually Used': r\.actualUsed/.test(hist) &&
  /'Remaining': r\.remaining/.test(hist));

console.log('\n── Inventory polish ──');

ok('D1: Header banner uses gradient with centered title block (not flex-justify-between)',
  /from-slate-900 via-indigo-900 to-purple-900[\s\S]{0,2000}text-center/.test(inv));

ok('D2: Expand/Collapse buttons absolute-positioned in top-right corner',
  /absolute top-3 right-3[\s\S]{0,500}onClick=\{expandAll\}/.test(inv));

ok('D3: Title uses gradient text effect (bg-clip-text text-transparent)',
  /bg-gradient-to-r from-white via-indigo-100 to-purple-100 bg-clip-text text-transparent/.test(inv));

ok('D4: Decorative blur halos on header for depth',
  /blur-3xl/.test(inv));

ok('D5: Stat cards use dark slate base with colored left-border accent (world-class style)',
  /bg-slate-900[\s\S]{0,100}border-l-4 border-slate-500/.test(inv) &&
  /bg-slate-900[\s\S]{0,100}border-l-4 border-blue-500/.test(inv) &&
  /bg-slate-900[\s\S]{0,100}border-l-4 border-emerald-500/.test(inv));

ok('D6: Stat cards include emoji icon badge + uppercase tracking label',
  /text-2xl opacity-80[\s\S]{0,200}>📦</.test(inv) &&
  /tracking-\[0\.15em\]/.test(inv));

ok('D7: Stat cards use tabular-nums for clean number alignment',
  /tabular-nums/.test(inv));

ok('D8: Filter section uses numbered level badges (circle with number) instead of inline number prefix',
  /inline-flex items-center justify-center w-5 h-5 rounded-full[\s\S]{0,300}\{f\.level\}/.test(inv));

ok('D9: Filter dropdowns have selected-state ring for visual emphasis',
  /ring-1 ring-indigo-200/.test(inv));

ok('D10: Filter levels still 1-9, label_en + label_ar + level fields',
  /level: 1[\s\S]{0,800}level: 5[\s\S]{0,800}level: 9/.test(inv));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 16 — used tracking per bucket/recipient + inventory polished to world-class look');
console.log('══════════════════════════════════════════════');
