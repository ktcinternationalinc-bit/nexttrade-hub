// Dedicated office worker channel. Its credential grants no general database/API access.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { releaseDb } from '../../../../lib/release-db'; // v55.83-YW — no-store reads
import workerRules from '../../../../../release-management/lib/worker-authorization';
import selection from '../../../../../release-management/lib/selection';
import { readReleasePause } from '../../../../lib/release-pause'; // v55.83-YQ — the stop switch
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// v55.83-YW — GET database reads in this route are never kept in Next's Data Cache (it froze Change Schedule at 24 Nov 12:08 UTC)
export const revalidate = 0;
export const fetchCache = 'force-no-store';
function response(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(request) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '');
  if (!token) return response({ error: { message: 'Worker authentication required.' } }, 401);
  const db = releaseDb();
  const hash = crypto.createHash('sha256').update(token[1]).digest('hex');
  const auth = await db.from('release_worker_credentials').select('worker,enabled').eq('token_hash', hash).maybeSingle();
  if (auth.error || !auth.data?.enabled) return response({ error: { message: 'Worker authentication refused.' } }, 403);
  const worker = auth.data.worker;
  let body;
  try { body = await request.json(); } catch { return response({ error: { message: 'Invalid request.' } }, 400); }
  try {
    let result;
    switch (body.op) {
      case 'heartbeat':
        result = await db.from('release_worker_status').upsert({ id: 1, worker, enabled: body.enabled === true,
          version: body.version === selection.DATA_WORKER_VERSION ? selection.DATA_WORKER_VERSION : 'warehouse-worker-v1', last_seen: new Date().toISOString() }); break;
      case 'history':
      case 'requests': {
        let q = db.from('release_signoffs').select('*').eq('scope', 'warehouse').order('id', { ascending: true }).limit(5000);
        if (body.op === 'requests') q = q.in('action', ['go', 'rollback']);
        result = await q; break;
      }
      case 'authorized':
        if (!/^[a-f0-9-]{36}$/i.test(body.userId || '')) return response({ error: { message: 'Invalid approver.' } }, 400);
        result = { data: await workerRules.authorized(db, body.userId, body.requireSuperAdmin === true) }; break;
      case 'claim':
        // v55.83-YQ (Max, 24 Nov) — while warehouse releases are STOPPED (or the switch cannot be read) no request is handed out.
        if ((await readReleasePause(db)).paused) return response({ data: false, paused: true });
        if (!Number.isSafeInteger(Number(body.request)) || Number(body.request) < 1) return response({ error: { message: 'Invalid request ID.' } }, 400);
        if (body.version !== selection.DATA_WORKER_VERSION) {
          const candidate = await db.from('release_signoffs').select('detail').eq('id', body.request).eq('scope', 'warehouse').maybeSingle();
          if (candidate.error) return response({ error: { message: 'Request type could not be confirmed.' } }, 409);
          if (candidate.data?.detail?.candidate?.dataChange === true) return response({ data: false });
        }
        result = await db.rpc('release_claim', { p_request: body.request, p_worker: worker }); break;
      case 'finish':
        result = await db.rpc('release_finish', { p_request: body.request, p_worker: worker, p_event: body.event, p_attention: body.attention }); break;
      default: return response({ error: { message: 'Unsupported worker operation.' } }, 400);
    }
    if (result.error) return response({ error: { message: 'Worker operation refused or database unavailable.' } }, 409);
    return response({ data: result.data });
  } catch { return response({ error: { message: 'Worker operation failed.' } }, 503); }
}
