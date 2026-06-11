// Replicates src/lib/payment-matching.js logic to validate the money math.
function rm(n){return Math.round((Number(n)||0)*100)/100;}
function classifyApplication(t,p,a){var T=rm(t),P=rm(p),A=rm(a),N=rm(P+A),R=rm(T-P);var ty='invalid',ov=0,ap=A;
 if(A<=0)ty='invalid';else if(N<T)ty='partial';else if(N===T)ty='full';else{ty='overpayment';ov=rm(N-T);ap=R;}
 return{type:ty,applied_to_invoice:ap,overpayment:ov,balance_due:rm(Math.max(0,T-N))};}
function computeInvoiceBalance(t,ms){var T=rm(t),p=0;(ms||[]).forEach(m=>p+= (Number(m.matched_amount)||0));p=rm(p);var b=rm(T-p);var s=p<=0?'unpaid':p<T?'partial':p===T?'paid':'overpaid';return{amount_paid:p,balance_due:rm(Math.max(0,b)),status:s,overpaid_by:b<0?rm(-b):0};}
function validateSplit(t,ss){var T=rm(t),s=0;(ss||[]).forEach(x=>s+=(Number(x.split_amount)||0));s=rm(s);return{valid:s>0&&s<=rm(T+0.001),allocated:s,remaining:rm(T-s)};}
function allocatePayment(pay,apps){var P=rm(pay),a=0;(apps||[]).forEach(x=>a+=(Number(x.amount)||0));a=rm(a);var sp=rm(P-a);return{applied:a,unapplied:sp>0?sp:0,over_allocated:sp<0};}
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const approx=(a,b)=>Math.abs(a-b)<0.001;

// one→one full
let r=classifyApplication(1000,0,1000); ok(r.type==='full'&&approx(r.balance_due,0),'full payment clears invoice');
// partial
r=classifyApplication(1000,0,400); ok(r.type==='partial'&&approx(r.balance_due,600),'partial leaves 600 due');
// partial then completing
r=classifyApplication(1000,400,600); ok(r.type==='full'&&approx(r.balance_due,0),'second payment completes invoice');
// overpayment -> credit
r=classifyApplication(1000,0,1200); ok(r.type==='overpayment'&&approx(r.applied_to_invoice,1000)&&approx(r.overpayment,200),'overpayment: 1000 applied, 200 to credit');
// many payments → one invoice
let b=computeInvoiceBalance(1000,[{matched_amount:300},{matched_amount:300},{matched_amount:400}]); ok(b.status==='paid'&&approx(b.amount_paid,1000),'three deposits fully pay one invoice');
b=computeInvoiceBalance(1000,[{matched_amount:400}]); ok(b.status==='partial'&&approx(b.balance_due,600),'one partial → partial status, 600 due');
b=computeInvoiceBalance(1000,[]); ok(b.status==='unpaid'&&approx(b.amount_paid,0),'no matches → unpaid');
b=computeInvoiceBalance(1000,[{matched_amount:1200}]); ok(b.status==='overpaid'&&approx(b.overpaid_by,200),'overpaid flagged');
// split validation
let s=validateSplit(1000,[{split_amount:600},{split_amount:400}]); ok(s.valid&&approx(s.remaining,0),'split 600+400 of 1000 valid');
s=validateSplit(1000,[{split_amount:600},{split_amount:500}]); ok(!s.valid,'split exceeding txn rejected');
s=validateSplit(1000,[{split_amount:600}]); ok(s.valid&&approx(s.remaining,400),'partial split leaves remainder');
// allocate payment → unapplied
let a=allocatePayment(1000,[{amount:700}]); ok(approx(a.unapplied,300),'700 applied, 300 unapplied deposit');
a=allocatePayment(1000,[{amount:600},{amount:400}]); ok(approx(a.unapplied,0)&&!a.over_allocated,'fully allocated deposit, nothing unapplied');
a=allocatePayment(1000,[{amount:1100}]); ok(a.over_allocated,'over-allocation detected');

console.log('\nPayment-matching math: '+pass+' passed, '+fail+' failed');
if(fail>0){console.log('MATH INVALID');process.exit(1);}console.log('ALL MATCHING IDENTITIES HOLD');
