const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const ui=p('src/components/BankReviewTab.jsx');
const perms=p('src/lib/bank-permissions.js');

// 1) invoice total pinned
ok(/PINNED v55\.83-AA/.test(ui)&&/inv\.total_amount != null \? inv\.total_amount : \(inv\.amount/.test(ui),'invoiceTotal pinned to total_amount (amount fallback)');
ok(!/grand_total/.test(ui),'no more grand_total/total guessing');

// 2) full split editor
ok(/function saveSplits\(\)/.test(ui)&&/bank_transaction_splits/.test(ui),'saveSplits writes split rows');
ok(/validateSplit\(txnAmt/.test(ui),'split total guarded against txn amount');
ok(/Save split/.test(ui)&&/\+ add line/.test(ui),'multi-line split UI present');
ok(/r\.invoice_id[\s\S]{0,600}payment_matches[\s\S]{0,500}recomputeInvoice/.test(ui),'invoice-linked split lines record payment + recompute');
ok(/sel\.business_id !== iv\.business_id/.test(ui),'split invoice picker excludes other businesses');

// 3) typeahead pickers
ok(/function Typeahead\(props\)/.test(ui),'Typeahead component defined');
ok(/<Typeahead items=\{acctCustomers\}/.test(ui)&&/<Typeahead items=\{invForCustomer\}/.test(ui),'customer + invoice pickers use Typeahead');
ok(!/All customers…/.test(ui)&&!/Select invoice…/.test(ui),'old long dropdowns removed');

// 5) reopen gating
ok(/export function canReopen/.test(perms)&&/accounting_manager/.test(perms),'canReopen restricts to owner/admin/accounting manager');
ok(/var mayReopen = canReopen\(isSuperAdmin, modulePerms, userProfile/.test(ui),'reopen gate wired');
ok(/if \(!mayReopen\)/.test(ui)&&/window\.prompt\('Reopen/.test(ui),'reopen blocked without role + requires reason');
ok(/Reopened approved bank txn/.test(ui),'reopen is logged');

// 6) permission verification
ok(/seeAmounts \? fmt\(/.test(ui)&&/maskAmount/.test(ui),'amounts masked without See Amounts');
ok(/disabled=\{!mayClassify \|\| isLocked\(sel\)\}/.test(ui),'classify disabled without Classify');
ok(/mayMatch && !isLocked\(sel\)/.test(ui),'match panel hidden without Payments: Match');
ok(/canEditMappings/.test(perms),'Edit Mappings gate available for mappings screen');

ok(/version: 'v55\.83-AA'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew has v55.83-AA');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page.jsx stamped (current build)');

console.log('\nv55.83-AA Phase 2 polish: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
