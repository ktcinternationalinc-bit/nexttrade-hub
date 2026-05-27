/* v72 HOTFIX 15 — Three asks from screenshot review:
 *   1. Net Position card pulls LIVE USD/EGP rate from open.er-api.com
 *      (same source the main dashboard hero card uses) — not manual fx_rates table.
 *   2. Vendor Bill color: ORANGE → PURPLE per Max.
 *   3. Real portrait files copied into public/avatars/ + faceAnchors tuned to
 *      the actual mouth/eye positions in each photo, plus a skinTone per portrait.
 */
var path = require('path');
var fs = require('fs');

function ok(name, cond) {
  if (!cond) { console.log('  ✗ ' + name); process.exitCode = 1; }
  else { console.log('  ✓ ' + name); }
}

var oa     = fs.readFileSync(path.join(__dirname, '..', 'src/components/OpenAccountsTab.jsx'), 'utf8');
var ag     = fs.readFileSync(path.join(__dirname, '..', 'src/components/AIGreeter.jsx'), 'utf8');
var pers   = fs.readFileSync(path.join(__dirname, '..', 'src/lib/agent-personalities.js'), 'utf8');
var ledger = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-ledger.js'), 'utf8');
var exp    = fs.readFileSync(path.join(__dirname, '..', 'src/lib/open-account-export.js'), 'utf8');

console.log('\n── Live FX rate (matches main dashboard source) ──');

ok('A1: OpenAccountsTab fetches from open.er-api.com (same as dashboard hero card)',
  /fetch\('https:\/\/open\.er-api\.com\/v6\/latest\/USD'\)/.test(oa));

ok('A2: Live FX result synthesized into fx_rates shape (from_currency / to_currency / rate / rate_date)',
  /setLiveFxRate\(\{[\s\S]{0,400}from_currency: 'USD'[\s\S]{0,100}to_currency: 'EGP'[\s\S]{0,100}rate: data\.rates\.EGP/.test(oa));

ok('A3: combinedFxRates puts live rate FIRST so lookup picks it over manual fx_rates table',
  /var combinedFxRates = useMemo\(function \(\) \{[\s\S]{0,400}if \(liveFxRate\) base\.unshift\(liveFxRate\)/.test(oa));

ok('A4: Net Position card uses combinedFxRates (not raw fxRates)',
  /convertToBaseCurrency\(grandTotals\.byCurrency, 'USD', combinedFxRates\)/.test(oa));

ok('A5: Card subtitle credits live source when working',
  /live rate from open\.er-api\.com/.test(oa));

ok('A6: Card has graceful silent fallback if fetch fails',
  /\[open-accounts\] live FX fetch failed/.test(oa));

console.log('\n── Vendor Bill: orange → purple ──');

ok('B1: vendor_bill descCls = text-purple-700 (was text-orange-700)',
  /vendor_bill:[\s\S]{0,800}descCls: 'text-purple-700'/.test(ledger));

ok('B2: vendor_bill amountCls = text-purple-700',
  /vendor_bill:[\s\S]{0,800}amountCls: 'text-purple-700'/.test(ledger));

ok('B3: vendor_bill pillCls = bg-purple-100 text-purple-900',
  /vendor_bill:[\s\S]{0,500}pillCls: 'bg-purple-100 text-purple-900'/.test(ledger));

ok('B4: Print export vendor_bill hex = #7e22ce (purple-700)',
  /vendor_bill'[\s\S]{0,300}'#7e22ce'/.test(exp));

ok('B5: Print export sales_invoice stays blue (#1d4ed8)',
  /sales_invoice'[\s\S]{0,300}'#1d4ed8'/.test(exp));

console.log('\n── Real portraits + tuned faceAnchors ──');

var avatarsDir = path.join(__dirname, '..', 'public/avatars');
ok('C1: public/avatars/nadia.png exists',
  fs.existsSync(path.join(avatarsDir, 'nadia.png')));
ok('C2: public/avatars/jenna.png exists',
  fs.existsSync(path.join(avatarsDir, 'jenna.png')));
ok('C3: public/avatars/sara.png exists',
  fs.existsSync(path.join(avatarsDir, 'sara.png')));

ok('C4: Nadia faceAnchors measured (NOT the generic defaults)',
  /Nadia[\s\S]{0,3000}mouth:\s+\{ x: 0\.50,\s+y: 0\.515, width: 0\.13 \}/.test(pers));

ok('C5: Jenna faceAnchors measured (NOT the generic defaults)',
  /Jenna[\s\S]{0,3000}mouth:\s+\{ x: 0\.50,\s+y: 0\.525, width: 0\.12 \}/.test(pers));

ok('C6: Sara faceAnchors measured (NOT the generic defaults — face shifted right)',
  /Sara[\s\S]{0,3000}mouth:\s+\{ x: 0\.55,\s+y: 0\.52,\s+width: 0\.12 \}/.test(pers));

ok('C7: Each persona has its own skinTone for blink overlay blending',
  /Nadia[\s\S]{0,3000}skinTone: '#d8a988'/.test(pers) &&
  /Jenna[\s\S]{0,3000}skinTone: '#d8a886'/.test(pers) &&
  /Sara[\s\S]{0,3000}skinTone: '#e8c4a0'/.test(pers));

ok('C8: AIGreeter passes skinTone prop to AnimatedPortrait',
  /<AnimatedPortrait[\s\S]{0,500}skinTone=\{activeAgent\.faceAnchors && activeAgent\.faceAnchors\.skinTone\}/.test(ag));

console.log('\n══════════════════════════════════════════════');
if (process.exitCode) console.log('FAILED');
else console.log('✅ HOTFIX 15 — live FX rate, vendor purple, real portraits wired with measured anchors');
console.log('══════════════════════════════════════════════');
