// /api/wave/account-feed-owner — v55.83-MC. The per-account single-writer SETTER (the piece that unblocks
// Hub-as-source). For each Wave Cash/Bank account in a silo, records who feeds Wave for it:
//   'HUB'       — Wave's own auto-import is OFF for this account; the Hub posts each txn already-categorized.
//   'WAVE_FEED' — Wave pulls this account directly; the Hub must NOT create (would duplicate).
//   null        — unset → pushing is BLOCKED by the firewall until chosen (safe default).
// Stored on wave_categories.wave_feed_owner (read by push-transaction + push-payment via feedOwnerVerdict).
// action:'list' returns the silo's bank/cash accounts + current owner; action:'set' writes one.
// Requires wave.settings.manage. SWC-safe: var + string concat.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assertPermission } from '../../../../lib/server-permissions';
import { isPlaceholderWaveBusiness } from '../../../../lib/wave-business-shared';
import { waveBankCashCandidates, classifyWaveAccount } from '../../../../lib/wave-bank-account-resolver';

var API_BUILD_MARKER = 'v55.83-MI-account-feed-owner-grouped';
var API_ROUTE = '/api/wave/account-feed-owner';

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); }

export async function GET() { return NextResponse.json({ route: API_ROUTE, api_build_marker: API_BUILD_MARKER }); }

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var bid = body.wave_business_id;
    var action = body.action || 'list';

    var _perm = await assertPermission(db, body.user_id, 'wave.settings.manage', req);
    if (!_perm.ok) { return NextResponse.json({ error: _perm.error, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: _perm.status }); }
    if (!bid) { return NextResponse.json({ error: 'No Wave business selected.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
    if (isPlaceholderWaveBusiness(bid)) { return NextResponse.json({ error: 'This silo is not connected to a real Wave business yet (placeholder id). Bind it under Accounting -> Wave Connection first.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }

    // select('*') is resilient — if the wave_feed_owner migration is not applied yet, the rows still return
    // (owner just reads as null/undefined) instead of erroring.
    var catRes = await db.from('wave_categories').select('*').eq('wave_business_id', bid);
    if (catRes && catRes.error) { return NextResponse.json({ db_error: catRes.error.message || String(catRes.error), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 200 }); }
    var allCats = (catRes && catRes.data) || [];
    var bankAccts = waveBankCashCandidates(allCats);

    if (action === 'list') {
      // v55.83-MI - Wave charts can contain repeated Cash/Bank rows with the same display name.
      // Showing every duplicate made Settings unreadable. Group exact-name duplicates and let one click
      // set the owner on every underlying Wave account id in that group.
      var groups = {};
      bankAccts.forEach(function (c) {
        var key = String(c.wave_account_name || c.wave_account_id || '').trim() || c.wave_account_id;
        if (!groups[key]) {
          groups[key] = { wave_account_id: c.wave_account_id, wave_account_ids: [], wave_account_name: c.wave_account_name, kind: classifyWaveAccount(c), wave_feed_owner: c.wave_feed_owner || null, duplicate_count: 0 };
        }
        groups[key].wave_account_ids.push(c.wave_account_id);
        groups[key].duplicate_count = groups[key].wave_account_ids.length;
        var owner = c.wave_feed_owner || null;
        if (groups[key].wave_feed_owner !== owner) { groups[key].wave_feed_owner = 'MIXED'; }
      });
      var list = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b); }).map(function (k) { return groups[k]; });
      var hasColumn = allCats.length === 0 || (allCats[0] && Object.prototype.hasOwnProperty.call(allCats[0], 'wave_feed_owner'));
      return NextResponse.json({ ok: true, accounts: list, migration_applied: hasColumn, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
    }

    if (action === 'set') {
      var acctId = body.wave_account_id;
      var acctIds = Array.isArray(body.wave_account_ids) && body.wave_account_ids.length ? body.wave_account_ids : (acctId ? [acctId] : []);
      var owner = body.wave_feed_owner; // 'HUB' | 'WAVE_FEED' | null
      if (!acctIds.length) { return NextResponse.json({ error: 'wave_account_id is required.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
      if (owner !== 'HUB' && owner !== 'WAVE_FEED' && owner !== null) { return NextResponse.json({ error: 'wave_feed_owner must be HUB, WAVE_FEED, or null.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
      // confirm the account is a real bank/cash account in this silo (never let a non-bank account be marked)
      var valid = {}; var i; for (i = 0; i < bankAccts.length; i++) { valid[bankAccts[i].wave_account_id] = true; }
      for (i = 0; i < acctIds.length; i++) {
        if (!valid[acctIds[i]]) { return NextResponse.json({ error: 'That account is not a Wave Cash/Bank account in this silo.', api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 }); }
      }
      var upd = await db.from('wave_categories').update({ wave_feed_owner: owner }).eq('wave_business_id', bid).in('wave_account_id', acctIds).select();
      if (upd && upd.error) {
        var em = upd.error.message || String(upd.error);
        var hint = /wave_feed_owner/.test(em) || /column/.test(em) ? ' — the wave_feed_owner column is missing; a super admin must run sql/v55-83-MC-wave-feed-owner.sql.' : '';
        return NextResponse.json({ db_error: em + hint, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 200 });
      }
      return NextResponse.json({ saved: true, wave_account_id: acctIds[0], wave_account_ids: acctIds, wave_feed_owner: owner, api_build_marker: API_BUILD_MARKER, route: API_ROUTE });
    }

    return NextResponse.json({ error: 'Unknown action: ' + action, api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || String(e), api_build_marker: API_BUILD_MARKER, route: API_ROUTE }, { status: 500 });
  }
}
