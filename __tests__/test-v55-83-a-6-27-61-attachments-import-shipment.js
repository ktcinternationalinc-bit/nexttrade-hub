// v55.83-A.6.27.61 — Attachments + Import Shipment template restructure.
//
// Scope:
//   PART 1 — Attachments infrastructure
//     • SQL: new attachments table + indexes + RLS + policy
//     • AttachmentManager.jsx: reusable upload+list+delete component
//     • Wired into OpenAccountsTab invoice modal + entry modal
//   PART 2 — Import Shipment template restructure
//     • New "Shipment Info" sheet with shipment-level fields (one row)
//     • Stock Import rows inherit blanks from Shipment Info
//     • Backward compatible with old templates

var fs = require('fs');
var path = require('path');
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

var page    = read('src/app/page.jsx');
var oa      = read('src/components/OpenAccountsTab.jsx');
var att     = read('src/components/AttachmentManager.jsx');
var imp     = read('src/components/InventoryStockImport.jsx');
var sql     = read('sql/v55-83-a-6-27-61-attachments.sql');
var wn      = read('src/components/WhatsNewWidget.jsx');

var failures = [];
function ok(label, cond) {
  if (cond) console.log('✓ ' + label);
  else { failures.push(label); console.log('✗ ' + label); }
}

// ══════════════════════════════════════════════════════════════════
// PART A — SQL migration
// ══════════════════════════════════════════════════════════════════
ok('A1: SQL creates attachments table',
  /CREATE TABLE IF NOT EXISTS attachments/.test(sql));
ok('A2: SQL has id uuid PK',
  /id\s+UUID DEFAULT gen_random_uuid\(\) PRIMARY KEY/.test(sql));
ok('A3: SQL has parent_type + parent_id columns',
  /parent_type\s+TEXT NOT NULL/.test(sql) &&
  /parent_id\s+UUID NOT NULL/.test(sql));
ok('A4: SQL has file_name + file_size + mime_type',
  /file_name\s+TEXT NOT NULL/.test(sql) &&
  /file_size\s+BIGINT NOT NULL/.test(sql) &&
  /mime_type\s+TEXT/.test(sql));
ok('A5: SQL has storage_path + public_url',
  /storage_path\s+TEXT NOT NULL/.test(sql) &&
  /public_url\s+TEXT NOT NULL/.test(sql));
ok('A6: SQL has uploaded_by + uploaded_at',
  /uploaded_by\s+UUID/.test(sql) &&
  /uploaded_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/.test(sql));
ok('A7: SQL enforces 100 MB max file size via CHECK',
  /CHECK \(file_size <= 104857600\)/.test(sql));
ok('A8: SQL enforces positive file size',
  /CHECK \(file_size > 0\)/.test(sql));
ok('A9: SQL creates 3 indexes (parent composite, uploaded_by, uploaded_at)',
  /idx_attachments_parent\s+ON attachments \(parent_type, parent_id\)/.test(sql) &&
  /idx_attachments_uploaded_by\s+ON attachments \(uploaded_by\)/.test(sql) &&
  /idx_attachments_uploaded_at\s+ON attachments \(uploaded_at DESC\)/.test(sql));
ok('A10: SQL enables RLS + permissive policy',
  /ALTER TABLE attachments ENABLE ROW LEVEL SECURITY/.test(sql) &&
  /CREATE POLICY "Allow all on attachments"/.test(sql));
ok('A11: SQL is idempotent (DO blocks with duplicate_object NULL)',
  (sql.match(/EXCEPTION WHEN duplicate_object THEN NULL/g) || []).length >= 1);
ok('A12: SQL instructions explain bucket setup',
  /Storage → New bucket/.test(sql) &&
  /Public bucket: YES/.test(sql) &&
  /100 MB/.test(sql));
ok('A13: SQL has backout block (commented)',
  /BACKOUT[\s\S]{0,200}DROP TABLE IF EXISTS attachments/.test(sql));

// ══════════════════════════════════════════════════════════════════
// PART B — AttachmentManager component
// ══════════════════════════════════════════════════════════════════
ok('B1: AttachmentManager has "use client" + imports React + supabase',
  /'use client'/.test(att) &&
  /from 'react'/.test(att) &&
  /from '\.\.\/lib\/supabase'/.test(att));
ok('B2: MAX_FILE_SIZE = 100 MB',
  /var MAX_FILE_SIZE = 104857600/.test(att));
ok('B3: BUCKET_NAME = "attachments"',
  /var BUCKET_NAME = 'attachments'/.test(att));
ok('B4: fmtSize formats bytes/KB/MB/GB',
  /function fmtSize\(bytes\)/.test(att) &&
  /' B'/.test(att) &&
  /' KB'/.test(att) &&
  /' MB'/.test(att) &&
  /' GB'/.test(att));
ok('B5: fileIcon picks icon by extension/mime',
  /function fileIcon\(fileName, mimeType\)/.test(att));
ok('B6: sanitizePath strips unsafe characters',
  /function sanitizePath\(name\)[\s\S]{0,200}replace\(\/\[\^a-zA-Z0-9\._-\]\/g, '_'\)/.test(att));
ok('B7: component takes parentType + parentId + currentUserId + isSuperAdmin + canEdit',
  /var parentType = props\.parentType/.test(att) &&
  /var parentId = props\.parentId/.test(att) &&
  /var currentUserId = props\.currentUserId/.test(att) &&
  /var isSuperAdmin = !!props\.isSuperAdmin/.test(att) &&
  /var canEdit = props\.canEdit !== false/.test(att));
ok('B8: load fetches attachments with parent_type + parent_id filter',
  /\.from\('attachments'\)[\s\S]{0,200}\.eq\('parent_type', parentType\)[\s\S]{0,200}\.eq\('parent_id', parentId\)/.test(att));
ok('B9: load gracefully degrades when table missing (instructs to run SQL)',
  /relation\.\*attachments\.\*does not exist/.test(att) &&
  /run SQL migration v55\.83-A\.6\.27\.61/.test(att));
ok('B10: uploadFile rejects files >100 MB',
  /if \(file\.size > MAX_FILE_SIZE\)/.test(att) &&
  /File too large/.test(att));
ok('B11: uploadFile uploads to Supabase Storage with parent_type/parent_id path',
  /supabase\.storage\.from\(BUCKET_NAME\)\.upload\(storagePath, file/.test(att) &&
  /storagePath = parentType \+ '\/' \+ parentId \+ '\/' \+ timestamp \+ '-' \+ safeName/.test(att));
ok('B12: uploadFile errors out with helpful hint when bucket missing',
  /bucket\.\*not found\|bucket\.\*does not exist/i.test(att) &&
  /Create it in Supabase Dashboard → Storage/.test(att));
ok('B13: uploadFile inserts metadata after upload + cleans up on metadata failure',
  /supabase\.from\('attachments'\)\.insert/.test(att) &&
  /storage\.from\(BUCKET_NAME\)\.remove\(\[storagePath\]\)/.test(att));
ok('B14: handleFileInput supports multiple files (sequential)',
  /<input[\s\S]{0,200}multiple/.test(att) &&
  /for \(var i = 0; i < files\.length; i\+\+\)/.test(att));
ok('B15: drag-drop handlers (over/leave/drop)',
  /function handleDragOver\(e\)/.test(att) &&
  /function handleDragLeave\(e\)/.test(att) &&
  /async function handleDrop\(e\)/.test(att));
ok('B16: deleteAttachment super_admin only',
  /if \(!isSuperAdmin\) \{[\s\S]{0,200}Only super admin can delete/.test(att));
ok('B17: deleteAttachment confirms + removes from storage + metadata',
  /confirm\(confirmMsg\)/.test(att) &&
  /storage\.from\(BUCKET_NAME\)\.remove\(\[att\.storage_path\]\)/.test(att) &&
  /\.from\('attachments'\)\.delete\(\)\.eq\('id', att\.id\)/.test(att));
ok('B18: deleteAttachment logs to audit_log (best-effort)',
  /from\('audit_log'\)\.insert\(\{[\s\S]{0,400}table_name: 'attachments'/.test(att));
ok('B19: UI shows file count in header',
  /📎 ATTACHMENTS \(\{items\.length\}\)/.test(att));
ok('B20: UI renders image thumbnail for image attachments',
  /isImage[\s\S]{0,400}img src=\{att\.public_url\}/.test(att));
ok('B21: UI shows Download link for every attachment',
  /href=\{att\.public_url\}/.test(att) &&
  /⬇ Download/.test(att));
ok('B22: UI hides delete button for non-super-admin',
  /\{isSuperAdmin && \(/.test(att) &&
  /onClick=\{function \(\) \{ deleteAttachment\(att\); \}\}/.test(att));
ok('B23: default export',
  /export default AttachmentManager/.test(att));
ok('B24: named export too',
  /export function AttachmentManager\(props\)/.test(att));

// ══════════════════════════════════════════════════════════════════
// PART C — OpenAccountsTab wiring
// ══════════════════════════════════════════════════════════════════
ok('C1: imports AttachmentManager',
  /import AttachmentManager from '\.\/AttachmentManager'/.test(oa));
ok('C2: invoice modal includes AttachmentManager when invoiceDraft.id present',
  /\{invoiceDraft\.id && \(\s+<AttachmentManager\s+parentType="open_account_invoice"\s+parentId=\{invoiceDraft\.id\}/.test(oa));
ok('C3: invoice modal shows "save first" hint when no id yet',
  /\{!invoiceDraft\.id && \(/.test(oa) &&
  /Save the invoice first, then attach files/.test(oa));
ok('C4: entry modal includes AttachmentManager when entryDraft.id present',
  /\{entryDraft\.id && \(\s+<AttachmentManager\s+parentType="open_account_entry"\s+parentId=\{entryDraft\.id\}/.test(oa));
ok('C5: entry modal shows "save first" hint when no id yet',
  /\{!entryDraft\.id && \(/.test(oa) &&
  /Save the entry first, then attach receipts/.test(oa));
ok('C6: AttachmentManager props include canEdit + currentUserId + isSuperAdmin',
  /currentUserId=\{userProfile && userProfile\.id\}/.test(oa) &&
  /isSuperAdmin=\{userProfile && userProfile\.role === 'super_admin'\}/.test(oa) &&
  /canEdit=\{canEdit\}/.test(oa));

// ══════════════════════════════════════════════════════════════════
// PART D — Import Shipment template restructure
// ══════════════════════════════════════════════════════════════════
ok('D1: New Shipment Info sheet with shipment-level headers',
  /shipmentInfoHeaders = \[/.test(imp) &&
  /'shipment_reference'/.test(imp) &&
  /'warehouse_name'/.test(imp) &&
  /'receipt_date'/.test(imp) &&
  /'supplier'/.test(imp) &&
  /'freight_forwarder'/.test(imp) &&
  /'shipping_line'/.test(imp) &&
  /'bl_number'/.test(imp) &&
  /'container_number'/.test(imp));
ok('D2: Shipment Info sheet added to workbook FIRST',
  /XLSX\.utils\.book_append_sheet\(wb, shipmentSheet, 'Shipment Info'\)/.test(imp));
ok('D3: filename renamed to KTC-Import-Shipment-Template',
  /KTC-Import-Shipment-Template-/.test(imp) &&
  !/KTC-Legacy-Stock-Import-Template/.test(imp));
ok('D4: Instructions rewritten to explain 2-sheet structure',
  /Sheet "Shipment Info"/.test(imp) &&
  /Sheet "Stock Import"/.test(imp));
ok('D5: handleFileUpload reads Shipment Info sheet first',
  /if \(wb\.SheetNames\.includes\('Shipment Info'\)\)/.test(imp) &&
  /var infoSheet = wb\.Sheets\['Shipment Info'\]/.test(imp) &&
  /shipmentDefaults = infoRows\[0\] \|\| \{\}/.test(imp));
ok('D6: validateRows takes shipmentDefaults param',
  /function validateRows\(rows, shipmentDefaults\)/.test(imp));
ok('D7: getWithDefault helper falls back to shipment defaults',
  /function getWithDefault\(raw, key\)/.test(imp) &&
  /var dflt = shipmentDefaults\[key\]/.test(imp));
ok('D8: warehouse_name uses getWithDefault',
  /var warehouseName = String\(getWithDefault\(raw, 'warehouse_name'\)/.test(imp));
ok('D9: receipt_date uses getWithDefault',
  /var receiptDate = asDate\(getWithDefault\(raw, 'receipt_date'\)\)/.test(imp));
ok('D10: supplier uses getWithDefault in payload',
  /supplier: String\(getWithDefault\(raw, 'supplier'\) \|\| ''\)\.trim\(\) \|\| null/.test(imp));
ok('D11: container_number uses getWithDefault in payload',
  /container_number: String\(getWithDefault\(raw, 'container_number'\) \|\| ''\)\.trim\(\) \|\| null/.test(imp));
ok('D12: toast message indicates shipment-level defaults were applied',
  /shipment-level defaults applied/.test(imp));
ok('D13: backward compatible — shipmentDefaults defaults to {} when sheet missing',
  /var shipmentDefaults = \{\}/.test(imp) &&
  /shipmentDefaults = shipmentDefaults \|\| \{\}/.test(imp));

// ══════════════════════════════════════════════════════════════════
// PART R — REGRESSION GUARDS
// ══════════════════════════════════════════════════════════════════
ok('R1: 60 — light-blue template highlight preserved',
  /bg-sky-50/.test(read('src/components/InventoryProductMaster.jsx')));
ok('R2: 60 — Inbound Shipments modal still 99vw',
  /99vw/.test(read('src/components/InventoryReceiving.jsx')));
ok('R3: 60 — login Deactivate-blocks-login fix preserved',
  /profile && !isActiveUser\(profile\)/.test(read('src/app/login/page.jsx')));
ok('R4: 60 — duplicate user guard preserved',
  /v55\.83-A\.6\.27\.60 — Duplicate-user guard/.test(read('src/components/SettingsTab.jsx')));
ok('R5: 60 — Product Overview history modal preserved',
  /function openHistory\(product\)/.test(read('src/components/InventoryOverview.jsx')));
ok('R6: 60 — globals.css label centering rule preserved',
  /v55\.83-A\.6\.27\.60 — Center form labels app-wide/.test(read('src/app/globals.css')));
ok('R7: 60 — Import Shipment label preserved (id stays importstock)',
  /id: 'importstock', label: '📦 Import Shipment'/.test(read('src/components/InventoryTab.jsx')));
ok('R8: 59 — mini-invoice + Invoice button preserved',
  /\+ Invoice/.test(oa) && /printOpenAccountInvoice/.test(oa));
ok('R9: 58 — multi-currency walk preserved',
  /var sim = simulate\(arr\)/.test(oa));
ok('R10: 55 — openaccounts in FINANCE sidebar preserved',
  /\{ group: 'FINANCE', items: \['sales', 'treasury', 'checks', 'debts', 'openaccounts'/.test(page));
ok('R11: 54 — amber header version pill preserved',
  /background: '#fef3c7'/.test(page));
ok('R12: closed-tickets fetch still has NO .limit(100)',
  !/\.eq\('status', 'Closed'\)[\s\S]{0,200}\.limit\(100\)/.test(page));
ok('R13: WhatsNew widget has .61 entry',
  /version: 'v55\.83-A\.6\.27\.61'/.test(wn));
ok('R14: WhatsNew widget still has .60 entry',
  /version: 'v55\.83-A\.6\.27\.60'/.test(wn));
ok('R15: WhatsNew widget still has .59 entry',
  /version: 'v55\.83-A\.6\.27\.59'/.test(wn));

// ──────────────────────────────────────────────────────────────────
// Version stamp
// ──────────────────────────────────────────────────────────────────
ok('V1: version stamp v55.83-A.6.27.61 or later',
  /BUILD v55\.83-A\.6\.27\.(61|6[2-9]|[7-9]\d)/.test(page));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' failure(s):');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('\n✅ All v55.83-A.6.27.61 tests passed');
