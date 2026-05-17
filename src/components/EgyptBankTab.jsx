'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import * as XLSX from 'xlsx';
import { EXPENSE_CATS } from '../lib/utils';
import { todayET } from '../lib/et-time';

export default function EgyptBankTab({ toast, user, userProfile, isAdmin, invoices, onReload, recalcInvoiceCollected }) {
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('transactions'); // transactions | accounts | import
  const [selAccount, setSelAccount] = useState('all');
  const [matchFilter, setMatchFilter] = useState('all'); // all | unmatched | matched
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [selectedTxns, setSelectedTxns] = useState(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [matchingTxn, setMatchingTxn] = useState(null);
  const [amtTolerance, setAmtTolerance] = useState(0); // 0 = exact, or percentage
  const [dayFrom, setDayFrom] = useState('');
  const [dayTo, setDayTo] = useState('');
  const [showSmartConfig, setShowSmartConfig] = useState(false);
  const [searchInv, setSearchInv] = useState('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accForm, setAccForm] = useState({ bank_name: '', account_number: '', account_name: '', currency: 'EGP' });
  const [importStep, setImportStep] = useState('select'); // select | preview | importing | done
  const [importData, setImportData] = useState([]);
  const [importAccount, setImportAccount] = useState('');
  const [importStats, setImportStats] = useState(null);
  // v55.83-A.6.15 (Max May 14 2026) — Bulk delete modal state
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteAccountId, setBulkDeleteAccountId] = useState('');
  const [bulkDeleteFrom, setBulkDeleteFrom] = useState('');
  const [bulkDeleteTo, setBulkDeleteTo] = useState('');
  const [bulkDeleteReason, setBulkDeleteReason] = useState('');
  const [bulkDeleteImpact, setBulkDeleteImpact] = useState(null); // {count, sum, invoices, treasury_rows}
  const [bulkDeleteWorking, setBulkDeleteWorking] = useState(false);

  const myId = userProfile?.id || user?.id;
  const isSuperAdmin = userProfile?.role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: acc }, { data: txn }] = await Promise.all([
      supabase.from('egypt_bank_accounts').select('*').order('bank_name'),
      supabase.from('egypt_bank_transactions').select('*').order('date', { ascending: false }).limit(2000),
    ]);
    setAccounts(acc || []);
    setTransactions(txn || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ───── Account CRUD ─────
  const saveAccount = async () => {
    if (!accForm.bank_name || !accForm.account_number) { alert('Bank name and account number required'); return; }
    if (accForm.id) {
      await dbUpdate('egypt_bank_accounts', accForm.id, accForm, myId);
    } else {
      await dbInsert('egypt_bank_accounts', accForm, myId);
    }
    setAccForm({ bank_name: '', account_number: '', account_name: '', currency: 'EGP' });
    setShowAddAccount(false);
    load();
  };
  const deleteAccount = async (id) => {
    if (!confirm('Delete this account and all its transactions?')) return;
    await supabase.from('egypt_bank_transactions').delete().eq('account_id', id);
    await dbDelete('egypt_bank_accounts', id, myId);
    load();
  };

  // ───── Import ─────
  const handleFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    let allParsed = [];
    for (const file of files) {
      const parsed = await parseOneFile(file);
      allParsed = [...allParsed, ...parsed];
    }
    if (allParsed.length === 0) {
      alert('No transactions found in ' + files.length + ' file(s). Check column format.');
      return;
    }
    // Re-number rows
    allParsed = allParsed.map((t, i) => ({ ...t, _row: i + 1 }));
    setImportData(allParsed);
    setImportStep('preview');
  };

  const parseOneFile = async (file) => {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Read as 2D array — works reliably for both .xls and .xlsx
    const rawGrid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const grid = rawGrid.map(row => (row || []).map(v => String(v ?? '').trim()));

    // Parse bank date format: 03FEB25 → 2025-02-03
    const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    const parseBankDate = (v) => {
      if (!v) return '';
      const s = String(v).trim();
      // DDMonYY/DDMONYYYY (03FEB25, 03FEB2025)
      const m1 = s.match(/(\d{1,2})([A-Z]{3})(\d{2,4})/i);
      if (m1) {
        const day = m1[1].padStart(2, '0');
        const mon = MONTHS[(m1[2] || '').toUpperCase()] || '01';
        let yr = m1[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
        return `${yr}-${mon}-${day}`;
      }
      // YYYY-MM-DD
      const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m2) return `${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`;
      // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
      const m3 = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
      if (m3) return `${m3[3]}-${m3[2].padStart(2,'0')}-${m3[1].padStart(2,'0')}`;
      // MM/DD/YYYY (American format — detect by month > 12)
      const m4 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (m4 && parseInt(m4[1]) <= 12 && parseInt(m4[2]) > 12) return `${m4[3]}-${m4[1].padStart(2,'0')}-${m4[2].padStart(2,'0')}`;
      // Excel serial number
      const num = parseFloat(s);
      if (!isNaN(num) && num > 30000 && num < 60000) {
        const d = new Date((num - 25569) * 86400000);
        return isNaN(d.getTime()) ? '' : d.toISOString().substring(0, 10);
      }
      // Try native Date parse
      const d = new Date(s);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
        return d.toISOString().substring(0, 10);
      }
      return '';
    };

    const parseAmt = (v) => {
      if (!v) return 0;
      return parseFloat(String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, '')) || 0;
    };

    // Strategy 1: Detect sparse bank statement format (dates scattered, amounts in various columns)
    // Helper: is this a formatted number like "280,000.00" or "15,171,688.70"?
    const looksLikeNumber = (v) => /^[\d,.\s\-]+$/.test(String(v).trim()) && parseAmt(v) !== 0;
    // Helper: does this contain letters (actual text)?
    const hasLetters = (v) => /[a-zA-Z\u0600-\u06FF]/.test(String(v));

    // Find which column has dates by scanning first 50 rows
    let sparseDateCol = -1;
    for (let c = 0; c < Math.min(10, grid[0]?.length || 0); c++) {
      let dateCount = 0;
      for (let r = 0; r < Math.min(50, grid.length); r++) {
        if (grid[r][c] && parseBankDate(grid[r][c])) dateCount++;
      }
      if (dateCount >= 3) { sparseDateCol = c; break; }
    }

    if (sparseDateCol >= 0) {
      console.warn('📊 Detected sparse bank statement, date column:', sparseDateCol);
      
      // Find description column (column with most cells containing LETTERS)
      let sparseDescCol = -1, maxText = 0;
      for (let c = 0; c < (grid[0]?.length || 0); c++) {
        if (c === sparseDateCol) continue;
        let textCount = 0;
        for (let r = 0; r < Math.min(80, grid.length); r++) {
          const v = grid[r][c];
          if (v && v.length > 3 && hasLetters(v)) textCount++;
        }
        if (textCount > maxText) { maxText = textCount; sparseDescCol = c; }
      }
      
      // Detect amount columns
      const amtCols = {};
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (c === sparseDateCol || c === sparseDescCol) continue;
          const v = String(grid[r][c]).trim().replace(/\s*(CR|DR)\s*$/i, '');
          if (v && /^[\d,.\s\-]+$/.test(v) && parseAmt(v) !== 0) {
            amtCols[c] = (amtCols[c] || 0) + 1;
          }
        }
      }
      
      // Sort amount columns by position (left to right)
      const sortedAmtCols = Object.entries(amtCols).filter(([c, n]) => n >= 3).map(([c]) => parseInt(c)).sort((a, b) => a - b);
      // Standard bank layout: DEBIT (left) | CREDIT (middle) | BALANCE (right)
      let debitCol = -1, creditCol = -1, balCol = -1;
      if (sortedAmtCols.length >= 3) {
        debitCol = sortedAmtCols[0];
        creditCol = sortedAmtCols[1];
        balCol = sortedAmtCols[2];
      } else if (sortedAmtCols.length === 2) {
        creditCol = sortedAmtCols[0];
        balCol = sortedAmtCols[1];
      } else if (sortedAmtCols.length === 1) {
        creditCol = sortedAmtCols[0];
      }
      console.warn('Columns — date:', sparseDateCol, 'desc:', sparseDescCol, 'debit:', debitCol, 'credit:', creditCol, 'balance:', balCol);

      // Group rows into transactions
      const transactions = [];
      let current = null;
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        const dateStr = parseBankDate(row[sparseDateCol]);
        const desc = sparseDescCol >= 0 ? (row[sparseDescCol] || '').trim() : '';
        const cr = creditCol >= 0 ? parseAmt(row[creditCol]) : 0;
        const dr = debitCol >= 0 ? parseAmt(row[debitCol]) : 0;
        const amount = cr > 0 ? cr : (dr > 0 ? -dr : 0);

        if (dateStr) {
          if (current) transactions.push(current);
          current = { date: dateStr, description: desc, amount, _include: true };
        } else if (current && desc && !desc.includes('OPENING BALANCE') && !desc.includes('CLOSING BALANCE')) {
          current.description += ' ' + desc;
          if (current.amount === 0 && amount !== 0) current.amount = amount;
        }
      }
      if (current) transactions.push(current);

      const parsed = transactions
        .filter(t => !t.description.includes('OPENING BALANCE') && !t.description.includes('CLOSING BALANCE'))
        .filter(t => t.amount !== 0)
        .map((t, i) => ({ ...t, _row: i + 1, description: t.description.replace(/\s+/g, ' ').trim() }));

      if (parsed.length > 0) {
        return parsed;
      }
    }

    // Strategy 2: Regular tabular format with headers
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) { alert('No data found'); return; }

    const cols = Object.keys(rows[0]);
    const find2 = (keywords) => cols.find(c => keywords.some(k => c.toLowerCase().includes(k.toLowerCase())));
    const tblDateCol = find2(['date', 'تاريخ', 'DATE', 'Transaction Date', 'Value Date']) || cols[0];
    const tblDescCol = find2(['desc', 'بيان', 'narr', 'detail', 'memo', 'reference', 'الوصف', 'البيان', 'particular', 'transaction']) || cols[1];
    const amountCol = find2(['amount', 'مبلغ', 'value', 'المبلغ', 'net', 'total']);
    const creditColName = find2(['credit', 'دائن', 'إيداع', 'deposit', 'cr', 'in']);
    const debitColName = find2(['debit', 'مدين', 'سحب', 'withdrawal', 'dr', 'out']);

    // Fallback: if no amount column found, find any column with numbers
    let fallbackAmtCol = null;
    if (!amountCol && !creditColName && !debitColName) {
      for (const c of cols) {
        if (c === tblDateCol || c === tblDescCol) continue;
        const hasNums = rows.filter(r => parseAmt(r[c]) !== 0).length;
        if (hasNums >= rows.length * 0.3) { fallbackAmtCol = c; break; }
      }
    }

    const parsed = rows.map((r, i) => {
      let date = parseBankDate(r[tblDateCol]);

      let amount = 0;
      if (amountCol) {
        amount = parseAmt(r[amountCol]);
      } else if (creditColName && debitColName) {
        const cr = parseAmt(r[creditColName]);
        const db = parseAmt(r[debitColName]);
        amount = cr > 0 ? cr : -db;
      } else if (creditColName) {
        amount = parseAmt(r[creditColName]);
      } else if (debitColName) {
        amount = -parseAmt(r[debitColName]);
      } else if (fallbackAmtCol) {
        amount = parseAmt(r[fallbackAmtCol]);
      }

      return {
        _row: i + 1,
        date,
        description: String(r[tblDescCol] || '').trim(),
        amount,
        _include: true,
      };
    }).filter(r => r.date && r.amount !== 0);

    if (parsed.length === 0) {
      // Show diagnostic: what columns were found and sample data
      const sample = rows.slice(0, 3).map(r => JSON.stringify(r).substring(0, 200));
      alert(
        'No transactions detected.\n\n' +
        'Columns found: ' + cols.join(', ') + '\n\n' +
        'Date column: ' + (tblDateCol || 'none') + '\n' +
        'Description column: ' + (tblDescCol || 'none') + '\n' +
        'Amount column: ' + (amountCol || creditColName || debitColName || 'none') + '\n\n' +
        'Sample row: ' + (sample[0] || 'empty') + '\n\n' +
        'Tip: Make sure your file has columns named Date, Description, and Amount (or Credit/Debit).'
      );
      return [];
    }

    return parsed;
  };

  // v55.83-A.6.14 (Max May 14 2026) — TWO-STAGE IMPORT with duplicate review.
  //
  // Old import had a critical bug: the duplicate check filtered by account_id.
  // Importing the same bank statement to two different accounts bypassed dedup
  // entirely, creating duplicate rows that propagated downstream into treasury
  // and invoice totals (see post-mortem: ~100 duplicate rows across 6 invoices,
  // ~163K EGP fake overpayment money).
  //
  // New flow:
  //   1. Pre-scan all rows against ENTIRE bank table (every account)
  //   2. Classify each row: clean / exact-duplicate / possible-duplicate
  //   3. If any non-clean rows, show review UI; user decides per row
  //   4. Only after user confirms, write the approved rows
  //   5. Audit log every override decision (who, when, why)
  //
  // Three classifications:
  //   • CLEAN: no match anywhere → imported automatically
  //   • EXACT: same date + amount + (first 60 chars of) description in ANY
  //     account → auto-skipped (with override-all option for edge cases)
  //   • POSSIBLE: same amount + adjacent date (±2 days) OR same amount + same
  //     date in different account but slightly different description →
  //     shown for per-row decision
  const classifyDuplicates = async (toImport, accId) => {
    // Load ALL existing transactions across ALL accounts (was the original bug).
    var allExisting = [];
    var pageSize = 1000;
    var from = 0;
    while (true) {
      var resp = await supabase.from('egypt_bank_transactions')
        .select('id, date, description, amount, account_id')
        .range(from, from + pageSize - 1);
      if (resp.error || !resp.data || resp.data.length === 0) break;
      allExisting = allExisting.concat(resp.data);
      if (resp.data.length < pageSize) break;
      from += pageSize;
    }
    // Build lookup index: key = date|amount|desc60, value = list of existing rows
    var exactIndex = {};
    var amountDateIndex = {}; // key = date|amount (for cross-description match)
    allExisting.forEach(function (e) {
      var dsc60 = (e.description || '').substring(0, 60).trim().toLowerCase();
      var key = e.date + '|' + e.amount + '|' + dsc60;
      if (!exactIndex[key]) exactIndex[key] = [];
      exactIndex[key].push(e);
      var ak = e.date + '|' + e.amount;
      if (!amountDateIndex[ak]) amountDateIndex[ak] = [];
      amountDateIndex[ak].push(e);
    });

    var classified = toImport.map(function (row) {
      var dsc60 = (row.description || '').substring(0, 60).trim().toLowerCase();
      var key = row.date + '|' + row.amount + '|' + dsc60;
      var exactMatches = exactIndex[key] || [];
      if (exactMatches.length > 0) {
        return { row: row, status: 'exact', matches: exactMatches, decision: 'skip' };
      }
      // Same date + amount but different description?
      var ak = row.date + '|' + row.amount;
      var sameDayAmount = (amountDateIndex[ak] || []).filter(function (e) {
        var edsc = (e.description || '').substring(0, 60).trim().toLowerCase();
        return edsc !== dsc60;
      });
      if (sameDayAmount.length > 0) {
        return { row: row, status: 'possible', matches: sameDayAmount, decision: 'review' };
      }
      // Adjacent date (±2 days), same amount, similar description?
      var rowDate = new Date(row.date);
      var nearMatches = allExisting.filter(function (e) {
        if (e.amount !== row.amount) return false;
        var ed = new Date(e.date);
        var diffDays = Math.abs((ed - rowDate) / 86400000);
        if (diffDays > 2 || diffDays === 0) return false;
        var edsc = (e.description || '').substring(0, 40).trim().toLowerCase();
        var rdsc = (row.description || '').substring(0, 40).trim().toLowerCase();
        // Both strings contain a common token longer than 6 chars
        if (edsc.length === 0 || rdsc.length === 0) return false;
        return edsc === rdsc || (edsc.length > 10 && rdsc.includes(edsc.substring(0, 10))) || (rdsc.length > 10 && edsc.includes(rdsc.substring(0, 10)));
      });
      if (nearMatches.length > 0) {
        return { row: row, status: 'possible', matches: nearMatches, decision: 'review' };
      }
      return { row: row, status: 'clean', matches: [], decision: 'import' };
    });
    return classified;
  };

  // State for the review step (v55.83-A.6.14)
  const [reviewClassified, setReviewClassified] = useState(null); // null = no review pending
  const [reviewOverrideAll, setReviewOverrideAll] = useState(false);

  const doImport = async () => {
    let accId = importAccount;
    if (!accId && accounts.length > 0) { accId = accounts[0].id; setImportAccount(accId); }
    if (!accId) {
      try {
        const { data: newAcc } = await dbInsert('egypt_bank_accounts', { bank_name: 'Default Bank', account_number: 'AUTO-001', currency: 'EGP' }, myId);
        if (newAcc) { accId = newAcc.id; setImportAccount(accId); }
      } catch(err) { alert('Create an account first / أنشئ حسابًا أولاً'); return; }
    }
    if (!accId) { alert('Select an account first / اختر حسابًا أولاً'); return; }
    const toImport = importData.filter(r => r._include);
    if (toImport.length === 0) { alert('No rows selected / لم يتم اختيار صفوف'); return; }

    setImportStep('analyzing');
    // v55.83-A.6.14 — classify before importing
    var classified = await classifyDuplicates(toImport, accId);
    var cleanCount = classified.filter(function (c) { return c.status === 'clean'; }).length;
    var exactCount = classified.filter(function (c) { return c.status === 'exact'; }).length;
    var possibleCount = classified.filter(function (c) { return c.status === 'possible'; }).length;

    // If anything needs review, show the review UI; otherwise import clean rows directly.
    if (exactCount > 0 || possibleCount > 0) {
      setReviewClassified(classified);
      setImportStep('review');
      return;
    }
    // All clean — proceed to insert
    await executeImport(classified, accId);
  };

  // v55.83-A.6.14 — actually write the approved rows after review
  // v55.83-A.6.15 — also tag each row with an import_batch_id so we can
  // roll back this specific import later if needed. Best-effort; if the
  // bank_import_batches table doesn't exist yet, imports still succeed.
  const executeImport = async (classified, accId) => {
    setImportStep('importing');
    var imported = 0, skipped = 0, exactSkipped = 0, possibleSkipped = 0, overridden = 0;
    var toInsert = [];
    var auditEntries = [];
    classified.forEach(function (c) {
      if (c.decision === 'import') {
        toInsert.push({ account_id: accId, date: c.row.date, description: c.row.description, amount: c.row.amount, imported_by: myId });
        if (c.status !== 'clean') overridden += 1;
      } else if (c.decision === 'skip') {
        skipped += 1;
        if (c.status === 'exact') exactSkipped += 1;
        else if (c.status === 'possible') possibleSkipped += 1;
      }
      if (c.status !== 'clean') {
        auditEntries.push({
          row_date: c.row.date,
          amount: c.row.amount,
          description_short: (c.row.description || '').substring(0, 80),
          status: c.status,
          decision: c.decision,
          matched_ids: c.matches.map(function (m) { return m.id; }),
          decided_by: myId,
          decided_at: new Date().toISOString(),
        });
      }
    });

    // v55.83-A.6.15 — Create batch record first; best-effort (don't fail import if table missing)
    var batchId = null;
    try {
      var totalAmt = toInsert.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
      var batchResp = await supabase.from('bank_import_batches').insert({
        imported_by: myId,
        account_id: accId,
        row_count: toInsert.length,
        total_amount: totalAmt,
        status: 'active',
      }).select().maybeSingle();
      if (batchResp.data && batchResp.data.id) {
        batchId = batchResp.data.id;
        // Tag every row with this batch_id
        toInsert = toInsert.map(function (r) { return Object.assign({}, r, { import_batch_id: batchId }); });
      }
    } catch (_) { /* table may not exist yet; proceed without batch */ }

    // Batch insert in chunks of 100
    for (var i = 0; i < toInsert.length; i += 100) {
      var chunk = toInsert.slice(i, i + 100);
      try {
        var resp = await supabase.from('egypt_bank_transactions').insert(chunk);
        if (resp.error) skipped += chunk.length;
        else imported += chunk.length;
      } catch (e) { skipped += chunk.length; }
    }

    // Write audit log for every override decision (best-effort, swallows errors)
    if (auditEntries.length > 0) {
      try {
        await supabase.from('bank_import_audit').insert(auditEntries.map(function (a) {
          return {
            user_id: myId,
            action: 'bank_import_duplicate_decision',
            details: JSON.stringify(a),
            created_at: a.decided_at,
          };
        }));
      } catch (e) { /* audit_log fallback below */ }
      try {
        for (var ai = 0; ai < auditEntries.length; ai++) {
          await supabase.from('audit_log').insert({
            user_id: myId,
            entity_type: 'egypt_bank_transactions',
            action: 'import_dedup_' + auditEntries[ai].decision,
            details: Object.assign({ import_batch_id: batchId }, auditEntries[ai]),
            created_at: auditEntries[ai].decided_at,
          });
        }
      } catch (e) { /* ignore */ }
    }

    setImportStats({ imported: imported, skipped: skipped, duplicates: exactSkipped + possibleSkipped, exactSkipped: exactSkipped, possibleSkipped: possibleSkipped, overridden: overridden, total: classified.length });
    setImportStep('done');
    setReviewClassified(null);
    await logActivity(myId, 'Imported ' + imported + ' Egypt bank transactions (' + exactSkipped + ' exact duplicates skipped, ' + possibleSkipped + ' possible duplicates skipped, ' + overridden + ' overridden)', 'finance');
    await load();
    await autoCategorizeTxns();
  };

  // v55.83-A.6.14 — update a single row's decision in the review UI
  const setReviewDecision = (idx, decision) => {
    setReviewClassified(function (prev) {
      if (!prev) return prev;
      var next = prev.slice();
      next[idx] = Object.assign({}, next[idx], { decision: decision });
      return next;
    });
  };

  // v55.83-A.6.15 (Max May 14 2026) — Bulk delete: preview impact, then execute.
  // Two-step (preview → confirm) so user sees count/sum/affected invoices first.
  const computeBulkDeleteImpact = async () => {
    if (!bulkDeleteAccountId || !bulkDeleteFrom || !bulkDeleteTo) {
      alert('Pick an account and date range first / اختر حسابًا ونطاق تاريخ');
      return;
    }
    setBulkDeleteWorking(true);
    try {
      var bankResp = await supabase.from('egypt_bank_transactions')
        .select('id, date, amount, description')
        .eq('account_id', bulkDeleteAccountId)
        .gte('date', bulkDeleteFrom)
        .lte('date', bulkDeleteTo);
      var bankRows = bankResp.data || [];
      var bankIds = bankRows.map(function (r) { return r.id; });
      var totalSum = bankRows.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
      var affectedInvoiceIds = [];
      var matchedTreasury = [];
      if (bankIds.length > 0) {
        var tResp = await supabase.from('treasury')
          .select('id, linked_invoice_id, matched_bank_txn_id')
          .in('matched_bank_txn_id', bankIds);
        matchedTreasury = tResp.data || [];
        affectedInvoiceIds = Array.from(new Set(matchedTreasury.map(function (t) { return t.linked_invoice_id; }).filter(Boolean)));
      }
      setBulkDeleteImpact({
        count: bankRows.length,
        sum: totalSum,
        treasury_rows: matchedTreasury.length,
        invoices: affectedInvoiceIds.length,
        invoice_ids: affectedInvoiceIds,
      });
    } catch (e) {
      alert('Preview failed: ' + (e.message || e));
      setBulkDeleteImpact(null);
    }
    setBulkDeleteWorking(false);
  };

  const executeBulkDelete = async () => {
    if (!bulkDeleteImpact) { alert('Run preview first'); return; }
    if (!bulkDeleteReason || bulkDeleteReason.length < 5) {
      alert('Provide a reason (at least 5 characters) / أدخل سببًا للحذف');
      return;
    }
    if (!confirm('You are about to DELETE ' + bulkDeleteImpact.count + ' bank transactions totaling EGP ' + bulkDeleteImpact.sum.toLocaleString() + '. This affects ' + bulkDeleteImpact.invoices + ' invoices. Continue? / تأكيد الحذف؟')) return;
    setBulkDeleteWorking(true);
    try {
      var bankResp = await supabase.from('egypt_bank_transactions')
        .select('id')
        .eq('account_id', bulkDeleteAccountId)
        .gte('date', bulkDeleteFrom)
        .lte('date', bulkDeleteTo);
      var bankIds = (bankResp.data || []).map(function (r) { return r.id; });
      if (bankIds.length === 0) { alert('Nothing to delete'); setBulkDeleteWorking(false); return; }
      var tBefore = (await supabase.from('treasury').select('linked_invoice_id').in('matched_bank_txn_id', bankIds)).data || [];
      var invoiceIds = Array.from(new Set(tBefore.map(function (t) { return t.linked_invoice_id; }).filter(Boolean)));
      // Unmatch treasury rows pointing at these
      await supabase.from('treasury').update({ matched_bank_txn_id: null }).in('matched_bank_txn_id', bankIds);
      // Audit BEFORE delete
      try {
        await supabase.from('audit_log').insert({
          user_id: myId,
          entity_type: 'egypt_bank_transactions',
          action: 'bulk_delete',
          details: {
            account_id: bulkDeleteAccountId,
            from: bulkDeleteFrom,
            to: bulkDeleteTo,
            count: bulkDeleteImpact.count,
            sum: bulkDeleteImpact.sum,
            invoices_affected: bulkDeleteImpact.invoices,
            reason: bulkDeleteReason,
            bank_row_ids: bankIds,
            source: 'v55.83-A.6.15 EgyptBankTab bulk delete',
          },
          created_at: new Date().toISOString(),
        });
      } catch (_) {}
      await supabase.from('egypt_bank_transactions').delete().in('id', bankIds);
      toast && toast.success && toast.success(bankIds.length + ' rows deleted, ' + invoiceIds.length + ' invoices need recalc on reload / تم الحذف');
      setBulkDeleteOpen(false);
      setBulkDeleteImpact(null);
      setBulkDeleteReason('');
      if (onReload) await onReload();
      await load();
    } catch (e) {
      alert('Delete failed: ' + (e.message || e));
    }
    setBulkDeleteWorking(false);
  };

  // ───── Smart Auto-categorize (amount-first + keywords + timing patterns + direction) ─────
  const extractKeywords = (d) => (d || '').replace(/FT\w+|TT\w+|CK\d+|LCO\d+|\d{6,}|\\\\[A-Z]+/gi, '')
    .toLowerCase().split(/\s+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));

  const detectTimingPattern = (days) => {
    if (days.length < 2) return { type: 'none' };
    const sorted = [...days].sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1]);
    const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const spread = Math.max(...sorted) - Math.min(...sorted);
    
    if (spread <= 5) return { type: 'monthly-fixed', center: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length), spread };
    if (avgInterval >= 5 && avgInterval <= 9) return { type: 'weekly', interval: 7 };
    if (avgInterval >= 12 && avgInterval <= 16) return { type: 'biweekly', interval: 14 };
    if (spread <= 12) return { type: 'monthly-range', min: sorted[0], max: sorted[sorted.length - 1] };
    return { type: 'scattered', min: sorted[0], max: sorted[sorted.length - 1] };
  };

  const autoCategorizeTxns = async () => {
    const categorized = transactions.filter(t => t.category);
    if (categorized.length === 0) return 0;
    const tolerance = amtTolerance / 100;
    const dFrom = dayFrom ? parseInt(dayFrom) : 0;
    const dTo = dayTo ? parseInt(dayTo) : 31;

    // Build profiles per category (group by category, pick best subcategory)
    const profiles = {};
    categorized.forEach(t => {
      const key = t.category;
      if (!profiles[key]) profiles[key] = { category: t.category, subcategories: {}, keywords: {}, amounts: [], days: [], dates: [], directions: [] };
      const p = profiles[key];
      // Track subcategory frequency to pick the best one
      const sub = t.subcategory || '';
      p.subcategories[sub] = (p.subcategories[sub] || 0) + 1;
      extractKeywords(t.description).forEach(w => { p.keywords[w] = (p.keywords[w] || 0) + 1; });
      p.amounts.push(Math.abs(t.amount));
      if (t.date) {
        p.days.push(parseInt(t.date.substring(8, 10)) || 0);
        p.dates.push(t.date);
      }
      p.directions.push(t.amount > 0 ? 'in' : 'out');
    });

    // Resolve best subcategory per profile (most recent non-empty wins)
    for (const p of Object.values(profiles)) {
      const subs = Object.entries(p.subcategories).filter(([s]) => s.length > 0).sort((a, b) => b[1] - a[1]);
      p.bestSubcategory = subs.length > 0 ? subs[0][0] : '';
      p.timing = detectTimingPattern(p.days);
    }

    // Score each uncategorized transaction
    const uncategorized = transactions.filter(t => !t.category && !t.hidden);
    const assignments = [];

    for (const t of uncategorized) {
      const tDay = t.date ? parseInt(t.date.substring(8, 10)) || 0 : 0;
      if (dFrom > 0 && tDay < dFrom) continue;
      if (dTo < 31 && tDay > dTo) continue;

      const tWords = new Set(extractKeywords(t.description));
      const tAmt = Math.abs(t.amount);
      const tDir = t.amount > 0 ? 'in' : 'out';
      let bestScore = 0, bestProfile = null;

      for (const [key, p] of Object.entries(profiles)) {
        let score = 0;

        // 1. AMOUNT (0-40 pts) — highest weight
        if (p.amounts.length > 0) {
          if (tolerance === 0) {
            if (p.amounts.some(a => Math.abs(a - tAmt) < 0.01)) score += 40;
          } else {
            const avgAmt = p.amounts.reduce((s, v) => s + v, 0) / p.amounts.length;
            const diff = Math.abs(tAmt - avgAmt) / (avgAmt || 1);
            if (diff <= tolerance) score += (1 - diff / tolerance) * 40;
          }
        }

        // 2. KEYWORDS (0-25 pts) — description patterns
        const topWords = Object.entries(p.keywords).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
        if (topWords.length > 0) {
          const matches = topWords.filter(w => tWords.has(w)).length;
          score += (matches / topWords.length) * 25;
        }

        // 3. TIMING PATTERN (0-25 pts) — weekly/monthly/recurring detection
        if (p.timing.type !== 'none' && tDay > 0) {
          if (p.timing.type === 'monthly-fixed') {
            const dist = Math.abs(tDay - p.timing.center);
            if (dist <= 3) score += 25;
            else if (dist <= 5) score += 15;
          } else if (p.timing.type === 'weekly') {
            // Check if tDay fits any multiple of 7 from known days
            const fits = p.days.some(d => Math.abs((tDay - d) % 7) <= 1 || Math.abs((tDay - d) % 7) >= 6);
            if (fits) score += 25;
          } else if (p.timing.type === 'biweekly') {
            const fits = p.days.some(d => Math.abs((tDay - d) % 14) <= 2 || Math.abs((tDay - d) % 14) >= 12);
            if (fits) score += 20;
          } else if (p.timing.type === 'monthly-range') {
            if (tDay >= p.timing.min - 2 && tDay <= p.timing.max + 2) score += 20;
          } else {
            if (tDay >= p.timing.min - 3 && tDay <= p.timing.max + 3) score += 10;
          }
        }

        // 4. DIRECTION (0-10 pts)
        if (p.directions.length > 0) {
          const mainDir = p.directions.filter(d => d === 'in').length > p.directions.length / 2 ? 'in' : 'out';
          if (tDir === mainDir) score += 10;
        }

        if (score > bestScore) { bestScore = score; bestProfile = p; }
      }

      if (bestScore >= 50 && bestProfile) {
        assignments.push({ id: t.id, category: bestProfile.category, subcategory: bestProfile.bestSubcategory, score: bestScore });
      }
    }

    // Also propagate subcategory to existing transactions that have category but no subcategory
    const subPropagations = [];
    for (const p of Object.values(profiles)) {
      if (p.bestSubcategory) {
        const missing = transactions.filter(t => t.category === p.category && !t.subcategory);
        missing.forEach(t => subPropagations.push({ id: t.id, subcategory: p.bestSubcategory }));
      }
    }

    // Batch update assignments
    const batches = {};
    for (const a of assignments) {
      const bk = a.category + '|' + a.subcategory;
      if (!batches[bk]) batches[bk] = { ids: [], category: a.category, subcategory: a.subcategory };
      batches[bk].ids.push(a.id);
    }
    let matched = 0;
    for (const batch of Object.values(batches)) {
      try {
        await supabase.from('egypt_bank_transactions').update({ category: batch.category, subcategory: batch.subcategory || null }).in('id', batch.ids);
        matched += batch.ids.length;
      } catch(e) { console.warn(e); }
    }

    // Batch propagate subcategories
    let propagated = 0;
    if (subPropagations.length > 0) {
      const subBatches = {};
      subPropagations.forEach(s => {
        if (!subBatches[s.subcategory]) subBatches[s.subcategory] = [];
        subBatches[s.subcategory].push(s.id);
      });
      for (const [sub, ids] of Object.entries(subBatches)) {
        try {
          await supabase.from('egypt_bank_transactions').update({ subcategory: sub }).in('id', ids);
          propagated += ids.length;
        } catch(e) { console.warn(e); }
      }
    }

    if (matched > 0 || propagated > 0) {
      const assignMap = {};
      assignments.forEach(a => { assignMap[a.id] = a; });
      const subMap = {};
      subPropagations.forEach(s => { subMap[s.id] = s.subcategory; });
      setTransactions(prev => prev.map(t => {
        if (assignMap[t.id]) return { ...t, category: assignMap[t.id].category, subcategory: assignMap[t.id].subcategory };
        if (subMap[t.id]) return { ...t, subcategory: subMap[t.id] };
        return t;
      }));
    }
    return { matched, propagated };
  };

  // ───── Match ─────
  //
  // v55.83-A.6.27.14 (Max May 16 2026) — ARCHITECTURAL FIX.
  //
  // OLD BEHAVIOR (BROKEN): this function wrote invoices.total_collected
  // directly, which violated the contract in src/lib/supabase.js (line ~245):
  // "all invoice recalculation MUST go through recalcInvoiceCollected". It
  // also didn't create or update any treasury row to represent the bank
  // inflow, so recalcInvoiceCollected (when fired from any other code path
  // afterward) would see ZERO linked rows and reset total_collected to 0 —
  // silently wiping the bank match. Plus total_confirmed, total_pending_bank,
  // overpayment_amount, and the write-off tolerance on outstanding were
  // all going stale.
  //
  // NEW BEHAVIOR: prefer to update an existing placeholder (consistent with
  // the auto-match path in page.jsx). If no matching placeholder exists,
  // create a treasury row representing the bank inflow with the right
  // bookkeeping (bank_in set, cash_in=0, linked_invoice_id UUID set,
  // matched_bank_txn_id set, needs_bank_match=false because it IS the
  // bank-side confirmation). Then defer to recalcInvoiceCollected.
  const matchToInvoice = async (txnId, invoiceId) => {
    const txn = transactions.find(t => t.id === txnId);
    const inv = (invoices || []).find(i => i.id === invoiceId);
    if (!inv || !txn || !(Number(txn.amount) > 0)) {
      // Nothing meaningful to link — just mark the bank txn matched.
      await dbUpdate('egypt_bank_transactions', txnId, { matched_invoice_id: invoiceId, matched_at: new Date().toISOString(), matched_by: myId }, myId);
      setMatchingTxn(null);
      setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matched_invoice_id: invoiceId, matched_at: new Date().toISOString() } : t));
      if (onReload) setTimeout(() => onReload(), 500);
      return;
    }
    const bankAmt = Number(txn.amount);
    let touchedTreasuryId = null;
    try {
      // Step 1: look for an existing placeholder on this invoice matching
      // the amount. Same dedup tolerance as the auto-match path
      // (2% of expected, capped at 500 EGP).
      const { data: candidates } = await supabase.from('treasury')
        .select('*')
        .eq('linked_invoice_id', invoiceId)
        .eq('is_bank_placeholder', true);
      const tol = Math.min(bankAmt * 0.02, 500);
      const matchingPlaceholder = (candidates || []).find(p => {
        const exp = Number(p.expected_amount || p.bank_in || 0);
        return Math.abs(exp - bankAmt) < tol && !p.matched_bank_txn_id;
      });

      if (matchingPlaceholder) {
        // Promote placeholder to confirmed bank-in
        await dbUpdate('treasury', matchingPlaceholder.id, {
          is_bank_placeholder: false,
          bank_in: bankAmt,
          matched_bank_txn_id: txnId,
          needs_bank_match: false,
        }, myId);
        touchedTreasuryId = matchingPlaceholder.id;
      } else {
        // Step 2: look for a pending check on this invoice matching the
        // amount EXACTLY. If found, auto-collect it AND create a treasury
        // row tied to it via source_check_id.
        const { data: pendingChecks } = await supabase.from('checks')
          .select('*')
          .eq('invoice_id', invoiceId)
          .eq('status', 'pending');
        const matchingCheck = (pendingChecks || []).find(c =>
          Math.abs(Number(c.amount) - bankAmt) < 1
        );

        if (matchingCheck) {
          // v55.83-A.6.27.14 harden — before creating a new treasury row,
          // check whether one already represents this check (via
          // source_check_id). If so, just update it with the bank match.
          // Per Max's clarification: marking a check collected should NOT
          // create a duplicate treasury row when one already exists for
          // that money.
          const { data: existingForCheck } = await supabase.from('treasury')
            .select('*')
            .eq('source_check_id', matchingCheck.id)
            .limit(1)
            .maybeSingle();

          await dbUpdate('checks', matchingCheck.id, {
            status: 'collected',
            collection_date: txn.date || todayET(),
          }, myId);

          if (existingForCheck) {
            // Update the existing row with the bank match. If it was sitting
            // in cash_in (e.g. recorded as cash-swap earlier — unusual flow
            // but possible), don't overwrite the channel; just stamp the
            // bank match metadata. If it was sitting as a placeholder, the
            // earlier placeholder branch would have caught it — so by the
            // time we get here, the existing row is either an unmatched
            // bank row or some odd legacy state. Be conservative: stamp the
            // bank match link, leave the channel/amount alone.
            await dbUpdate('treasury', existingForCheck.id, {
              matched_bank_txn_id: txnId,
              needs_bank_match: false,
              is_bank_placeholder: false,
            }, myId);
            touchedTreasuryId = existingForCheck.id;
          } else {
            // No existing treasury row for this check — create one.
            const { data: newRow, error: insErr } = await supabase.from('treasury').insert({
              transaction_date: txn.date || todayET(),
              cash_in: 0,
              cash_out: 0,
              bank_in: bankAmt,
              bank_out: 0,
              linked_invoice_id: invoiceId,
              order_number: inv.order_number,
              matched_bank_txn_id: txnId,
              needs_bank_match: false,
              is_bank_placeholder: false,
              source_check_id: matchingCheck.id,
              description: 'Bank collection of check #' + (matchingCheck.check_number || matchingCheck.id),
              created_by: myId,
            }).select().single();
            if (insErr) throw insErr;
            touchedTreasuryId = newRow && newRow.id;
          }
        } else {
          // Step 3: no placeholder, no matching check. Create a fresh
          // treasury row for the bank inflow.
          const { data: newRow, error: insErr } = await supabase.from('treasury').insert({
            transaction_date: txn.date || todayET(),
            cash_in: 0,
            cash_out: 0,
            bank_in: bankAmt,
            bank_out: 0,
            linked_invoice_id: invoiceId,
            order_number: inv.order_number,
            matched_bank_txn_id: txnId,
            needs_bank_match: false,
            is_bank_placeholder: false,
            description: 'Bank deposit matched to invoice #' + inv.order_number,
            created_by: myId,
          }).select().single();
          if (insErr) throw insErr;
          touchedTreasuryId = newRow && newRow.id;
        }
      }

      // Step 4: mark the bank txn matched AFTER treasury is in good shape.
      await dbUpdate('egypt_bank_transactions', txnId, {
        matched_invoice_id: invoiceId,
        matched_treasury_id: touchedTreasuryId,
        matched_at: new Date().toISOString(),
        matched_by: myId,
      }, myId);

      // Step 5: delegate to the canonical recalc. This computes
      // total_collected / total_confirmed / total_pending_bank /
      // overpayment_amount / outstanding correctly — no parallel math.
      if (recalcInvoiceCollected) {
        try { await recalcInvoiceCollected(invoiceId); }
        catch (e) { console.warn('[EgyptBankTab.match] recalc failed (non-fatal, will retry on reload):', e && e.message); }
      } else {
        console.warn('[EgyptBankTab.match] recalcInvoiceCollected prop not provided — totals may be stale until next page reload');
      }
    } catch (err) {
      if (toast && toast.error) toast.error('Match failed: ' + (err && err.message ? err.message : String(err)));
      else alert('Match failed: ' + (err && err.message ? err.message : String(err)));
      // Make sure we don't leave a half-matched state. If the bank txn was
      // already marked matched by step 4, leave it; the next reload will
      // surface the inconsistency.
    }

    setMatchingTxn(null);
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matched_invoice_id: invoiceId, matched_at: new Date().toISOString() } : t));
    if (onReload) setTimeout(() => onReload(), 500);
  };

  // v55.83-A.6.27.14 — unmatch follows the same architecture. Instead of
  // subtracting from total_collected, it unlinks the treasury row from the
  // bank txn (and unlinks from the invoice if the treasury row was created
  // SOLELY for this bank match — i.e. there's no source_check_id and the
  // description matches our auto-created pattern). Then recalc fires.
  const unmatch = async (txnId) => {
    const txn = transactions.find(t => t.id === txnId);
    if (!txn) return;
    const invoiceId = txn.matched_invoice_id;
    const treasuryId = txn.matched_treasury_id;
    try {
      // If a treasury row was tied to this bank txn, unlink it carefully.
      if (treasuryId) {
        // Look up the treasury row to decide whether it should be reverted
        // to a placeholder, deleted, or just have matched_bank_txn_id cleared.
        const { data: tRow } = await supabase.from('treasury').select('*').eq('id', treasuryId).maybeSingle();
        if (tRow) {
          var wasAutoCreated = /^Bank deposit matched to invoice|^Bank collection of check/.test(tRow.description || '');
          if (wasAutoCreated && !tRow.source_check_id) {
            // We created it solely for this bank match — delete it.
            await supabase.from('treasury').delete().eq('id', treasuryId);
          } else if (tRow.source_check_id) {
            // Treasury row backs a collected check. Revert check + delete the bank-side row.
            await dbUpdate('checks', tRow.source_check_id, {
              status: 'pending',
              collection_date: null,
            }, myId);
            await supabase.from('treasury').delete().eq('id', treasuryId);
          } else {
            // It's an existing placeholder we promoted — revert it.
            await dbUpdate('treasury', treasuryId, {
              is_bank_placeholder: true,
              bank_in: 0,
              matched_bank_txn_id: null,
              needs_bank_match: true,
            }, myId);
          }
        }
      }
      // Clear the bank txn match
      await dbUpdate('egypt_bank_transactions', txnId, {
        matched_invoice_id: null,
        matched_treasury_id: null,
        matched_at: null,
        matched_by: null,
      }, myId);
      // Recalc the invoice (do NOT subtract from total_collected directly).
      if (invoiceId && recalcInvoiceCollected) {
        try { await recalcInvoiceCollected(invoiceId); }
        catch (e) { console.warn('[EgyptBankTab.unmatch] recalc failed (non-fatal):', e && e.message); }
      }
    } catch (err) {
      if (toast && toast.error) toast.error('Unmatch failed: ' + (err && err.message ? err.message : String(err)));
      else alert('Unmatch failed: ' + (err && err.message ? err.message : String(err)));
    }
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matched_invoice_id: null, matched_at: null, matched_treasury_id: null } : t));
    if (onReload) setTimeout(() => onReload(), 500);
  };

  // ───── Filters ─────
  const filtered = useMemo(() => {
    let arr = transactions;
    // Hide restricted transactions unless super admin + showHidden
    if (!isSuperAdmin) arr = arr.filter(t => !t.hidden);
    else if (!showHidden) arr = arr.filter(t => !t.hidden);
    if (selAccount !== 'all') arr = arr.filter(t => t.account_id === selAccount);
    if (matchFilter === 'matched') arr = arr.filter(t => t.matched_invoice_id);
    if (matchFilter === 'unmatched') arr = arr.filter(t => !t.matched_invoice_id);
    if (catFilter === 'uncategorized') arr = arr.filter(t => !t.category);
    else if (catFilter !== 'all') arr = arr.filter(t => t.category === catFilter);
    if (search) {
      const s = search.toLowerCase();
      arr = arr.filter(t => (t.description || '').toLowerCase().includes(s) || String(t.amount).includes(s));
    }
    if (dateFrom) arr = arr.filter(t => t.date >= dateFrom);
    if (dateTo) arr = arr.filter(t => t.date <= dateTo);
    if (filterYear) arr = arr.filter(t => t.date && t.date.substring(0, 4) === filterYear);
    if (filterMonth) arr = arr.filter(t => t.date && t.date.substring(5, 7) === filterMonth);
    return arr;
  }, [transactions, selAccount, matchFilter, catFilter, search, dateFrom, dateTo, filterMonth, filterYear, isSuperAdmin, showHidden]);

  const totalIn = filtered.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalOut = filtered.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const matchedCount = filtered.filter(t => t.matched_invoice_id).length;
  const unmatchedCount = filtered.filter(t => !t.matched_invoice_id).length;

  const fmtE = (n) => 'E£' + Math.abs(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const getAccName = (id) => { const a = accounts.find(a => a.id === id); return a ? `${a.bank_name} - ${a.account_number}` : ''; };

  // Invoice search for matching
  const matchableInvoices = useMemo(() => {
    const txnAmt = matchingTxn ? Math.abs(matchingTxn.amount || 0) : 0;
    return (invoices || []).filter(inv => {
      if (!searchInv) return true;
      const q = searchInv.toLowerCase();
      const haystack = [
        inv.customer || '', inv.customer_name || '', inv.customer_name_en || '',
        inv.invoice_number || '', inv.order_number || '',
        String(inv.amount || inv.total_amount || ''), inv.invoice_date || inv.date || ''
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    }).sort((a, b) => {
      // Smart sort: closest amount match first
      const aDiff = Math.abs(Number(a.amount || a.total_amount || 0) - txnAmt);
      const bDiff = Math.abs(Number(b.amount || b.total_amount || 0) - txnAmt);
      if (aDiff !== bDiff) return aDiff - bDiff;
      return ((b.invoice_date || b.date || '')).localeCompare(a.invoice_date || a.date || '');
    }).slice(0, 30);
  }, [invoices, searchInv, matchingTxn]);

  if (loading) return <div className="text-center py-12 text-slate-400">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-extrabold">🏦 Egypt Banking / البنوك المصرية</h2>
        <div className="flex gap-1.5">
          <button onClick={() => setView('accounts')} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === 'accounts' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>🏛️ Accounts</button>
          <button onClick={() => { setView('import'); setImportStep('select'); }} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === 'import' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>📥 Import</button>
          <button onClick={() => setView('transactions')} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === 'transactions' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>📋 Transactions</button>
          {isSuperAdmin && (
            <button onClick={() => setView('history')} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (view === 'history' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>📜 Import History / السجل</button>
          )}
        </div>
      </div>

      {/* ===== ACCOUNTS ===== */}
      {view === 'accounts' && (
        <div>
          <button onClick={() => { setShowAddAccount(true); setAccForm({ bank_name: '', account_number: '', account_name: '', currency: 'EGP' }); }} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold mb-3">+ Add Account</button>
          {showAddAccount && (
            <div className="bg-white rounded-xl p-4 shadow-sm border mb-3">
              <h3 className="font-bold text-sm mb-2">{accForm.id ? 'Edit Account' : 'New Account / حساب جديد'}</h3>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input value={accForm.bank_name} onChange={e => setAccForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="Bank Name / اسم البنك *" className="border rounded-lg px-3 py-2 text-xs" />
                <input value={accForm.account_number} onChange={e => setAccForm(f => ({ ...f, account_number: e.target.value }))} placeholder="Account # / رقم الحساب *" className="border rounded-lg px-3 py-2 text-xs" />
                <input value={accForm.account_name} onChange={e => setAccForm(f => ({ ...f, account_name: e.target.value }))} placeholder="Account Name / اسم الحساب" className="border rounded-lg px-3 py-2 text-xs" />
                <select value={accForm.currency} onChange={e => setAccForm(f => ({ ...f, currency: e.target.value }))} className="border rounded-lg px-3 py-2 text-xs">
                  <option value="EGP">EGP - جنيه مصري</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={saveAccount} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">Save</button>
                <button onClick={() => setShowAddAccount(false)} className="px-4 py-2 bg-slate-100 rounded-lg text-xs font-semibold">Cancel</button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {accounts.map(a => {
              const txnCount = transactions.filter(t => t.account_id === a.id).length;
              const balance = transactions.filter(t => t.account_id === a.id).reduce((s, t) => s + (t.amount || 0), 0);
              return (
                <div key={a.id} className="bg-white rounded-xl p-4 shadow-sm border">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-sm">{a.bank_name}</div>
                      <div className="text-[10px] text-slate-500">{a.account_number} {a.account_name ? `• ${a.account_name}` : ''} • {a.currency}</div>
                      <div className="text-xs mt-1">{txnCount} transactions • Net: <span className={balance >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{fmtE(balance)}</span></div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setAccForm(a); setShowAddAccount(true); }} className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-semibold">Edit</button>
                      <button onClick={() => deleteAccount(a.id)} className="px-2 py-1 bg-red-50 text-red-800 rounded text-[10px] font-semibold border border-red-200">Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {accounts.length === 0 && <div className="text-center py-8 text-slate-400 text-xs">No accounts yet. Add one above.</div>}
          </div>
        </div>
      )}

      {/* ===== IMPORT ===== */}
      {view === 'import' && (
        <div>
          {importStep === 'select' && (
            <div className="bg-white rounded-xl p-6 text-center border-2 border-dashed border-blue-300">
              <div className="text-4xl mb-2">📁</div>
              <h3 className="font-bold text-sm mb-1">Upload Bank Statement / رفع كشف حساب</h3>
              <p className="text-[10px] text-slate-500 mb-3">Supports CIB bank statements, and any Excel/CSV with Date/Description/Amount columns.<br/>يدعم كشوف حسابات CIB وأي ملف Excel أو CSV بأعمدة التاريخ والوصف والمبلغ</p>
              {accounts.length > 0 && (
                <div className="mb-3">
                  <label className="text-[10px] text-slate-500 font-bold block mb-1">Select Account / اختر الحساب</label>
                  <select value={importAccount} onChange={e => setImportAccount(e.target.value)} className="border rounded-lg px-3 py-2 text-xs">
                    <option value="">Select account...</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_number}</option>)}
                  </select>
                </div>
              )}
              {accounts.length === 0 && (
                <p className="text-[10px] text-amber-900 font-bold mb-3">⚠️ No accounts — a default account will be auto-created on import</p>
              )}
              <label className="px-6 py-3 bg-blue-500 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-blue-600 inline-block">
                Select File(s) / اختر ملفات
                <input type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={async (e) => {
                  if (!e.target.files[0]) return;
                  let accId = importAccount;
                  if (!accId && accounts.length === 0) {
                    try {
                      const { data: newAcc } = await dbInsert('egypt_bank_accounts', { bank_name: 'Default Bank', account_number: 'AUTO-001', currency: 'EGP' }, myId);
                      if (newAcc) { accId = newAcc.id; setImportAccount(accId); await load(); }
                    } catch(err) {}
                  }
                  if (!accId && accounts.length > 0) { accId = accounts[0].id; setImportAccount(accId); }
                  handleFile(e);
                }} />
              </label>
            </div>
          )}

          {importStep === 'preview' && (() => {
            const included = importData.filter(r => r._include);
            const totalDeposits = included.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
            const totalWithdrawals = included.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
            return (
            <div>
              <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                <h3 className="font-bold text-sm">Preview — {included.length} of {importData.length} rows</h3>
                <div className="flex gap-2">
                  <button onClick={() => { setImportStep('select'); setImportData([]); }} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold">← Back</button>
                  <button onClick={doImport} disabled={!importAccount} className="px-4 py-2 bg-green-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">✅ Import {included.length} rows</button>
                </div>
              </div>
              {!importAccount && <p className="text-xs text-red-500 font-semibold mb-2">⚠️ Select an account above first</p>}
              {/* Summary */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-green-50 rounded-lg p-2 border border-green-200 text-center">
                  <div className="text-[9px] text-green-600 font-bold">Deposits</div>
                  <div className="text-sm font-black text-green-700">+{totalDeposits.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                  <div className="text-[9px] text-green-500">{included.filter(r => r.amount > 0).length} transactions</div>
                </div>
                <div className="bg-red-50 rounded-lg p-2 border border-red-200 text-center">
                  <div className="text-[9px] text-red-600 font-bold">Withdrawals</div>
                  <div className="text-sm font-black text-red-700">-{totalWithdrawals.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                  <div className="text-[9px] text-red-500">{included.filter(r => r.amount < 0).length} transactions</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-2 border border-blue-200 text-center">
                  <div className="text-[9px] text-blue-600 font-bold">Net</div>
                  <div className={'text-sm font-black ' + ((totalDeposits - totalWithdrawals) >= 0 ? 'text-blue-700' : 'text-red-700')}>{(totalDeposits - totalWithdrawals).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                </div>
              </div>
              <div className="overflow-auto max-h-[500px] bg-white rounded-xl border">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-2 py-2 text-left">✓</th>
                      <th className="px-2 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-right text-green-600">Deposit</th>
                      <th className="px-2 py-2 text-right text-red-600">Withdrawal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importData.slice(0, 200).map((r, i) => (
                      <tr key={i} className={r._include ? '' : 'opacity-30'}>
                        <td className="px-2 py-1.5"><input type="checkbox" checked={r._include} onChange={() => { const d = [...importData]; d[i]._include = !d[i]._include; setImportData(d); }} /></td>
                        <td className="px-2 py-1.5">{r.date}</td>
                        <td className="px-2 py-1.5" style={{ wordBreak: 'break-word' }}>{r.description}</td>
                        <td className="px-2 py-1.5 text-right font-bold text-green-600">{r.amount > 0 ? '+' + r.amount.toLocaleString(undefined, {minimumFractionDigits:2}) : ''}</td>
                        <td className="px-2 py-1.5 text-right font-bold text-red-600">{r.amount < 0 ? Math.abs(r.amount).toLocaleString(undefined, {minimumFractionDigits:2}) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })()}

          {importStep === 'analyzing' && (
            <div className="text-center py-12">
              <div className="text-3xl mb-2 animate-pulse">🔍</div>
              <p className="text-sm font-semibold">Scanning for duplicates across all accounts...</p>
              <p className="text-[11px] text-slate-500 mt-1">جاري فحص التكرارات في جميع الحسابات</p>
            </div>
          )}

          {importStep === 'review' && reviewClassified && (() => {
            var cleanCount = reviewClassified.filter(function (c) { return c.status === 'clean'; }).length;
            var exactCount = reviewClassified.filter(function (c) { return c.status === 'exact'; }).length;
            var possibleCount = reviewClassified.filter(function (c) { return c.status === 'possible'; }).length;
            var importing = reviewClassified.filter(function (c) { return c.decision === 'import'; }).length;
            var skipping = reviewClassified.filter(function (c) { return c.decision === 'skip'; }).length;
            return (
              <div>
                <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 mb-3">
                  <h3 className="font-bold text-amber-900 mb-1">
                    🔍 Duplicate review needed / مراجعة التكرارات
                  </h3>
                  <p className="text-[12px] text-amber-900">
                    Some rows in this statement already exist in your data. Review and decide each one below.
                    Your import on April 12 and May 13 created ~100 duplicates because the system used to only check
                    within the selected account. That bug is now fixed — we check across ALL accounts. /
                    بعض الصفوف موجودة بالفعل. راجع كل صف وحدد ما إذا كنت تريد استيراده أم تخطيه.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-center">
                    <div className="text-xs text-emerald-700">🟢 Clean / نظيف</div>
                    <div className="text-xl font-extrabold text-emerald-800">{cleanCount}</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded p-2 text-center">
                    <div className="text-xs text-red-700">🔴 Exact duplicate / مكرر</div>
                    <div className="text-xl font-extrabold text-red-700">{exactCount}</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded p-2 text-center">
                    <div className="text-xs text-amber-800">🟡 Possible duplicate / محتمل</div>
                    <div className="text-xl font-extrabold text-amber-800">{possibleCount}</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 text-center">
                    <div className="text-xs text-blue-700">Will import / سيتم استيراده</div>
                    <div className="text-xl font-extrabold text-blue-700">{importing}</div>
                    <div className="text-[9px] text-blue-600">({skipping} skip)</div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 overflow-auto max-h-[500px]">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left text-[10px]">Status</th>
                        <th className="px-2 py-2 text-left text-[10px]">Date / تاريخ</th>
                        <th className="px-2 py-2 text-right text-[10px]">Amount / مبلغ</th>
                        <th className="px-2 py-2 text-left text-[10px]">Description / وصف</th>
                        <th className="px-2 py-2 text-left text-[10px]">Existing match / السجل الحالي</th>
                        <th className="px-2 py-2 text-center text-[10px]">Decision / القرار</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewClassified.map(function (c, idx) {
                        if (c.status === 'clean') return null; // hide clean rows from review table
                        var statusBadge = c.status === 'exact'
                          ? <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[10px]">🔴 EXACT</span>
                          : <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">🟡 POSSIBLE</span>;
                        var firstMatch = c.matches[0] || {};
                        return (
                          <tr key={idx} className="border-b border-slate-100 align-top">
                            <td className="px-2 py-2">{statusBadge}</td>
                            <td className="px-2 py-2 whitespace-nowrap">{c.row.date}</td>
                            <td className="px-2 py-2 text-right font-mono">{Number(c.row.amount).toLocaleString()}</td>
                            <td className="px-2 py-2 text-[11px]">{(c.row.description || '').substring(0, 80)}</td>
                            <td className="px-2 py-2 text-[10px] text-slate-600">
                              <div>{firstMatch.date} · acct ending {(firstMatch.account_id || '').slice(-6)}</div>
                              <div className="text-slate-500">{(firstMatch.description || '').substring(0, 60)}</div>
                              {c.matches.length > 1 && <div className="text-amber-600 font-bold">+ {c.matches.length - 1} more</div>}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <div className="inline-flex rounded border border-slate-300 overflow-hidden text-[10px] font-bold">
                                <button onClick={function () { setReviewDecision(idx, 'skip'); }}
                                  className={'px-2 py-1 ' + (c.decision === 'skip' ? 'bg-red-600 text-white' : 'bg-white text-slate-700 hover:bg-red-50')}>
                                  Skip / تخطى
                                </button>
                                <button onClick={function () { setReviewDecision(idx, 'import'); }}
                                  className={'px-2 py-1 ' + (c.decision === 'import' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700 hover:bg-emerald-50')}>
                                  Import anyway / استورد رغماً
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex justify-between items-center flex-wrap gap-2">
                  <div className="flex gap-2">
                    <button onClick={function () {
                      // Skip all flagged duplicates (default safe action)
                      setReviewClassified(function (prev) {
                        return prev.map(function (c) {
                          return c.status === 'clean' ? c : Object.assign({}, c, { decision: 'skip' });
                        });
                      });
                    }} className="px-3 py-1.5 rounded bg-red-100 text-red-800 text-[11px] font-bold hover:bg-red-200">
                      🛑 Skip all flagged / تخطى الكل
                    </button>
                    {isAdmin && (
                      <button onClick={function () {
                        // Super-admin override: import EVERYTHING including exact duplicates.
                        // This is rare — only use if you're absolutely sure these aren't real duplicates.
                        if (!confirm('You are about to import ALL flagged rows including exact duplicates. This will be logged with your name. Continue? / استورد جميع الصفوف بما فيها المكررة؟ سيتم تسجيل هذا.')) return;
                        setReviewClassified(function (prev) {
                          return prev.map(function (c) {
                            return c.status === 'clean' ? c : Object.assign({}, c, { decision: 'import' });
                          });
                        });
                        setReviewOverrideAll(true);
                      }} className="px-3 py-1.5 rounded bg-amber-100 text-amber-800 text-[11px] font-bold hover:bg-amber-200">
                        ⚠️ Override: import ALL (super-admin)
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={function () { setImportStep('preview'); setReviewClassified(null); }}
                      className="px-3 py-1.5 rounded border border-slate-300 text-[11px] font-bold hover:bg-slate-50">
                      ← Back / رجوع
                    </button>
                    <button onClick={function () { executeImport(reviewClassified, importAccount); }}
                      className="px-4 py-1.5 rounded bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700">
                      Confirm and import / تأكيد واستيراد
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {importStep === 'importing' && (
            <div className="text-center py-12">
              <div className="text-3xl mb-2 animate-spin">⏳</div>
              <p className="text-sm font-semibold">Importing transactions...</p>
            </div>
          )}

          {importStep === 'done' && importStats && (
            <div className="bg-green-50 rounded-xl p-6 text-center border border-green-200">
              <div className="text-3xl mb-2">✅</div>
              <h3 className="font-bold text-lg text-green-800">Import Complete! / اكتمل الاستيراد</h3>
              <div className="text-sm mt-2 space-y-0.5">
                <div><span className="font-bold text-emerald-700">{importStats.imported}</span> imported / تم استيرادها</div>
                {importStats.exactSkipped > 0 && (
                  <div className="text-red-700">🔴 {importStats.exactSkipped} exact duplicates skipped / مكررات تم تخطيها</div>
                )}
                {importStats.possibleSkipped > 0 && (
                  <div className="text-amber-700">🟡 {importStats.possibleSkipped} possible duplicates skipped / مكررات محتملة تم تخطيها</div>
                )}
                {importStats.overridden > 0 && (
                  <div className="text-amber-900 font-bold">⚠️ {importStats.overridden} flagged rows imported anyway (override) / تم تجاوز التحذير</div>
                )}
                {importStats.skipped > (importStats.duplicates || 0) && (
                  <div className="text-slate-600">{importStats.skipped - (importStats.duplicates || 0)} errors / أخطاء</div>
                )}
              </div>
              <button onClick={() => { setImportStep('select'); setImportData([]); setImportStats(null); setReviewClassified(null); setView('transactions'); }} className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">View Transactions / عرض المعاملات</button>
            </div>
          )}
        </div>
      )}

      {/* ===== TRANSACTIONS ===== */}
      {view === 'transactions' && (
        <div>
          {/* Quick Import Bar */}
          <div className="bg-blue-50 rounded-xl p-3 mb-3 border border-blue-200 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-blue-800">📥 Import Bank Statement</span>
              {accounts.length > 0 ? (
                <select value={importAccount} onChange={e => setImportAccount(e.target.value)} className="border rounded-lg px-2 py-1 text-xs">
                  <option value="">Select account...</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_number}</option>)}
                </select>
              ) : (
                <span className="text-[10px] text-amber-900 font-bold">⚠️ No accounts yet — one will be created automatically</span>
              )}
            </div>
            <div className="flex gap-2">
              <label className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-bold cursor-pointer hover:bg-blue-600">
                📁 Select File(s)
                <input type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={async (e) => {
                  if (e.target.files[0]) {
                    // Auto-create default account if none exist
                    let accId = importAccount;
                    if (!accId && accounts.length === 0) {
                      try {
                        const { data: newAcc } = await dbInsert('egypt_bank_accounts', { bank_name: 'Default Bank', account_number: 'AUTO-001', currency: 'EGP' }, myId);
                        if (newAcc) { accId = newAcc.id; setImportAccount(accId); await load(); }
                      } catch(err) { alert('Could not create account: ' + err.message); return; }
                    }
                    if (!accId && accounts.length > 0) { accId = accounts[0].id; setImportAccount(accId); }
                    if (!accId) { alert('Select or create an account first'); e.target.value = ''; return; }
                    handleFile(e);
                    setView('import');
                  }
                }} />
              </label>
              {/* v55.83-A.6.15 — Bulk delete (super-admin only) */}
              {isSuperAdmin && (
                <button onClick={function () { setBulkDeleteOpen(true); setBulkDeleteImpact(null); }}
                  className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold">
                  🗑 Bulk Delete / حذف بالجملة
                </button>
              )}
              <button onClick={() => {
                const ws = XLSX.utils.aoa_to_sheet([
                  ['Date', 'Description', 'Credit (In)', 'Debit (Out)', 'Balance', 'Reference', 'Notes'],
                  ['التاريخ', 'الوصف / البيان', 'إيداع (دائن)', 'سحب (مدين)', 'الرصيد', 'المرجع', 'ملاحظات'],
                  ['2025-02-03', 'Online Transfer - payment', 280000, '', 15451688.70, 'FT250347', ''],
                  ['2025-02-05', 'Account Transfer Fee', '', 20, 16284653.70, '', 'Bank fee'],
                ]);
                ws['!cols'] = [{wch:14},{wch:40},{wch:16},{wch:16},{wch:16},{wch:16},{wch:20}];
                const twb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(twb, ws, 'Template');
                XLSX.writeFile(twb, 'Egypt-Bank-Import-Template.xlsx');
              }} className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200">
                📄 Template
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <div className="bg-green-50 rounded-xl p-3 border border-green-200">
              <div className="text-[10px] text-green-600 font-bold">Deposits / إيداعات</div>
              <div className="text-lg font-black text-green-700">{fmtE(totalIn)}</div>
            </div>
            <div className="bg-red-50 rounded-xl p-3 border border-red-200">
              <div className="text-[10px] text-red-600 font-bold">Withdrawals / سحب</div>
              <div className="text-lg font-black text-red-700">{fmtE(totalOut)}</div>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
              <div className="text-[10px] text-blue-600 font-bold">Matched / متطابق</div>
              <div className="text-lg font-black text-blue-700">{matchedCount}</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
              <div className="text-[10px] text-amber-900 font-extrabold">Unmatched / غير متطابق</div>
              <div className="text-lg font-black text-amber-900">{unmatchedCount}</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            <select value={selAccount} onChange={e => setSelAccount(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="all">All Accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_number}</option>)}
            </select>
            {['all', 'unmatched', 'matched'].map(v => (
              <button key={v} onClick={() => setMatchFilter(v)} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (matchFilter === v ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600')}>
                {v === 'all' ? `All (${transactions.length})` : v === 'unmatched' ? `Unmatched (${unmatchedCount})` : `Matched (${matchedCount})`}
              </button>
            ))}
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="border rounded-lg px-2 py-1.5 text-xs flex-1 min-w-[100px]" />
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="all">All Categories</option>
              <option value="uncategorized">⚠️ Uncategorized ({transactions.filter(t => !t.category && !t.hidden).length})</option>
              {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
            </select>
            {transactions.filter(t => !t.category && !t.hidden).length > 0 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setShowSmartConfig(!showSmartConfig)}
                  className="px-2 py-1.5 bg-amber-100 text-amber-900 rounded-lg text-[10px] font-bold border border-amber-300 hover:bg-amber-200">
                  🤖 Smart Categorize ▾
                </button>
              </div>
            )}
          </div>

          {/* Smart Categorize Config Panel */}
          {showSmartConfig && (
            <div className="bg-amber-50 rounded-xl p-3 mb-3 border border-amber-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-amber-900">🤖 Smart Categorize Settings</span>
                <button onClick={() => setShowSmartConfig(false)} className="text-[10px] text-slate-500">✕</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">Amount Tolerance</label>
                  <select value={amtTolerance} onChange={e => setAmtTolerance(parseInt(e.target.value))} className="border rounded-lg px-2 py-1.5 text-xs w-full">
                    <option value="0">Exact match (0%)</option>
                    <option value="5">±5%</option>
                    <option value="10">±10%</option>
                    <option value="20">±20%</option>
                    <option value="50">±50%</option>
                  </select>
                  <div className="text-[9px] text-slate-500 mt-0.5">0% = amount must match exactly</div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">Day of Month Range</label>
                  <div className="flex items-center gap-1">
                    <input type="number" min="1" max="31" value={dayFrom} onChange={e => setDayFrom(e.target.value)} placeholder="1" className="border rounded-lg px-2 py-1.5 text-xs w-16" />
                    <span className="text-[10px] text-slate-500">to</span>
                    <input type="number" min="1" max="31" value={dayTo} onChange={e => setDayTo(e.target.value)} placeholder="31" className="border rounded-lg px-2 py-1.5 text-xs w-16" />
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5">Only categorize transactions within these days</div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">Scoring</label>
                  <div className="text-[9px] text-slate-500 leading-relaxed">
                    Amount: 40pts | Keywords: 25pts<br/>
                    Timing pattern: 25pts | Direction: 10pts<br/>
                    Min 50pts to assign. Detects weekly,<br/>
                    biweekly & monthly-fixed patterns.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={async () => {
                  const result = await autoCategorizeTxns();
                  const { matched, propagated } = result || { matched: 0, propagated: 0 };
                  let msg = '';
                  if (matched > 0) msg += `✅ Categorized ${matched} transactions`;
                  if (propagated > 0) msg += (msg ? '\n' : '') + `📋 Updated ${propagated} subcategories`;
                  if (!msg) msg = 'No confident matches found. Categorize a few transactions manually first — the engine learns from your examples.';
                  else msg += `\n\nSettings: tolerance ${amtTolerance}%, days ${dayFrom||1}-${dayTo||31}`;
                  alert(msg);
                }} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600">
                  ▶ Run Smart Categorize
                </button>
                <span className="text-[10px] text-slate-500">
                  {transactions.filter(t => t.category).length} categorized → {transactions.filter(t => !t.category && !t.hidden).length} uncategorized
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-2 mb-3 items-center flex-wrap">
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs font-semibold">
              <option value="">All Years</option>
              {[...new Set(transactions.map(t => t.date ? t.date.substring(0, 4) : null).filter(Boolean))].sort().reverse().map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs font-semibold">
              <option value="">All Months</option>
              {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
                <option key={m} value={m}>{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1]}</option>
              ))}
            </select>
            <span className="text-[10px] text-slate-500">or</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded-lg px-2 py-1 text-xs" />
            <span className="text-[10px] text-slate-500">→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded-lg px-2 py-1 text-xs" />
            {(dateFrom || dateTo || filterMonth || filterYear) && <button onClick={() => { setDateFrom(''); setDateTo(''); setFilterMonth(''); setFilterYear(''); }} className="text-[10px] text-red-500 font-semibold">✕ Clear</button>}
            <span className="text-[10px] text-slate-500 ml-auto">{filtered.length} transactions</span>
            <button onClick={() => {
              const rows = filtered.map(t => ({
                Date: t.date, Description: t.description,
                Deposit: t.amount > 0 ? t.amount : '',
                Withdrawal: t.amount < 0 ? Math.abs(t.amount) : '',
                Category: t.category || '', Subcategory: t.subcategory || '',
                Matched: t.matched_invoice_id ? 'Yes' : 'No',
              }));
              const ws = XLSX.utils.json_to_sheet(rows);
              ws['!cols'] = [{wch:12},{wch:50},{wch:14},{wch:14},{wch:16},{wch:16},{wch:8}];
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Egypt Bank');
              XLSX.writeFile(wb, `Egypt-Bank-Export-${todayET()}.xlsx`);
            }} className="text-[10px] text-blue-500 font-semibold">📥 Export Excel</button>
          </div>

          {/* Transaction List */}
          {/* Bulk Action Bar */}
          {selectedTxns.size > 0 && (
            <div className="bg-blue-50 rounded-xl p-3 mb-2 border border-blue-200">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <span className="text-xs font-bold text-blue-800">{selectedTxns.size} selected</span>
                <button onClick={() => setSelectedTxns(new Set())} className="text-[10px] text-slate-500 font-semibold">✕ Clear</button>
              </div>
              {/* Bulk Categorize */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[10px] font-bold text-slate-600">Bulk Category:</span>
                <select id="bulkCat" className="text-[10px] border rounded px-2 py-1 bg-white" defaultValue="">
                  <option value="">Select...</option>
                  {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en}</option>)}
                </select>
                <input id="bulkSub" placeholder="Subcategory" className="text-[10px] border rounded px-2 py-1 bg-white" style={{ maxWidth: 100 }} />
                <button onClick={async () => {
                  const cat = document.getElementById('bulkCat').value;
                  const sub = document.getElementById('bulkSub').value.trim();
                  if (!cat && !sub) { alert('Select a category or enter subcategory'); return; }
                  const updates = {};
                  if (cat) updates.category = cat;
                  if (sub) updates.subcategory = sub;
                  const ids = [...selectedTxns];
                  await supabase.from('egypt_bank_transactions').update(updates).in('id', ids);
                  setTransactions(prev => prev.map(t => selectedTxns.has(t.id) ? {...t, ...updates} : t));
                  setSelectedTxns(new Set());
                }} className="px-3 py-1 bg-blue-500 text-white rounded-lg text-[10px] font-bold">Apply</button>
                <button onClick={async () => {
                  const ids = [...selectedTxns];
                  await supabase.from('egypt_bank_transactions').update({ category: null, subcategory: null }).in('id', ids);
                  setTransactions(prev => prev.map(t => selectedTxns.has(t.id) ? {...t, category: '', subcategory: ''} : t));
                  setSelectedTxns(new Set());
                }} className="px-3 py-1 bg-amber-100 text-amber-900 border border-amber-400 rounded-lg text-[10px] font-bold">✕ Clear Category</button>
              </div>
              {/* Super Admin: Delete + Hide */}
              {isSuperAdmin && (
                <div className="flex gap-2">
                  <button onClick={async () => {
                    if (!confirm(`Delete ${selectedTxns.size} transactions permanently?`)) return;
                    const ids = [...selectedTxns];
                    await supabase.from('egypt_bank_transactions').delete().in('id', ids);
                    setTransactions(prev => prev.filter(t => !selectedTxns.has(t.id)));
                    setSelectedTxns(new Set());
                  }} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-bold">🗑️ Delete</button>
                  <button onClick={async () => {
                    const ids = [...selectedTxns];
                    await supabase.from('egypt_bank_transactions').update({ hidden: true }).in('id', ids);
                    setTransactions(prev => prev.map(t => selectedTxns.has(t.id) ? {...t, hidden: true} : t));
                    setSelectedTxns(new Set());
                  }} className="px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-bold">🔒 Hide</button>
                </div>
              )}
            </div>
          )}

          {/* Show Hidden toggle (Super Admin) + Select All (Everyone) */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {isSuperAdmin && (
              <button onClick={() => { setShowHidden(!showHidden); setSelectedTxns(new Set()); }}
                className={'px-3 py-1 rounded-lg text-[10px] font-semibold ' + (showHidden ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500')}>
                {showHidden ? '🔓 Showing Hidden' : '🔒 Show Hidden'}
              </button>
            )}
            {isSuperAdmin && showHidden && <span className="text-[10px] text-slate-500">{transactions.filter(t => t.hidden).length} hidden</span>}
            {filtered.length > 0 && (
              <button onClick={() => {
                if (selectedTxns.size === filtered.length) setSelectedTxns(new Set());
                else setSelectedTxns(new Set(filtered.map(t => t.id)));
              }} className="text-[10px] text-blue-500 font-semibold ml-auto">
                {selectedTxns.size === filtered.length ? '☐ Deselect All' : '☑ Select All'}
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              {transactions.length === 0 ? 'No transactions yet. Import a bank statement.' : 'No transactions match your filters.'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.slice(0, 200).map(t => {
                const isDeposit = t.amount > 0;
                const matchedInv = t.matched_invoice_id ? (invoices || []).find(i => i.id === t.matched_invoice_id) : null;
                const accName = getAccName(t.account_id);
                const isSelected = selectedTxns.has(t.id);
                const isHidden = t.hidden;
                return (
                  <div key={t.id} className="bg-white rounded-xl p-3 shadow-sm border" style={{ opacity: isHidden ? 0.5 : 1, borderColor: isSelected ? '#3b82f6' : isHidden ? '#fca5a5' : undefined, borderWidth: isSelected ? 2 : 1 }}>
                    <div className="flex items-start gap-2">
                      {/* Checkbox */}
                      <input type="checkbox" checked={isSelected} onChange={() => {
                        const next = new Set(selectedTxns);
                        if (isSelected) next.delete(t.id); else next.add(t.id);
                        setSelectedTxns(next);
                      }} className="mt-1 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        {/* Full description — no truncate */}
                        <div className="font-semibold text-sm" style={{ wordBreak: 'break-word' }}>{t.description || '—'}</div>
                        <div className="text-[10px] text-slate-500">
                          {t.date} {accName ? `• ${accName}` : ''}{isHidden ? ' • 🔒 Hidden' : ''}
                        </div>
                        {/* Category / Subcategory */}
                        <div className="flex items-center gap-1 mt-1">
                          <select value={t.category || ''} onChange={async (e) => {
                            const v = e.target.value;
                            await dbUpdate('egypt_bank_transactions', t.id, { category: v }, myId);
                            setTransactions(prev => prev.map(x => x.id === t.id ? {...x, category: v} : x));
                          }} className="text-[10px] border rounded px-1.5 py-0.5 bg-slate-50" style={{ maxWidth: 120 }}>
                            <option value="">+ Category</option>
                            {Object.entries(EXPENSE_CATS).map(([ar, en]) => <option key={ar} value={ar}>{en} ({ar})</option>)}
                          </select>
                          <input value={t.subcategory || ''} placeholder="subcategory"
                            onBlur={async (e) => {
                              const v = e.target.value.trim();
                              if (v !== (t.subcategory || '')) {
                                await dbUpdate('egypt_bank_transactions', t.id, { subcategory: v }, myId);
                                setTransactions(prev => prev.map(x => x.id === t.id ? {...x, subcategory: v} : x));
                              }
                            }}
                            onChange={(e) => setTransactions(prev => prev.map(x => x.id === t.id ? {...x, subcategory: e.target.value} : x))}
                            className="text-[10px] border rounded px-1.5 py-0.5 bg-slate-50" style={{ maxWidth: 100 }} />
                        </div>
                        {matchedInv && (
                          <div className="text-[10px] text-green-600 mt-0.5">
                            ✅ Matched → {matchedInv.customer || matchedInv.invoice_number || 'Invoice'} ({fmtE(matchedInv.amount || matchedInv.total)})
                            <button onClick={() => unmatch(t.id)} className="ml-1 text-red-400 underline">unmatch</button>
                          </div>
                        )}
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <div className={'font-bold text-sm ' + (isDeposit ? 'text-green-600' : 'text-red-600')}>
                          {isDeposit ? '+' : ''}{fmtE(t.amount)}
                        </div>
                        {!t.matched_invoice_id && (
                          <button onClick={() => { setMatchingTxn(t); setSearchInv(''); }} className="text-[10px] text-blue-500 font-semibold mt-1">🔗 Match</button>
                        )}
                        {/* Hide/Unhide (Super Admin) */}
                        {isSuperAdmin && (
                          <button onClick={async () => {
                            await dbUpdate('egypt_bank_transactions', t.id, { hidden: !isHidden }, myId);
                            setTransactions(prev => prev.map(x => x.id === t.id ? {...x, hidden: !isHidden} : x));
                          }} className={'text-[10px] font-semibold mt-1 block ' + (isHidden ? 'text-green-500' : 'text-slate-500')}>
                            {isHidden ? '🔓 Unhide' : '🔒 Hide'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length > 200 && <p className="text-center text-xs text-slate-400 py-2">Showing first 200 of {filtered.length}</p>}
            </div>
          )}
        </div>
      )}

      {/* ===== MATCH MODAL ===== */}
      {matchingTxn && (() => {
        const txnAmt = Math.abs(matchingTxn.amount || 0);
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setMatchingTxn(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-white">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-sm">🔗 Link to Invoice / ربط بفاتورة</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {matchingTxn.description} — {matchingTxn.date}
                  </p>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">
                    {matchingTxn.amount > 0 ? 'Deposit' : 'Withdrawal'}: {fmtE(matchingTxn.amount)}
                  </span>
                </div>
                <button onClick={() => setMatchingTxn(null)} className="text-slate-400 text-lg hover:text-slate-600">✕</button>
              </div>
              <input type="text" value={searchInv} onChange={e => setSearchInv(e.target.value)}
                placeholder="Search by customer, order #, amount, date... / بحث بالاسم أو رقم الأمر"
                className="dark-input mt-3"
                autoFocus />
            </div>
            <div className="overflow-y-auto max-h-[55vh] p-2">
              {matchableInvoices.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-8">No invoices found / لم يتم العثور على فواتير</p>
              ) : matchableInvoices.map(inv => {
                const invAmt = Number(inv.amount || inv.total_amount || inv.total || 0);
                const isExactMatch = Math.abs(invAmt - txnAmt) < 1;
                const outstanding = Number(inv.outstanding || 0);
                const collected = Number(inv.total_collected || 0);
                return (
                  <button key={inv.id} onClick={() => matchToInvoice(matchingTxn.id, inv.id)}
                    className={'w-full text-left p-3 rounded-lg hover:bg-blue-50 border-b last:border-0 transition ' + (isExactMatch ? 'bg-emerald-50/50 border-emerald-100' : '')}>
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-xs truncate">{inv.customer || inv.customer_name || inv.customer_name_en || 'N/A'}</span>
                          {isExactMatch && <span className="px-1 py-0.5 bg-emerald-200 text-emerald-800 rounded text-[8px] font-bold flex-shrink-0">EXACT MATCH</span>}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          #{inv.invoice_number || inv.order_number || '—'} • {inv.invoice_date || inv.date || '—'}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className="font-bold text-sm text-blue-600">{fmtE(invAmt)}</div>
                        <div className="text-[10px]">
                          <span className="text-emerald-600">Paid: {fmtE(collected)}</span>
                          {outstanding > 0 && <span className="text-red-500 ml-1">Owed: {fmtE(outstanding)}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        );
      })()}

      {/* v55.83-A.6.15 — Import History (super-admin only) */}
      {view === 'history' && isSuperAdmin && (
        <ImportHistoryView supabase={supabase} accounts={accounts} myId={myId} toast={toast} onReload={onReload} reload={load} />
      )}

      {/* v55.83-A.6.15 — Bulk Delete Modal */}
      {bulkDeleteOpen && isSuperAdmin && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={function () { if (!bulkDeleteWorking) setBulkDeleteOpen(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl" onClick={function (e) { e.stopPropagation(); }}>
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-red-700">🗑 Bulk Delete Bank Transactions</h3>
              <p className="text-[11px] text-slate-500 mt-1">حذف معاملات بنكية بالجملة — اختر الحساب والتاريخ، ثم عاين قبل الحذف</p>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Bank Account / الحساب البنكي</label>
                <select value={bulkDeleteAccountId} onChange={function (e) { setBulkDeleteAccountId(e.target.value); setBulkDeleteImpact(null); }}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs">
                  <option value="">— Select account / اختر حسابًا —</option>
                  {accounts.map(function (a) { return <option key={a.id} value={a.id}>{a.bank_name} — {a.account_number}</option>; })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">From date / من تاريخ</label>
                  <input type="date" value={bulkDeleteFrom} onChange={function (e) { setBulkDeleteFrom(e.target.value); setBulkDeleteImpact(null); }}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">To date / إلى تاريخ</label>
                  <input type="date" value={bulkDeleteTo} onChange={function (e) { setBulkDeleteTo(e.target.value); setBulkDeleteImpact(null); }}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Reason / سبب الحذف <span className="text-red-600">*</span></label>
                <textarea value={bulkDeleteReason} onChange={function (e) { setBulkDeleteReason(e.target.value); }}
                  placeholder="e.g. Imported same statement to wrong account on May 13"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs" rows={2} />
              </div>

              <div className="flex gap-2">
                <button onClick={computeBulkDeleteImpact} disabled={bulkDeleteWorking || !bulkDeleteAccountId || !bulkDeleteFrom || !bulkDeleteTo}
                  className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold">
                  🔍 Preview Impact / عاين التأثير
                </button>
              </div>

              {bulkDeleteImpact && (
                <div className="bg-amber-50 border-2 border-amber-300 rounded p-3">
                  <div className="font-bold text-amber-900 text-sm mb-2">Impact preview / معاينة التأثير:</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-slate-600">Rows to delete:</span> <span className="font-bold text-red-700">{bulkDeleteImpact.count}</span></div>
                    <div><span className="text-slate-600">Total amount:</span> <span className="font-bold text-red-700">EGP {bulkDeleteImpact.sum.toLocaleString()}</span></div>
                    <div><span className="text-slate-600">Treasury rows affected:</span> <span className="font-bold text-amber-700">{bulkDeleteImpact.treasury_rows}</span></div>
                    <div><span className="text-slate-600">Invoices affected:</span> <span className="font-bold text-amber-700">{bulkDeleteImpact.invoices}</span></div>
                  </div>
                  <div className="text-[10px] text-amber-800 mt-2">Treasury rows will be unmatched (kept), but invoice totals will recalc after reload. Audit log entry is created with your reason. الخزنة ستفصل، الإجمالي يُعاد حسابه.</div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button onClick={function () { setBulkDeleteOpen(false); setBulkDeleteImpact(null); setBulkDeleteReason(''); }} disabled={bulkDeleteWorking}
                  className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-bold">
                  Cancel / إلغاء
                </button>
                <button onClick={executeBulkDelete} disabled={bulkDeleteWorking || !bulkDeleteImpact || !bulkDeleteReason || bulkDeleteReason.length < 5}
                  className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold">
                  {bulkDeleteWorking ? 'Working...' : '🗑 Confirm Delete / تأكيد الحذف'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// IMPORT HISTORY VIEW (v55.83-A.6.15)
// Shows last 10 bank import batches with one-click rollback.
// =====================================================================
function ImportHistoryView({ supabase, accounts, myId, toast, onReload, reload }) {
  var [batches, setBatches] = useState([]);
  var [loading, setLoading] = useState(true);
  var [working, setWorking] = useState(false);
  var [error, setError] = useState(null);

  function loadBatches() {
    setLoading(true);
    setError(null);
    supabase.from('bank_import_batches')
      .select('id, imported_by, imported_at, account_id, row_count, total_amount, status, rolled_back_at, rolled_back_by, notes')
      .order('imported_at', { ascending: false })
      .limit(20)
      .then(function (resp) {
        if (resp.error) {
          // Table may not exist yet — show friendly message
          setError(resp.error.message || 'Could not load import history');
          setBatches([]);
        } else {
          setBatches(resp.data || []);
        }
        setLoading(false);
      })
      .catch(function (e) {
        setError(e.message || String(e));
        setLoading(false);
      });
  }

  useEffect(function () { loadBatches(); }, []);

  function accountLabel(accId) {
    var a = (accounts || []).find(function (x) { return x.id === accId; });
    return a ? (a.bank_name + ' — ' + a.account_number) : (accId ? accId.substring(0, 8) : '—');
  }

  async function rollbackBatch(batch) {
    if (batch.status === 'rolled_back') { alert('This batch is already rolled back'); return; }
    if (!confirm('Roll back this import? ALL ' + batch.row_count + ' bank rows from this batch will be deleted (totaling EGP ' + Number(batch.total_amount || 0).toLocaleString() + '). Affected invoices recalc on reload. Continue? / تراجع عن الاستيراد؟')) return;
    setWorking(true);
    try {
      // 1. Find the bank rows tagged with this batch_id
      var rowsResp = await supabase.from('egypt_bank_transactions').select('id').eq('import_batch_id', batch.id);
      var bankIds = (rowsResp.data || []).map(function (r) { return r.id; });
      if (bankIds.length === 0) {
        alert('No rows found tagged with this batch. The import may pre-date batch tracking, or the rows were already deleted.');
        setWorking(false);
        return;
      }
      // 2. Find affected invoices BEFORE unmatch
      var tBefore = (await supabase.from('treasury').select('linked_invoice_id').in('matched_bank_txn_id', bankIds)).data || [];
      var invoiceIds = Array.from(new Set(tBefore.map(function (t) { return t.linked_invoice_id; }).filter(Boolean)));
      // 3. Unmatch treasury rows
      await supabase.from('treasury').update({ matched_bank_txn_id: null }).in('matched_bank_txn_id', bankIds);
      // 4. Audit
      try {
        await supabase.from('audit_log').insert({
          user_id: myId,
          entity_type: 'egypt_bank_transactions',
          action: 'batch_rollback',
          details: {
            batch_id: batch.id,
            rolled_row_count: bankIds.length,
            sum: batch.total_amount,
            invoices_affected: invoiceIds.length,
            invoice_ids: invoiceIds,
            source: 'v55.83-A.6.15 ImportHistoryView rollback',
          },
          created_at: new Date().toISOString(),
        });
      } catch (_) {}
      // 5. Delete the bank rows
      await supabase.from('egypt_bank_transactions').delete().in('id', bankIds);
      // 6. Mark the batch as rolled back
      await supabase.from('bank_import_batches').update({
        status: 'rolled_back',
        rolled_back_at: new Date().toISOString(),
        rolled_back_by: myId,
      }).eq('id', batch.id);
      toast && toast.success && toast.success('Batch rolled back — ' + bankIds.length + ' rows removed, ' + invoiceIds.length + ' invoices need recalc / تم التراجع');
      loadBatches();
      if (onReload) await onReload();
      if (reload) await reload();
    } catch (e) {
      alert('Rollback failed: ' + (e.message || e));
    }
    setWorking(false);
  }

  return (
    <div>
      <div className="bg-white rounded-xl p-4 mb-3">
        <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
          <h3 className="text-sm font-bold">📜 Import History <span className="text-slate-400 font-normal">/ سجل الاستيراد</span></h3>
          <button onClick={loadBatches} disabled={loading}
            className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 text-[10px] font-bold">
            {loading ? '⏳' : '🔄'} Refresh / تحديث
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mb-3">
          Most recent 20 bank import batches. Click "Roll back" to undo an entire import. Only super-admin. /
          آخر 20 استيراد بنكي. يمكنك التراجع عن استيراد كامل. للمسؤول فقط.
        </p>

        {error && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-3">
            <div className="text-xs font-bold text-amber-900 mb-1">⚠️ Batch tracking not set up yet</div>
            <div className="text-[10px] text-amber-800 mb-2">
              The <code className="bg-amber-100 px-1 rounded">bank_import_batches</code> table doesn't exist. Run the v55.83-A.6.15 SQL migration in Supabase to enable batch tracking and rollback.
              لم يتم إعداد تتبع الدفعات بعد. شغّل SQL الإعداد في Supabase.
            </div>
            <div className="text-[9px] font-mono text-amber-900">Error: {error}</div>
          </div>
        )}

        {!error && batches.length === 0 && !loading && (
          <div className="text-center py-6 text-sm text-slate-500">No import batches yet / لا يوجد سجل استيراد بعد</div>
        )}

        {batches.length > 0 && (
          <div className="overflow-auto max-h-[500px] border border-slate-200 rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-2 py-2 text-left text-[10px]">When / متى</th>
                  <th className="px-2 py-2 text-left text-[10px]">Account / حساب</th>
                  <th className="px-2 py-2 text-right text-[10px]">Rows / صفوف</th>
                  <th className="px-2 py-2 text-right text-[10px]">Total / إجمالي</th>
                  <th className="px-2 py-2 text-left text-[10px]">Status / الحالة</th>
                  <th className="px-2 py-2 text-center text-[10px]">Action / إجراء</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(function (b) {
                  return (
                    <tr key={b.id} className={'border-b border-slate-50 ' + (b.status === 'rolled_back' ? 'bg-slate-50 opacity-60' : '')}>
                      <td className="px-2 py-2 text-[10px] whitespace-nowrap">{(b.imported_at || '').substring(0, 16).replace('T', ' ')}</td>
                      <td className="px-2 py-2 text-[10px]">{accountLabel(b.account_id)}</td>
                      <td className="px-2 py-2 text-right font-bold">{b.row_count}</td>
                      <td className="px-2 py-2 text-right font-mono">EGP {Number(b.total_amount || 0).toLocaleString()}</td>
                      <td className="px-2 py-2 text-[10px]">
                        {b.status === 'rolled_back' ? (
                          <span className="px-1 py-0.5 rounded bg-red-100 text-red-800 text-[9px] font-bold">↩️ Rolled back {(b.rolled_back_at || '').substring(0, 10)}</span>
                        ) : (
                          <span className="px-1 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">✓ Active</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {b.status === 'rolled_back' ? (
                          <span className="text-[10px] text-slate-500">—</span>
                        ) : (
                          <button onClick={function () { rollbackBatch(b); }} disabled={working}
                            className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[10px] font-bold">
                            🗑 Roll back
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
