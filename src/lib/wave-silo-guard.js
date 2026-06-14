// wave-silo-guard.js
// ONE chokepoint for "is this Wave/bank action allowed for this exact silo?".
// Pure functions only (no React, no fetch) so API routes AND components can import it.
// Style: var + string concat so it is safe under the SWC API-route constraints.
//
// Core principle (Max's rule): there is no generic "push to Wave". Every push/match
// must be scoped to ONE exact wave_business_id, and every record involved must carry
// that same id. These helpers RETURN a result object { ok, code, message } instead of
// throwing, so callers can surface a clean error.

var UNLOCK_PHRASE = 'PUSH TO REAL KTC WAVE';

// v55.83-EF — the ONLY Wave business a real push may currently target. Hard backend guard.
var APPROVED_PUSH_BUSINESS_ID = 'QnVzaW5lc3M6YjYyMzNmMjItMjRkZS00MzYyLWE4MWYtZGQ4ZWQxNGUzNzg4';

function fail(code, message) { return { ok: false, code: code, message: message }; }
function pass(extra) { var r = { ok: true, code: 'ok', message: 'ok' }; if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) { r[k] = extra[k]; } } } return r; }

// Find a registry row for an id.
function findRegistry(registry, waveBusinessId) {
  if (!registry || !waveBusinessId) { return null; }
  for (var i = 0; i < registry.length; i++) {
    if (registry[i] && registry[i].wave_business_id === waveBusinessId) { return registry[i]; }
  }
  return null;
}

// 1) Basic silo presence: an action must name exactly one silo.
function assertSiloSelected(waveBusinessId) {
  if (!waveBusinessId) { return fail('no_silo', 'No accounting silo (Wave business) was selected. Pick a silo first.'); }
  return pass();
}

// 2) A record must belong to the selected silo. Used for match + push.
//    label fns let the caller produce a readable cross-silo message.
function assertRecordInSilo(record, waveBusinessId, recordName) {
  if (!waveBusinessId) { return fail('no_silo', 'No accounting silo selected.'); }
  if (!record) { return fail('no_record', 'No record supplied to check.'); }
  if (!record.wave_business_id) {
    return fail('record_unassigned', (recordName || 'This record') + ' is not assigned to any accounting silo. Assign it before continuing.');
  }
  if (record.wave_business_id !== waveBusinessId) {
    return fail('cross_silo', (recordName || 'This record') + ' belongs to a different accounting silo and cannot be used here.');
  }
  return pass();
}

// 3) Matching rule (§3): bank txn + invoice + customer must all be the same silo as the active one.
//    Returns the exact error wording the spec asks for, with both business labels.
function assertMatchSameSilo(opts) {
  // opts: { activeBusinessId, bankTxn, invoice, customer, labelFor }
  var active = opts.activeBusinessId;
  var labelFor = opts.labelFor || function (id) { return id || 'Unassigned'; };
  var sel = assertSiloSelected(active);
  if (!sel.ok) { return sel; }
  var parts = [
    { rec: opts.bankTxn, name: 'bank transaction' },
    { rec: opts.invoice, name: 'invoice' },
    { rec: opts.customer, name: 'customer' }
  ];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p.rec) { continue; } // caller may not pass every entity
    if (!p.rec.wave_business_id || p.rec.wave_business_id !== active) {
      var other = p.rec.wave_business_id;
      return fail('cross_silo',
        'This ' + p.name + ' belongs to ' + labelFor(other) + ' and cannot be matched to records from ' + labelFor(active) + '.');
    }
  }
  return pass();
}

// 4) Push guard (§4/§6/§7/§10). Everything a push route must satisfy, in one call.
//    opts: { waveBusinessId, registry, record, action, unlockPhrase }
//    action one of: 'customer' | 'invoice' | 'payment' | 'category'
function assertCanPush(opts) {
  var action = opts.action;
  var sel = assertSiloSelected(opts.waveBusinessId);
  if (!sel.ok) { return sel; }

  var reg = findRegistry(opts.registry, opts.waveBusinessId);
  if (!reg) { return fail('not_registered', 'This Wave business is not registered. Register it in Wave Import before any push.'); }

  // v55.83-EF — HARD GUARD: a REAL push may only target the approved KANDIL EGYPT test business.
  // Dry runs are allowed against any registered silo for inspection (opts.dryRun === true),
  // but an actual write is blocked unless the target id matches exactly.
  if (opts.dryRun !== true && opts.waveBusinessId !== APPROVED_PUSH_BUSINESS_ID) {
    return fail('not_approved_target', 'Push blocked: target Wave business is not the approved KANDIL EGYPT test business.');
  }

  // record must belong to this silo
  var inSilo = assertRecordInSilo(opts.record, opts.waveBusinessId, 'The record being pushed');
  if (!inSilo.ok) { return inSilo; }

  // never recreate something Wave already has (§9)
  if (opts.record && (opts.record.wave_invoice_id || opts.record.wave_customer_id)) {
    if (action === 'invoice' && opts.record.wave_invoice_id) {
      return fail('already_in_wave', 'This invoice already exists in Wave (has a Wave invoice id) and must not be recreated.');
    }
    if (action === 'customer' && opts.record.wave_customer_id) {
      return fail('already_in_wave', 'This customer already exists in Wave (has a Wave customer id) and must not be recreated.');
    }
  }

  // writes must be enabled at all
  if (reg.writes_enabled !== true) {
    return fail('writes_disabled', 'Writes to ' + (reg.label || opts.waveBusinessId) + ' are disabled. Enable writes for this silo first.');
  }

  // the specific push type must be allowed (§6) — default false
  var flagByAction = {
    customer: 'allow_customer_push',
    invoice: 'allow_invoice_push',
    payment: 'allow_payment_push',
    category: 'allow_category_push'
  };
  var flag = flagByAction[action];
  if (!flag) { return fail('bad_action', 'Unknown push action: ' + action); }
  if (reg[flag] !== true) {
    return fail('push_type_disabled', (action.charAt(0).toUpperCase() + action.slice(1)) + ' push is not enabled for ' + (reg.label || opts.waveBusinessId) + '.');
  }

  // production requires the typed unlock phrase EVERY push (§7)
  if (reg.is_production !== false) {
    if ((opts.unlockPhrase || '').trim() !== UNLOCK_PHRASE) {
      return fail('production_locked', 'This is a PRODUCTION Wave business. Type "' + UNLOCK_PHRASE + '" to authorize this push.');
    }
  }

  return pass({ registry: reg, production: reg.is_production !== false });
}

// 5) A category-protection convenience (§9): never let a blank Hub category erase a Wave one.
function assertCategoryNotErasing(opts) {
  // opts: { hubCategory, waveCategory, adminOverride }
  var hub = (opts.hubCategory == null || String(opts.hubCategory).trim() === '');
  if (hub && opts.waveCategory && !opts.adminOverride) {
    return fail('would_erase_category', 'A blank Hub category cannot overwrite the existing Wave category. The Wave category is kept.');
  }
  return pass();
}

// 6) Build the standard wave_sync_log row for an attempt (pass or fail). Always log.
function buildSyncLogRow(opts) {
  // opts: { waveBusinessId, action, entityType, entityId, result, by }
  return {
    wave_business_id: opts.waveBusinessId || null,
    action: opts.action || null,
    entity_type: opts.entityType || null,
    entity_id: opts.entityId || null,
    outcome: opts.result && opts.result.ok ? 'ok' : 'blocked',
    outcome_code: opts.result ? opts.result.code : null,
    message: opts.result ? opts.result.message : null,
    attempted_by: opts.by || null,
    attempted_at: new Date().toISOString()
  };
}

export {
  UNLOCK_PHRASE,
  APPROVED_PUSH_BUSINESS_ID,
  findRegistry,
  assertSiloSelected,
  assertRecordInSilo,
  assertMatchSameSilo,
  assertCanPush,
  assertCategoryNotErasing,
  buildSyncLogRow
};
