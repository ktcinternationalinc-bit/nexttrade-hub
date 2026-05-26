'use client';
// v55.83-A.6.27.72 — Unified Counterparty Ledger helpers.
//
// THE MODEL (locked, per Max May 25 2026):
//   For each (account, currency) pair, the system tracks 4 pots:
//     1. theirOpenInvoices  — sales invoices we sent them, still unpaid
//     2. ourOpenBills       — vendor bills they sent us, still unpaid
//     3. theirPrepaid       — money they paid us with no invoice to apply to
//     4. ourPrepaid         — money we paid them with no bill to apply to
//
//   FIFO AUTO-APPLY rules (system applies automatically on every save):
//     • When THEY PAY US:
//         - Consume their open invoices oldest-first (settle them)
//         - Any excess to theirPrepaid pot
//     • When WE PAY THEM:
//         - Consume our open bills oldest-first (settle them)
//         - Any excess to ourPrepaid pot
//     • When WE INVOICE THEM (sales_invoice posted):
//         - Consume theirPrepaid first (they already paid)
//         - Any remainder to theirOpenInvoices pot
//     • When THEY INVOICE US (vendor_bill posted):
//         - Consume ourPrepaid first (we already paid)
//         - Any remainder to ourOpenBills pot
//
//   Net position per currency:
//     theirSide = theirOpenInvoices - theirPrepaid     (positive = they owe us)
//     ourSide   = ourOpenBills - ourPrepaid            (positive = we owe them)
//     net       = theirSide - ourSide                  (positive = in our favor)
//
//   Recomputed from scratch every time entries change.

export var TRANSACTION_TYPES = {
  // v55.83-A.6.27.72 HOTFIX 12 — Color-coding spec from Max:
  //   AR-affecting rows (sales_invoice + payment_received): BLUE description + amount
  //   AP-affecting rows (vendor_bill + payment_sent):       ORANGE description + amount
  // descCls = color class applied to the description text on the row
  // amountCls = color class applied to the AR Side / AP Side numeric cells
  sales_invoice: {
    label: 'Sales Invoice', labelAr: 'فاتورة بيع',
    sublabel: 'We billed them', sublabelAr: 'فوترناهم',
    icon: '📤', side: 'credit', cashFlow: null,
    pillCls: 'bg-blue-100 text-blue-900', rowCls: 'bg-blue-50/40',
    descCls: 'text-blue-900', amountCls: 'text-blue-800',
  },
  vendor_bill: {
    label: 'Vendor Bill', labelAr: 'فاتورة مورد',
    sublabel: 'They billed us', sublabelAr: 'فوترونا',
    icon: '📥', side: 'debit', cashFlow: null,
    pillCls: 'bg-orange-100 text-orange-900', rowCls: 'bg-orange-50/40',
    descCls: 'text-orange-900', amountCls: 'text-orange-800',
  },
  payment_received: {
    label: 'Payment Received', labelAr: 'دفعة مستلمة',
    sublabel: 'They paid us', sublabelAr: 'دفعوا لنا',
    icon: '💰', side: 'credit', cashFlow: 'in',
    pillCls: 'bg-blue-100 text-blue-900', rowCls: 'bg-blue-50/20',
    descCls: 'text-blue-900', amountCls: 'text-blue-800',
  },
  payment_sent: {
    label: 'Payment Sent', labelAr: 'دفعة مرسلة',
    sublabel: 'We paid them', sublabelAr: 'دفعنا لهم',
    icon: '💸', side: 'debit', cashFlow: 'out',
    pillCls: 'bg-orange-100 text-orange-900', rowCls: 'bg-orange-50/20',
    descCls: 'text-orange-900', amountCls: 'text-orange-800',
  },
  credit_adjustment: {
    label: 'Credit/Adjustment', labelAr: 'تعديل',
    sublabel: 'Manual adjustment', sublabelAr: 'تعديل يدوي',
    icon: '⚖️', side: null, cashFlow: null,
    pillCls: 'bg-slate-200 text-slate-800', rowCls: null,
    descCls: 'text-slate-800', amountCls: 'text-slate-800',
  },
  offset: {
    label: 'Offset', labelAr: 'مقاصة',
    sublabel: 'Balance offset', sublabelAr: 'مقاصة رصيد',
    icon: '🔄', side: null, cashFlow: null,
    pillCls: 'bg-purple-100 text-purple-900', rowCls: 'bg-purple-50',
    descCls: 'text-purple-900', amountCls: 'text-purple-800',
  },
};

export function amountSideFor(transactionType, explicitSide) {
  if (explicitSide === 'credit' || explicitSide === 'debit') return explicitSide;
  var meta = TRANSACTION_TYPES[transactionType];
  if (meta && (meta.side === 'credit' || meta.side === 'debit')) return meta.side;
  return null;
}

function entryAmount(e) {
  return Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
}

function sortChronologically(entries) {
  return entries.slice().sort(function (a, b) {
    var da = String(a.entry_date || '');
    var db = String(b.entry_date || '');
    if (da !== db) return da < db ? -1 : 1;
    var ca = String(a.created_at || '');
    var cb = String(b.created_at || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function sumRemaining(list) {
  return list.reduce(function (a, x) { return a + x.remaining; }, 0);
}

function findOpenById(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

// Heart of the system: chronological FIFO simulation
//
// v55.83-A.6.27.72 HOTFIX 1 — Defensive guards added after QA pass:
//   • Entries with null/undefined transaction_type are now treated as
//     credit_adjustment (not silently dropped). A console.warn is emitted
//     so the bug source can be tracked down.
//   • Negative amounts are clamped to 0 with a console.warn — they should
//     never happen (saveEntry validates) but if they get into the DB via
//     direct SQL edit or migration, the simulation no longer produces
//     nonsensical negative pot values.
//   • Offset entries that would over-apply (offset amount > invoice/bill
//     remaining) are clamped to what's actually remaining. The applied
//     amount no longer exceeds the original invoice amount.
export function simulate(entries) {
  var sorted = sortChronologically(entries || []);
  var state = {};      // currency -> {theirPrepaid, ourPrepaid, openInvoices, openBills}
  var applied = {};    // entryId -> amount applied
  var trail = [];
  var warnings = [];   // collected for diagnostics

  function warn(msg, ctx) {
    warnings.push({ msg: msg, context: ctx });
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[ledger.simulate] ' + msg, ctx);
    }
  }

  function getCurState(cur) {
    if (!state[cur]) {
      state[cur] = { theirPrepaid: 0, ourPrepaid: 0, openInvoices: [], openBills: [] };
    }
    return state[cur];
  }

  sorted.forEach(function (e) {
    var cur = String(e.currency || 'USD').toUpperCase();
    var s = getCurState(cur);
    var type = e.transaction_type;
    var amt = entryAmount(e);

    // GUARD 1: clamp negative amounts to 0 with warning
    if (amt < 0) {
      warn('Entry has negative amount — clamping to 0', { id: e.id, amount: amt, type: type });
      amt = 0;
    }

    // GUARD 2: null/undefined type → treat as credit_adjustment, warn
    if (!type) {
      warn('Entry has no transaction_type — treating as credit_adjustment', { id: e.id });
      type = 'credit_adjustment';
    }

    if (type === 'sales_invoice') {
      var fromPrepaid = Math.min(s.theirPrepaid, amt);
      s.theirPrepaid -= fromPrepaid;
      var remainingInvoice = amt - fromPrepaid;
      applied[e.id] = fromPrepaid;
      if (remainingInvoice > 0.001) {
        s.openInvoices.push({ id: e.id, originalAmount: amt, remaining: remainingInvoice, entry: e });
      }
    } else if (type === 'vendor_bill') {
      var fromOurPrepaid = Math.min(s.ourPrepaid, amt);
      s.ourPrepaid -= fromOurPrepaid;
      var remainingBill = amt - fromOurPrepaid;
      applied[e.id] = fromOurPrepaid;
      if (remainingBill > 0.001) {
        s.openBills.push({ id: e.id, originalAmount: amt, remaining: remainingBill, entry: e });
      }
    } else if (type === 'payment_received') {
      var cashLeft = amt;
      while (cashLeft > 0.001 && s.openInvoices.length > 0) {
        var inv = s.openInvoices[0];
        var applyAmt = Math.min(inv.remaining, cashLeft);
        inv.remaining -= applyAmt;
        applied[inv.id] = (applied[inv.id] || 0) + applyAmt;
        cashLeft -= applyAmt;
        if (inv.remaining < 0.001) s.openInvoices.shift();
      }
      if (cashLeft > 0.001) s.theirPrepaid += cashLeft;
    } else if (type === 'payment_sent') {
      var cashLeft2 = amt;
      while (cashLeft2 > 0.001 && s.openBills.length > 0) {
        var bill = s.openBills[0];
        var applyAmt2 = Math.min(bill.remaining, cashLeft2);
        bill.remaining -= applyAmt2;
        applied[bill.id] = (applied[bill.id] || 0) + applyAmt2;
        cashLeft2 -= applyAmt2;
        if (bill.remaining < 0.001) s.openBills.shift();
      }
      if (cashLeft2 > 0.001) s.ourPrepaid += cashLeft2;
    } else if (type === 'credit_adjustment') {
      var creditAmt = Math.max(0, Number(e.credit_amount || 0));
      var debitAmt = Math.max(0, Number(e.debit_amount || 0));
      if (creditAmt > 0) s.theirPrepaid += creditAmt;
      if (debitAmt > 0) s.ourPrepaid += debitAmt;
    } else if (type === 'offset') {
      var creditAmtO = Math.max(0, Number(e.credit_amount || 0));
      var debitAmtO = Math.max(0, Number(e.debit_amount || 0));
      // GUARD 3: offset_invoice_id present but invoice not in open list → warn
      // GUARD 4: clamp offset amount to actual remaining to prevent over-application
      if (e.offset_invoice_id && debitAmtO > 0) {
        var inv2 = findOpenById(s.openInvoices, e.offset_invoice_id);
        if (inv2) {
          var clampedInv = Math.min(debitAmtO, inv2.remaining);
          if (clampedInv < debitAmtO) {
            warn('Offset debit exceeds invoice remaining — clamping', {
              id: e.id, offsetAmount: debitAmtO, invoiceRemaining: inv2.remaining,
            });
          }
          inv2.remaining -= clampedInv;
          applied[inv2.id] = (applied[inv2.id] || 0) + clampedInv;
          if (inv2.remaining < 0.001) {
            var idx = s.openInvoices.indexOf(inv2);
            if (idx >= 0) s.openInvoices.splice(idx, 1);
          }
        } else {
          warn('Offset references invoice not in open pool — silently skipped (was it deleted?)', {
            id: e.id, offset_invoice_id: e.offset_invoice_id,
          });
        }
      }
      if (e.offset_bill_id && creditAmtO > 0) {
        var bill2 = findOpenById(s.openBills, e.offset_bill_id);
        if (bill2) {
          var clampedBill = Math.min(creditAmtO, bill2.remaining);
          if (clampedBill < creditAmtO) {
            warn('Offset credit exceeds bill remaining — clamping', {
              id: e.id, offsetAmount: creditAmtO, billRemaining: bill2.remaining,
            });
          }
          bill2.remaining -= clampedBill;
          applied[bill2.id] = (applied[bill2.id] || 0) + clampedBill;
          if (bill2.remaining < 0.001) {
            var idx2 = s.openBills.indexOf(bill2);
            if (idx2 >= 0) s.openBills.splice(idx2, 1);
          }
        } else {
          warn('Offset references bill not in open pool — silently skipped (was it deleted?)', {
            id: e.id, offset_bill_id: e.offset_bill_id,
          });
        }
      }
    } else {
      // Unknown transaction_type — warn and skip
      warn('Unknown transaction_type — entry ignored', { id: e.id, type: type });
    }

    trail.push({
      entry: e,
      currency: cur,
      snapshotAfter: {
        theirOpenInvoices: sumRemaining(s.openInvoices),
        ourOpenBills: sumRemaining(s.openBills),
        theirPrepaid: s.theirPrepaid,
        ourPrepaid: s.ourPrepaid,
      },
    });
  });

  var byCurrency = {};
  Object.keys(state).forEach(function (cur) {
    var s = state[cur];
    var theirOpenInvoices = sumRemaining(s.openInvoices);
    var ourOpenBills = sumRemaining(s.openBills);
    var theirSide = theirOpenInvoices - s.theirPrepaid;
    var ourSide = ourOpenBills - s.ourPrepaid;
    byCurrency[cur] = {
      currency: cur,
      theirOpenInvoices: theirOpenInvoices,
      ourOpenBills: ourOpenBills,
      theirPrepaid: s.theirPrepaid,
      ourPrepaid: s.ourPrepaid,
      netBalance: theirSide - ourSide,
      openInvoices: s.openInvoices.slice(),
      openBills: s.openBills.slice(),
    };
  });

  return {
    currencies: Object.keys(byCurrency).sort(),
    byCurrency: byCurrency,
    applications: applied,
    trail: trail,
    warnings: warnings,
  };
}

export function computePaidRemaining(entry, simulationResult) {
  if (!entry) return { amount: 0, paid: 0, remaining: 0 };
  var amount = 0;
  if (entry.transaction_type === 'sales_invoice') {
    amount = Number(entry.credit_amount || 0);
  } else if (entry.transaction_type === 'vendor_bill') {
    amount = Number(entry.debit_amount || 0);
  } else {
    return { amount: 0, paid: 0, remaining: 0 };
  }
  var paid = (simulationResult && simulationResult.applications && simulationResult.applications[entry.id]) || 0;
  var remaining = Math.max(0, amount - paid);
  return { amount: amount, paid: paid, remaining: remaining };
}

export function findOffsetCandidate(entries) {
  if (!entries || entries.length === 0) return null;
  var sim = simulate(entries);
  for (var i = 0; i < sim.currencies.length; i++) {
    var cur = sim.currencies[i];
    var bal = sim.byCurrency[cur];
    if (bal.openInvoices.length > 0 && bal.openBills.length > 0) {
      var inv = bal.openInvoices[0];
      var bill = bal.openBills[0];
      var amt = Math.min(inv.remaining, bill.remaining);
      return {
        currency: cur,
        invoice: inv.entry,
        invoiceRemaining: inv.remaining,
        bill: bill.entry,
        billRemaining: bill.remaining,
        offsetAmount: amt,
      };
    }
  }
  return null;
}

export function validateOffsetable(entries) {
  if (!entries || entries.length === 0) return [];
  var sim = simulate(entries);
  return sim.currencies.filter(function (cur) {
    var b = sim.byCurrency[cur];
    return b.openInvoices.length > 0 && b.openBills.length > 0;
  });
}

export function buildOffsetEntries(candidate, todayIso, userId) {
  if (!candidate) return [];
  var pairId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : ('offset-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  var dateStr = todayIso || new Date().toISOString().substring(0, 10);
  var ref = 'OFFSET-' + dateStr.replace(/-/g, '');
  var entry1 = {
    account_id: candidate.invoice.account_id,
    entry_date: dateStr,
    description: 'Offset of ' + (candidate.invoice.reference_number || 'invoice') +
                 ' against ' + (candidate.bill.reference_number || 'bill'),
    reference_number: ref,
    transaction_type: 'offset',
    credit_amount: null,
    debit_amount: candidate.offsetAmount,
    currency: candidate.currency,
    offset_pair_id: pairId,
    offset_invoice_id: candidate.invoice.id,
    offset_bill_id: candidate.bill.id,
    notes: 'Auto-offset ' + candidate.currency + ' ' + candidate.offsetAmount.toFixed(2),
    created_by: userId,
  };
  var entry2 = {
    account_id: candidate.bill.account_id,
    entry_date: dateStr,
    description: 'Offset of ' + (candidate.bill.reference_number || 'bill') +
                 ' against ' + (candidate.invoice.reference_number || 'invoice'),
    reference_number: ref,
    transaction_type: 'offset',
    credit_amount: candidate.offsetAmount,
    debit_amount: null,
    currency: candidate.currency,
    offset_pair_id: pairId,
    offset_invoice_id: candidate.invoice.id,
    offset_bill_id: candidate.bill.id,
    notes: 'Auto-offset ' + candidate.currency + ' ' + candidate.offsetAmount.toFixed(2),
    created_by: userId,
  };
  return [entry1, entry2];
}

export function computeBalances(entries) {
  var sim = simulate(entries);
  var byCurrency = {};
  sim.currencies.forEach(function (cur) {
    var b = sim.byCurrency[cur];
    byCurrency[cur] = {
      currency: cur,
      totalCredit: (entries || []).filter(function (e) { return String(e.currency || 'USD').toUpperCase() === cur; })
        .reduce(function (a, e) { return a + Number(e.credit_amount || 0); }, 0),
      totalDebit: (entries || []).filter(function (e) { return String(e.currency || 'USD').toUpperCase() === cur; })
        .reduce(function (a, e) { return a + Number(e.debit_amount || 0); }, 0),
      theirOpenInvoices: b.theirOpenInvoices,
      ourOpenBills: b.ourOpenBills,
      theirPrepaid: b.theirPrepaid,
      ourPrepaid: b.ourPrepaid,
      netBalance: b.netBalance,
      theyOweUs: Math.max(0, b.theirOpenInvoices - b.theirPrepaid),
      weOweThem: Math.max(0, b.ourOpenBills - b.ourPrepaid),
      openInvoiceCount: b.openInvoices.length,
      openBillCount: b.openBills.length,
    };
  });
  return {
    currencies: sim.currencies,
    byCurrency: byCurrency,
    paidByEntry: sim.applications,
    simulation: sim,
  };
}
