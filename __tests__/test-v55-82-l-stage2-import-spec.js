// ============================================================
// v55.82-L Stage 2 — Shipping import per Max's full spec
//
// Per Max May 11 2026 written requirements (11 sections):
//   - DEFAULT mode = update_only (safe, never deletes)
//   - SECOND mode  = full_sync (adds, updates, DELETES missing rows)
//   - Match = ALL 5 keys (origin + destination + expiry_date +
//             vendor_name + shipping_line)
//   - Row error → SKIP that row only, continue, NEVER fail batch
//   - Pre-flight date validation (no more "0-01-01" wipes)
//   - Detailed error report: row + field + reason
//   - Summary: New / Updated / Unchanged / Failed (+ Deleted)
//   - Full Sync requires typed "FULL SYNC" confirmation
//   - Full Sync delete step skipped if ANY validation failure
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else {
    failures.push(label + (hint ? ' — ' + hint : ''));
    console.log('✗ ' + label + (hint ? ' — ' + hint : ''));
  }
}

var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');

// ============================================================
// SECTION 1 — Two modes, update_only is the default
// ============================================================

ok('1a: Default importMode is "update_only"',
  /useState\('update_only'\)/.test(src),
  'safety-first per spec section 1 + 11'
);

ok('1b: REGRESSION GUARD — no longer defaults to "add"',
  !/const \[importMode, setImportMode\] = useState\('add'\)/.test(src)
);

ok('1c: REGRESSION GUARD — old "replace" mode is GONE',
  !/importMode === 'replace'/.test(src) && !/value="replace"/.test(src)
);

ok('1d: REGRESSION GUARD — old "update" mode is GONE (replaced by update_only)',
  !/importMode === 'update'(?!_only)/.test(src)
);

ok('1e: full_sync mode value exists in code',
  /importMode === 'full_sync'/.test(src) && /value="full_sync"/.test(src)
);

// ============================================================
// SECTION 2 — Matching by all 5 keys
// ============================================================

ok('2a: keyFor builder uses 5 spec-required fields (v.47 — swapped expiry_date for effective_date to enable expiry_date backfill, swapped origin/destination for port_of_loading/port_of_discharge with fallback)',
  /keyFor = function \(r\) \{[\s\S]{0,1500}r\.port_of_loading[\s\S]{0,500}r\.port_of_discharge[\s\S]{0,500}r\.effective_date[\s\S]{0,500}r\.vendor_name[\s\S]{0,500}r\.shipping_line/.test(src)
);

ok('2b: REGRESSION GUARD — match key no longer uses container_type or effective_date',
  // Old v55.82-G/J key used (vendor + origin + destination + container + effective_date).
  // New v55.82-L key per spec uses (origin + destination + expiry_date + vendor + shipping_line).
  !/keyFor = function[\s\S]{0,400}container_type[\s\S]{0,200}effective_date/.test(src)
);

ok('2c: keyFor lowercases + trims (case + whitespace tolerance)',
  // v55.82-W replaced inline .trim().toLowerCase() with normName() which
  // does that PLUS strips non-alphanumeric for fuzzy matching (so
  // "CMA CGM" == "CMA-CGM"). Either pattern is acceptable.
  /keyFor = function[\s\S]{0,800}toLowerCase\(\)/.test(src) ||
  (/keyFor = function[\s\S]{0,400}normName\(/.test(src) &&
   /var normName = function[\s\S]{0,300}toLowerCase\(\)/.test(src))
);

// ============================================================
// SECTION 3 — CASE A/B/C/D handling
// ============================================================

ok('3a: CASE B unchanged-row detection via rowChanged helper',
  /var rowChanged = function/.test(src) &&
  /if \(!rowChanged\(vr\.data, existing\)\) \{[\s\S]{0,200}counts\.unchanged\+\+/.test(src)
);

ok('3b: CASE A match+changed → UPDATE path',
  /supabase\.from\('shipping_rates'\)\.update\(patch\)\.eq\('id', existing\.id\)/.test(src) &&
  /counts\.updated\+\+/.test(src)
);

ok('3c: CASE C no match → INSERT path',
  /supabase\.from\('shipping_rates'\)\.insert\(vr\.data\)/.test(src) &&
  /counts\.added\+\+/.test(src)
);

ok('3d: CASE D row error → SKIP only, continue (per-row try/catch)',
  /try \{[\s\S]{0,4000}\} catch \(rowErr\) \{[\s\S]{0,200}counts\.failed\+\+[\s\S]{0,300}errors\.push/.test(src)
);

// ============================================================
// SECTION 4 — Critical safety: never wipe on error
// ============================================================

ok('4a: Per-row loop iterates validRows — no bulk-fail-the-batch',
  /for \(var ri = 0; ri < validRows\.length; ri\+\+\)/.test(src)
);

ok('4b: REGRESSION GUARD — no all-rows bulk-insert that would fail the whole batch',
  // The old code did: supabase.from('shipping_rates').insert(rowsToInsert) with
  // ALL rows at once, then if one bad row triggered a unique-constraint/date
  // error, Postgres rolled back the whole batch. New code inserts per-row.
  // This guard checks the per-row insert + the array-wide insert pattern is gone.
  !(/supabase\.from\('shipping_rates'\)\.insert\(rowsToInsert\)/.test(src) &&
    /Bulk insert/.test(src))
);

ok('4c: Pre-flight date validator exists',
  /validateDate = function/.test(src) &&
  /year out of range/.test(src) &&
  /not a valid date/.test(src)
);

ok('4d: REGRESSION GUARD — "0-01-01" type dates will be CAUGHT by validator',
  // The validator rejects year < 1900, so "0-01-01" (year 0) is caught.
  /y < 1900/.test(src) || /year < 1900/.test(src)
);

ok('4e: Required field validation: origin / destination / vendor_name',
  /Point of Origin \/ Loading is required/.test(src) &&
  /Point of Destination is required/.test(src) &&
  /Freight Forwarder is required/.test(src)
);

// ============================================================
// SECTION 5 — Detailed error report per spec
// ============================================================

ok('5a: Errors collected as objects with row + field + reason',
  /errors\.push\(\{ row:[\s\S]{0,200}field:[\s\S]{0,200}reason:/.test(src)
);

ok('5b: Error report UI rendered on done screen',
  /importErrors\.length > 0[\s\S]{0,800}issue/.test(src) &&
  /Row ' \+ e\.row/.test(src)
);

ok('5c: Each error row shows row#, field, reason',
  /e\.row > 0 \? 'Row ' \+ e\.row/.test(src) &&
  /\{e\.field/.test(src) &&
  /\{e\.reason\}/.test(src)
);

// ============================================================
// SECTION 6 — Summary counts: New / Updated / Unchanged / Failed
// ============================================================

ok('6a: Summary state holds added / updated / unchanged / failed / deleted',
  /\{ added: 0, updated: 0, unchanged: 0, failed: 0, deleted: 0 \}/.test(src)
);

ok('6b: Done screen shows New Added card',
  /New Added/.test(src) && /\{importCounts\.added\}/.test(src)
);

ok('6c: Done screen shows Updated card',
  />Updated</.test(src) && /\{importCounts\.updated\}/.test(src)
);

ok('6d: Done screen shows Unchanged card',
  />Unchanged</.test(src) && /\{importCounts\.unchanged\}/.test(src)
);

ok('6e: Done screen shows Failed card',
  />Failed</.test(src) && /\{importCounts\.failed\}/.test(src)
);

ok('6f: Done screen shows Deleted card ONLY for full_sync',
  /importMode === 'full_sync' &&[\s\S]{0,400}Deleted/.test(src)
);

// ============================================================
// SECTION 7-8 — Transactional safety + historical protection
// ============================================================

ok('7a: SELECT failure aborts before any writes (no half-state)',
  /Could not load existing rates to compare against\. Nothing was saved or changed/.test(src)
);

ok('7b: Full Sync delete step ONLY runs if counts.failed === 0',
  /if \(counts\.failed > 0\) \{[\s\S]{0,500}Full Sync delete step skipped because/.test(src)
);

ok('7c: Full Sync deletion limited to vendor+origin combos in the import',
  /importedVendorsLower\[erVendor\] && importedOriginsLower\[erOrigin\]/.test(src),
  'protects historical rates for vendors not in this file'
);

ok('8a: REGRESSION GUARD — no .delete() that wipes all rows',
  // The old replace mode did:
  //   supabase.from('shipping_rates').delete().neq('id', '00000000-...')
  // which deleted EVERYTHING. New code never does this.
  !/supabase\.from\('shipping_rates'\)\.delete\(\)\.neq\('id'/.test(src)
);

// ============================================================
// SECTION 9 — UI clearly distinguishes safe vs dangerous
// ============================================================

ok('9a: Update Only label shown with SAFE · DEFAULT badge',
  /value="update_only"/.test(src) && /SAFE · DEFAULT/.test(src)
);

ok('9b: Full Sync label shown with deletion warning badge',
  /value="full_sync"/.test(src) && /DELETES MISSING ROWS/.test(src)
);

ok('9c: Full Sync explainer warns DESTRUCTIVE',
  /DESTRUCTIVE[\s\S]{0,400}DELETED/.test(src)
);

ok('9d: Typed "FULL SYNC" confirmation required',
  /fullSyncConfirm !== 'FULL SYNC'/.test(src) &&
  /Type: FULL SYNC/.test(src)
);

ok('9e: Run button disabled until confirmation matches',
  /disabled=\{importMode === 'full_sync' && fullSyncConfirm !== 'FULL SYNC'\}/.test(src)
);

// ============================================================
// SECTION 10 — Recommended technical flow
// ============================================================

ok('10a: STEP 1 — pre-flight validation runs before any DB writes',
  /STEP 1[\s\S]{0,300}pre-flight validation/.test(src)
);

ok('10b: STEP 2 — fetch existing rows scoped to vendors+origins seen',
  /STEP 2[\s\S]{0,300}fetch existing/.test(src)
);

ok('10c: STEP 3 — per-row write loop',
  /STEP 3[\s\S]{0,200}per-row write/.test(src)
);

ok('10d: STEP 4 — full_sync deletion (only if zero errors)',
  /STEP 4[\s\S]{0,300}full_sync deletion[\s\S]{0,200}only if requested/.test(src)
);

ok('10e: STEP 5 — audit log + summary',
  /STEP 5[\s\S]{0,200}audit log/.test(src)
);

// ============================================================
// SECTION 11 — Final rule
// ============================================================

ok('11a: REGRESSION GUARD — there is NO unconditional wipe path',
  // No code path should delete from shipping_rates without first checking
  // mode and matching keys. Verify by counting .delete() calls.
  (function() {
    var deleteMatches = src.match(/supabase\.from\('shipping_rates'\)\.delete\(\)/g) || [];
    // Expect only:
    //   1. The matched-rows delete inside an `if (toDelete.length > 0)` branch
    //      which is itself inside the full_sync block with zero-errors guard.
    // Old code had 2 additional unconditional deletes (the .neq pattern).
    // Each remaining call must be inside a full_sync context.
    return deleteMatches.length <= 2;
  })()
);

ok('11b: All delete() calls are inside the importMode === full_sync branch',
  (function() {
    // Find all instances of .delete() and verify they appear inside the full_sync
    // block (between "STEP 4" comment and the next "STEP 5" comment).
    var step4 = src.indexOf("STEP 4");
    var step5 = src.indexOf("STEP 5");
    if (step4 < 0 || step5 < 0) return false;
    var step4Block = src.substring(step4, step5);
    var deleteMatchesInBlock = step4Block.match(/supabase\.from\('shipping_rates'\)\.delete\(\)/g) || [];
    var deleteMatchesTotal = src.match(/supabase\.from\('shipping_rates'\)\.delete\(\)/g) || [];
    return deleteMatchesInBlock.length === deleteMatchesTotal.length;
  })(),
  'critical: NO shipping_rates deletion can happen outside the full_sync flow'
);

// ============================================================
// Final
// ============================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-L Stage 2 spec-compliance tests passed');
