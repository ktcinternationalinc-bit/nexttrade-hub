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
  // v55.83-A.6.27.72 HOTFIX 25 — Per Max May 27 2026: every type tag was
  // washing out because the bg-X-100 + text-X-900 pattern relies on the
  // ambient page background being light. The portal's main layout is dark,
  // so light-on-light pills became unreadable. Fix: solid saturated bg
  // (-600/-700) + WHITE text + ring for depth — readable on ANY surface.
  // RULE going forward: badge pills NEVER use bg-X-100/200; always use
  // bg-X-600 or darker with text-white.
  sales_invoice: {
    label: 'Sales Invoice', labelAr: 'فاتورة بيع',
    sublabel: 'We billed them', sublabelAr: 'فوترناهم',
    icon: '📤', side: 'credit', cashFlow: null,
    pillCls: 'bg-blue-600 text-white ring-1 ring-blue-700/50 shadow-sm', rowCls: null,
    descCls: 'text-blue-700', amountCls: 'text-blue-700',
  },
  vendor_bill: {
    label: 'Vendor Bill', labelAr: 'فاتورة مورد',
    sublabel: 'They billed us', sublabelAr: 'فوترونا',
    icon: '📥', side: 'debit', cashFlow: null,
    // v55.83-A.6.27.72 HOTFIX 15 — Vendor bills now PURPLE (was orange).
    // Max May 26 2026: purple reads as distinct from the AP-side red column without
    // clashing with the warning-orange used elsewhere in the portal.
    // HOTFIX 25: bumped to solid purple-600 + white text for contrast on dark theme.
    pillCls: 'bg-purple-600 text-white ring-1 ring-purple-700/50 shadow-sm', rowCls: null,
    descCls: 'text-purple-700', amountCls: 'text-purple-700',
  },
  payment_received: {
    label: 'Payment Received', labelAr: 'دفعة مستلمة',
    sublabel: 'They paid us', sublabelAr: 'دفعوا لنا',
    icon: '💰', side: 'credit', cashFlow: 'in',
    pillCls: 'bg-emerald-600 text-white ring-1 ring-emerald-700/50 shadow-sm', rowCls: null,
    descCls: null, amountCls: null,
  },
  payment_sent: {
    label: 'Payment Sent', labelAr: 'دفعة مرسلة',
    sublabel: 'We paid them', sublabelAr: 'دفعنا لهم',
    icon: '💸', side: 'debit', cashFlow: 'out',
    pillCls: 'bg-rose-600 text-white ring-1 ring-rose-700/50 shadow-sm', rowCls: null,
    descCls: null, amountCls: null,
  },
  credit_adjustment: {
    label: 'Credit/Adjustment', labelAr: 'تعديل',
    sublabel: 'Manual adjustment', sublabelAr: 'تعديل يدوي',
    icon: '⚖️', side: null, cashFlow: null,
    pillCls: 'bg-slate-700 text-white ring-1 ring-slate-800/50 shadow-sm', rowCls: null,
    descCls: null, amountCls: null,
  },
  offset: {
    label: 'Offset', labelAr: 'مقاصة',
    sublabel: 'Balance offset', sublabelAr: 'مقاصة رصيد',
    icon: '🔄', side: null, cashFlow: null,
    pillCls: 'bg-violet-600 text-white ring-1 ring-violet-700/50 shadow-sm', rowCls: 'bg-purple-50',
    descCls: null, amountCls: null,
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
  var offsetPairsDone = {}; // offset_pair_id -> true, so each pair applies once

  // v55.83-A.6.27.72 HOTFIX 28 — Build a type lookup for ALL entries so the
  // offset handler can validate that offset_invoice_id actually points at a
  // sales_invoice (not a vendor_bill stuck in the wrong slot by a corrupt
  // generator). Same for offset_bill_id → must point at a vendor_bill.
  // This catches the "vendor_bill ↔ vendor_bill" corruption pattern even
  // when the referenced entry IS in the open pool (just on the wrong side).
  var typeById = {};
  (entries || []).forEach(function (e) {
    if (e && e.id) typeById[e.id] = String(e.transaction_type || '').trim().toLowerCase();
  });

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
    // v55.83-H — Normalize the type before matching: trim whitespace + lowercase.
    // Rows saved by older entry forms or imports sometimes carried " payment_sent ",
    // "Payment_Sent", etc. A single stray space used to make the strict branch match
    // fail, sending a legitimate payment to the "unknown → ignored" branch below, where
    // it VANISHED from the totals (the El Sayad 500,000 EGP SAIB deposit bug).
    var type = String(e.transaction_type || '').trim().toLowerCase();
    var amt = entryAmount(e);

    // GUARD 1: clamp negative amounts to 0 with warning
    if (amt < 0) {
      warn('Entry has negative amount — clamping to 0', { id: e.id, amount: amt, type: type });
      amt = 0;
    }

    // GUARD 2: null/undefined/empty type → treat as credit_adjustment, warn
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
      // v55.83-A.6.27.72 HOTFIX 32 — Chronological consistency for credit_adjustment.
      //
      // Per Max May 28 evening: the running balance walks the ledger chronologically
      // row by row. The offset/credit allocator must follow the same flow. An
      // "upfront" credit_adjustment (e.g. Algeria Brokerage $10,609.90 dated
      // 2025-11-27, same day as the $151,570 vendor bill INV-003) should reduce
      // INV-003 IMMEDIATELY — not get parked in ourPrepaid while the auto-offset
      // cascade later cannibalizes a May 2026 sales invoice (INV-010) for the
      // same dollars.
      //
      // RULE: credit_adjustment behaves like a payment — drain the appropriate
      // open pool FIFO first, park excess in prepaid only when no open balance
      // exists to absorb it. Identical mechanics to payment_sent / payment_received.
      //
      // Direction map:
      //   debit_amount > 0  → we're holding credit AGAINST them
      //                       → drain ourOpenBills first, park excess in ourPrepaid
      //   credit_amount > 0 → they're holding credit AGAINST us
      //                       → drain theirOpenInvoices first, park excess in theirPrepaid
      //
      // SAFETY: HOTFIX 26 first tried this and got reverted because the 4 corrupt
      // offset rows (vendor_bill ↔ vendor_bill pairings) caused phantom payments
      // on top of an already-drained pool. HOTFIX 28 added type-checking on offsets
      // that REJECTS those corrupt rows before they touch the pool. With HOTFIX 28
      // in place, the drain behavior is structurally safe.
      var creditAmtA = Math.max(0, Number(e.credit_amount || 0));
      var debitAmtA = Math.max(0, Number(e.debit_amount || 0));
      if (debitAmtA > 0) {
        // Drain open bills FIFO
        var debitLeft = debitAmtA;
        while (debitLeft > 0.001 && s.openBills.length > 0) {
          var billA = s.openBills[0];
          var applyA = Math.min(billA.remaining, debitLeft);
          billA.remaining -= applyA;
          applied[billA.id] = (applied[billA.id] || 0) + applyA;
          debitLeft -= applyA;
          if (billA.remaining < 0.001) s.openBills.shift();
        }
        if (debitLeft > 0.001) s.ourPrepaid += debitLeft;
      }
      if (creditAmtA > 0) {
        // Drain open invoices FIFO
        var creditLeft = creditAmtA;
        while (creditLeft > 0.001 && s.openInvoices.length > 0) {
          var invA = s.openInvoices[0];
          var applyAC = Math.min(invA.remaining, creditLeft);
          invA.remaining -= applyAC;
          applied[invA.id] = (applied[invA.id] || 0) + applyAC;
          creditLeft -= applyAC;
          if (invA.remaining < 0.001) s.openInvoices.shift();
        }
        if (creditLeft > 0.001) s.theirPrepaid += creditLeft;
      }
    } else if (type === 'offset') {
      // v55.83-M — BALANCED OFFSET (fixes stale-offset vs back-dated payment).
      // An offset is net-zero: it cancels an equal amount of one open sales
      // invoice AND one open vendor bill. Each pair is two rows (debit half +
      // credit half) sharing offset_pair_id, both carrying offset_invoice_id +
      // offset_bill_id. PRIOR BUG: halves applied independently, so if one
      // target was already consumed (by a payment or another offset) that side
      // clamped while the other cancelled in full -> over-cancel by the gap.
      // That is the El Sayad case: a back-dated 500,000 payment drained
      // INV-004/005 before the older offsets ran, the invoice side
      // over-cancelled by 500,000, and the balance read -998,354.50 instead of
      // -498,354.50. FIX: process each pair ONCE, apply min(amount,
      // invoiceRemaining, billRemaining) to BOTH sides. Healthy offsets (both
      // sides fully open) are unchanged because min == full amount.
      var pairKey = e.offset_pair_id || e.id;
      if (offsetPairsDone[pairKey]) {
        // sibling half already settled this pair
      } else {
        offsetPairsDone[pairKey] = true;
        var offsetAmt = Math.max(Number(e.debit_amount || 0), Number(e.credit_amount || 0));
        var invTypeO = e.offset_invoice_id ? typeById[e.offset_invoice_id] : null;
        var billTypeO = e.offset_bill_id ? typeById[e.offset_bill_id] : null;
        var typeErrO = null;
        if (e.offset_invoice_id && invTypeO && invTypeO !== 'sales_invoice') {
          typeErrO = 'offset_invoice_id points at a ' + invTypeO + ' (must be sales_invoice)';
        } else if (e.offset_bill_id && billTypeO && billTypeO !== 'vendor_bill') {
          typeErrO = 'offset_bill_id points at a ' + billTypeO + ' (must be vendor_bill)';
        }
        if (typeErrO) {
          warn('REJECTED malformed offset row - ' + typeErrO, { id: e.id, offset_invoice_id: e.offset_invoice_id, offset_bill_id: e.offset_bill_id, currency: cur });
        } else {
          var rInvO = e.offset_invoice_id ? findOpenById(s.openInvoices, e.offset_invoice_id) : null;
          var rBillO = e.offset_bill_id ? findOpenById(s.openBills, e.offset_bill_id) : null;
          var invRemO = rInvO ? rInvO.remaining : 0;
          var billRemO = rBillO ? rBillO.remaining : 0;
          var applicableO = offsetAmt;
          if (e.offset_invoice_id) applicableO = Math.min(applicableO, invRemO);
          if (e.offset_bill_id) applicableO = Math.min(applicableO, billRemO);
          if (applicableO < 0) applicableO = 0;
          if (applicableO > 0.001) {
            if (rInvO) {
              rInvO.remaining -= applicableO;
              applied[rInvO.id] = (applied[rInvO.id] || 0) + applicableO;
              if (rInvO.remaining < 0.001) { var iIdxO = s.openInvoices.indexOf(rInvO); if (iIdxO >= 0) s.openInvoices.splice(iIdxO, 1); }
            }
            if (rBillO) {
              rBillO.remaining -= applicableO;
              applied[rBillO.id] = (applied[rBillO.id] || 0) + applicableO;
              if (rBillO.remaining < 0.001) { var bIdxO = s.openBills.indexOf(rBillO); if (bIdxO >= 0) s.openBills.splice(bIdxO, 1); }
            }
          }
          if (applicableO < offsetAmt - 0.001) {
            warn('Offset only partially applied - a target was already settled (stale offset vs payment/other offset). Net stays correct; re-run auto-offset to tidy open items.', { id: e.id, offsetAmount: offsetAmt, applied: applicableO, invoiceRemaining: invRemO, billRemaining: billRemO, currency: cur });
          }
        }
      }
    } else {
      // v55.83-H — SAFETY NET: never silently drop a row that carries real money.
      // Previously an unrecognized transaction_type (e.g. a legacy "deposit"/"payment"
      // value, or a typo) was logged and SKIPPED — which made the row's amount disappear
      // from the totals entirely. That is the El Sayad 500,000 EGP SAIB deposit bug:
      // the payment showed in the line-by-line column but never reduced the balance cards.
      //
      // New rule: treat any unknown type exactly like a credit_adjustment — apply by side.
      //   debit_amount  > 0 → money we paid OUT → drain our open bills FIFO, excess → ourPrepaid
      //   credit_amount > 0 → money we took IN  → drain their open invoices FIFO, excess → theirPrepaid
      // A loud warning is still emitted so the bad type label can be cleaned up at the source,
      // but the money is ALWAYS counted.
      warn('Unrecognized transaction_type — applying by debit/credit side so the amount is not lost', { id: e.id, type: type });
      var creditAmtU = Math.max(0, Number(e.credit_amount || 0));
      var debitAmtU = Math.max(0, Number(e.debit_amount || 0));
      if (debitAmtU > 0) {
        var debitLeftU = debitAmtU;
        while (debitLeftU > 0.001 && s.openBills.length > 0) {
          var billU = s.openBills[0];
          var applyU = Math.min(billU.remaining, debitLeftU);
          billU.remaining -= applyU;
          applied[billU.id] = (applied[billU.id] || 0) + applyU;
          debitLeftU -= applyU;
          if (billU.remaining < 0.001) s.openBills.shift();
        }
        if (debitLeftU > 0.001) s.ourPrepaid += debitLeftU;
      }
      if (creditAmtU > 0) {
        var creditLeftU = creditAmtU;
        while (creditLeftU > 0.001 && s.openInvoices.length > 0) {
          var invU = s.openInvoices[0];
          var applyUC = Math.min(invU.remaining, creditLeftU);
          invU.remaining -= applyUC;
          applied[invU.id] = (applied[invU.id] || 0) + applyUC;
          creditLeftU -= applyUC;
          if (invU.remaining < 0.001) s.openInvoices.shift();
        }
        if (creditLeftU > 0.001) s.theirPrepaid += creditLeftU;
      }
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
  // v55.83-M — AUTO-SETTLE leftover open items in-memory (read-time auto-offset).
  // For one counterparty, any open sales invoice nets against any open vendor
  // bill in the same currency. This keeps the position clean ("we owe X" OR
  // "they owe X", never both) even when stored offset rows are stale against a
  // later back-dated payment — no DB writes, no button. The net is unchanged
  // (both sides drop equally). Amounts are credited into `applied` so per-entry
  // Paid/Remaining, the open-item counts, and the tiles all stay consistent.
  Object.keys(state).forEach(function (cur) {
    var s = state[cur];
    while (s.openInvoices.length > 0 && s.openBills.length > 0) {
      var invN = s.openInvoices[0];
      var billN = s.openBills[0];
      var amtN = Math.min(invN.remaining, billN.remaining);
      if (amtN <= 0.001) break;
      invN.remaining -= amtN;
      billN.remaining -= amtN;
      applied[invN.id] = (applied[invN.id] || 0) + amtN;
      applied[billN.id] = (applied[billN.id] || 0) + amtN;
      if (invN.remaining < 0.001) s.openInvoices.shift();
      if (billN.remaining < 0.001) s.openBills.shift();
    }
  });
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

  // v55.83-A.6.27.72 HOTFIX 28 — Refuse to construct rows that violate the
  // type contract. The historical corruption that produced the El Sayad
  // vendor_bill ↔ vendor_bill offset rows would have been blocked here if
  // this check had existed. Throwing (not silently returning []) so the
  // caller can surface the error to the user instead of failing silently.
  if (!candidate.invoice || candidate.invoice.transaction_type !== 'sales_invoice') {
    throw new Error(
      'buildOffsetEntries: candidate.invoice must be a sales_invoice ' +
      '(got transaction_type=' + (candidate.invoice && candidate.invoice.transaction_type) + ' ' +
      'id=' + (candidate.invoice && candidate.invoice.id) + '). ' +
      'This prevents the vendor_bill-in-invoice-slot corruption that wiped legitimate debt from the open pool.'
    );
  }
  if (!candidate.bill || candidate.bill.transaction_type !== 'vendor_bill') {
    throw new Error(
      'buildOffsetEntries: candidate.bill must be a vendor_bill ' +
      '(got transaction_type=' + (candidate.bill && candidate.bill.transaction_type) + ' ' +
      'id=' + (candidate.bill && candidate.bill.id) + '). ' +
      'Refusing to write a malformed offset row.'
    );
  }
  if (candidate.invoice.id === candidate.bill.id) {
    throw new Error('buildOffsetEntries: cannot offset an entry against itself');
  }
  // Currency must match (we never cross-currency offset).
  var invCur = String(candidate.invoice.currency || '').toUpperCase();
  var billCur = String(candidate.bill.currency || '').toUpperCase();
  if (invCur !== billCur) {
    throw new Error(
      'buildOffsetEntries: invoice currency (' + invCur + ') must match bill currency (' + billCur + ')'
    );
  }

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
