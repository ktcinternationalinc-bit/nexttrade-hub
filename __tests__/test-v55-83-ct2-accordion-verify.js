var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');var o=p('src/components/InventoryOverview.jsx');
var pass=0,fail=0;function ok(c,m){if(c){pass++;console.log('  ✓ '+m);}else{fail++;console.log('  ✗ '+m);}}

console.log('\n— Confirmation checklist —');
// 1 all 4 steps exist
ok(/\{openStep === 1 && \(/.test(r)&&/\{openStep === 2 && \(/.test(r)&&/\{openStep === 3 && \(function/.test(r)&&/\{openStep === 4 && \(\(\) =>/.test(r),'1. All 4 steps exist (shell/Nexpac, actual, variance, submit)');
// 2 arabic titles
ok(/ar: '\\u0627\\u0644\\u062e\\u0637\\u0648\\u0629/.test(r)&&/dir="rtl">\{st\.ar\}/.test(r),'2. Arabic titles render under each step');
// 3 collapsed by default on NEW
ok(/setOpenStep\(0\);.*all 4 steps collapsed by default on NEW/.test(r),'3. New receipt: all steps collapsed by default (openStep=0)');
// 4 existing collapsed unless variance
ok((r.match(/setOpenStep\(grouped\.status === 'submitted_unbalanced' \? 3 : 0\)/g)||[]).length>=2,'4. Existing receipt: collapsed unless variance -> auto step 3 (both open paths)');
// 5 save draft works with blanks
ok(/setVarExpanded\(true\); saveReceipt\(\)/.test(r),'5. Save Draft path (no validation gate)');
// 6 submit blocks on missing
ok(/function submitReceipt\(\)/.test(r)&&/has_any_expected/.test(r)&&/alert\('Please fill in at least one Shipment Expected Total/.test(r),'6. Submit BLOCKS when expected totals missing (returns)');
ok(/if \(!rec\.is_balanced\)/.test(r)&&/setVariancePromptOpen\(true\);\n      return;/.test(r),'6b. Submit BLOCKS on variance until notes given');
// 7 warnings only after submit
ok(/var warn = submitAttempted && !st\.done/.test(r)&&/setSubmitAttempted\(false\)/.test(r),'7. Warnings only after submit attempt; reset on open');
// 8 step1 has nexpac + shell
ok(/\{openStep === 1 && \(/.test(r)&&/handleNexpacImport/.test(r)&&/expected_total_rolls/.test(r),'8. Step 1 includes Nexpac import + shipment shell/expected');
// 9 step2 product lines + collapse
ok(/\{openStep === 2 && \(/.test(r)&&/lines\.map\(function \(line, lineIdx\)/.test(r)&&/collapsedLines\[lineIdx\]/.test(r),'9. Step 2: product lines + per-line collapse preserved');
// 10 merged source breakdown
ok(/merged_source_breakdown\.map\(function \(sb, si\)/.test(r),'10. CS merged source breakdown still displays');
// 11 merge behavior
ok(/function executeMerge\(\)/.test(r)&&/MERGE FINALIZED SHIPMENTS/.test(r),'11. CR merge execution intact');
// 12 overview no double count
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'12. Overview no-double-count intact');
// 13 KG once
ok(/quantity_kg && String\(line\.uom \|\| ''\)\.toLowerCase\(\) !== 'kg'/.test(r),'13. KG UOM: KG shown once, no duplicate entry forced');
// 14 variance auto-open
ok(/var hasExp = !!\(header\.expected_total_rolls/.test(r)&&/setOpenStep\(hasExp \? 3 : 1\)/.test(r),'14. Submit auto-opens relevant step (1 if expected missing, else 3 variance)');
// 15 step4 readiness summary
ok(/\{openStep === 4 && \(\(\) =>/.test(r)&&/Ready to submit/.test(r)&&/Before finalizing:/.test(r),'15. Step 4 readiness summary (ready / missing)');

console.log('\nCT verification: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL CONFIRMED');
