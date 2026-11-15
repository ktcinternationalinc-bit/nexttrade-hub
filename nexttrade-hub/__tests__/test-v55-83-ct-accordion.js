var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/var \[openStep, setOpenStep\] = useState\(1\)/.test(r),'openStep state (default 1)');
ok(/var \[submitAttempted, setSubmitAttempted\] = useState\(false\)/.test(r),'submitAttempted state');
ok(/\{openStep === 1 && \(/.test(r),'Step 1 gates the shell/expected/Nexpac region');
ok(/\{openStep === 2 && \(/.test(r),'Step 2 gates the product lines region');
ok(/\{openStep === 3 && \(function \(\) \{/.test(r),'Step 3 guards reconciliation IIFE (merged into braces)');
ok(/\{openStep === 4 && \(\(\) => \{/.test(r),'Step 4 readiness panel');
ok(/STEP 1 \\u2014 Nexpac \/ Expected/.test(r) && /STEP 2 \\u2014 Actual Received/.test(r) && /STEP 3 \\u2014 Variance \/ Reconcile/.test(r) && /STEP 4 \\u2014 Submit \/ Finalize/.test(r),'all 4 EN step titles');
ok(/\\u0627\\u0644\\u062e\\u0637\\u0648\\u0629 \\u0661/.test(r) && /\\u0627\\u0644\\u062e\\u0637\\u0648\\u0629 \\u0664/.test(r),'Arabic step titles (1..4) present');
ok(/st\.done \? '\\u2705' : \(warn \? '\\u26a0\\ufe0f' : '\\u2b1c'\)/.test(r),'green check / warn-after-submit / todo indicators');
ok(/var warn = submitAttempted && !st\.done/.test(r),'warning only after submit attempt');
ok(/setOpenStep\(active \? 0 : st\.n\)/.test(r),'click toggles step (closes to all-collapsed)');
ok(/setSubmitAttempted\(true\);/.test(r) && /setOpenStep\(hasExp \? 3 : 1\)/.test(r) && /submitReceipt\(\)/.test(r),'submit sets attempt + opens relevant step + validates');
ok(/setVarExpanded\(true\); saveReceipt\(\)/.test(r),'Save Draft path preserved (no validation gate)');
// preserved features
ok(/handleNexpacImport/.test(r),'Nexpac import preserved');
ok(/merged_source_breakdown\.map\(function \(sb, si\)/.test(r),'CS merged source breakdown preserved');
ok(/\{openStep === 3 && \(function \(\) \{/.test(r) && /variancePromptOpen/.test(r),'variance/reconciliation logic preserved (gated by step 3)');
ok(/function executeMerge\(\)/.test(r),'merge execution preserved');
// Overview untouched (no double count)
var o=p('src/components/InventoryOverview.jsx');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'Overview no-double-count intact');
ok(/version: 'v55\.83-CT'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CT');
console.log('\nv55.83-CT accordion: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
