'use client';
// v55.83-QC — 📄 Import statement CSV (Max, Nov 7 11:52: "do we have a manual
// importer of csv if plaid is not working"). Plaid's M&T link delivered ONE
// transaction across four links — this is the guaranteed route: download the
// CSV from the bank's own online banking, upload it here, map the columns
// once, and every row flows into the SAME pipeline as a Plaid transaction
// (categories, rules, matching, transfers, Wave, tax reports).
//
// The file is parsed IN THE BROWSER (no upload of the raw file); only clean
// rows go to the server, which dedupes against everything already stored —
// re-importing the same file adds nothing, overlap with Plaid is skipped.
import React, { useState } from 'react';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Small CSV parser — quotes, escaped quotes, CRLF. No dependency.
export function parseCsv(text) {
  var rows = []; var row = []; var cur = ''; var inQ = false;
  var s = String(text || '');
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; } }
      else { cur += ch; }
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') { i++; }
      row.push(cur); cur = '';
      if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) { rows.push(row); }
      row = [];
    } else { cur += ch; }
    if (rows.length > 25000) { break; }
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0].trim() !== '') { rows.push(row); } }
  return rows;
}

// US bank statements: MM/DD/YYYY, M/D/YY, or already YYYY-MM-DD. Returns
// YYYY-MM-DD or null — never guesses day-first (US banks are month-first).
export function parseUsDate(x) {
  var v = String(x || '').trim();
  var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { return m[1] + '-' + m[2] + '-' + m[3]; }
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var mo = Number(m[1]); var dy = Number(m[2]); var yr = Number(m[3]);
    if (yr < 100) { yr += 2000; }
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31 && yr >= 2000 && yr <= 2100) {
      return String(yr) + '-' + ('0' + mo).slice(-2) + '-' + ('0' + dy).slice(-2);
    }
  }
  return null;
}

// "$1,234.56", "(1,234.56)" = negative, "-15.00". Returns Number or null.
export function parseMoney(x) {
  var v = String(x == null ? '' : x).trim();
  if (!v) { return null; }
  var neg = /^\(.*\)$/.test(v);
  v = v.replace(/[(),$\s]/g, '');
  if (v === '' || v === '-') { return null; }
  var n = Number(v);
  if (!isFinite(n)) { return null; }
  return neg ? -Math.abs(n) : n;
}

// v55.83-RC (Max, Nov 8 13:59: "when you do an import for a bank you need to
// include the transaction description") — the CANDIDATE order decides, not the
// column order: a Chase file starts with "Details" (DEBIT/CREDIT) before
// "Description", and the old loop took "Details". An exact header name wins
// first, then the first header containing the best candidate.
function guessCol(headers, cands, avoid) {
  var hs = headers.map(function (h0) { return String(h0 || '').toLowerCase().trim(); });
  var skip = function (i0) { return (avoid || []).indexOf(i0) >= 0; };
  for (var j = 0; j < cands.length; j++) { for (var i = 0; i < hs.length; i++) { if (!skip(i) && hs[i] === cands[j]) { return i; } } }
  for (var j2 = 0; j2 < cands.length; j2++) { for (var i2 = 0; i2 < hs.length; i2++) { if (!skip(i2) && hs[i2].indexOf(cands[j2]) >= 0) { return i2; } } }
  return -1;
}

export default function StatementImport(props) {
  var userProfile = props.userProfile;
  var canUse = props.canUse === true;
  var s1 = useState(false); var open = s1[0]; var setOpen = s1[1];
  var s2 = useState(null); var parsed = s2[0]; var setParsed = s2[1]; // {headers, rows}
  var s3 = useState(null); var map = s3[0]; var setMap = s3[1];       // {dateCol, descCol, mode, amountCol, debitCol, creditCol, negIsOut}
  var s4 = useState([]); var targets = s4[0]; var setTargets = s4[1];
  var s5 = useState(''); var target = s5[0]; var setTarget = s5[1];
  var s6 = useState(false); var busy = s6[0]; var setBusy = s6[1];
  var s7 = useState(null); var result = s7[0]; var setResult = s7[1];
  var s8 = useState(''); var err = s8[0]; var setErr = s8[1];
  var s9 = useState(null); var newAcct = s9[0]; var setNewAcct = s9[1]; // v55.83-QS — {institution, name, mask} while adding a manual account

  function api(payload) {
    return fetch('/api/accounting/statement-import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json(); });
  }
  // v55.83-QS (Max, Nov 8 01:00): add a bank Plaid can't connect (PNC) as a
  // MANUAL account, then import its CSV. Same bank + same last-4 later via
  // Plaid is recognized as the same account — nothing doubles either way.
  function createManual() {
    if (!newAcct) { return; }
    setBusy(true); setErr('');
    api({ action: 'create_manual_account', institution: newAcct.institution, name: newAcct.name, mask: newAcct.mask }).then(function (j) {
      if (j && j.ok && j.account) {
        var a = j.account;
        setTargets(function (prev) {
          var has = (prev || []).some(function (p) { return p.plaid_account_id === a.plaid_account_id; });
          return has ? prev : (prev || []).concat([{ plaid_account_id: a.plaid_account_id, name: a.name, mask: a.mask, institution: a.institution || newAcct.institution, connection_status: 'manual' }]);
        });
        setTarget(a.plaid_account_id); setNewAcct(null);
        setResult(null); setErr('');
        if (j.existing) { setErr('ℹ ' + (j.note || 'That account already exists — selected it.')); }
      } else { setErr((j && j.error) || 'Could not add the account.'); }
    }).finally(function () { setBusy(false); });
  }
  function openPanel() {
    setOpen(true); setErr(''); setResult(null);
    api({ action: 'targets' }).then(function (j) {
      if (j && j.ok) { setTargets(j.accounts || []); }
      else { setErr((j && j.error) || 'Could not load the account list.'); }
    });
  }
  function onFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) { return; }
    setErr(''); setResult(null);
    var rd = new FileReader();
    rd.onload = function () {
      var rows = parseCsv(String(rd.result || ''));
      if (rows.length < 2) { setErr('That file has no data rows.'); return; }
      var headers = rows[0];
      // date: the FIRST date column, exactly as before — a re-import must land on the same dates or it would not recognise its own lines
      var dateCol = -1; headers.forEach(function (h1, i1) { if (dateCol < 0 && String(h1 || '').toLowerCase().indexOf('date') >= 0) { dateCol = i1; } });
      var descCol = guessCol(headers, ['description', 'transaction description', 'payee', 'merchant', 'narrative', 'name', 'memo', 'transaction details', 'details', 'detail', 'transaction']);
      var memoCol = guessCol(headers, ['memo', 'notes', 'note', 'additional info', 'reference'], [descCol]);
      var amountCol = guessCol(headers, ['amount']);
      var debitCol = guessCol(headers, ['debit', 'withdrawal', 'money out']);
      var creditCol = guessCol(headers, ['credit', 'deposit', 'money in']);
      var checkCol = guessCol(headers, ['check', 'cheque']);
      var mode = (debitCol >= 0 && creditCol >= 0 && amountCol < 0) ? 'debitcredit' : 'single';
      setParsed({ headers: headers, rows: rows.slice(1) });
      setMap({ dateCol: dateCol, descCol: descCol, memoCol: memoCol, mode: mode, amountCol: amountCol, debitCol: debitCol, creditCol: creditCol, checkCol: checkCol, negIsOut: true });
    };
    rd.readAsText(f);
  }
  // One place turns a CSV row into {date, name, direction, amount_abs} or null.
  function normalize(r0) {
    if (!map) { return null; }
    var dt = parseUsDate(r0[map.dateCol]);
    if (!dt) { return null; }
    var nm = String(r0[map.descCol] || '').trim();
    // v55.83-RC — a separate memo column rides along ("PSEG · Bill pay 1234")
    var memo = map.memoCol >= 0 && map.memoCol !== map.descCol ? String(r0[map.memoCol] || '').trim() : '';
    if (memo && nm.toLowerCase().indexOf(memo.toLowerCase()) < 0) { nm = nm ? nm + ' · ' + memo : memo; }
    var dir = null; var amt = null;
    if (map.mode === 'debitcredit') {
      var dn = parseMoney(r0[map.debitCol]); var cn = parseMoney(r0[map.creditCol]);
      if (dn != null && Math.abs(dn) > 0) { dir = 'out'; amt = Math.abs(dn); }
      else if (cn != null && Math.abs(cn) > 0) { dir = 'in'; amt = Math.abs(cn); }
    } else {
      var n = parseMoney(r0[map.amountCol]);
      if (n == null || n === 0) { return null; }
      var outIsNeg = map.negIsOut !== false;
      dir = (n < 0) === outIsNeg ? 'out' : 'in';
      amt = Math.abs(n);
    }
    if (!dir || !(amt > 0)) { return null; }
    // alts = the line's OTHER text cells: on a re-import the server repairs a
    // line an earlier import stored with one of these (e.g. "DEBIT") instead of
    // its description — same line only, never a different payee.
    var alts = [];
    r0.forEach(function (c0, ci) { if (ci !== map.descCol && ci !== map.dateCol && ci !== map.amountCol && ci !== map.debitCol && ci !== map.creditCol) { var v0 = String(c0 || '').trim(); if (v0 && v0.length <= 120) { alts.push(v0); } } });
    return { date: dt, name: nm || '(no description)', direction: dir, amount_abs: Math.round(amt * 100) / 100, alts: alts,
      check_number: map.checkCol >= 0 ? String(r0[map.checkCol] || '').trim() : '' };
  }
  function normalizedAll() {
    var out = []; var badN = 0;
    ((parsed && parsed.rows) || []).forEach(function (r0) { var n = normalize(r0); if (n) { out.push(n); } else { badN++; } });
    return { rows: out, bad: badN };
  }
  function doImport() {
    if (!target) { setErr('Pick which account these rows belong to.'); return; }
    var all = normalizedAll();
    if (!all.rows.length) { setErr('No readable rows with the current column mapping — fix the dropdowns.'); return; }
    setBusy(true); setErr(''); setResult(null);
    var chunks = [];
    for (var i = 0; i < all.rows.length; i += 1000) { chunks.push(all.rows.slice(i, i + 1000)); }
    var agg = { imported: 0, skipped_existing: 0, descriptions_updated: 0, skipped_bad: all.bad, from: null, to: null };
    var chain = Promise.resolve(true);
    chunks.forEach(function (ch) {
      chain = chain.then(function (okSoFar) {
        if (!okSoFar) { return false; }
        return api({ action: 'import_rows', target_plaid_account_id: target, rows: ch }).then(function (j) {
          if (!j || !j.ok) { setErr((j && j.error) || 'Import failed part-way — what already imported stays (re-running is safe: nothing duplicates).'); return false; }
          agg.imported += j.imported || 0; agg.skipped_existing += j.skipped_existing || 0; agg.descriptions_updated += j.descriptions_updated || 0; if (j.us_books === false) { agg.not_us = true; } agg.skipped_bad += j.skipped_bad || 0;
          if (j.window) { if (!agg.from || j.window.from < agg.from) { agg.from = j.window.from; } if (!agg.to || j.window.to > agg.to) { agg.to = j.window.to; } }
          return true;
        });
      });
    });
    chain.then(function (okAll) { if (okAll) { setResult(agg); } }).finally(function () { setBusy(false); });
  }

  if (!canUse) { return null; }
  if (!open) {
    return <div className="mt-3"><button onClick={openPanel} className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff' }}
      title="Bank won't give Plaid the history? Download the CSV from the bank's own online banking and import it here — it flows into the same pipeline (categories, rules, matching, reports), and anything Plaid already pulled is skipped automatically.">
      📄 Import statement CSV (when Plaid can't get the history)</button></div>;
  }
  var all = parsed ? normalizedAll() : { rows: [], bad: 0 };
  var sumIn = 0; var sumOut = 0; var minD = null; var maxD = null;
  all.rows.forEach(function (r0) { if (r0.direction === 'in') { sumIn += r0.amount_abs; } else { sumOut += r0.amount_abs; } if (!minD || r0.date < minD) { minD = r0.date; } if (!maxD || r0.date > maxD) { maxD = r0.date; } });
  var selStyle = { color: '#0f172a', background: '#ffffff' };
  function colSel(label, key) {
    return <label className="text-[10px] font-bold" style={{ color: '#334155' }}>{label}
      <select value={map[key]} onChange={function (e) { var m2 = Object.assign({}, map); m2[key] = Number(e.target.value); setMap(m2); }}
        className="ml-1 px-1 py-0.5 rounded border border-slate-300 text-[10px] nt-light" style={selStyle}>
        <option value={-1}>—</option>
        {parsed.headers.map(function (h, i) { return <option key={i} value={i}>{String(h).substring(0, 24) || ('col ' + (i + 1))}</option>; })}
      </select></label>;
  }
  return <div className="mt-3 rounded-xl p-3" style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}>
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold" style={{ color: '#0f172a' }}>📄 Import statement CSV</div>
      <div className="flex-1" />
      <button onClick={function () { setOpen(false); setParsed(null); setResult(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>✕ close</button>
    </div>
    <div className="text-[10px] mb-2" style={{ color: '#64748b' }}>Download the transactions CSV from the bank's own online banking (full date range), upload it here, check the mapping, import. Rows join the normal pipeline — categories, rules, matching, transfers, reports. Anything already stored (Plaid or an earlier import) is skipped automatically, so re-importing is always safe.</div>
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-[10px]" style={{ color: '#334155' }} />
      <select value={target} onChange={function (e) { setTarget(e.target.value); }} className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px] nt-light" style={selStyle}>
        <option value="">these rows belong to account…</option>
        {targets.map(function (a) { return <option key={a.plaid_account_id} value={a.plaid_account_id}>{a.institution} · {a.name}{a.mask ? ' •' + a.mask : ''}{a.connection_status === 'archived' ? ' (archived link)' : a.connection_status === 'manual' ? ' (manual — CSV only)' : ''}</option>; })}
      </select>
      {!newAcct && <button onClick={function () { setNewAcct({ institution: '', name: '', mask: '' }); }} title="A bank Plaid can't connect yet (e.g. PNC)? Add it here, then import its CSV. If Plaid connects it later, the same last-4 is recognized and nothing doubles."
        className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff' }}>➕ account not in the list (e.g. PNC)</button>}
    </div>
    {newAcct && <div className="flex gap-2 items-center flex-wrap mb-2 rounded-lg p-2" style={{ background: '#f0fdfa', border: '1px solid #99f6e4' }}>
      <span className="text-[10px] font-extrabold" style={{ color: '#134e4a' }}>New manual account:</span>
      <input value={newAcct.institution} onChange={function (e) { setNewAcct(Object.assign({}, newAcct, { institution: e.target.value })); }} placeholder="Bank (e.g. PNC)" className="px-1.5 py-1 rounded border border-slate-300 text-[10px] nt-light" style={{ width: 120 }} />
      <input value={newAcct.name} onChange={function (e) { setNewAcct(Object.assign({}, newAcct, { name: e.target.value })); }} placeholder="Account name (e.g. Business Checking)" className="px-1.5 py-1 rounded border border-slate-300 text-[10px] nt-light" style={{ width: 210 }} />
      <input value={newAcct.mask} onChange={function (e) { setNewAcct(Object.assign({}, newAcct, { mask: e.target.value })); }} placeholder="Last 4 digits" maxLength={4} className="px-1.5 py-1 rounded border border-slate-300 text-[10px] nt-light" style={{ width: 90 }} />
      <button onClick={createManual} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', opacity: busy ? 0.5 : 1 }}>Add account ✓</button>
      <button onClick={function () { setNewAcct(null); }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>cancel</button>
      <div className="w-full text-[9px]" style={{ color: '#134e4a' }}>The last 4 digits matter: if Plaid ever connects this same account, the hub recognizes it by bank + last 4 and skips every transaction you already imported — and a re-import of the same CSV adds nothing.</div>
    </div>}
    {parsed && map && <div className="flex gap-3 items-center flex-wrap mb-2 rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      {colSel('Date', 'dateCol')}
      {colSel('Description', 'descCol')}
      {colSel('+ Memo (optional)', 'memoCol')}
      <label className="text-[10px] font-bold" style={{ color: '#334155' }}>Amounts
        <select value={map.mode} onChange={function (e) { setMap(Object.assign({}, map, { mode: e.target.value })); }} className="ml-1 px-1 py-0.5 rounded border border-slate-300 text-[10px] nt-light" style={selStyle}>
          <option value="single">one amount column</option>
          <option value="debitcredit">separate debit / credit columns</option>
        </select></label>
      {map.mode === 'single' && colSel('Amount', 'amountCol')}
      {map.mode === 'single' && <label className="text-[10px] font-bold" style={{ color: '#334155' }}>
        <select value={map.negIsOut ? 'neg' : 'pos'} onChange={function (e) { setMap(Object.assign({}, map, { negIsOut: e.target.value === 'neg' })); }} className="px-1 py-0.5 rounded border border-slate-300 text-[10px] nt-light" style={selStyle}>
          <option value="neg">negative = money out (most banks)</option>
          <option value="pos">positive = money out</option>
        </select></label>}
      {map.mode === 'debitcredit' && colSel('Debit (out)', 'debitCol')}
      {map.mode === 'debitcredit' && colSel('Credit (in)', 'creditCol')}
      {colSel('Check # (optional)', 'checkCol')}
    </div>}
    {parsed && map && <div className="mb-2">
      <div className="text-[10px] font-extrabold mb-1" style={{ color: '#0f172a' }}>
        {all.rows.length} readable row(s){all.bad > 0 ? ' · ' + all.bad + ' skipped (no date/amount — headers, totals, balance lines)' : ''}{minD ? ' · ' + minD + ' → ' + maxD : ''} · in +${fmt(sumIn)} · out −${fmt(sumOut)}</div>
      <table className="w-full text-[10px]"><tbody style={{ color: '#0f172a' }}>
        {all.rows.slice(0, 5).map(function (r0, i) {
          return <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
            <td className="py-0.5 pr-2 whitespace-nowrap">{r0.date}</td>
            <td className="py-0.5 pr-2">{r0.name.substring(0, 60)}</td>
            <td className="py-0.5 text-right font-extrabold tabular-nums" style={{ color: r0.direction === 'out' ? '#7f1d1d' : '#065f46' }}>{(r0.direction === 'out' ? '−$' : '+$') + fmt(r0.amount_abs)}</td></tr>;
        })}
      </tbody></table>
      {all.rows.length > 5 && <div className="text-[9px]" style={{ color: '#64748b' }}>…first 5 shown — the import takes all {all.rows.length}.</div>}
    </div>}
    {err && <div className="text-[10px] font-bold mb-1 rounded p-1.5" style={{ background: '#fef2f2', color: '#7f1d1d' }}>{err}</div>}
    {result && <div className="text-[10px] font-bold mb-1 rounded p-1.5" style={{ background: '#ecfdf5', color: '#064e3b' }}>
      ✅ Imported {result.imported} transaction(s) ({result.from} → {result.to}) · {result.skipped_existing} already stored (no duplicate made){result.descriptions_updated ? ' · ' + result.descriptions_updated + ' stored line(s) got their real description' : ''} · {result.skipped_bad} unreadable line(s). They now behave like any bank transaction — categorize in 📑 All Transactions (rules + bulk make it fast), match deposits to invoices, pair transfers. The 15-minute sync also runs your rules on them automatically.
        {result.window_hint !== false && result.from && result.from < '2026-01-01' ? ' Lines before Jan 1, 2026: in 📑 All Transactions press "All dates" to see them.' : ''}
        {result.not_us ? ' ⚠ This account is assigned to a NON-US silo, so ClickBooks (USA) screens do not list it — move it to the USA silo in the Bank tab if it is a US account.' : ''}</div>}
    {parsed && <button onClick={doImport} disabled={busy || !target || all.rows.length === 0}
      className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold" style={{ background: '#0f766e', color: '#ffffff', opacity: (busy || !target || all.rows.length === 0) ? 0.5 : 1 }}>
      {busy ? 'Importing…' : 'Import ' + all.rows.length + ' row(s) ✓'}</button>}
  </div>;
}
