// v55.83-VZ — REAL Postgres (PGlite) proof of sql/v55-83-VZ-proforma-links-signed.sql, run twice:
//  • links: one ACTIVE link per invoice, many invoices per proforma, unlink keeps the row, a row is never deleted or rewritten
//  • signed files: versions are added, never changed, never deleted; a proforma with a signed file or a link cannot be deleted
//  • the browser roles (anon / authenticated) can read or write neither table; the Hub server role can
//  • the private store "proforma-signed" exists, is not public, and no storage rule reaches it
// Needs PGLITE_DIR (not a project dependency). Exit 2 = skipped, nothing checked.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var req = createRequire(path.join(process.env.PGLITE_DIR || root, 'package.json'));
var PGlite;
try { PGlite = (await import('file://' + req.resolve('@electric-sql/pglite').replace(/\\/g, '/'))).PGlite; }
catch (e) { console.log('SKIPPED — @electric-sql/pglite not found (set PGLITE_DIR). Nothing was checked.'); process.exit(2); }
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra))); }
var db = new PGlite();
console.log('VZ — proforma links + signed files SQL (real Postgres)');
var file = path.join(root, 'sql', 'v55-83-VZ-proforma-links-signed.sql');
var text = fs.readFileSync(file, 'utf8');
check('the script has no comment lines', !/^\s*--/m.test(text) && text.indexOf('/*') < 0);
check('the script never drops a table, deletes rows or touches the invoice / proforma tables', !/DROP TABLE|DELETE FROM|TRUNCATE TABLE|ALTER TABLE public\.accounting_(invoices|proformas)\b/i.test(text));
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE POLICY bills_private_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'bills-private');
  CREATE TABLE public.accounting_proformas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proforma_number text, status text, converted_invoice_id uuid, record_status text);
  CREATE TABLE public.accounting_invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_number text);
`);
var P1 = '00000000-0000-0000-0000-0000000000a1', P2 = '00000000-0000-0000-0000-0000000000a2', P3 = '00000000-0000-0000-0000-0000000000a3';
var I1 = '00000000-0000-0000-0000-0000000000b1', I2 = '00000000-0000-0000-0000-0000000000b2';
await db.query("INSERT INTO public.accounting_proformas (id, proforma_number) VALUES ($1,'PF-1'),($2,'PF-2'),($3,'PF-3')", [P1, P2, P3]);
await db.query("INSERT INTO public.accounting_invoices (id, invoice_number) VALUES ($1,'INV-1'),($2,'INV-2')", [I1, I2]);
for (var n = 1; n <= 2; n++) { var e = null; try { await db.exec(text); } catch (x) { e = String(x.message || x); } check('the script runs (time ' + n + ')', !e, e); }
async function q(sql, params) { try { var r = await db.query(sql, params || []); return { rows: r.rows, count: r.affectedRows }; } catch (x) { return { error: String(x.message || x) }; } }
async function as(role, sql, params) { await db.exec('SET ROLE ' + role); var r = await q(sql, params); await db.exec('RESET ROLE'); return r; }
var L = 'public.accounting_proforma_invoice_links', F = 'public.accounting_proforma_signed_files';
var closing = text.substring(text.lastIndexOf('\nSELECT'));

var v = (await q(closing)).rows[0];
check('the closing check row says everything is in place', v && v.links_table === 'OK' && v.signed_files_table === 'OK' && v.signed_store === 'OK private' && /^OK/.test(v.store_access), v);
var bk = (await q("SELECT * FROM storage.buckets WHERE id = 'proforma-signed'")).rows;
check('the store is private, 15 MB, pdf / jpeg / png / webp only, created once', bk.length === 1 && bk[0].public === false && Number(bk[0].file_size_limit) === 15728640 && bk[0].allowed_mime_types.join() === 'application/pdf,image/jpeg,image/png,image/webp', bk);
await db.exec("CREATE POLICY open_all ON storage.objects FOR SELECT TO authenticated USING (true)");
var v2 = (await q(closing)).rows[0];
check('a storage rule that is not limited to one store is reported by the closing check', /^CHECK 1/.test(v2.store_access), v2);
await db.exec("DROP POLICY open_all ON storage.objects");

// ── links
var a1 = await as('service_role', 'INSERT INTO ' + L + " (proforma_id, invoice_id, proforma_number, invoice_number, linked_by_name) VALUES ($1,$2,'PF-1','INV-1','Sam') RETURNING id", [P1, I1]);
check('the server links invoice 1 to proforma 1', !a1.error && a1.rows.length === 1, a1);
var a2 = await as('service_role', 'INSERT INTO ' + L + ' (proforma_id, invoice_id) VALUES ($1,$2)', [P2, I1]);
check('the same invoice cannot have a second ACTIVE link (another proforma)', /uq_pf_inv_links_active_invoice/.test(a2.error || ''), a2);
var a3 = await as('service_role', 'INSERT INTO ' + L + ' (proforma_id, invoice_id) VALUES ($1,$2)', [P1, I2]);
check('one proforma may have several invoices', !a3.error, a3);
var a4 = await as('service_role', 'INSERT INTO ' + L + ' (proforma_id, invoice_id) VALUES ($1,$2)', ['00000000-0000-0000-0000-0000000000ff', I2]);
check('a link to a proforma that does not exist is refused', !!a4.error, a4);
var d1 = await as('service_role', 'DELETE FROM ' + L + ' WHERE id = $1', [a1.rows[0].id]);
check('a link row cannot be deleted, even by the server', /never deleted|permission denied/.test(d1.error || ''), d1);
var u1 = await as('service_role', 'UPDATE ' + L + ' SET proforma_id = $2 WHERE id = $1', [a1.rows[0].id, P2]);
var u1b = await as('service_role', "UPDATE " + L + " SET linked_by_name = 'Someone else' WHERE id = $1", [a1.rows[0].id]);
check('a link cannot be pointed somewhere else, nor its "who linked" rewritten', /cannot be changed/.test(u1.error || '') && /cannot be changed/.test(u1b.error || ''), [u1, u1b]);
var u2 = await as('service_role', "UPDATE " + L + " SET removed_at = now(), removed_by_name = 'Sam', removed_reason = 'wrong one' WHERE id = $1 AND removed_at IS NULL", [a1.rows[0].id]);
check('unlinking stamps the row and keeps it', !u2.error && u2.count === 1 && (await q('SELECT count(*)::int c FROM ' + L)).rows[0].c === 2, u2);
var u3 = await as('service_role', "UPDATE " + L + " SET removed_reason = 'changed my mind' WHERE id = $1", [a1.rows[0].id]);
var u3b = await as('service_role', 'UPDATE ' + L + ' SET removed_at = NULL WHERE id = $1', [a1.rows[0].id]);
check('an unlinked row is history: it cannot be edited or brought back to life', /history/.test(u3.error || '') && /history/.test(u3b.error || ''), [u3, u3b]);
var a5 = await as('service_role', 'INSERT INTO ' + L + ' (proforma_id, invoice_id) VALUES ($1,$2)', [P2, I1]);
check('after unlinking, the invoice can be linked to another proforma (a new row)', !a5.error && (await q('SELECT count(*)::int c FROM ' + L + ' WHERE invoice_id = $1', [I1])).rows[0].c === 2, a5);
var t1 = await q('TRUNCATE ' + L);
check('the links table cannot be emptied', /never deleted/.test(t1.error || ''), t1);

// ── signed files
function ins(pf, ver, pathName, hash) { return as('service_role', 'INSERT INTO ' + F + " (proforma_id, version, storage_path, file_name, content_type, size_bytes, sha256, uploaded_by_name) VALUES ($1,$2,$3,'signed.pdf','application/pdf',1200,$4,'Sam') RETURNING id, storage_bucket", [pf, ver, pathName, hash]); }
var f1 = await ins(P1, 1, 'pf/a1/one.pdf', 'h1');
check('the server saves version 1 (in the private store)', !f1.error && f1.rows[0].storage_bucket === 'proforma-signed', f1);
var f2 = await ins(P1, 1, 'pf/a1/two.pdf', 'h2');
check('two files cannot both be version 1 of one proforma', /uq_pf_signed_version/.test(f2.error || ''), f2);
var f3 = await ins(P1, 2, 'pf/a1/one.pdf', 'h3');
check('one stored file cannot be recorded twice', /uq_pf_signed_path/.test(f3.error || ''), f3);
var f4 = await ins(P1, 2, 'pf/a1/four.pdf', 'h1');
check('the same bytes cannot be saved twice on one proforma', /uq_pf_signed_hash/.test(f4.error || ''), f4);
var f5 = await ins(P1, 2, 'pf/a1/two.pdf', 'h2');
var f6 = await ins(P2, 1, 'pf/a2/one.pdf', 'h1');
check('a newer copy is version 2; the same bytes may be on a different proforma', !f5.error && !f6.error, [f5, f6]);
var f7 = await as('service_role', 'INSERT INTO ' + F + " (proforma_id, version, storage_path, file_name, content_type, size_bytes, sha256) VALUES ($1,3,'pf/a1/zero.pdf','z.pdf','application/pdf',0,'h9')", [P1]);
check('an empty file (0 bytes) is refused', !!f7.error, f7);
var g1 = await as('service_role', "UPDATE " + F + " SET file_name = 'other.pdf' WHERE id = $1", [f1.rows[0].id]);
var g2 = await as('service_role', 'DELETE FROM ' + F + ' WHERE id = $1', [f1.rows[0].id]);
var g3 = await q('DELETE FROM ' + F); var g4 = await q('TRUNCATE ' + F);
check('a signed file row is never changed or deleted — server, owner, one row or all', [g1, g2, g3, g4].every(function (x) { return /never changed or deleted|permission denied/.test(x.error || ''); }), [g1, g2, g3, g4]);
check('all three files are still there', (await q('SELECT count(*)::int c FROM ' + F)).rows[0].c === 3);

// ── the proforma itself
var h1 = await q('DELETE FROM public.accounting_proformas WHERE id = $1', [P1]);
check('a proforma with a signed file cannot be deleted from the database', /violates foreign key|restrict/i.test(h1.error || ''), h1);
var h2 = await q("UPDATE public.accounting_proformas SET record_status = 'archived' WHERE id = $1", [P1]);
check('archiving / voiding it changes nothing on its files or links', !h2.error && (await q('SELECT count(*)::int c FROM ' + F + ' WHERE proforma_id = $1', [P1])).rows[0].c === 2 && (await q('SELECT count(*)::int c FROM ' + L + ' WHERE proforma_id = $1', [P1])).rows[0].c === 2);
var h3 = await q('DELETE FROM public.accounting_proformas WHERE id = $1', [P3]);
check('a proforma with no file and no link is not affected', !h3.error && h3.count === 1, h3);
var h4 = await q('DELETE FROM public.accounting_invoices WHERE id = $1', [I2]);
check('deleting an invoice is not blocked by this script; its link row stays as a record', !h4.error && (await q('SELECT invoice_number FROM ' + L + ' WHERE invoice_id = $1', [I2])).rows.length === 1, h4);

// ── who can reach the tables
for (var role of ['anon', 'authenticated']) {
  var r1 = await as(role, 'SELECT * FROM ' + L), r2 = await as(role, 'SELECT * FROM ' + F);
  var r3 = await as(role, 'INSERT INTO ' + L + ' (proforma_id, invoice_id) VALUES ($1,$2)', [P2, I2]);
  var r4 = await as(role, 'INSERT INTO ' + F + " (proforma_id, version, storage_path, file_name, content_type, size_bytes, sha256) VALUES ($1,9,'x','x','x',1,'x')", [P2]);
  var r5 = await as(role, 'UPDATE ' + L + ' SET removed_at = now()');
  check('a browser sign-in (' + role + ') can read or write neither table', [r1, r2, r3, r4, r5].every(function (x) { return /permission denied/.test(x.error || ''); }), [r1, r2, r3, r4, r5]);
}
var s1 = await as('service_role', 'SELECT count(*)::int c FROM ' + L), s2 = await as('service_role', 'SELECT count(*)::int c FROM ' + F);
check('the Hub server reads both', !s1.error && !s2.error && s1.rows[0].c === 3 && s2.rows[0].c === 3, [s1, s2]);
var rls = (await q("SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('accounting_proforma_invoice_links','accounting_proforma_signed_files')")).rows;
var pol = (await q("SELECT count(*)::int c FROM pg_policies WHERE tablename IN ('accounting_proforma_invoice_links','accounting_proforma_signed_files')")).rows[0].c;
check('row security is ON for both tables and there is no rule that opens them', rls.length === 2 && rls.every(function (x) { return x.relrowsecurity === true; }) && pol === 0, [rls, pol]);

console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
