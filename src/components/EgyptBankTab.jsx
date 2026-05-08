'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import * as XLSX from 'xlsx';
import { EXPENSE_CATS } from '../lib/utils';
import { todayET } from '../lib/et-time';

export default function EgyptBankTab({ toast, user, userProfile, isAdmin, invoices, onReload }) {
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

  const doImport = async () => {
    let accId = importAccount;
    if (!accId && accounts.length > 0) { accId = accounts[0].id; setImportAccount(accId); }
    if (!accId) {
      try {
        const { data: newAcc } = await dbInsert('egypt_bank_accounts', { bank_name: 'Default Bank', account_number: 'AUTO-001', currency: 'EGP' }, myId);
        if (newAcc) { accId = newAcc.id; setImportAccount(accId); }
      } catch(err) { alert('Create an account first'); return; }
    }
    if (!accId) { alert('Select an account first'); return; }
    const toImport = importData.filter(r => r._include);
    if (toImport.length === 0) { alert('No rows selected'); return; }
    setImportStep('importing');
    let imported = 0, skipped = 0, duplicates = 0;
    
    // Load existing transactions for duplicate detection
    const { data: existing } = await supabase.from('egypt_bank_transactions').select('date, description, amount').eq('account_id', accId);
    const existingSet = new Set((existing || []).map(e => `${e.date}|${e.amount}|${(e.description || '').substring(0, 30)}`));
    
    // Filter out duplicates
    const newRows = [];
    for (const row of toImport) {
      const key = `${row.date}|${row.amount}|${(row.description || '').substring(0, 30)}`;
      if (existingSet.has(key)) { duplicates++; skipped++; }
      else { newRows.push({ account_id: accId, date: row.date, description: row.description, amount: row.amount, imported_by: myId }); existingSet.add(key); }
    }
    
    // Batch insert in chunks of 100
    for (let i = 0; i < newRows.length; i += 100) {
      const chunk = newRows.slice(i, i + 100);
      try {
        const { error } = await supabase.from('egypt_bank_transactions').insert(chunk);
        if (error) skipped += chunk.length; else imported += chunk.length;
      } catch(e) { skipped += chunk.length; }
    }
    setImportStats({ imported, skipped, duplicates, total: toImport.length });
    setImportStep('done');
    await logActivity(myId, `Imported ${imported} Egypt bank transactions (${duplicates} duplicates skipped)`, 'finance');
    await load();
    // Auto-categorize new transactions based on existing patterns
    await autoCategorizeTxns();
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
  const matchToInvoice = async (txnId, invoiceId) => {
    const txn = transactions.find(t => t.id === txnId);
    const inv = (invoices || []).find(i => i.id === invoiceId);
    await dbUpdate('egypt_bank_transactions', txnId, { matched_invoice_id: invoiceId, matched_at: new Date().toISOString(), matched_by: myId }, myId);
    
    if (inv && txn && txn.amount > 0) {
      const bankAmt = Number(txn.amount);
      
      // Check if a pending check exists for same order + similar amount → auto-collect it
      try {
        const { data: pendingChecks } = await supabase.from('checks')
          .select('*')
          .eq('invoice_id', invoiceId)
          .eq('status', 'pending');
        
        const matchingCheck = (pendingChecks || []).find(c => 
          Math.abs(Number(c.amount) - bankAmt) < 1 // Exact match — checks must be the exact amount
        );
        
        if (matchingCheck) {
          // Auto-collect the check — the bank confirmed it
          await dbUpdate('checks', matchingCheck.id, {
            status: 'collected',
            collection_date: txn.date || todayET(),
          }, myId);
          // Update invoice collected (check wasn't counted before, bank confirms it now)
          const newCollected = Number(inv.total_collected || 0) + bankAmt;
          const capped = Math.min(newCollected, Number(inv.total_amount || 0));
          await dbUpdate('invoices', invoiceId, { 
            total_collected: capped,
            outstanding: Math.max(0, Number(inv.total_amount || 0) - capped),
          }, myId);
        } else {
          // No matching check — check if this amount was already collected (dedup)
          const existingCollected = Number(inv.total_collected || 0);
          // Only add if it wouldn't exceed invoice total
          const newCollected = Math.min(existingCollected + bankAmt, Number(inv.total_amount || 0));
          if (newCollected > existingCollected) {
            await dbUpdate('invoices', invoiceId, { 
              total_collected: newCollected,
              outstanding: Math.max(0, Number(inv.total_amount || 0) - newCollected),
            }, myId);
          }
        }
      } catch(e) {
        // Fallback: simple add but capped
        const newCollected = Math.min(Number(inv.total_collected || 0) + bankAmt, Number(inv.total_amount || 0));
        await dbUpdate('invoices', invoiceId, { total_collected: newCollected }, myId);
      }
    }
    
    setMatchingTxn(null);
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matched_invoice_id: invoiceId, matched_at: new Date().toISOString() } : t));
    if (onReload) setTimeout(() => onReload(), 500);
  };
  const unmatch = async (txnId) => {
    const txn = transactions.find(t => t.id === txnId);
    const inv = txn?.matched_invoice_id ? (invoices || []).find(i => i.id === txn.matched_invoice_id) : null;
    await dbUpdate('egypt_bank_transactions', txnId, { matched_invoice_id: null, matched_at: null, matched_by: null }, myId);
    // Reduce invoice total_collected
    if (inv && txn && txn.amount > 0) {
      const newCollected = Math.max(0, Number(inv.total_collected || 0) - Number(txn.amount));
      await dbUpdate('invoices', inv.id, { total_collected: newCollected }, myId);
    }
    setTransactions(prev => prev.map(t => t.id === txnId ? { ...t, matched_invoice_id: null, matched_at: null } : t));
    // Refresh dashboard data
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
                      <button onClick={() => deleteAccount(a.id)} className="px-2 py-1 bg-red-50 text-red-600 rounded text-[10px] font-semibold">Delete</button>
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

          {importStep === 'importing' && (
            <div className="text-center py-12">
              <div className="text-3xl mb-2 animate-spin">⏳</div>
              <p className="text-sm font-semibold">Importing transactions...</p>
            </div>
          )}

          {importStep === 'done' && importStats && (
            <div className="bg-green-50 rounded-xl p-6 text-center border border-green-200">
              <div className="text-3xl mb-2">✅</div>
              <h3 className="font-bold text-lg text-green-800">Import Complete!</h3>
              <p className="text-sm mt-2">{importStats.imported} imported{importStats.duplicates > 0 ? `, ${importStats.duplicates} duplicates skipped` : ''}{importStats.skipped > importStats.duplicates ? `, ${importStats.skipped - (importStats.duplicates||0)} errors` : ''}</p>
              <button onClick={() => { setImportStep('select'); setImportData([]); setImportStats(null); setView('transactions'); }} className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold">View Transactions</button>
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
              <div className="text-lg font-black text-amber-700">{unmatchedCount}</div>
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
                <span className="text-xs font-bold text-amber-800">🤖 Smart Categorize Settings</span>
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
    </div>
  );
}
