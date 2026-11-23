const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { transform } = require(process.env.SUCRASE_PATH || 'sucrase');
const root = path.resolve(__dirname,'..');
let manage = true, signedIn = true, calls=[];
const modules = new Map();
function load(file) {
  if(modules.has(file)) return modules.get(file);
  const m={exports:{}}; modules.set(file,m.exports);
  const requireLocal = name => {
    if(name.endsWith('/wave-history-server')) return {
      authorizeWaveHistory: async()=>{if(!signedIn)throw Object.assign(new Error('Sign in'),{status:401});return {db:{},actor:'actor',mayManage:manage};},
      waveHistoryRpc:async(db,name,args)=>{calls.push({name,args}); if(name==='wave_cash_source')return {file_name:'source.csv',raw_csv:'raw'};return {rows:2};}
    };
    if(name.startsWith('.')) return load(path.resolve(path.dirname(file),name.endsWith('.js')?name:name+'.js'));
    return require(name);
  };
  new Function('require','module','exports',transform(fs.readFileSync(file,'utf8'),{transforms:['imports','jsx']}).code)(requireLocal,m,m.exports);
  modules.set(file,m.exports);return m.exports;
}
const {GET,POST}=load(path.join(root,'src/app/api/wave-history/cash/route.js'));
const csv='Account Transactions\nNextrade LLC\nDate Range: 2021-01-01 to 2021-01-31\nReport Type: Cash Basis (Paid)\nACCOUNT NUMBER,DATE,DESCRIPTION,DEBIT (In Business Currency),CREDIT (In Business Currency),BALANCE (In Business Currency)\n,Bank,,,,\n,2021-01-02,Rent,,100,\nTotals and Ending Balance,,,0,100,\n,Rent,,,,\n,2021-01-02,Rent,100,,\nTotals and Ending Balance,,,100,0,\n';
function upload(action,fingerprint,text=csv) {const f=new FormData();f.set('csv',new Blob([text]),'source.csv');f.set('currency','USD');f.set('confirmed','true');f.set('action',action);if(fingerprint)f.set('fingerprint',fingerprint);return new Request('https://example.invalid/api/wave-history/cash',{method:'POST',body:f});}
const json=body=>new Request('https://example.invalid/api/wave-history/cash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 let n=0;const ok=c=>{assert(c);n++;};
 signedIn=false;ok((await GET(new Request('https://example.invalid/?from=2021-01-01&to=2021-01-31&currency=USD'))).status===401);
 signedIn=true;manage=false;ok((await POST(upload('preview'))).status===403);ok(calls.length===0);
 manage=true;const preview=await (await POST(upload('preview'))).json();ok(preview.preview.rows===2);ok(calls.length===0);
 ok((await POST(upload('save','wrong'))).status===409);ok(calls.length===0);
 ok((await POST(upload('save',preview.preview.fingerprint,csv.replace('Nextrade LLC','KTC')))).status===400);
 ok((await POST(upload('save',preview.preview.fingerprint))).status===200);
 ok(calls.at(-1).name==='wave_cash_save' && calls.at(-1).args.p_data.basis==='cash');
 ok(calls.at(-1).args.p_data.raw_csv===csv && calls.at(-1).args.p_data.entries[1].account_name==='Rent');
 calls=[];ok((await GET(new Request('https://example.invalid/?from=2021-02-31&to=2021-03-31&currency=USD'))).status===400);ok(calls.length===0);
 ok((await GET(new Request('https://example.invalid/?from=2021-01-01&to=2021-01-31&currency=USD&offset=-1'))).status===400);
 ok((await GET(new Request('https://example.invalid/?source=1'))).headers.get('Cache-Control')==='private, no-store');
 manage=false;ok((await POST(json({action:'mapping'}))).status===403);
 manage=true;ok((await POST(json({action:'mapping',account:'rent',kind:'expense',revision:0,nextrade:'rent',ktc:'rent'}))).status===200);
 ok(calls.at(-1).name==='wave_cash_map' && calls.at(-1).args.p_actor==='actor');
 ok((await POST(json({action:'mapping',account:'rent',kind:'made-up',revision:0,nextrade:null,ktc:null}))).status===400);
 console.log('Cash history real route with auth/RPC stand-ins: '+n+' checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
