import { createHmac, timingSafeEqual } from 'node:crypto';
import { itemSignState, latestByItem } from './release-signoff';
import selection from '../../release-management/lib/selection';

const REVIEW_WINDOW_MS = 15 * 60 * 1000;

export function reviewState(register, history) {
  const latest = latestByItem(history);
  const heads = Object.fromEntries(register.items.map(item => [item.id, 0]));
  for (const row of history) heads[row.item_id] = Math.max(heads[row.item_id] || 0, Number(row.id));
  const states = Object.fromEntries(register.items.map(item => [item.id, itemSignState(item, latest[item.id])]));
  return { latest, heads, states };
}

function selectionDetails(ids, register, heads) {
  const items = new Map(register.items.map(item => [item.id, item]));
  return ids.map(id => {
    const item = items.get(id);
    return [id, heads[id], item?.manifest?.sha || '', item?.manifest ? selection.digest(item.manifest) : '',
      item?.dependsOn || [], item?.dataChange === true];
  });
}

function signature(userId, ids, register, heads, timestamp) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createHmac('sha256', key).update(JSON.stringify(['warehouse-deployment-review-v1', userId, timestamp,
    selectionDetails(ids, register, heads)])).digest();
}

export function issueReview(userId, ids, register, heads, now = Date.now()) {
  const mac = signature(userId, ids, register, heads, now);
  return mac && now + '.' + mac.toString('hex');
}

export function matchesReview(receipt, userId, ids, register, heads, now = Date.now()) {
  const match = typeof receipt === 'string' && /^(\d{13})\.([0-9a-f]{64})$/.exec(receipt);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (timestamp > now || now - timestamp >= REVIEW_WINDOW_MS) return false;
  const mac = signature(userId, ids, register, heads, timestamp);
  return !!mac && timingSafeEqual(mac, Buffer.from(match[2], 'hex'));
}
