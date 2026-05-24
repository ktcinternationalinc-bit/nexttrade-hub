// v55.83-A.6.27.68 — Warehouse Buckets data layer.
//
// SEPARATE CODE PATH from existing Treasury transaction flow. This is by
// design — Max (May 23 2026) explicitly required: "the treasury pop up
// and all of those selections is very fragile and very important in our
// workflow. i want a totally separate path."
//
// All bucket-related DB writes go through helpers in this file. None of
// the existing treasury transaction-modal code is touched. The only
// shared component is the `dbInsert('treasury', ...)` helper from
// lib/supabase.js, which we call directly from createBucket() with
// explicit bucket_id / bucket_role fields. Treasury's transaction-modal
// path leaves those NULL, so existing behavior is unchanged.
//
// KEY INVARIANT (Max May 23 2026 RE: H clarification):
//   The treasury row created for the bucket placeholder is NEVER modified
//   by reconciliation. The amount stays. The cash_out stays. The safe lost
//   that 5000 forever, full stop. Reconciliation only changes:
//     (a) the bucket's status in warehouse_buckets
//     (b) the visual styling of the treasury row (read by the renderer)
//     (c) the Expense Report aggregation logic (which checks bucket status
//         and substitutes bucket entries for the placeholder when closed)
//   No treasury row inserts, updates, or deletes happen during close.

import { supabase, dbInsert, dbUpdate } from './supabase';

// ─── Slug helpers ──────────────────────────────────────────────────

// Build the auto-reference: {name}_{ref}_{mmddyy}
//   Abdelnassar + america 101 + 2026-05-23 → abdelnassar_america_101_52326
export function buildReferenceSlug(name, reference, isoDate) {
  function slugify(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  function dateCompact(iso) {
    // iso = 2026-05-23 → 52326 (no leading zero on month, padded day, 2-digit year)
    if (!iso || iso.length < 10) return '';
    var y = iso.substring(2, 4);   // last 2 of year
    var m = parseInt(iso.substring(5, 7), 10);
    var d = iso.substring(8, 10);
    return String(m) + d + y;
  }
  var n = slugify(name);
  var r = slugify(reference);
  var dc = dateCompact(isoDate);
  return [n, r, dc].filter(Boolean).join('_');
}

// ─── CREATE BUCKET ─────────────────────────────────────────────────

// Atomic: creates warehouse_buckets row, then treasury placeholder row,
// then back-links the treasury row id onto the bucket. If treasury insert
// fails, bucket row is deleted (rollback). If link-back fails, both are
// preserved but error is surfaced — caller can retry the link manually.
//
// Params:
//   { recipientName, reference, issueDate (YYYY-MM-DD), amount, currency,
//     notes, userId, treasuryDescription? }
// Returns: { ok: true, bucket, treasuryRow } or { ok: false, error }
export async function createBucket(params) {
  var p = params || {};
  // Validation — fail fast with clear messages
  if (!p.recipientName || !String(p.recipientName).trim()) {
    return { ok: false, error: 'Recipient name is required' };
  }
  if (!p.reference || !String(p.reference).trim()) {
    return { ok: false, error: 'Reference is required' };
  }
  if (!p.issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.issueDate)) {
    return { ok: false, error: 'Issue date must be YYYY-MM-DD' };
  }
  var amt = Number(p.amount);
  if (!amt || amt <= 0 || !isFinite(amt)) {
    return { ok: false, error: 'Amount must be a positive number' };
  }
  var cur = String(p.currency || 'EGP').toUpperCase();
  if (cur !== 'EGP' && cur !== 'USD') {
    return { ok: false, error: 'Currency must be EGP or USD' };
  }

  var name = String(p.recipientName).trim();
  var ref = String(p.reference).trim();
  var slug = buildReferenceSlug(name, ref, p.issueDate);

  // 1. Insert the bucket row first
  var bucketPayload = {
    recipient_name: name,
    reference: ref,
    reference_slug: slug,
    issue_date: p.issueDate,
    amount: amt,
    currency: cur,
    status: 'open',
    notes: (p.notes || '').trim() || null,
    created_by: p.userId || null,
  };
  var bucketRow;
  try {
    bucketRow = await dbInsert('warehouse_buckets', bucketPayload, p.userId);
    if (!bucketRow || !bucketRow.id) {
      return { ok: false, error: 'Bucket insert returned no id' };
    }
  } catch (err) {
    var msg = (err && err.message) || String(err);
    // Unique slug violation = duplicate bucket for this recipient
    if (/unique|duplicate/i.test(msg)) {
      return { ok: false, error: 'A bucket with this recipient + reference + date already exists. Pick a different reference or date.' };
    }
    return { ok: false, error: 'Bucket create failed: ' + msg };
  }

  // 2. Insert the treasury placeholder row (separate code path from
  //    transaction modal — direct dbInsert with explicit bucket fields)
  var treasuryDesc = p.treasuryDescription || ('Warehouse Advance: ' + slug + ' — ' + name);
  var treasuryPayload = {
    transaction_date: p.issueDate,
    description: treasuryDesc,
    cash_in: null,
    cash_out: cur === 'EGP' ? amt : null,
    usd_in: null,
    usd_out: cur === 'USD' ? amt : null,
    currency: cur,
    category: 'Warehouse Bucket',
    subcategory: null,
    source: 'warehouse_bucket',
    bucket_id: bucketRow.id,
    bucket_role: 'placeholder',
    created_by: p.userId || null,
  };
  var treasuryRow;
  try {
    treasuryRow = await dbInsert('treasury', treasuryPayload, p.userId);
    if (!treasuryRow || !treasuryRow.id) throw new Error('Treasury insert returned no id');
  } catch (err) {
    // ROLLBACK: bucket created but treasury failed. Delete bucket so we don't
    // leave a bucket with no money in it.
    console.error('[buckets] treasury insert failed, rolling back bucket', bucketRow.id, err);
    try {
      await supabase.from('warehouse_buckets').delete().eq('id', bucketRow.id);
    } catch (rbErr) {
      console.error('[buckets] BUCKET ROLLBACK ALSO FAILED — orphan bucket', bucketRow.id, rbErr);
    }
    return { ok: false, error: 'Treasury placeholder create failed: ' + ((err && err.message) || err) };
  }

  // 3. Back-link the treasury row onto the bucket (so we can find it on close)
  try {
    await dbUpdate('warehouse_buckets', bucketRow.id, {
      placeholder_treasury_id: treasuryRow.id,
    }, p.userId);
  } catch (err) {
    // Non-fatal — both rows exist, just no back-link. The forward link
    // (treasury.bucket_id → bucket) is what reports use. Log + continue.
    console.warn('[buckets] back-link failed (forward link still works):', err);
  }

  return { ok: true, bucket: bucketRow, treasuryRow: treasuryRow };
}

// ─── ADD ENTRY (with overspend detection) ──────────────────────────

// Adds a spend entry against a bucket. Returns { ok, entry, overspend }.
// If the entry would push the bucket over its limit, returns
// { ok: false, overspend: { byAmount, remaining, attemptAmount } } so the
// UI can show the Split/Reduce/Cancel modal.
export async function addBucketEntry(params) {
  var p = params || {};
  if (!p.bucketId) return { ok: false, error: 'bucketId required' };
  var amt = Number(p.amount);
  if (!amt || amt <= 0) return { ok: false, error: 'Amount must be > 0' };
  if (!p.category || !String(p.category).trim()) return { ok: false, error: 'Category required' };
  if (!p.entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.entryDate)) return { ok: false, error: 'Entry date must be YYYY-MM-DD' };

  // Load bucket + current entries to compute remaining
  var bRes = await supabase.from('warehouse_buckets').select('*').eq('id', p.bucketId).maybeSingle();
  if (bRes.error || !bRes.data) return { ok: false, error: 'Bucket not found' };
  var bucket = bRes.data;
  if (bucket.status === 'closed' || bucket.status === 'cancelled') {
    return { ok: false, error: 'Cannot add entries to a ' + bucket.status + ' bucket' };
  }
  if (bucket.status === 'pending_approval') {
    return { ok: false, error: 'Bucket is pending approval — reopen for edits' };
  }

  var eRes = await supabase.from('warehouse_bucket_entries').select('amount').eq('bucket_id', p.bucketId);
  if (eRes.error) return { ok: false, error: 'Could not load existing entries: ' + eRes.error.message };
  var spent = (eRes.data || []).reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
  var remaining = Number(bucket.amount) - spent;

  // OVERSPEND CHECK — hard block per Max's spec
  if (amt > remaining + 0.001) {  // tiny epsilon for float comparison
    return {
      ok: false,
      overspend: {
        bucketAmount: Number(bucket.amount),
        spent: spent,
        remaining: Math.max(0, remaining),
        attemptAmount: amt,
        byAmount: amt - Math.max(0, remaining),
      },
    };
  }

  // Insert the entry
  try {
    var entryPayload = {
      bucket_id: p.bucketId,
      entry_date: p.entryDate,
      amount: amt,
      category: String(p.category).trim(),
      subcategory: p.subcategory ? String(p.subcategory).trim() : null,
      description: p.description ? String(p.description).trim() : null,
      receipt_url: p.receiptUrl || null,
      is_split_part: !!p.isSplitPart,
      split_pair_id: p.splitPairId || null,
      created_by: p.userId || null,
    };
    var entry = await dbInsert('warehouse_bucket_entries', entryPayload, p.userId);

    // After insert: if bucket is now fully spent, auto-flip status
    var newSpent = spent + amt;
    if (newSpent >= Number(bucket.amount) - 0.001 && bucket.status === 'open') {
      await dbUpdate('warehouse_buckets', p.bucketId, { status: 'fully_spent' }, p.userId);
    }

    return { ok: true, entry: entry, newSpent: newSpent, remaining: Number(bucket.amount) - newSpent };
  } catch (err) {
    return { ok: false, error: 'Entry insert failed: ' + ((err && err.message) || err) };
  }
}

// ─── BUCKET LIFECYCLE TRANSITIONS ──────────────────────────────────

// Submit a fully-spent bucket for approval.
export async function submitBucketForApproval(bucketId, userId) {
  var bRes = await supabase.from('warehouse_buckets').select('*').eq('id', bucketId).maybeSingle();
  if (bRes.error || !bRes.data) return { ok: false, error: 'Bucket not found' };
  var b = bRes.data;
  if (b.status !== 'fully_spent') {
    return { ok: false, error: 'Bucket must be fully spent before submitting. Current status: ' + b.status };
  }
  try {
    await dbUpdate('warehouse_buckets', bucketId, {
      status: 'pending_approval',
      submitted_at: new Date().toISOString(),
      submitted_by: userId || null,
    }, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Submit failed: ' + ((err && err.message) || err) };
  }
}

// Approve & close a bucket. Optional `forceSelfApprove` for super-admin override.
// Returns { ok, selfApproveWarning } where selfApproveWarning is true if the
// approver IS the creator (so UI can prompt for confirmation before calling
// again with forceSelfApprove=true).
export async function approveAndCloseBucket(params) {
  var p = params || {};
  if (!p.bucketId) return { ok: false, error: 'bucketId required' };
  if (!p.userId) return { ok: false, error: 'userId required' };

  var bRes = await supabase.from('warehouse_buckets').select('*').eq('id', p.bucketId).maybeSingle();
  if (bRes.error || !bRes.data) return { ok: false, error: 'Bucket not found' };
  var b = bRes.data;
  if (b.status === 'closed') return { ok: false, error: 'Already closed' };
  if (b.status === 'cancelled') return { ok: false, error: 'Bucket was cancelled — cannot approve' };
  if (b.status !== 'pending_approval' && b.status !== 'fully_spent') {
    return { ok: false, error: 'Bucket must be fully spent or pending approval. Current: ' + b.status };
  }

  // Self-approve protection (unless explicit override)
  if (b.created_by === p.userId && !p.forceSelfApprove && !p.isSuperAdmin) {
    return { ok: false, error: 'You created this bucket — someone else must approve it.' };
  }
  if (b.created_by === p.userId && !p.forceSelfApprove && p.isSuperAdmin) {
    // Super-admin self-approve → warn but allow on retry
    return { ok: false, selfApproveWarning: true, error: 'You created this bucket. As super-admin you can override — confirm to continue.' };
  }

  // For one-click "Submit & Approve", auto-set submitted_at if not set
  var nowIso = new Date().toISOString();
  var updates = {
    status: 'closed',
    approved_at: nowIso,
    approved_by: p.userId,
    closed_at: nowIso,
    closed_by: p.userId,
  };
  if (!b.submitted_at) {
    updates.submitted_at = nowIso;
    updates.submitted_by = p.userId;
  }

  try {
    await dbUpdate('warehouse_buckets', p.bucketId, updates, p.userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Close failed: ' + ((err && err.message) || err) };
  }
}

// Reopen a closed bucket. Reverts to fully_spent so entries can be edited again.
export async function reopenBucket(bucketId, userId, reason) {
  var bRes = await supabase.from('warehouse_buckets').select('*').eq('id', bucketId).maybeSingle();
  if (bRes.error || !bRes.data) return { ok: false, error: 'Bucket not found' };
  if (bRes.data.status !== 'closed') {
    return { ok: false, error: 'Only closed buckets can be reopened. Current: ' + bRes.data.status };
  }
  try {
    await dbUpdate('warehouse_buckets', bucketId, {
      status: 'fully_spent',
      reopened_at: new Date().toISOString(),
      reopened_by: userId || null,
      reopen_reason: (reason || '').trim() || null,
      closed_at: null,
      closed_by: null,
      approved_at: null,
      approved_by: null,
    }, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Reopen failed: ' + ((err && err.message) || err) };
  }
}

// Cancel a bucket before close. Creates a treasury cash_in credit for the
// full amount (recipient returned the money), marks bucket cancelled.
export async function cancelBucket(params) {
  var p = params || {};
  if (!p.bucketId || !p.reason || !String(p.reason).trim()) {
    return { ok: false, error: 'bucketId + reason required' };
  }
  var bRes = await supabase.from('warehouse_buckets').select('*').eq('id', p.bucketId).maybeSingle();
  if (bRes.error || !bRes.data) return { ok: false, error: 'Bucket not found' };
  var b = bRes.data;
  if (b.status === 'closed' || b.status === 'cancelled') {
    return { ok: false, error: 'Cannot cancel a ' + b.status + ' bucket' };
  }

  // 1. Create the credit-back treasury row
  var creditPayload = {
    transaction_date: new Date().toISOString().substring(0, 10),
    description: 'Refund of cancelled bucket: ' + b.reference_slug,
    cash_in: b.currency === 'EGP' ? Number(b.amount) : null,
    cash_out: null,
    usd_in: b.currency === 'USD' ? Number(b.amount) : null,
    usd_out: null,
    currency: b.currency,
    category: 'Warehouse Bucket Refund',
    subcategory: null,
    source: 'warehouse_bucket_cancel',
    bucket_id: b.id,
    bucket_role: null,  // not a placeholder — it's a refund credit
    created_by: p.userId || null,
  };
  try {
    await dbInsert('treasury', creditPayload, p.userId);
  } catch (err) {
    return { ok: false, error: 'Refund credit insert failed: ' + ((err && err.message) || err) };
  }

  // 2. Mark bucket cancelled
  try {
    await dbUpdate('warehouse_buckets', p.bucketId, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: p.userId || null,
      cancel_reason: String(p.reason).trim(),
    }, p.userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Bucket status update failed (refund credit was created): ' + ((err && err.message) || err) };
  }
}

// ─── READS ─────────────────────────────────────────────────────────

// Get all buckets, optionally filtered.
export async function listBuckets(filters) {
  var f = filters || {};
  var q = supabase.from('warehouse_buckets').select('*');
  if (f.status) q = q.eq('status', f.status);
  if (f.recipientName) q = q.ilike('recipient_name', '%' + f.recipientName + '%');
  if (f.dateFrom) q = q.gte('issue_date', f.dateFrom);
  if (f.dateTo) q = q.lte('issue_date', f.dateTo);
  q = q.order('issue_date', { ascending: false });
  var res = await q;
  if (res.error) {
    console.warn('[buckets] list failed:', res.error.message);
    return [];
  }
  return res.data || [];
}

// Get a single bucket with its entries.
export async function getBucketWithEntries(bucketId) {
  var bRes = await supabase.from('warehouse_buckets').select('*').eq('id', bucketId).maybeSingle();
  if (bRes.error) return { bucket: null, entries: [], error: bRes.error.message };
  if (!bRes.data) return { bucket: null, entries: [], error: 'Not found' };
  var eRes = await supabase.from('warehouse_bucket_entries').select('*').eq('bucket_id', bucketId).order('entry_date', { ascending: true });
  if (eRes.error) return { bucket: bRes.data, entries: [], error: eRes.error.message };
  return { bucket: bRes.data, entries: eRes.data || [] };
}

// Recipient autocomplete: returns distinct recipient names from past buckets.
// Used by the create-bucket combobox along with the users list.
export async function listPastRecipients() {
  var res = await supabase.from('warehouse_buckets').select('recipient_name').order('created_at', { ascending: false }).limit(500);
  if (res.error) return [];
  var seen = {};
  var out = [];
  (res.data || []).forEach(function (r) {
    var n = String(r.recipient_name || '').trim();
    if (n && !seen[n.toLowerCase()]) {
      seen[n.toLowerCase()] = true;
      out.push(n);
    }
  });
  return out;
}

// ─── EXPENSE REPORT INTEGRATION ────────────────────────────────────

// For the Expense Report aggregation: given a list of treasury rows, returns
// the "effective categorization" — where bucket placeholders whose bucket is
// CLOSED get expanded into their per-entry breakdown, and bucket placeholders
// whose bucket is OPEN stay as the "Warehouse Bucket" placeholder.
//
// IMPORTANT: this is purely for the categorization view. It does NOT modify
// the treasury rows. The original 5000 placeholder ALWAYS appears in cash
// flow / cash totals queries. This is only for "expense by category" reports.
//
// Returns an array of { date, amount, currency, category, subcategory, source }
// suitable for grouping by category/subcategory.
export async function expandTreasuryForExpenseReport(treasuryRows) {
  var rows = treasuryRows || [];
  // Find placeholder rows whose bucket might be closed
  var placeholderBucketIds = rows
    .filter(function (r) { return r.bucket_role === 'placeholder' && r.bucket_id; })
    .map(function (r) { return r.bucket_id; });
  if (placeholderBucketIds.length === 0) {
    // No buckets in play — return rows as-is
    return rows.map(function (r) {
      return {
        date: r.transaction_date,
        amount: Number(r.cash_out || r.usd_out || 0),
        currency: r.currency || 'EGP',
        category: r.category || '(uncategorized)',
        subcategory: r.subcategory || null,
        source: 'treasury',
        treasury_id: r.id,
      };
    });
  }
  // Load the buckets
  var bRes = await supabase.from('warehouse_buckets').select('id,status').in('id', placeholderBucketIds);
  if (bRes.error) {
    console.warn('[buckets/expense-report] bucket load failed:', bRes.error.message);
    return rows;  // fail safe: return rows unmodified
  }
  var closedBucketIds = (bRes.data || []).filter(function (b) { return b.status === 'closed'; }).map(function (b) { return b.id; });
  if (closedBucketIds.length === 0) {
    // No buckets are closed yet — return rows as-is (placeholders stay)
    return rows;
  }
  // Load entries for closed buckets
  var enRes = await supabase.from('warehouse_bucket_entries').select('*').in('bucket_id', closedBucketIds);
  if (enRes.error) {
    console.warn('[buckets/expense-report] entries load failed:', enRes.error.message);
    return rows;
  }
  // Build per-bucket entries map
  var entriesByBucket = {};
  (enRes.data || []).forEach(function (e) {
    if (!entriesByBucket[e.bucket_id]) entriesByBucket[e.bucket_id] = [];
    entriesByBucket[e.bucket_id].push(e);
  });
  // Walk rows, expand placeholders for closed buckets, leave others alone
  var out = [];
  rows.forEach(function (r) {
    if (r.bucket_role === 'placeholder' && r.bucket_id && closedBucketIds.indexOf(r.bucket_id) >= 0) {
      // Replace this row with its bucket entries
      (entriesByBucket[r.bucket_id] || []).forEach(function (e) {
        out.push({
          date: e.entry_date,
          amount: Number(e.amount || 0),
          currency: r.currency || 'EGP',
          category: e.category,
          subcategory: e.subcategory,
          source: 'bucket_entry',
          bucket_id: r.bucket_id,
          entry_id: e.id,
          treasury_id: r.id,  // for traceback to original placeholder
        });
      });
    } else {
      // Normal row OR open-bucket placeholder
      out.push({
        date: r.transaction_date,
        amount: Number(r.cash_out || r.usd_out || 0),
        currency: r.currency || 'EGP',
        category: r.category || '(uncategorized)',
        subcategory: r.subcategory || null,
        source: r.bucket_role === 'placeholder' ? 'bucket_placeholder' : 'treasury',
        treasury_id: r.id,
        bucket_id: r.bucket_id || null,
      });
    }
  });
  return out;
}
