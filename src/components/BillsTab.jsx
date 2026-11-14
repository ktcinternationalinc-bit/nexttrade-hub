'use client';
// v55.83-PB — Accounting > Bills (AP). Max (Nov 5): "add a vendors bill side".
// Enter what the company owes, track OPEN / PARTIAL / PAID, and pay a bill by
// linking the REAL bank transaction (money out, settled). Writes need the
// bills.manage permission; nothing is ever deleted — bills void, payments void.
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { US_WAVE_BUSINESS_ID } from '../lib/business-of';
import { BILL_TYPES, BILL_TYPE_LABEL } from '../lib/bill-extract';
import BillLinesPanel, { PriceCheckBox } from './BillLinesPanel'; // v55.83-RQ
import PriceRulesPanel from './PriceRulesPanel';
import PayablesPanel from './PayablesPanel'; // v55.83-SJ
import BillReportsPanel from './BillReportsPanel';
// v55.83-RP — where an imported value came from, said plainly to the person validating it
var SRC_WORDS = { vendor_default: '🏷 this vendor’s bills are always this way', read_from_bill: '🤖 read from the bill', vendor_history: '🧠 from this vendor’s past bills', release_number: '🤖 release # on the bill → outbound', validator: '✓ set at validation', manual: '✍ set by hand' };

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
var TODAY = new Date().toISOString().substring(0, 10);

export default function BillsTab(props) {
  var userProfile = props.userProfile;
  var isSuperAdmin = props.isSuperAdmin === true || (userProfile && userProfile.role === 'super_admin');
  var modulePerms = props.modulePerms || {};
// v55.83-SA (Max, Nov 12 07:27: "Why are people not seeing bills when they have permission") — owner / admin = every switch
  // (the permissions box says "always (admin)" and the server already agrees); the screen gates now say the same.
  var bossB = isSuperAdmin || (userProfile && (userProfile.role === 'owner' || userProfile.role === 'admin'));
  var canView = bossB || modulePerms['bills.view'] === true || modulePerms['bills.manage'] === true;
  var canManage = bossB || modulePerms['bills.manage'] === true;
  var toast = props.toast || { success: function () {}, error: function () {} };

  var s1 = useState(null); var data = s1[0]; var setData = s1[1];
  var sE = useState(''); var loadErr = sE[0]; var setLoadErr = sE[1]; // v55.83-SA — why the list did not load, ON the screen (a toast is missed; an empty list looks like "no bills")
  var s2 = useState(false); var busy = s2[0]; var setBusy = s2[1];
  var s3 = useState(null); var editing = s3[0]; var setEditing = s3[1]; // bill draft or null
  var s4 = useState(null); var paying = s4[0]; var setPaying = s4[1];   // {bill, amount, paid_date, bank_transaction_id}
  var s5 = useState('open'); var filter = s5[0]; var setFilter = s5[1];
  var s6 = useState([]); var outTxns = s6[0]; var setOutTxns = s6[1];
  var s7 = useState(null); var expanded = s7[0]; var setExpanded = s7[1];
  var s8 = useState(null); var importFile = s8[0]; var setImportFile = s8[1]; // {file, base64, media_type}
  var s9 = useState(false); var reading = s9[0]; var setReading = s9[1];
  var s10 = useState([]); var importNotes = s10[0]; var setImportNotes = s10[1];
  var s11 = useState(null); var validating = s11[0]; var setValidating = s11[1]; // {bill, checks, notes}
  var s12 = useState(null); var disputing = s12[0]; var setDisputing = s12[1];   // {bill, reason, follow_up_date}
  var s13 = useState(null); var dueThru = s13[0]; var setDueThru = s13[1];       // result of due_through
  var s14 = useState(''); var thruDate = s14[0]; var setThruDate = s14[1];
  var s15 = useState(null); var cats = s15[0]; var setCats = s15[1];           // v55.83-PJ — shared category list (null = not loaded, free text fallback)
  var s16 = useState(''); var newCatB = s16[0]; var setNewCatB = s16[1];       // v55.83-PJ — inline add-category
  var s17 = useState(false); var addingCat = s17[0]; var setAddingCat = s17[1];
  // v55.83-RQ (Max 21:18: "with bills we can sort them by the types and the direction") + the rules / reports panels
  var s18 = useState(''); var typeF = s18[0]; var setTypeF = s18[1];
  var s19 = useState(''); var dirF = s19[0]; var setDirF = s19[1];
  var s20 = useState('due'); var sortBy = s20[0]; var setSortBy = s20[1];
  var s21 = useState(null); var panel = s21[0]; var setPanel = s21[1]; // 'rules' | 'reports'
  var s22 = useState(''); var priceF = s22[0]; var setPriceF = s22[1];
  // v55.83-RU (Max, Nov 9 21:48: "please save entries when we validate even if we have not yet fully validated. such as just
  // entering the type or the direction") — every entry in the validation panel is saved as it is made
  var s23 = useState(''); var vSaved = s23[0]; var setVSaved = s23[1];
  var s24 = useState(null); var pricePreview = s24[0]; var setPricePreview = s24[1];
  var s25 = useState(null); var rowAsk = s25[0]; var setRowAsk = s25[1]; // RV — void bill / void payment / resolve dispute, asked under the row (no browser pop-ups)
  function closePanels() { if (vRef.current && vTimer.current) { flushV(); } vRef.current = null; setValidating(null); setPaying(null); setDisputing(null); setRowAsk(null); setEditing(function (e) { return e && e.id ? null : e; }); } // RU — the price check of a bill being imported, before Save
  var vRef = useRef(null); var vTimer = useRef(null);
  function flushV() {
    if (vTimer.current) { clearTimeout(vTimer.current); vTimer.current = null; }
    var v = vRef.current; if (!v) { return Promise.resolve(null); }
    setVSaved('Saving…');
    return api({ action: 'save_validation_progress', id: v.bill.id, bill_type: v.btype || null, shipment_direction: v.dir || null,
      draft: { checks: v.checks || {}, notes: v.notes || '', price_resolution: v.price_resolution || '', warehouse_reference: v.warehouse_reference || '' } }).then(function (j) {
      if (j && j.ok) { var d = new Date(); setVSaved('✓ Saved ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + (j.warning ? ' — ' + j.warning : '')); }
      else { setVSaved('⛔ Not saved: ' + ((j && j.error) || 'error')); }
      return j;
    });
  }
  // patch the panel; typing waits ~0.7 s, a click (type, direction, a check box) saves at once
  function setV(patch, now) {
    var n = Object.assign({}, validating, patch, { err: '' });
    setValidating(n); vRef.current = n;
    if (vTimer.current) { clearTimeout(vTimer.current); }
    if (now) { flushV(); } else { vTimer.current = setTimeout(flushV, 700); }
  }
  function closeV() { var had = !!vTimer.current; (had ? flushV() : Promise.resolve()).then(function () { vRef.current = null; setValidating(null); setVSaved(''); load(); }); }
  var s18b = useState('14'); var scanDays = s18b[0]; var setScanDays = s18b[1]; // v55.83-QK — how far back the mailbox scan looks
  var s19v = useState(''); var thruVendor = s19v[0]; var setThruVendor = s19v[1]; // v55.83-QR — '' = all vendors
  var s20p = useState([{ name: 'RTM Capital', kind: 'service_provider' }, { name: 'NextTrade Industries', kind: 'affiliate' }]); var parties = s20p[0]; var setParties = s20p[1]; // v55.83-QY
  var fileInputRef = React.useRef(null);

  function api(payload) {
    return fetch('/api/accounting/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userProfile && userProfile.id }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ') — try again.' }; }); }) // v55.83-RO
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }
  function load() {
    setBusy(true);
    api({ action: 'list' }).then(function (j) {
      if (j && j.ok) { setData(j); setLoadErr(''); } else { setLoadErr((j && j.error) || 'Could not load bills.'); toast.error((j && j.error) || 'Could not load bills.'); }
    }).finally(function () { setBusy(false); });
  }
  useEffect(function () { if (canView) { load(); loadCats(); api({ action: 'paid_through_parties' }).then(function (jp) { if (jp && jp.ok && (jp.parties || []).length) { setParties(jp.parties); } }).catch(function () {}); } }, []); // eslint-disable-line
  function loadCats() {
    // v55.83-PJ (Max): "categories for bills should be a dropdown to select
    // with an ability to add a category". Shared list with expenses. Fail-soft:
    // if the PI SQL hasn't run, the old free-text box keeps working.
    supabase.from('expense_categories').select('key, label, active, sort').eq('active', true).order('sort')
      .then(function (r) { if (!r.error && r.data && r.data.length) { setCats(r.data); } })
      .catch(function () {});
  }
  function addCatB() {
    var label = newCatB.trim();
    if (label.length < 2) { return; }
    setBusy(true);
    fetch('/api/accounting/expense-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_category', payload: { label: label }, user_id: userProfile && userProfile.id }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) {
          toast.success('Category "' + label + '" added.'); setNewCatB(''); setAddingCat(false); loadCats();
          if (j.category && j.category.key) { setEditing(function (ed) { return ed ? Object.assign({}, ed, { category: j.category.key }) : ed; }); }
        } else { toast.error((j && j.error) || 'Could not add the category.'); }
      }).finally(function () { setBusy(false); });
  }

  // settled OUT bank transactions of the US business, newest first, for the pay picker
  function loadOutTxns() {
    supabase.from('bank_transactions')
      .select('id, date, posted_date, amount_abs, name, merchant_name, pending, direction, wave_business_id')
      .eq('wave_business_id', US_WAVE_BUSINESS_ID).eq('direction', 'out')
      .order('date', { ascending: false }).limit(200)
      .then(function (r) { setOutTxns((r.data || []).filter(function (t) { return t.pending !== true; })); });
  }

  // v55.83-PC — import a bill: the AI reads it, the form gets pre-filled,
  // MAX confirms. Unreadable fields stay blank — never guessed.
  // v55.83-QG (Max 12:19: "can we import multiple documents at the same
  // time... check for duplicates or previously paid.. still have a human
  // validation column"). ONE file keeps the check-every-field editor flow;
  // SEVERAL files run the queue: each becomes a PENDING-VALIDATION bill
  // (document attached, vendor memory fills the category, exact duplicates
  // skipped and said, same-amount look-alikes created with a loud ⚠ naming
  // the suspect and whether it is already PAID). Humans validate, always.
  // v55.83-QJ (Max 12:42/12:47: "baby steps to set up email... ktcus.com
  // lives on hostinger") — a Scan-now button so the mailbox setup can be
  // TESTED immediately instead of waiting for the hourly run.
  // v55.83-QL (Max 13:19): 🩺 investigates layer by layer — settings,
  // sign-in, inbox, keywords, what the scanner actually SEES — so "is it
  // working?" always gets a named answer.
  function diagnoseMailbox() {
    setReading(true); setImportNotes(['🩺 Testing the mailbox connection, step by step…']);
    fetch('/api/accounting/bills/email-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userProfile && userProfile.id, diagnose: true, days: Number(scanDays) }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.diagnose) { setImportNotes(j.steps || []); toast[j.working ? 'success' : 'error'](j.working ? 'Connection WORKS — see the step-by-step report.' : 'Found the problem — see the step-by-step report.'); }
        else { setImportNotes([(j && j.error) || 'Test failed.']); toast.error((j && j.error) || 'Test failed.'); }
      })
      .catch(function (e3) { toast.error((e3 && e3.message) || 'Test failed.'); })
      .finally(function () { setReading(false); });
  }
  function scanMailbox() {
    setReading(true); setImportNotes(['📧 Scanning the bills mailbox (last ' + scanDays + ' days)…']);
    fetch('/api/accounting/bills/email-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userProfile && userProfile.id, days: Number(scanDays) }) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          var lines = ['📧 ' + j.mailbox + ' — keywords: ' + (j.keywords || []).join(', '),
            '— ' + j.matched_messages + ' matching email(s) in the last ' + (j.days || scanDays) + ' days · ' + j.new_messages_processed + ' new · ' + j.bills_created + ' bill(s) created as PENDING VALIDATION'];
          (j.bills || []).forEach(function (b0) { lines.push('✅ ' + (b0.vendor || '(unread vendor)') + (b0.amount ? ' — $' + Number(b0.amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '') + (b0.warned ? ' · ⚠ possible duplicate — check the note' : '') + (b0.price_check === 'flagged' ? ' · ⚠ PRICE CHECK FLAGGED' : '')); (b0.price_flags || []).forEach(function (ft) { lines.push('      ⚠ ' + ft); }); });
          (j.skipped || []).forEach(function (s0) { lines.push('⏭ ' + s0.file + ' — ' + s0.reason); });
          if (Number(j.remaining_new) > 0) { lines.push('⏳ ' + j.remaining_new + ' more matching email(s) not yet read — click 📧 Scan again to continue (it reads up to 8 new emails per pass, so a 3-month backlog takes a few clicks; the hourly auto-run keeps chipping away too).'); }
          setImportNotes(lines);
          toast.success(j.bills_created + ' bill(s) from the mailbox — the scanner runs hourly on its own.');
          if (j.bills_created > 0) { load(); }
        } else {
          setImportNotes([(j && j.error) || 'Scan failed.']);
          toast.error((j && j.error) || 'Scan failed.');
        }
      })
      .catch(function (e2) { toast.error((e2 && e2.message) || 'Scan failed.'); })
      .finally(function () { setReading(false); });
  }
  function onPickFiles(e) {
    var list = Array.prototype.slice.call((e.target.files || []), 0, 20);
    e.target.value = '';
    if (!list.length) { return; }
    var badT = list.filter(function (f9) { return ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].indexOf(f9.type) < 0; });
    if (badT.length === list.length) { toast.error('Those files are not photos or PDFs (' + badT.map(function (f8) { return f8.name + ': ' + (f8.type || 'unknown type'); }).join(', ') + ').'); setImportNotes(['✗ Not a JPG/PNG/PDF: ' + badT.map(function (f7) { return f7.name; }).join(', ')]); return; }
    if (list.length === 1) { onPickFile(list[0]); return; }
    var okT = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1 };
    var good = list.filter(function (f0) { return okT[f0.type] && f0.size <= 10 * 1024 * 1024; });
    if (!good.length) { toast.error('Use JPG/PNG photos or PDFs under 10 MB.'); return; }
    setReading(true); setImportNotes(['⏳ Importing ' + good.length + ' document(s)…']);
    var notesQ = []; var madeQ = 0;
    var chainQ = Promise.resolve(true);
    good.forEach(function (f1, qi) {
      chainQ = chainQ.then(function () {
        return new Promise(function (res) {
          var rq = new FileReader();
          rq.onload = function () {
            var b64q = String(rq.result).split(',')[1] || '';
            api({ action: 'ingest_bill_file', filename: f1.name, media_type: f1.type, file_base64: b64q }).then(function (jq) {
              if (jq && jq.created) {
                madeQ++;
                notesQ.push('✅ ' + (jq.vendor || f1.name) + (jq.amount ? ' — $' + Number(jq.amount).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '') + ' → PENDING VALIDATION' + (jq.duplicate_warning ? ' · ' + jq.duplicate_warning : '') + ((jq.reader_flags || []).length ? ' · reader flags: ' + jq.reader_flags.length : '') + (jq.lines_read ? ' · ' + jq.lines_read + ' line(s) read' : ' · no lines read') +
                  (jq.price_check === 'flagged' ? ' · ⚠ PRICE CHECK FLAGGED' : jq.price_check === 'ok' ? ' · ✅ prices match the rules' : jq.price_check === 'no_rules' ? ' · no price rule applies yet' : ''));
                (jq.price_flags || []).forEach(function (ft) { notesQ.push('      ⚠ ' + ft); });
              } else if (jq && jq.skipped) {
                notesQ.push('⏭ ' + f1.name + ' — skipped: ' + (jq.reason || '')); 
              } else {
                notesQ.push('✗ ' + f1.name + ' — ' + ((jq && jq.error) || 'failed'));
              }
              setImportNotes(['⏳ ' + (qi + 1) + ' of ' + good.length + ' processed…'].concat(notesQ));
              res(true);
            }).catch(function () { notesQ.push('✗ ' + f1.name + ' — network error'); res(true); });
          };
          rq.readAsDataURL(f1);
        });
      });
    });
    chainQ.then(function () {
      setImportNotes(notesQ.concat(['— ' + madeQ + ' bill(s) created as PENDING VALIDATION. Open each, run the three checks, and validate.']));
      toast.success(madeQ + ' of ' + good.length + ' document(s) imported — every one awaits YOUR validation.');
      load();
    }).finally(function () { setReading(false); });
  }
  function onPickFile(f) {
    if (!f) { return; }
    var okTypes = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'application/pdf': 1 };
    if (!okTypes[f.type]) { toast.error('Use a JPG/PNG photo or a PDF.'); return; }
    if (f.size > 10 * 1024 * 1024) { toast.error('Keep the file under 10 MB.'); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var b64 = String(rd.result).split(',')[1] || '';
      setReading(true); setImportNotes(['📄 Reading "' + f.name + '" (' + Math.round(f.size / 1024) + ' KB) — the AI is extracting vendor, number, dates and amount…']);
      var guard = new Promise(function (res, rej) { setTimeout(function () { rej(new Error('no answer after 75 seconds')); }, 75000); });
      Promise.race([api({ action: 'extract_bill', file_base64: b64, media_type: f.type }), guard]).then(function (j) {
        if (j && j.ok && j.draft) {
          setImportFile({ file: f, base64: b64, media_type: f.type });
          var notes2 = (j.problems || []).slice();
          if (!j.draft.category && j.suggested_category) { notes2.push('🧠 Category pre-filled from what you picked for this vendor before — change it if wrong.'); }
          var srt = j.sorted || {};
          notes2.push(srt.bill_type ? 'Type: ' + BILL_TYPE_LABEL[srt.bill_type] + ' (' + SRC_WORDS[srt.bill_type_source] + ').' : 'Type: could not tell from the bill — left blank, it is picked at validation.');
          notes2.push(srt.shipment_direction ? 'Direction: Outbound ➡ (release ' + srt.release_number + ' is on the bill).' : 'Direction: no release # on the bill — left blank, it is marked at validation.');
          setImportNotes(notes2);
          setEditing({
            vendor_name: j.draft.vendor_name || '', bill_number: j.draft.bill_number || '',
            bill_date: j.draft.bill_date || TODAY, due_date: j.draft.due_date || '',
            total_amount: j.draft.total_amount || '', category: j.draft.category || j.suggested_category || '',
            notes: j.draft.notes || '', _imported: true,
            // v55.83-RP — type + release + reference + direction from the import (blank when the bill does not make it clear)
            bill_type: (j.sorted && j.sorted.bill_type) || '', bill_type_source: (j.sorted && j.sorted.bill_type_source) || null,
            release_number: (j.sorted && j.sorted.release_number) || '', other_reference: (j.sorted && j.sorted.other_reference) || '',
            shipment_direction: (j.sorted && j.sorted.shipment_direction) || null, direction_source: (j.sorted && j.sorted.direction_source) || null,
            lines: Array.isArray(j.draft.lines) ? j.draft.lines : [], // v55.83-RQ — saved with the bill; the price check runs then
          });
          setPricePreview(j.price_preview || null);
          if (j.price_preview && j.price_preview.status === 'flagged') { toast.error('⚠ The price check found ' + j.price_preview.flags.length + ' problem(s) on this bill — see the red box.'); }
          else { toast.success('Bill read — check every field, then Save.'); }
          setTimeout(function () { try { var ed = document.getElementById('nt-bill-editor'); if (ed) { ed.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } catch (eS) {} }, 60);
        } else { toast.error((j && j.error) || 'Could not read the bill — enter it manually.'); setImportNotes(['✗ ' + ((j && j.error) || 'Could not read the bill — enter it manually.')]); }
      }).catch(function (eR9) { // v55.83-QO — a killed/timed-out request is SAID, never silent
        toast.error('The reader took too long or the connection dropped (' + ((eR9 && eR9.message) || 'network') + ') — try again. If it keeps happening, send just the invoice page (page 1) instead of the merged PDF.');
        setImportNotes(['✗ Read failed — the request timed out or dropped. Try again (the fix in this build raises the server time limit), or import just page 1.']);
      }).finally(function () { setReading(false); });
    };
    rd.readAsDataURL(f);
  }

  if (!canView) {
    return <div className="nt-paper rounded-xl border border-slate-200 p-4 text-sm" style={{ background: '#ffffff', color: '#334155' }}>
      Bills need the <b>Bills: View</b> permission — ask an admin to grant it in Settings → 🏦 Banking & Accounting Access.</div>;
  }

  var catLabelOf = {}; (cats || []).forEach(function (c) { catLabelOf[c.key] = c.label; }); // v55.83-PJ
  var bills = (data && data.bills) || [];
  var payments = (data && data.payments) || [];
  var totals = (data && data.totals) || { open: 0, overdue: 0, open_count: 0 };
  var shown = bills.filter(function (b) {
    if (filter === 'open') { return b.record_status === 'active' && b.disputed !== true && b.open > 0.005; }
    if (filter === 'paid') { return b.record_status === 'active' && b.open <= 0.005; }
    if (filter === 'disputed') { return b.disputed === true && b.record_status === 'active'; }
    if (filter === 'void') { return b.record_status === 'void'; }
    return true;
  }).filter(function (b) {
    if (typeF && (typeF === 'none' ? !!b.bill_type : b.bill_type !== typeF)) { return false; }
    if (dirF && (dirF === 'none' ? !!b.shipment_direction : b.shipment_direction !== dirF)) { return false; }
    if (priceF && (b.price_check_status || 'not_checked') !== priceF) { return false; }
    return true;
  });
  var TYPE_ORDER = { trucking: 1, shipping: 2, bonded_brokerage: 3, supplier: 4 };
  if (sortBy !== 'due') {
    shown = shown.slice().sort(function (a, b) {
      var k = sortBy === 'type' ? (TYPE_ORDER[a.bill_type] || 9) - (TYPE_ORDER[b.bill_type] || 9)
        : sortBy === 'direction' ? String(a.shipment_direction || 'z').localeCompare(String(b.shipment_direction || 'z'))
        : sortBy === 'vendor' ? String(a.vendor_name || '').localeCompare(String(b.vendor_name || ''))
        : sortBy === 'newest' ? String(b.bill_date || '').localeCompare(String(a.bill_date || ''))
        : sortBy === 'amount' ? (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0) : 0;
      return k || String(a.due_date || '').localeCompare(String(b.due_date || ''));
    });
  }
  function paysOf(id) { return payments.filter(function (p) { return p.bill_id === id; }); }
  // v55.83-RZ (Max 00:17: "it goes from OPEN to READY ... and then ... the status of the bills become PAID") — a bill on a wire shows
  // where the wire is: OPEN (being signed) → READY (both signatures) → SENT (waiting for the bank line) → PAID (matched)
  function wireChip(b) {
    if (!b.wire_state || (b.status !== 'OPEN' && b.status !== 'PARTIAL')) { return null; }
    var w = b.wire_state; var c = w.state === 'ready' ? ['#dbeafe', '#1e3a8a'] : w.state === 'sent' ? ['#e0e7ff', '#3730a3'] : ['#f1f5f9', '#334155'];
    return <div className="mt-0.5"><span className="px-2 py-0.5 rounded text-[10px] font-extrabold" title={b.wire_state_words || ''} style={{ background: c[0], color: c[1] }}>{w.label + ' · ' + w.wire}</span>
      <div className="text-[10px] font-bold" style={{ color: '#475569', maxWidth: 220 }}>{w.state === 'ready' ? 'approved → ' + (w.payee || '?') : w.state === 'sent' ? 'sent' + (w.sent_date ? ' ' + w.sent_date : '') + ' — waiting for the bank line' : 'on a pre-wire (can still change)'}{w.amount < (Number(b.open) || 0) - 0.005 ? ' · part: $' + fmt(w.amount) + ' of $' + fmt(b.open) : ''}</div></div>;
  }
  function chip(st) {
    var map = { OPEN: ['#fee2e2', '#7f1d1d'], PARTIAL: ['#ffedd5', '#431407'], PAID: ['#d1fae5', '#065f46'], VOID: ['#e2e8f0', '#334155'], DISPUTED: ['#ede9fe', '#5b21b6'] };
    var c = map[st] || map.VOID;
    return <span className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: c[0], color: c[1] }}>{st}</span>;
  }
  function valChip(b) {
    if (b.validation_status === 'validated') {
      return <span><span className="px-2 py-0.5 rounded text-[10px] font-extrabold" title={'Validated ' + (b.validated_at ? String(b.validated_at).substring(0, 10) : '') + (b.validation_notes ? ' — ' + b.validation_notes : '')} style={{ background: '#d1fae5', color: '#065f46' }}>✓ VALIDATED</span>{canManage && b.record_status === 'active' && <button onClick={function () { closePanels(); setRowAsk({ kind: 'reopen', bill: b, text: '' }); }} title="Reopen the validation to fix this bill (it must be validated again before it can be wired)" className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>↩ Reopen</button>}</span>;
    }
    return <button onClick={function () { if (canManage) { closePanels(); var dr = b.validation_draft || {}; var v0 = { bill: b, checks: dr.checks || {}, notes: dr.notes || '', price_resolution: dr.price_resolution || '', warehouse_reference: dr.warehouse_reference || '', dir: (b.shipment_direction === 'inbound' || b.shipment_direction === 'outbound') ? b.shipment_direction : (b.default_direction || ''), dirDefault: !b.shipment_direction && !!b.default_direction, btype: BILL_TYPE_LABEL[b.bill_type] ? b.bill_type : '' }; vRef.current = v0; setVSaved(dr.at ? 'Picked up where ' + (dr.by_name || 'someone') + ' left off (' + String(dr.at).substring(0, 16).replace('T', ' ') + ')' : ''); setValidating(v0); } }}
      className="px-2 py-0.5 rounded text-[10px] font-extrabold" title="Click to run the validation checks"
      style={{ background: '#ffedd5', color: '#431407', border: '1px dashed #fdba74' }}>{b.validation_draft && b.validation_draft.at ? 'PENDING · started' : 'PENDING'}</button>;
  }
  function openDoc(path) {
    var priv = String(path).indexOf('pv/') === 0;
    var bucket = priv ? 'bills-private' : 'attachments';
    // v55.83-RV (review #10) — the tab is opened INSIDE the click (a pop-up blocker allows that), then pointed at the private link
    var w = null; try { w = window.open('', '_blank'); if (w) { w.document.title = 'Opening the bill…'; } } catch (eW) { w = null; }
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(function (r) {
      var u = r && r.data && r.data.signedUrl;
      if (!u && !priv) { u = (supabase.storage.from('attachments').getPublicUrl(path).data || {}).publicUrl; }
      if (u) { if (w) { w.location.href = u; } else { window.location.assign(u); } } else { if (w) { w.close(); } toast.error('Could not open the file.'); }
    });
  }

  function saveBill() {
    var d = Object.assign({}, editing || {});
    setBusy(true);
    var pre = Promise.resolve(null);
    if (importFile && d._imported) {
      var safeName = String(importFile.file.name || 'bill').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
      var storagePath = 'pv/' + Date.now() + '-' + safeName; // v55.83-PE: private bucket — financial documents are not public files
      pre = supabase.storage.from('bills-private').upload(storagePath, importFile.file, { upsert: false })
        .then(function (r) { return r && r.error ? null : storagePath; })
        .catch(function () { return null; });
    }
    pre.then(function (att) {
      if (att) { d.attachment_path = att; }
      return api({ action: 'save_bill', bill: d });
    }).then(function (j) {
      if (j && j.ok) {
        if (j.price_check && j.price_check.status === 'flagged') { toast.error('Bill saved — ⚠ PRICE CHECK FLAGGED: ' + j.price_check.flags[0].text + (j.price_check.flags.length > 1 ? ' (+' + (j.price_check.flags.length - 1) + ' more — open the bill)' : '')); }
        else { toast.success('Bill saved.' + (j.price_check && j.price_check.status === 'ok' ? ' ✅ Prices match the rules.' : '') + (j.warning ? ' ⚠ ' + j.warning : '')); }
        setEditing(null); setImportFile(null); setImportNotes([]); setPricePreview(null); load();
      } else { toast.error((j && j.error) || 'Save failed.'); }
    }).finally(function () { setBusy(false); });
  }
  function savePayment() {
    var p = paying || {};
    setBusy(true);
    api({ action: 'record_payment', bill_id: p.bill.id, amount: p.amount, paid_date: p.paid_date || TODAY, bank_transaction_id: p.bank_transaction_id || null, method: p.method || '' })
      .then(function (j) {
        if (j && j.ok) { toast.success('Payment recorded.'); setPaying(null); load(); }
        else { toast.error((j && j.error) || 'Payment failed.'); }
      }).finally(function () { setBusy(false); });
  }

  var inp = 'px-2 py-1 rounded-lg border border-slate-300 text-xs text-slate-900 bg-white nt-light';
  return <div className="nt-paper rounded-xl border border-slate-200 p-3" style={{ background: '#ffffff', color: '#0f172a' }}>
    {loadErr && <div className="rounded-lg px-3 py-2 mb-2 text-[13px] font-extrabold flex gap-2 items-center flex-wrap" style={{ background: '#fef2f2', color: '#991b1b', border: '2px solid #fca5a5' }}>
      <span>{'⛔ The bills did not load: ' + loadErr}</span>
      <button onClick={load} className="px-2 py-1 rounded text-[12px] font-extrabold" style={{ background: '#991b1b', color: '#ffffff' }}>Try again</button></div>}
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <div className="text-sm font-extrabold text-slate-900 mr-1">💸 Bills — what we owe</div>
      <span className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>Open: ${fmt(totals.open)} ({totals.open_count})</span>
      {totals.overdue > 0 && <span className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ background: '#ffedd5', color: '#431407' }}>Overdue: ${fmt(totals.overdue)}</span>}
      <div className="flex-1" />
      {['open', 'paid', 'disputed', 'void', 'all'].map(function (f) {
        return <button key={f} onClick={function () { setFilter(f); }} className="px-2 py-1 rounded-lg text-[10px] font-extrabold"
          style={filter === f ? { background: '#1e293b', color: '#ffffff' } : { background: '#f1f5f9', color: '#334155' }}>{f.toUpperCase()}</button>;
      })}
      <button onClick={function () { setPanel(panel === 'rules' ? null : 'rules'); }} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={panel === 'rules' ? { background: '#312e81', color: '#ffffff' } : { background: '#eef2ff', color: '#312e81', border: '1px solid #c7d2fe' }}>📏 Price rules</button>
      <button onClick={function () { setPanel(panel === 'reports' ? null : 'reports'); }} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={panel === 'reports' ? { background: '#14532d', color: '#ffffff' } : { background: '#f0fdf4', color: '#14532d', border: '1px solid #86efac' }}>📊 Reports</button>
      {canManage && <button onClick={function () { if (fileInputRef.current) { fileInputRef.current.click(); } }} disabled={busy || reading}
        className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#7c3aed', color: '#ffffff' }}>{reading ? 'Reading…' : '📷 Import bill(s)'}</button>}
      {canManage && <select value={scanDays} onChange={function (e) { setScanDays(e.target.value); }} title="How far back the mailbox scan looks" className="px-1.5 py-1 rounded-lg border border-slate-300 text-[10px] nt-light">
        <option value="14">last 2 weeks</option><option value="30">last month</option><option value="60">last 2 months</option><option value="90">last 3 months</option><option value="120">last 4 months</option>
      </select>}
      {canManage && <button onClick={scanMailbox} disabled={reading || busy} title="Check the bills mailbox NOW (it also runs every hour by itself): searches for your keywords, reads attached bills, enters them as pending validation with the duplicate radar."
        className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#0e7490', color: '#ffffff', opacity: (reading || busy) ? 0.5 : 1 }}>📧 Scan mailbox now</button>}
      {canManage && <button onClick={diagnoseMailbox} disabled={reading || busy} title="Investigate the email setup layer by layer: settings present → sign-in → inbox → keyword matches → what the scanner actually sees. Names the exact problem when something is off."
        className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#475569', color: '#ffffff', opacity: (reading || busy) ? 0.5 : 1 }}>🩺 Test connection</button>}
      <input ref={fileInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" style={{ display: 'none' }} onChange={onPickFiles} />
      {canManage && <button onClick={function () { setEditing({ bill_date: TODAY }); }} disabled={busy}
        className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1d4ed8', color: '#ffffff' }}>+ Add bill</button>}
      <button onClick={load} disabled={busy} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>↻</button>
    </div>
    {/* v55.83-RQ — filter + sort by type and direction (and the Hub's price check) */}
    <div className="flex gap-2 items-center flex-wrap mb-2">
      <span className="text-[10px] font-bold" style={{ color: '#475569' }}>Show:</span>
      <select className={inp} value={typeF} onChange={function (e) { setTypeF(e.target.value); }} title="Type of bill">
        <option value="">every type</option>{BILL_TYPES.map(function (t) { return <option key={t} value={t}>{BILL_TYPE_LABEL[t]}</option>; })}<option value="none">❔ type not set</option></select>
      <select className={inp} value={dirF} onChange={function (e) { setDirF(e.target.value); }} title="Inbound / outbound">
        <option value="">inbound + outbound</option><option value="inbound">⬅ Inbound</option><option value="outbound">Outbound ➡</option><option value="none">❔ direction not set</option></select>
      <select className={inp} value={priceF} onChange={function (e) { setPriceF(e.target.value); }} title="Hub price check">
        <option value="">any price check</option><option value="flagged">⚠ price flagged</option><option value="ok">✅ prices OK</option><option value="no_rules">— no rule</option><option value="not_checked">not checked</option></select>
      <span className="text-[10px] font-bold ml-2" style={{ color: '#475569' }}>Sort:</span>
      <select className={inp} value={sortBy} onChange={function (e) { setSortBy(e.target.value); }}>
        <option value="due">due date</option><option value="type">type of bill</option><option value="direction">inbound / outbound</option><option value="vendor">vendor</option><option value="newest">newest bill date</option><option value="amount">largest amount</option></select>
      {(typeF || dirF || priceF || sortBy !== 'due') && <button onClick={function () { setTypeF(''); setDirF(''); setPriceF(''); setSortBy('due'); }} className="text-[10px] underline font-bold" style={{ color: '#1d4ed8' }}>clear</button>}
      <span className="text-[10px]" style={{ color: '#64748b' }}>{shown.length + ' bill(s)'}</span>
    </div>
    {panel === 'rules' && <PriceRulesPanel api={api} toast={toast} onClose={function () { setPanel(null); }} onChanged={load} />}
    {/* v55.83-SJ — what we owe by age + bills on the books before they are paid */}
    {panel === 'reports' && <PayablesPanel bills={(data && data.bills) || []} userId={userProfile && userProfile.id} />}
    {panel === 'reports' && <BillReportsPanel api={api} onClose={function () { setPanel(null); }} />}

    {/* v55.83-QS (Max, Nov 8 01:02: "the import bills is not working... nothing
        happens") — status lines (reading, multi-import results, mailbox scan,
        🩺 diagnostics) used to render ONLY inside an open bill editor, so most
        of them were never visible. Now they always show here. */}
    {(reading || (importNotes.length > 0 && !(editing && editing._imported))) && <div className="rounded-xl p-3 mb-3" style={{ background: '#f0f9ff', border: '1px solid #7dd3fc' }}>
      <div className="flex gap-2 items-center mb-1">
        <span className="text-xs font-extrabold" style={{ color: '#0c4a6e' }}>{reading ? '⏳ Working… (reading a document can take up to a minute — keep this tab open)' : '📋 Result'}</span>
        <div className="flex-1" />
        {!reading && <button onClick={function () { setImportNotes([]); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#e0f2fe', color: '#0c4a6e' }}>✕ clear</button>}
      </div>
      {importNotes.map(function (ln, li) { return <div key={li} className="text-[11px] py-0.5" style={{ color: '#0f172a', whiteSpace: 'pre-wrap' }}>{ln}</div>; })}
    </div>}

    {/* v55.83-PE — "If I ask how much we owe through <date>, I should immediately
        receive a complete and accurate list, by vendor, with the total." */}
    <div className="rounded-xl p-3 mb-3" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs font-extrabold" style={{ color: '#0f172a' }}>What do we owe</span>
        {/* v55.83-QR (Max): one vendor, or all — up to a chosen date */}
        <select value={thruVendor} onChange={function (e) { setThruVendor(e.target.value); setDueThru(null); }} className={inp} style={{ maxWidth: 240 }} title="Pick a vendor, or leave on All vendors">
          <option value="">— all vendors —</option>
          {(function () { var seen = {}; var list = []; bills.forEach(function (b0) { var v0 = String(b0.vendor_name || '').trim(); if (v0 && b0.record_status === 'active' && !seen[v0.toLowerCase()]) { seen[v0.toLowerCase()] = true; list.push(v0); } }); return list.sort(function (a, b) { return a.localeCompare(b); }).map(function (v1) { return <option key={v1} value={v1}>{v1}</option>; }); })()}
        </select>
        <span className="text-xs font-extrabold" style={{ color: '#0f172a' }}>through</span>
        <input type="date" className={inp} value={thruDate} onChange={function (e) { setThruDate(e.target.value); }} />
        <button onClick={function () { if (!thruDate) { toast.error('Pick a date.'); return; } setBusy(true); api({ action: 'due_through', through: thruDate, vendor: thruVendor || undefined }).then(function (j) { if (j && j.ok) { setDueThru(j); } else { toast.error((j && j.error) || 'Failed.'); } }).finally(function () { setBusy(false); }); }}
          disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>Answer</button>
        {dueThru && <button onClick={function () {
          var L2 = ['vendor,bill_number,due_date,open_balance,validation'];
          (dueThru.bills || []).forEach(function (b2) { L2.push(['"' + String(b2.vendor).replace(/"/g, '""') + '"', '"' + String(b2.bill_number || '').replace(/"/g, '""') + '"', b2.due_date, b2.open.toFixed(2), b2.validation].join(',')); });
          L2.push(''); L2.push('TOTAL OWED through ' + dueThru.through + ',,,' + dueThru.total_owed.toFixed(2) + ',');
          var blob = new Blob([L2.join('\n')], { type: 'text/csv' }); var a2 = document.createElement('a');
          a2.href = URL.createObjectURL(blob); a2.download = 'bills-due' + (dueThru.vendor ? '-' + String(dueThru.vendor).replace(/[^a-zA-Z0-9]+/g, '_').substring(0, 30) : '') + '-through-' + dueThru.through + '.csv'; a2.click();
        }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>⬇ CSV</button>}
      </div>
      {dueThru && <div className="mt-2">
        <div className="flex gap-2 flex-wrap text-[11px] font-extrabold">
          <span className="px-2 py-1 rounded-lg" style={{ background: '#fee2e2', color: '#7f1d1d' }}>{dueThru.vendor ? dueThru.vendor + ' — ' : ''}TOTAL through {dueThru.through}: ${fmt(dueThru.total_owed)} ({dueThru.bill_count} bills)</span>
          <span className="px-2 py-1 rounded-lg" style={{ background: '#ffedd5', color: '#431407' }}>already overdue: ${fmt(dueThru.overdue_now)}</span>
          <span className="px-2 py-1 rounded-lg" style={{ background: '#e0f2fe', color: '#0c4a6e' }}>coming due by {dueThru.through}: ${fmt(dueThru.not_yet_due)}</span>
          <span className="px-2 py-1 rounded-lg" style={{ background: '#d1fae5', color: '#065f46' }}>validated: ${fmt(dueThru.validated_open)}</span>
          <span className="px-2 py-1 rounded-lg" style={{ background: '#ffedd5', color: '#431407' }}>pending validation: ${fmt(dueThru.pending_validation_open)}</span>
          {(dueThru.disputed_excluded || []).length > 0 && <span className="px-2 py-1 rounded-lg" style={{ background: '#ede9fe', color: '#5b21b6' }}>{dueThru.disputed_excluded.length} disputed bill(s) EXCLUDED from the total</span>}
        </div>
        {!dueThru.vendor && <div className="text-[11px] mt-1" style={{ color: '#334155' }}>
          <b>By vendor:</b> {(dueThru.by_vendor || []).map(function (v) { return v.vendor + ' $' + fmt(v.open) + ' (' + v.count + ')'; }).join(' · ') || 'nothing due'}
        </div>}
        {/* v55.83-QR — the bills behind the number, one line each */}
        {(dueThru.bills || []).length > 0 && <table className="w-full text-[11px] mt-2">
          <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
            {(dueThru.vendor ? [] : ['Vendor']).concat(['Bill #', 'Bill date', 'Due', 'Total', 'Paid', 'Owed', 'Validation']).map(function (h) { return <th key={h} className={'py-1 pr-2 font-semibold ' + (['Total', 'Paid', 'Owed'].indexOf(h) >= 0 ? 'text-right' : 'text-left')}>{h}</th>; })}
          </tr></thead>
          <tbody style={{ color: '#0f172a' }}>
            {dueThru.bills.map(function (b3) {
              var late3 = String(b3.due_date) < TODAY;
              return <tr key={b3.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                {!dueThru.vendor && <td className="py-1 pr-2 font-semibold">{b3.vendor}</td>}
                <td className="py-1 pr-2">{b3.bill_number || '—'}</td>
                <td className="py-1 pr-2">{b3.bill_date || '—'}</td>
                <td className="py-1 pr-2" style={{ color: late3 ? '#9a3412' : '#0f172a', fontWeight: late3 ? 700 : 400 }}>{b3.due_date}{late3 ? ' ⚠ overdue' : ''}</td>
                <td className="py-1 pr-2 text-right tabular-nums">${fmt(b3.total)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">${fmt(b3.paid)}</td>
                <td className="py-1 pr-2 text-right tabular-nums font-extrabold">${fmt(b3.open)}</td>
                <td className="py-1 pr-2">{b3.validation === 'validated' ? '✅ validated' : '⏳ pending'}</td>
              </tr>;
            })}
          </tbody>
        </table>}
        {(dueThru.bills || []).length === 0 && <div className="text-[11px] mt-1" style={{ color: '#065f46' }}>Nothing owed{dueThru.vendor ? ' to ' + dueThru.vendor : ''} through {dueThru.through}.</div>}
      </div>}
    </div>



    {editing && !editing.id && <div id="nt-bill-editor" className="rounded-xl p-3 mb-3" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
      <div className="text-xs font-extrabold mb-2" style={{ color: '#1e3a8a' }}>{editing.id ? 'Edit bill' : (editing._imported ? '📷 Imported bill — CHECK every field before saving' : 'New bill')}</div>
      {editing._imported && importNotes.length > 0 && <div className="text-[11px] rounded-lg p-2 mb-2" style={{ background: '#ffedd5', color: '#431407', border: '1px solid #fdba74' }}>{importNotes.join(' ')}</div>}
      {editing._imported && pricePreview && <PriceCheckBox check={pricePreview} status={pricePreview.status} onRules={function () { setPanel('rules'); }} />}
      {editing._imported && Array.isArray(editing.lines) && editing.lines.length > 0 && <div className="rounded-lg p-2 mb-2" style={{ background: '#ffffff', border: '1px solid #bfdbfe' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#1e3a8a' }}>{'Lines read from the bill (' + editing.lines.length + ') — saved with the bill; open it afterwards to fix any line. The Hub checks the prices on save.'}</div>
        <table className="w-full text-[11px]"><tbody style={{ color: '#0f172a' }}>
          {editing.lines.map(function (l, i) { return <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
            <td className="pr-2" style={{ color: '#64748b' }}>{i + 1}</td><td className="pr-2 font-bold">{l.description}</td><td className="pr-2 text-right">{l.qty != null ? Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' ' + (l.unit || '') : ''}</td>
            <td className="pr-2 text-right">{l.unit_price != null ? '@ $' + l.unit_price : ''}</td><td className="text-right font-bold">{l.amount != null ? '$' + fmt(l.amount) : ''}</td></tr>; })}
          <tr style={{ borderTop: '2px solid #cbd5e1' }}><td /><td className="font-extrabold">Lines total</td><td /><td /><td className="text-right font-extrabold" style={{ color: Math.abs(editing.lines.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0) - Number(editing.total_amount || 0)) > 0.01 ? '#b91c1c' : '#065f46' }}>{'$' + fmt(editing.lines.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0))}</td></tr>
        </tbody></table>
      </div>}
      <div className="flex gap-2 flex-wrap items-center">
        <input className={inp} style={{ width: 200 }} placeholder="Vendor *" value={editing.vendor_name || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { vendor_name: e.target.value })); }} />
        <input className={inp} style={{ width: 120 }} placeholder="Bill # *" value={editing.bill_number || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_number: e.target.value })); }} />
        {/* v55.83-RP — type of bill (optional when saving; required to validate) */}
        <select className={inp} style={{ width: 175 }} value={editing.bill_type || ''} title={editing.bill_type && SRC_WORDS[editing.bill_type_source] ? SRC_WORDS[editing.bill_type_source] : 'Type of bill — required before it can be validated'} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_type: e.target.value, bill_type_source: 'manual' })); }}>
          <option value="">type of bill…</option>
          {BILL_TYPES.map(function (t) { return <option key={t} value={t}>{BILL_TYPE_LABEL[t]}</option>; })}
        </select>
        {/* v55.83-RL (Max, Nov 9 12:20: "check box if outbound or inbound -- if inbound release number not necessary but a reference
            number is necessary. if outbound then release number is necessary and reference number is not") */}
        <span className="flex gap-1 items-center" title="Outbound needs the release #; inbound needs the reference">
          {[['inbound', '⬅ Inbound'], ['outbound', 'Outbound ➡']].map(function (d0) {
            var onD = editing.shipment_direction === d0[0];
            return <button key={d0[0]} type="button" onClick={function () { setEditing(Object.assign({}, editing, { shipment_direction: onD ? null : d0[0], direction_source: 'manual' })); }} className="px-2 py-1 rounded text-[10px] font-extrabold"
              style={onD ? { background: '#1e293b', color: '#ffffff' } : { background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>{d0[1]}</button>;
          })}
        </span>
        <input className={inp} style={{ width: 120, borderColor: editing.shipment_direction === 'outbound' && !editing.release_number ? '#f87171' : undefined }} placeholder={'Release #' + (editing.shipment_direction === 'outbound' ? ' *' : '')} title="The release this bill belongs to — needed for OUTBOUND bills (v55.83-RG/RL)" value={editing.release_number || ''} onChange={function (e) { var rv = e.target.value; setEditing(Object.assign({}, editing, { release_number: rv }, (!editing.shipment_direction && rv.trim().length >= 2) ? { shipment_direction: 'outbound', direction_source: 'release_number' } : {})); }} />
        <input className={inp} style={{ width: 140, borderColor: editing.shipment_direction === 'inbound' && !editing.other_reference ? '#f87171' : undefined }} placeholder={'Reference (BOL / PO…)' + (editing.shipment_direction === 'inbound' ? ' *' : '')} title="Any other reference on the bill besides the bill # and release # — needed for INBOUND bills (v55.83-RL)" value={editing.other_reference || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { other_reference: e.target.value })); }} />
        <input className={inp} type="number" step="0.01" style={{ width: 120 }} placeholder="Amount *" value={editing.total_amount || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { total_amount: e.target.value })); }} />
        <label className="text-[10px] font-bold text-slate-600">Bill date<input className={inp + ' ml-1'} type="date" value={editing.bill_date || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_date: e.target.value })); }} /></label>
        <label className="text-[10px] font-bold text-slate-600">Due<input className={inp + ' ml-1'} type="date" value={editing.due_date || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { due_date: e.target.value })); }} /></label>
        {cats ? <span className="inline-flex items-center gap-1">
          <select className={inp} style={{ width: 170 }} value={editing.category || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { category: e.target.value })); }}>
            <option value="">category…</option>
            {cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
            {editing.category && !cats.some(function (c) { return c.key === editing.category; }) && <option value={editing.category}>{editing.category}</option>}
          </select>
          {!addingCat && <button onClick={function () { setAddingCat(true); }} title="Add a new category" className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>＋</button>}
          {addingCat && <span className="inline-flex items-center gap-1">
            <input className={inp} style={{ width: 130 }} placeholder="new category…" value={newCatB} onChange={function (e) { setNewCatB(e.target.value); }} />
            <button onClick={addCatB} disabled={busy || newCatB.trim().length < 2} className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || newCatB.trim().length < 2) ? 0.5 : 1 }}>add</button>
            <button onClick={function () { setAddingCat(false); setNewCatB(''); }} className="px-1.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕</button>
          </span>}
        </span> :
        <input className={inp} style={{ width: 160 }} placeholder="Category (e.g. Freight)" value={editing.category || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { category: e.target.value })); }} />}
        {/* v55.83-QB/QY (Max): another company pays this bill for us — RTM Capital (outside service) or NextTrade Industries (Texas warehouse) */}
        <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#9d174d' }} title="Another company pays this bill for us (RTM Capital, NextTrade Industries). It is tracked here but stays OUT of what-we-owe totals and cash forecasts. Link it to the payment you send that company: All Transactions → 🔗 on the money-out → 🏢 Payment to a paid-through company.">
          🏢 Paid via
          <select value={editing.paid_via || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { paid_via: e.target.value || null })); }} className="px-1 py-0.5 rounded border border-slate-300 text-[10px] nt-light">
            <option value="">— we pay it directly —</option>
            {parties.map(function (p0) { return <option key={p0.name} value={p0.name}>{p0.name}</option>; })}
          </select></label>
        <input className={inp} style={{ width: 220 }} placeholder="Notes" value={editing.notes || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { notes: e.target.value })); }} />
        <button onClick={saveBill} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Save</button>
        <button onClick={function () { setEditing(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
    </div>}


    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead><tr style={{ borderBottom: '1px solid #cbd5e1', color: '#475569' }}>
          <th className="py-2 pr-2 font-semibold">Vendor</th><th className="py-2 pr-2 font-semibold">Bill #</th>
          <th className="py-2 pr-2 font-semibold">Bill date</th><th className="py-2 pr-2 font-semibold">Due</th>
          <th className="py-2 pr-2 font-semibold text-right">Amount</th><th className="py-2 pr-2 font-semibold text-right">Paid</th>
          <th className="py-2 pr-2 font-semibold text-right">Open</th><th className="py-2 pr-2 font-semibold">Category</th>
          <th className="py-2 pr-2 font-semibold">Status</th><th className="py-2 pr-2 font-semibold">Validation</th><th className="py-2 font-semibold"></th></tr></thead>
        <tbody>
          {shown.map(function (b) {
            var late = b.record_status === 'active' && b.open > 0.005 && b.due_date && b.due_date < TODAY;
            return <React.Fragment key={b.id}>
              <tr style={late ? { background: '#ffedd5', color: '#431407', borderBottom: '1px solid #e2e8f0' } : { background: '#ffffff', color: '#0f172a', borderBottom: '1px solid #e2e8f0' }}>
                <td className="py-1.5 pr-2 font-semibold">{b.vendor_name}{b.paid_via && <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-extrabold" title="Another company pays this — it stays out of what-we-owe and cash forecasts; link it to the payment you send that company (All Transactions → 🔗 → 🏢)" style={{ background: '#fce7f3', color: '#9d174d' }}>🏢 via {b.paid_via}</span>}{b.release_number && <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-extrabold" title="Release this bill belongs to" style={{ background: '#e0e7ff', color: '#312e81' }}>REL {b.release_number}</span>}{b.shipment_direction && <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-extrabold" title={SRC_WORDS[b.direction_source] || ''} style={{ background: '#f1f5f9', color: '#334155' }}>{b.shipment_direction === 'inbound' ? '⬅ IN' : 'OUT ➡'}</span>}{b.bill_type ? <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-extrabold" title={SRC_WORDS[b.bill_type_source] || ''} style={{ background: '#fef3c7', color: '#7c2d12' }}>{BILL_TYPE_LABEL[b.bill_type]}</span> : (b.validation_status !== 'validated' && b.record_status === 'active' ? <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-extrabold" title="Type not known yet — picked at validation" style={{ background: '#fee2e2', color: '#7f1d1d' }}>type?</span> : null)}{b.other_reference && <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-extrabold" title="Other reference" style={{ background: '#ecfeff', color: '#155e75' }}>REF {b.other_reference}</span>}</td>
                <td className="py-1.5 pr-2">{b.bill_number || '—'}</td>
                <td className="py-1.5 pr-2">{b.bill_date}</td>
                <td className="py-1.5 pr-2">{b.due_date || '—'}{late ? ' ⚠' : ''}</td>
                <td className="py-1.5 pr-2 text-right">${fmt(b.total_amount)}</td>
                <td className="py-1.5 pr-2 text-right">${fmt(b.paid)}</td>
                <td className="py-1.5 pr-2 text-right font-extrabold">${fmt(b.open)}</td>
                <td className="py-1.5 pr-2">{b.category ? (catLabelOf[b.category] || b.category) : '—'}</td>
                <td className="py-1.5 pr-2">{b.wire_state && b.status === 'OPEN' && b.wire_state.state !== 'on_wire' ? null : chip(b.status)}{b.attachment_path && <button className="ml-1" title="View the imported bill file (private link, 1 hour)" onClick={function () { openDoc(b.attachment_path); }}>📎</button>}{wireChip(b)}</td>
                <td className="py-1.5 pr-2">{b.record_status === 'active' ? valChip(b) : '—'}{b.price_check_status === 'flagged' ? <div title={((b.price_check && b.price_check.flags) || []).map(function (f) { return f.text; }).join('\n')} className="mt-0.5 text-[9px] font-extrabold" style={{ color: b.price_resolved_note ? '#065f46' : '#b91c1c' }}>{b.price_resolved_note ? '✓ price issue resolved' : '⚠ price check'}</div> : b.price_check_status === 'ok' ? <div className="mt-0.5 text-[9px] font-extrabold" style={{ color: '#065f46' }}>✅ prices OK</div> : null}</td>
                <td className="py-1.5 whitespace-nowrap">
                  <button onClick={function () { setExpanded(expanded === b.id ? null : b.id); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#f1f5f9', color: '#334155' }}>{expanded === b.id ? 'Hide' : 'View'}</button>
                  {canManage && b.record_status === 'active' && b.open > 0.005 && <button onClick={function () { closePanels(); setPaying({ bill: b, amount: b.open, paid_date: TODAY }); loadOutTxns(); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold mr-1" style={{ background: '#047857', color: '#ffffff' }}>Pay</button>}
                  {canManage && b.record_status === 'active' && <button onClick={function () { closePanels(); setEditing(Object.assign({}, b)); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#f1f5f9', color: '#334155' }}>Edit</button>}
                  {/* v55.83-QZ (Max, Nov 8 11:51): duplicate a bill, then edit anything — a NEW pending-validation bill;
                      bill number left blank (never a duplicate), today's date with the same terms, no payments/document/validation copied */}
                  {canManage && <button onClick={function () {
                    var span0 = (b.bill_date && b.due_date) ? Math.round((Date.parse(b.due_date) - Date.parse(b.bill_date)) / 86400000) : null;
                    setEditing({ vendor_name: b.vendor_name, bill_number: '', bill_date: TODAY,
                      due_date: (span0 != null && span0 >= 0) ? new Date(Date.parse(TODAY) + span0 * 86400000).toISOString().substring(0, 10) : '',
                      total_amount: b.total_amount, category: b.category || '', notes: b.notes || '', paid_via: b.paid_via || null, currency: b.currency || 'USD', release_number: b.release_number || '', other_reference: b.other_reference || '', shipment_direction: b.shipment_direction || null, bill_type: b.bill_type || '', bill_type_source: b.bill_type_source || null }); // v55.83-RJ/RL/RP — the release shows when editing (it used to open blank)
                    toast.success('Copy opened as a NEW bill — give it its own bill number, change anything, then Save.');
                    setTimeout(function () { try { var ed2 = document.getElementById('nt-bill-editor'); if (ed2) { ed2.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } catch (eS2) {} }, 60);
                  }} title="Duplicate — opens a NEW bill prefilled from this one; edit anything before saving" className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#ccfbf1', color: '#115e59' }}>⧉ Duplicate</button>}
                  {canManage && b.record_status === 'active' && b.disputed !== true && <button onClick={function () { closePanels(); setDisputing({ bill: b }); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#ede9fe', color: '#5b21b6' }}>Dispute</button>}
                  {canManage && b.disputed === true && <button onClick={function () { closePanels(); setRowAsk({ kind: 'resolve', bill: b, text: '' }); }} className="px-2 py-0.5 rounded text-[10px] font-bold mr-1" style={{ background: '#d1fae5', color: '#065f46' }}>Resolve</button>}
                  {canManage && b.record_status === 'active' && <button onClick={function () { closePanels(); setRowAsk({ kind: 'void_bill', bill: b }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>Void</button>}
                  {canManage && b.record_status !== 'deleted' && <button onClick={function () { closePanels(); setRowAsk({ kind: 'delete', bill: b, text: '' }); }} title="Delete — for a bill that should never have been in the Hub (e.g. imported twice). Its history is kept." className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#7f1d1d', color: '#ffffff' }}>🗑 Delete</button>}
                </td>
              </tr>
              {/* v55.83-RV (Max 22:47: "the validation section should go BELOW the actual bill ... so we are not scrolling all the way up")
                  — validate / pay / dispute / edit / void open right under the bill they are for */}
              {validating && validating.bill.id === b.id && <tr><td colSpan={11} className="py-2 px-1" style={{ background: '#ffffff' }}>
<div className="rounded-xl p-3 mb-3" style={{ background: '#fffbeb', border: '1px solid #f59e0b' }}>
      <div className="text-xs font-extrabold mb-1" style={{ color: '#78350f' }}>Validate: {validating.bill.vendor_name} {validating.bill.bill_number ? '· ' + validating.bill.bill_number : ''} — ${fmt(validating.bill.total_amount)}</div>
      <div className="text-[11px] mb-2" style={{ color: '#92400e' }}>Validation is not a formality. Confirm each check ONLY if you actually performed it — this record is audited, with your name and timestamp on it. Everything you enter is saved as you go; the bill counts as validated only after “✓ Mark validated”.</div>
      {/* v55.83-RP (Max 21:04: "Prior to validation there MUST be a selection of the TYPE of bill and the direction of the bill") */}
      <div className="flex gap-2 items-center mb-1 flex-wrap">
        <span className="text-[12px] font-extrabold" style={{ color: '#431407' }}>Type of bill:</span>
        {BILL_TYPES.map(function (t) { var on = validating.btype === t; return <button key={t} onClick={function () { setV({ btype: t }, true); }} className="px-3 py-1 rounded-lg text-[12px] font-extrabold" style={{ background: on ? '#7c2d12' : '#ffffff', color: on ? '#ffffff' : '#7c2d12', border: '1px solid ' + (on ? '#7c2d12' : (validating.btype ? '#cbd5e1' : '#f87171')) }}>{BILL_TYPE_LABEL[t]}</button>; })}
        <span className="text-[10px]" style={{ color: '#92400e' }}>{'(required' + (validating.bill.bill_type && SRC_WORDS[validating.bill.bill_type_source] ? ' — pre-picked: ' + SRC_WORDS[validating.bill.bill_type_source] + ', confirm or change' : '') + ')'}</span>
      </div>
      {/* v55.83-RO (Max 20:54: "we need to know whether a bill is for inbound or outbound and it should be marked during validation") */}
      <div className="flex gap-2 items-center mb-1 flex-wrap">
        <span className="text-[12px] font-extrabold" style={{ color: '#431407' }}>This bill is for:</span>
        {[['inbound', '⬅ Inbound'], ['outbound', 'Outbound ➡']].map(function (o) { var on = validating.dir === o[0]; return <button key={o[0]} onClick={function () { setV({ dir: o[0] }, true); }} className="px-3 py-1 rounded-lg text-[12px] font-extrabold" style={{ background: on ? '#1d4ed8' : '#ffffff', color: on ? '#ffffff' : '#1e3a8a', border: '1px solid ' + (on ? '#1d4ed8' : (validating.dir ? '#cbd5e1' : '#f87171')) }}>{o[1]}</button>; })}
        <span className="text-[10px]" style={{ color: '#92400e' }}>{'(required' + (validating.dirDefault ? ' — pre-picked: ' + validating.bill.vendor_name + ' bills are always ' + validating.dir + ' — click the other one to change it' : (validating.bill.shipment_direction && SRC_WORDS[validating.bill.direction_source] ? ' — pre-picked: ' + SRC_WORDS[validating.bill.direction_source] : '')) + ' — inbound needs a reference #, outbound a release # before it is wired)'}</span>
      </div>
      {[['matches_records', 'The bill matches our system records (PO/shipment/order)'], ['goods_received', 'The goods or services were actually received'], ['charges_accurate', 'The charges are accurate and legitimate']].map(function (c) {
        return <label key={c[0]} className="flex gap-2 items-center text-[12px] py-0.5" style={{ color: '#431407' }}>
          <input type="checkbox" checked={validating.checks[c[0]] === true} onChange={function (e) { var ch = Object.assign({}, validating.checks); ch[c[0]] = e.target.checked; setV({ checks: ch }, true); }} />{c[1]}</label>;
      })}
      <div className="flex gap-2 items-center mt-2 flex-wrap">
        <input className={inp} style={{ width: 170 }} placeholder="Warehouse ref (optional)" value={validating.warehouse_reference || ''} onChange={function (e) { setV({ warehouse_reference: e.target.value }); }} />
        <button onClick={function () {
          var refv = String(validating.warehouse_reference || '').trim();
          if (refv.length < 2) { toast.error('Type a reference first.'); return; }
          api({ action: 'match_reference', reference: refv }).then(function (j) {
            if (j && j.ok) {
              var hits = (j.warehouse_orders || []).map(function (o) { return 'order ' + o.release_number + ' (' + (o.customer_name || '?') + ', ' + (o.order_date || '?') + ')'; })
                .concat((j.shipments || []).map(function (sh) { return 'shipment ' + sh.shipment_ref + ' (' + (sh.supplier_name || '?') + (sh.received_date ? ', received ' + sh.received_date : ', ' + (sh.status || '')) + ')'; }));
              setValidating(Object.assign({}, validating, { system_match: { reference: refv, found: j.found, hits: hits.slice(0, 5) } }));
              if (j.found) { toast.success('System match: ' + hits[0]); } else { toast.error('No warehouse record matches "' + refv + '".'); }
            } else { toast.error((j && j.error) || 'Lookup failed.'); }
          });
        }} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#0ea5e9', color: '#ffffff' }}>🔎 Check warehouse</button>
        {validating.system_match && <span className="text-[10px] font-bold" style={{ color: validating.system_match.found ? '#065f46' : '#7f1d1d' }}>
          {validating.system_match.found ? '✓ ' + validating.system_match.hits[0] : '✕ no system match'}</span>}
      </div>
      <div className="flex gap-2 items-center mt-2 flex-wrap">
        {/* v55.83-RO (Max, Nov 9 20:49: "after i select all and mark save...it does NOT save") — the HOW note was empty, the
            refusal only flashed as a toast. Now the button says exactly what is missing and any refusal shows right here. */}
        <input className={inp} style={{ width: 380, borderColor: String(validating.notes || '').trim().length < 10 ? '#f87171' : undefined }} placeholder="HOW did you verify it? (required — at least a sentence; goes on the audit trail)" value={validating.notes || ''} onChange={function (e) { setV({ notes: e.target.value }); }} onBlur={flushV} />
        {(function () {
          var ck0 = validating.checks || {};
          var needRes = (validating.bill.price_check_status === 'flagged' || !!validating.flags) && !validating.bill.price_resolved_note && String(validating.price_resolution || '').trim().length < 10;
          var missing = !validating.btype ? 'pick the TYPE of bill' : !validating.dir ? 'mark it Inbound or Outbound' : !(ck0.matches_records && ck0.goods_received && ck0.charges_accurate) ? 'tick all three checks' : (String(validating.notes || '').trim().length < 10 ? 'write HOW you verified it (10+ characters)' : (needRes ? 'write how the price issue was resolved (10+ characters)' : ''));
          return <button onClick={function () {
            if (missing) { setValidating(Object.assign({}, validating, { err: 'To validate: ' + missing + '.' })); return; }
            setBusy(true);
            if (vTimer.current) { clearTimeout(vTimer.current); vTimer.current = null; }
            api({ action: 'validate_bill', id: validating.bill.id, checks: validating.checks, notes: validating.notes, shipment_direction: validating.dir, bill_type: validating.btype, price_resolution: validating.price_resolution || '', warehouse_reference: validating.warehouse_reference || '', system_match: validating.system_match || null }).then(function (j) {
              if (j && j.ok) { toast.success('✓ Validated — recorded on the audit trail with your name. It can now go on a wire.'); vRef.current = null; setVSaved(''); setValidating(null); load(); }
              else { setValidating(function (v0) { return v0 ? Object.assign({}, v0, { err: (j && j.error) || 'Validation refused.', flags: (j && j.price_flags) || v0.flags }) : v0; }); toast.error((j && j.error) || 'Validation refused.'); }
            }).finally(function () { setBusy(false); });
          }} disabled={busy} title={missing ? 'Still needed: ' + missing : 'Record the validation'} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: missing ? '#94a3b8' : '#047857', color: '#ffffff' }}>✓ Mark validated</button>;
        })()}
        <button onClick={closeV} title="What you entered is kept — finish it later" className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Close — finish later</button>
        {vSaved && <span className="text-[11px] font-bold" style={{ color: /^⛔/.test(vSaved) ? '#b91c1c' : '#065f46' }}>{vSaved}</span>}
      </div>
      {(validating.bill.price_check_status === 'flagged' || validating.flags) && <div className="mt-2">
        <PriceCheckBox check={validating.flags ? { status: 'flagged', flags: validating.flags } : validating.bill.price_check} status="flagged" resolved={validating.bill.price_resolved_note} />
        {!validating.bill.price_resolved_note && <input className={inp} style={{ width: '100%', borderColor: String(validating.price_resolution || '').trim().length < 10 ? '#f87171' : undefined }} placeholder="How was the price issue resolved? (required — e.g. called NexPac, rate was a typo, credit note coming)" value={validating.price_resolution || ''} onChange={function (e) { setV({ price_resolution: e.target.value }); }} onBlur={flushV} />}
      </div>}
      {validating.err && <div className="mt-2 rounded px-2 py-1.5 text-[12px] font-extrabold" style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#7f1d1d' }}>⛔ {validating.err}</div>}
    </div>
              </td></tr>}
              {paying && paying.bill.id === b.id && <tr><td colSpan={11} className="py-2 px-1" style={{ background: '#ffffff' }}>
<div className="rounded-xl p-3 mb-3" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
      <div className="text-xs font-extrabold mb-2" style={{ color: '#14532d' }}>Pay: {paying.bill.vendor_name} {paying.bill.bill_number ? '· ' + paying.bill.bill_number : ''} — open ${fmt(paying.bill.open)}</div>
      <div className="flex gap-2 flex-wrap items-center">
        <input className={inp} type="number" step="0.01" style={{ width: 120 }} placeholder="Amount *" value={paying.amount || ''} onChange={function (e) { setPaying(Object.assign({}, paying, { amount: e.target.value })); }} />
        <label className="text-[10px] font-bold text-slate-600">Paid on<input className={inp + ' ml-1'} type="date" value={paying.paid_date || TODAY} onChange={function (e) { setPaying(Object.assign({}, paying, { paid_date: e.target.value })); }} /></label>
        <select className={inp} style={{ maxWidth: 380 }} value={paying.bank_transaction_id || ''} onChange={function (e) { setPaying(Object.assign({}, paying, { bank_transaction_id: e.target.value })); }}>
          <option value="">No bank link (cash/other)</option>
          {outTxns.map(function (t) {
            return <option key={t.id} value={t.id}>{(t.posted_date || t.date) + ' · $' + fmt(t.amount_abs) + ' · ' + String(t.merchant_name || t.name || '').substring(0, 48)}</option>;
          })}
        </select>
        <button onClick={savePayment} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Record payment</button>
        <button onClick={function () { setPaying(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
      <div className="text-[10px] mt-1" style={{ color: '#166534' }}>Linking the real bank transaction keeps the books provable — the list shows settled money-out from the US accounts.</div>
    </div>
              </td></tr>}
              {disputing && disputing.bill.id === b.id && <tr><td colSpan={11} className="py-2 px-1" style={{ background: '#ffffff' }}>
<div className="rounded-xl p-3 mb-3" style={{ background: '#f5f3ff', border: '1px solid #c4b5fd' }}>
      <div className="text-xs font-extrabold mb-1" style={{ color: '#4c1d95' }}>Dispute: {disputing.bill.vendor_name} {disputing.bill.bill_number ? '· ' + disputing.bill.bill_number : ''}</div>
      <div className="text-[11px] mb-2" style={{ color: '#5b21b6' }}>A dispute without a ticket does not exist. This creates a High ticket with a follow-up date; the bill leaves the payable totals until resolved.</div>
      <div className="flex gap-2 items-center flex-wrap">
        <input className={inp} style={{ width: 380 }} placeholder="Reason for the dispute (required)" value={disputing.reason || ''} onChange={function (e) { setDisputing(Object.assign({}, disputing, { reason: e.target.value })); }} />
        <label className="text-[10px] font-bold text-slate-600">Follow-up<input className={inp + ' ml-1'} type="date" value={disputing.follow_up_date || ''} onChange={function (e) { setDisputing(Object.assign({}, disputing, { follow_up_date: e.target.value })); }} /></label>
        <button onClick={function () {
          setBusy(true);
          api({ action: 'dispute_bill', id: disputing.bill.id, reason: disputing.reason, follow_up_date: disputing.follow_up_date }).then(function (j) {
            if (j && j.ok) { toast.success('Disputed — ticket ' + j.ticket_number + ' created.'); setDisputing(null); load(); }
            else { toast.error((j && j.error) || 'Failed.'); }
          }).finally(function () { setBusy(false); });
        }} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#6d28d9', color: '#ffffff' }}>⚑ Dispute + ticket</button>
        <button onClick={function () { setDisputing(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
    </div>
              </td></tr>}
              {editing && editing.id === b.id && <tr><td colSpan={11} className="py-2 px-1" style={{ background: '#ffffff' }}>
<div id="nt-bill-editor" className="rounded-xl p-3 mb-3" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
      <div className="text-xs font-extrabold mb-2" style={{ color: '#1e3a8a' }}>{editing.id ? 'Edit bill' : (editing._imported ? '📷 Imported bill — CHECK every field before saving' : 'New bill')}</div>
      {editing._imported && importNotes.length > 0 && <div className="text-[11px] rounded-lg p-2 mb-2" style={{ background: '#ffedd5', color: '#431407', border: '1px solid #fdba74' }}>{importNotes.join(' ')}</div>}
      {editing._imported && pricePreview && <PriceCheckBox check={pricePreview} status={pricePreview.status} onRules={function () { setPanel('rules'); }} />}
      {editing._imported && Array.isArray(editing.lines) && editing.lines.length > 0 && <div className="rounded-lg p-2 mb-2" style={{ background: '#ffffff', border: '1px solid #bfdbfe' }}>
        <div className="text-[11px] font-extrabold mb-1" style={{ color: '#1e3a8a' }}>{'Lines read from the bill (' + editing.lines.length + ') — saved with the bill; open it afterwards to fix any line. The Hub checks the prices on save.'}</div>
        <table className="w-full text-[11px]"><tbody style={{ color: '#0f172a' }}>
          {editing.lines.map(function (l, i) { return <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
            <td className="pr-2" style={{ color: '#64748b' }}>{i + 1}</td><td className="pr-2 font-bold">{l.description}</td><td className="pr-2 text-right">{l.qty != null ? Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' ' + (l.unit || '') : ''}</td>
            <td className="pr-2 text-right">{l.unit_price != null ? '@ $' + l.unit_price : ''}</td><td className="text-right font-bold">{l.amount != null ? '$' + fmt(l.amount) : ''}</td></tr>; })}
          <tr style={{ borderTop: '2px solid #cbd5e1' }}><td /><td className="font-extrabold">Lines total</td><td /><td /><td className="text-right font-extrabold" style={{ color: Math.abs(editing.lines.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0) - Number(editing.total_amount || 0)) > 0.01 ? '#b91c1c' : '#065f46' }}>{'$' + fmt(editing.lines.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0))}</td></tr>
        </tbody></table>
      </div>}
      <div className="flex gap-2 flex-wrap items-center">
        <input className={inp} style={{ width: 200 }} placeholder="Vendor *" value={editing.vendor_name || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { vendor_name: e.target.value })); }} />
        <input className={inp} style={{ width: 120 }} placeholder="Bill # *" value={editing.bill_number || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_number: e.target.value })); }} />
        {/* v55.83-RP — type of bill (optional when saving; required to validate) */}
        <select className={inp} style={{ width: 175 }} value={editing.bill_type || ''} title={editing.bill_type && SRC_WORDS[editing.bill_type_source] ? SRC_WORDS[editing.bill_type_source] : 'Type of bill — required before it can be validated'} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_type: e.target.value, bill_type_source: 'manual' })); }}>
          <option value="">type of bill…</option>
          {BILL_TYPES.map(function (t) { return <option key={t} value={t}>{BILL_TYPE_LABEL[t]}</option>; })}
        </select>
        {/* v55.83-RL (Max, Nov 9 12:20: "check box if outbound or inbound -- if inbound release number not necessary but a reference
            number is necessary. if outbound then release number is necessary and reference number is not") */}
        <span className="flex gap-1 items-center" title="Outbound needs the release #; inbound needs the reference">
          {[['inbound', '⬅ Inbound'], ['outbound', 'Outbound ➡']].map(function (d0) {
            var onD = editing.shipment_direction === d0[0];
            return <button key={d0[0]} type="button" onClick={function () { setEditing(Object.assign({}, editing, { shipment_direction: onD ? null : d0[0], direction_source: 'manual' })); }} className="px-2 py-1 rounded text-[10px] font-extrabold"
              style={onD ? { background: '#1e293b', color: '#ffffff' } : { background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>{d0[1]}</button>;
          })}
        </span>
        <input className={inp} style={{ width: 120, borderColor: editing.shipment_direction === 'outbound' && !editing.release_number ? '#f87171' : undefined }} placeholder={'Release #' + (editing.shipment_direction === 'outbound' ? ' *' : '')} title="The release this bill belongs to — needed for OUTBOUND bills (v55.83-RG/RL)" value={editing.release_number || ''} onChange={function (e) { var rv = e.target.value; setEditing(Object.assign({}, editing, { release_number: rv }, (!editing.shipment_direction && rv.trim().length >= 2) ? { shipment_direction: 'outbound', direction_source: 'release_number' } : {})); }} />
        <input className={inp} style={{ width: 140, borderColor: editing.shipment_direction === 'inbound' && !editing.other_reference ? '#f87171' : undefined }} placeholder={'Reference (BOL / PO…)' + (editing.shipment_direction === 'inbound' ? ' *' : '')} title="Any other reference on the bill besides the bill # and release # — needed for INBOUND bills (v55.83-RL)" value={editing.other_reference || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { other_reference: e.target.value })); }} />
        <input className={inp} type="number" step="0.01" style={{ width: 120 }} placeholder="Amount *" value={editing.total_amount || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { total_amount: e.target.value })); }} />
        <label className="text-[10px] font-bold text-slate-600">Bill date<input className={inp + ' ml-1'} type="date" value={editing.bill_date || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { bill_date: e.target.value })); }} /></label>
        <label className="text-[10px] font-bold text-slate-600">Due<input className={inp + ' ml-1'} type="date" value={editing.due_date || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { due_date: e.target.value })); }} /></label>
        {cats ? <span className="inline-flex items-center gap-1">
          <select className={inp} style={{ width: 170 }} value={editing.category || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { category: e.target.value })); }}>
            <option value="">category…</option>
            {cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}
            {editing.category && !cats.some(function (c) { return c.key === editing.category; }) && <option value={editing.category}>{editing.category}</option>}
          </select>
          {!addingCat && <button onClick={function () { setAddingCat(true); }} title="Add a new category" className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#1e293b', color: '#ffffff' }}>＋</button>}
          {addingCat && <span className="inline-flex items-center gap-1">
            <input className={inp} style={{ width: 130 }} placeholder="new category…" value={newCatB} onChange={function (e) { setNewCatB(e.target.value); }} />
            <button onClick={addCatB} disabled={busy || newCatB.trim().length < 2} className="px-2 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff', opacity: (busy || newCatB.trim().length < 2) ? 0.5 : 1 }}>add</button>
            <button onClick={function () { setAddingCat(false); setNewCatB(''); }} className="px-1.5 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>✕</button>
          </span>}
        </span> :
        <input className={inp} style={{ width: 160 }} placeholder="Category (e.g. Freight)" value={editing.category || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { category: e.target.value })); }} />}
        {/* v55.83-QB/QY (Max): another company pays this bill for us — RTM Capital (outside service) or NextTrade Industries (Texas warehouse) */}
        <label className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#9d174d' }} title="Another company pays this bill for us (RTM Capital, NextTrade Industries). It is tracked here but stays OUT of what-we-owe totals and cash forecasts. Link it to the payment you send that company: All Transactions → 🔗 on the money-out → 🏢 Payment to a paid-through company.">
          🏢 Paid via
          <select value={editing.paid_via || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { paid_via: e.target.value || null })); }} className="px-1 py-0.5 rounded border border-slate-300 text-[10px] nt-light">
            <option value="">— we pay it directly —</option>
            {parties.map(function (p0) { return <option key={p0.name} value={p0.name}>{p0.name}</option>; })}
          </select></label>
        <input className={inp} style={{ width: 220 }} placeholder="Notes" value={editing.notes || ''} onChange={function (e) { setEditing(Object.assign({}, editing, { notes: e.target.value })); }} />
        <button onClick={saveBill} disabled={busy} className="px-3 py-1 rounded-lg text-[11px] font-extrabold" style={{ background: '#047857', color: '#ffffff' }}>Save</button>
        <button onClick={function () { setEditing(null); }} className="px-3 py-1 rounded-lg text-[11px] font-bold" style={{ background: '#e2e8f0', color: '#334155' }}>Cancel</button>
      </div>
    </div>
              </td></tr>}
              {rowAsk && rowAsk.bill.id === b.id && <tr><td colSpan={11} className="py-2 px-1" style={{ background: '#ffffff' }}>
                <div className="rounded-xl p-3" style={{ background: rowAsk.kind === 'resolve' ? '#ecfdf5' : '#fee2e2', border: '2px solid ' + (rowAsk.kind === 'resolve' ? '#10b981' : '#dc2626') }}>
                  <div className="text-[13px] font-extrabold mb-1" style={{ color: rowAsk.kind === 'resolve' ? '#065f46' : '#7f1d1d' }}>{rowAsk.kind === 'delete' ? '🗑 Delete ' + rowAsk.bill.vendor_name + ' · ' + (rowAsk.bill.bill_number || '—') + ' ($' + fmt(rowAsk.bill.total_amount) + ')? It disappears from the Hub — lists, reports, wires, duplicate checks. Use this for a bill that should never have been here (e.g. imported twice). For a real bill that was cancelled, use Void instead (it stays visible as VOID). Its history stays on the audit trail.' : rowAsk.kind === 'reopen' ? '↩ Reopen the validation of this bill? It goes back to PENDING (audited) — fix it, then validate it again before it can be wired.' : rowAsk.kind === 'void_bill' ? '🗑 Void this bill? It stays on record as VOID (audited) and leaves what we owe.' : rowAsk.kind === 'void_payment' ? '🗑 Void this payment of $' + fmt(rowAsk.payment.amount) + ' (' + rowAsk.payment.paid_date + ')? The bill becomes open again by that amount.' : '✓ Resolve the dispute — how was it resolved? (goes on the audit trail)'}</div>
                  <div className="flex gap-2 items-center flex-wrap">
                    {(rowAsk.kind === 'resolve' || rowAsk.kind === 'reopen' || rowAsk.kind === 'delete') && <input autoFocus className={inp} style={{ flex: '1 1 360px' }} placeholder={rowAsk.kind === 'delete' ? 'Why is it deleted? (required — e.g. imported twice)' : rowAsk.kind === 'reopen' ? 'Why is it reopened? (required — e.g. wrong amount on line 3)' : 'How was it resolved? (at least a sentence)'} value={rowAsk.text || ''} onChange={function (e) { setRowAsk(Object.assign({}, rowAsk, { text: e.target.value, err: '' })); }} />}
                    <button disabled={busy} onClick={function () {
                      var ra = rowAsk; var req = ra.kind === 'delete' ? { action: 'delete_bill', id: ra.bill.id, reason: ra.text || '' } : ra.kind === 'reopen' ? { action: 'reopen_validation', id: ra.bill.id, reason: ra.text || '' } : ra.kind === 'void_bill' ? { action: 'void_bill', id: ra.bill.id } : ra.kind === 'void_payment' ? { action: 'void_payment', id: ra.payment.id } : { action: 'resolve_dispute', id: ra.bill.id, resolution: ra.text || '' };
                      if (ra.kind === 'resolve' && String(ra.text || '').trim().length < 10) { setRowAsk(Object.assign({}, ra, { err: 'Write how it was resolved — at least a sentence.' })); return; }
                      if (ra.kind === 'delete' && String(ra.text || '').trim().length < 5) { setRowAsk(Object.assign({}, ra, { err: 'Write why it is deleted (at least 5 characters) — it goes on the audit trail.' })); return; }
                      if (ra.kind === 'reopen' && String(ra.text || '').trim().length < 5) { setRowAsk(Object.assign({}, ra, { err: 'Write why it is reopened — it goes on the audit trail.' })); return; }
                      setBusy(true);
                      api(req).then(function (j) {
                        if (j && j.ok) { toast.success(ra.kind === 'delete' ? '🗑 Bill deleted — it is gone from the Hub (its history is kept).' : ra.kind === 'reopen' ? '↩ Validation reopened — the bill is PENDING again.' : ra.kind === 'void_bill' ? 'Bill voided.' : ra.kind === 'void_payment' ? 'Payment voided.' : 'Dispute resolved.'); setRowAsk(null); load(); }
                        else { setRowAsk(function (r0) { return r0 ? Object.assign({}, r0, { err: (j && j.error) || 'It did not go through — the server did not say why.' }) : r0; }); }
                      }).finally(function () { setBusy(false); });
                    }} className="px-4 py-1.5 rounded-lg text-[12px] font-extrabold" style={{ background: rowAsk.kind === 'resolve' ? '#047857' : rowAsk.kind === 'reopen' ? '#1e293b' : '#b91c1c', color: '#ffffff' }}>{busy ? 'Working…' : rowAsk.kind === 'resolve' ? '✓ Resolve' : rowAsk.kind === 'reopen' ? '↩ Reopen it' : rowAsk.kind === 'delete' ? '🗑 Delete it' : '🗑 Void it'}</button>
                    <button onClick={function () { setRowAsk(null); }} className="px-3 py-1.5 rounded-lg text-[12px] font-bold" style={{ background: '#ffffff', color: '#334155', border: '1px solid #cbd5e1' }}>Keep it</button>
                  </div>
                  {rowAsk.err && <div className="mt-2 rounded-lg px-3 py-2 text-[12px] font-extrabold" style={{ background: '#ffffff', color: '#b91c1c', border: '1px solid #fca5a5' }}>{'⛔ ' + rowAsk.err}</div>}
                </div>
              </td></tr>}
              {expanded === b.id && <tr><td colSpan={11} className="py-1.5 pl-4" style={{ background: '#f8fafc', color: '#334155' }}>
                <BillLinesPanel bill={b} api={api} toast={toast} canManage={canManage} onChanged={load} onRules={function () { setPanel('rules'); }} />
                {b.notes && <div className="text-[11px] mb-1"><b>Notes:</b> {b.notes}</div>}
                {paysOf(b.id).length === 0 ? <span className="text-[11px]">No payments yet.</span> :
                  paysOf(b.id).map(function (p) {
                    return <div key={p.id} className="text-[11px] flex gap-2 items-center">
                      <span>{p.paid_date} — ${fmt(p.amount)}{p.voided ? ' (VOID)' : ''}{p.bank_transaction_id ? ' · 🏦 bank-linked' : (p.method ? ' · ' + p.method : '')}</span>
                      {canManage && !p.voided && <button onClick={function () { closePanels(); setRowAsk({ kind: 'void_payment', bill: b, payment: p }); }} className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#7f1d1d' }}>void</button>}
                    </div>;
                  })}
              </td></tr>}
            </React.Fragment>;
          })}
          {shown.length === 0 && <tr><td colSpan={11} className="py-4 text-center text-slate-500 text-[11px]">{busy ? 'Loading…' : 'No bills here yet.'}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}
