// v55.83-UG — the category rules' own timer (vercel.json, every 15 minutes). Max, Nov 18: "why does this only work if i click on test?
// shouldn't it work automatically?" Fills BLANK bank lines from the rules (never a person's pick, never a verified line) and records the
// run for the rules screen. Needs Authorization: Bearer CRON_SECRET (Vercel sends it); refused when the secret is not set.
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runRulesAndRecord } from '../../../../../lib/expense-rules-server';

export var dynamic = 'force-dynamic';
export var maxDuration = 60;

export async function GET(req) {
  var secret = process.env.CRON_SECRET;
  if (!secret) { return NextResponse.json({ ok: false, error: 'CRON_SECRET is not set — the automatic rules timer will not run without it (rules still run after every bank sync).' }, { status: 503 }); }
  if ((req.headers.get('authorization') || '') !== 'Bearer ' + secret) { return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }); }
  var db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  var res = await runRulesAndRecord(db, 'timer');
  return NextResponse.json({ ok: !res.error, filled: res.applied || 0, flagged: res.flagged || 0, scanned: res.scanned || 0, error: res.error || null });
}
