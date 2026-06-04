// v55.83-J — NEXPAC parser + aggregator. Uses synthetic text items that mimic
// the pdf.js extraction layout (column x-anchors), covering the tricky cases:
// wrapped NT grade, wrapped two-word color, repeated page header rows.
var path = require('path');
(async function () {
  var m = await import('file://' + path.join(__dirname, '..', 'src/lib/nexpac-parse.js'));
  var fails = 0; function ok(n, c) { if (c) console.log('\u2713 ' + n); else { console.log('\u2717 ' + n); fails++; } }
  // x-anchors: num70 skew102 cgt258 nt341 prod475 color563 rolls632 weight678 yards738
  var X = { num:70, skew:102, cgt:258, nt:341, prod:475, color:563, rolls:632, weight:678 };
  var items = []; var Y = 1000;
  function row(cells, page){ var y = Y; Y -= 20; Object.keys(cells).forEach(function(k){ items.push({ x: X[k], y: y, page: page||1, str: String(cells[k]) }); }); return y; }
  function headerRow(page){ items.push({x:X.num,y:Y,page:page,str:'#'});items.push({x:X.nt,y:Y,page:page,str:'NT Grade'});items.push({x:X.color,y:Y,page:page,str:'Color'});items.push({x:X.rolls,y:Y,page:page,str:'Rolls'});items.push({x:X.weight,y:Y,page:page,str:'Weight'}); Y-=20; }

  // page-1 header lines (for parseHeader)
  items.push({x:60,y:1400,page:1,str:'Release # : 1002-1118'});
  items.push({x:60,y:1380,page:1,str:'Container: GCXU5384160'});
  items.push({x:60,y:1360,page:1,str:'Seal # : 100379'});
  items.push({x:60,y:1340,page:1,str:'Rolls 41'});
  items.push({x:60,y:1320,page:1,str:'Scale Tickets Gross 51920 23550.50'});
  items.push({x:60,y:1300,page:1,str:'Net Billable Weight 49888.5 22629.02'});
  items.push({x:60,y:1280,page:1,str:'NEXPAC BILLING'});

  headerRow(1);
  row({num:1, skew:'W.1', cgt:'Thirds USA', nt:'Grade A (Thirds) USA', prod:'Leather', color:'Black', rolls:10, weight:1000});
  row({num:2, skew:'W.2', cgt:'Thirds USA', nt:'Grade A (Thirds) USA', prod:'Leather', color:'Black', rolls:5, weight:500});
  // wrapped two-word color: "Dark" then continuation "Grey"
  row({num:3, skew:'W.3', cgt:'Thirds USA', nt:'Grade A (Thirds) USA', prod:'Leather', color:'Dark', rolls:9, weight:900});
  items.push({ x:X.color, y:Y, page:1, str:'Grey' }); Y-=20;   // continuation
  // wrapped NT grade: "Premium" then continuation "USA(Seconds)"
  row({num:4, skew:'W.4', cgt:'Thirds USA', nt:'Premium', prod:'Leather', color:'Havan', rolls:11, weight:1100});
  items.push({ x:X.nt, y:Y, page:1, str:'USA(Seconds)' }); Y-=20; // continuation
  // page 2 repeats the column header, then more Black (must merge, not split)
  headerRow(2);
  row({num:5, skew:'W.5', cgt:'Thirds USA', nt:'Grade A (Thirds) USA', prod:'Leather', color:'Black', rolls:6, weight:600}, 2);

  var r = m.parseNexpac(items, { rollTareFactor: 2.2 });
  console.log('groups', r.lines.length, 'orderRows', r.orderRows.length);

  ok('header release/container/seal parsed', r.header.releaseNumber==='1002-1118' && r.header.containerNumber==='GCXU5384160' && r.header.sealNumber==='100379');
  ok('header scale + net billable pairs', r.header.scaleGrossLbs===51920 && r.header.netBillableKgs===22629.02);
  ok('48-style: all 5 data rows captured', r.orderRows.length===5);

  var black = r.lines.find(function(g){return g.color==='Black';});
  ok('Black merged across pages (rows 1,2,5): 21 rolls, 2100 gross, 3 lines', black && black.totalRolls===21 && black.grossWeight===2100 && black.lineItems===3);
  ok('repeated page-2 header did NOT pollute NT grade', black && black.ntGrade==='Grade A (Thirds) USA');

  var dark = r.lines.find(function(g){return g.color==='Dark Grey';});
  ok('wrapped color "Dark Grey" reassembled', !!dark && dark.totalRolls===9);

  var prem = r.lines.find(function(g){return g.ktcGrade==='Standard Premium';});
  ok('wrapped NT grade reassembled + mapped to Standard Premium', !!prem && prem.color==='Havan' && prem.ntGrade==='Premium USA(Seconds)');

  // grade mapping
  ok('Grade A maps to Stock', m.ktcGradeFor('Grade A (Thirds) USA').grade==='Stock' && m.ktcGradeFor('Seconds USA').grade==='Stock');
  ok('Premium maps to Standard Premium', m.ktcGradeFor('Premium USA(Seconds)').grade==='Standard Premium');
  ok('SUEDE maps to Fortis', m.ktcGradeFor('SUEDE Back minimum').grade==='Fortis');
  ok('Obsolete maps to Luxurious', m.ktcGradeFor('Obsolete XYZ').grade==='Luxurious');
  ok('unknown grade flagged (mapped=false)', m.ktcGradeFor('Weird Grade').mapped===false);
  ok('Black group mapped to Stock', black && black.ktcGrade==='Stock');

  // kilos = lbs / 2.20462
  ok('final net kg = lbs / 2.20462', black && Math.abs(black.finalNetWeightKg - (black.finalNetWeight/2.20462)) < 0.001);
  ok('totals carry kg', Math.abs(r.totals.finalNetWeightKg - (r.totals.finalNetWeight/2.20462)) < 0.01);

  // tare math (Black: 21 rolls × 2.2 = 46.2; 3 lines × 55 = 165; net = 2100 − 211.2 = 1888.8)
  ok('roll tare uses 2.2/roll', black && Math.abs(black.rollTareWeight - 46.2) < 0.001);
  ok('pallet tare 55/line', black && black.palletTareWeight===165);
  ok('final net = gross − total tare', black && Math.abs(black.finalNetWeight - 1888.8) < 0.001);

  console.log('\n'+(fails===0?'ALL PASS':(fails+' FAILED')));
  process.exit(fails===0?0:1);
})();
