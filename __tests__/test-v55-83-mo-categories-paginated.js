// v55.83-MO — "only 33 Wave categories showing instead of all of them": /api/wave/categories read
// wave_categories with NO pagination, so Supabase's 1000-row cap silently dropped rows in a silo with ~1877
// (Wave auto-creates a SYSTEM A/R sub-account per invoice). Real categories beyond row 1000 vanished from the
// dropdown. Fix: paginate the read so ALL rows are present before filtering.
var fs = require('fs'); var path = require('path');
var failures = [];
function ok(l, c) { if (c) console.log('OK ' + l); else { failures.push(l); console.log('FAIL ' + l); } }
function rd(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
var route = rd('src/app/api/wave/categories/route.js');
ok('1: the category read is PAGINATED (range loop), not a single capped select', /while \(pgGuard < 60\)/.test(route) && /\.range\(pgFrom, pgFrom \+ pgSz - 1\)/.test(route) && /all = all\.concat\(pgRows\)/.test(route) && /if \(pgRows\.length < pgSz\) \{ break; \}/.test(route));
ok('2: no un-paginated single select of wave_categories remains', !/var res = await db\.from\('wave_categories'\)\.select\([^)]*\)\.eq\('wave_business_id', waveBusinessId\);/.test(route));
console.log('');
if (failures.length === 0) { console.log('PASS'); process.exit(0); } else { console.log(failures.length + ' FAILED'); process.exit(1); }
