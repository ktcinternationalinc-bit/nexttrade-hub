// ============================================================
// v55.59 — System Tickets fix regression test
//
// Bug fixed: System Tickets tab "didn't work" because the underlying
// system_tickets table either never existed in Supabase or was
// missing columns the component required. All previous "fixes"
// were code-only. The real fix is the SQL setup file.
// ============================================================

var fs = require('fs');
var path = require('path');

var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };

var passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log('✓ ' + label); passed++; }
  else { console.log('✗ ' + label); failed++; }
}

console.log('============================================================');
console.log('v55.59 — System Tickets fix regression');
console.log('============================================================\n');

// ---------- A: SQL setup file exists and is valid ----------
console.log('A. system-tickets-setup.sql shipped');
var sqlPath = path.join(REPO, 'supabase/system-tickets-setup.sql');
check('A.1 SQL file exists', fs.existsSync(sqlPath));
if (fs.existsSync(sqlPath)) {
  var sql = read('supabase/system-tickets-setup.sql');
  check('A.2 CREATE TABLE IF NOT EXISTS system_tickets',
    /CREATE TABLE IF NOT EXISTS system_tickets/.test(sql));
  check('A.3 has primary key UUID DEFAULT gen_random_uuid()',
    /id UUID DEFAULT gen_random_uuid\(\) PRIMARY KEY/.test(sql));
  check('A.4 has ticket_number column',
    /ticket_number TEXT/.test(sql));
  check('A.5 has all required columns: title description category priority status',
    /title TEXT NOT NULL/.test(sql)
    && /description TEXT/.test(sql)
    && /category TEXT/.test(sql)
    && /priority TEXT/.test(sql)
    && /status TEXT/.test(sql));
  check('A.6 has claude_review_requested column (Claude flag feature)',
    /claude_review_requested BOOLEAN/.test(sql));
  check('A.7 has ALTER TABLE ADD COLUMN IF NOT EXISTS for repair-mode',
    /ALTER TABLE system_tickets ADD COLUMN IF NOT EXISTS/.test(sql));
  check('A.8 RLS enabled with permissive policy',
    /ALTER TABLE system_tickets ENABLE ROW LEVEL SECURITY/.test(sql)
    && /CREATE POLICY "Allow all system_tickets"/.test(sql));
  check('A.9 idempotent — DO blocks catch duplicate_object',
    /EXCEPTION WHEN duplicate_object THEN NULL/.test(sql));
  check('A.10 indexes for status + created_at + claude_flag',
    /CREATE INDEX IF NOT EXISTS idx_system_tickets_status/.test(sql)
    && /CREATE INDEX IF NOT EXISTS idx_system_tickets_created_at/.test(sql)
    && /CREATE INDEX IF NOT EXISTS idx_system_tickets_claude_flag/.test(sql));
}

// ---------- B: SystemTicketsPanel — persistent error banner ----------
console.log('\nB. SystemTicketsPanel — persistent error banner');
var src = read('src/components/SystemTicketsPanel.jsx');
check('B.1 loadError state declared',
  /var \[loadError, setLoadError\] = useState\(null\)/.test(src));
check('B.2 createError state declared',
  /var \[createError, setCreateError\] = useState\(null\)/.test(src));
check('B.3 load() detects missing-table errors',
  /isMissingTable = \/does not exist\|schema cache\|could not find\.\*table\|404\|column \.\* does not exist\/i/.test(src));
check('B.4 load() sets loadError with kind:missing-table for that case',
  /setLoadError\(\{[\s\S]{0,200}kind: isMissingTable \? 'missing-table' : 'load-error'/.test(src));
check('B.5 create() also sets createError on failure',
  /setCreateError\(\{[\s\S]{0,200}kind: isMissingTable \? 'missing-table' : 'create-error'/.test(src));

// ---------- C: SystemTicketsPanel — banner is rendered ----------
console.log('\nC. SystemTicketsPanel — banner rendered, not just stored');
check('C.1 renders banner when loadError is set',
  /\{loadError && \(/.test(src));
check('C.2 banner shows different content for missing-table vs other',
  /loadError\.kind === 'missing-table' \? 'bg-amber-50/.test(src));
check('C.3 banner mentions the SQL file by name',
  /system-tickets-setup\.sql/.test(src));
check('C.4 missing-table banner says "Database setup required"',
  /Database setup required/.test(src));
check('C.5 generic load error has a "Try again" button',
  />\s*Try again\s*</.test(src));
check('C.6 createError banner inside the form',
  /\{createError && \(/.test(src));

// ---------- D: Build stamp ----------
console.log('\nD. Build stamp current');
var pageSrc = read('src/app/page.jsx');
check('D.1 header pill v55.59+',
  />v55\.(59|[6-9]\d)</.test(pageSrc));
var labels = pageSrc.match(/BUILD v55\.\d+-/g);
check('D.2 build modal stamp v55.59+',
  labels && labels.some(function(s) {
    var m = s.match(/v55\.(\d+)/);
    return m && parseInt(m[1], 10) >= 59;
  }));

// ---------- E: Earlier session fixes intact ----------
console.log('\nE. Earlier session fixes still intact');
check('E.1 v55.58 floating layout — phone bottom-4 left-4',
  /fixed bottom-4 left-4 w-12 h-12 rounded-full bg-green-500/.test(read('src/components/PhoneWidget.jsx')));
check('E.2 v55.57 ticket double-submit guard',
  /if \(creatingTicket\) return;/.test(read('src/components/TicketsTab.jsx')));
check('E.3 v55.56 phone health route present',
  fs.existsSync(path.join(REPO, 'src/app/api/phone/health/route.js')));
check('E.4 v55.51 customs SQL file present',
  fs.existsSync(path.join(REPO, 'supabase/customs-phase-1.sql')));

console.log('\n========================================');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');
if (failed > 0) {
  console.log('FAILURES indicate v55.59 system-tickets fix has been regressed.\n');
  process.exit(1);
}
console.log('✓ All v55.59 tests passed.\n');
