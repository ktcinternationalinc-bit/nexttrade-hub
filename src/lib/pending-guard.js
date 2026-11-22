// v55.83-XT (Max 22 Nov: ignore pending transactions) — the server-side rule every money / category / match / Wave action
// uses: a bank line the bank still shows as PENDING is never categorized, matched, split, paired, reviewed, learned from or
// pushed. The screen hides those buttons too, but only this check stops a direct call. Fail closed: if the line cannot be
// read, the action is refused. Server-safe (no 'use client'). Var + concat only.

export var PENDING_REFUSAL = 'This bank line is still pending at the bank. Pending lines never count in any total, match or rule. ' +
  'Wait for the final line: it replaces this one automatically at the next bank sync.';

function idsOf(list) {
  var out = [];
  (list || []).forEach(function (v) { if (v !== null && v !== undefined && v !== '' && out.indexOf(String(v)) < 0) { out.push(String(v)); } });
  return out;
}

// → { ok: true } | { ok: false, status, error, pending_ids }
export async function refusePending(db, ids) {
  var list = idsOf(ids);
  if (!list.length) { return { ok: true }; }
  try {
    var hit = [];
    for (var i = 0; i < list.length; i += 200) {
      var q = await db.from('bank_transactions').select('id, pending').in('id', list.slice(i, i + 200));
      if (q.error) { return { ok: false, status: 503, error: 'Could not check whether the bank line is still pending. Nothing was changed.' }; }
      (q.data || []).forEach(function (r) { if (r && r.pending === true) { hit.push(r.id); } });
    }
    if (hit.length) { return { ok: false, status: 409, error: PENDING_REFUSAL, pending_ids: hit }; }
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 503, error: 'Could not check whether the bank line is still pending. Nothing was changed.' };
  }
}

// pure: drop pending lines from a list a screen or report is about to total / count
export function notPending(rows) { return (rows || []).filter(function (r) { return !(r && r.pending === true); }); }
