// v55.83-KS — recognize ONLY a genuinely-absent table/column (so the bind tool may safely SKIP it),
// and NOTHING else. Codex caution: a broad `PGRST*` prefix wrongly swallowed PostgREST connection /
// pool / JWT errors (PGRST000, PGRST003, PGRST301, …) as "optional missing table", which could let a
// real read failure pass as zero rows. Whitelist is now exact:
//   • Postgres: 42P01 (undefined_table), 42703 (undefined_column)
//   • PostgREST schema-cache: PGRST205 (table not found), PGRST204 (column not found)
//   • message fallback: "...does not exist" (Postgres) or "could not find ... in the schema cache" (PostgREST)
// Any other error (connection/pool/JWT/timeout/permission) returns false → the caller MUST abort.
var MISSING_OBJECT_CODES = { '42P01': 1, '42703': 1, 'PGRST205': 1, 'PGRST204': 1 };

export function isMissingObjErr(err) {
  if (!err) { return false; }
  var code = String(err.code || '');
  if (MISSING_OBJECT_CODES[code]) { return true; }
  var msg = String(err.message || '').toLowerCase();
  if (msg.indexOf('does not exist') >= 0) { return true; }
  if (msg.indexOf('could not find') >= 0 && msg.indexOf('schema cache') >= 0) { return true; }
  return false;
}
