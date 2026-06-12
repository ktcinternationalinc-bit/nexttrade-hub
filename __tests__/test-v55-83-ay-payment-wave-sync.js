var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var br=p('src/components/BankReviewTab.jsx');var sql=p('sql/v55-83-ay-payment-wave-sync.sql');var ar=p('src/components/AccountingCustomerHistory.jsx');

ok(/function createInvPaymentRow/.test(br),'createInvPaymentRow helper exists');
ok(/dbInsert\('accounting_invoice_payments'/.test(br),'matching creates accounting_invoice_payments row');
ok(/source: 'plaid_match'/.test(br)&&/sync_status: 'pending_wave_sync'/.test(br)&&/wave_payment_id: null/.test(br),'payment row: plaid_match + pending_wave_sync + null wave_payment_id');
ok(/wave_invoice_id: inv\.wave_invoice_id/.test(br)&&/wave_customer_id: cust && cust\.wave_customer_id/.test(br),'payment row carries wave_invoice_id + wave_customer_id');
ok(/payment_match_id: matchId/.test(br)&&/bank_transaction_id: t\.id/.test(br),'payment row links match + bank txn');
ok(/from\('accounting_invoice_payments'\)\.select\('amount'\)/.test(br),'recomputeInvoice reads payment rows (not payment_matches)');
ok(/var amountPaid = Math\.round\(\(waveImported \+ hubPaid\)/.test(br),'amount_paid = wave_imported_paid + hub payments (no clobber)');
ok((br.match(/createInvPaymentRow\(inv, t/g)||[]).length>=2,'payment row created in BOTH match + split paths');

ok(/ADD COLUMN IF NOT EXISTS wave_invoice_id/.test(sql)&&/wave_customer_id/.test(sql)&&/last_synced_at/.test(sql)&&/sync_error/.test(sql),'SQL adds 4 wave-sync columns');
ok(/INSERT INTO accounting_invoice_payments/.test(sql)&&/FROM payment_matches pm/.test(sql)&&/NOT EXISTS/.test(sql),'SQL backfills payment rows from matches (dedup-guarded)');
ok(/UPDATE accounting_invoices ai SET/.test(sql)&&/wave_imported_paid/.test(sql),'SQL reconciles balances (preserves wave_imported_paid)');

ok(/sync_status === 'failed'/.test(ar)&&/pending Wave sync/.test(ar),'AR History shows failed + pending sync states');
ok(/>v55\.83-[A-Z]+</.test(p('src/app/page.jsx')),'page has version stamp');
ok(/version: 'v55\.83-AY'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AY');
console.log('\nv55.83-AY payment->wave sync: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
