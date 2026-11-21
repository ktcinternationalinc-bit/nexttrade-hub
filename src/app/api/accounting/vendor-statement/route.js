// v55.83-WT — VENDOR STATEMENT (SOA) CHECK — the reading step (Max, 21 Nov 2026): "Vendors send a list of all their open bills.
// I want a button to import that list (PDF, spreadsheet or pasted text) ... It must only check; it must never change a bill,
// payment or wire."
//
// ONE action, read: a PDF / photo (base64) or pasted text goes to the SAME reader call the bill import uses
// (lib/bill-reader-call.js); lib/vendor-statement.js disciplines the answer. A spreadsheet, or pasted text that came from one, is
// read column by column in the browser (lib/vendor-statement.js linesFromRows) and never comes here. The comparison with our
// bills runs in the browser on the complete Bills list the server returned.
// THIS ROUTE WRITES NOTHING: no table, no file, no audit row. The file / text is not stored. It reads only who is calling.
// Identity: the verified sign-in (bearer), never a user_id from the request. Permission: Accounting Access + Bills: View or Manage.
// SWC-safe (var + string concatenation).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { verifiedCaller } from '../../../../lib/verified-caller';
import { askBillReader } from '../../../../lib/bill-reader-call';
import { BILL_MEDIA_TYPES } from '../../../../lib/bill-extract';
import { STATEMENT_PROMPT, parseStatementReading, statementAddsUp, statementMoney } from '../../../../lib/vendor-statement';

// a long statement takes the reader a while (every row is written out)
export const maxDuration = 300;

var API_BUILD_MARKER = 'v55.83-WT-vendor-statement';
var MAX_TEXT = 300000;
var MAX_TOKENS = 16000;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(req) {
  var body = null;
  try { body = await req.json(); } catch (eB) { return NextResponse.json({ ok: false, error: 'The request was not readable.' }, { status: 400 }); }
  body = body || {};
  var who = await verifiedCaller(req, body, createClient);
  if (who.error) { return NextResponse.json({ ok: false, error: who.error }, { status: who.status || 401 }); }
  var userId = who.userId;
  var db = admin();
  try {
    var gate = await assertPermission(db, userId, 'accounting.view', req);
    if (!gate || gate.ok !== true) { return NextResponse.json({ ok: false, error: 'This needs "Accounting Access" (P1) — grant it in Settings → 🏦 Banking & Accounting Access.' }, { status: (gate && gate.status) || 403 }); }
    var g2 = await assertPermission(db, userId, 'bills.manage', req);
    if (!g2 || g2.ok !== true) { g2 = await assertPermission(db, userId, 'bills.view', req); }
    if (!g2 || g2.ok !== true) { return NextResponse.json({ ok: false, error: 'This needs the "Bills: View" permission — grant it in Settings → 🏦 Banking & Accounting Access.' }, { status: (g2 && g2.status) || 403 }); }

    if (body.action !== 'read') { return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 }); }

    var blocks = null;
    if (typeof body.text === 'string') {
      var t = body.text.replace(/\r\n/g, '\n').trim();
      if (t.length < 5) { return NextResponse.json({ ok: false, error: 'Paste the statement lines first — nothing to read.' }, { status: 400 }); }
      if (t.length > MAX_TEXT) { return NextResponse.json({ ok: false, error: 'That is too much text (' + t.length + ' characters, the limit is ' + MAX_TEXT + ') — split the statement and check it in parts.' }, { status: 413 }); }
      var src = 'The statement below was pasted as text.'; // a spreadsheet is read column by column in the browser and never comes here (Codex 21 Nov)
      blocks = [{ type: 'text', text: src + '\n--- STATEMENT START ---\n' + t + '\n--- STATEMENT END ---' }, { type: 'text', text: STATEMENT_PROMPT }];
    } else {
      var mt = String(body.media_type || '');
      var kind = BILL_MEDIA_TYPES[mt];
      if (!kind) { return NextResponse.json({ ok: false, error: 'Use a PDF or a JPG / PNG / WebP photo of the statement — or a spreadsheet, or paste the lines.' }, { status: 415 }); }
      var b64 = String(body.file_base64 || '');
      if (b64.length < 100) { return NextResponse.json({ ok: false, error: 'The file is empty.' }, { status: 400 }); }
      if (b64.length > 14000000) { return NextResponse.json({ ok: false, error: 'File too large — keep it under ~10 MB (or split the statement).' }, { status: 413 }); }
      var block = kind === 'document'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } };
      blocks = [block, { type: 'text', text: STATEMENT_PROMPT }];
    }
    if (!process.env.ANTHROPIC_API_KEY) { return NextResponse.json({ ok: false, error: 'The AI reader is not configured on this server (ANTHROPIC_API_KEY).' }, { status: 503 }); }
    var asked = await askBillReader(blocks, MAX_TOKENS);
    if (asked.text == null) { return NextResponse.json({ ok: false, error: 'The statement could not be read: ' + ((asked.error && asked.error.message) || 'AI unavailable') + '.' }, { status: 502 }); }
    // Codex (21 Nov): a cut-off answer or pages not read must never look like a clean, complete check
    var truncated = asked.stop_reason === 'max_tokens';
    var parsed = parseStatementReading(asked.text);
    if (!parsed.statement) { return NextResponse.json({ ok: false, error: (truncated ? 'The statement is too long to read in one go — the answer was cut off. Split the file into parts and check each part. ' : '') + parsed.problems.join(' ') }, { status: 422 }); }
    if (!parsed.lines.length) { parsed.problems.push('No lines were read from this statement.'); }
    var incomplete = [];
    // v55.83-XA — a total row on the statement that does not equal the lines read above it means a line is missing or misread
    (parsed.totals || []).forEach(function (t) { if (!t.equals) { incomplete.push('their total row ' + statementMoney(t.value) + ' does not equal the lines read above it (' + statementMoney(t.sum_since) + ')'); } });
    if (parsed.unknown_rows) { incomplete.push(parsed.unknown_rows + ' row(s) with only an amount (no number, date or type) that are neither an invoice we can look up nor equal to the lines above'); }
    if (truncated) { incomplete.push('the reader ran out of room and stopped before the end (the last lines may be missing) — split the file and check it in parts'); }
    var pc = Number(body.page_count); var pageCount = (typeof body.file_base64 === 'string' && pc >= 1 && pc <= 500 && Math.floor(pc) === pc) ? pc : null;
    var pagesInfo = null;
    if (pageCount) {
      var withLines = {}; parsed.lines.forEach(function (l) { if (l.page) { withLines[l.page] = true; } });
      var noLines = []; for (var p = 1; p <= pageCount; p++) { if (!withLines[p]) { noLines.push(p); } }
      pagesInfo = { count: pageCount, read: parsed.statement.pages_read, without_lines: noLines };
      if (parsed.statement.pages_read !== null && parsed.statement.pages_read < pageCount) { incomplete.push('the file has ' + pageCount + ' pages but the reader says it read ' + parsed.statement.pages_read); }
      if (noLines.length && noLines.length < pageCount) { parsed.problems.push('No lines were read from page' + (noLines.length === 1 ? ' ' : 's ') + noLines.join(', ') + ' — check those pages in the file (a cover or remittance page is normal).'); }
    }
    // lines = every row in order, total rows included as kind 'total' (the screen re-checks them on every correction); total_rows = the checks
    return NextResponse.json({ ok: true, marker: API_BUILD_MARKER, statement: parsed.statement, lines: parsed.rows, total_rows: parsed.totals, problems: parsed.problems,
      truncated: truncated, incomplete: incomplete, pages: pagesInfo,
      adds_up: statementAddsUp(parsed.lines, parsed.statement.printed_total) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'The statement could not be read (' + ((e && e.message) || 'error') + '). Nothing was changed.' }, { status: 500 });
  }
}
