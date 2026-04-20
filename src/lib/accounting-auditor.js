// ============================================================
// AI ACCOUNTANT — DETERMINISTIC AUDIT LIBRARY
// Pure function. Runs a full reconciliation sweep across:
// treasury, invoices, checks, Egypt bank, warehouse, debts.
// Returns categorized findings with severity, bilingual text,
// amount impact, affected record IDs, and suggested actions.
//
// Deterministic (not AI): guarantees correctness of the math.
// AI layer sits on top in a separate API route for interpretation.
// ============================================================

// ---------- Helpers ----------
function sum(arr, fn) {
  var t = 0;
  for (var i = 0; i < arr.length; i++) t += Number(fn(arr[i]) || 0);
  return t;
}

function fmtEGP(n) {
  return 'EGP ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function daysBetween(a, b) {
  var d1 = new Date(a), d2 = new Date(b);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return Infinity;
  return Math.abs(d1 - d2) / 86400000;
}

// Is this treasury row "counted" toward invoice collected?
// A row counts when it's not a placeholder, not a dedup marker, and carries
// positive inflow in EITHER safe (cash_in) or bank (bank_in).
function isCountedTowardCollected(t) {
  if (t.is_bank_placeholder) return false;
  var d = String(t.description || '');
  if (d.indexOf('[bank confirmation') >= 0) return false;
  return (Number(t.cash_in || 0) + Number(t.bank_in || 0)) > 0;
}

// Is this treasury row a dedup/bank-confirmation marker?
function isDedupMarker(t) {
  return String(t.description || '').indexOf('[bank confirmation') >= 0;
}

// ---------- Main auditor ----------
export function runAccountingAudit(data) {
  data = data || {};
  var treasury = data.treasury || [];
  var invoices = data.invoices || [];
  var checks = data.checks || [];
  var egyptBankTxns = data.egyptBankTxns || [];
  var warehouse = data.warehouse || [];
  var customers = data.customers || [];
  var debts = data.debts || [];

  var findings = [];
  var metrics = {};

  // ---------- Build lookups ----------
  var invoicesById = {};
  var invoicesByOrder = {};
  for (var i = 0; i < invoices.length; i++) {
    invoicesById[invoices[i].id] = invoices[i];
    if (invoices[i].order_number) invoicesByOrder[invoices[i].order_number] = invoices[i];
  }
  var treasuryByInvoiceId = {};
  for (var t = 0; t < treasury.length; t++) {
    var tr = treasury[t];
    if (tr.linked_invoice_id) {
      if (!treasuryByInvoiceId[tr.linked_invoice_id]) treasuryByInvoiceId[tr.linked_invoice_id] = [];
      treasuryByInvoiceId[tr.linked_invoice_id].push(tr);
    }
  }
  var treasuryById = {};
  for (var ti = 0; ti < treasury.length; ti++) treasuryById[treasury[ti].id] = treasury[ti];

  var checksByTreasuryId = {};
  for (var c = 0; c < checks.length; c++) {
    if (checks[c].linked_treasury_id) checksByTreasuryId[checks[c].linked_treasury_id] = checks[c];
  }

  var bankByTreasuryId = {};
  for (var b = 0; b < egyptBankTxns.length; b++) {
    if (egyptBankTxns[b].matched_treasury_id) bankByTreasuryId[egyptBankTxns[b].matched_treasury_id] = egyptBankTxns[b];
  }

  var todayStr = new Date().toISOString().substring(0, 10);

  // ============================================================
  // CRITICAL CHECKS
  // ============================================================

  // C1: Over-collected invoices
  var overCollected = [];
  for (var oi = 0; oi < invoices.length; oi++) {
    var inv = invoices[oi];
    var total = Number(inv.total_amount || 0);
    var collected = Number(inv.total_collected || 0);
    if (total > 0 && collected > total + 0.01) {
      overCollected.push({
        invoice_id: inv.id,
        customer: inv.customer_name,
        order: inv.order_number,
        total: total,
        collected: collected,
        excess: collected - total
      });
    }
  }
  if (overCollected.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'OVER_COLLECTED_INVOICE',
      titleEn: overCollected.length + ' invoice(s) collected MORE than their total',
      titleAr: overCollected.length + ' فاتورة محصّلة بأكثر من إجمالها',
      descEn: 'Collected amount exceeds invoice total. Either the invoice total is wrong, or one or more treasury entries are linked to the wrong invoice.',
      descAr: 'المبلغ المحصّل يتجاوز إجمالي الفاتورة. إما أن إجمالي الفاتورة غير صحيح، أو أن أحد قيود الخزنة مرتبط بفاتورة خاطئة.',
      totalImpact: sum(overCollected, function (o) { return o.excess; }),
      count: overCollected.length,
      items: overCollected.slice(0, 20),
      actionEn: 'Open each flagged invoice → review its treasury entries → unlink any that belong to a different order.',
      actionAr: 'افتح كل فاتورة مُعلَّمة → راجع قيود خزنتها → أزل الربط لأي قيد يخص طلبًا آخر.'
    });
  }

  // C2: Corrupted rows — a single row should hold money in EXACTLY ONE of the
  // four amount columns (cash_in | cash_out | bank_in | bank_out). Any row
  // with 2+ populated amount columns is data corruption.
  var corrupted = treasury.filter(function (tr) {
    var populated = 0;
    if (Number(tr.cash_in  || 0) > 0) populated++;
    if (Number(tr.cash_out || 0) > 0) populated++;
    if (Number(tr.bank_in  || 0) > 0) populated++;
    if (Number(tr.bank_out || 0) > 0) populated++;
    return populated >= 2;
  });
  if (corrupted.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'CORRUPTED_ROW',
      titleEn: corrupted.length + ' treasury row(s) with multiple populated amount columns',
      titleAr: corrupted.length + ' قيد يحتوي على أكثر من خانة مبلغ',
      descEn: 'A row should have money in ONE column only (cash_in OR cash_out OR bank_in OR bank_out). Populating multiple inflates gross totals, breaks category reports, and leaks bank amounts into the safe balance.',
      descAr: 'القيد يجب أن يحتوي على مبلغ في خانة واحدة فقط. تسجيل مبالغ في أكثر من خانة يشوّه الإجماليات ويسرّب قيود البنك إلى رصيد الخزنة.',
      totalImpact: sum(corrupted, function (x) {
        var amounts = [Number(x.cash_in || 0), Number(x.cash_out || 0), Number(x.bank_in || 0), Number(x.bank_out || 0)]
          .filter(function (a) { return a > 0; })
          .sort(function (a, b) { return a - b; });
        // impact = sum of the smaller amounts (the ones that shouldn't be there)
        return amounts.slice(0, -1).reduce(function (a, b) { return a + b; }, 0);
      }),
      count: corrupted.length,
      items: corrupted.slice(0, 20).map(function (x) { return { id: x.id, date: x.transaction_date, cash_in: x.cash_in, cash_out: x.cash_out, bank_in: x.bank_in, bank_out: x.bank_out, description: (x.description || '').substring(0, 60) }; }),
      actionEn: 'Open each row in Treasury → decide which single column should hold the amount → zero out the rest.',
      actionAr: 'افتح كل قيد → حدّد الخانة الصحيحة للمبلغ → صفّر بقية الخانات.'
    });
  }

  // C3: Duplicate treasury entries
  var dupeKey = {};
  var dupes = [];
  for (var dt = 0; dt < treasury.length; dt++) {
    var tr2 = treasury[dt];
    if (isDedupMarker(tr2)) continue; // these are intentional
    if (tr2.is_bank_placeholder) continue;
    var amt = Number(tr2.cash_in || 0) + Number(tr2.cash_out || 0) + Number(tr2.bank_in || 0) + Number(tr2.bank_out || 0);
    if (amt === 0) continue;
    var key = (tr2.transaction_date || '') + '|' + amt + '|' + (tr2.order_number || '') + '|' + (tr2.description || '').substring(0, 40);
    if (dupeKey[key]) {
      dupes.push({ original: dupeKey[key], duplicate: tr2, amount: amt });
    } else {
      dupeKey[key] = tr2;
    }
  }
  if (dupes.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'DUPLICATE_TREASURY',
      titleEn: dupes.length + ' likely duplicate treasury entries',
      titleAr: dupes.length + ' قيد خزنة مُكرَّر محتمل',
      descEn: 'Multiple rows share the same date, amount, order #, and description. May double-count income or expense.',
      descAr: 'عدة قيود تشترك في نفس التاريخ والمبلغ ورقم الأمر والوصف. قد تُحتسب الدخل أو المصروف مرتين.',
      totalImpact: sum(dupes, function (d) { return d.amount; }),
      count: dupes.length,
      items: dupes.slice(0, 15).map(function (d) { return { id: d.duplicate.id, original_id: d.original.id, date: d.duplicate.transaction_date, amount: d.amount, description: (d.duplicate.description || '').substring(0, 60) }; }),
      actionEn: 'Inspect each pair → if truly duplicate, delete one. If legitimate (e.g., customer paid twice), append distinguishing text to descriptions.',
      actionAr: 'افحص كل زوج → إن كان مكررًا فعلاً، احذف أحدهما. إن كان مشروعًا (مثلاً: العميل دفع مرتين)، أضف نصًا مميزًا للأوصاف.'
    });
  }

  // C4: Broken references — treasury links to non-existent invoice
  var brokenRefs = [];
  for (var br = 0; br < treasury.length; br++) {
    var tr3 = treasury[br];
    if (tr3.linked_invoice_id && !invoicesById[tr3.linked_invoice_id]) {
      brokenRefs.push(tr3);
    }
  }
  if (brokenRefs.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'BROKEN_INVOICE_REF',
      titleEn: brokenRefs.length + ' treasury row(s) linked to deleted invoices',
      titleAr: brokenRefs.length + ' قيد خزنة مرتبط بفواتير محذوفة',
      descEn: 'The invoice these rows point to no longer exists. Collected totals are orphaned.',
      descAr: 'الفاتورة المرتبطة لم تعد موجودة. المبالغ المحصّلة معزولة.',
      totalImpact: sum(brokenRefs, function (x) { return Number(x.cash_in || 0) + Number(x.bank_in || 0); }),
      count: brokenRefs.length,
      items: brokenRefs.slice(0, 20).map(function (x) { return { id: x.id, date: x.transaction_date, cash_in: x.cash_in, bank_in: x.bank_in, ghost_invoice_id: x.linked_invoice_id }; }),
      actionEn: 'Unlink from the deleted invoice, then either delete the treasury row or relink to the correct invoice.',
      actionAr: 'أزل الربط بالفاتورة المحذوفة، ثم احذف القيد أو أعد ربطه بالفاتورة الصحيحة.'
    });
  }

  // C5: Collected checks with no treasury link
  var orphanCollectedChecks = checks.filter(function (ch) {
    return ch.status === 'collected' && !ch.linked_treasury_id;
  });
  if (orphanCollectedChecks.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'COLLECTED_CHECK_NO_TREASURY',
      titleEn: orphanCollectedChecks.length + ' collected check(s) with no treasury entry',
      titleAr: orphanCollectedChecks.length + ' شيك محصّل بدون قيد خزنة',
      descEn: 'These checks are marked collected but nobody recorded the money in treasury. Treasury net is understated.',
      descAr: 'هذه الشيكات مُحصَّلة لكن لم يُسجَّل المبلغ في الخزنة. صافي الخزنة أقل من الواقع.',
      totalImpact: sum(orphanCollectedChecks, function (x) { return Number(x.amount || 0); }),
      count: orphanCollectedChecks.length,
      items: orphanCollectedChecks.slice(0, 20).map(function (x) { return { id: x.id, customer: x.customer_name, check_number: x.check_number, amount: x.amount, collection_date: x.collection_date }; }),
      actionEn: 'Either re-collect the check from the Checks tab (which will create the treasury entry), or manually add a treasury row and link it.',
      actionAr: 'إما أعد تحصيل الشيك من تبويب الشيكات (ليُنشئ قيد الخزنة)، أو أضف قيد خزنة يدويًا واربطه.'
    });
  }

  // C6: Ambiguous dedup — matched bank row with zero amounts (cash AND bank) AND no identifiable sibling
  // This is the "ghost dedup" case: dedup fired but the original sibling was deleted or never existed
  var ambiguousDedup = [];
  for (var ad = 0; ad < treasury.length; ad++) {
    var trA = treasury[ad];
    // Only consider rows that got matched with a bank txn AND have zero amount in every column
    if (!trA.matched_bank_txn_id) continue;
    var trATotal = Number(trA.cash_in || 0) + Number(trA.cash_out || 0) + Number(trA.bank_in || 0) + Number(trA.bank_out || 0);
    if (trATotal > 0) continue;
    if (trA.is_bank_placeholder) continue;
    // Try to find the sibling the dedup was pointing at
    var sibling = null;
    // 1. Explicit column
    if (trA.dedup_sibling_id) {
      sibling = treasuryById[trA.dedup_sibling_id] || null;
    }
    // 2. Parse description
    if (!sibling) {
      var m2 = String(trA.description || '').match(/dedup_sibling=([a-f0-9-]+)/i);
      if (m2) sibling = treasuryById[m2[1]] || null;
    }
    // 3. Heuristic search — sibling must have inflow in either channel
    if (!sibling && trA.linked_invoice_id) {
      sibling = treasury.find(function (s) {
        return s.id !== trA.id &&
          s.linked_invoice_id === trA.linked_invoice_id &&
          !s.is_bank_placeholder &&
          (Number(s.cash_in || 0) + Number(s.bank_in || 0)) > 0 &&
          !isDedupMarker(s);
      }) || null;
    }
    // Confirm the bank txn actually had money
    var bankTxn = egyptBankTxns.find(function (b) { return b.id === trA.matched_bank_txn_id; });
    var bankAmt = bankTxn ? Number(bankTxn.amount || 0) : 0;
    // Flag only if bank had real money AND we can't find any sibling explaining where it went
    if (!sibling && Math.abs(bankAmt) > 0) {
      ambiguousDedup.push({
        treasury_id: trA.id,
        transaction_date: trA.transaction_date,
        bank_txn_id: trA.matched_bank_txn_id,
        bank_amount: bankAmt,
        linked_invoice_id: trA.linked_invoice_id,
        description: String(trA.description || '').substring(0, 80)
      });
    }
  }
  if (ambiguousDedup.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'AMBIGUOUS_DEDUP',
      titleEn: ambiguousDedup.length + ' zeroed treasury row(s) with missing original entry',
      titleAr: ambiguousDedup.length + ' قيد خزنة مُصفّر بدون القيد الأصلي',
      descEn: 'These rows were matched with a real bank deposit, but the treasury cash_in was zeroed because the system believed a duplicate existed. That duplicate can no longer be found — meaning the bank deposit was REAL MONEY that is now uncounted in treasury net. Most likely causes: (1) the original sibling row was deleted, (2) the dedup fired on an unrelated same-amount row, (3) multiple placeholders existed for the same bank deposit.',
      descAr: 'هذه القيود تمت مطابقتها مع إيداع بنكي حقيقي، لكن تم تصفير المبلغ لأن النظام اعتقد بوجود قيد مُكرّر. هذا القيد المُكرّر لم يعد موجودًا — مما يعني أن الإيداع البنكي كان أموالًا حقيقية غير محتسبة الآن في صافي الخزنة. الأسباب المحتملة: (1) حُذف القيد الأصلي الشقيق، (2) دالة التكرار أطلقت على قيد غير ذي صلة بنفس المبلغ، (3) وجود عدة قيود مؤقتة لنفس الإيداع.',
      totalImpact: sum(ambiguousDedup, function (x) { return Math.abs(x.bank_amount); }),
      count: ambiguousDedup.length,
      items: ambiguousDedup.slice(0, 20),
      actionEn: 'For each: look up the bank_txn_id in Egypt Bank to confirm the real deposit amount. Then UPDATE the treasury row to restore the amount into bank_in (since this came from a bank deposit, not the safe) and remove the [bank confirmation...] tag from description. Finally, re-open the linked invoice to recalc collected.',
      actionAr: 'لكل حالة: ابحث عن bank_txn_id في بنك مصر للتأكد من المبلغ. ثم حدّث قيد الخزنة ليعيد المبلغ في خانة bank_in (لأنه من إيداع بنكي وليس من الخزنة)، وأزل وسم [bank confirmation]. أخيرًا، افتح الفاتورة لإعادة حساب المحصّل.'
    });
  }

  // C7: Duplicate placeholders for the same expected deposit
  // (The root cause of Mouhamed's سعيد عبد الغنى bug)
  var duplicatePlaceholders = [];
  var placeholderKey = {};
  for (var dp = 0; dp < treasury.length; dp++) {
    var ph = treasury[dp];
    if (!ph.is_bank_placeholder) continue;
    var expAmtP = Number(ph.expected_amount || 0);
    if (expAmtP === 0) continue;
    // Key by expected amount + approximate date (±3 days) + order if present
    var dayKey = ph.transaction_date ? ph.transaction_date.substring(0, 10) : '';
    var key2 = expAmtP + '|' + dayKey + '|' + (ph.order_number || '');
    // Also try fuzzy by name token
    var nameToken = String(ph.description || '').split(/\s+/).slice(0, 3).join(' ');
    var key3 = expAmtP + '|' + dayKey + '|' + nameToken;
    if (placeholderKey[key2] || placeholderKey[key3]) {
      duplicatePlaceholders.push({
        treasury_id: ph.id,
        duplicate_of: (placeholderKey[key2] || placeholderKey[key3]).id,
        expected_amount: expAmtP,
        date: dayKey,
        description: String(ph.description || '').substring(0, 60)
      });
    } else {
      placeholderKey[key2] = ph;
      placeholderKey[key3] = ph;
    }
  }
  if (duplicatePlaceholders.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'DUPLICATE_PLACEHOLDER',
      titleEn: duplicatePlaceholders.length + ' duplicate bank placeholder(s) for the same expected deposit',
      titleAr: duplicatePlaceholders.length + ' قيد مؤقت مُكرّر لنفس الإيداع المتوقع',
      descEn: 'Multiple placeholders were created for what looks like the same expected bank deposit. When the real bank transaction arrives, only one placeholder will match — the other will sit stale forever, AND the dedup logic may mistakenly reference it.',
      descAr: 'تم إنشاء عدة قيود مؤقتة لما يبدو أنه نفس الإيداع البنكي المتوقع. عند وصول المعاملة البنكية الحقيقية، سيُطابَق قيد واحد فقط — والآخر سيبقى معلقًا للأبد، وقد تُشير إليه دالة التكرار بالخطأ.',
      totalImpact: sum(duplicatePlaceholders, function (x) { return x.expected_amount; }),
      count: duplicatePlaceholders.length,
      items: duplicatePlaceholders.slice(0, 20),
      actionEn: 'For each pair: verify they are the same expected deposit, then delete the duplicate. Keep only one placeholder per real expected bank transaction.',
      actionAr: 'لكل زوج: تأكد من أنهما نفس الإيداع المتوقع، ثم احذف المكرر. احتفظ بقيد مؤقت واحد فقط لكل معاملة بنكية متوقعة.'
    });
  }

  // ============================================================
  // WARNING CHECKS
  // ============================================================

  // W1: Invoice collected mismatch — the big one
  var mismatches = [];
  for (var mi = 0; mi < invoices.length; mi++) {
    var invM = invoices[mi];
    var total2 = Number(invM.total_amount || 0);
    if (total2 <= 0) continue;
    var linked = treasuryByInvoiceId[invM.id] || [];
    // Egypt bank entries matched to this invoice (not already in treasury as a real row)
    var bankMatched = egyptBankTxns.filter(function (bt) { return bt.matched_invoice_id === invM.id && !bt.matched_treasury_id; });
    var treasurySum = sum(linked.filter(isCountedTowardCollected), function (x) { return x.cash_in; });
    var bankSum = sum(bankMatched, function (x) { return Number(x.amount || 0); });
    var actualCollected = treasurySum + bankSum;
    var storedCollected = Number(invM.total_collected || 0);
    var delta = Math.abs(actualCollected - storedCollected);
    // Skip noise from rounding
    if (delta > 1) {
      mismatches.push({
        invoice_id: invM.id,
        customer: invM.customer_name,
        order: invM.order_number,
        total: total2,
        stored: storedCollected,
        computed: actualCollected,
        delta: actualCollected - storedCollected
      });
    }
  }
  if (mismatches.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'INVOICE_COLLECTED_MISMATCH',
      titleEn: mismatches.length + ' invoice(s) where stored collected ≠ sum of linked payments',
      titleAr: mismatches.length + ' فاتورة: المحصّل المخزَّن ≠ مجموع الدفعات المرتبطة',
      descEn: 'Invoice.total_collected does not match the actual sum of its linked treasury + bank entries. Usually caused by direct DB edits or an old dedup bug.',
      descAr: 'الحقل total_collected على الفاتورة لا يطابق مجموع قيود الخزنة والبنك المرتبطة. عادةً بسبب تعديلات مباشرة على قاعدة البيانات أو خطأ قديم.',
      totalImpact: sum(mismatches, function (x) { return Math.abs(x.delta); }),
      count: mismatches.length,
      items: mismatches.slice(0, 20),
      actionEn: 'Run a bulk recalc: for each flagged invoice, open it to trigger the built-in recalcInvoiceCollected, or run a SQL update from the linked treasury sums.',
      actionAr: 'شغّل إعادة حساب شاملة: افتح كل فاتورة مُعلَّمة لتشغيل إعادة الحساب التلقائية، أو نفّذ تحديث SQL من مجاميع الخزنة المرتبطة.'
    });
  }

  // W2: Old bank placeholders (waiting > 14 days)
  var oldPlaceholders = treasury.filter(function (tr) {
    if (!tr.is_bank_placeholder) return false;
    if (tr.matched_bank_txn_id) return false;
    var age = daysBetween(tr.transaction_date, todayStr);
    return age > 14;
  });
  if (oldPlaceholders.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'STALE_BANK_PLACEHOLDER',
      titleEn: oldPlaceholders.length + ' bank placeholder(s) awaiting confirmation for 14+ days',
      titleAr: oldPlaceholders.length + ' قيد بنكي مؤقت ينتظر التأكيد منذ أكثر من 14 يومًا',
      descEn: 'A customer indicated a deposit would arrive, but no matching bank transaction appeared. Either the deposit failed or the bank statement wasn\'t imported.',
      descAr: 'أشار العميل إلى إيداع قادم، لكن لم تظهر معاملة بنكية مطابقة. إما أن الإيداع لم يتم أو أن كشف البنك لم يُستورد.',
      totalImpact: sum(oldPlaceholders, function (x) { return Number(x.expected_amount || 0); }),
      count: oldPlaceholders.length,
      items: oldPlaceholders.slice(0, 20).map(function (x) { return { id: x.id, date: x.transaction_date, amount: x.expected_amount, description: (x.description || '').substring(0, 60), order: x.order_number }; }),
      actionEn: 'Follow up with customer OR import latest Egypt Bank statement OR cancel the placeholder.',
      actionAr: 'تابع مع العميل أو استورد أحدث كشف بنكي أو ألغِ القيد المؤقت.'
    });
  }

  // W3: Bounced checks whose treasury row still has inflow (cash OR bank)
  var bouncedWithMoney = [];
  for (var bc = 0; bc < checks.length; bc++) {
    if (checks[bc].status === 'bounced' && checks[bc].linked_treasury_id) {
      var linkedTr = treasuryById[checks[bc].linked_treasury_id];
      if (linkedTr && (Number(linkedTr.cash_in || 0) + Number(linkedTr.bank_in || 0)) > 0) {
        bouncedWithMoney.push({ check: checks[bc], treasury: linkedTr });
      }
    }
  }
  if (bouncedWithMoney.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'BOUNCED_CHECK_STILL_COUNTED',
      titleEn: bouncedWithMoney.length + ' bounced check(s) still counted',
      titleAr: bouncedWithMoney.length + ' شيك مرتجع لا يزال محتسبًا',
      descEn: 'The check bounced but the treasury entry was never reversed. Collected/net is overstated.',
      descAr: 'الشيك ارتد لكن لم يُعكس قيد الخزنة. المبلغ المحصّل/الصافي أعلى من الواقع.',
      totalImpact: sum(bouncedWithMoney, function (x) { return Number(x.treasury.cash_in || 0) + Number(x.treasury.bank_in || 0); }),
      count: bouncedWithMoney.length,
      items: bouncedWithMoney.slice(0, 15).map(function (x) { return { check_id: x.check.id, treasury_id: x.treasury.id, customer: x.check.customer_name, cash_in: x.treasury.cash_in, bank_in: x.treasury.bank_in }; }),
      actionEn: 'For each: either delete the treasury row, or zero the inflow column (cash_in OR bank_in) and add a note "check bounced — reversed".',
      actionAr: 'لكل حالة: احذف قيد الخزنة أو صفّر خانة الوارد (cash_in أو bank_in) وأضف ملاحظة "شيك مرتجع — عُكس".'
    });
  }

  // W4: Dedup markers without an identifiable sibling
  var orphanDedup = [];
  for (var od = 0; od < treasury.length; od++) {
    var tr4 = treasury[od];
    if (!isDedupMarker(tr4)) continue;
    if (!tr4.linked_invoice_id) continue;
    var siblings = (treasuryByInvoiceId[tr4.linked_invoice_id] || []).filter(function (s) {
      return s.id !== tr4.id && !isDedupMarker(s) && !s.is_bank_placeholder && (Number(s.cash_in || 0) + Number(s.bank_in || 0)) > 0;
    });
    if (siblings.length === 0) orphanDedup.push(tr4);
  }
  if (orphanDedup.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'ORPHAN_DEDUP',
      titleEn: orphanDedup.length + ' dedup row(s) with no visible original entry',
      titleAr: orphanDedup.length + ' قيد مكرَّر لا يُقابله قيد أصلي',
      descEn: 'These rows are tagged as "bank confirmation only" but no sibling entry on the same invoice carries the money. The original may have been deleted.',
      descAr: 'هذه القيود موسومة بأنها "تأكيد بنكي فقط" لكن لا يوجد قيد أصلي يحمل المبلغ. ربما حُذف القيد الأصلي.',
      count: orphanDedup.length,
      items: orphanDedup.slice(0, 15).map(function (x) { return { id: x.id, date: x.transaction_date, description: (x.description || '').substring(0, 60), order: x.order_number }; }),
      actionEn: 'Inspect each. If the original was wrongly deleted, restore it by un-zeroing this row\'s cash_in and removing the dedup tag.',
      actionAr: 'افحص كل حالة. إن حُذف الأصل خطأً، استعِد المبلغ بإزالة وسم التكرار وإعادة تعبئة الوارد.'
    });
  }

  // W5: Pending checks past due with no bank match suggestion
  var overdueNoMatch = [];
  for (var pc = 0; pc < checks.length; pc++) {
    var ch = checks[pc];
    if (ch.status !== 'pending') continue;
    var due = ch.due_date || ch.check_date;
    if (!due || due >= todayStr) continue;
    if (daysBetween(due, todayStr) < 7) continue; // only flag >7 days overdue
    overdueNoMatch.push(ch);
  }
  if (overdueNoMatch.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'OVERDUE_PENDING_CHECK',
      titleEn: overdueNoMatch.length + ' pending check(s) overdue by 7+ days',
      titleAr: overdueNoMatch.length + ' شيك معلق متأخر أكثر من 7 أيام',
      descEn: 'Checks past due date with no collection recorded. Either reconcile the deposit or contact the customer.',
      descAr: 'شيكات تجاوزت تاريخ الاستحقاق ولم تُحصَّل. إما طابق الإيداع أو تواصل مع العميل.',
      totalImpact: sum(overdueNoMatch, function (x) { return Number(x.amount || 0); }),
      count: overdueNoMatch.length,
      items: overdueNoMatch.slice(0, 15).map(function (x) { return { id: x.id, customer: x.customer_name, amount: x.amount, due_date: x.due_date || x.check_date, check_number: x.check_number }; }),
      actionEn: 'Upload the latest Egypt Bank statement to let the auto-matcher pair them, or mark each as collected/bounced manually.',
      actionAr: 'ارفع أحدث كشف بنك مصر ليقوم المطابق التلقائي بمعالجتها، أو صنّف كل شيك يدويًا.'
    });
  }

  // W6: Customer debt vs outstanding invoices mismatch
  var debtMismatches = [];
  var outstandingByCustomer = {};
  for (var ioc = 0; ioc < invoices.length; ioc++) {
    var invO = invoices[ioc];
    var cname = invO.customer_name;
    if (!cname) continue;
    if (!outstandingByCustomer[cname]) outstandingByCustomer[cname] = 0;
    outstandingByCustomer[cname] += Math.max(0, Number(invO.outstanding || 0));
  }
  for (var dd = 0; dd < debts.length; dd++) {
    var dbt = debts[dd];
    var actualDebt = outstandingByCustomer[dbt.customer_name] || 0;
    var recordedDebt = Number(dbt.total_debt || 0);
    if (Math.abs(actualDebt - recordedDebt) > 10) {
      debtMismatches.push({
        customer: dbt.customer_name,
        recorded: recordedDebt,
        computed: actualDebt,
        delta: actualDebt - recordedDebt
      });
    }
  }
  if (debtMismatches.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'DEBT_MISMATCH',
      titleEn: debtMismatches.length + ' customer(s) with debt ≠ sum of outstanding invoices',
      titleAr: debtMismatches.length + ' عميل: الدين ≠ مجموع الفواتير المستحقة',
      descEn: 'The Debts tab value differs from what the invoices say. Debts tab may be stale.',
      descAr: 'قيمة تبويب المديونيات تختلف عن مجموع الفواتير. قد يكون التبويب قديمًا.',
      count: debtMismatches.length,
      items: debtMismatches.slice(0, 20),
      actionEn: 'Either update the Debts tab manually or treat invoice outstanding as source of truth.',
      actionAr: 'حدّث تبويب المديونيات يدويًا أو اعتبر رصيد الفواتير المرجع الأساسي.'
    });
  }

  // ============================================================
  // INFO / SUGGESTIONS
  // ============================================================

  // I1: Unmatched bank credits that look like pending-check matches
  var pendingChecks = checks.filter(function (ch) { return ch.status === 'pending' && !ch.linked_treasury_id; });
  var unmatchedBankCredits = egyptBankTxns.filter(function (bt) { return Number(bt.amount || 0) > 0 && !bt.matched_treasury_id; });
  var suggestions = [];
  for (var sb = 0; sb < unmatchedBankCredits.length; sb++) {
    var bank = unmatchedBankCredits[sb];
    var bankAmt = Number(bank.amount);
    for (var spc = 0; spc < pendingChecks.length; spc++) {
      var candidate = pendingChecks[spc];
      var chkAmt = Number(candidate.amount);
      if (Math.abs(bankAmt - chkAmt) > Math.max(chkAmt * 0.01, 1)) continue;
      var due2 = candidate.due_date || candidate.check_date;
      if (!due2) continue;
      if (daysBetween(due2, bank.date) > 5) continue;
      var desc = String(bank.description || '').toLowerCase();
      var hasSignal = (candidate.check_number && desc.indexOf(String(candidate.check_number).toLowerCase()) >= 0)
        || (candidate.order_number && desc.indexOf(String(candidate.order_number).toLowerCase()) >= 0)
        || (candidate.customer_name && desc.indexOf(String(candidate.customer_name).split(/\s+/)[0].toLowerCase()) >= 0);
      if (!hasSignal) continue;
      suggestions.push({ bank: bank, check: candidate });
      break; // one suggestion per bank txn
    }
  }
  if (suggestions.length > 0) {
    findings.push({
      severity: 'info',
      code: 'AUTO_MATCH_CANDIDATE',
      titleEn: suggestions.length + ' bank credit(s) look like pending-check matches',
      titleAr: suggestions.length + ' إيداع بنكي يبدو مطابقًا لشيكات معلقة',
      descEn: 'These bank transactions have the same amount, a close date, and a description signal pointing to a pending check. The auto-matcher should catch these on next page load — if it doesn\'t, inspect manually.',
      descAr: 'معاملات بنكية بنفس المبلغ وتاريخ قريب ووصف يشير إلى شيك معلق. المطابق التلقائي سيعالجها في التحميل القادم — إن لم يفعل، افحص يدويًا.',
      totalImpact: sum(suggestions, function (s) { return Number(s.check.amount); }),
      count: suggestions.length,
      items: suggestions.slice(0, 10).map(function (s) { return { bank_id: s.bank.id, bank_date: s.bank.date, check_id: s.check.id, customer: s.check.customer_name, amount: s.check.amount }; }),
      actionEn: 'Trigger the auto-matcher by refreshing the Treasury or Egypt Bank tab.',
      actionAr: 'شغّل المطابق التلقائي بإعادة فتح تبويب الخزنة أو بنك مصر.'
    });
  }

  // I2: Unlinked treasury inflow (cash OR bank) that might match an outstanding invoice
  var unlinkedIn = treasury.filter(function (tr) {
    var inflow = Number(tr.cash_in || 0) + Number(tr.bank_in || 0);
    return inflow > 0 && !tr.linked_invoice_id && !tr.is_bank_placeholder && !isDedupMarker(tr);
  });
  var invoiceLinkSuggestions = [];
  var outstandingInvoices = invoices.filter(function (inv) { return Number(inv.outstanding || 0) > 0; });
  for (var ul = 0; ul < Math.min(unlinkedIn.length, 200); ul++) { // cap to avoid n*m blowup
    var u = unlinkedIn[ul];
    var uAmt = Number(u.cash_in || 0) + Number(u.bank_in || 0);
    var uChannel = Number(u.bank_in || 0) > 0 ? 'bank' : 'cash';
    for (var oii = 0; oii < outstandingInvoices.length; oii++) {
      var cand = outstandingInvoices[oii];
      if (cand.order_number && u.order_number && cand.order_number === u.order_number) {
        invoiceLinkSuggestions.push({ treasury: u, invoice: cand, reason: 'same_order', channel: uChannel, amount: uAmt });
        break;
      }
      if (cand.customer_name && u.description && String(u.description).indexOf(cand.customer_name) >= 0
        && Math.abs(Number(cand.outstanding) - uAmt) < uAmt * 0.02) {
        invoiceLinkSuggestions.push({ treasury: u, invoice: cand, reason: 'customer_name+amount', channel: uChannel, amount: uAmt });
        break;
      }
    }
  }
  if (invoiceLinkSuggestions.length > 0) {
    findings.push({
      severity: 'info',
      code: 'INVOICE_LINK_SUGGEST',
      titleEn: invoiceLinkSuggestions.length + ' unlinked payment(s) likely belong to an outstanding invoice',
      titleAr: invoiceLinkSuggestions.length + ' دفعة غير مربوطة بفاتورة تبدو أنها تخص فاتورة مستحقة',
      descEn: 'Treasury entries with inflow (cash_in or bank_in) but no invoice link, yet match an outstanding invoice by order number or customer name + amount.',
      descAr: 'قيود خزنة/بنك واردة بدون ربط بفاتورة، لكنها تطابق فاتورة مستحقة برقم الأمر أو اسم العميل والمبلغ.',
      totalImpact: sum(invoiceLinkSuggestions, function (x) { return x.amount; }),
      count: invoiceLinkSuggestions.length,
      items: invoiceLinkSuggestions.slice(0, 15).map(function (x) { return { treasury_id: x.treasury.id, invoice_id: x.invoice.id, customer: x.invoice.customer_name, order: x.invoice.order_number, amount: x.amount, channel: x.channel, reason: x.reason }; }),
      actionEn: 'Treasury tab → open each row → use 🔗 Link to connect it to the suggested invoice.',
      actionAr: 'تبويب الخزنة → افتح كل قيد → استخدم 🔗 ربط لربطه بالفاتورة المقترحة.'
    });
  }

  // I4: Orphan order numbers — treasury rows with inflow that reference an order_number
  // for which no invoice exists yet. Money is tracked but not credited to any invoice.
  // These auto-resolve when the matching invoice is created (backfill logic in page.jsx).
  var orphanOrders = [];
  var orderNumberSet = {};
  for (var oi = 0; oi < invoices.length; oi++) {
    if (invoices[oi].order_number) orderNumberSet[String(invoices[oi].order_number).trim()] = true;
  }
  for (var orp = 0; orp < treasury.length; orp++) {
    var trO = treasury[orp];
    var orpInflow = Number(trO.cash_in || 0) + Number(trO.bank_in || 0);
    if (orpInflow <= 0) continue;
    if (trO.is_bank_placeholder) continue;
    if (isDedupMarker(trO)) continue;
    if (trO.linked_invoice_id) continue;
    var orpOrder = String(trO.order_number || '').trim();
    if (!orpOrder) continue;
    if (orderNumberSet[orpOrder]) continue; // invoice exists but not linked — I2 handles this
    orphanOrders.push({
      treasury_id: trO.id,
      date: trO.transaction_date,
      order_number: orpOrder,
      channel: Number(trO.bank_in || 0) > 0 ? 'bank' : 'cash',
      amount: orpInflow,
      description: String(trO.description || '').substring(0, 60),
      customer_hint: String(trO.description || '').split(/[\[\(]/)[0].trim().substring(0, 40),
    });
  }
  if (orphanOrders.length > 0) {
    // Group by order_number so Max can see total per missing invoice
    var grouped = {};
    for (var g = 0; g < orphanOrders.length; g++) {
      var o = orphanOrders[g];
      if (!grouped[o.order_number]) grouped[o.order_number] = { order_number: o.order_number, total: 0, count: 0, rows: [] };
      grouped[o.order_number].total += o.amount;
      grouped[o.order_number].count++;
      grouped[o.order_number].rows.push(o);
    }
    var groupedArr = Object.keys(grouped).map(function(k){ return grouped[k]; });
    findings.push({
      severity: 'info',
      code: 'ORPHAN_ORDER_NUMBER',
      titleEn: orphanOrders.length + ' treasury row(s) waiting for missing invoice(s) — ' + groupedArr.length + ' unique order(s)',
      titleAr: orphanOrders.length + ' قيد خزنة ينتظر إنشاء فاتورة — ' + groupedArr.length + ' أمر فريد',
      descEn: 'These rows have inflow against an order# but no matching invoice exists yet. The money IS tracked (bank ledger and/or safe net) but is NOT credited to any invoice.total_collected. Creating the invoice will auto-link all waiting rows.',
      descAr: 'هذه القيود تحمل مبالغ واردة على أرقام أوامر بدون فواتير مقابلة. المبلغ مسجّل (في البنك أو الخزنة) لكنه غير محتسب في تحصيل أي فاتورة. إنشاء الفاتورة سيربط القيود المنتظرة تلقائيًا.',
      totalImpact: sum(orphanOrders, function(x){ return x.amount; }),
      count: orphanOrders.length,
      items: groupedArr.slice(0, 20).map(function(x){ return { order_number: x.order_number, total: x.total, rows_waiting: x.count, customer_hint: x.rows[0].customer_hint }; }),
      actionEn: 'For each missing order, either create the invoice (Sales → Add Invoice with matching order#) to auto-link all waiting rows, OR unlink the treasury rows if the order# is wrong. Treasury tab shows these with a ⏳ WAITING FOR INVOICE badge.',
      actionAr: 'لكل أمر: إما أنشئ الفاتورة (مبيعات → إضافة فاتورة بنفس رقم الأمر) ليتم الربط تلقائيًا، أو أزل الربط إن كان رقم الأمر خطأ. هذه القيود تظهر في الخزنة بشارة ⏳ بانتظار الفاتورة.'
    });
  }

  // I3: Zero-amount treasury rows (likely USD pending import) — check all four channels
  var zeroEGP = treasury.filter(function (tr) {
    return Number(tr.cash_in || 0) === 0
      && Number(tr.cash_out || 0) === 0
      && Number(tr.bank_in || 0) === 0
      && Number(tr.bank_out || 0) === 0
      && Number(tr.usd_in || 0) === 0
      && Number(tr.usd_out || 0) === 0
      && Number(tr.foreign_amount || 0) === 0
      && !tr.is_bank_placeholder
      && !isDedupMarker(tr);
  });
  if (zeroEGP.length > 0) {
    findings.push({
      severity: 'info',
      code: 'ZERO_AMOUNT_ROWS',
      titleEn: zeroEGP.length + ' treasury row(s) with no amount in any currency or channel',
      titleAr: zeroEGP.length + ' قيد خزنة بدون مبلغ بأي عملة أو قناة',
      descEn: 'Could be rows imported from the USD column of the Arabic Excel that are still waiting for the USD import SQL to run. Run import_usd_transactions.sql in Supabase.',
      descAr: 'قد تكون قيودًا مستوردة من عمود الدولار في ملف Excel تنتظر تشغيل import_usd_transactions.sql في Supabase.',
      count: zeroEGP.length,
      items: zeroEGP.slice(0, 10).map(function (x) { return { id: x.id, date: x.transaction_date, description: (x.description || '').substring(0, 60), order: x.order_number }; }),
      actionEn: 'Run the pending USD import SQL in Supabase.',
      actionAr: 'شغّل ملف استيراد الدولار في Supabase.'
    });
  }

  // ============================================================
  // OVERALL METRICS
  // treasuryNet = SAFE only (cash_in - cash_out). Bank net tracked separately.
  // ============================================================
  metrics.treasuryNet = sum(treasury, function (x) { return Number(x.cash_in || 0) - Number(x.cash_out || 0); });
  metrics.bankNet     = sum(treasury, function (x) { return Number(x.bank_in || 0) - Number(x.bank_out || 0); });
  metrics.totalBankIn  = sum(treasury, function (x) { return Number(x.bank_in  || 0); });
  metrics.totalBankOut = sum(treasury, function (x) { return Number(x.bank_out || 0); });
  metrics.totalInvoiceValue = sum(invoices, function (x) { return Number(x.total_amount || 0); });
  metrics.totalInvoiceCollected = sum(invoices, function (x) { return Number(x.total_collected || 0); });
  metrics.totalOutstanding = sum(invoices, function (x) { return Math.max(0, Number(x.outstanding || 0)); });
  metrics.pendingChecksTotal = sum(checks.filter(function (ch) { return ch.status === 'pending'; }), function (x) { return Number(x.amount || 0); });
  metrics.collectedChecksTotal = sum(checks.filter(function (ch) { return ch.status === 'collected'; }), function (x) { return Number(x.amount || 0); });
  metrics.unmatchedBankCount = unmatchedBankCredits.length;
  metrics.treasuryRowCount = treasury.length;
  metrics.invoiceRowCount = invoices.length;
  metrics.pendingCheckCount = pendingChecks.length;

  // Count by severity
  var bySeverity = { critical: 0, warning: 0, info: 0 };
  for (var f = 0; f < findings.length; f++) bySeverity[findings[f].severity]++;

  return {
    generatedAt: new Date().toISOString(),
    findings: findings,
    bySeverity: bySeverity,
    metrics: metrics,
    totalFindings: findings.length,
    cleanBillOfHealth: findings.filter(function (x) { return x.severity !== 'info'; }).length === 0
  };
}
