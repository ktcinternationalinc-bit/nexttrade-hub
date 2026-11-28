'use client';
// v55.83-TW — Accounting → 🟦 Nextrade and 🟪 RTM: each company's OWN books (Max, Nov 17 2026: "They're three separate
// companies per se when it comes to categorization, all that stuff"). Own bank + credit-card accounts, own categories,
// own rules, own totals and export. Nextrade expense categories can map to KTC bill categories.
// Inline colours on white panels (the dark theme repaints bg-white).
import React, { useState, useEffect, useCallback } from 'react';
import { hubFetch } from '../lib/hub-fetch';
import { companyByKey } from '../lib/companies';
import { learnMatchText, lineShown } from '../lib/company-rule-learn';
import StatementImport from './StatementImport';
import NextradeTaxReport from './NextradeTaxReport';
import CompanyTotalsReport from './CompanyTotalsReport';
import BankRuleMatchFields from './BankRuleMatchFields';
import { ALL_KEYWORDS_MATCH, PHRASE_MATCH, parseRuleMatch, ruleMatchLabel } from '../lib/bank-rule-match';
import { NEXTRADE_SOURCE_LABELS } from '../lib/nextrade-tax-report';
import { isStalePending, pendingLabel } from '../lib/pending-age'; // v55.83-XT
import { notifyKtcExpensesChanged } from '../lib/expense-report-events';
import { canSplitInto } from '../lib/nextrade-bill-splits';
import NextradeBillSplitEditor from './NextradeBillSplitEditor';

function fmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
var panel = { background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0' };
var inp = 'px-2 py-1 rounded border text-[11px] nt-light'; // v55.83-UA — nt-light: dark text on white even under the dark theme (globals.css)
var inpS = { background: '#ffffff', color: '#0f172a', borderColor: '#cbd5e1' };
function btn(bg, fg) { return { background: bg, color: fg }; }
var DIR_WORDS = { any: 'money in or out', 'in': 'money in only', out: 'money out only' }; // v55.83-UB
var KTC_BILL_WORDS = { created: '🧾 KTC bill made', attached: '🔗 attached to a KTC bill' };

export default function CompanyBooksTab(props) {
  var comp = companyByKey(props.company);
  var userProfile = props.userProfile; var canManage = props.canManage === true;
  var canCreateKtcCategory = canManage && props.canCreateKtcCategory === true;
  var [ktcCategoryForm, setKtcCategoryForm] = useState(null);
  var toast = props.toast || { success: function () {}, error: function () {} };
  var s1 = useState('lines'); var view = s1[0]; var setView = s1[1];
  var s2 = useState(null); var lines = s2[0]; var setLines = s2[1];
  var s3 = useState([]); var cats = s3[0]; var setCats = s3[1];
  var s4 = useState(false); var busy = s4[0]; var setBusy = s4[1];
  var s5 = useState(''); var err = s5[0]; var setErr = s5[1];
  var t0 = new Date(); var f0 = new Date(t0.getFullYear(), t0.getMonth() - 2, 1);
  var s6 = useState(iso(f0)); var from = s6[0]; var setFrom = s6[1];
  var s7 = useState(iso(t0)); var to = s7[0]; var setTo = s7[1];
  var s8 = useState('all'); var show = s8[0]; var setShow = s8[1]; // v55.83-VK — a line stays on the page after it is categorized (Max 19 Nov: "i don't see them")
  var s22 = useState(null); var ruleWait = s22[0]; var setRuleWait = s22[1]; // lines shown that a rule covers (count only — nothing is written on open)
  var s21 = useState({ map: {}, cats: [] }); var ktc = s21[0]; var setKtc = s21[1]; // Nextrade: KTC category per Nextrade category
  var s9 = useState(''); var q = s9[0]; var setQ = s9[1];
  var s10 = useState({}); var sel = s10[0]; var setSel = s10[1];
  var s11 = useState(''); var bulkCat = s11[0]; var setBulkCat = s11[1];
  var s12 = useState(null); var rules = s12[0]; var setRules = s12[1];
  var s13 = useState(null); var totals = s13[0]; var setTotals = s13[1];
  var s14 = useState(null); var accounts = s14[0]; var setAccounts = s14[1];
  var s15 = useState(null); var mapping = s15[0]; var setMapping = s15[1];
  var s16 = useState(null); var catForm = s16[0]; var setCatForm = s16[1];
  var s17 = useState(null); var ruleForm = s17[0]; var setRuleForm = s17[1];
  var s18 = useState(''); var sqlMissing = s18[0]; var setSqlMissing = s18[1];
  var s19 = useState({}); var kinds = s19[0]; var setKinds = s19[1];
  var [cutoff, setCutoff] = useState(null);
  const [pnlChoiceError, setPnlChoiceError] = useState('');
  var s20 = useState(null); var rowPanel = s20[0]; var setRowPanel = s20[1]; // v55.83-UB — { id, mode: 'newcat' | 'transfer', ... } under one row

  var companyKey = comp?.key;
  var userId = userProfile?.id;
  var api = useCallback(function (payload) {
    return hubFetch('/api/accounting/company-books', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ user_id: userId, company: companyKey }, payload)) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly (HTTP ' + r.status + ').' }; }); })
      .catch(function (e) { return { ok: false, error: 'Could not reach the server (' + ((e && e.message) || 'network') + ').' }; });
  }, [companyKey, userId]);
  function loadCats() { return api({ action: 'categories' }).then(function (j) { if (j && j.ok) { setCats(j.categories || []); setKinds(j.kinds || {}); if (j.sql_missing) { setSqlMissing(j.sql_missing); } } }); }
  function loadAccounts() {
    return api({ action: 'accounts' }).then(function (j) {
      if (j && j.ok) { setAccounts(j.accounts || []); }
      else { setErr((j && j.error) || 'Could not load the accounts.'); }
    });
  }
  // v55.83-VK (Codex 19 Nov 20:27 P1 / P3) — opening the page WRITES NOTHING. It only counts the lines shown that a rule
  // covers and says so in a bar; a rule categorizes lines only when a person presses Apply and answers the question.
  function loadLines(start, end) {
    start = start || from; end = end || to;
    setBusy(true); setRuleWait(null);
    return api({ action: 'lines', from: start, to: end }).then(function (j) {
      if (j && j.ok) {
        setLines(j.lines || []); setCats(j.categories || cats); setErr(''); setSqlMissing(j.sql_missing || ''); setSel({});
        setPnlChoiceError(j.ktc_pnl_error || '');
        if (j.ktc_categories) { setKtc({ map: j.ktc_map || {}, cats: j.ktc_categories || [] }); }
        var waiting = (j.lines || []).some(function (l) { return !l.company_category && !l.pending && !l.transfer_group_id; });
        if (canManage && waiting && !j.sql_missing) {
          return api({ action: 'apply_rules', from: start, to: end, preview: true }).then(function (a) { if (a && a.ok && a.would > 0) { setRuleWait({ would: a.would, bills: a.would_bills || 0 }); } });
        }
      }
      else { setErr((j && j.error) || 'Could not load the lines.'); }
    }).finally(function () { setBusy(false); });
  }
  // what a rule run did — every outcome is said out loud, including the lines it left alone and the ones it could not do
  function sayRuleRun(a, lead) {
    if (!a || !a.ok) { toast.error((a && a.error) || 'The rules were not applied.'); return; }
    var bits = [a.categorized + ' line(s) categorized' + (lead || '')];
    if (a.bills_made) { bits.push(a.bills_made + ' KTC bill(s) made'); }
    if (a.skipped) { bits.push(a.skipped + ' left alone (changed by someone a moment ago)'); }
    if (a.more) { bits.push('more left — press 📏 Apply rules again'); }
    toast.success(bits.join(' · '));
    if (a.problems && a.problems.length) { toast.error((a.problem_count || a.problems.length) + ' line(s) could NOT be categorized by a rule: ' + a.problems[0]); }
  }
  // 📏 Apply rules: count first, ask, then write (dates shown)
  function applyRulesAsk() {
    setBusy(true);
    api({ action: 'apply_rules', from: from, to: to, preview: true }).then(function (pv) {
      if (!pv || !pv.ok) { toast.error((pv && pv.error) || 'Could not count the lines.'); return; }
      if (!pv.would) { toast.success('No line shown that is not categorized yet matches a rule.'); setRuleWait(null); return; }
      if (!window.confirm('Your rules cover ' + pv.would + ' line(s) not categorized yet, between ' + from + ' and ' + to + '.' + (pv.would_bills ? '\n\n' + pv.would_bills + ' of them are in a category KTC pays: each makes its KTC bill (owed to Nextrade).' : '') + '\n\nCategorize them now?')) { return; }
      return api({ action: 'apply_rules', from: from, to: to }).then(function (a) { sayRuleRun(a, ' by the rules'); return loadLines(); });
    }).finally(function () { setBusy(false); });
  }
  function loadView(v) {
    setView(v);
    if (v === 'lines') { loadLines(); if (comp.key === 'nextrade') { loadAccounts(); } }
    if (v === 'rules') { loadCats(); api({ action: 'rules' }).then(function (j) { if (j && j.ok) { setRules(j.rules || []); } else { setErr((j && j.error) || ''); } }); }
    if (v === 'categories') { loadCats(); }
    if (v === 'totals') { setBusy(true); loadTotals(from, to).finally(function () { setBusy(false); }); }
    if (v === 'accounts') { loadAccounts(); }
    if (v === 'mapping') { api({ action: 'mapping' }).then(function (j) { if (j && j.ok) { setMapping(j); } else { setErr((j && j.error) || ''); } }); }
  }
  function loadTotals(start, end) {
    return api({ action: 'totals', from: start, to: end }).then(function (j) {
      if (j && j.ok && j.totals) {
        setTotals({ ...j.totals, from: j.from, to: j.to, capped: j.capped });
        setErr('');
      } else { setErr((j && (j.error || j.sql_missing)) || 'Totals could not refresh. Use Show to try again.'); }
    });
  }
  useEffect(function () { if (comp) { loadCats(); loadView('lines'); loadCutoff(); } }, [props.company]); // eslint-disable-line react-hooks/exhaustive-deps
  // v55.83-XN (Max, 21 Nov: "JUST ONE BUTTON TO IGNORE ALL OF THEM FROM CREATING KTC BILLS PRIOR TO JUNE 1 2026") — the super admin's
  // one button. ON: the KTC bills made from Nextrade lines before 1 June 2026 are voided (kept, never deleted) and no earlier line
  // makes one again. OFF: exactly those bills come back. A bill with money on it or on a wire is left alone and named.
  function loadCutoff() { if (!comp || comp.key !== 'nextrade') { setCutoff(null); return; } api({ action: 'bill_cutoff' }).then(function (j) { setCutoff(j && j.ok ? j : null); }); }
  function moneyC(v) { return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pressCutoff() {
    if (!cutoff || !cutoff.can_set) { return; }
    var turnOn = cutoff.on !== true;
    var q = turnOn
      ? 'Stop KTC bills from Nextrade lines dated BEFORE 1 June 2026?\n\n' + cutoff.would_stop + ' KTC bill(s)' + (cutoff.would_stop_total !== null && cutoff.would_stop_total !== undefined ? ' (' + moneyC(cutoff.would_stop_total) + ')' : '') + ' made from those lines will be voided, so KTC is not asked to pay them. Nothing is deleted. A bill with money recorded on it or on a wire is left as it is and named.\n\nFrom now on, no Nextrade line before 1 June 2026 makes a KTC bill. You can turn this off later: the same bills come back.'
      : 'Turn OFF the 1 June 2026 cut-off?\n\nThe ' + (cutoff.stopped || 0) + ' KTC bill(s) it voided come back as bills KTC owes Nextrade.';
    if (!window.confirm(q)) { return; }
    setBusy(true);
    api({ action: 'set_bill_cutoff', on: turnOn }).then(function (j) {
      if (!j || !j.ok) { toast.error((j && j.error) || 'Not done.'); return; }
      var kept = (j.kept || []).map(function (k) { return (k.bill_number || 'a bill') + ' (' + k.why + ')'; });
      toast.success(turnOn ? (j.count + ' KTC bill(s) from Nextrade lines before 1 June 2026 voided. No earlier line makes a KTC bill now.' + (kept.length ? ' Left as they are: ' + kept.join(', ') + '.' : '')) : (j.count + ' KTC bill(s) brought back. The cut-off is off.'));
      loadCutoff(); loadLines();
    }).finally(function () { setBusy(false); });
  }
  if (!comp) { return <div className="p-3 text-[12px]">Unknown company.</div>; }

  function setCategory(ids, key, refreshReport) {
    if (!ids.length) { return; }
    // v55.83-XU (Max 22 Nov) — taking the category off asks first, with the count (a KTC bill made from the line is voided by the
    // existing guarded step; a paid or posted one stops it and is named)
    if (!key && !window.confirm('Take the category off ' + ids.length + ' line(s)?\n\nThey go back to Uncategorized. A KTC bill made from a line is voided (never deleted); a line whose KTC bill is paid or posted is left as it is and named.')) { return; }
    setBusy(true);
    return api({ action: 'set_category', ids: ids, category_key: key || null }).then(function (j) {
      var made = ((j && j.results) || []).filter(function (r) { return r.ktc && r.ktc.action && r.ktc.action !== 'none'; });
      // v55.83-VK — what was just categorized by hand became (or updated) a rule: say so, and offer the other lines it covers
      var learned = ((j && j.learned) || []); var catLabel = (catByKey[key] || {}).label || key;
      var fresh = learned.filter(function (x) { return x.state === 'created' || x.state === 'updated'; });
      var failedL = learned.filter(function (x) { return x.state === 'failed'; });
      var ruleWords = fresh.length ? ' · 📏 rule ' + (fresh[0].state === 'updated' ? 'updated' : 'learned') + ': “' + fresh[0].match_text + '” → ' + catLabel + (fresh.length > 1 ? ' (+' + (fresh.length - 1) + ' more)' : '') : '';
      if (j && j.ok) { toast.success('Saved ' + j.saved + ' line(s)' + (made.length ? ' · KTC bills: ' + made.map(function (r) { return r.ktc.action + (r.ktc.bill_number ? ' ' + r.ktc.bill_number : ''); }).join(', ') : '') + ruleWords); }
      else { toast.error((j && j.error) || 'Not saved.'); }
      if (comp.key === 'nextrade' && j?.saved > 0) { notifyKtcExpensesChanged(); }
      if (failedL.length) { toast.error('The line is saved, but no rule was learned: ' + (failedL[0].error || 'error')); }
      var withMore = learned.filter(function (x) { return x.rule_id && x.matches > 0; }); var nMore = 0; withMore.forEach(function (x) { nMore += x.matches; });
      if (withMore.length && window.confirm(nMore + ' other line(s) not categorized yet have the same description (' + withMore.map(function (x) { return '“' + x.match_text + '”'; }).join(', ') + ').\n\nPut them in “' + catLabel + '” too?' + (comp.key === 'nextrade' ? '\n\n(For a category KTC pays, each line also makes its KTC bill.)' : ''))) {
        return api({ action: 'apply_rules', all_dates: true, rule_ids: withMore.map(function (x) { return x.rule_id; }) }).then(function (a) {
          sayRuleRun(a, ' by the new rule');
          if (comp.key === 'nextrade' && a?.categorized > 0) { notifyKtcExpensesChanged(); }
          return refreshReport ? refreshReport() : loadLines();
        });
      }
      if (!refreshReport) { return loadLines(); }
      if (j && (j.ok || j.saved > 0)) { return refreshReport(); }
    }).catch(function () {
      toast.error('Could not confirm the category change. Refresh to check the saved category.');
      if (refreshReport) { return refreshReport(); }
    }).finally(function () { setBusy(false); });
  }
  async function setKtcPnlChoice(line, excluded) {
    setBusy(true);
    try {
      const result = await api({ action: 'set_ktc_pnl_exclusion', transaction_id: line.id, excluded });
      if (!result.ok) { toast.error(result.error || 'The KTC P&L choice could not be saved.'); return; }
      setLines(current => current?.map(row => row.id === line.id ? { ...row, ktc_pnl_excluded: result.excluded } : row));
      notifyKtcExpensesChanged(line.date);
      toast.success(result.excluded ? 'Excluded from KTC P&L.' : 'Included in KTC P&L.');
    } finally { setBusy(false); }
  }
  async function saveBillSplit(line, allocations) {
    setBusy(true);
    try {
      const result = await api({ action: 'save_bill_split', transaction_id: line.id, revision: line.bill_split_revision || 0, allocations });
      if (!result.ok) { toast.error(result.error || 'The bill split could not be saved.'); return; }
      setRowPanel(null);
      notifyKtcExpensesChanged(line.date);
      toast.success(allocations.length ? 'Bill category split saved.' : 'Bill category split removed.');
      await loadLines();
    } finally { setBusy(false); }
  }
  function openKtcCategory(nextradeKey) {
    setKtcCategoryForm({ nextradeKey: nextradeKey, label: '', kind: 'expense' });
  }
  async function setKtcCategory(nextradeKey, ktcKey) {
    if (ktcKey === '__new') { openKtcCategory(nextradeKey); return; }
    var j = await api({ action: 'save_mapping', category_key: nextradeKey, ktc_category: ktcKey || null });
    if (!j || !j.ok) { toast.error((j && j.error) || 'KTC mapping could not be saved.'); return false; }
    notifyKtcExpensesChanged();
    toast.success('KTC category saved for “' + ((catByKey[nextradeKey] || {}).label || nextradeKey) + '”' + (j.bills_updated ? ' · ' + j.bills_updated + ' KTC bill(s) updated' : ''));
    var value = ktcKey || null;
    setKtc(function (current) { return Object.assign({}, current, { map: Object.assign({}, current.map, { [nextradeKey]: value }) }); });
    setMapping(function (current) {
      if (!current) { return current; }
      return Object.assign({}, current, { rows: current.rows.map(function (row) { return row.key === nextradeKey ? Object.assign({}, row, { ktc_category: value }) : row; }) });
    });
    return true;
  }
  async function pickKtcCategory(nextradeKey, key) {
    setBusy(true);
    try { await setKtcCategory(nextradeKey, key); }
    finally { setBusy(false); }
  }
  async function saveKtcCategory(event) {
    event.preventDefault();
    var form = ktcCategoryForm;
    setBusy(true);
    try {
      var response = await hubFetch('/api/accounting/expense-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_category', payload: { label: form.label, kind: form.kind } }) });
      var j = await response.json();
      if (!j.ok || !j.category) { toast.error(j.error || 'KTC category could not be created.'); return; }
      var category = { key: j.category.key, label: j.category.label };
      setKtc(function (current) { return Object.assign({}, current, { cats: current.cats.concat(category) }); });
      setMapping(function (current) { return current && Object.assign({}, current, { ktc_categories: current.ktc_categories.concat(category) }); });
      setKtcCategoryForm(null);
      toast.success('KTC category “' + category.label + '” created');
      await setKtcCategory(form.nextradeKey, category.key);
    } catch (e) { toast.error('Could not confirm the KTC category save. Refresh the category list before retrying.'); }
    finally { setBusy(false); }
  }
  function openRule(line) {
    setRowPanel(null);
    setRuleForm({ lineId: line.id, match_text: learnMatchText(line) || '', match_mode: comp.key === 'nextrade' ? ALL_KEYWORDS_MATCH : PHRASE_MATCH, direction: line.direction, category_key: '' });
  }
  async function saveRule(event) {
    event.preventDefault();
    setBusy(true);
    try {
      var j = await api({ action: 'save_rule', rule: ruleForm });
      if (!j || !j.ok) { toast.error((j && j.error) || 'Rule could not be saved.'); return; }
      toast.success(ruleForm.lineId ? 'Rule saved' : 'Rule saved. Apply it from Transactions.');
      setRuleForm(null);
      if (ruleForm.lineId) { await loadLines(); } else { loadView('rules'); }
    } finally { setBusy(false); }
  }
  function renderRuleForm() {
    var choices = activeCats.filter(function (c) { return !c.direction || c.direction === 'any' || ruleForm.direction === 'any' || c.direction === ruleForm.direction; });
    return <form onSubmit={saveRule} className="flex gap-2 items-center flex-wrap mb-2 p-2 rounded" style={btn('#f8fafc', '#0f172a')}>
      <BankRuleMatchFields rule={ruleForm} onChange={setRuleForm} disabled={busy} allowKeywords={comp.key === 'nextrade'} />
      <select aria-label="Money direction" className={inp} style={inpS} value={ruleForm.direction} onChange={function (e) {
        var direction = e.target.value; var category = catByKey[ruleForm.category_key];
        setRuleForm(Object.assign({}, ruleForm, { direction: direction, category_key: category && category.direction && category.direction !== 'any' && direction !== 'any' && category.direction !== direction ? '' : ruleForm.category_key }));
      }}><option value="any">Money in or out</option><option value="out">Money out only</option><option value="in">Money in only</option></select>
      <select aria-label={comp.label + ' category'} className={inp} style={inpS} value={ruleForm.category_key} onChange={function (e) { setRuleForm(Object.assign({}, ruleForm, { category_key: e.target.value })); }}><option value="">Choose a category</option>{choices.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}</select>
      <button disabled={busy || !!parseRuleMatch(ruleForm.match_text, ruleForm.match_mode).error || !ruleForm.category_key} className="px-2 py-1 rounded text-[10px] font-extrabold" style={btn('#0f172a', '#ffffff')}>Save rule</button>
      <button type="button" onClick={function () { setRuleForm(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>Cancel</button>
    </form>;
  }
  // v55.83-UB (Max: 'add categories on the fly and give it a direction') — make the category, then put this line in it
  function addCategoryForLine(l, f) {
    setBusy(true);
    api({ action: 'save_category', category: Object.assign({ label: f.label, kind: f.kind, direction: f.direction, is_payroll: f.is_payroll === true }, f.makes_ktc_bill === true || f.makes_ktc_bill === false ? { makes_ktc_bill: f.makes_ktc_bill } : {}) }).then(function (j) {
      if (!j || !j.ok) { toast.error((j && j.error) || 'Not saved.'); setBusy(false); return; }
      setRowPanel(null);
      return loadCats().then(function () { setBusy(false); setCategory([l.id], j.key); });
    }, function () { setBusy(false); });
  }
  // v55.83-UB (Max: 'transfer … should work the same way as KTC … link the transfer to the transfer from the other account, like QuickBooks')
  function openTransfer(l, manual, q) {
    setRowPanel({ id: l.id, mode: 'transfer', loading: true, manual: !!manual, q: q || '', cands: [] });
    api({ action: 'transfer_candidates', line_id: l.id, manual: !!manual, q: q || '' }).then(function (j) {
      if (j && j.ok) { setRowPanel({ id: l.id, mode: 'transfer', loading: false, manual: !!manual, q: q || '', cands: j.candidates || [] }); }
      else { toast.error((j && j.error) || 'Could not look for the other side.'); setRowPanel(null); }
    });
  }
  function pair(l, c) {
    setBusy(true);
    api({ action: 'pair_transfer', a: l.id, b: c.id }).then(function (j) {
      if (j && j.ok) { toast.success('Paired as a transfer (' + ((j.result && j.result.category) === 'card_payment' ? 'credit card payment' : 'between own accounts') + ') — never income or spending.'); setRowPanel(null); loadLines(); }
      else { toast.error((j && j.error) || 'Not paired.'); }
    }).finally(function () { setBusy(false); });
  }
  function unpair(l) {
    setBusy(true);
    api({ action: 'unpair_transfer', transfer_group_id: l.transfer_group_id }).then(function (j) {
      if (j && j.ok) { toast.success('Unpaired — both lines are not categorized again.'); loadLines(); } else { toast.error((j && j.error) || 'Not unpaired.'); }
    }).finally(function () { setBusy(false); });
  }
  function catsFor(l, categories = cats) { return categories.filter(function (c) { return (c.active || c.key === l.company_category) && (!c.direction || c.direction === 'any' || c.direction === l.direction || c.key === l.company_category); }); }
  function exportCsv(rowsOut, name) {
    var csv = rowsOut.map(function (r) { return r.map(function (c) { var s = String(c == null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
  }
  var catByKey = {}; cats.forEach(function (c) { catByKey[c.key] = c; });
  var activeCats = cats.filter(function (c) { return c.active; });
  var nCat = 0; var nUncat = 0; (lines || []).forEach(function (l) { if (l.company_category) { nCat++; } else { nUncat++; } });
  var shown = (lines || []).filter(function (l) {
    if (!lineShown(show, l)) { return false; }
    if (q && (String(l.name || '') + ' ' + String(l.merchant_name || '') + ' ' + l.amount_abs).toLowerCase().indexOf(q.toLowerCase()) < 0) { return false; }
    return true;
  });
  var selIds = Object.keys(sel).filter(function (k) { return sel[k]; });
  var feedAccounts = (accounts || []).filter(function (a) { return a.feed_type === 'plaid'; });
  var manualAccounts = (accounts || []).filter(function (a) { return a.feed_type === 'statement'; });
  var lastFeedSync = feedAccounts.reduce(function (latest, a) { return a.last_synced && a.last_synced > latest ? a.last_synced : latest; }, '');
  var feedNeedsAttention = feedAccounts.some(function (a) { return ['error', 'partial', 'preparing'].indexOf(a.last_sync_status) >= 0; });
  var tabs = [['lines', '📋 Transactions'], ['totals', '📊 Totals'], ['categories', '🏷 Categories'], ['rules', '📏 Rules'], ['accounts', '🏦 Accounts & cards']];
  if (comp.key === 'nextrade') { tabs.splice(2, 0, ['tax_report', 'Tax report']); tabs.push(['mapping', '🔁 Category mapping → KTC']); }

  return <div className="rounded-xl p-3" style={panel}>
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <div className="text-[14px] font-extrabold">{comp.icon} {comp.label} — own books</div>
      {comp.key === 'nextrade' && <div className="text-[10px]" style={{ color: '#64748b' }}>Money-out transactions in categories KTC pays can create KTC bills owed to Nextrade.</div>}
    </div>
    {sqlMissing && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{sqlMissing}</div>}
    {err && <div className="text-[11px] p-2 rounded mb-2" style={{ background: '#fef2f2', color: '#991b1b' }}>{err}</div>}
    <div className="flex gap-1 flex-wrap mb-3">{tabs.map(function (t) { return <button key={t[0]} onClick={function () { setErr(''); loadView(t[0]); }} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold" style={view === t[0] ? btn('#0f172a', '#ffffff') : btn('#f1f5f9', '#334155')}>{t[1]}</button>; })}</div>
    {canCreateKtcCategory && ktcCategoryForm && (view === 'lines' || view === 'mapping') && <form onSubmit={saveKtcCategory} className="flex flex-wrap items-center gap-2 p-2 mb-2 rounded text-[11px]" style={btn('#eff6ff', '#1e3a8a')}>
      <label className="font-bold">New KTC category for {(catByKey[ktcCategoryForm.nextradeKey] || {}).label || ktcCategoryForm.nextradeKey} <input autoFocus className={inp} style={inpS} value={ktcCategoryForm.label} onChange={function (e) { setKtcCategoryForm(Object.assign({}, ktcCategoryForm, { label: e.target.value })); }} placeholder="Category name" /></label>
      <select aria-label="KTC category type" className={inp} style={inpS} value={ktcCategoryForm.kind} onChange={function (e) { setKtcCategoryForm(Object.assign({}, ktcCategoryForm, { kind: e.target.value })); }}>{['expense', 'cogs', 'other_expense'].map(function (kind) { return <option key={kind} value={kind}>{kinds[kind] || kind}</option>; })}</select>
      <button disabled={busy || ktcCategoryForm.label.trim().length < 2} className="px-2 py-1 rounded font-bold" style={btn('#1e3a8a', '#ffffff')}>Create and map</button>
      <button type="button" disabled={busy} onClick={function () { setKtcCategoryForm(null); }} className="px-2 py-1 rounded font-bold">Cancel</button>
    </form>}

    {(view === 'lines' || view === 'totals') && <div className="flex gap-2 items-center flex-wrap mb-2">
      <span className="text-[10px] font-bold">From</span><input type="date" className={inp} style={inpS} value={from} onChange={function (e) { setFrom(e.target.value); }} />
      <span className="text-[10px] font-bold">to</span><input type="date" className={inp} style={inpS} value={to} onChange={function (e) { setTo(e.target.value); }} />
      <button onClick={function () { loadView(view); }} disabled={busy} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#e0f2fe', '#075985')}>{busy ? 'Loading…' : '↻ Show'}</button>
    </div>}

    {view === 'lines' && <div>
      {pnlChoiceError && <p role="alert" className="mb-2 text-[11px]" style={{ color: '#991b1b' }}>{pnlChoiceError}</p>}
      {comp.key === 'nextrade' && accounts && <div className="flex items-center flex-wrap gap-2 mb-2 text-[11px]" style={{ color: '#475569' }}>
        <span>{feedAccounts.length ? 'Plaid checks for new transactions every 2 hours' + (lastFeedSync ? ' · Latest pull ' + new Date(lastFeedSync).toLocaleString() : ' · Waiting for the first pull') : 'No Plaid feed connected'}</span>
        {feedNeedsAttention && <span style={{ color: '#92400e' }}>A connection needs attention</span>}
        {manualAccounts.length > 0 && <span>{manualAccounts.length} statement-only account(s)</span>}
        <button onClick={function () { loadView('accounts'); }} className="font-bold underline" style={{ color: '#1e40af' }}>Account sources &amp; imports</button>
      </div>}
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <button type="button" aria-pressed={show === 'uncat'} onClick={function () { setShow(show === 'uncat' ? 'all' : 'uncat'); setSel({}); }} className="px-2 py-1 rounded text-[11px] font-bold" style={show === 'uncat' ? btn('#1e40af', '#ffffff') : btn('#dbeafe', '#1e3a8a')}>Uncategorized ({nUncat})</button>
        <select aria-label="Transaction category filter" className={inp} style={inpS} value={show} onChange={function (e) { setShow(e.target.value); setSel({}); }}>
          <option value="all">{'All lines (' + (nCat + nUncat) + ')'}</option><option value="cat">{'Categorized (' + nCat + ')'}</option><option value="uncat">{'Uncategorized (' + nUncat + ')'}</option>
          <optgroup label="One category">{cats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}</optgroup></select>
        <input className={inp} style={inpS} placeholder="Find (description or amount)" value={q} onChange={function (e) { setQ(e.target.value); }} />
        {canManage && <button onClick={applyRulesAsk} disabled={busy} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#ede9fe', '#5b21b6')}>📏 Apply rules to uncategorized</button>}
        {canManage && comp.key === 'nextrade' && <button onClick={function () { setBusy(true); api({ action: 'missing_bills' }).then(function (j) { if (!j || !j.ok) { toast.error((j && j.error) || 'Not done.'); setBusy(false); return; } if (!j.count) { toast.success('Every line in a "KTC pays this" category already has its KTC bill.'); setBusy(false); return; } if (!window.confirm(j.count + ' earlier line(s) are in a category KTC pays (e.g. Warehouse staff) but have no KTC bill yet. Make their KTC bills now (one per line, owed to Nextrade)?')) { setBusy(false); return; } api({ action: 'make_missing_bills' }).then(function (k) { if (k && k.ok) { toast.success(k.made + ' KTC bill(s) made' + (k.left - (k.payroll_left || 0) > 0 ? ' · ' + (k.left - (k.payroll_left || 0)) + ' left — press again' : '') + (k.note ? ' · ' + k.note : '')); } else { toast.error((k && k.error) || 'Not done.'); } loadLines(); }).finally(function () { setBusy(false); }); }); }} disabled={busy} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#dbeafe', '#1e3a8a')}>🧾 Make the missing KTC bills</button>}
        {comp.key === 'nextrade' && cutoff && cutoff.can_set && <button onClick={pressCutoff} disabled={busy || !cutoff.installed} title={cutoff.installed ? '' : 'Needs sql/v55-83-XN-nextrade-june-cutoff.sql run in Supabase first'} className="px-2 py-1 rounded text-[10px] font-extrabold" style={cutoff.on ? btn('#dcfce7', '#14532d') : btn('#fee2e2', '#7f1d1d')}>{cutoff.on ? '✓ No KTC bills before 1 June 2026 — ON (' + (cutoff.stopped || 0) + ' stopped) · turn off' : '⛔ Stop KTC bills from Nextrade lines before 1 June 2026' + (cutoff.would_stop ? ' (' + cutoff.would_stop + ')' : '')}</button>}
        <button onClick={function () { exportCsv([['date', 'account', 'description', 'in/out', 'amount', 'category', 'KTC bill']].concat(shown.map(function (l) { return [l.date, l.account_label, l.name, l.direction, l.payroll_restricted ? 'restricted' : l.amount_abs, l.company_category ? (catByKey[l.company_category] || {}).label || l.company_category : '', l.ktc_bill ? l.ktc_bill.mode : '']; })), comp.key + '-transactions-' + from + '-to-' + to + '.csv'); }} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#f0fdf4', '#166534')}>⬇ Export CSV</button>
        <span className="text-[10px]" style={{ color: '#64748b' }}>{shown.length} line(s)</span>
      </div>
      {canManage && ruleWait && ruleWait.would > 0 && <div className="flex gap-2 items-center flex-wrap mb-2 p-2 rounded" style={{ background: '#f5f3ff', border: '1px solid #c4b5fd', color: '#4c1d95' }}>
        <span className="text-[12px] font-bold">{'📏 ' + ruleWait.would + ' uncategorized transaction(s) in this date range match your rules' + (ruleWait.bills ? ' (' + ruleWait.bills + ' would make a KTC bill)' : '') + '.'}</span>
        <button onClick={applyRulesAsk} disabled={busy} className="px-2.5 py-1 rounded text-[11px] font-extrabold" style={{ background: '#5b21b6', color: '#ffffff' }}>📏 Apply rules…</button>
      </div>}
      {canManage && selIds.length > 0 && <div className="flex gap-2 items-center mb-2 p-2 rounded" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <span className="text-[11px] font-bold">{selIds.length} selected →</span>
        <select className={inp} style={inpS} value={bulkCat} onChange={function (e) { setBulkCat(e.target.value); }}><option value="">pick a category…</option>{activeCats.map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}<option value="__clear">✕ remove category (back to Uncategorized)</option></select>
        <button disabled={busy || !bulkCat} onClick={function () { setCategory(selIds, bulkCat === '__clear' ? null : bulkCat); setBulkCat(''); }} className="px-2 py-1 rounded text-[10px] font-extrabold" style={btn('#0f172a', '#ffffff')}>Save</button>
      </div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="w-full text-[13px]" style={{ color: '#0f172a' }}><thead><tr style={{ background: '#e2e8f0', color: '#1e293b' }}>
          <th className="p-1">{canManage && <input type="checkbox" checked={shown.length > 0 && shown.every(function (l) { return sel[l.id]; })} onChange={function (e) { var n = {}; if (e.target.checked) { shown.forEach(function (l) { n[l.id] = true; }); } setSel(n); }} />}</th>
          <th className="p-1 text-left">Date</th><th className="p-1 text-left">Account</th><th className="p-1 text-left">Description</th><th className="p-1 text-right">Amount</th><th className="p-1 text-left">Category</th>{comp.key === 'nextrade' && <th className="p-1 text-left">KTC bill &amp; P&amp;L</th>}</tr></thead>
          <tbody>{shown.map(function (l) {
            var panel = rowPanel && rowPanel.id === l.id ? rowPanel : null;
            return <React.Fragment key={l.id}><tr style={{ borderTop: '1px solid #e2e8f0', background: l.company_category ? '#f0fdf4' : '#ffffff' }}>
              <td className="p-1">{canManage && <input type="checkbox" disabled={l.pending === true} checked={!!sel[l.id] && l.pending !== true} onChange={function (e) { if (l.pending === true) { return; } var n = Object.assign({}, sel); n[l.id] = e.target.checked; setSel(n); }} />}</td>
              <td className="p-1 whitespace-nowrap">{l.date}{l.pending ? <div className="text-[10px] font-bold" style={{ color: isStalePending(l) ? '#b45309' : '#64748b' }}>{pendingLabel(l)}</div> : ''}</td>
              <td className="p-1 whitespace-nowrap">{l.is_card ? '💳 ' : '🏦 '}{l.account_label}{comp.key === 'nextrade' && NEXTRADE_SOURCE_LABELS[l.source] && <div className="text-[10px]" style={{ color: '#475569' }}>{NEXTRADE_SOURCE_LABELS[l.source]}</div>}</td>
              <td className="p-1">{l.name}{canManage && !l.company_category && !l.pending && !l.transfer_group_id && <div><button disabled={busy} onClick={function () { openRule(l); }} className="mt-1 text-[10px] font-bold underline" style={{ color: '#5b21b6' }}>Create rule</button></div>}</td>
              <td className="p-1 text-right whitespace-nowrap font-bold" style={{ color: l.direction === 'in' ? '#166534' : '#991b1b' }}>{l.payroll_restricted ? <span title="Payroll amount restricted — needs the Payroll / salaries: view switch" style={{ color: '#64748b' }}>🔒 payroll</span> : <>{l.direction === 'in' ? '+' : '−'}{fmt(l.amount_abs)}</>}</td>
              <td className="p-1">
                {l.transfer_group_id
                  ? <span className="text-[12px] font-bold" style={{ color: '#1e40af' }}>↔ {(catByKey[l.company_category] || {}).label || 'Transfer'}{l.transfer_with ? <span className="font-normal" style={{ color: '#334155' }}> · {l.transfer_with.private ? 'with a private account' : 'with ' + l.transfer_with.account_label + ', ' + l.transfer_with.date}</span> : null}{canManage ? <button onClick={function () { unpair(l); }} disabled={busy} className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#fee2e2', color: '#991b1b' }}>Unpair</button> : null}</span>
                  : l.category_split?.length ? <div className="space-y-0.5">
                      {l.category_split.map(part => <div key={part.category}>{(catByKey[part.category] || {}).label || part.category} · {'$' + fmt(part.cents / 100)}
                        {part.include_ktc === false && <span className="text-[10px]"> · Excluded from KTC P&amp;L</span>}</div>)}
                    </div>
                  : canManage
                    ? <span className="inline-flex items-center gap-1"><select className={inp} style={inpS} value={l.company_category || ''} disabled={busy || l.pending === true} onChange={function (e) { if (e.target.value === '__new') { setRowPanel({ id: l.id, mode: 'newcat', label: '', direction: l.direction, kind: l.direction === 'in' ? 'income' : 'expense', is_payroll: false }); return; } setCategory([l.id], e.target.value || null); }}><option value="">— not categorized —</option>{catsFor(l).map(function (c) { return <option key={c.key} value={c.key}>{c.label}</option>; })}<option value="__new">➕ New category…</option></select>
                      <button onClick={function () { openTransfer(l, false, ''); }} disabled={busy} title="This is money moving between two of the company's own accounts (or paying its credit card): find the other side and pair them as ONE transfer — never income or spending" className="px-1.5 py-0.5 rounded text-[11px] font-bold" style={{ background: '#dbeafe', color: '#1e40af' }}>↔</button></span>
                    : ((catByKey[l.company_category] || {}).label || '—')}
                {l.company_category_source === 'rule' ? <span className="ml-1 text-[9px]" style={{ color: '#6d28d9' }}>📏 rule</span> : null}
                {comp.key === 'nextrade' && canManage && l.ktc_bill && !l.payroll_restricted && !l.pending && !l.transfer_group_id &&
                  l.direction === 'out' && (l.bill_split_stale || l.category_split?.length || canSplitInto(catByKey[l.company_category])) &&
                  <button type="button" disabled={busy} className="block text-[11px] font-bold underline" style={{ color: '#1d4ed8' }}
                    onClick={() => setRowPanel({ id: l.id, mode: 'bill_split' })}>{l.category_split?.length || l.bill_split_stale ? 'Edit split' : 'Split categories'}</button>}</td>
              {comp.key === 'nextrade' && <td className="p-1 text-[10px]">{l.ktc_bill ? KTC_BILL_WORDS[l.ktc_bill.mode] || '' : ''}
                {l.ktc_bill && l.company_category ? (canManage
                  ? <select aria-label="KTC category mapping" className={inp + ' ml-1'} style={Object.assign({}, inpS, ktc.map[l.company_category] ? {} : { borderColor: '#d97706', background: '#fffbeb' })} disabled={busy} value={ktc.map[l.company_category] || ''} title="KTC category shared by bills that follow this Nextrade category’s mapping." onChange={function (e) { pickKtcCategory(l.company_category, e.target.value); }}>
                      <option value="">KTC category — not set</option>{ktc.cats.map(function (k) { return <option key={k.key} value={k.key}>{'KTC: ' + k.label}</option>; })}{canCreateKtcCategory && <option value="__new">Create KTC category…</option>}</select>
                  : <span className="ml-1" style={{ color: '#475569' }}>{ktc.map[l.company_category] ? 'KTC: ' + ((ktc.cats.filter(function (k) { return k.key === ktc.map[l.company_category]; })[0] || {}).label || ktc.map[l.company_category]) : 'KTC category not set'}</span>) : null}
                {typeof l.ktc_pnl_excluded === 'boolean' && (canManage
                  ? <fieldset disabled={busy} className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px]" aria-label={'KTC P&L for ' + l.name + ' on ' + l.date}>
                      <legend className="font-semibold">KTC P&amp;L</legend>
                      <label className="inline-flex items-center gap-1"><input type="radio" name={'ktc-pnl-' + l.id} checked={!l.ktc_pnl_excluded} onChange={() => setKtcPnlChoice(l, false)} /> Include</label>
                      <label className="inline-flex items-center gap-1"><input type="radio" name={'ktc-pnl-' + l.id} checked={l.ktc_pnl_excluded} onChange={() => setKtcPnlChoice(l, true)} /> Exclude</label>
                    </fieldset>
                  : <div className="mt-1 text-[11px]">{l.ktc_pnl_excluded ? 'Excluded from KTC P&L' : 'Included in KTC P&L'}</div>)}</td>}
            </tr>
            {ruleForm && ruleForm.lineId === l.id && <tr><td colSpan={comp.key === 'nextrade' ? 7 : 6} className="p-2">{renderRuleForm()}</td></tr>}
            {panel?.mode === 'bill_split' && <tr><td colSpan={7} className="p-2"><NextradeBillSplitEditor line={l} categories={cats} busy={busy}
              onSave={allocations => saveBillSplit(l, allocations)} onCancel={() => setRowPanel(null)} /></td></tr>}
            {panel && panel.mode === 'newcat' && <tr><td colSpan={comp.key === 'nextrade' ? 7 : 6} className="p-2" style={{ background: '#f8fafc' }}>
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-[11px] font-extrabold">➕ New category for this line:</span>
                <input autoFocus className={inp} style={inpS} placeholder="Name (e.g. Electricity)" value={panel.label} onChange={function (e) { setRowPanel(Object.assign({}, panel, { label: e.target.value })); }} />
                <select className={inp} style={inpS} value={panel.direction} onChange={function (e) { setRowPanel(Object.assign({}, panel, { direction: e.target.value })); }}><option value="out">Money out only</option><option value="in">Money in only</option><option value="any">Money in or out</option></select>
                <select className={inp} style={inpS} value={panel.kind} onChange={function (e) { setRowPanel(Object.assign({}, panel, { kind: e.target.value })); }}>{Object.keys(kinds).map(function (k) { return <option key={k} value={k}>{kinds[k]}</option>; })}</select>
                {panel.kind === 'expense' && <label className="text-[10px] font-bold"><input type="checkbox" checked={panel.is_payroll === true} onChange={function (e) { setRowPanel(Object.assign({}, panel, { is_payroll: e.target.checked })); }} /> payroll</label>}
                {comp.key === 'nextrade' && panel.direction !== 'in' && <select className={inp} style={inpS} title="Does KTC pay this? Yes = each line makes a KTC bill (owed to Nextrade)" value={panel.makes_ktc_bill === true ? 'yes' : panel.makes_ktc_bill === false ? 'no' : 'usual'} onChange={function (e) { setRowPanel(Object.assign({}, panel, { makes_ktc_bill: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null })); }}><option value="usual">KTC pays this? usual rule (expenses yes, payroll no)</option><option value="yes">KTC pays this — make a KTC bill</option><option value="no">KTC does not pay this — no bill</option></select>}
                <button disabled={busy || String(panel.label).trim().length < 2} onClick={function () { addCategoryForLine(l, panel); }} className="px-2 py-1 rounded text-[10px] font-extrabold" style={{ background: '#0f172a', color: '#ffffff' }}>💾 Save and use it</button>
                <button onClick={function () { setRowPanel(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Cancel</button>
              </div></td></tr>}
            {panel && panel.mode === 'transfer' && <tr><td colSpan={comp.key === 'nextrade' ? 7 : 6} className="p-2" style={{ background: '#eff6ff' }}>
              <div className="text-[11px] font-extrabold mb-1" style={{ color: '#1e3a8a' }}>↔ The other side of this transfer — money {l.direction === 'out' ? 'IN' : 'OUT'} of another {comp.label} account{panel.manual ? ' (any amount, 90 days)' : ', same amount, within 10 days'}:</div>
              {panel.loading ? <div className="text-[11px]">Looking…</div> : null}
              {!panel.loading && !panel.cands.length && <div className="text-[11px]" style={{ color: '#475569' }}>Nothing found. Is the other account connected? Try searching wider:</div>}
              {panel.cands.map(function (c) { return <div key={c.id} className="flex items-center gap-2 text-[12px] py-0.5" style={{ borderTop: '1px solid #dbeafe' }}>
                <span className="whitespace-nowrap">{c.date}</span><span className="whitespace-nowrap">{c.is_card ? '💳 ' : '🏦 '}{c.account_label}</span><span>{c.name}</span>
                <span className="font-bold whitespace-nowrap" style={{ color: c.direction === 'in' ? '#166534' : '#991b1b' }}>{c.direction === 'in' ? '+' : '−'}{fmt(c.amount_abs)}</span>{!c.same_amount ? <span className="text-[10px]" style={{ color: '#b45309' }}>different amount</span> : null}
                <div className="flex-1" /><button disabled={busy || !c.same_amount} onClick={function () { pair(l, c); }} className="px-2 py-0.5 rounded text-[10px] font-extrabold" style={{ background: '#1e40af', color: '#ffffff', opacity: c.same_amount ? 1 : 0.4 }}>Pair as transfer</button></div>; })}
              <div className="flex gap-2 items-center mt-2">
                <input className={inp} style={inpS} placeholder="Search other lines (text or amount)" value={panel.q} onChange={function (e) { setRowPanel(Object.assign({}, panel, { q: e.target.value })); }} />
                <button disabled={busy} onClick={function () { openTransfer(l, true, panel.q); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#dbeafe', color: '#1e40af' }}>Search wider (90 days)</button>
                <button onClick={function () { setRowPanel(null); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: '#f1f5f9', color: '#334155' }}>Close</button>
              </div>
              <div className="text-[10px] mt-1" style={{ color: '#475569' }}>Only the same amount can be paired (like KTC). Money to or from KTC or RTM is not a transfer between {comp.label}'s own accounts — use “Money from KTC”.</div>
            </td></tr>}
            </React.Fragment>;
          })}</tbody></table>
      </div>
      {lines && !shown.length && <div className="text-[11px] mt-2" style={{ color: '#64748b' }}>Nothing to show for these dates and filters.</div>}
    </div>}

    {view === 'tax_report' && <NextradeTaxReport api={api} exportCsv={exportCsv} categoryBusy={busy}
      categoriesFor={catsFor} onCategoryChange={canManage ? setCategory : null} onReview={function (start, end) {
      setFrom(start); setTo(end); setShow('uncat'); setQ(''); setView('lines');
      loadLines(start, end); loadAccounts();
    }} />}

    {view === 'totals' && totals && <div>
      <div className="flex gap-3 flex-wrap mb-2 text-[11px]">
        {totals.excludes_payroll && <span className="font-bold px-2 rounded" style={{ background: '#fef3c7', color: '#92400e' }}>🔒 WITHOUT payroll — these are not the full totals</span>}
        <span>Money in: <b style={{ color: '#166534' }}>{fmt(totals.inTotal)}</b></span><span>Money out{totals.excludes_payroll ? ' (without payroll)' : ''}: <b style={{ color: '#991b1b' }}>{fmt(totals.outTotal)}</b></span>
        <span>Transfers in: <b>{fmt(totals.transfersIn)}</b></span><span>Transfers out: <b>{fmt(totals.transfersOut)}</b></span>
        <button onClick={function () { exportCsv([['category', 'kind'].concat(totals.months).concat(['total'])].concat(totals.rows.map(function (r) { return r.payroll_restricted ? [r.label, r.kind].concat(totals.months.map(function () { return 'restricted'; })).concat(['restricted']) : [r.label, r.kind].concat(totals.months.map(function (m) { return r.byMonth[m] || 0; })).concat([r.total]); }).concat(totals.excludes_payroll ? [['TOTALS ABOVE EXCLUDE PAYROLL']] : [])), comp.key + '-totals-' + totals.from + '-to-' + totals.to + '.csv'); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#f0fdf4', '#166534')}>⬇ Export CSV</button>
      </div>
      <div className="text-[10px] mb-1" style={{ color: '#64748b' }}>Transfers (own money moving, money from KTC, card payments) are listed but never counted as income or spending.</div>
      <CompanyTotalsReport totals={totals} api={api} categoriesFor={catsFor} categoryBusy={busy || !!err}
        onCategoryChange={canManage ? setCategory : null} refreshTotals={loadTotals} />
    </div>}

    {view === 'categories' && <div>
      {canManage && !catForm && <button onClick={function () { setCatForm({ label: '', kind: 'expense', is_payroll: false, sort: 100, direction: 'out' }); }} className="px-2 py-1 rounded text-[11px] font-extrabold mb-2" style={btn('#0f172a', '#ffffff')}>➕ New category</button>}
      {catForm && <div className="flex gap-2 items-center flex-wrap mb-2 p-2 rounded" style={{ background: '#f8fafc', border: '1px solid #cbd5e1' }}>
        <input className={inp} style={inpS} placeholder="Name (e.g. Electricity)" value={catForm.label} onChange={function (e) { setCatForm(Object.assign({}, catForm, { label: e.target.value })); }} />
        <select className={inp} style={inpS} value={catForm.direction || 'any'} onChange={function (e) { setCatForm(Object.assign({}, catForm, { direction: e.target.value })); }}><option value="out">Money out only</option><option value="in">Money in only</option><option value="any">Money in or out</option></select>
        <select className={inp} style={inpS} value={catForm.kind} onChange={function (e) { setCatForm(Object.assign({}, catForm, { kind: e.target.value })); }}>{Object.keys(kinds).map(function (k) { return <option key={k} value={k}>{kinds[k]}</option>; })}</select>
        {catForm.kind === 'expense' && <label className="text-[10px] font-bold"><input type="checkbox" checked={catForm.is_payroll === true} onChange={function (e) { setCatForm(Object.assign({}, catForm, { is_payroll: e.target.checked })); }} /> payroll (shown as "Warehouse staff")</label>}
        {comp.key === 'nextrade' && catForm.direction !== 'in' && <select className={inp} style={inpS} title="Does KTC pay this? Yes = each line makes a KTC bill (owed to Nextrade)" value={catForm.makes_ktc_bill === true ? 'yes' : catForm.makes_ktc_bill === false ? 'no' : 'usual'} onChange={function (e) { setCatForm(Object.assign({}, catForm, { makes_ktc_bill: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null })); }}><option value="usual">KTC pays this? usual rule (expenses yes, payroll no)</option><option value="yes">KTC pays this — make a KTC bill</option><option value="no">KTC does not pay this — no bill</option></select>}
        <button disabled={busy} onClick={function () { setBusy(true); api({ action: 'save_category', category: catForm }).then(function (j) { if (j && j.ok) { toast.success('Saved' + (j.note ? ' — ' + j.note : '')); setCatForm(null); loadCats(); } else { toast.error((j && j.error) || 'Not saved.'); } }).finally(function () { setBusy(false); }); }} className="px-2 py-1 rounded text-[10px] font-extrabold" style={btn('#0f172a', '#ffffff')}>💾 Save</button>
        <button onClick={function () { setCatForm(null); }} className="px-2 py-1 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>Cancel</button>
      </div>}
      {cats.map(function (c) { return <div key={c.key} className="flex items-center gap-2 text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0', opacity: c.active ? 1 : 0.5 }}>
        <span className="font-bold">{c.label}</span><span style={{ color: '#64748b' }}>{DIR_WORDS[c.direction || 'any']} · {kinds[c.kind] || c.kind}{c.is_payroll ? ' · payroll' : ''}{comp.key === 'nextrade' && c.makes_ktc_bill === true ? ' · KTC pays this (KTC bill)' : ''}{comp.key === 'nextrade' && c.makes_ktc_bill === false ? ' · no KTC bill' : ''}{c.active ? '' : ' · switched off'}</span><div className="flex-1" />
        {canManage && <button onClick={function () { setCatForm({ id: c.id, label: c.label, kind: c.kind, is_payroll: c.is_payroll, sort: c.sort, direction: c.direction || 'any', makes_ktc_bill: c.makes_ktc_bill === true ? true : c.makes_ktc_bill === false ? false : null }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#eff6ff', '#1d4ed8')}>✏ Edit</button>}
        {canManage && <button onClick={function () { api({ action: 'category_active', id: c.id, active: !c.active }).then(function (j) { if (j && j.ok) { loadCats(); } else { toast.error((j && j.error) || 'Not saved.'); } }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>{c.active ? 'Switch off' : 'Switch on'}</button>}
      </div>; })}
    </div>}

    {view === 'rules' && <div>
      {canManage && (!ruleForm || ruleForm.lineId) && <button onClick={function () { setRuleForm({ match_text: '', match_mode: comp.key === 'nextrade' ? ALL_KEYWORDS_MATCH : PHRASE_MATCH, category_key: '', direction: 'any' }); }} className="px-2 py-1 rounded text-[11px] font-extrabold mb-2" style={btn('#0f172a', '#ffffff')}>➕ New rule</button>}
      {canManage && ruleForm && !ruleForm.lineId && renderRuleForm()}
      {(rules || []).map(function (r) { return <div key={r.id} className="flex items-center gap-2 text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0', opacity: r.active ? 1 : 0.5 }}>
        <span>{ruleMatchLabel(r)}{r.direction !== 'any' ? ' (money ' + r.direction + ')' : ''} → <b>{(catByKey[r.category_key] || {}).label || r.category_key}</b></span><span style={{ color: '#64748b' }}>used {r.hit_count || 0}×</span><div className="flex-1" />
        {canManage && <button onClick={function () { setRuleForm({ id: r.id, match_text: r.match_text, match_mode: r.match_mode, category_key: r.category_key, direction: r.direction }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#eff6ff', '#1d4ed8')}>✏ Edit</button>}
        {canManage && <button onClick={function () { api({ action: 'rule_active', id: r.id, active: !r.active }).then(function (j) { if (j && j.ok) { loadView('rules'); } else { toast.error((j && j.error) || 'Not saved.'); } }); }} className="px-2 py-0.5 rounded text-[10px] font-bold" style={btn('#f1f5f9', '#334155')}>{r.active ? 'Switch off' : 'Switch on'}</button>}
      </div>; })}
      {rules && !rules.length && <div className="text-[11px]" style={{ color: '#64748b' }}>No rules yet.</div>}
    </div>}

    {view === 'accounts' && <div>
      <div className="text-[11px] mb-2 p-2 rounded" style={{ background: '#eff6ff', color: '#1e3a8a' }}>
        <b>Connect a {comp.label} bank account or credit card (Plaid):</b> Bank (top menu) → 🔗 Connect a bank → when asked which books, pick <b>{comp.label}</b> → sign in to the bank in the Plaid window → choose the accounts and cards. They then show here and update every 2 hours.
        <br /><b>Or from a statement file:</b> below → ➕ add the account (Company = {comp.label}, Bank account or Credit card) → import its CSV.
      </div>
      {(accounts || []).map(function (a) { return <div key={a.plaid_account_id} className="text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0' }}>
        {a.is_card ? '💳 Credit card' : '🏦 Bank'} · <b>{a.institution || ''} {a.name}</b>{a.mask ? ' ••' + a.mask : ''}
        {a.feed_type === 'statement' ? ' · Statement imports (CSV or PDF)' : a.feed_type === 'plaid' ? ' · Plaid automatic feed' : ' · No connected feed'}
        {a.feed_type === 'plaid' && a.last_synced && ' · Latest pull ' + new Date(a.last_synced).toLocaleString()}
        {a.last_sync_status === 'error' && ' · Sync failed'}
        {a.last_sync_status === 'preparing' && ' · Bank is preparing transactions'}
        {a.last_sync_status === 'partial' && ' · Sync needs review'}
      </div>; })}
      {accounts && !accounts.length && <div className="text-[11px]" style={{ color: '#64748b' }}>No {comp.label} accounts yet.</div>}
      <div className="mt-3"><StatementImport userProfile={userProfile} canUse={canManage} companyId={comp.id} /></div>
    </div>}

    {view === 'mapping' && mapping && <div>
      <div className="text-[11px] mb-2" style={{ color: '#475569' }}>Choose the KTC category for new bills and existing bills that follow this Nextrade mapping.</div>
      {(mapping.rows || []).filter(function (c) { return ['expense', 'cogs', 'other_expense'].indexOf(c.kind) >= 0; }).map(function (c) { return <div key={c.key} className="flex items-center gap-2 text-[11px] py-1" style={{ borderTop: '1px solid #e2e8f0' }}>
        <span className="font-bold" style={{ minWidth: 200 }}>{c.label}</span>
        {(typeof c.makes_ktc_bill === 'boolean' ? !c.makes_ktc_bill : c.is_payroll) ? <span style={{ color: '#64748b' }}>no KTC bill for this category (Categories → ✏ Edit → "KTC pays this" to change)</span>
          : <select aria-label={'KTC category for ' + c.label} className={inp} style={inpS} disabled={!canManage || busy} value={c.ktc_category || ''} onChange={function (e) { pickKtcCategory(c.key, e.target.value); }}>
            <option value="">— KTC category not set —</option>{(mapping.ktc_categories || []).map(function (k) { return <option key={k.key} value={k.key}>{k.label}</option>; })}{canCreateKtcCategory && <option value="__new">Create KTC category…</option>}</select>}
      </div>; })}
    </div>}
  </div>;
}
