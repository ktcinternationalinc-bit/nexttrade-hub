var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// Part 2 — no escaped unicode anywhere
ok((r.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'PART 2: zero literal \\uXXXX escapes remain');
ok(/STEP 1 — Nexpac/.test(r) && /'الخطوة ١ —/.test(r),'PART 2: real em-dash + real Arabic in step titles');
// Part 1 — full review page
ok(/STEP 4 — Review Summary/.test(r),'PART 1: Step 4 renamed to Review Summary');
ok(/الخطوة ٤ — مراجعة الملخص/.test(r),'PART 1: Arabic Step 4 title');
ok(/var rec = computeVariance\(header, lines\)/.test(r),'PART 1: reuses computeVariance (single source of truth)');
ok(/Card\('Shipment'/.test(r) && /Card\('Expected'/.test(r) && /Card\('Actual received'/.test(r) && /Card\('Variance'/.test(r),'PART 1: shell/expected/actual/variance cards');
ok(/Product lines \(' \+ realLines\.length/.test(r) && /listLabel\(p\.grade_list_id\)/.test(r) && /listLabel\(p\.color_list_id\)/.test(r),'PART 1: product table with grade+color');
ok(/Readiness checklist/.test(r) && /Go to Step \{c\.step\}/.test(r) && /setOpenStep\(c\.step\)/.test(r),'PART 1: readiness checklist + go-to-step buttons');
ok(/mergedLines\.length > 0 &&/.test(r) && /Merged shipment/.test(r),'PART 1: merge summary when merged lines present');
ok(/flex: '1 1 auto', minHeight: 0, overflowY: 'auto'/.test(r),'PART 1: Step 4 panel scrolls');
ok(/needNotes = rec\.has_any_expected && !rec\.is_balanced/.test(r),'PART 1: variance-notes-required logic');
// no dynamic tailwind colors
ok(!/'bg-' \+ vColor/.test(r) && /bg-emerald-100 text-emerald-950/.test(r) && /bg-amber-100 text-amber-950/.test(r),'PART 1: literal (purge-safe, high-contrast) variance colors');
// Part 3 — clean button text
ok(/⎘ Merge Shipments\{selectedNumbers\(\)\.length \? ' \(' \+ selectedNumbers\(\)\.length \+ ' selected\)'/.test(r),'PART 3: button "Merge Shipments (N selected)"');
ok(/Merge Shipments<\/div><div className="text-xs font-semibold text-violet-100">\{sel\.length\} selected/.test(r),'PART 3: modal header "Merge Shipments" + N selected subtitle');
// nothing broken
ok(/merged_source_breakdown\.map\(function \(sb, si\)/.test(r),'CS source breakdown intact');
ok(/function openMergeAudit\(groupId\)/.test(r),'CU merge audit intact');
ok(/function productClassSummary\(p\)/.test(r),'CV full-description helpers intact');
var o=p('src/components/InventoryOverview.jsx');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'Overview no-double-count intact');
ok(/version: 'v55\.83-CW'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CW');
console.log('\nv55.83-CW step4 summary: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
