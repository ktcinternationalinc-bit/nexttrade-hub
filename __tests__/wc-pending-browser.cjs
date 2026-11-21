// Browser -> actual route -> isolated Postgres repair. No production services or credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
require('sucrase/register');
const {transform}=require('sucrase');
const {chromium}=require('playwright');
const {FakeDb}=require('./fake-supabase');
const root=path.resolve(__dirname,'..');
const {PGlite}=createRequire(path.join(process.env.PGLITE_DIR,'package.json'))('@electric-sql/pglite');
const U=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const pg=new PGlite();
let currentDb;
function stub(file,exports){const id=require.resolve(path.join(root,file));require.cache[id]={id,filename:id,loaded:true,exports};}
stub('src/app/api/plaid/_auth.js',{authorizePlaidOperation:async()=>({db:currentDb,isVerifiedSuperAdmin:true,profileId:U(998)}),plaidJson:(b,o)=>Response.json(b,o),plaidError:e=>Response.json({error:e.message},{status:500})});
stub('src/lib/bank-visibility.js',{readBankJson:r=>r.json()});
const route=require('../src/app/api/plaid/pending-repair/route');
const source=transform(fs.readFileSync(path.join(root,'src/components/PendingBankRepair.jsx'),'utf8'),{transforms:['jsx','imports']}).code;
const react=fs.readFileSync(require.resolve('react/package.json').replace('package.json','umd/react.development.js'),'utf8');
const reactDOM=fs.readFileSync(require.resolve('react-dom/package.json').replace('package.json','umd/react-dom.development.js'),'utf8');
const icons=fs.readFileSync(path.join(path.dirname(require.resolve('lucide-react/package.json')),'dist/umd/lucide-react.js'),'utf8');
const cssDir=path.join(root,'.next/static/css');
const css=fs.readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(cssDir,f),'utf8')).join('\n');
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'body{font-family:Arial;margin:16px;background:#f1f5f9}button,input{font:inherit}</style></head><body><p>WC isolated pending repair test. Synthetic records.</p><div id="root"></div><script>'+react+'</script><script>'+reactDOM+'</script><script>window.react=window.React;</script><script>'+icons+'</script><script>'+`
const m={exports:{}};const require=id=>id==='react'?React:id==='lucide-react'?LucideReact:id.includes('bank-visibility-client')?{bankSessionHeaders:async()=>({'Content-Type':'application/json'})}:{supabase:{}};
new Function('require','module','exports',${JSON.stringify(source)})(require,m,m.exports);
window.changed=0;ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(m.exports.default,{onChanged:()=>{window.changed++;}}));
`+'</script></body></html>';
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/api/plaid/pending-repair'){
      let body='';for await(const chunk of req)body+=chunk;
      currentDb=new FakeDb();
      currentDb.t.plaid_accounts=[{plaid_account_id:'A',connection_id:U(999),name:'Checking',mask:'6338'},{plaid_account_id:'B',connection_id:U(997),name:'Checking',mask:'6338'}];
      currentDb.t.bank_connections=[{id:U(999),institution_name:'Chase',status:'archived',created_at:'2026-01-01'},{id:U(997),institution_name:'Chase',status:'active',created_at:'2026-11-01'}];
      currentDb.t.bank_transactions=(await pg.query('select * from bank_transactions')).rows.map(r=>({...r,date:new Date(r.date).toISOString().slice(0,10),posted_date:r.posted_date?new Date(r.posted_date).toISOString().slice(0,10):null}));
      currentDb.rpc=async(name,args)=>{
        assert.ok(['hub_reconcile_pending','bank_duplicate_remove'].includes(name));
        try{return {data:name==='bank_duplicate_remove' ? (await pg.query('select bank_duplicate_remove($1,$2,$3,$4) as r',[args.p_dup,args.p_keep,args.p_actor,args.p_reason])).rows[0].r : (await pg.query('select hub_reconcile_pending($1,$2,$3) as r',[args.p_pending,args.p_posted,args.p_reason])).rows[0].r};}
        catch(e){return {error:{message:e.message}};}
      };
      const reply=await route.POST(new Request('http://fixture/api',{method:'POST',body}));
      res.statusCode=reply.status;res.setHeader('Content-Type','application/json');res.end(await reply.text());return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
});
(async()=>{
  await pg.exec(`create role anon;create role authenticated;create role service_role;
  create table bank_transactions(id uuid primary key default gen_random_uuid(),plaid_transaction_id text unique,pending_transaction_id text,
  account_id text,connection_id uuid,wave_business_id text,date date,posted_date date,amount numeric,amount_abs numeric,direction text,
  iso_currency text,pending boolean,name text,classification text,category_source text,category_verified boolean default false,
  review_status text,matched_invoice_id text,transfer_group_id text,linked_id text);
  create table vendor_bill_payments(id uuid primary key,bank_transaction_id uuid references bank_transactions(id),amount numeric,voided boolean default false);`);
  for(const file of ['SO-duplicates','TU-pending-settle','WC-pending-identity'])await pg.exec(fs.readFileSync(path.join(root,'sql/v55-83-'+file+'.sql'),'utf8'));
  for(const [n,pending,ref] of [[1,true,null],[2,false,'hold-1'],[3,true,null]]){
    await pg.query(`insert into bank_transactions(id,plaid_transaction_id,pending_transaction_id,account_id,connection_id,wave_business_id,
    date,posted_date,amount,amount_abs,direction,iso_currency,pending,name,review_status)
    values($1,$2,$3,'A',$4,'KTC','2026-11-17',$5,760.26,760.26,'out','USD',$6,$7,'unreviewed')`,
    [U(n),n===2?'posted-1':'hold-'+n,ref,U(999),pending?null:'2026-11-19',pending,n===3?'Unconfirmed pending hold':'Fixture fuel payment']);
  }
  await pg.query('insert into vendor_bill_payments values($1,$2,760.26,false)',[U(100),U(1)]);
  for(const [n,account,pending,name,amount] of [[4,'A',true,'Reconnect vendor payment',100],[5,'B',false,'Reconnect vendor payment',100],[6,'A',true,'Still pending duplicate hold',200],[7,'B',true,'Still pending duplicate hold',200]]){
    await pg.query(`insert into bank_transactions(id,plaid_transaction_id,account_id,connection_id,wave_business_id,date,posted_date,amount,amount_abs,direction,iso_currency,pending,name,review_status)
      values($1,$2,$3,$4,'KTC','2026-11-17',$5,$6,$6,'out','USD',$7,$8,'unreviewed')`,[U(n),'reconnect-'+n,account,account==='A'?U(999):U(997),pending?null:'2026-11-18',amount,pending,name]);
  }
  await pg.query('insert into vendor_bill_payments values($1,$2,100,false)',[U(101),U(5)]);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  if(process.argv.includes('--serve')){console.log('ISOLATED PENDING REPAIR PREVIEW '+url+' - synthetic data only');return;}
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser:',e.message);});
    await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
    await page.goto(url);await page.getByRole('button',{name:'Review pending records'}).click();
    const eligible=page.getByRole('checkbox',{name:'Repair Fixture fuel payment'});
    await eligible.waitFor();assert.equal(await page.getByRole('checkbox',{name:'Repair Unconfirmed pending hold'}).isDisabled(),true);
    assert.equal((await pg.query('select count(*)::int as n from hub_pending_identity_repairs')).rows[0].n,0);
    await eligible.check();
    const output=path.join(root,'output/wc-pending-browser');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.getByRole('button',{name:'Confirm repair (1)'}).click();await page.getByRole('status').filter({hasText:'1 repaired.'}).waitFor();
    const row=(await pg.query('select * from bank_transactions where id=$1',[U(1)])).rows[0];
    assert.equal(row.pending,false);assert.equal(row.plaid_transaction_id,'posted-1');
    const payment=(await pg.query('select * from vendor_bill_payments where id=$1',[U(100)])).rows;
    assert.equal(payment.length,1);assert.equal(payment[0].bank_transaction_id,U(1));assert.equal(Number(payment[0].amount),760.26);
    assert.equal(await page.evaluate(()=>window.changed),1);
    await page.getByRole('button',{name:'Refresh preview'}).click();await page.getByRole('checkbox',{name:'Repair Unconfirmed pending hold'}).waitFor();
    assert.equal(await page.getByRole('checkbox',{name:'Repair Fixture fuel payment'}).count(),0);
    await page.getByRole('checkbox',{name:'Repair Reconnect vendor payment'}).check();
    await page.getByRole('checkbox',{name:'Repair Still pending duplicate hold'}).first().check();
    await page.getByRole('button',{name:'Confirm repair (2)'}).click();
    await page.getByRole('status').filter({hasText:'2 repaired.'}).waitFor();
    assert.equal((await pg.query('select count(*)::int as n from bank_transactions where id in ($1,$2)',[U(4),U(6)])).rows[0].n,0);
    assert.equal((await pg.query('select pending from bank_transactions where id=$1',[U(7)])).rows[0].pending,true);
    const keptPayment=(await pg.query('select * from vendor_bill_payments where id=$1',[U(101)])).rows[0];
    assert.equal(keptPayment.bank_transaction_id,U(5));assert.equal(Number(keptPayment.amount),100);
    assert.equal((await pg.query("select count(*)::int as n from bank_transaction_duplicates where status='removed' and id in ($1,$2)",[U(4),U(6)])).rows[0].n,2);
    await pg.query('select bank_duplicate_restore($1,$2)',[U(4),U(998)]);
    assert.equal((await pg.query('select pending from bank_transactions where id=$1',[U(4)])).rows[0].pending,true);
    assert.deepEqual(errors,[]);
    console.log('PASS browser -> actual API -> Postgres: preview, exact settlement, reconnect archive/restore, posted bill payment preserved, duplicate pending keeper stays pending, reload, desktop/mobile framing.');
  }finally{await browser.close();server.close();await pg.close();}
})().catch(async e=>{console.error(e);server.close();if(!pg.closed)await pg.close();process.exitCode=1;});
