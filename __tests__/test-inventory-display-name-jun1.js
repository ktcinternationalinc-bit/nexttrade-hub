var fs=require('fs');
var src=fs.readFileSync('src/components/InventoryOverview.jsx','utf8');
var f=[];
function ok(n,c){ if(!c) f.push(n); }
ok('stored name_en is primary source', /displayNameEn = \(p\.name_en && p\.name_en\.trim\(\)\) \? p\.name_en :/.test(src));
ok('stored name_ar is primary source', /displayNameAr = \(p\.name_ar && p\.name_ar\.trim\(\)\) \? p\.name_ar :/.test(src));
ok('family-aware fallback present', /function famOrder/.test(src));
ok('Leather/Textile order = Family Cat Grade Construction Backing Color',
   /return \['family_list_id','category_list_id','grade_list_id','construction_list_id','backing_list_id','color_list_id'\];/.test(src));
ok('PVC/Boat order puts color before backing then pattern spec',
   /'construction_list_id','color_list_id','backing_list_id','pattern_list_id','spec_class_list_id'/.test(src));
ok('uses real codes P/B for 8-field', /c === 'P' \|\| c === 'B'/.test(src));
ok('word de-dupe present', /function dedupeWords/.test(src));
ok('skips noise labels (not applicable/none)', /'not applicable': 1/.test(src));
ok('OLD live rebuild removed (no computedNameEn cat/grade/color/backing)', !/var computedNameEn = \[catLbl, grdLbl, clrLbl, bckLbl\]/.test(src));
if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — inventory display name now driven by stored name_en ('+9+' checks)');
