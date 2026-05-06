// ============================================================
// TREASURY TRANSACTION CLASSIFIER
// Pure function. No hooks. No side effects.
// Given a treasury row + surrounding context, returns a full
// bilingual explanation of what the row represents, how it came
// to be, what it affects, and what other records it's tied to.
// ============================================================

/**
 * classifyTreasuryTransaction
 * @param {Object} txn — the treasury row
 * @param {Object} ctx — { invoices, checks, egyptBankTxns, treasury, expenseRules }
 * @returns {Object} classification with bilingual labels & related records
 */
export function classifyTreasuryTransaction(txn, ctx) {
  ctx = ctx || {};
  var invoices = ctx.invoices || [];
  var checks = ctx.checks || [];
  var egyptBankTxns = ctx.egyptBankTxns || [];
  var treasuryAll = ctx.treasury || [];

  // --- Raw feature extraction ---
  var isPlaceholder = txn.is_bank_placeholder === true;
  var matchedBankId = txn.matched_bank_txn_id || null;
  var linkedInvoiceId = txn.linked_invoice_id || null;
  var cashIn = Number(txn.cash_in || 0);
  var cashOut = Number(txn.cash_out || 0);
  var bankIn = Number(txn.bank_in || 0);
  var bankOut = Number(txn.bank_out || 0);
  var usdIn = Number(txn.usd_in || 0);
  var usdOut = Number(txn.usd_out || 0);
  var foreignAmt = Number(txn.foreign_amount || 0);
  var foreignDir = txn.foreign_direction || null;
  var foreignCur = txn.foreign_currency || null;
  var desc = String(txn.description || '');
  var descLow = desc.toLowerCase();
  var bankNonOrderCat = txn.bank_nonorder_category || null;

  var isBankConfirmationDedup = desc.indexOf('[bank confirmation') >= 0;
  var isAutoMatched = desc.indexOf('[auto-matched from bank') >= 0;
  var isCheckCollection = desc.indexOf('شيك محصّل') >= 0 || desc.indexOf('شيك محصل') >= 0;
  var isAwaitingBank = desc.indexOf('[awaiting bank confirmation]') >= 0;

  // --- Related records ---
  var invoice = linkedInvoiceId ? invoices.find(function(i) { return i.id === linkedInvoiceId; }) : null;
  var linkedCheck = checks.find(function(c) { return c.linked_treasury_id === txn.id; }) || null;
  var linkedBank = egyptBankTxns.find(function(b) { return b.matched_treasury_id === txn.id; }) || null;

  // Sibling treasury row for dedup case (the original entry that actually counted)
  var dedupSibling = null;
  if (isBankConfirmationDedup) {
    // Prefer explicit sibling ID (new hardened dedup stores this)
    if (txn.dedup_sibling_id) {
      dedupSibling = treasuryAll.find(function(t) { return t.id === txn.dedup_sibling_id; }) || null;
    }
    // Also try to extract from description ([... dedup_sibling=<uuid>])
    if (!dedupSibling) {
      var m = String(txn.description || '').match(/dedup_sibling=([a-f0-9-]+)/i);
      if (m) dedupSibling = treasuryAll.find(function(t) { return t.id === m[1]; }) || null;
    }
    // Fallback heuristic (legacy rows that don't have sibling_id stored)
    if (!dedupSibling && linkedInvoiceId) {
      dedupSibling = treasuryAll.find(function(t) {
        return t.id !== txn.id &&
          t.linked_invoice_id === linkedInvoiceId &&
          !t.is_bank_placeholder &&
          (Number(t.cash_in || 0) + Number(t.bank_in || 0)) > 0 &&
          String(t.description || '').indexOf('[bank confirmation') < 0;
      }) || null;
    }
  }

  // Split family (shares order_number with other entries created same day)
  // Any channel (cash or bank) counts — a bank-only payment is still part of a split
  var splitFamily = [];
  if (txn.order_number && (cashIn > 0 || cashOut > 0 || bankIn > 0 || bankOut > 0)) {
    splitFamily = treasuryAll.filter(function(t) {
      return t.id !== txn.id &&
        t.order_number === txn.order_number &&
        t.transaction_date === txn.transaction_date;
    });
  }

  // --- Primary classification ---
  var type, titleEn, titleAr, emoji, color, subtypeEn, subtypeAr;

  if (isPlaceholder && !matchedBankId) {
    type = 'BANK_PLACEHOLDER_AWAITING';
    titleEn = 'Expected Bank Deposit — Not Yet Received';
    titleAr = 'إيداع بنكي متوقع — لم يصل بعد';
    emoji = '⏳';
    color = 'indigo';
    subtypeEn = 'A placeholder entry. System is waiting for the real bank transaction to appear.';
    subtypeAr = 'قيد مؤقت. النظام ينتظر ظهور المعاملة البنكية الحقيقية.';
  } else if (isBankConfirmationDedup) {
    type = 'BANK_CONFIRMATION_DEDUP';
    titleEn = 'Bank Confirmation — Duplicate Detected';
    titleAr = 'تأكيد بنكي — تم اكتشاف تكرار';
    emoji = '🔗';
    color = 'slate';
    subtypeEn = 'Bank received the deposit, but the money was already counted via a previous entry (usually a check collection). This row is kept for audit only.';
    subtypeAr = 'استلم البنك الإيداع، لكن المبلغ سبق تسجيله عبر قيد آخر (عادةً تحصيل شيك). هذا القيد للأرشيف فقط.';
  } else if (isCheckCollection && isAutoMatched) {
    type = 'CHECK_AUTO_MATCHED';
    titleEn = 'Check Collection — Auto-Matched with Bank Deposit';
    titleAr = 'تحصيل شيك — متطابق تلقائيًا مع إيداع بنكي';
    emoji = '🤖';
    color = 'emerald';
    subtypeEn = 'The system found a pending check and a matching bank deposit (same amount, close date, matching description), then recorded the collection automatically.';
    subtypeAr = 'وجد النظام شيكًا معلقًا وإيداعًا بنكيًا مطابقًا (نفس المبلغ، تاريخ قريب، وصف متطابق)، ثم سجّل التحصيل تلقائيًا.';
  } else if (isCheckCollection) {
    type = 'CHECK_MANUAL_COLLECTED';
    titleEn = 'Check — Manually Marked as Collected';
    titleAr = 'شيك — محصّل يدويًا';
    emoji = '✅';
    color = 'emerald';
    subtypeEn = 'Someone marked the check collected in the Checks tab, which created this treasury entry.';
    subtypeAr = 'قام أحدهم بتحصيل الشيك من تبويب الشيكات، فتم إنشاء هذا القيد.';
  } else if (matchedBankId && !isPlaceholder && bankNonOrderCat) {
    type = 'BANK_NONORDER_CONFIRMED';
    titleEn = 'Bank ' + (bankIn > 0 ? 'Deposit' : 'Withdrawal') + ' — ' + bankNonOrderCat + ' (Verified)';
    titleAr = (bankIn > 0 ? 'إيداع' : 'سحب') + ' بنكي — ' + bankNonOrderCat + ' (متحقق)';
    emoji = '🏦';
    color = 'indigo';
    subtypeEn = 'A non-order bank movement (not tied to a sales invoice), verified against the bank statement.';
    subtypeAr = 'حركة بنكية بدون أمر بيع، تم التحقق منها من كشف البنك.';
  } else if (matchedBankId && !isPlaceholder) {
    type = 'BANK_PLACEHOLDER_MATCHED';
    titleEn = 'Bank Deposit — Received and Verified';
    titleAr = 'إيداع بنكي — مستلم ومتحقق منه';
    emoji = '🏦';
    color = 'indigo';
    subtypeEn = 'Originally entered as an expected deposit, now auto-matched with a real bank transaction. Counted toward invoice collected — NOT toward safe balance.';
    subtypeAr = 'تم إدخاله في الأصل كإيداع متوقع، ثم تم مطابقته تلقائيًا مع معاملة بنكية حقيقية. يُحتسب ضمن تحصيل الفاتورة — وليس ضمن رصيد الخزنة.';
  } else if ((bankIn > 0 || bankOut > 0) && bankNonOrderCat) {
    type = 'BANK_NONORDER_UNVERIFIED';
    titleEn = 'Bank ' + (bankIn > 0 ? 'Deposit' : 'Withdrawal') + ' — ' + bankNonOrderCat;
    titleAr = (bankIn > 0 ? 'إيداع' : 'سحب') + ' بنكي — ' + bankNonOrderCat;
    emoji = '🏦';
    color = 'indigo';
    subtypeEn = 'A non-order bank movement saved directly (not via a placeholder-match flow). Does not affect safe balance.';
    subtypeAr = 'حركة بنكية بدون أمر محفوظة مباشرة. لا تؤثر على رصيد الخزنة.';
  } else if (bankIn > 0 && linkedInvoiceId) {
    type = 'BANK_INVOICE_PAYMENT';
    titleEn = 'Bank Payment Received for Invoice';
    titleAr = 'دفعة بنكية مستلمة على فاتورة';
    emoji = '🏦';
    color = 'indigo';
    subtypeEn = 'A bank receipt credited to a customer invoice. Counted in invoice collected only — not in safe.';
    subtypeAr = 'إيداع بنكي مسجل على فاتورة العميل. يُحتسب ضمن المحصّل فقط — ليس ضمن الخزنة.';
  } else if (bankIn > 0 || bankOut > 0) {
    type = 'BANK_UNLINKED';
    titleEn = 'Bank ' + (bankIn > 0 ? 'Deposit' : 'Withdrawal') + ' — Not Linked';
    titleAr = (bankIn > 0 ? 'إيداع' : 'سحب') + ' بنكي — غير مرتبط';
    emoji = '🏦';
    color = 'indigo';
    subtypeEn = 'Bank movement with no invoice and no non-order category. Review and classify.';
    subtypeAr = 'حركة بنكية بدون فاتورة وبدون تصنيف. راجع القيد.';
  } else if (cashIn > 0 && linkedInvoiceId) {
    type = 'INVOICE_PAYMENT';
    titleEn = 'Payment Received for Invoice';
    titleAr = 'دفعة مستلمة على فاتورة';
    emoji = '💰';
    color = 'emerald';
    subtypeEn = 'A cash payment recorded directly against a customer invoice.';
    subtypeAr = 'دفعة نقدية مسجلة مباشرةً على فاتورة عميل.';
  } else if (cashIn > 0) {
    type = 'CASH_IN_UNLINKED';
    titleEn = 'Cash Received — Not Linked to an Invoice';
    titleAr = 'نقد وارد — غير مرتبط بفاتورة';
    emoji = '💵';
    color = 'emerald';
    subtypeEn = 'Cash added to treasury without a specific invoice link.';
    subtypeAr = 'نقد مضاف إلى الخزنة بدون ربط بفاتورة محددة.';
  } else if (cashOut > 0) {
    type = 'EXPENSE';
    titleEn = 'Expense — Cash Out';
    titleAr = 'مصروف — نقد صادر';
    emoji = '📤';
    color = 'red';
    subtypeEn = 'Money paid out of treasury.';
    subtypeAr = 'نقد خارج من الخزنة.';
  } else if (usdIn > 0 || usdOut > 0) {
    type = 'USD_TRANSACTION';
    titleEn = 'USD Transaction';
    titleAr = 'معاملة بالدولار';
    emoji = '💲';
    color = 'amber';
    subtypeEn = 'US dollar transaction. Not included in the EGP treasury net.';
    subtypeAr = 'معاملة بالدولار الأمريكي. غير مدرجة في صافي الخزنة بالجنيه.';
  } else if (foreignAmt > 0) {
    type = 'FOREIGN_CURRENCY';
    titleEn = (foreignCur || 'Foreign') + ' Currency Transaction';
    titleAr = 'معاملة بعملة ' + (foreignCur || 'أجنبية');
    emoji = '🌍';
    color = 'amber';
    subtypeEn = 'Transaction in a non-EGP currency. Tracked separately from the EGP treasury net.';
    subtypeAr = 'معاملة بعملة غير الجنيه. تُسجَّل بمعزل عن صافي الخزنة بالجنيه.';
  } else {
    type = 'ZERO_AMOUNT';
    titleEn = 'Zero-Amount Entry';
    titleAr = 'قيد بدون مبلغ';
    emoji = '❓';
    color = 'slate';
    subtypeEn = 'No EGP, USD, or foreign currency amount recorded. May be a pending USD row awaiting data import, or an incomplete entry.';
    subtypeAr = 'لا يوجد مبلغ مسجّل بالجنيه أو الدولار أو عملة أجنبية. قد يكون قيدًا بالدولار بانتظار الاستيراد، أو قيدًا ناقصًا.';
  }

  // --- Effect on treasury SAFE net (EGP) ---
  // Bank rows (bank_in / bank_out, placeholders, matched bank rows, bank dedup markers)
  // never affect the safe net regardless of amount — they live in a separate ledger.
  var netEffectEn, netEffectAr, netDelta;
  var isBankTypeRow = bankIn > 0 || bankOut > 0 || isPlaceholder || matchedBankId || type === 'BANK_CONFIRMATION_DEDUP';
  // Resolve a display amount for bank rows even when bank_in/bank_out are 0
  // (legacy rows pre-migration where amount still sits in cash_in or expected_amount).
  var bankDisplayAmt = bankIn > 0 ? bankIn
                       : bankOut > 0 ? bankOut
                       : Number(txn.expected_amount || 0) > 0 ? Number(txn.expected_amount || 0)
                       : cashIn > 0 ? cashIn
                       : cashOut > 0 ? cashOut
                       : 0;
  var bankDirIn = bankIn > 0 || (matchedBankId && (txn.expected_direction === 'in' || cashIn > 0));
  if (type === 'BANK_PLACEHOLDER_AWAITING') {
    netDelta = 0;
    netEffectEn = 'No effect on safe. This is a bank placeholder awaiting statement verification.';
    netEffectAr = 'بدون تأثير على الخزنة. قيد بنكي بانتظار التحقق من كشف البنك.';
  } else if (type === 'BANK_CONFIRMATION_DEDUP') {
    netDelta = 0;
    netEffectEn = 'Zero safe effect — bank confirmation of a payment already counted via another row.';
    netEffectAr = 'بدون تأثير على الخزنة — تأكيد بنكي لدفعة سبق احتسابها.';
  } else if (isBankTypeRow) {
    netDelta = 0;
    netEffectEn = 'No effect on safe balance. Bank ' + (bankDirIn ? 'In' : 'Out') + ' of ' + bankDisplayAmt.toLocaleString() + ' EGP is tracked in the bank ledger only.';
    netEffectAr = 'بدون تأثير على رصيد الخزنة. ' + (bankDirIn ? 'وارد' : 'صادر') + ' بنكي ' + bankDisplayAmt.toLocaleString() + ' ج.م مسجّل في دفتر البنك فقط.';
  } else if (cashIn > 0) {
    netDelta = cashIn;
    netEffectEn = 'Added ' + cashIn.toLocaleString() + ' EGP to safe (treasury cash).';
    netEffectAr = 'أُضيف ' + cashIn.toLocaleString() + ' ج.م إلى الخزنة.';
  } else if (cashOut > 0) {
    netDelta = -cashOut;
    netEffectEn = 'Subtracted ' + cashOut.toLocaleString() + ' EGP from safe (treasury cash).';
    netEffectAr = 'خُصم ' + cashOut.toLocaleString() + ' ج.م من الخزنة.';
  } else {
    netDelta = 0;
    netEffectEn = 'No EGP effect on safe net.';
    netEffectAr = 'بدون تأثير بالجنيه على الخزنة.';
  }

  // --- Effect on invoice total_collected ---
  // Counts both cash_in and bank_in when linked. For legacy matched rows where
  // amount sits in cash_in or expected_amount instead of bank_in, fall back so
  // the Inspector displays the correct amount and channel.
  var collectedEffectEn, collectedEffectAr, collectedDelta;
  if (!linkedInvoiceId) {
    collectedDelta = 0;
    collectedEffectEn = 'No invoice linked — collected total not affected.';
    collectedEffectAr = 'لا توجد فاتورة مرتبطة — لم يتأثر إجمالي المحصّل.';
  } else if (type === 'BANK_PLACEHOLDER_AWAITING') {
    collectedDelta = 0;
    collectedEffectEn = 'Not yet counted in collected total — waiting for bank statement.';
    collectedEffectAr = 'لم يُحتسب بعد ضمن المحصّل — بانتظار كشف البنك.';
  } else if (type === 'BANK_CONFIRMATION_DEDUP') {
    collectedDelta = 0;
    collectedEffectEn = 'Explicitly excluded from collected total (the original entry already counted).';
    collectedEffectAr = 'مستبعد صراحةً من المحصّل (القيد الأصلي هو الذي احتسب).';
  } else if (bankIn > 0) {
    collectedDelta = bankIn;
    collectedEffectEn = 'Added ' + bankIn.toLocaleString() + ' EGP to invoice collected (bank channel).';
    collectedEffectAr = 'أُضيف ' + bankIn.toLocaleString() + ' ج.م إلى محصّل الفاتورة (قناة البنك).';
  } else if (matchedBankId && bankIn === 0 && bankDisplayAmt > 0) {
    // Legacy-matched bank row — amount is in cash_in or expected_amount; still counts toward collected.
    collectedDelta = bankDisplayAmt;
    collectedEffectEn = 'Counted in invoice collected: ' + bankDisplayAmt.toLocaleString() + ' EGP (legacy matched row — amount is in cash_in/expected_amount; run bank-separation migration to move into bank_in).';
    collectedEffectAr = 'محتسب في محصّل الفاتورة: ' + bankDisplayAmt.toLocaleString() + ' ج.م (قيد قديم — المبلغ في cash_in أو expected_amount؛ شغّل ترقية الفصل البنكي لنقله إلى bank_in).';
  } else if (cashIn > 0) {
    collectedDelta = cashIn;
    collectedEffectEn = 'Added ' + cashIn.toLocaleString() + ' EGP to invoice collected (safe channel).';
    collectedEffectAr = 'أُضيف ' + cashIn.toLocaleString() + ' ج.م إلى محصّل الفاتورة (قناة الخزنة).';
  } else {
    collectedDelta = 0;
    collectedEffectEn = 'No effect on collected total.';
    collectedEffectAr = 'بدون تأثير على المحصّل.';
  }

  // --- Timeline / history ---
  var timeline = [];
  if (txn.created_at) {
    timeline.push({
      when: txn.created_at,
      labelEn: 'Created' + (txn.created_by ? ' (by user ' + String(txn.created_by).substring(0, 8) + '…)' : ''),
      labelAr: 'تم الإنشاء' + (txn.created_by ? ' (بواسطة ' + String(txn.created_by).substring(0, 8) + '…)' : '')
    });
  }
  if (txn.updated_at && txn.updated_at !== txn.created_at) {
    timeline.push({
      when: txn.updated_at,
      labelEn: 'Last updated',
      labelAr: 'آخر تحديث'
    });
  }
  if (linkedCheck && linkedCheck.collection_date) {
    timeline.push({
      when: linkedCheck.collection_date,
      labelEn: 'Check marked as collected',
      labelAr: 'تم تحصيل الشيك'
    });
  }
  if (linkedBank && linkedBank.matched_at) {
    timeline.push({
      when: linkedBank.matched_at,
      labelEn: 'Matched with bank transaction',
      labelAr: 'تمت المطابقة مع المعاملة البنكية'
    });
  }

  // --- Warnings & reconciliation health ---
  var warnings = [];
  // If linked to invoice, check whether invoice.total_collected actually includes this
  if (invoice && cashIn > 0 && type !== 'BANK_CONFIRMATION_DEDUP' && type !== 'BANK_PLACEHOLDER_AWAITING') {
    var invCollected = Number(invoice.total_collected || 0);
    var invTotal = Number(invoice.total_amount || 0);
    if (invCollected < cashIn) {
      warnings.push({
        en: 'Invoice collected (' + invCollected.toLocaleString() + ') is less than this payment (' + cashIn.toLocaleString() + '). May need recalc.',
        ar: 'المحصّل على الفاتورة (' + invCollected.toLocaleString() + ') أقل من هذه الدفعة (' + cashIn.toLocaleString() + '). قد يحتاج إعادة حساب.'
      });
    }
    if (invCollected > invTotal) {
      warnings.push({
        en: 'Invoice over-collected: ' + invCollected.toLocaleString() + ' vs total ' + invTotal.toLocaleString() + '.',
        ar: 'المحصّل يتجاوز إجمالي الفاتورة: ' + invCollected.toLocaleString() + ' مقابل ' + invTotal.toLocaleString() + '.'
      });
    }
  }
  // If dedup but no sibling found
  if (type === 'BANK_CONFIRMATION_DEDUP' && !dedupSibling) {
    warnings.push({
      en: 'Tagged as duplicate, but no matching original entry was found. Please verify.',
      ar: 'مصنّف كمكرّر، لكن لم يُعثر على القيد الأصلي المطابق. يُرجى التحقق.'
    });
  }
  // If placeholder older than 14 days
  if (type === 'BANK_PLACEHOLDER_AWAITING' && txn.transaction_date) {
    var age = (Date.now() - new Date(txn.transaction_date).getTime()) / 86400000;
    if (age > 14) {
      warnings.push({
        en: 'Placeholder is ' + Math.floor(age) + ' days old with no bank match yet. Follow up with the customer or bank.',
        ar: 'هذا القيد المؤقت عمره ' + Math.floor(age) + ' يومًا بدون مطابقة بنكية. يُستحسن المتابعة مع العميل أو البنك.'
      });
    }
  }
  // If check was collected but no treasury amount
  if (linkedCheck && linkedCheck.status === 'collected' && cashIn === 0 && type !== 'BANK_CONFIRMATION_DEDUP') {
    warnings.push({
      en: 'Check is marked collected but this treasury row has no cash_in. Possible data inconsistency.',
      ar: 'الشيك مُحصّل لكن هذا القيد بدون مبلغ وارد. قد يوجد عدم اتساق.'
    });
  }

  return {
    type: type,
    titleEn: titleEn,
    titleAr: titleAr,
    emoji: emoji,
    color: color,
    subtypeEn: subtypeEn,
    subtypeAr: subtypeAr,
    amounts: {
      cashIn: cashIn,
      cashOut: cashOut,
      usdIn: usdIn,
      usdOut: usdOut,
      foreignAmt: foreignAmt,
      foreignDir: foreignDir,
      foreignCur: foreignCur
    },
    netEffect: { en: netEffectEn, ar: netEffectAr, delta: netDelta },
    collectedEffect: { en: collectedEffectEn, ar: collectedEffectAr, delta: collectedDelta },
    related: {
      invoice: invoice,
      linkedCheck: linkedCheck,
      linkedBank: linkedBank,
      dedupSibling: dedupSibling,
      splitFamily: splitFamily
    },
    timeline: timeline,
    warnings: warnings,
    flags: {
      isPlaceholder: isPlaceholder,
      isBankConfirmationDedup: isBankConfirmationDedup,
      isAutoMatched: isAutoMatched,
      isCheckCollection: isCheckCollection,
      isAwaitingBank: isAwaitingBank,
      hasLinkedInvoice: !!linkedInvoiceId,
      hasMatchedBank: !!matchedBankId,
      hasLinkedCheck: !!linkedCheck
    }
  };
}
