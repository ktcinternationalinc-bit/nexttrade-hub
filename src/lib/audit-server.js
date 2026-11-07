// v55.83-QI — ONE audit writer (Max, Nov 7 12:33: "should be audit of
// whoever changes or matches or creates or validates etc").
// Append-only, fail-soft: an audit hiccup NEVER blocks the actual work —
// but a skipped write is still visible because every row carries details.
export async function audit(db, actorId, action, entity, entityId, details) {
  try {
    await db.from('hub_audit_log').insert({
      actor_id: actorId || null,
      action: String(action || 'unknown').substring(0, 60),
      entity: entity ? String(entity).substring(0, 40) : null,
      entity_id: entityId != null ? String(entityId).substring(0, 80) : null,
      details: details || null,
    });
  } catch (e) { /* fail-soft by design */ }
}
