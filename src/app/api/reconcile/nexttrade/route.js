// /api/reconcile/nexttrade — v55.83-NM (Max Sep 23 2026): reconcile the orders
// scanned out of the USA/Canada warehouses (NextTradeIndustries.com/admin) with
// the Hub's invoices, and report what doesn't match.
//
// "I want to compare it to the invoices and release numbers that we have to
//  make sure that we have invoices for each order that was created. and if not
//  to have a report to show issues that don't match."
//
// TWO ACTIONS:
//   import — upsert pasted order rows keyed on release_number (re-pasting the
//            same page updates, never duplicates). Owner/Admin only.
//   report — read-only reconciliation. For every order, the matcher tries the
//            release number against BOTH invoice systems and SAYS which field
//            matched: sales invoices.order_number, invoices.invoice_number,
//            and accounting invoices.invoice_number (exact normalized, then
//            contains). Field attribution is the point — the first run TELLS
//            us which field the team actually uses, instead of me guessing
//            and silently matching nothing.
//
// HONESTY RULES: a release that matches nothing is listed as an ISSUE, never
// dropped; an invoice that looks like a release (dddd-ddd pattern) with no
// order is listed the other way. NOTE (Max, Sep 23): the Seconds/Thirds/Paper
// columns track only three product categories — zero across them does NOT
// mean nothing shipped, so zero-quantity is deliberately NOT flagged.
//
// FLAGGING (action 'flag'): the missing-invoice list must reach a PERSON,
// not sit in a report — one High-priority ticket per run, assigned to the
// chosen team member, listing every order without an invoice.
//
// SWC-safe: var + string concatenation only.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

var API_BUILD_MARKER = 'v55.83-NM-nexttrade-reconcile';
var PAGE = 1000; var MAX_ROWS = 20000;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}
async function fetchAll(buildQ) {
  var out = []; var from = 0;
  while (out.length < MAX_ROWS) {
    var res = await buildQ().range(from, from + PAGE - 1);
    if (res.error) { throw new Error(res.error.message); }
    var rows = res.data || [];
    for (var i = 0; i < rows.length; i++) { out.push(rows[i]); }
    if (rows.length < PAGE) { break; }
    from += PAGE;
  }
  return out;
}
function norm(x) { return String(x == null ? '' : x).toUpperCase().replace(/\s+/g, '').trim(); }
function toIso(d) {
  // site format MM-DD-YYYY -> YYYY-MM-DD; tolerate already-ISO and '-'
  var s = String(d || '').trim();
  if (!s || s === '-') { return null; }
  var m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) { return m[3] + '-' + m[1] + '-' + m[2]; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { return s; }
  return null;
}

// v55.83-NS — was reading a 'profiles' table; the Hub's identity lives in
// 'users' (see server-permissions.loadUserPermissions). That mismatch rejected
// EVERYONE, super admin included ("Report failed: Owner/Admin only" on Max's
// own account). Same proven lookup as every working route now.
async function requireAdmin(db, userId) {
  if (!userId) { return false; }
  var r = await db.from('users').select('id, role').eq('id', userId).limit(1);
  var p = r && r.data && r.data[0];
  return !!(p && (p.role === 'super_admin' || p.role === 'admin'));
}

// v55.83-NQ — the 6-hour automated check (Vercel cron, CRON_SECRET-guarded).
// Runs the same reconciliation and flags ONLY releases never flagged before
// (flagged_at null): each gap becomes exactly one ticket, ever. Assignee:
// profile matching RECON_ASSIGNEE_EMAIL, else the first super_admin.
export async function GET(req) {
  var db = admin();
  try {
    var authHeader = req.headers.get('authorization') || '';
    if (!process.env.CRON_SECRET || authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    var orders = await fetchAll(function () { return db.from('nexttrade_orders').select('release_number, customer_name, warehouse, order_date, container, status, country, qty_seconds, qty_thirds, qty_paper, flagged_at'); });
    if (!orders.length) { return NextResponse.json({ ok: true, checked: 0, note: 'no orders imported yet' }); }
    var sInv = await fetchAll(function () { return db.from('invoices').select('order_number, release_number'); });
    var aInv = await fetchAll(function () { return db.from('accounting_invoices').select('invoice_number, release_number'); });
    var keys = {};
    function nrm2(x) { return String(x == null ? '' : x).toUpperCase().replace(/\s+/g, ''); }
    sInv.forEach(function (v) { if (v.release_number) { keys[nrm2(v.release_number)] = true; } if (v.order_number) { keys[nrm2(v.order_number)] = true; } });
    aInv.forEach(function (v) { if (v.release_number) { keys[nrm2(v.release_number)] = true; } if (v.invoice_number) { keys[nrm2(v.invoice_number)] = true; } });
    var allK = Object.keys(keys);
    var newMiss = []; var totalMiss = 0; var oi;
    for (oi = 0; oi < orders.length; oi++) {
      var od = orders[oi];
      var rel2 = nrm2(od.release_number);
      var hit2 = keys[rel2] === true;
      if (!hit2) { var kx; for (kx = 0; kx < allK.length; kx++) { if (allK[kx].length > rel2.length && allK[kx].indexOf(rel2) > -1) { hit2 = true; break; } } }
      if (!hit2) { totalMiss += 1; if (!od.flagged_at) { newMiss.push(od); } }
    }
    if (!newMiss.length) { return NextResponse.json({ ok: true, checked: orders.length, still_missing_total: totalMiss, newly_flagged: 0 }); }
    // assignee
    var assignee2 = null;
    var wantEmail = process.env.RECON_ASSIGNEE_EMAIL || '';
    if (wantEmail) {
      var pr = await db.from('users').select('id').ilike('email', wantEmail).limit(1);
      if (pr && pr.data && pr.data[0]) { assignee2 = pr.data[0].id; }
    }
    if (!assignee2) {
      var sa = await db.from('users').select('id').eq('role', 'super_admin').limit(1);
      if (sa && sa.data && sa.data[0]) { assignee2 = sa.data[0].id; }
    }
    if (!assignee2) { return NextResponse.json({ ok: false, error: 'no assignee resolvable' }, { status: 500 }); }
    var tnum2 = 'REC-' + new Date().toISOString().substring(0, 10).replace(/-/g, '') + '-A' + Math.floor(Math.random() * 900 + 100);
    var lines2 = []; var lj;
    for (lj = 0; lj < newMiss.length && lj < 120; lj++) {
      var mo2 = newMiss[lj];
      lines2.push('• ' + mo2.release_number + ' — ' + (mo2.customer_name || '?') + ' — ' + (mo2.warehouse || '?') + ' — ordered ' + (mo2.order_date || '?') + (mo2.container && mo2.container !== '0' ? ' — container ' + mo2.container : ''));
    }
    var due2 = new Date(); due2.setDate(due2.getDate() + 3);
    var desc2 = 'AUTOMATED RECONCILIATION (6-hour check, ' + new Date().toISOString().substring(0, 16).replace('T', ' ') + ' UTC)\n'
      + newMiss.length + ' NEW warehouse order(s) have no matching invoice in the Hub (' + totalMiss + ' missing in total including previously flagged).\n\nEach needs an invoice created, or an explanation recorded on this ticket:\n\n'
      + lines2.join('\n') + (newMiss.length > 120 ? '\n…and ' + (newMiss.length - 120) + ' more — Admin > Order Reconciliation.' : '');
    var tk2 = await db.from('tickets').insert({ ticket_number: tnum2, title: '🚨 AUTO: ' + newMiss.length + ' new orders missing invoices', description: desc2, priority: 'high', status: 'New', assigned_to: assignee2, created_by: assignee2, due_date: due2.toISOString().substring(0, 10) }).select('id').single();
    if (!tk2.error) {
      try { await db.from('notifications').insert({ user_id: assignee2, type: 'ticket_assigned', title: 'Auto-reconciliation: ' + newMiss.length + ' new orders missing invoices', body: 'Ticket ' + tnum2 + ' — automated 6-hour check.', created_by: assignee2 }); } catch (eN2) {}
      try {
        var rels2 = newMiss.map(function (x) { return x.release_number; });
        await db.from('nexttrade_orders').update({ flagged_at: new Date().toISOString() }).in('release_number', rels2.slice(0, 500));
      } catch (eF2) {}
    }
    return NextResponse.json({ ok: true, checked: orders.length, still_missing_total: totalMiss, newly_flagged: newMiss.length, ticket_number: tnum2 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'cron failed' }, { status: 500 });
  }
}

export async function POST(req) {
  var db = admin();
  try {
    var body = await req.json();
    var action = body.action;
    var userId = body.user_id;
    if (!userId) { return NextResponse.json({ error: 'user_id required' }, { status: 400 }); }
    var isAdm = await requireAdmin(db, userId);
    if (!isAdm) { return NextResponse.json({ error: 'Owner/Admin only.' }, { status: 403 }); }

    if (action === 'import') {
      var rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) { return NextResponse.json({ error: 'No rows to import.' }, { status: 400 }); }
      var clean = []; var seen = {}; var skipped = 0; var i;
      for (i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        var rel = String(r.release_number || '').trim();
        if (!/^\d{3,4}-\d{2,5}$/.test(rel)) { skipped += 1; continue; }
        if (seen[rel]) { continue; } // duplicate lines in one paste (it happens) — first wins
        seen[rel] = true;
        clean.push({
          release_number: rel,
          customer_name: String(r.customer_name || '').trim() || null,
          warehouse: String(r.warehouse || '').trim() || null,
          container: String(r.container || '').trim() || null,
          order_date: toIso(r.order_date),
          shipped_date: toIso(r.shipped_date),
          arrival_date: toIso(r.arrival_date),
          status: String(r.status || '').trim() || null,
          country: String(r.country || '').trim() || null,
          qty_seconds: Number(r.qty_seconds) || 0,
          qty_thirds: Number(r.qty_thirds) || 0,
          qty_paper: Number(r.qty_paper) || 0,
          imported_by: userId,
          updated_at: new Date().toISOString()
        });
      }
      if (!clean.length) { return NextResponse.json({ error: 'Nothing importable — no valid RELEASE # values found.' }, { status: 400 }); }
      var up = await db.from('nexttrade_orders').upsert(clean, { onConflict: 'release_number' }).select('id');
      if (up.error) { return NextResponse.json({ error: up.error.message }, { status: 400 }); }
      return NextResponse.json({ ok: true, imported: clean.length, duplicates_in_paste: rows.length - clean.length - skipped, skipped_invalid: skipped, api_build_marker: API_BUILD_MARKER });
    }

    async function buildReport(df, dt) {
      var orders = await fetchAll(function () {
        var q = db.from('nexttrade_orders').select('*').order('order_date', { ascending: false });
        if (df) { q = q.gte('order_date', df); }
        if (dt) { q = q.lte('order_date', dt); }
        return q;
      });
      var salesInv = await fetchAll(function () {
        // v55.83-NW — sales invoices have NO invoice_number column (order_number only); selecting it 42703'd the whole report
        return db.from('invoices').select('order_number, release_number, customer_name, customer_name_en, invoice_date, total_amount, outstanding');
      });
      var acctInv = await fetchAll(function () {
        return db.from('accounting_invoices').select('invoice_number, release_number, invoice_date, due_date, total_amount, balance_due, payment_status, status');
      });
      // v55.83-NW (Max): invoices with no payment / open balance stay flagged
      // until money lands — a STANDING list, recomputed live every run.
      var unpaid = [];
      acctInv.forEach(function (v) {
        var bal = Number(v.balance_due) || 0;
        if (bal > 0.009 && String(v.status || '') !== 'void') {
          unpaid.push({ invoice: v.invoice_number, release: v.release_number || '', invoice_date: v.invoice_date, due_date: v.due_date, balance_due: bal, payment_status: v.payment_status || 'unpaid', overdue: !!(v.due_date && v.due_date < new Date().toISOString().substring(0, 10)) });
        }
      });
      unpaid.sort(function (a, b) { return b.balance_due - a.balance_due; });

      // Index Hub invoices by normalized keys, remembering WHICH field.
      var idx = {}; // norm -> [{system, field, ref, row}]
      function put(key, system, field, ref, row) {
        var k = norm(key); if (!k) { return; }
        if (!idx[k]) { idx[k] = []; }
        idx[k].push({ system: system, field: field, ref: ref, invoice_date: row.invoice_date || null, total_amount: row.total_amount != null ? Number(row.total_amount) : null });
      }
      // v55.83-NO — release_number first: it is the DEDICATED join key now.
      salesInv.forEach(function (v) {
        put(v.release_number, 'sales', 'release_number', v.order_number, v);
        put(v.order_number, 'sales', 'order_number', v.order_number, v);
      });
      acctInv.forEach(function (v) {
        put(v.release_number, 'accounting', 'release_number', v.invoice_number, v);
        put(v.invoice_number, 'accounting', 'invoice_number', v.invoice_number, v);
      });

      var normKeys = Object.keys(idx);
      var matched = []; var noInvoice = []; var byField = {};
      orders.forEach(function (o) {
        var rel = norm(o.release_number);
        var hits = idx[rel] || [];
        if (!hits.length) {
          // contains fallback: an invoice field that CONTAINS the release (e.g. "INV 1002-1193 Al Moustafa")
          var k;
          for (k = 0; k < normKeys.length && hits.length < 3; k++) {
            if (normKeys[k].length > rel.length && normKeys[k].indexOf(rel) > -1) {
              idx[normKeys[k]].forEach(function (h) { hits.push({ system: h.system, field: h.field + ' (contains)', ref: h.ref, invoice_date: h.invoice_date, total_amount: h.total_amount }); });
            }
          }
        }
        var totQ = (Number(o.qty_seconds) || 0) + (Number(o.qty_thirds) || 0) + (Number(o.qty_paper) || 0);
        if (hits.length) {
          var f = hits[0].system + '.' + hits[0].field;
          byField[f] = (byField[f] || 0) + 1;
          matched.push({ release_number: o.release_number, customer: o.customer_name, order_date: o.order_date, matched_via: f, invoice_ref: hits[0].ref, invoice_amount: hits[0].total_amount, extra_matches: hits.length - 1 });
        } else {
          noInvoice.push({ release_number: o.release_number, customer: o.customer_name, warehouse: o.warehouse, order_date: o.order_date, status: o.status, country: o.country, qty_total: totQ });
        }
      });

      // Reverse direction: Hub refs that LOOK like release numbers but have no order.
      var orderSet = {}; orders.forEach(function (o) { orderSet[norm(o.release_number)] = true; });
      var invNoOrder = [];
      function looksRelease(x) { return /^\d{3,4}-\d{2,5}$/.test(String(x || '').trim()); }
      salesInv.forEach(function (v) {
        var cand = v.release_number || (looksRelease(v.order_number) ? v.order_number : null);
        if (cand && !orderSet[norm(cand)]) { invNoOrder.push({ system: 'sales', ref: cand, customer: v.customer_name || v.customer_name_en, invoice_date: v.invoice_date, total_amount: v.total_amount }); }
      });
      acctInv.forEach(function (v) {
        var cand2 = v.release_number || (looksRelease(v.invoice_number) ? v.invoice_number : null);
        if (cand2 && !orderSet[norm(cand2)]) { invNoOrder.push({ system: 'accounting', ref: cand2, invoice_date: v.invoice_date, total_amount: v.total_amount }); }
      });

      return {
        ok: true,
        summary: {
          orders_in_scope: orders.length,
          matched: matched.length,
          orders_without_invoice: noInvoice.length,
          invoices_without_order: invNoOrder.length,
          invoices_with_open_balance: unpaid.length,
          overdue_open_balance: unpaid.filter(function (u) { return u.overdue; }).length,
          matched_by_field: byField,
          period: { from: df || 'all', to: dt || 'all' }
        },
        orders_without_invoice: noInvoice,
        invoices_without_order: invNoOrder.slice(0, 300),
        invoices_with_open_balance: unpaid.slice(0, 300),
        matched: matched.slice(0, 500),
        source: 'nexttrade_orders ' + orders.length + ' rows vs invoices ' + salesInv.length + ' + accounting ' + acctInv.length + ' rows, matched server-side',
        api_build_marker: API_BUILD_MARKER
      };
    }

    if (action === 'report') {
      var rep = await buildReport(body.date_from || null, body.date_to || null);
      return NextResponse.json(rep);
    }

    if (action === 'flag') {
      // v55.83-NN — flag the missing-invoice orders TO SOMEONE: one High ticket
      // per run, assigned to the chosen team member. No spam: one run = one
      // ticket carrying the whole list.
      var assignee = body.assignee_id;
      if (!assignee) { return NextResponse.json({ error: 'assignee_id required — pick who this gets flagged to.' }, { status: 400 }); }
      var rep2 = await buildReport(body.date_from || null, body.date_to || null);
      var missing = rep2.orders_without_invoice || [];
      if (!missing.length) { return NextResponse.json({ ok: true, flagged: 0, note: 'Nothing to flag — every order in scope has an invoice.', api_build_marker: API_BUILD_MARKER }); }
      var tnum = 'REC-' + new Date().toISOString().substring(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 900 + 100);
      var lines = []; var li;
      for (li = 0; li < missing.length && li < 120; li++) {
        var mo = missing[li];
        lines.push('• ' + mo.release_number + ' — ' + (mo.customer || '?') + ' — ' + (mo.warehouse || '?') + ' — ordered ' + (mo.order_date || '?') + (mo.container && mo.container !== '0' ? ' — container ' + mo.container : ''));
      }
      var desc = 'RECONCILIATION FLAG (' + new Date().toISOString().substring(0, 10) + ')\n'
        + missing.length + ' warehouse order(s) from NextTradeIndustries have NO matching invoice in the Hub (checked sales order/invoice numbers and accounting invoice numbers, period ' + (body.date_from || 'all') + ' to ' + (body.date_to || 'all') + ').\n\nEach needs an invoice created, or an explanation recorded on this ticket:\n\n'
        + lines.join('\n')
        + (missing.length > 120 ? '\n…and ' + (missing.length - 120) + ' more — full list in Admin > Order Reconciliation (CSV).' : '');
      var due = new Date(); due.setDate(due.getDate() + 3);
      var tIns = await db.from('tickets').insert({
        ticket_number: tnum,
        title: '🚨 ' + missing.length + ' orders missing invoices — reconciliation ' + new Date().toISOString().substring(0, 10),
        description: desc,
        priority: 'high',
        status: 'New',
        assigned_to: assignee,
        created_by: userId,
        due_date: due.toISOString().substring(0, 10)
      }).select('id, ticket_number').single();
      if (tIns.error) { return NextResponse.json({ error: 'Could not create the ticket: ' + tIns.error.message }, { status: 400 }); }
      try {
        await db.from('notifications').insert({ user_id: assignee, type: 'ticket_assigned', title: 'Reconciliation: ' + missing.length + ' orders missing invoices', body: 'Ticket ' + tnum + ' assigned to you — ' + missing.length + ' warehouse orders have no invoice in the Hub.', created_by: userId });
      } catch (eN) {}
      try {
        var relList = []; var rl;
        for (rl = 0; rl < missing.length; rl++) { relList.push(missing[rl].release_number); }
        await db.from('nexttrade_orders').update({ flagged_at: new Date().toISOString() }).in('release_number', relList.slice(0, 500));
      } catch (eF) {}
      return NextResponse.json({ ok: true, flagged: missing.length, ticket_number: tnum, ticket_id: tIns.data && tIns.data.id, api_build_marker: API_BUILD_MARKER });
    }


    if (action === 'list_missing') {
      // v55.83-NP — the backfill list: invoices with NO release number yet, both
      // systems, newest first, searchable. Feeds the fast-entry screen.
      var srch = String(body.search || '').trim();
      var accRows = await fetchAll(function () {
        var q = db.from('accounting_invoices').select('id, invoice_number, invoice_date, total_amount').is('release_number', null).order('invoice_date', { ascending: false });
        if (srch) { q = q.ilike('invoice_number', '%' + srch + '%'); }
        return q;
      });
      var custMap = {};
      try {
        var cs = await fetchAll(function () { return db.from('accounting_customers').select('id, name'); });
        cs.forEach(function (c) { custMap[c.id] = c.name; });
      } catch (eC2) {}
      var acc2 = await fetchAll(function () {
        var q = db.from('accounting_invoices').select('id, accounting_customer_id').is('release_number', null);
        return q;
      });
      var custById = {}; acc2.forEach(function (r) { custById[r.id] = custMap[r.accounting_customer_id] || ''; });
      var salRows = await fetchAll(function () {
        var q = db.from('invoices').select('id, order_number, customer_name, invoice_date, total_amount').is('release_number', null).order('invoice_date', { ascending: false });
        if (srch) { q = q.or('order_number.ilike.%' + srch + '%,customer_name.ilike.%' + srch + '%'); }
        return q;
      });
      var out = [];
      accRows.forEach(function (r) { out.push({ system: 'accounting', id: r.id, ref: r.invoice_number || '(no number)', customer: custById[r.id] || '', invoice_date: r.invoice_date, total_amount: r.total_amount }); });
      salRows.forEach(function (r) { out.push({ system: 'sales', id: r.id, ref: r.order_number || '(no number)', customer: r.customer_name || '', invoice_date: r.invoice_date, total_amount: r.total_amount }); });
      out.sort(function (a, b) { return String(b.invoice_date || '').localeCompare(String(a.invoice_date || '')); });
      return NextResponse.json({ ok: true, missing: out.slice(0, 300), total_missing: out.length, api_build_marker: API_BUILD_MARKER });
    }

    if (action === 'set_release') {
      // v55.83-NP — inline save from the fast-entry screen. Empty clears.
      var sys = body.system; var rid = body.id;
      var rn = String(body.release_number || '').trim();
      if (!rid || (sys !== 'accounting' && sys !== 'sales')) { return NextResponse.json({ error: 'system (accounting|sales) and id required.' }, { status: 400 }); }
      if (rn && !/^\d{3,4}-\d{2,5}$/.test(rn)) { return NextResponse.json({ error: 'Release format looks wrong — expected like 1002-1193. Not saved.' }, { status: 400 }); }
      var tbl2 = sys === 'accounting' ? 'accounting_invoices' : 'invoices';
      var upd = await db.from(tbl2).update({ release_number: rn || null }).eq('id', rid).select('id');
      if (upd.error) { return NextResponse.json({ error: upd.error.message }, { status: 400 }); }
      if (!upd.data || !upd.data.length) { return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 }); }
      return NextResponse.json({ ok: true, saved: rn || null, api_build_marker: API_BUILD_MARKER });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e && e.message) || 'reconcile failed', api_build_marker: API_BUILD_MARKER }, { status: 500 });
  }
}
