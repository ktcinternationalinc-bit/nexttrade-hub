// src/lib/wave-bank-account-resolver.js — v55.83-MC (Codex architecture). The SINGLE shared resolver for
// "which Wave bank/cash account is the bank side of this transaction" + a category-safety classifier, so
// push-transaction, push-payment, and prefill-payment-links stop each carrying their own copy (which drifted
// and caused the 4-digit-only mask bug + the global-only push-payment requirement).
//
// SERVER-SAFE: NO 'use client'. Pure functions only (no DB / no fetch) — the caller fetches rows and passes
// them in, so this stays trivially testable. SWC-safe style (var + string concat) to match the API routes.

// --- mask matching: Wave account names often show 3 digits "(338)" while Plaid masks are 4 "6338". Match
// any 2+ digit token in EITHER direction (suffix-tolerant). ---
export function maskMatches(waveName, mask) {
  if (!mask) { return false; }
  var m = String(mask);
  var toks = String(waveName || '').match(/\d{2,}/g) || [];
  var i;
  for (i = 0; i < toks.length; i++) {
    var t = toks[i];
    if (t === m || m.indexOf(t) >= 0 || t.indexOf(m) >= 0 || (t.length >= 3 && m.slice(-t.length) === t) || (m.length >= 3 && t.slice(-m.length) === m)) { return true; }
  }
  return false;
}

// --- classify a Wave chart-of-accounts row by type/subtype/name into an accounting kind ---
export function classifyWaveAccount(cat) {
  if (!cat) { return 'unknown'; }
  var ty = String(cat.type || '').toUpperCase();
  var st = String(cat.subtype || '').toUpperCase();
  var nm = String(cat.wave_account_name || cat.name || '').toUpperCase();
  function has(s, x) { return s.indexOf(x) >= 0; }
  if (has(st, 'RECEIVABLE') || has(nm, 'ACCOUNTS RECEIVABLE') || has(nm, 'RECEIVABLE')) { return 'receivable'; }
  if (has(st, 'PAYABLE') || has(nm, 'ACCOUNTS PAYABLE') || has(nm, 'PAYABLE')) { return 'payable'; }
  if (has(st, 'CASH_AND_BANK') || has(st, 'MONEY_IN_TRANSIT') || has(st, 'CASH') || has(st, 'BANK') || (has(ty, 'ASSET') && (has(nm, 'CASH') || has(nm, 'BANK') || has(nm, 'CHECKING') || has(nm, 'CHEQUING') || has(nm, 'SAVINGS')))) { return 'bank_cash'; }
  if (has(nm, 'ACCUMULATED DEPRECIATION') || has(nm, 'DEPRECIATION') || has(nm, 'ALLOWANCE FOR')) { return 'contra_asset'; }
  if (has(st, 'SALES_TAX') || has(nm, 'SALES TAX') || (has(nm, ' TAX') && (has(ty, 'LIABILITY')))) { return 'tax'; }
  if (has(nm, 'OPENING BALANCE') || has(nm, 'RETAINED EARNINGS') || has(nm, "OWNER'S") || has(nm, 'OWNER INVESTMENT') || has(nm, 'OWNER DRAWING') || has(nm, 'UNCATEGORIZED')) { return 'system'; }
  if (has(ty, 'INCOME')) { return 'income'; }
  if (has(ty, 'EXPENSE')) { return 'expense'; }
  if (has(ty, 'LIABILITY')) { return 'liability'; }
  if (has(ty, 'EQUITY')) { return 'equity'; }
  if (has(ty, 'ASSET')) { return 'asset'; }
  return 'unknown';
}

export function isWaveBankCash(cat) { return classifyWaveAccount(cat) === 'bank_cash'; }

// --- is this category SAFE as the line-item side of a Hub-origin money transaction? Block the kinds that
// would misstate the books; the bank/cash side is the ANCHOR (not a category); A/R + A/P belong to the
// invoice/bill lanes; system accounts are Wave-managed. Returns { ok, block, warn, kind }. ---
export function categoryPushSafety(cat) {
  var kind = classifyWaveAccount(cat);
  var hardBlock = { bank_cash: 'a bank/cash account — that is the bank SIDE (the anchor), not a category. Pick an income/expense category instead.', receivable: 'Accounts Receivable — record this as an invoice PAYMENT (match the deposit to its invoice in Bank Review), not a category.', payable: 'Accounts Payable — record this as a bill payment, not a raw transaction category.', system: 'a Wave system account (opening balances / retained earnings / owner / uncategorized) — Wave manages these; pick a real income/expense category.' };
  if (hardBlock[kind]) { return { ok: false, block: true, warn: null, kind: kind, reason: hardBlock[kind] }; }
  var warnKinds = { contra_asset: 'a contra-asset (e.g. accumulated depreciation) — depreciation is normally a journal entry, not a cash transaction. Double-check this is really where the money went.', equity: 'an equity account — unusual for a bank transaction; confirm it is an owner draw/contribution.', unknown: 'an unrecognized account type — confirm the side is correct before pushing.' };
  return { ok: true, block: false, warn: warnKinds[kind] || null, kind: kind };
}

// --- resolve the bank-side Wave account for a transaction. Pure: caller passes the candidate Wave bank/cash
// accounts (already filtered to bank_cash, excluding A/R + A/P), this txn's Plaid mask, and the silo's global
// default. Returns { acct, name, via } on success, or { acct:null, reason } with a precise cause. ---
export function resolveWaveBankAnchor(opts) {
  opts = opts || {};
  var waveBankAccts = opts.waveBankAccts || [];
  var txnMask = opts.txnMask || null;
  var globalAcct = opts.globalAcct || null;
  var globalName = opts.globalName || null;

  if (txnMask) {
    var i;
    for (i = 0; i < waveBankAccts.length; i++) {
      if (maskMatches(waveBankAccts[i].wave_account_name, txnMask)) {
        return { acct: waveBankAccts[i].wave_account_id, name: waveBankAccts[i].wave_account_name, via: 'matched-by-mask:' + txnMask, feedOwner: waveBankAccts[i].wave_feed_owner || null };
      }
    }
  }
  if (waveBankAccts.length === 1) { return { acct: waveBankAccts[0].wave_account_id, name: waveBankAccts[0].wave_account_name, via: 'only-wave-bank-account', feedOwner: waveBankAccts[0].wave_feed_owner || null }; }
  if (globalAcct) {
    // Carry the global/default account's OWN feed owner if it's one of the known candidates (fixes the bug
    // where silo-default hardcoded null and the firewall then blocked even a HUB-marked default account).
    var gi, gOwner = null;
    for (gi = 0; gi < waveBankAccts.length; gi++) { if (waveBankAccts[gi].wave_account_id === globalAcct) { gOwner = waveBankAccts[gi].wave_feed_owner || null; break; } }
    return { acct: globalAcct, name: globalName, via: 'silo-default', feedOwner: gOwner };
  }

  var why;
  if (txnMask && waveBankAccts.length > 1) { why = 'this transaction is from bank ··' + txnMask + ', and none of the ' + waveBankAccts.length + ' Wave bank accounts has a name matching it (so there is no safe single default). Rename the matching Wave bank account to include "' + txnMask + '", or set a silo default in Settings.'; }
  else if (waveBankAccts.length === 0) { why = 'no Wave Cash & Bank account exists in this business\x27s chart of accounts. Create one in Wave (Accounting -> Chart of Accounts -> Add -> Cash & Bank), pull categories, then retry.'; }
  else { why = 'set a silo default in Settings -> Wave Deposit Account (pick your bank account, confirm the green "Saved").'; }
  return { acct: null, name: null, via: null, reason: why };
}

// helper: filter a wave_categories list down to the bank/cash candidates (excludes A/R, A/P, etc.)
export function waveBankCashCandidates(cats) {
  var out = [];
  (cats || []).forEach(function (c) { if (c && c.wave_account_id && isWaveBankCash(c)) { out.push(c); } });
  return out;
}

// --- THE FIREWALL (v55.83-MC). Per-account single-writer rule: exactly ONE source feeds Wave for a given
// bank account — the Hub OR Wave's own bank feed, never both (Wave money txns are create-only + unreadable,
// so a second writer can never be de-duplicated). Given the resolved account's feedOwner, decide whether the
// Hub may CREATE a money transaction. UNSET (null) BLOCKS by design so a newly added account can never
// silently duplicate. Returns { ok, reason }. ---
export function feedOwnerVerdict(feedOwner) {
  if (feedOwner === 'HUB') { return { ok: true, reason: null }; }
  if (feedOwner === 'WAVE_FEED') { return { ok: false, reason: 'This bank account is set to "Wave feed" — Wave pulls its transactions directly, so the Hub must NOT also create them (that would post every transaction twice). Categorize this account inside Wave, or mirror it read-only. If Wave\x27s own feed is actually OFF for this account, change its owner to "Hub" in Wave Sync Center → Settings.' }; }
  return { ok: false, reason: 'This bank account has not been assigned a feed owner yet, so pushing is blocked to prevent duplicates. In Wave Sync Center → Settings, set who feeds this account: choose "Hub" ONLY if Wave\x27s own bank feed is OFF for it (then the Hub posts each transaction already-categorized), or "Wave feed" if Wave pulls it directly.' };
}
