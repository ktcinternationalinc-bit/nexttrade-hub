var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// no silent failure
ok(/srcLines, srcHeaders, plan, planErr = null/.test(r) && /catch \(e\) \{\s*console\.error\('\[merge\] preview failed'/.test(r),'modal wraps mergePlan in try/catch (no crash)');
ok(/Merge preview failed/.test(r) && /merge database columns aren't set up yet/.test(r),'visible error card when preview fails');
ok(/console\.log\('\[merge\] opening modal for', sel\)/.test(r),'button logs open (dev visibility)');
ok(/have no mergeable product lines/.test(r),'button shows reason if no valid lines');
// new shell form
ok(/var \[mergeShell, setMergeShell\] = useState/.test(r),'mergeShell state');
ok(/function initMergeShell\(sel\)/.test(r) && /fh\.supplier \|\| fl\.supplier/.test(r),'initMergeShell auto-fills from source header');
ok(/mergeTarget === 'new' && \(/.test(r) && /New merged shell — review before merging/.test(r),'new-shell form renders before merge');
ok(/will be generated on save/.test(r),'receipt # generated-on-save note');
ok(/auto-filled from the \{sel\.length\} selected shipments/.test(r) && /plan\.header_totals\.expected_total_rolls/.test(r),'expected totals auto-filled');
ok(/Warehouse \*/.test(r) && /— choose —/.test(r),'warehouse selector in shell form');
// executeMerge wiring
ok(/var useShell = mergeTarget === 'new'/.test(r) && /shipment_reference: mergeShell\.shipment_reference/.test(r),'executeMerge writes reviewed shell fields');
ok(/receipt_date: shellDate,\s*\n\s*warehouse_id: shellWh, supplier: shellSupplier/.test(r),'aggregated lines use shell date/warehouse/supplier');
// gating
ok(/disabled=\{mergeBusy \|\| !plan\.balanced \|\| \(mergeTarget === 'new' && !mergeShell\.warehouse_id\)\}/.test(r),'confirm gated by balanced + warehouse');
ok(/Create Shell & Confirm Merge/.test(r),'confirm label on new-shell path');
ok(/MERGE FINALIZED SHIPMENTS/.test(r),'finalized typed-confirm preserved');
// intact
var o=p('src/components/InventoryOverview.jsx');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'Overview no-double-count intact');
ok((r.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode');
ok(/version: 'v55\.83-CY'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CY');
console.log('\nv55.83-CY merge shell: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
