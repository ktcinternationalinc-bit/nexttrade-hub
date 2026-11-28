'use strict';
// Shared by the Hub and the office worker. Candidate files are immutable, reviewed code artifacts.
var crypto = require('crypto');
var DATA_WORKER_VERSION = 'warehouse-worker-v1-database-releases';
var ORDER_QUEUE_MIGRATIONS = [
  '2026_11_15_000001_add_release_columns_to_order_queues.php',
  '2026_11_15_000002_add_released_by_to_order_queues.php',
];
// JSONB can reorder object keys. Keep the original manifest field order for
// existing approvals and preserve array order, including migration order.
var manifestKeyOrder = new Map([
  'sha', 'target', 'dataCompatible', 'files', 'dataPlan',
  'path', 'before', 'after',
  'kind', 'eligibleCount', 'snapshotHash', 'scriptHash', 'migrations', 'name', 'sha256',
].map(function (key, index) { return [key, index]; }));
function canonicalManifest(value) {
  if (Array.isArray(value)) return value.map(canonicalManifest);
  if (!value || typeof value !== 'object') return value;
  var keys = Object.keys(value).sort(function (a, b) {
    var order = (manifestKeyOrder.get(a) ?? Infinity) - (manifestKeyOrder.get(b) ?? Infinity);
    return order || (a < b ? -1 : a > b ? 1 : 0);
  });
  return Object.fromEntries(keys.map(function (key) { return [key, canonicalManifest(value[key])]; }));
}
function digest(manifest) { return crypto.createHash('sha256').update(JSON.stringify(canonicalManifest(manifest))).digest('hex'); }
function isPalletCorrection(item) {
  var plan = item && item.manifest && item.manifest.dataPlan;
  return !!(item?.id === 'wh-bug-001' && item.dataChange === true && plan?.kind === 'pallet-unit-correction-v1'
    && Number.isSafeInteger(plan.eligibleCount) && plan.eligibleCount > 0
    && /^[a-f0-9]{64}$/.test(plan.snapshotHash || '')
    && /^[a-f0-9]{64}$/.test(plan.scriptHash || '')
    && Array.isArray(item.dependsOn) && item.dependsOn.length === 1 && item.dependsOn[0] === 'wh-bug-001-save-path');
}
function isOrderQueueRelease(item) {
  var plan = item && item.manifest && item.manifest.dataPlan;
  return !!(item?.id === 'wh-order-queue' && item.dataChange === true && plan?.kind === 'order-queue-schema-v1'
    && Array.isArray(plan.migrations) && plan.migrations.length === ORDER_QUEUE_MIGRATIONS.length
    && plan.migrations.every(function (file, index) { return file?.name === ORDER_QUEUE_MIGRATIONS[index] && /^[a-f0-9]{64}$/.test(file.sha256 || ''); }));
}
function supportedDataPlan(item) { return isPalletCorrection(item) || isOrderQueueRelease(item); }
function codePath(p) {
  return typeof p === 'string' && /^(app\/|resources\/views\/|public\/assets\/|routes\/|config\/)[A-Za-z0-9._\/-]+\.(php|js|css|json|svg|png|jpg|jpeg|webp|woff2?)$/.test(p)
    && !p.split('/').some(function (s) { return s === '..' || s === '.' || s === '' || s.indexOf('.env') === 0; });
}
function candidateProblems(item) {
  var out = []; var m = item && item.manifest;
  if (!item || item.repo !== 'nextrade_WAREHOUSE') { return ['Not an NT Warehouse code change.']; }
  var dataOnly = isPalletCorrection(item);
  if (item.dataChange && !supportedDataPlan(item)) { return ['This database change needs a reviewed execution plan.']; }
  if (!m || !/^[0-9a-f]{40}$/.test(m.sha || '') || m.target !== 'production' || m.dataCompatible !== true ||
      !Array.isArray(m.files) || (dataOnly ? m.files.length !== 0 : !m.files.length || (m.dataPlan && !isOrderQueueRelease(item)))) {
    out.push('Exact build, reviewed file fingerprints and data-compatible rollback confirmation are required.'); return out;
  }
  var seen = {};
  m.files.forEach(function (f) {
    if (!f || !codePath(f.path) || seen[f.path] || !/^[0-9a-f]{64}$/.test(f.after || '') || !(f.before === '' || /^[0-9a-f]{64}$/.test(f.before || ''))) out.push('Invalid or duplicated code file in the manifest.');
    else seen[f.path] = true;
  });
  var hash = digest(m);
  [['codexRef', 'Code review'], ['behavioralQa', 'Staging functional QA']].forEach(function (v) {
    var e = item[v[0]] || {};
    if (e.sha !== m.sha || e.target !== 'production' || e.manifestDigest !== hash || (v[0] === 'codexRef' ? !e.feedbackRef : e.result !== 'PASS' || e.kind !== 'behavioral')) out.push(v[1] + ' must pass this exact build and file manifest.');
  });
  return out;
}
function selectionPlan(items, states, ids, action) {
  var problems = []; var chosen = []; var byId = {}; var paths = {};
  (items || []).forEach(function (it) { byId[it.id] = it; });
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length) return { ok: false, problems: ['Select between 1 and 20 different changes.'], items: [] };
  if (action !== 'go' && action !== 'rollback') return { ok: false, problems: ['Unknown action.'], items: [] };
  ids.forEach(function (id) {
    var it = byId[id]; var st = states[id] || {};
    if (!it) { problems.push('Unknown change: ' + id); return; }
    if (!(action === 'go' ? st.canGo : st.canRollback)) {
      var why = st.why;
      if (action === 'go' && (st.where === 'live' || st.where === 'deployed')) {
        why = 'Already on production. See Change Schedule history for the completed deployment.';
      } else if (action === 'go' && st.kind === 'go' && !why) {
        why = 'Already approved and queued. See Change Schedule for execution status.';
      }
      problems.push(it.title + ': ' + (why || 'Not ready for this action.'));
    } else if (action === 'go') {
      candidateProblems(it).forEach(function (p) { problems.push(it.title + ': ' + p); });
    }
    if (it.dataChange && action === 'rollback' && !isOrderQueueRelease(it)) problems.push(it.title + ': data restoration requires a reviewed database operation.');
    if (action === 'go') {
      ((it.manifest && it.manifest.files) || []).forEach(function (f) {
        if (paths[f.path]) problems.push('Selected fixes share ' + f.path + '. Prepare and test one combined candidate first.');
        paths[f.path] = id;
      });
      (it.dependsOn || []).forEach(function (dep) {
        if (ids.indexOf(dep) < 0 && !['live', 'deployed'].includes((states[dep] || {}).where)) problems.push(it.title + ': select ' + (byId[dep]?.title || dep) + ' too, or deploy it first.');
      });
    } else {
      (items || []).forEach(function (other) {
        if ((other.dependsOn || []).includes(id) && ['live', 'deployed'].includes((states[other.id] || {}).where)) problems.push(it.title + ': first roll back dependent change ' + other.title);
      });
    }
    chosen.push(it);
  });
  // Dependency order, with cycles rejected rather than guessed.
  var ordered = []; var visiting = {}; var done = {};
  function visit(it) {
    if (done[it.id]) return;
    if (visiting[it.id]) { problems.push('Cyclic release dependencies.'); return; }
    visiting[it.id] = true;
    if (action === 'go') (it.dependsOn || []).forEach(function (id) { if (ids.includes(id) && byId[id]) visit(byId[id]); });
    visiting[it.id] = false; done[it.id] = true; ordered.push(it);
  }
  chosen.forEach(visit);
  return { ok: problems.length === 0, problems: problems, items: ordered };
}
module.exports = { DATA_WORKER_VERSION, digest, codePath, supportedDataPlan, isPalletCorrection, isOrderQueueRelease, candidateProblems, selectionPlan };
