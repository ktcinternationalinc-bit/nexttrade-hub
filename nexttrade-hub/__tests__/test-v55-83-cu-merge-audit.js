var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');var pm=p('src/components/InventoryProductMaster.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
// Merge audit modal
ok(/function openMergeAudit\(groupId\)/.test(r),'openMergeAudit fetch function');
ok(/from\('inventory_shipment_merges'\)\.select\('\*'\)\.eq\('merge_group_id', groupId\)/.test(r),'reads inventory_shipment_merges by group');
ok(/onClick=\{function \(\) \{ openMergeAudit\(line\.merge_group_id\); \}\}/.test(r),'View Merge Audit button wired');
ok(/View Merge Audit/.test(r),'button label present');
ok(/Totals BEFORE/.test(r) && /Totals AFTER/.test(r),'shows before/after totals');
ok(/a\.target_receipt_number/.test(r) && /a\.source_receipt_numbers/.test(r) && /a\.source_line_ids/.test(r) && /a\.target_line_ids/.test(r),'shows target/source shipments + line ids');
ok(/a\.merged_by/.test(r) && /fmtDt\(a\.created_at\)/.test(r) && /a\.merge_notes/.test(r),'shows merged by / at / notes');
ok(/mergeAuditGroup && \(\(\) =>/.test(r),'audit modal gated by group');
// Product copy naming (verified already done — assert it stays correct)
ok(/quick_code: '',                  \/\/ user must enter a new quick code/.test(pm),'copy clears quick_code (forces unique)');
ok(!/name_en: \(p\.name_en \|\| ''\) \+ ' \(copy\)'/.test(pm) && !/\(نسخة\)/.test(pm),'copy does NOT append (copy)/(نسخة) to name');
ok(/DUPLICATE DESIGN CODE — cannot save/.test(pm) && /DUPLICATE CLASSIFICATION — cannot save/.test(pm) && /DUPLICATE ENGLISH NAME — cannot save/.test(pm),'save blocks duplicate identity with warning');
// nothing broken
ok(/merged_source_breakdown\.map\(function \(sb, si\)/.test(r),'CS source breakdown intact');
ok(/\{openStep === 1 && \(/.test(r) && /\{openStep === 4 && \(\(\) =>/.test(r),'CT.2 accordion intact');
var o=p('src/components/InventoryOverview.jsx');
ok(/r\.status === 'cancelled' \|\| r\.status === 'pending_detail' \|\| r\.status === 'merged'/.test(o),'Overview no-double-count intact');
ok(/maxHeight: 'calc\(100vh - 32px\)'/.test(p('src/components/InventoryProductMaster.jsx')),'CP product modal scroll intact');
ok(/version: 'v55\.83-CU'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew CU');
console.log('\nv55.83-CU merge audit: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
