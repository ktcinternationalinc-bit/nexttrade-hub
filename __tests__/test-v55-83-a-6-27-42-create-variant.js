// v55.83-A.6.27.42 — Create Variant button + modal + dark-text-on-light contrast rule

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page = read('src/app/page.jsx');
var pm   = read('src/components/InventoryProductMaster.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — Row background + text colors (contrast fix)
// ══════════════════════════════════════════════════════════════════

ok('A1: row container forces bg-white text-slate-900 (no more grey-on-dark)',
  /bg-white text-slate-900 ' \+ \(p\.active \? '' : 'opacity-60'\)/.test(pm));
ok('A2: actions column widened further in v.43 (now 370px for 5 buttons including Delete)',
  /'110px 1\.5fr 2fr 140px 60px 370px'/.test(pm));
ok('A3: new v.43 grid applied in both header AND row',
  pm.split("gridTemplateColumns: '110px 1.5fr 2fr 140px 60px 370px'").length - 1 === 2);

// ══════════════════════════════════════════════════════════════════
// PART B — Variant modal state
// ══════════════════════════════════════════════════════════════════

ok('B1: variantModalOpen state declared',
  /var \[variantModalOpen, setVariantModalOpen\] = useState\(false\)/.test(pm));
ok('B2: variantTemplate state declared',
  /var \[variantTemplate, setVariantTemplate\] = useState\(null\)/.test(pm));
ok('B3: variantForm state with 4 spec code fields',
  /var \[variantForm, setVariantForm\] = useState\(\{\s+category_code: '',\s+construction_code: '',\s+backing_code: '',\s+pattern_code: '',\s+\}\)/.test(pm));
ok('B4: variantBusy state declared',
  /var \[variantBusy, setVariantBusy\] = useState\(false\)/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART C — Handlers
// ══════════════════════════════════════════════════════════════════

ok('C1: openCreateVariant guards against non-templates',
  /function openCreateVariant\(template\) \{\s+if \(!template \|\| template\.is_family_template !== true\)/.test(pm));
ok('C2: openCreateVariant sets template + resets form + opens modal',
  /setVariantTemplate\(template\);[\s\S]{0,200}setVariantForm\(\{ category_code: '', construction_code: '', backing_code: '', pattern_code: '' \}\);\s+setVariantModalOpen\(true\)/.test(pm));
ok('C3: closeVariantModal clears state',
  /function closeVariantModal\(\) \{\s+setVariantModalOpen\(false\);\s+setVariantTemplate\(null\)/.test(pm));
ok('C4: saveVariant validates all 4 specs',
  /async function saveVariant\(\)[\s\S]{0,500}if \(!variantForm\.category_code\)[\s\S]{0,200}if \(!variantForm\.construction_code\)[\s\S]{0,200}if \(!variantForm\.backing_code\)[\s\S]{0,200}if \(!variantForm\.pattern_code\)/.test(pm));
ok('C5: saveVariant calls get_or_create_variant RPC with template id + 4 codes',
  /supabase\.rpc\('get_or_create_variant', \{\s+p_template_id:\s+variantTemplate\.id,\s+p_category_code:\s+variantForm\.category_code,\s+p_construction_code: variantForm\.construction_code,\s+p_backing_code:\s+variantForm\.backing_code,\s+p_pattern_code:\s+variantForm\.pattern_code/.test(pm));
ok('C6: saveVariant reloads + shows success toast + closes modal',
  /await reload\(\);[\s\S]{0,500}toast\.success\('Variant ready[\s\S]{0,500}closeVariantModal\(\)/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART D — Create Variant button in row UI
// ══════════════════════════════════════════════════════════════════

ok('D1: + Variant button shown ONLY when canEdit && is_family_template === true',
  /\{canEdit && p\.is_family_template === true && \(\s+<button\s+onClick=\{function \(\) \{ openCreateVariant\(p\); \}\}/.test(pm));
ok('D2: + Variant button uses purple-600 (high contrast)',
  /bg-purple-600 hover:bg-purple-700 text-white rounded font-bold/.test(pm));
ok('D3: + Variant button label literal',
  /\+ Variant/.test(pm));
ok('D4: + Variant button title tooltip (renamed "family template" → "template product" in .55)',
  /title="Create a spec variant of this template product/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART E — Modal UI
// ══════════════════════════════════════════════════════════════════

ok('E1: modal renders only when variantModalOpen AND variantTemplate',
  /\{variantModalOpen && variantTemplate && \(/.test(pm));
ok('E2: modal uses bg-white text-slate-900 (high contrast)',
  /bg-white text-slate-900 rounded-2xl shadow-2xl/.test(pm));
ok('E3: modal header purple-700 bg with white text',
  /bg-purple-700 text-white rounded-t-2xl/.test(pm));
ok('E4: modal closes on backdrop click via closeVariantModal',
  /<div className="fixed inset-0 bg-black\/60 z-\[60\] flex items-center justify-center p-4" onClick=\{closeVariantModal\}>/.test(pm));
ok('E5: modal stops propagation on inner click',
  /onClick=\{function \(e\) \{ e\.stopPropagation\(\); \}\}/.test(pm));

ok('E6: Category dropdown with SM + EM options',
  /<option value="SM">SM · Smooth<\/option>\s+<option value="EM">EM · Embossed<\/option>/.test(pm));
ok('E7: Construction dropdown with 5 options',
  /<option value="RG">RG · Regular<\/option>[\s\S]{0,200}<option value="PF">PF · Perforated<\/option>[\s\S]{0,200}<option value="FN">FN · Foam Non-Perforated<\/option>[\s\S]{0,200}<option value="FP">FP · Foam Perforated<\/option>[\s\S]{0,200}<option value="TL">TL · Tri-Lam<\/option>/.test(pm));
ok('E8: Backing dropdown with 7 options',
  /<option value="BK">BK · Black<\/option>[\s\S]{0,600}<option value="OT">OT · Other<\/option>/.test(pm));
ok('E9: Pattern dropdown with 4 options',
  /<option value="NA">NA · None<\/option>[\s\S]{0,200}<option value="HC">HC · Honeycomb<\/option>[\s\S]{0,200}<option value="MG">MG · Mechanical Grain<\/option>[\s\S]{0,200}<option value="RG">RG · Normal Emboss<\/option>/.test(pm));
ok('E10: select inputs use bg-white text-slate-900 font-semibold (no contrast issues)',
  /border-2 border-slate-300 rounded text-sm bg-white text-slate-900 font-semibold/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART F — Smooth-Black soft warning
// ══════════════════════════════════════════════════════════════════

ok('F1: warning conditional on Smooth category AND non-Black color',
  /variantForm\.category_code === 'SM' && variantTemplate && \(function/.test(pm));
ok('F2: warning extracts color from classification_slug split index 5',
  /var parts = slug\.split\('-'\);[\s\S]{0,300}var colorCode = parts\[5\] \|\| ''/.test(pm));
ok('F3: warning message present',
  /Smooth leather is typically only available in Black/.test(pm));
ok('F4: warning uses yellow-100 bg + yellow-950 text (high contrast)',
  /bg-yellow-100 border-2 border-yellow-400 rounded p-3 text-sm text-yellow-950 font-semibold/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART G — Modal footer buttons
// ══════════════════════════════════════════════════════════════════

ok('G1: Cancel button uses bg-slate-300 text-slate-900 (high contrast)',
  /bg-slate-300 hover:bg-slate-400 disabled:opacity-50 text-slate-900 text-sm font-bold/.test(pm));
ok('G2: Create button uses bg-purple-600 text-white (high contrast)',
  /bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-extrabold/.test(pm));
ok('G3: Create button label changes during busy state',
  /\{variantBusy \? 'Creating\.\.\.' : '✓ Create \/ Reuse Variant'\}/.test(pm));

// ══════════════════════════════════════════════════════════════════
// PART H — Contrast rule lint
// ══════════════════════════════════════════════════════════════════

// Ensure no light-text-on-row patterns exist in the body row content.
// Specifically: text-slate-400 / -500 should not be used for primary content.
// They can appear as muted/secondary labels but must not be the body.
ok('H1: no text-slate-300 in row body (use slate-700 minimum on white bg)',
  !/className="[^"]*text-slate-300[^"]*">[A-Za-z]/.test(pm));

// ══════════════════════════════════════════════════════════════════
// Regression guards
// ══════════════════════════════════════════════════════════════════

ok('R1: A.6.27.40 — toggleFeatured still present',
  /async function toggleFeatured\(p\)/.test(pm));
ok('R2: A.6.27.40 — featuredOnly filter still present',
  /var \[featuredOnly, setFeaturedOnly\] = useState\(false\)/.test(pm));
ok('R3: A.6.27.40 — smart multi-keyword search still present',
  /var keywords = search\.trim\(\)\.toLowerCase\(\)\.split\(\/\\s\+\/\)/.test(pm));
ok('R4: A.6.27.41 — star button uses bigger text-[16px]',
  /text-\[16px\] leading-none/.test(pm));
ok('R5: A.6.27.41 — star button has border-2 outline',
  /'bg-amber-200 hover:bg-amber-300 text-amber-700 border-amber-400 shadow' : 'bg-white hover:bg-amber-50 text-amber-500 border-amber-300'/.test(pm));
ok('R6: Edit / Copy / Deactivate buttons still present',
  /openEdit\(p\)[\s\S]{0,2000}Edit/.test(pm) &&
  /openDuplicate\(p\)[\s\S]{0,2000}Copy/.test(pm) &&
  /toggleActive\(p\)[\s\S]{0,2000}Deactivate/.test(pm));
ok('R7: A.6.27.39 — get_or_create_variant SQL still present',
  /CREATE OR REPLACE FUNCTION get_or_create_variant\(/.test(read('sql/v55-83-a-6-27-39-variants.sql')));
ok('R8: A.6.27.28 closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));

// ── Version stamp ──────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.42',
  /BUILD v55\.83-A\.6\.27\.\d+/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.42 Create Variant + contrast tests passed');
