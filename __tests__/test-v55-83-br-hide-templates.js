var fs=require('fs');var path=require('path');
function p(f){return fs.readFileSync(path.join(__dirname,'..',f),'utf8');}
var pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log('  ✗ '+m);}}
var r=p('src/components/InventoryReceiving.jsx');
ok(/var \[includeTemplates, setIncludeTemplates\] = useState\(false\)/.test(r),'include-templates default off');
ok(/p\.is_family_template === true && !includeTemplates\) return false/.test(r),'templates excluded by default');
ok(/is_archived === true \|\| p\.status === 'archived'\) && !includeTemplates\) return false/.test(r),'archived excluded by default');
ok(/isSuperAdmin && \(/.test(r)&&/Include templates/.test(r),'admin-only include-templates checkbox');
ok(/checked=\{includeTemplates\}/.test(r),'checkbox bound to state');
// simulate filter behaviour
function passesFilter(prod, includeTemplates){ if(!prod.active) return false; if(prod.is_family_template===true && !includeTemplates) return false; if((prod.is_archived===true||prod.status==='archived') && !includeTemplates) return false; return true; }
ok(passesFilter({active:true,is_family_template:false},false)===true,'real active product shows');
ok(passesFilter({active:true,is_family_template:true},false)===false,'template hidden by default');
ok(passesFilter({active:true,is_family_template:true},true)===true,'template shows when admin opts in');
ok(passesFilter({active:true,status:'archived'},false)===false,'archived hidden by default');
ok(/version: 'v55\.83-BR'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew BR');
console.log('\nv55.83-BR hide templates: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
