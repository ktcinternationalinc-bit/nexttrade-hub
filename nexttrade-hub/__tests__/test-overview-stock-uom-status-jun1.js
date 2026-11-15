var fs=require('fs');
var s=fs.readFileSync('src/components/InventoryOverview.jsx','utf8');
var f=[]; function ok(n,c){ if(!c) f.push(n); }
// #2 immediate stock + status
ok('receipts query pulls uom/kg/rolls/status', /select\('product_id, quantity, quantity_kg, roll_count, uom, status'\)/.test(s));
ok('pending stock counted into current_qty', /show stock immediately/.test(s) && /s\.current_qty \+= q;/.test(s));
ok('pending vs finalized tracked', /has_pending/.test(s) && /has_finalized/.test(s));
ok('status dot rendered (amber pending / emerald finalized)', /bg-amber-400/.test(s) && /bg-emerald-400/.test(s));
ok('status dot title text', /awaiting cost finalize/i.test(s));
// #1 UOM toggle
ok('uomView state', /var \[uomView, setUomView\]/.test(s));
ok('toggle buttons native/kg/rolls', /\['native', 'kg', 'rolls'\]/.test(s));
ok('current cell respects toggle', /uomView === 'kg' \? fmtNum\(s\.recv_kg/.test(s));
ok('recv_kg + recv_rolls summed from receipts', /s\.recv_kg \+= Number\(r\.quantity_kg/.test(s) && /s\.recv_rolls \+= Number\(r\.roll_count/.test(s));
// #4 UI cleanup (contrast/cohesion)
ok('table header dark', /thead className="bg-slate-950/.test(s));
ok('group container dark', /bg-slate-900 border border-slate-700 rounded-xl/.test(s));
ok('main grid cost cells use dark bg (not amber-50)', /text-amber-200 bg-slate-800\/60/.test(s));
ok('history link light on dark', /text-blue-300 hover:text-blue-100/.test(s));
if(f.length){ console.log('FAIL:\n - '+f.join('\n - ')); process.exit(1); }
console.log('PASS — overview stock-immediate + status dot + UOM toggle + UI cleanup ('+13+' checks)');
