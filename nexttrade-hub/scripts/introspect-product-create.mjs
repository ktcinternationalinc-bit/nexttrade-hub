// QA probe: does Wave's CURRENT ProductCreateInput still accept/require isSold & isBought?
// (Codex's MH removed them from productCreate; this settles whether that's correct.)
import fs from 'fs';
var env=''; try{env=fs.readFileSync(new URL('../.env.local',import.meta.url),'utf8');}catch(e){}
var tok=(env.match(/WAVE_ACCESS_TOKEN\s*=\s*"?([^"\r\n]+)"?/)||[])[1];
async function gql(q,v){var r=await fetch('https://gql.waveapps.com/graphql/public',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(tok||'')},body:JSON.stringify({query:q,variables:v||{}})});return r.json();}
function tn(t){if(!t)return'?';return t.name||(t.ofType?(t.kind==='NON_NULL'?tn(t.ofType)+'!':t.kind==='LIST'?'['+tn(t.ofType)+']':tn(t.ofType)):t.kind);}
var d=await gql('query($n:String!){ __type(name:$n){ name inputFields{ name type{ name kind ofType{ name kind ofType{ name kind } } } } } }',{n:'ProductCreateInput'});
var t=(d.data||{}).__type;
if(!t){console.log('NOT FOUND / '+JSON.stringify(d.errors||d).slice(0,200));process.exit(0);}
console.log('ProductCreateInput fields:');
(t.inputFields||[]).forEach(function(f){console.log('  '+f.name+': '+tn(f.type)+(/!$/.test(tn(f.type))?'   <-- REQUIRED':''));});
var names=(t.inputFields||[]).map(function(f){return f.name;});
console.log('\nisSold present? '+(names.indexOf('isSold')>=0)+' | isBought present? '+(names.indexOf('isBought')>=0));
