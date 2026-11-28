'use strict';

const { candidateProblems, isPalletCorrection } = require('./selection');

function warehouseCheckpoint(history, items) {
  const active = new Map();
  const approvals = new Map();
  const unresolved = new Set();
  const byId = new Map(items.map(item => [item.id, item]));
  const verifiedVersions = [];
  let dataBoundary = 0;
  const rows = [...history].sort((a, b) => Number(a.id) - Number(b.id));

  for (const row of rows) {
    const id = Number(row.id);
    const itemId = row.item_id;
    const current = active.get(itemId);
    const approval = approvals.get(Number(row.ref_id));
    const candidate = approval?.item_id === itemId && approval.sha === row.sha ? approval.detail?.candidate : null;
    if (row.action === 'go') approvals.set(id, row);
    if (row.action === 'moved') {
      active.set(itemId, { id, itemId, sha: row.sha, backup: row.detail?.backup, candidate, checked: false });
      unresolved.delete(itemId);
      if (candidate?.dataChange !== false) dataBoundary = id;
    }
    if (row.action === 'checked_live' && current?.id === Number(row.ref_id) && current.sha === row.sha) {
      current.checked = true;
      unresolved.delete(itemId);
      if (!unresolved.size && [...active.values()].every(move => move.checked)) {
        const moveIds = new Set([...active.values()].map(move => move.id));
        if (!moveIds.size) continue;
        const version = { id, at: row.created_at, by: row.signed_by_name || row.recorded_by, moveIds, changeCount: moveIds.size };
        verifiedVersions.push(version);
      }
    }
    if (row.action === 'rolled_back') {
      active.delete(itemId);
      unresolved.delete(itemId);
    }
    if (row.action === 'recovery_confirmed') {
      unresolved.delete(itemId);
      if (row.detail?.where === 'staging') active.delete(itemId);
      if (row.detail?.where === 'live' && current) current.checked = false;
      dataBoundary = id;
    }
    if (row.action === 'recovery_incomplete' || row.action === 'rollback_failed') unresolved.add(itemId);
    if (row.action === 'failed') {
      const outcome = row.detail?.outcome;
      if (outcome !== 'not_replaced' && outcome !== 'restored') unresolved.add(itemId);
      if (candidate?.dataChange !== false && !(isPalletCorrection(candidate) && outcome === 'not_replaced')) dataBoundary = id;
    }
  }

  const currentIds = new Set([...active.values()].map(move => move.id));
  const isCurrent = version => version.moveIds.size === currentIds.size && [...version.moveIds].every(id => currentIds.has(id));
  const summary = version => ({ id: version.id, at: version.at, by: version.by, changeCount: version.changeCount });
  const last = verifiedVersions.at(-1);
  if (!last) return { lastVerified: null, reason: 'Record production verification for all deployed changes to establish a good version.' };
  const result = { lastVerified: summary(last), isCurrent: !unresolved.size && isCurrent(last) };
  if (unresolved.size) return { ...result, reason: 'Resolve the outstanding production recovery before restoring a version.' };

  const target = result.isCurrent ? verifiedVersions.findLast(version => !isCurrent(version)) : last;
  if (!target) return result;
  if (![...target.moveIds].every(id => currentIds.has(id))) {
    return { ...result, reason: 'That version includes code that has already been removed. It needs a new reviewed release.' };
  }
  if (dataBoundary > target.id) {
    return { ...result, reason: 'A later release changed data or left its effects unverified. Review data compatibility before restoring older code.' };
  }
  const changes = [...active.values()].filter(move => !target.moveIds.has(move.id)).sort((a, b) => b.id - a.id);
  if (!changes.length) return result;
  const unsafe = changes.some(({ itemId, candidate, sha, backup }) => {
    return !byId.has(itemId) || candidate?.id !== itemId || candidate?.dataChange !== false || candidate.manifest?.sha !== sha ||
      !/^\/home\/[a-z0-9_-]+\/code-backups\/[a-z0-9_-]+$/i.test(backup || '') || candidateProblems(candidate).length;
  });
  if (unsafe) return { ...result, reason: 'A later change lacks a reviewed code-only restore and a recorded backup.' };
  const next = changes[0];
  return { ...result, restore: { checkpoint: summary(target), remaining: changes.length, itemId: next.itemId, moveId: next.id } };
}

module.exports = { warehouseCheckpoint };
