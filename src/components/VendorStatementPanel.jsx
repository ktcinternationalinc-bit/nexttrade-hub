'use client';
// v55.83-WT — VENDOR STATEMENT (SOA) CHECK on Accounting → Bills (Max, 21 Nov 2026): "Vendors send a list of all their open
// bills. I want a button to import that list (PDF, spreadsheet or pasted text), confirm the vendor, and check every line against
// our bills, the wires we sent and the bills attached to those wires ... It must only check; it must never change a bill,
// payment or wire."
// READ-ONLY. The only server call is /api/accounting/vendor-statement (action read — it writes nothing) for a PDF / photo or
// pasted free text. A spreadsheet (or pasted text copied from one) is read here, column by column, without the AI (Codex 21 Nov).
// The check itself runs here, on the COMPLETE bill list the server returned to the Bills screen (props.bills / props.payments —
// never the searched or filtered subset). Nothing is saved anywhere; the export is a file made in this browser.
import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { hubFetch } from '../lib/hub-fetch';
import { pdfPageCountFromBase64 } from '../lib/pdf-page-count-browser';
import { checkStatement, cleanStatementLines, statementAddsUp, vendorChoices, statementCsv, guessColumns, linesFromRows, tabRows, cleanStatementAmount,
  STATUS, STATUS_KEYS, SHEET_ROLES, SHEET_ROLE_LABEL, statementMoney as money } from '../lib/vendor-statement';

var INK = '#0f172a'; var SUB = '#475569'; var LINE = '#e2e8f0';
var SHEET_EXT = /\.(xlsx|xls|xlsm|ods|csv|tsv)$/i;
var FILE_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1 };

function numIn(v) { if (v === '' || v === null || v === undefined) { return null; } var s = String(v).replace(/[$,\s]/g, ''); if (!/^-?\d+(\.\d+)?$/.test(s)) { return undefined; } return Math.round(Number(s) * 100) / 100; }

// a workbook → its sheets as rows of cell TEXT as shown in the sheet (leading zeros kept), in this browser (the file is not sent)
export function workbookSheets(arrayBuffer, isText) {
  if (isText) { // a .csv / .tsv: tab-separated text is split here; comma-separated goes to the sheet reader, every cell kept as text
    var text = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer)).replace(/^﻿/, '');
    var tr = tabRows(text);
    if (tr) { var g0 = guessColumns(tr); return [{ name: 'sheet', rows: tr, use: g0.header >= 0, header: g0.header, map: g0.map }]; }
  }
  var wb = isText ? XLSX.read(text, { type: 'string', raw: true }) : XLSX.read(arrayBuffer, { type: 'array' });
  return wb.SheetNames.map(function (nm) {
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: false, defval: '', blankrows: false });
    var g = guessColumns(rows);
    return { name: nm, rows: rows, use: rows.length > 0 && g.header >= 0, header: g.header, map: g.map };
  }).filter(function (s) { return s.rows.length > 0; });
}

export default function VendorStatementPanel(props) {
  var bills = props.bills || []; var payments = props.payments || [];
  var enrichWarnings = props.enrichWarnings || [];
  var userProfile = props.userProfile;
  var s1 = useState(null); var read = s1[0]; var setRead = s1[1];           // { source: 'reader'|'sheet', statement, problems, file, incomplete, pages }
  var s2 = useState([]); var lines = s2[0]; var setLines = s2[1];           // the lines, as the person corrected them
  var s3 = useState({}); var picked = s3[0]; var setPicked = s3[1];         // vendor names ticked
  var s4 = useState(''); var stDate = s4[0]; var setStDate = s4[1];
  var s5 = useState(false); var busy = s5[0]; var setBusy = s5[1];
  var s6 = useState(''); var err = s6[0]; var setErr = s6[1];
  var s7 = useState(''); var paste = s7[0]; var setPaste = s7[1];
  var s8 = useState(false); var checked = s8[0]; var setChecked = s8[1];
  var s9 = useState(''); var showOnly = s9[0]; var setShowOnly = s9[1];
  var s10 = useState(''); var vq = s10[0]; var setVq = s10[1];
  var s11 = useState(true); var editOpen = s11[0]; var setEditOpen = s11[1];
  var s12 = useState(null); var sheet = s12[0]; var setSheet = s12[1];      // { file, sheets: [{ name, rows, use, header, map }], order, counts }
  var s13 = useState(''); var printed = s13[0]; var setPrinted = s13[1];   // the total printed on the statement (as read, or typed)
  var s14 = useState('USD'); var cur = s14[0]; var setCur = s14[1];
  var s15 = useState('current'); var asOf = s15[0]; var setAsOf = s15[1];
  var s16 = useState({}); var picks = s16[0]; var setPicks = s16[1];       // line n → our bill id, for a number several of our bills carry
  var fileRef = React.useRef(null);
  var reqRef = React.useRef(0); // which read is the current one: a late answer to an earlier read is dropped
  // a new import always starts from nothing: the previous statement's lines, ticks, picks and results are cleared FIRST, so a read
  // that then fails can never leave the last statement's figures on the screen as if they were this one's (cf. Codex 09:09 on WV)
  function clearAll() { reqRef.current++; setRead(null); setLines([]); setChecked(false); setPicks({}); setPicked({}); setSheet(null); setShowOnly(''); setStDate(''); setPrinted(''); setCur('USD'); setAsOf('current'); setBusy(false); }

  function startFrom(r, ls) {
    var choices0 = vendorChoices(bills, r.statement && r.statement.vendor_name, payments);
    var pk = {}; choices0.forEach(function (c) { if (c.suggested) { pk[c.name] = true; } });
    setRead(r); setLines(ls); setPicked(pk); setPicks({}); setChecked(false); setEditOpen(true);
    setStDate((r.statement && r.statement.statement_date) || '');
    setPrinted(r.statement && r.statement.printed_total !== null && r.statement.printed_total !== undefined ? String(r.statement.printed_total) : '');
    var c0 = String((r.statement && r.statement.currency) || 'USD').trim().toUpperCase();
    setCur(/^(US\$|\$|USD|US ?DOLLARS?)$/.test(c0) ? 'USD' : c0.substring(0, 8));
  }
  function ask(payload, label) {
    var myReq = ++reqRef.current; setBusy(true); setErr('');
    return hubFetch('/api/accounting/vendor-statement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: 'read', user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ') — try again.' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; })
      .then(function (j) {
        if (myReq !== reqRef.current) { return; } // a later import has started — this answer is not for it
        if (!j || !j.ok) { setErr((j && j.error) || 'The statement could not be read.'); return; }
        startFrom({ source: 'reader', statement: j.statement || {}, problems: j.problems || [], file: label, incomplete: j.incomplete || [], pages: j.pages || null }, j.lines || []);
      }).finally(function () { if (myReq === reqRef.current) { setBusy(false); } });
  }
  function openSheet(sheets, label) {
    if (!sheets.length) { setErr('The spreadsheet is empty.'); return; }
    setErr(''); setRead(null); setLines([]); setChecked(false);
    setSheet({ file: label, sheets: sheets, order: 'mdy', counts: null });
  }
  function applySheet() {
    var all = []; var counts = []; var amb = 0;
    sheet.sheets.forEach(function (s) {
      if (!s.use) { counts.push({ name: s.name, used: false, rows: s.rows.length }); return; }
      var r = linesFromRows(s.rows, s.header, s.map, sheet.order, sheet.sheets.length > 1 ? s.name : '');
      amb += r.ambiguous_dates; all = all.concat(r.lines);
      counts.push({ name: s.name, used: true, source_rows: r.source_rows, lines: r.lines.length, skipped: r.skipped });
    });
    var probs = [];
    var ls = cleanStatementLines(all, probs);
    if (amb) { probs.push(amb + ' date(s) could be read either way (like 03/04/2026) and were read as ' + (sheet.order === 'dmy' ? 'day / month' : 'month / day (US)') + ' — change it above if that is wrong.'); }
    counts.forEach(function (c) { if (!c.used) { probs.push('Sheet “' + c.name + '” (' + c.rows + ' rows) was NOT used.'); } });
    setSheet(Object.assign({}, sheet, { counts: counts }));
    startFrom({ source: 'sheet', statement: { vendor_name: null, statement_date: null, printed_total: null, currency: 'USD' }, problems: probs, file: sheet.file, incomplete: [], pages: null }, ls);
  }
  function setSheetPart(i, patch) { setSheet(Object.assign({}, sheet, { counts: null, sheets: sheet.sheets.map(function (s, j) { return j === i ? Object.assign({}, s, patch) : s; }) })); }
  function onFile(e) {
    var f = (e.target.files || [])[0]; e.target.value = '';
    if (!f) { return; }
    clearAll(); setErr(''); var pickNo = reqRef.current; // the file is read in the background: if another import starts meanwhile, this one stops
    if (f.size > 10 * 1024 * 1024) { setErr('That file is over 10 MB — split the statement.'); return; }
    var rd = new FileReader();
    if (SHEET_EXT.test(f.name)) {
      rd.onload = function () { if (pickNo !== reqRef.current) { return; } var sh = null; try { sh = workbookSheets(rd.result, /\.(csv|tsv)$/i.test(f.name)); } catch (eX) { setErr('The spreadsheet could not be opened (' + ((eX && eX.message) || 'error') + ').'); return; } openSheet(sh, f.name); };
      rd.readAsArrayBuffer(f); return;
    }
    if (!FILE_TYPES[f.type]) { setErr('Use a PDF, a photo (JPG / PNG / WebP), a spreadsheet (.xlsx / .xls / .csv) — or paste the lines.'); return; }
    rd.onload = function () {
      if (pickNo !== reqRef.current) { return; }
      var b64 = String(rd.result).split(',')[1] || '';
      // the real page count goes along, so the server can say when the reader did not read every page
      (f.type === 'application/pdf' ? pdfPageCountFromBase64(b64) : Promise.resolve(null)).then(function (n) { if (pickNo !== reqRef.current) { return null; } return ask({ media_type: f.type, file_base64: b64, page_count: n || undefined }, f.name); });
    };
    rd.readAsDataURL(f);
  }
  function readPaste() {
    clearAll(); setErr('');
    var rows = tabRows(paste);
    if (rows) { var g = guessColumns(rows); openSheet([{ name: 'pasted', rows: rows, use: g.header >= 0, header: g.header, map: g.map }], 'pasted rows'); return; }
    ask({ text: paste }, 'pasted text');
  }

  var choices = useMemo(function () { return vendorChoices(bills, read && read.statement && read.statement.vendor_name, payments); }, [bills, payments, read]);
  var vendorNames = Object.keys(picked).filter(function (k) { return picked[k]; });
  var clean = useMemo(function () { return cleanStatementLines(lines.map(function (l) { return { ref: l.ref, date: l.date, due_date: l.due_date, amount: l.amount, open: l.open, kind: l.kind, po: l.po, page: l.page, src: l.src }; }), []); }, [lines]);
  var printedN = cleanStatementAmount(printed);
  var addsUp = statementAddsUp(clean, printedN);
  var res = useMemo(function () { return checked && vendorNames.length ? checkStatement({ lines: clean, vendorNames: vendorNames, bills: bills, payments: payments, statementDate: stDate, asOf: asOf, picks: picks, statementCurrency: cur }) : null; }, [checked, vendorNames.join('|'), clean, bills, payments, stDate, asOf, picks, cur]); // eslint-disable-line
  var incomplete = read && read.incomplete && read.incomplete.length ? read.incomplete.join('; ') : '';
  var warnings = [].concat(enrichWarnings.map(function (w) { return 'Wire details are incomplete: ' + w + '. A payment without its wire is not proof of anything — the status comes from the payments only.'; }),
    cur !== 'USD' ? ['The statement is in ' + cur + '. Only our bills in ' + cur + ' are compared and added up against it; bills in other currencies are shown apart, never compared or added in (no exchange rate is assumed).'] : [],
    read && read.source === 'reader' && !(read.statement && read.statement.currency) ? ['The statement does not say its currency — USD is assumed. Change it above if that is wrong.'] : []);

  function setLine(i, patch) { setLines(lines.map(function (l, j) { return j === i ? Object.assign({}, l, patch) : l; })); }
  function exportCsv() {
    if (!res) { return; }
    var vend = vendorNames.join(' + ');
    var csv = statementCsv(res, { vendor: vend, statement_date: stDate, checked_at: new Date().toISOString().substring(0, 16).replace('T', ' '), adds_up: addsUp, incomplete: incomplete, warnings: warnings });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'statement-check-' + (vend.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'vendor') + '-' + (stDate || new Date().toISOString().substring(0, 10)) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function billBtn(f, tag) {
    return <button key={(tag || '') + f.id} onClick={function () { if (props.onOpenBill) { props.onOpenBill(f); } }} title={'Open our bill #' + (f.bill_number || '') + ' (read-only)'} className="px-1.5 py-0.5 rounded text-[10px] font-extrabold mr-1 mb-0.5" style={tag ? { background: '#fef9c3', color: '#713f12', border: '1px dashed #a16207' } : { background: '#1e293b', color: '#ffffff' }}>{(tag || '') + '#' + (f.bill_number || '(no #)') + ' ↗'}</button>;
  }
  function payChips(f) {
    return (f.payments || []).map(function (p, i) {
      var txt = (p.date || '?') + ' · ' + money(p.amount);
      if (p.wire) { return <button key={i} onClick={function () { if (props.onOpenWire) { props.onOpenWire(p.wire); } }} title={'Open ' + p.wire.label + ' — the ' + (p.wire.request ? 'request' : 'wire') + ' that carried this payment (read-only; needs the Wires: View permission)'} className="px-1.5 py-0.5 rounded text-[10px] font-extrabold mr-1 mb-0.5" style={{ background: '#4338ca', color: '#ffffff' }}>{'📤 ' + p.wire.label + ' · ' + txt}</button>; }
      if (p.bank) { return <button key={i} onClick={function () { if (props.onOpenWire) { props.onOpenWire(p.bank); } }} title="Open the bank line this payment was matched to (read-only; needs the Wires: View permission)" className="px-1.5 py-0.5 rounded text-[10px] font-extrabold mr-1 mb-0.5" style={{ background: '#0e7490', color: '#ffffff' }}>{'🏦 bank line · ' + txt}</button>; }
      return <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#f1f5f9', color: '#334155' }}>{txt + (p.method ? ' · ' + p.method : '') + ' · no bank line'}</span>;
    });
  }
  var inp = 'px-1.5 py-0.5 rounded border border-slate-300 text-[11px] text-slate-900 bg-white nt-light';
  var shownRows = res ? res.rows.filter(function (r) { return !showOnly || r.status === showOnly; }) : [];

  return <div className="rounded-xl p-3 mb-3" style={{ background: '#ffffff', color: INK, border: '2px solid #0f766e' }} role="region" aria-label="Check a vendor statement">
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <div className="text-[13px] font-extrabold">🧾 Check a vendor statement</div>
      <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: '#ccfbf1', color: '#134e4a' }}>READ-ONLY — nothing in the Hub is changed</span>
      <div className="flex-1" />
      <button onClick={props.onClose} className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕ Close</button>
    </div>
    <div className="flex gap-2 items-start flex-wrap mb-2">
      <button onClick={function () { if (fileRef.current) { fileRef.current.click(); } }} disabled={busy} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>{busy ? 'Reading… (a long statement can take a few minutes)' : '📄 Import the statement (PDF, photo or spreadsheet)'}</button>
      <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,.xlsx,.xls,.xlsm,.ods,.csv,.tsv" style={{ display: 'none' }} onChange={onFile} />
      <div className="flex-1" style={{ minWidth: 280 }}>
        <textarea value={paste} onChange={function (e) { setPaste(e.target.value); }} placeholder="…or paste the statement lines here (from an e-mail, a web page or a sheet)" aria-label="Paste the statement lines" rows={2} className={inp} style={{ width: '100%' }} />
        <button onClick={readPaste} disabled={busy || paste.trim().length < 5} className="mt-1 px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#134e4a', color: '#ffffff', opacity: (busy || paste.trim().length < 5) ? 0.5 : 1 }}>Read the pasted text</button>
      </div>
    </div>
    {err && <div className="rounded-lg px-3 py-2 mb-2 text-[12px] font-extrabold" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>{'⛔ ' + err}</div>}
    {warnings.map(function (w, i) { return <div key={i} className="rounded-lg px-3 py-1.5 mb-2 text-[11px] font-bold" style={{ background: '#fff7ed', color: '#9a3412', border: '1px solid #fdba74' }}>{'⚠ ' + w}</div>; })}

    {sheet && <div className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid ' + LINE }}>
      <div className="text-[12px] font-extrabold mb-1">{'📊 ' + sheet.file + ' — read column by column (no AI). Check which column is which, then press “Use these columns”.'}</div>
      <label className="text-[11px] font-bold mr-2">Dates like 03/04/2026 are <select value={sheet.order} onChange={function (e) { setSheet(Object.assign({}, sheet, { order: e.target.value, counts: null })); }} className={inp}><option value="mdy">month / day (US)</option><option value="dmy">day / month</option></select></label>
      {sheet.sheets.map(function (s, i) {
        var hdr = s.header >= 0 ? (s.rows[s.header] || []) : [];
        var width = 0; s.rows.slice(0, 50).forEach(function (r) { if (r.length > width) { width = r.length; } });
        var cols = []; for (var c = 0; c < width; c++) { cols.push(c); }
        var cnt = sheet.counts && sheet.counts[i];
        return <div key={s.name} className="mt-2 rounded p-2" style={{ border: '1px solid ' + LINE, background: '#ffffff' }}>
          <label className="text-[11px] font-extrabold"><input type="checkbox" checked={!!s.use} onChange={function () { setSheetPart(i, { use: !s.use }); }} className="mr-1" />{'Sheet “' + s.name + '” · ' + s.rows.length + ' rows'}</label>
          <label className="text-[11px] font-bold ml-3">Headings are on row <input type="number" min={1} max={s.rows.length} value={s.header >= 0 ? s.header + 1 : ''} onChange={function (e) { var v = Number(e.target.value) - 1; setSheetPart(i, { header: v >= 0 ? v : -1 }); }} className={inp} style={{ width: 60 }} /></label>
          <div className="flex gap-2 flex-wrap mt-1">{SHEET_ROLES.map(function (ro) {
            return <label key={ro} className="text-[10px] font-bold">{SHEET_ROLE_LABEL[ro] + ' '}<select value={s.map[ro] === undefined ? '' : String(s.map[ro])} onChange={function (e) { var m2 = Object.assign({}, s.map); if (e.target.value === '') { delete m2[ro]; } else { m2[ro] = Number(e.target.value); } setSheetPart(i, { map: m2 }); }} className={inp}>
              <option value="">— none —</option>{cols.map(function (c2) { return <option key={c2} value={String(c2)}>{'column ' + XLSX.utils.encode_col(c2) + (hdr[c2] ? ' · ' + String(hdr[c2]).substring(0, 24) : '')}</option>; })}</select></label>;
          })}</div>
          {cnt && cnt.used && <div className="text-[11px] mt-1" style={{ color: cnt.skipped.length ? '#9a3412' : '#065f46' }}>{cnt.source_rows + ' rows after the headings → ' + cnt.lines + ' lines taken' + (cnt.skipped.length ? ' · ' + cnt.skipped.length + ' not taken: ' + cnt.skipped.slice(0, 12).map(function (k) { return 'row ' + k.row + ' (' + k.why + ')'; }).join(', ') + (cnt.skipped.length > 12 ? ' …' : '') : '')}</div>}
        </div>;
      })}
      <button onClick={applySheet} disabled={!sheet.sheets.some(function (s) { return s.use && s.map.ref !== undefined && (s.map.amount !== undefined || s.map.open !== undefined); })} className="mt-2 px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff' }}>Use these columns</button>
      <span className="text-[10px] ml-2" style={{ color: SUB }}>Needs at least the invoice number column and an amount or open column.</span>
    </div>}

    {read && <div className="rounded-lg p-2 mb-2" style={{ background: '#f8fafc', border: '1px solid ' + LINE }}>
      <div className="text-[12px] font-extrabold mb-1">{'Read from ' + (read.file || 'the statement') + ': ' + clean.length + ' line' + (clean.length === 1 ? '' : 's') + (read.source === 'reader' ? ' · vendor on the statement: ' + (read.statement.vendor_name || '(not read)') : '') + (read.pages ? ' · ' + read.pages.count + ' page(s) in the file' + (read.statement.pages_read ? ', ' + read.statement.pages_read + ' read' : '') : '')}</div>
      {incomplete && <div className="rounded px-2 py-1 my-1 text-[12px] font-extrabold" style={{ background: '#7f1d1d', color: '#ffffff' }}>{'⛔ INCOMPLETE READ — this is NOT a clean check: ' + incomplete + '.'}</div>}
      {read.problems.map(function (p, i) { return <div key={i} className="text-[11px]" style={{ color: '#9a3412' }}>{'⚠ ' + p}</div>; })}
      <div className="flex gap-3 flex-wrap items-center mt-1">
        <label className="text-[11px] font-bold">Statement date <input type="date" value={stDate} onChange={function (e) { setStDate(e.target.value); }} className={inp} /></label>
        <label className="text-[11px] font-bold">Total printed on it <input value={printed} onChange={function (e) { setPrinted(e.target.value); }} placeholder="as printed" className={inp} style={{ width: 110 }} aria-label="Total printed on the statement" /></label>
        <label className="text-[11px] font-bold">Currency <input value={cur} onChange={function (e) { setCur(e.target.value.toUpperCase().substring(0, 8)); }} className={inp} style={{ width: 60 }} aria-label="Currency of the statement" /></label>
      </div>
      {addsUp.printed_total !== null && !addsUp.agrees && <div className="rounded px-2 py-1 my-1 text-[12px] font-extrabold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{'⛔ Their lines add up to ' + money(addsUp.lines_total) + ', but the statement says ' + money(addsUp.printed_total) + ' (gap ' + money(addsUp.gap) + ') — a line may have been missed or misread. Compare with the file before relying on this check.'}</div>}
      {addsUp.printed_total !== null && addsUp.agrees && <div className="text-[11px] font-bold" style={{ color: '#065f46' }}>{'✓ Their lines add up to the total printed on the statement (' + money(addsUp.printed_total) + ')' + (incomplete ? ' — but the read was incomplete, see above.' : '.')}</div>}
      {addsUp.printed_total === null && <div className="text-[11px]" style={{ color: SUB }}>No total printed on the statement was read — type it above to compare the lines with it.</div>}
      {addsUp.open_column && <div className="text-[10px]" style={{ color: SUB }}>{'Their total is worked out from the OPEN amounts on the statement. Payment / credit lines without an open amount, and a balance brought forward, are listed but not added again' + (addsUp.not_added ? ' (' + addsUp.not_added + ' line' + (addsUp.not_added === 1 ? '' : 's') + ').' : '.')}</div>}

      <div className="mt-2 text-[12px] font-extrabold">1. Confirm the vendor — which of our vendor names is this statement from?</div>
      <div className="text-[10px]" style={{ color: SUB }}>Names that differ only by Inc / Corp / punctuation count as the same vendor and are ticked for you — check it. If we also keep this vendor under another name, tick that name too (similar names have a dashed border and are never ticked for you).</div>
      <input value={vq} onChange={function (e) { setVq(e.target.value); }} placeholder="🔎 find a vendor" aria-label="Find a vendor" className={inp + ' my-1'} />
      <div className="flex gap-1 flex-wrap" style={{ maxHeight: 120, overflow: 'auto' }}>
        {choices.filter(function (c) { return picked[c.name] || !vq || c.name.toLowerCase().indexOf(vq.toLowerCase()) >= 0; }).slice(0, 80).map(function (c) {
          var on = !!picked[c.name];
          return <label key={c.name} className="px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer" style={on ? { background: '#0f766e', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155', border: (c.suggested || c.similar) ? '1px dashed #0f766e' : '1px solid transparent' }} title={c.similar ? 'A similar name — it may be the same vendor or another company. Tick it only if it is the same vendor.' : undefined}>
            <input type="checkbox" checked={on} onChange={function () { var p = Object.assign({}, picked); if (on) { delete p[c.name]; } else { p[c.name] = true; } setPicked(p); }} className="mr-1" />{c.name + ' · ' + c.count + ' bill' + (c.count === 1 ? '' : 's') + (c.open > 0 ? ' · open ' + money(c.open) : '')}</label>;
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-extrabold">2. The lines read</span>
        <button onClick={function () { setEditOpen(!editOpen); }} className="text-[10px] underline font-bold" style={{ color: '#1d4ed8' }}>{editOpen ? 'hide' : 'show / correct them'}</button>
        <span className="text-[10px]" style={{ color: SUB }}>Correct a misread number or amount here (only in this screen — nothing is saved).</span>
      </div>
      {editOpen && <div style={{ maxHeight: 320, overflow: 'auto' }}><table className="w-full text-[11px] mt-1"><thead><tr style={{ color: SUB }}><th className="text-left">#</th><th className="text-left">From</th><th className="text-left">Their number</th><th className="text-left">Date</th><th className="text-right">Amount</th><th className="text-right">Open</th><th className="text-left">Kind</th><th className="text-left">PO / ref</th><th></th></tr></thead><tbody>
        {lines.map(function (l, i) {
          return <tr key={i} style={{ borderTop: '1px solid ' + LINE }}>
            <td>{i + 1}</td>
            <td className="text-[10px]" style={{ color: SUB }}>{l.src || (l.page ? 'page ' + l.page : '')}</td>
            <td><input value={l.ref || ''} onChange={function (e) { setLine(i, { ref: e.target.value }); }} className={inp} style={{ width: 120 }} aria-label={'Their number, line ' + (i + 1)} /></td>
            <td><input type="date" value={l.date || ''} onChange={function (e) { setLine(i, { date: e.target.value || null }); }} className={inp} aria-label={'Date, line ' + (i + 1)} /></td>
            <td className="text-right"><input value={l.amount === null || l.amount === undefined ? '' : String(l.amount)} onChange={function (e) { var v = numIn(e.target.value); if (v !== undefined) { setLine(i, { amount: v }); } }} className={inp} style={{ width: 90, textAlign: 'right' }} aria-label={'Amount, line ' + (i + 1)} /></td>
            <td className="text-right"><input value={l.open === null || l.open === undefined ? '' : String(l.open)} onChange={function (e) { var v = numIn(e.target.value); if (v !== undefined) { setLine(i, { open: v }); } }} className={inp} style={{ width: 90, textAlign: 'right' }} aria-label={'Open, line ' + (i + 1)} /></td>
            <td><select value={l.kind || 'invoice'} onChange={function (e) { setLine(i, { kind: e.target.value }); }} className={inp} aria-label={'Kind, line ' + (i + 1)}><option value="invoice">invoice</option><option value="credit">credit</option><option value="payment">payment</option><option value="forward">balance forward</option></select></td>
            <td>{l.po || ''}</td>
            <td><button onClick={function () { setLines(lines.filter(function (x, j) { return j !== i; })); setPicks({}); }} title="Leave this line out of the check" className="px-1.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>✕</button></td>
          </tr>;
        })}
      </tbody></table>
      <button onClick={function () { setLines(lines.concat([{ ref: '', date: null, amount: null, open: null, kind: 'invoice', po: null }])); }} className="mt-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>+ add a line they listed that was not read</button></div>}
      <div className="mt-2 flex gap-3 items-center flex-wrap text-[11px] font-bold">
        <span>Compare with:</span>
        <label><input type="radio" name="vs-asof" checked={asOf === 'current'} onChange={function () { setAsOf('current'); }} className="mr-1" />our bills and payments as they are today (current)</label>
        <label title={stDate ? '' : 'Fill in the statement date first'} style={{ opacity: stDate ? 1 : 0.5 }}><input type="radio" name="vs-asof" disabled={!stDate} checked={asOf === 'statement'} onChange={function () { setAsOf('statement'); }} className="mr-1" />as of their statement date (our payments made after it are left out)</label>
      </div>
      <div className="mt-2 flex gap-2 items-center flex-wrap">
        <button onClick={function () { setChecked(true); }} disabled={!vendorNames.length || !clean.length} className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', opacity: (!vendorNames.length || !clean.length) ? 0.5 : 1 }}>3. Check every line against our bills, payments and wires</button>
        {!vendorNames.length && <span className="text-[11px] font-bold" style={{ color: '#9a3412' }}>Tick the vendor first.</span>}
        {res && <button onClick={exportCsv} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>⬇ Export (CSV)</button>}
      </div>
    </div>}

    {res && <div>
      {incomplete && <div className="rounded px-2 py-1 mb-2 text-[12px] font-extrabold" style={{ background: '#7f1d1d', color: '#ffffff' }}>⛔ INCOMPLETE READ — the results below are NOT a clean check. Split the file and check each part.</div>}
      <div className="rounded-lg p-2 mb-2" style={{ background: '#f0fdfa', border: '1px solid #5eead4' }}>
        <div className="text-[11px] font-bold mb-1" style={{ color: SUB }}>{res.mode.words}</div>
        <div className="flex gap-3 flex-wrap text-[12px] font-extrabold">
          <span>{'They say we owe: ' + money(res.totals.they_say_we_owe) + ' ' + res.totals.currency}</span>
          <span>{'We show open for ' + vendorNames.join(' + ') + ': ' + money(res.totals.our_open)}</span>
          <span style={{ color: Math.abs(res.totals.difference) > 0.005 ? '#9a3412' : '#065f46' }}>{'Difference: ' + money(res.totals.difference)}</span>
          {Object.keys(res.totals.our_open_other_currency).map(function (c) { return <span key={c} style={{ color: '#9a3412' }}>{'Also open in ' + c + ': ' + money(res.totals.our_open_other_currency[c]) + ' (not added)'}</span>; })}
          {res.totals.unread_amounts > 0 && <span style={{ color: '#9a3412' }}>{res.totals.unread_amounts + ' line(s) without an amount'}</span>}
          {res.totals.our_open_dated_after_statement > 0 && <span style={{ color: '#9a3412' }}>{'of our open, ' + money(res.totals.our_open_dated_after_statement) + ' is dated after their statement (they could not bill it yet)'}</span>}
          {res.totals.excluded_after_statement.count > 0 && <span style={{ color: '#9a3412' }}>{res.totals.excluded_after_statement.count + ' bill(s) of ours dated after their statement left out (' + money(res.totals.excluded_after_statement.open) + ') — listed at the bottom'}</span>}
        </div>
        <div className="flex gap-1 flex-wrap mt-1">
          <button onClick={function () { setShowOnly(''); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={!showOnly ? { background: '#0f172a', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{'All ' + res.totals.lines}</button>
          {STATUS_KEYS.map(function (k) { var e = res.totals.by_status[k]; if (!e || !e.count) { return null; } var st = STATUS[k];
            return <button key={k} onClick={function () { setShowOnly(showOnly === k ? '' : k); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: st.bg, color: st.fg, outline: showOnly === k ? '2px solid #0f172a' : 'none' }}>{st.label + ' · ' + e.count + ' · ' + money(e.owed)}</button>; })}
          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#fef9c3', color: '#713f12' }}>{'Ours open, not on their statement · ' + res.totals.ours_not_on_statement.count + ' · ' + money(res.totals.ours_not_on_statement.open)}</span>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}><table className="w-full text-[11px]"><thead><tr style={{ color: SUB, borderBottom: '1px solid ' + LINE }}>
        <th className="text-left py-1 pr-2">#</th><th className="text-left pr-2">Their number</th><th className="text-left pr-2">Their date</th><th className="text-right pr-2">They say open</th><th className="text-left pr-2">Result</th><th className="text-left pr-2">Our bill</th><th className="text-right pr-2">Our open</th><th className="text-left pr-2">Paid (date · amount · wire)</th><th className="text-left">Notes</th></tr></thead><tbody>
        {shownRows.map(function (r) {
          var st = STATUS[r.status]; var l = r.line;
          return <tr key={l.n} style={{ borderTop: '1px solid ' + LINE, verticalAlign: 'top' }}>
            <td className="py-1 pr-2">{l.n}</td>
            <td className="pr-2 font-bold">{l.ref || '—'}{l.po ? <div className="text-[10px] font-normal" style={{ color: SUB }}>{l.po}</div> : null}</td>
            <td className="pr-2">{l.date || '—'}</td>
            <td className="pr-2 text-right font-bold">{r.owed === null ? '—' : money(r.owed)}{!r.counted && r.owed !== null ? <div className="text-[9px] font-normal" style={{ color: SUB }}>not added</div> : null}</td>
            <td className="pr-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold" style={{ background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span></td>
            <td className="pr-2">{r.bills.map(function (f) { return billBtn(f); })}{r.suggestions.map(function (f) { return billBtn(f, 'possibly '); })}{r.other_vendor.map(function (f) { return billBtn(f, f.vendor_name + ' '); })}{(r.other_currency || []).map(function (f) { return billBtn(f, f.currency + ', not compared · '); })}
              {r.status === 'ambiguous' || (r.primary_id && r.bills.length > 1) ? <div><select value={picks[l.n] || ''} onChange={function (e) { var p2 = Object.assign({}, picks); if (e.target.value) { p2[l.n] = e.target.value; } else { delete p2[l.n]; } setPicks(p2); }} className={inp} aria-label={'Which of our bills is line ' + l.n}>
                <option value="">— pick which of our bills this is —</option>{r.bills.filter(function (f) { return f.status !== 'VOID'; }).map(function (f) { return <option key={f.id} value={String(f.id)}>{'#' + (f.bill_number || '') + ' · ' + (f.bill_date || '?') + ' · ' + money(f.total) + ' · ' + f.status}</option>; })}</select></div> : null}</td>
            <td className="pr-2 text-right">{r.bills.length ? r.bills.map(function (f) { return <div key={f.id}>{money(f.open) + ' · ' + f.status}</div>; }) : '—'}</td>
            <td className="pr-2">{r.bills.map(function (f) { return <div key={f.id}>{payChips(f)}</div>; })}</td>
            <td style={{ maxWidth: 380 }}>{r.evidence.map(function (n, i) { return <div key={'e' + i} className="font-bold" style={{ color: '#7f1d1d' }}>{'Evidence: ' + n}</div>; })}{r.notes.map(function (n, i) { return <div key={i}>{n}</div>; })}</td>
          </tr>;
        })}
      </tbody></table></div>
      <div className="mt-3 text-[12px] font-extrabold">{'Our open bills for ' + vendorNames.join(' + ') + ' that are NOT on their statement (' + res.ours_not_on_statement.length + ')'}</div>
      {res.ours_not_on_statement.length === 0 ? <div className="text-[11px]" style={{ color: SUB }}>None — every open bill of ours is on their statement.</div> :
        <table className="w-full text-[11px]"><thead><tr style={{ color: SUB }}><th className="text-left pr-2">Our bill</th><th className="text-left pr-2">Bill date</th><th className="text-left pr-2">Due</th><th className="text-right pr-2">Total</th><th className="text-right pr-2">Open</th><th className="text-left">Notes</th></tr></thead><tbody>
          {res.ours_not_on_statement.map(function (f) {
            var nt = [f.currency !== res.totals.currency ? 'in ' + f.currency + ' (not added)' : '', f.status === 'PARTIAL' ? 'partly paid ' + money(f.paid) : '', f.after_statement ? 'dated after their statement' : '', f.date_unknown ? 'no bill date — cannot tell whether it was due by their statement' : '', f.suggested_for.length ? 'possibly their line ' + f.suggested_for.join(', ') + ' (same amount and date, other number)' : '', f.wire_state_words || '', f.disputed ? 'disputed' : '', f.paid_via ? 'paid through ' + f.paid_via : '', f.validation_status !== 'validated' ? 'not validated' : ''].filter(Boolean).join(' · ');
            return <tr key={f.id} style={{ borderTop: '1px solid ' + LINE }}><td className="py-1 pr-2">{billBtn(f)}</td><td className="pr-2">{f.bill_date || '—'}</td><td className="pr-2">{f.due_date || '—'}</td><td className="pr-2 text-right">{money(f.total)}</td><td className="pr-2 text-right font-bold">{money(f.open)}</td><td>{nt}</td></tr>;
          })}
        </tbody></table>}
      {res.excluded_after_statement.length > 0 && <div className="mt-3">
        <div className="text-[12px] font-extrabold">{'Our open bills dated AFTER their statement date (' + res.excluded_after_statement.length + ') — left out of this as-of comparison and of every total'}</div>
        <table className="w-full text-[11px]"><tbody>{res.excluded_after_statement.map(function (f) { return <tr key={f.id} style={{ borderTop: '1px solid ' + LINE }}><td className="py-1 pr-2">{billBtn(f)}</td><td className="pr-2">{f.bill_date}</td><td className="pr-2 text-right">{money(f.total)}</td><td className="pr-2 text-right font-bold">{money(f.open)}</td><td>{f.currency + ' · ' + f.status}</td></tr>; })}</tbody></table>
      </div>}
      <div className="mt-2 text-[10px]" style={{ color: SUB }}>Matched by the same bill number (also written another way, like INV-14481 / 14481). A bill with only the same amount and date is a SUGGESTION, never a match. A wire that is prepared, approved or sent is not a payment — only a recorded payment is. Deleted bills are not counted. This check changes nothing — to fix a bill, open it in the Bills list.</div>
    </div>}
  </div>;
}
