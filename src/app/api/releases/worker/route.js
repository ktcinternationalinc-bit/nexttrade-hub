// Dedicated office worker channel. Its credential grants no general database/API access.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import workerRules from '../../../../../release-management/lib/worker-authorization';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function response(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(request) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '');
  if (!token) return response({ error: { message: 'Worker authentication required.' } }, 401);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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
        result = await db.from('release_worker_status').upsert({ id: 1, worker, enabled: body.enabled === true, version: 'warehouse-worker-v1', last_seen: new Date().toISOString() }); break;
      case 'history':
      case 'requests': {
        let q = db.from('release_signoffs').select('*').eq('scope', 'warehouse').order('id', { ascending: true }).limit(5000);
        if (body.op === 'requests') q = q.in('action', ['go', 'rollback']);
        result = await q; break;
      }
      case 'authorized':
        if (!/^[a-f0-9-]{36}$/i.test(body.userId || '')) return response({ error: { message: 'Invalid approver.' } }, 400);
        result = { data: await workerRules.authorized(db, body.userId) }; break;
      case 'claim':
        if (!Number.isSafeInteger(Number(body.request)) || Number(body.request) < 1) return response({ error: { message: 'Invalid request ID.' } }, 400);
        result = await db.rpc('release_claim', { p_request: body.request, p_worker: worker }); break;
      case 'finish':
        result = await db.rpc('release_finish', { p_request: body.request, p_worker: worker, p_event: body.event, p_attention: body.attention }); break;
      default: return response({ error: { message: 'Unsupported worker operation.' } }, 400);
    }
    if (result.error) return response({ error: { message: 'Worker operation refused or database unavailable.' } }, 409);
    return response({ data: result.data });
  } catch { return response({ error: { message: 'Worker operation failed.' } }, 503); }
}
