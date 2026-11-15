import fs from 'fs';
var env=''; try{env=fs.readFileSync(new URL('../.env.local',import.meta.url),'utf8');}catch(e){}
var tok=(env.match(/WAVE_ACCESS_TOKEN\s*=\s*"?([^"\r\n]+)"?/)||[])[1];
async function gql(q,v){var r=await fetch('https://gql.waveapps.com/graphql/public',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(tok||'')},body:JSON.stringify({query:q,variables:v||{}})});return r.json();}
for (var n of ['AREstimate','EstimateItem']) {
  var d=await gql('query($n:String!){ __type(name:$n){ name fields{ name } } }',{n:n});
  var t=(d.data||{}).__type;
  console.log('=== '+n+' ===');
  console.log(t&&t.fields?t.fields.map(function(f){return f.name;}).join(', '):'NOT FOUND '+JSON.stringify(d.errors||'').slice(0,150));
}
