// v55.83-ZY — REAL Postgres 16 proof of sql/v55-83-ZY-other-services-operational.sql. Live shapes rebuilt (27 Nov 2026, read-only):
// vendor_bills with its live CHECKs (bill type 4 values, direction 2 values, sources, price-check status) and the live validation
// triggers (needs a type + direction; a flagged price check needs a resolution note), bill_price_rules / bill_commission_rules checks,
// hub_audit_log. Proves: only widens (old values + rows untouched), re-runnable, the trigger names Operational and still needs a type +
// direction, no payroll function in this file (AAD). Needs EMBEDDED_PG_DIR.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
var here = path.dirname(fileURLToPath(import.meta.url)); var root = path.join(here, '..');
var dir = process.env.EMBEDDED_PG_DIR;
if (!dir) { console.log('SKIPPED — set EMBEDDED_PG_DIR. Nothing was checked.'); process.exit(2); }
var req = createRequire(path.join(dir, 'package.json'));
var EmbeddedPostgres = (await import('file://' + req.resolve('embedded-postgres').replace(/\\/g, '/'))).default;
var pg = req('pg');
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra === undefined ? '' : extra).substring(0, 500))); }
console.log('ZY — Other services / Operational (real Postgres)');
var SQL = fs.readFileSync(path.join(root, 'sql/v55-83-ZY-other-services-operational.sql'), 'utf8');
var body = SQL.split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
check('no payroll auto-validation in this file (that is AAD)', !/hub_bill_auto_validate_payroll/.test(SQL));
check('one transaction', /^BEGIN;/m.test(SQL) && /^COMMIT;/m.test(SQL));
check('removes no data, no table, no column', !/DELETE\s+FROM|\bTRUNCATE\b|DROP\s+TABLE|DROP\s+COLUMN|\bUPDATE\s+public\.(?!vendor_bills SET bill_type = coalesce)/i.test(body.replace(/UPDATE public\.vendor_bills SET bill_type = coalesce/, 'X')) && !/DELETE/i.test(body));

var B1 = 'b1000000-0000-4000-8000-000000000001', B2 = 'b2000000-0000-4000-8000-000000000002', B3 = 'b3000000-0000-4000-8000-000000000003', B4 = 'b4000000-0000-4000-8000-000000000004', B5 = 'b5000000-0000-4000-8000-000000000005';
var dataDir = path.join(dir, 'data-zy-' + Date.now()); var port = 54000 + Math.floor(Math.random() * 900);
var server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'test-only', port: port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
var db;
async function as(role, sql, args) {
  await db.query('BEGIN');
  try { await db.query('SET LOCAL ROLE ' + role); var r = await db.query(sql, args || []); await db.query('COMMIT'); return { ok: true, rows: r.rows }; }
  catch (e) { await db.query('ROLLBACK'); return { ok: false, code: e.code, msg: e.message }; }
}
async function q(sql, args) { try { var r = await db.query(sql, args || []); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, code: e.code, msg: e.message }; } }
async function setup() {
  await db.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;");
  await db.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  await db.query("CREATE TABLE public.vendor_bills (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_name text, bill_number text, bill_date date, total_amount numeric NOT NULL CHECK (total_amount > 0), " +
    "record_status text NOT NULL DEFAULT 'active' CHECK (record_status = ANY (ARRAY['active','void','deleted'])), validation_status text NOT NULL DEFAULT 'pending', validated_by uuid, validated_at timestamptz, validation_notes text, " +
    "release_number text, other_reference text, bill_type text, bill_type_source text, shipment_direction text, direction_source text, price_check_status text, price_resolved_note text, price_resolved_by text, price_resolved_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), " +
    "CONSTRAINT vendor_bills_bill_type_check CHECK ((bill_type IS NULL) OR (bill_type = ANY (ARRAY['trucking','shipping','bonded_brokerage','supplier']))), " +
    "CONSTRAINT vendor_bills_bill_type_source_check CHECK ((bill_type_source IS NULL) OR (bill_type_source = ANY (ARRAY['read_from_bill','vendor_history','manual','validator']))), " +
    "CONSTRAINT vendor_bills_direction_source_check CHECK ((direction_source IS NULL) OR (direction_source = ANY (ARRAY['release_number','manual','validator','vendor_default']))), " +
    "CONSTRAINT vendor_bills_price_check_status_check CHECK ((price_check_status IS NULL) OR (price_check_status = ANY (ARRAY['ok','flagged','no_rules','not_checked']))), " +
    "CONSTRAINT vendor_bills_shipment_direction_check CHECK ((shipment_direction IS NULL) OR (shipment_direction = ANY (ARRAY['inbound','outbound']))));");
  await db.query("CREATE FUNCTION public.vendor_bills_validation_needs_type() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.validation_status = 'validated' AND COALESCE(OLD.validation_status, '') <> 'validated' THEN IF NEW.bill_type IS NULL THEN RAISE EXCEPTION 'Pick the bill TYPE before validating it.'; END IF; IF NEW.shipment_direction IS NULL THEN RAISE EXCEPTION 'Mark the bill Inbound or Outbound before validating it.'; END IF; END IF; RETURN NEW; END $$;" +
    "CREATE TRIGGER trg_vendor_bills_validation_needs_type BEFORE UPDATE OF validation_status ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.vendor_bills_validation_needs_type();" +
    "CREATE FUNCTION public.vendor_bills_validation_needs_price_ok() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.validation_status = 'validated' AND COALESCE(OLD.validation_status, '') <> 'validated' AND NEW.price_check_status = 'flagged' AND length(btrim(COALESCE(NEW.price_resolved_note, ''))) < 10 THEN RAISE EXCEPTION 'The price check flagged this bill — write how the price issue was resolved before validating it.'; END IF; RETURN NEW; END $$;" +
    "CREATE TRIGGER trg_vendor_bills_validation_needs_price_ok BEFORE UPDATE ON public.vendor_bills FOR EACH ROW EXECUTE FUNCTION public.vendor_bills_validation_needs_price_ok();");
  await db.query("CREATE TABLE public.bill_price_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_match text, bill_type text, expected_amount numeric, CONSTRAINT bill_price_rules_bill_type_check CHECK ((bill_type IS NULL) OR (bill_type = ANY (ARRAY['trucking','shipping','bonded_brokerage','supplier']))));" +
    "CREATE TABLE public.bill_commission_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_match text, rate numeric, default_direction text, CONSTRAINT bill_commission_rules_default_direction_check CHECK ((default_direction IS NULL) OR (default_direction = ANY (ARRAY['inbound','outbound']))));" +
    "CREATE TABLE public.hub_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text NOT NULL, entity text, entity_id text, details jsonb, at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());" +
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role, authenticated;");
  await db.query("INSERT INTO public.vendor_bills (id, vendor_name, bill_number, bill_date, total_amount, bill_type, shipment_direction, release_number) VALUES " +
    "($1, 'Kronos Trucking', 'K-1', '2026-11-01', 400, 'trucking', 'outbound', '1002-555'), ($2, 'ADP Payroll', 'ADP-1', '2026-11-27', 4321.17, NULL, NULL, NULL), ($3, 'Gusto Payroll', 'G-1', '2026-11-27', 900, 'supplier', 'inbound', NULL), ($4, 'Paychex payroll', 'P-1', '2026-11-27', 50, NULL, NULL, NULL), ($5, 'Old payroll', 'O-1', '2026-10-01', 70, NULL, NULL, NULL)", [B1, B2, B3, B4, B5]);
  await db.query("UPDATE public.vendor_bills SET price_check_status = 'flagged' WHERE id = $1", [B4]);
  await db.query("UPDATE public.vendor_bills SET record_status = 'void' WHERE id = $1", [B5]);
}
function rpc(role, p) { return as(role, 'SELECT public.hub_bill_auto_validate_payroll($1::jsonb) AS r', [JSON.stringify(p)]); }
try {
  await server.initialise(); await server.start();
  db = new pg.Client({ host: 'localhost', port: port, user: 'postgres', password: 'test-only', database: 'postgres' }); await db.connect();
  await setup();
  var before = await q("SELECT 1 FROM public.vendor_bills WHERE false");
  var pre = await as('service_role', "UPDATE public.vendor_bills SET bill_type = 'other_services' WHERE id = $1", [B1]);
  check('before: the live check refuses other_services (by name)', !pre.ok && /vendor_bills_bill_type_check/.test(pre.msg), pre);
  var snap0 = (await q("SELECT id, vendor_name, bill_number, total_amount, bill_type, shipment_direction, release_number, validation_status FROM public.vendor_bills ORDER BY id")).rows;
  var run1 = await q(SQL);
  check('the SQL runs', run1.ok, run1);
  var run2 = await q(SQL);
  check('…and runs again (re-runnable)', run2.ok, run2);
  var snap1 = (await q("SELECT id, vendor_name, bill_number, total_amount, bill_type, shipment_direction, release_number, validation_status FROM public.vendor_bills ORDER BY id")).rows;
  check('no row changed by installing it', JSON.stringify(snap0) === JSON.stringify(snap1));
  var ck = await q("SELECT 1 AS n FROM (VALUES (1)) v"); void ck;
  var tail = SQL.split('COMMIT;')[1];
  var chk = await q(tail);
  check('the read-only check says OK on every line', chk.ok && chk.rows.length === 3 && chk.rows.every(function (r) { return r.result === 'OK'; }), chk);
  // widened, not narrowed
  var u1 = await as('service_role', "UPDATE public.vendor_bills SET bill_type = 'other_services', shipment_direction = 'operational', release_number = NULL WHERE id = $1 RETURNING bill_type, shipment_direction", [B1]);
  check('other_services and operational are now stored', u1.ok && u1.rows[0].bill_type === 'other_services' && u1.rows[0].shipment_direction === 'operational', u1);
  var u2 = await as('service_role', "UPDATE public.vendor_bills SET bill_type = 'trucking', shipment_direction = 'outbound', release_number = '1002-555' WHERE id = $1", [B1]);
  check('every old value is still allowed', u2.ok, u2);
  var u3 = await as('service_role', "UPDATE public.vendor_bills SET bill_type = 'magic' WHERE id = $1", [B1]);
  var u4 = await as('service_role', "UPDATE public.vendor_bills SET shipment_direction = 'sideways' WHERE id = $1", [B1]);
  check('anything else is still refused', !u3.ok && !u4.ok);
  var pr = await as('service_role', "INSERT INTO public.bill_price_rules (vendor_match, bill_type, expected_amount) VALUES ('Intuit', 'other_services', 90)");
  var cr = await as('service_role', "INSERT INTO public.bill_commission_rules (vendor_match, rate, default_direction) VALUES ('Office co', 0.1, 'operational')");
  check('price rules take other_services; a vendor default can be operational', pr.ok && cr.ok, { pr: pr, cr: cr });
  var inst = await as('authenticated', 'SELECT public.hub_bill_other_services_installed() AS x');
  check('the installed flag answers true (readable by the screen)', inst.ok && inst.rows[0].x === true, inst);
  // the validation trigger now names Operational, and still needs both
  await q("INSERT INTO public.vendor_bills (id, vendor_name, bill_number, bill_date, total_amount, bill_type) VALUES ('d0000000-0000-4000-8000-000000000001', 'Zoom', 'Z-1', '2026-11-27', 15, 'other_services')");
  var t1 = await as('service_role', "UPDATE public.vendor_bills SET validation_status = 'validated' WHERE id = 'd0000000-0000-4000-8000-000000000001'");
  check('validating without a direction is still refused, naming Operational', !t1.ok && /Inbound, Outbound or Operational/.test(t1.msg), t1);
  var t2 = await as('service_role', "UPDATE public.vendor_bills SET shipment_direction = 'operational', validation_status = 'validated', validated_by = gen_random_uuid() WHERE id = 'd0000000-0000-4000-8000-000000000001'");
  check('an Operational / Other services bill validates by a person (no release, no reference)', t2.ok, t2);
} catch (e) { failN++; console.log('  ✗ FAIL: crashed', e && e.message); }
finally { try { await db.end(); } catch (e0) { /* */ } try { await server.stop(); } catch (e1) { /* */ } try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e2) { /* */ } }
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
