// v55.83-BH — READ-ONLY reconciliation audit. Pulls ALL Wave invoices and ALL
// Hub invoices, joins on wave_invoice_id, and reports per-invoice match, by-year
// counts (Wave vs Hub), Wave-vs-Hub AR totals + difference, status breakdown,
// and the worst mismatches. Writes NOTHING. Service-role. SWC-safe (var/concat).
import { createClient } from '@supabase/supabase-js';

function num(m) { if (!m || m.value == null) { return 0; } var v = Number(String(m.value).replace(/,/g, '')); return isNaN(v) ? 0 : v; }
function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
function yr(d) { return d ? String(d).substring(0, 4) : '(none)'; }
function curOf(n) {
  if (n.total && n.total.currency && n.total.currency.code) { return n.total.currency.code; }
  if (n.amountDue && n.amountDue.currency && n.amountDue.currency.code) { return n.amountDue.currency.code; }
  return 'USD';
}
// Build a date-sorted rate index from fx_rates rows. Returns convert(amount, cur, date) -> USD or null.
function buildConverter(rateRows) {
  var idx = {}; // 'FROM>TO' -> array of {date, rate} sorted asc
  for (var i = 0; i < rateRows.length; i++) {
    var rr = rateRows[i];
    var key = (rr.from_currency || '') + '>' + (rr.to_currency || '');
    if (!idx[key]) { idx[key] = []; }
    idx[key].push({ date: rr.rate_date || '', rate: Number(rr.rate) || 0 });
  }
  Object.keys(idx).forEach(function (k) { idx[k].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }); });
  function pick(arr, date) {
    if (!arr || arr.length === 0) { return null; }
    var chosen = null;
    for (var j = 0; j < arr.length; j++) { if (arr[j].date <= date) { chosen = arr[j]; } }
    if (!chosen) { chosen = arr[0]; } // before any logged rate → use earliest known
    return chosen.rate > 0 ? chosen.rate : null;
  }
  return function (amount, cur, date) {
    if (!cur || cur === 'USD') { return r2(amount); }
    var d = date || '9999-12-31';
    var rUsdToCur = pick(idx['USD>' + cur], d);   // 1 USD = rUsdToCur cur
    if (rUsdToCur) { return r2(amount / rUsdToCur); }
    var rCurToUsd = pick(idx[cur + '>USD'], d);    // 1 cur = rCurToUsd USD
    if (rCurToUsd) { return r2(amount * rCurToUsd); }
    return null; // unconvertible (no rate logged for this pair)
  };
}

function gqlPage(token, bid, page) {
  var query = 'query($bid: ID!, $page: Int!) { business(id:$bid){ invoices(page:$page,pageSize:50){'
    + ' pageInfo{ currentPage totalPages totalCount } edges{ node{'
    + ' id invoiceNumber status invoiceDate dueDate'
    + ' customer{ id name }'
    + ' total{ value currency{ code } } amountPaid{ value } amountDue{ value currency{ code } } } } } } }';
  return fetch('https://gql.waveapps.com/graphql/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ query: query, variables: { bid: bid, page: page } })
  }).then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, json: j }; }); });
}

function fetchAllHub(admin) {
  var rows = []; var from = 0; var pageSize = 1000; var guard = 0;
  function loop() {
    guard++;
    if (guard > 100) { return Promise.resolve(rows); }
    return admin.from('accounting_invoices')
      .select('id, wave_invoice_id, invoice_number, invoice_date, due_date, total_amount, amount_paid, wave_imported_paid, balance_due, record_status, approval_status, payment_status, source')
      .range(from, from + pageSize - 1)
      .then(function (res) {
        if (res.error || !res.data || res.data.length === 0) { return rows; }
        for (var i = 0; i < res.data.length; i++) { rows.push(res.data[i]); }
        if (res.data.length < pageSize) { return rows; }
        from += pageSize;
        return loop();
      });
  }
  return loop();
}

export async function POST(request) {
  var waveToken = process.env.WAVE_ACCESS_TOKEN;
  var supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!waveToken) { return Response.json({ ok: false, error: 'No Wave token configured.' }); }
  if (!supaUrl || !serviceKey) { return Response.json({ ok: false, error: 'Server database key missing (SUPABASE_SERVICE_ROLE_KEY).' }); }

  var body = null;
  try { body = await request.json(); } catch (e) { body = {}; }
  var businessId = body && body.businessId;
  if (!businessId) { return Response.json({ ok: false, error: 'Missing businessId.' }); }

  var admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  try {
    // 1) Pull ALL Wave invoices
    var waveList = [];
    var first = await gqlPage(waveToken, businessId, 1);
    if (first.json && first.json.errors) { return Response.json({ ok: false, error: 'Wave API error: ' + JSON.stringify(first.json.errors).substring(0, 300) }); }
    var biz = first.json && first.json.data && first.json.data.business;
    if (!biz || !biz.invoices) { return Response.json({ ok: false, error: 'Wave returned no business/invoices for that ID.' }); }
    var totalPages = biz.invoices.pageInfo.totalPages;
    function pushEdges(edges) { for (var i = 0; i < edges.length; i++) { waveList.push(edges[i].node); } }
    pushEdges(biz.invoices.edges);
    var p = 2;
    while (p <= totalPages) {
      var pg = await gqlPage(waveToken, businessId, p);
      var b2 = pg.json && pg.json.data && pg.json.data.business;
      if (b2 && b2.invoices) { pushEdges(b2.invoices.edges); }
      p++;
      if (p > 400) { break; }
    }

    // 2) Pull ALL Hub invoices
    var hub = await fetchAllHub(admin);
    var hubByWave = {};
    var hubNoWave = 0;
    hub.forEach(function (h) { if (h.wave_invoice_id) { hubByWave[h.wave_invoice_id] = h; } else { hubNoWave++; } });

    // 3) Join + compare
    var rows = [];
    var byYear = {};               // year -> { wave, hub, matched }
    var statusWave = {};           // wave status -> count
    var waveAR = 0, hubAR = 0;     // open balances (Wave amountDue vs Hub balance_due)
    var waveAR_nonDraft = 0;
    var waveTotalSum = 0, wavePaidSum = 0;
    var matched = 0, mismatched = 0, missingInHub = 0;
    var mism = [];

    function liveApproved(h) {
      if (!h) return false;
      var rs = h.record_status; var ap = h.approval_status;
      var liveOk = (rs !== 'void' && rs !== 'cancelled' && rs !== 'archived' && rs !== 'deleted');
      return liveOk && ap === 'approved';
    }

    waveList.forEach(function (n) {
      var y = yr(n.invoiceDate);
      if (!byYear[y]) byYear[y] = { wave: 0, hub: 0, matched: 0 };
      byYear[y].wave += 1;
      statusWave[n.status || '(none)'] = (statusWave[n.status || '(none)'] || 0) + 1;

      var wTotal = r2(num(n.total));
      var wPaid = r2(num(n.amountPaid));
      var wDue = r2(num(n.amountDue));
      waveTotalSum += wTotal; wavePaidSum += wPaid; waveAR += wDue;
      if (n.status !== 'DRAFT' && n.status !== 'SAVED') { waveAR_nonDraft += wDue; }

      var h = hubByWave[n.id];
      if (!h) { missingInHub += 1; mism.push({ num: n.invoiceNumber, year: y, in: 'wave_only', wStatus: n.status, wTotal: wTotal, wPaid: wPaid, wDue: wDue }); return; }
      byYear[y].hub += 1;

      var hTotal = r2(Number(h.total_amount) || 0);
      var hPaid = r2(Number(h.amount_paid) || 0);
      var hBal = r2(h.balance_due != null ? Number(h.balance_due) : (hTotal - hPaid));
      if (liveApproved(h)) { hubAR += hBal; }

      var okTotal = Math.abs(wTotal - hTotal) < 0.01;
      var okBal = Math.abs(wDue - hBal) < 0.01;
      var okPaid = Math.abs(wPaid - hPaid) < 0.01;
      var ok = okTotal && okBal && okPaid;
      if (ok) { matched += 1; byYear[y].matched += 1; }
      else {
        mismatched += 1;
        mism.push({
          num: n.invoiceNumber, year: y, in: 'both', wStatus: n.status, hStatus: h.payment_status,
          source: h.source, record: h.record_status, approval: h.approval_status,
          wTotal: wTotal, wPaid: wPaid, wDue: wDue, hTotal: hTotal, hPaid: hPaid, hBal: hBal,
          dTotal: r2(hTotal - wTotal), dPaid: r2(hPaid - wPaid), dBal: r2(hBal - wDue)
        });
      }
    });

    // Hub rows whose wave id isn't in Wave anymore
    var waveIds = {}; waveList.forEach(function (n) { waveIds[n.id] = true; });
    var missingInWave = 0;
    hub.forEach(function (h) { if (h.wave_invoice_id && !waveIds[h.wave_invoice_id]) { missingInWave += 1; } });

    // sort mismatches by absolute balance gap (worst first)
    mism.sort(function (a, b) { var ax = Math.abs(a.dBal != null ? a.dBal : (a.wDue || 0)); var bx = Math.abs(b.dBal != null ? b.dBal : (b.wDue || 0)); return bx - ax; });

    // ===== AR INTEGRITY AUDIT (read-only): currency + drafts =====
    var fxRes = await admin.from('fx_rates').select('from_currency,to_currency,rate,rate_date').then(function (x) { return x; }).catch(function () { return { data: [] }; });
    var convert = buildConverter((fxRes && fxRes.data) || []);

    function isDraftWave(st) { return st === 'DRAFT' || st === 'SAVED'; }
    function hubLive(h) { var rs = h && h.record_status; return rs !== 'void' && rs !== 'cancelled' && rs !== 'archived' && rs !== 'deleted'; }
    function hubVoidish(h) { var rs = h && h.record_status; return rs === 'void' || rs === 'cancelled' || rs === 'archived' || rs === 'deleted'; }

    var ar = {
      currentNative: 0,            // mirrors dashboard: live + approved, native amountDue (mixed currency, incl drafts)
      draftNative: 0,             // native AR sitting in Wave drafts
      voidishNative: 0,          // native AR in void/cancelled/archived (excluded by dashboard already)
      exDraftNative: 0,          // current minus drafts (native)
      exDraftVoidNative: 0,      // current minus drafts minus voidish (native)
      normalizedUsd: 0,          // clean set, converted to USD
      unconvertibleNative: 0,    // clean-set AR with no FX rate available
      byCurrencyNative: {},      // currency -> native AR (clean set)
      unconvertibleByCur: {}
    };
    var custAgg = {}; // custId -> { name, currentNative, currencyFixUsd, exDraftNative, finalUsd }
    function bumpCust(id, name, field, val) {
      if (!custAgg[id]) { custAgg[id] = { name: name || '(unknown)', currentNative: 0, currencyFixUsd: 0, exDraftNative: 0, finalUsd: 0 }; }
      custAgg[id][field] += val;
    }

    waveList.forEach(function (n) {
      var h = hubByWave[n.id];
      // mirror dashboard scope: Hub has it, live, approved
      if (!h || !hubLive(h) || h.approval_status !== 'approved') {
        // still capture voidish native for documentation
        if (h && hubVoidish(h)) { ar.voidishNative += r2(num(n.amountDue)); }
        return;
      }
      var cur = curOf(n);
      var dueNative = r2(num(n.amountDue));
      if (dueNative <= 0.005) { return; }
      var usd = convert(dueNative, cur, n.invoiceDate);
      var draft = isDraftWave(n.status);
      var cid = (n.customer && n.customer.id) || ('x_' + (h.id || ''));
      var cname = (n.customer && n.customer.name) || '(unknown)';

      ar.currentNative += dueNative;
      bumpCust(cid, cname, 'currentNative', dueNative);
      bumpCust(cid, cname, 'currencyFixUsd', usd != null ? usd : 0);

      if (draft) { ar.draftNative += dueNative; }
      else {
        ar.exDraftNative += dueNative;
        bumpCust(cid, cname, 'exDraftNative', dueNative);
        ar.byCurrencyNative[cur] = r2((ar.byCurrencyNative[cur] || 0) + dueNative);
        if (usd != null) { ar.normalizedUsd += usd; bumpCust(cid, cname, 'finalUsd', usd); }
        else { ar.unconvertibleNative += dueNative; ar.unconvertibleByCur[cur] = r2((ar.unconvertibleByCur[cur] || 0) + dueNative); }
      }
    });
    ar.exDraftVoidNative = ar.exDraftNative; // voidish already excluded from currentNative scope
    ar.currentNative = r2(ar.currentNative); ar.draftNative = r2(ar.draftNative); ar.voidishNative = r2(ar.voidishNative);
    ar.exDraftNative = r2(ar.exDraftNative); ar.exDraftVoidNative = r2(ar.exDraftVoidNative);
    ar.normalizedUsd = r2(ar.normalizedUsd); ar.unconvertibleNative = r2(ar.unconvertibleNative);

    var topCustomers = Object.keys(custAgg).map(function (id) {
      var c = custAgg[id];
      return { name: c.name, currentNative: r2(c.currentNative), afterCurrencyFix: r2(c.currencyFixUsd), afterDraftExclusion: r2(c.exDraftNative), finalCorrect: r2(c.finalUsd) };
    }).sort(function (a, b) { return b.currentNative - a.currentNative; }).slice(0, 20);

    var report = {
      ok: true,
      waveCount: waveList.length,
      hubCount: hub.length,
      hubWithWaveId: Object.keys(hubByWave).length,
      hubNoWaveId: hubNoWave,
      matched: matched,
      mismatched: mismatched,
      missingInHub: missingInHub,
      missingInWave: missingInWave,
      waveTotalSum: r2(waveTotalSum),
      wavePaidSum: r2(wavePaidSum),
      waveAR: r2(waveAR),
      waveAR_nonDraft: r2(waveAR_nonDraft),
      hubAR: r2(hubAR),
      arDifference: r2(hubAR - waveAR),
      arDifference_vsNonDraft: r2(hubAR - waveAR_nonDraft),
      statusWave: statusWave,
      byYear: byYear,
      topMismatches: mism.slice(0, 80),
      arAudit: ar,
      topCustomers: topCustomers,
      allRows: rows
    };
    return Response.json(report);
  } catch (e) {
    return Response.json({ ok: false, error: 'Reconcile failed: ' + (e && e.message ? e.message : String(e)) });
  }
}
