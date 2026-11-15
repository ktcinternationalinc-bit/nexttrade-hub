var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var r=p('src/components/InventoryReceiving.jsx');
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
ok(/var uMerge = await supabase[\s\S]*?status: 'merged'/.test(r),'merge source-tag UPDATE result captured');
ok(/if \(uMerge && uMerge\.error\) \{ throw new Error\('Could not tag source line as merged/.test(r),'merge aborts loudly if tag-as-merged rejected (the silent-failure fix)');
ok(/var uRev = await supabase[\s\S]*?status: 'reversed'/.test(r),'unmerge reverse-target UPDATE result captured');
ok(/if \(uRev && uRev\.error\) \{ throw new Error\('Could not reverse target line/.test(r),'unmerge aborts if reverse rejected');
ok(/var uRestore = await supabase[\s\S]*?merged_into_shipment_id: null/.test(r),'unmerge restore-source UPDATE result captured');
ok(/if \(uRestore && uRestore\.error\) \{ throw new Error\('Could not restore source line/.test(r),'unmerge aborts if restore rejected');
ok((r.match(/\\+u[0-9a-fA-F]{4}/g)||[]).length===0,'no escaped unicode');
ok(/version: 'v55\.83-DG'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew DG');
console.log('\nv55.83-DG merge guards: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
