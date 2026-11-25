// v55.83-SV — the background worker for the Sourcing desk: runs ONE due research job per call.
// Called by the Vercel timer every 5 minutes (CRON_SECRET bearer). People start it from the desk with “Run now”
// (POST /api/commercial, action run_now), which checks their permission — this route accepts the timer only.
import { NextResponse } from 'next/server';
import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { runNextJob } from '../../../../lib/sourcing-server';
import { mailCycle } from '../../../../lib/commercial-mail-server'; // v55.83-SW — send what was approved, read replies, prepare follow-ups

export const dynamic = 'force-dynamic';
// v55.83-YY — this GET-only route never keeps its reads in Next's Data Cache (it would otherwise keep them forever, across deployments)
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function isCron(req) {
  var secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) { return false; }
  return (req.headers.get('authorization') || '') === 'Bearer ' + secret;
}

export async function GET(req) {
  if (!isCron(req)) { return NextResponse.json({ ok: false, error: 'Timer only.' }, { status: 401 }); }
  try {
    var db = admin();
    var r = await runNextJob(db, { budgetMs: 180000 });
    var mc = null; try { mc = await mailCycle(db, { budgetMs: 40000 }); } catch (eM) { mc = { error: (eM && eM.message) || 'mail error' }; }
    return NextResponse.json({ ok: true, ran: r.ran, job_ok: r.ok === true, needs_sql: !!r.needs_sql, error: r.error || null,
      mail: mc ? { sent: mc.sent || 0, replies: (mc.inbox && mc.inbox.stored) || 0, bounces: (mc.inbox && mc.inbox.bounces) || 0, followups: mc.followups || 0, stuck: mc.stuck || 0, not_configured: !!mc.not_configured, error: (mc.inbox && mc.inbox.error) || mc.error || null } : null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e && e.message) || 'worker error' }, { status: 500 });
  }
}
