// ============================================================
// v55.74 — Periodic backups of business-critical tables
//
// Reported by Max May 7 2026: "Please make periodic backups of
// any type of items that are crucial to our business such as
// tickets, things like that, every once in a while, please
// including right now."
//
// Architecture:
//   • New backups table (sql/s42_backups.sql) — JSONB blob per snapshot
//   • /api/backup/snapshot — creates a snapshot
//       GET (cron):  always daily; +weekly on Sundays; +monthly on 1st
//       POST (button): manual snapshot from super_admin's dashboard
//   • /api/backup/list — metadata-only list (excludes huge data column)
//   • /api/backup/download?id=X — downloads one snapshot as JSON
//   • /api/backup/manage — DELETE for removal, POST for pin toggle
//   • Daily cron at 8 AM UTC (= 4 AM ET) added to vercel.json
//   • Retention: 7 daily / 4 weekly / 12 monthly / 30 days for manual
//     unless 📌 pinned
//   • New BackupsPanel UI in AdminTab → "💾 Backups" section
//   • Section visible to super_admin ONLY (regular admins can't see)
//
// Tables backed up: 47 (tier 1 financial + tier 2 operational).
// Tier 3 logs (notifications, phone, whatsapp, login events, AI
// memory caches) deliberately excluded.
// ============================================================

var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };
var exists = function (rel) { try { return fs.statSync(path.join(REPO, rel)).isFile(); } catch (_) { return false; } };

var passed = 0, failed = 0, failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; failures.push({label, detail}); if (detail) console.log('     ' + detail); }
}
function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

console.log('============================================================');
console.log('v55.74 — Periodic backups of business-critical tables');
console.log('============================================================');

// ============================================================
// 1. SQL migration
// ============================================================
group('1. sql/s42_backups.sql migration');

var sql = exists('sql/s42_backups.sql') ? read('sql/s42_backups.sql') : '';

check('1.1 s42_backups.sql exists', sql.length > 500);
check('1.2 Creates backups table', /CREATE TABLE IF NOT EXISTS backups/.test(sql));
check('1.3 Has kind column with check constraint',
  /CHECK \(kind IN \('manual','daily','weekly','monthly'\)\)/.test(sql));
check('1.4 Has data JSONB column for the snapshot blob',
  /data JSONB DEFAULT '\{\}'::JSONB/.test(sql));
check('1.5 Has tables_included TEXT[] column',
  /tables_included TEXT\[\]/.test(sql));
check('1.6 Has row_counts JSONB column',
  /row_counts JSONB/.test(sql));
check('1.7 Has size_bytes BIGINT',
  /size_bytes BIGINT/.test(sql));
check('1.8 Has pinned BOOLEAN column for retention exemption',
  /pinned BOOLEAN DEFAULT FALSE/.test(sql));
check('1.9 Has triggered_by + triggered_by_name for audit',
  /triggered_by UUID/.test(sql) && /triggered_by_name TEXT/.test(sql));
check('1.10 Index on created_at DESC for fast list ordering',
  /CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups\(created_at DESC\)/.test(sql));
check('1.11 Index on (kind, created_at) for retention queries',
  /idx_backups_kind ON backups\(kind, created_at DESC\)/.test(sql));
check('1.12 Has 4 RLS policies (select/insert/update/delete)',
  (sql.match(/CREATE POLICY backups_(select|insert|update|delete)/g) || []).length === 4);
check('1.13 Idempotent — uses IF NOT EXISTS / DROP POLICY IF EXISTS',
  /CREATE TABLE IF NOT EXISTS backups/.test(sql)
  && /DROP POLICY IF EXISTS backups_select/.test(sql));
check('1.14 NOTIFY pgrst, \'reload schema\' for PostgREST cache',
  /NOTIFY pgrst, 'reload schema'/.test(sql));
check('1.15 Sanity-check SELECT returns ok=true rows',
  /SELECT[\s\S]*'✅ backups table'[\s\S]*EXISTS/.test(sql));

// ============================================================
// 2. Snapshot API route
// ============================================================
group('2. /api/backup/snapshot route');

var snap = exists('src/app/api/backup/snapshot/route.js') ? read('src/app/api/backup/snapshot/route.js') : '';

check('2.1 Snapshot route file exists', snap.length > 1000);
check('2.2 Uses var + string concat (no template literals — SWC rule)',
  // No backticks, no template-string interpolation
  !/`[^`]*\$\{/.test(snap));
check('2.3 Uses var (not let/const) for module state — SWC rule',
  /var supabase = createClient/.test(snap)
  && !/^const supabase = createClient/m.test(snap)
  && !/^let supabase = createClient/m.test(snap));
check('2.4 Exports maxDuration = 300 for long-running snapshots',
  /export var maxDuration = 300/.test(snap));
check('2.5 BACKUP_TABLES array includes tier-1 financials',
  /'tickets'/.test(snap)
  && /'invoices'/.test(snap)
  && /'treasury'/.test(snap)
  && /'checks'/.test(snap)
  && /'customers'/.test(snap)
  && /'inventory'/.test(snap));
check('2.6 BACKUP_TABLES includes HR tables',
  /'hr_requests'/.test(snap) && /'hr_complaints'/.test(snap));
check('2.7 BACKUP_TABLES does NOT include tier-3 noise tables',
  !/'notifications'/.test(snap)
  && !/'phone_calls'/.test(snap)
  && !/'whatsapp_messages'/.test(snap)
  && !/'translation_cache'/.test(snap));
check('2.8 ROW_CAP_PER_TABLE defensive limit set',
  /var ROW_CAP_PER_TABLE = \d+/.test(snap));
check('2.9 MAX_TOTAL_SIZE_BYTES guard against runaway JSONB size',
  /var MAX_TOTAL_SIZE_BYTES =/.test(snap));
check('2.10 snapshotOneTable wraps each fetch in its own try/catch',
  /async function snapshotOneTable\(tableName\)[\s\S]{0,300}try \{/.test(snap));
check('2.11 Tables fetched sequentially (not Promise.all) — preserves memory + ordering',
  /for \(var i = 0; i < BACKUP_TABLES\.length; i\+\+\)/.test(snap));
check('2.12 Records errors per-table without crashing the whole backup',
  /tablesWithErrors\.push/.test(snap));
check('2.13 Tracks cumulative size, skips tables once cap reached',
  /skippedForSize\.push/.test(snap)
  && /cumulativeSize > MAX_TOTAL_SIZE_BYTES/.test(snap));
check('2.14 Computes size_bytes via Buffer.byteLength on JSON serialization',
  /Buffer\.byteLength\(JSON\.stringify\(data\), 'utf8'\)/.test(snap));
check('2.15 Inserts row into backups table with all metadata',
  /supabase\.from\('backups'\)\.insert\(insertRow\)/.test(snap));
check('2.16 Calls runRetention after successful insert',
  /var retentionDeleted = await runRetention\(\)/.test(snap));
check('2.17 Retention: keeps last 7 daily',
  /\.eq\('kind', 'daily'\)[\s\S]{0,300}\.slice\(7\)/.test(snap));
check('2.18 Retention: keeps last 4 weekly',
  /\.eq\('kind', 'weekly'\)[\s\S]{0,300}\.slice\(4\)/.test(snap));
check('2.19 Retention: keeps last 12 monthly',
  /\.eq\('kind', 'monthly'\)[\s\S]{0,300}\.slice\(12\)/.test(snap));
check('2.20 Retention: deletes manual older than 30 days unless pinned',
  /thirtyDaysAgo[\s\S]{0,200}\.eq\('kind', 'manual'\)[\s\S]{0,200}\.eq\('pinned', false\)/.test(snap));
check('2.21 Retention: pinned backups are exempt (every retention query filters pinned=false)',
  (snap.match(/\.eq\('pinned', false\)/g) || []).length >= 4);
check('2.22 GET handler — promotes to weekly on Sundays',
  /dayOfWeek === 0[\s\S]{0,200}performBackup\(\{ kind: 'weekly' \}\)/.test(snap));
check('2.23 GET handler — promotes to monthly on day 1',
  /dayOfMonth === 1[\s\S]{0,200}performBackup\(\{ kind: 'monthly' \}\)/.test(snap));
check('2.24 GET handler computes day of week in Eastern Time (KTC business calendar)',
  /timeZone: 'America\/New_York'/.test(snap));
check('2.25 GET handler accepts ?kind=X override for debugging',
  /var explicitKind = url\.searchParams\.get\('kind'\)/.test(snap));
check('2.26 POST handler accepts body with kind, triggered_by, notes, pinned',
  /var kind = body\.kind \|\| 'manual'/.test(snap)
  && /triggered_by: body\.triggered_by/.test(snap)
  && /notes: body\.notes/.test(snap)
  && /pinned: !!body\.pinned/.test(snap));
check('2.27 Validates kind value (rejects invalid kinds)',
  /'invalid kind'/.test(snap));
check('2.28 Returns ok=false on errors (does not crash)',
  /\{ ok: false, error:/.test(snap));

// ============================================================
// 3. List API route
// ============================================================
group('3. /api/backup/list route');

var lst = exists('src/app/api/backup/list/route.js') ? read('src/app/api/backup/list/route.js') : '';

check('3.1 List route exists', lst.length > 200);
check('3.2 Uses var + no template literals',
  /var supabase/.test(lst) && !/`[^`]*\$\{/.test(lst));
check('3.3 Explicitly EXCLUDES the data column from select (huge column)',
  /\.select\('id, created_at, kind, triggered_by, triggered_by_name, tables_included, row_counts, size_bytes, duration_ms, notes, pinned'\)/.test(lst));
check('3.4 Orders by created_at DESC',
  /\.order\('created_at', \{ ascending: false \}\)/.test(lst));
check('3.5 Returns { ok: true, backups: [] } shape',
  /ok: true, backups:/.test(lst));

// ============================================================
// 4. Download API route
// ============================================================
group('4. /api/backup/download route');

var dl = exists('src/app/api/backup/download/route.js') ? read('src/app/api/backup/download/route.js') : '';

check('4.1 Download route exists', dl.length > 200);
check('4.2 Uses var + no template literals',
  /var supabase/.test(dl) && !/`[^`]*\$\{/.test(dl));
check('4.3 Has maxDuration export for big-backup downloads',
  /export var maxDuration =/.test(dl));
check('4.4 Reads ?id=X from URL params',
  /url\.searchParams\.get\('id'\)/.test(dl));
check('4.5 Returns 400 if id is missing',
  /'missing id'[\s\S]{0,200}status: 400/.test(dl));
check('4.6 Returns 404 if backup not found',
  /'not found'[\s\S]{0,200}status: 404/.test(dl));
check('4.7 Sets Content-Disposition header for browser download',
  /'Content-Disposition': 'attachment; filename=/.test(dl));
check('4.8 Filename includes kind + date + short id for uniqueness',
  /'ktc-backup-' \+ \(res\.data\.kind/.test(dl));

// ============================================================
// 5. Manage API route (delete + pin)
// ============================================================
group('5. /api/backup/manage route');

var mng = exists('src/app/api/backup/manage/route.js') ? read('src/app/api/backup/manage/route.js') : '';

check('5.1 Manage route exists', mng.length > 200);
check('5.2 Uses var + no template literals',
  /var supabase/.test(mng) && !/`[^`]*\$\{/.test(mng));
check('5.3 Has DELETE handler',
  /export async function DELETE\(/.test(mng));
check('5.4 Has POST handler for pin/notes update',
  /export async function POST\(/.test(mng));
check('5.5 DELETE rejects missing id with 400',
  /'missing id'[\s\S]{0,200}status: 400/.test(mng));
check('5.6 POST accepts pinned: boolean',
  /typeof body\.pinned === 'boolean'/.test(mng));
check('5.7 POST accepts notes: string',
  /typeof body\.notes === 'string'/.test(mng));
check('5.8 POST rejects empty update with 400',
  /'nothing to update'/.test(mng));

// ============================================================
// 6. BackupsPanel UI component
// ============================================================
group('6. BackupsPanel UI component');

var bp = exists('src/components/BackupsPanel.jsx') ? read('src/components/BackupsPanel.jsx') : '';

check('6.1 BackupsPanel.jsx exists', bp.length > 2000);
check('6.2 Has \'use client\' directive',
  /^'use client';/.test(bp));
check('6.3 Default export is the component',
  /export default function BackupsPanel/.test(bp));
check('6.4 Loads backups via /api/backup/list on mount',
  /fetch\('\/api\/backup\/list'\)/.test(bp));
check('6.5 Run-now button calls POST /api/backup/snapshot',
  /fetch\('\/api\/backup\/snapshot', \{[\s\S]{0,200}method: 'POST'/.test(bp));
check('6.6 Run-now sends kind: \'manual\' + triggered_by + name',
  /kind: 'manual'/.test(bp)
  && /triggered_by: triggeredBy/.test(bp)
  && /triggered_by_name: triggeredByName/.test(bp));
check('6.7 Run-now disables button while running (prevents double-fire)',
  /disabled=\{running\}/.test(bp));
check('6.8 Download button uses window.open() to download via Content-Disposition',
  /window\.open\('\/api\/backup\/download\?id=' \+ encodeURIComponent\(id\)/.test(bp));
check('6.9 Pin toggle calls POST /api/backup/manage',
  /fetch\('\/api\/backup\/manage', \{[\s\S]{0,200}method: 'POST'[\s\S]{0,200}pinned: !b\.pinned/.test(bp));
check('6.10 Delete button confirms before DELETE request',
  /window\.confirm\(/.test(bp)
  && /method: 'DELETE'/.test(bp));
check('6.11 Renders kind badges (Manual/Daily/Weekly/Monthly)',
  /'👆 Manual'/.test(bp)
  && /'☀️ Daily'/.test(bp)
  && /'📅 Weekly'/.test(bp)
  && /'🗓 Monthly'/.test(bp));
check('6.12 Shows pinned indicator on pinned backups',
  /b\.pinned && <span/.test(bp));
check('6.13 Has empty state when zero backups',
  /No backups yet/.test(bp));
check('6.14 Has loading state',
  /Loading backups…/.test(bp));
check('6.15 Has error banner for failed operations',
  /\{error && \(/.test(bp));
check('6.16 Has retention explanation in collapsible <details>',
  /<details/.test(bp)
  && /How retention works/.test(bp));
check('6.17 Formats sizes (B/KB/MB/GB)',
  /function fmtBytes\(n\)/.test(bp));
check('6.18 Formats dates in Eastern Time',
  // v55.80: BackupsPanel now delegates to the shared fmtET helper which
  // is ET-aware by construction. We assert it imports the helper AND the
  // fmtDate function uses fmtET — both together prove ET formatting.
  /from '\.\.\/lib\/et-time'/.test(bp)
  && /function fmtDate\([\s\S]{0,200}fmtET\(/.test(bp));
check('6.19 Header card shows summary stats (snapshots count, last backup, total size, total rows)',
  /Snapshots[\s\S]{0,400}Last Backup[\s\S]{0,400}Total Size[\s\S]{0,400}Total Rows/.test(bp));
check('6.20 Last-result success banner with table count + duration',
  /Backup complete[\s\S]{0,300}lastResult\.tables_count[\s\S]{0,300}fmtDuration\(lastResult\.duration_ms\)/.test(bp));
check('6.21 Refresh button reloads the list',
  /onClick=\{load\}/.test(bp));

// ============================================================
// 7. AdminTab integration — super_admin only gating
// ============================================================
group('7. AdminTab integration — super_admin gate');

var at = exists('src/components/AdminTab.jsx') ? read('src/components/AdminTab.jsx') : '';

check('7.1 AdminTab imports BackupsPanel', /import BackupsPanel from '\.\/BackupsPanel'/.test(at));
check('7.2 Backups section ONLY in nav for super_admin',
  /isSuperAdmin \? \[\['backups','💾 Backups'\]\] : \[\]/.test(at));
check('7.3 Renders BackupsPanel when section==="backups" AND isSuperAdmin',
  /section === 'backups' && isSuperAdmin/.test(at));
check('7.4 Shows access-denied banner for non-super-admins (defensive)',
  /section === 'backups' && !isSuperAdmin[\s\S]{0,400}only available to super_admin/.test(at));
check('7.5 Backups section comes AFTER existing sections (preserves order)',
  at.indexOf("'audit','🔍 Audit'") < at.indexOf("'backups','💾 Backups'"));

// ============================================================
// 8. Vercel cron registered
// ============================================================
group('8. Daily cron registered in vercel.json');

var vj = JSON.parse(read('vercel.json'));

check('8.1 vercel.json has crons array', Array.isArray(vj.crons));
check('8.2 Backup cron registered',
  vj.crons.some(function (c) { return c.path === '/api/backup/snapshot'; }));
check('8.3 Cron runs daily at 8 AM UTC = 4 AM ET',
  vj.crons.some(function (c) { return c.path === '/api/backup/snapshot' && c.schedule === '0 8 * * *'; }));
check('8.4 Cron path has NO query string (Vercel rejects those)',
  vj.crons.every(function (c) { return c.path.indexOf('?') === -1; }));
check('8.5 Existing crons preserved (categorize, reminders, occurrences, nadia, transcribe)',
  vj.crons.some(function (c) { return c.path === '/api/categorize'; })
  && vj.crons.some(function (c) { return c.path === '/api/reminders/dispatch'; })
  && vj.crons.some(function (c) { return c.path === '/api/events/generate-occurrences'; })
  && vj.crons.some(function (c) { return c.path === '/api/nadia/watch'; })
  && vj.crons.some(function (c) { return c.path === '/api/phone/transcribe-cron'; }));

// ============================================================
// 9. Edge cases — defensive design
// ============================================================
group('9. Edge cases');

check('9.1 Snapshot of missing/RLS-denied table returns empty rows + error note (no crash)',
  /return \{ rows: \[\], error: res\.error\.message \|\| 'unknown error', count: 0 \}/.test(snap));
check('9.2 Run Backup Now button is disabled while previous run in progress',
  /disabled=\{running\}/.test(bp));
check('9.3 Pinned backups exempt from EVERY retention pass (daily, weekly, monthly, manual)',
  (snap.match(/\.eq\('pinned', false\)/g) || []).length >= 4);
check('9.4 Retention failure does NOT fail the backup (caught + logged)',
  /catch \(e\)[\s\S]{0,200}\[backup\] retention pass error/.test(snap));
check('9.5 ROW_CAP_PER_TABLE prevents one giant table from breaking the snapshot',
  /\.limit\(ROW_CAP_PER_TABLE\)/.test(snap));
check('9.6 List endpoint never returns the data column (would be huge over wire)',
  // Whitelist of columns that DOESN'T include 'data'
  /\.select\('id, created_at, kind/.test(lst)
  && !/\.select\('\*'\)/.test(lst));
check('9.7 Download confirms id present before query (avoids "*" leak)',
  /if \(!id\)[\s\S]{0,200}'missing id'/.test(dl));
check('9.8 Manage DELETE confirms id present',
  /if \(!id\)[\s\S]{0,200}'missing id'/.test(mng));

// ============================================================
// 10. Carry-forward — earlier work intact
// ============================================================
group('10. Carry-forward — v55.65 → v55.73 still intact');

check('10.1 v55.71 — three avatar tiles still rendered',
  /who="nadia"/.test(read('src/components/AssistantsBar.jsx'))
  && /who="jenna"/.test(read('src/components/AssistantsBar.jsx'))
  && /who="sara"/.test(read('src/components/AssistantsBar.jsx')));
check('10.2 v55.71 — three real photos still in public/avatars/',
  exists('public/avatars/nadia.png')
  && exists('public/avatars/jenna.png')
  && exists('public/avatars/sara.png'));
check('10.3 v55.72 — formatBodyAsHtml still in /api/notify',
  /function formatBodyAsHtml\(raw\)/.test(read('src/app/api/notify/route.js')));
check('10.4 v55.73 — agent personalities config still present',
  /AGENT_PERSONALITIES = \{/.test(read('src/lib/agent-personalities.js')));
check('10.5 v55.73 — Jenna intro in HR modals still present',
  /AGENT_PERSONALITIES\.jenna\.greeting/.test(read('src/components/MyHRDesk.jsx')));
check('10.6 v55.73 — recipient radio buttons still present',
  /name="hr-recipient"/.test(read('src/components/MyHRDesk.jsx')));
check('10.7 v55.73 — submitRequest dispatches /api/notify',
  /submitRequest = async function[\s\S]*?fetch\('\/api\/notify'/.test(read('src/components/MyHRDesk.jsx')));
check('10.8 v55.69 — ticket optimistic save still wired',
  /savingRef/.test(read('src/components/TicketsTab.jsx')));
check('10.9 v55.65 — voicemail trim="do-not-trim" still in place',
  /trim="do-not-trim"/.test(read('src/app/api/phone/voicemail-record/route.js')));
check('10.10 sql/s41 has RLS policies (so HR forms can submit)',
  /CREATE POLICY hr_requests_insert ON hr_requests/.test(read('sql/s41_hr_desk_requests_complaints.sql')));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f.label); if (f.detail) console.log('     ' + f.detail); });
  process.exit(1);
}
console.log('\n✅ All ' + passed + ' tests passed');
