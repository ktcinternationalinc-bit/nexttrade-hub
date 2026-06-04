// ============================================================
// NEXPAC report parser + aggregator (v55.83-I, Max Jun 4 2026)
//
// Pure, dependency-free functions. The UI extracts text items from the
// uploaded PDF with pdf.js and passes them here; keeping the parsing logic
// separate means it can be unit-tested against real reports in Node.
//
// IMPORTANT: This import is for EXPECTED shipment tracking only. It produces
// numbers to compare against actual receiving later. It NEVER touches inventory.
//
// Tare rules (confirmed by Max Jun 4 2026):
//   Roll Tare Weight   = Total Rolls × 2.2 lbs   (per-roll factor 2.2)
//   Pallet Tare Weight = Line Items × 55 lbs     (per aggregated line)
//   Total Tare Weight  = Roll Tare + Pallet Tare
//   Final Net Weight   = Gross Weight − Total Tare Weight
//
// Aggregation key: Product Type + NexTrade (NT) Grade + Color.
// ============================================================

var ROLL_TARE_FACTOR = 2.2;     // lbs per roll
var PALLET_TARE_PER_LINE = 55;  // lbs per aggregated line
var LBS_PER_KG = 2.20462;       // pounds in one kilogram (Max Jun 4 2026)

// Map a NEXPAC NexTrade grade to KTC's own grade tier (Max Jun 4 2026):
//   "Grade A" (Thirds / Seconds / etc.) → Stock
//   "Premium"                            → Standard Premium
//   "SUEDE" (SUEDE back)                 → Fortis
//   "Obsolete"                           → Luxurious
// Returns { grade, mapped }. Unmapped grades keep their original text and are
// flagged (mapped=false) so they can be reviewed rather than silently bucketed.
export function ktcGradeFor(ntGrade) {
  var g = String(ntGrade == null ? '' : ntGrade).toLowerCase();
  if (/premium/.test(g)) return { grade: 'Standard Premium', mapped: true };
  if (/suede/.test(g)) return { grade: 'Fortis', mapped: true };
  if (/obsolete/.test(g)) return { grade: 'Luxurious', mapped: true };
  if (/grade\s*a/.test(g) || /thirds/.test(g) || /seconds/.test(g)) return { grade: 'Stock', mapped: true };
  return { grade: clean(ntGrade) || 'Stock', mapped: false };
}

// Column x-position ranges for the Order History table (from the NEXPAC
// template). Each text item is bucketed into a column by its left x.
var COLS = {
  num:      [0, 95],
  skew:     [95, 250],
  cgt:      [250, 335],
  ntGrade:  [335, 470],
  prodType: [470, 560],
  color:    [560, 628],
  rolls:    [628, 672],
  weight:   [672, 732],
  yards:    [732, 100000],
};

function colFor(x) {
  var keys = Object.keys(COLS);
  for (var i = 0; i < keys.length; i++) {
    var r = COLS[keys[i]];
    if (x >= r[0] && x < r[1]) return keys[i];
  }
  return 'yards';
}

function isInt(s) { return /^\d+$/.test(String(s).trim()); }
function isNum(s) { return /^\d+(\.\d+)?$/.test(String(s).trim()); }
function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

// Group raw text items {x,y,page,str} into visual rows (same page, similar y).
// Returns rows sorted top→bottom, each: { page, y, cells: { col: 'text' } , lineText }
function groupRows(items) {
  var its = (items || [])
    .map(function (it) { return { x: Math.round(it.x), y: Math.round(it.y), page: it.page || 1, str: clean(it.str) }; })
    .filter(function (it) { return it.str !== ''; });
  its.sort(function (a, b) {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) > 3) return b.y - a.y; // higher y = higher on page
    return a.x - b.x;
  });
  var rows = [];
  var cur = null;
  its.forEach(function (it) {
    if (!cur || cur.page !== it.page || Math.abs(cur.y - it.y) > 3) {
      cur = { page: it.page, y: it.y, items: [] };
      rows.push(cur);
    }
    cur.items.push(it);
  });
  return rows.map(function (r) {
    var cells = {};
    r.items.forEach(function (it) {
      var c = colFor(it.x);
      cells[c] = cells[c] ? (cells[c] + ' ' + it.str) : it.str;
    });
    Object.keys(cells).forEach(function (k) { cells[k] = clean(cells[k]); });
    return { page: r.page, y: r.y, cells: cells, lineText: r.items.map(function (i) { return i.str; }).join(' ') };
  });
}

// Extract Order History data rows. Handles wrapped NT-grade continuation lines
// (e.g. "Premium" / "USA(Seconds)" split across two visual rows).
export function extractOrderRows(items) {
  var rows = groupRows(items);
  var out = [];
  var lastData = null;
  rows.forEach(function (r) {
    var c = r.cells;
    // Skip the column-header row (repeats on every page): "# Skew # CGT Grade
    // NT Grade Product Type Color Rolls Weight Yards". Detect by header labels.
    var looksHeader = (c.num === '#') || /Skew/i.test(c.skew || '') || /^NT Grade$/i.test(c.ntGrade || '')
      || /^Weight$/i.test(c.weight || '') || /^Rolls$/i.test(c.rolls || '') || /^Color$/i.test(c.color || '')
      || /^Yards$/i.test(c.yards || '') || /^Grade$/i.test(c.cgt || '');
    if (looksHeader) return;
    var hasNum = c.num && isInt(c.num);
    var hasRolls = c.rolls && isInt(c.rolls);
    var hasWeight = c.weight && isNum(c.weight);
    if (hasNum && hasRolls && hasWeight) {
      var row = {
        seq: parseInt(c.num, 10),
        skew: c.skew || '',
        cgtGrade: c.cgt || '',
        ntGrade: c.ntGrade || '',
        productType: c.prodType || '',
        color: c.color || '',
        rolls: parseInt(c.rolls, 10),
        weight: parseFloat(c.weight),
      };
      out.push(row);
      lastData = row;
    } else if (lastData && !hasNum && !hasRolls && !hasWeight && (c.ntGrade || c.prodType || c.color)) {
      // Wrapped continuation of the previous row: NT grade ("Premium" /
      // "USA(Seconds)"), color ("Dark" / "Grey"), or product type.
      if (c.ntGrade) lastData.ntGrade = clean(lastData.ntGrade + ' ' + c.ntGrade);
      if (c.color) lastData.color = clean(lastData.color + ' ' + c.color);
      if (c.prodType && !lastData.productType) lastData.productType = c.prodType;
    }
  });
  return out;
}

// Parse the shipment header fields from the same grouped rows (line text).
export function parseHeader(items) {
  var rows = groupRows(items);
  var lines = rows.filter(function (r) { return r.page === 1; }).map(function (r) { return r.lineText; });
  var billingIdx = lines.findIndex(function (l) { return /NEXPAC BILLING/i.test(l); });
  var headLines = billingIdx >= 0 ? lines.slice(0, billingIdx) : lines;
  var joined = headLines.join('\n');

  function m(re) { var x = joined.match(re); return x ? x[1] : ''; }
  var releaseNumber = m(/Release\s*#\s*:?\s*([\w.\-\/]+)/i);
  var containerNumber = m(/Container\s*:?\s*([\w.\-\/]+)/i);
  var sealNumber = m(/Seal\s*#\s*:?\s*([\w.\-\/]+)/i);

  // Total rolls — the standalone "Rolls <n>" line in the header (not "# of Rolls").
  var totalRolls = 0;
  headLines.forEach(function (l) {
    var mm = l.match(/^Rolls\s+(\d+)/);
    if (mm) totalRolls = parseInt(mm[1], 10);
  });

  function pair(re) { var x = joined.match(re); return x ? { lbs: parseFloat(x[1]), kgs: parseFloat(x[2]) } : { lbs: 0, kgs: 0 }; }
  var scaleGross = pair(/Scale Tickets Gross\s+([\d.]+)\s+([\d.]+)/i);
  var netBillable = pair(/Net Billable Weight\s+([\d.]+)\s+([\d.]+)/i);

  return {
    releaseNumber: releaseNumber,
    containerNumber: containerNumber,
    sealNumber: sealNumber,
    totalRolls: totalRolls,
    scaleGrossLbs: scaleGross.lbs,
    scaleGrossKgs: scaleGross.kgs,
    netBillableLbs: netBillable.lbs,
    netBillableKgs: netBillable.kgs,
  };
}

// Aggregate order rows by Product Type + NT Grade + Color, applying tare rules.
export function aggregate(orderRows, opts) {
  opts = opts || {};
  var rollFactor = opts.rollTareFactor != null ? opts.rollTareFactor : ROLL_TARE_FACTOR;
  var palletPerLine = opts.palletTarePerLine != null ? opts.palletTarePerLine : PALLET_TARE_PER_LINE;

  var groups = {};
  (orderRows || []).forEach(function (r) {
    var pt = clean(r.productType) || 'Leather';
    var srcGrade = clean(r.ntGrade);
    var mapping = ktcGradeFor(srcGrade);
    var ktcGrade = mapping.grade;
    var color = clean(r.color);
    var key = pt + '||' + ktcGrade + '||' + color;
    if (!groups[key]) groups[key] = { productType: pt, ktcGrade: ktcGrade, gradeMapped: mapping.mapped, color: color, ntGradeSet: {}, totalRolls: 0, grossWeight: 0, lineItems: 0 };
    if (srcGrade) groups[key].ntGradeSet[srcGrade] = true;
    groups[key].totalRolls += Number(r.rolls) || 0;
    groups[key].grossWeight += Number(r.weight) || 0;
    groups[key].lineItems += 1;
  });

  var lines = Object.keys(groups).map(function (k) {
    var g = groups[k];
    g.ntGrade = Object.keys(g.ntGradeSet).join(', ');   // source NexTrade grade(s)
    delete g.ntGradeSet;
    var rollTare = g.totalRolls * rollFactor;
    var palletTare = g.lineItems * palletPerLine;
    var totalTare = rollTare + palletTare;
    g.rollTareWeight = rollTare;
    g.palletTareWeight = palletTare;
    g.totalTareWeight = totalTare;
    g.finalNetWeight = g.grossWeight - totalTare;            // lbs
    g.grossWeightKg = g.grossWeight / LBS_PER_KG;            // kg
    g.finalNetWeightKg = g.finalNetWeight / LBS_PER_KG;     // kg (Final Net ÷ 2.20462)
    return g;
  });
  lines.sort(function (a, b) { return b.grossWeight - a.grossWeight; });

  var totals = lines.reduce(function (t, g) {
    t.totalRolls += g.totalRolls; t.grossWeight += g.grossWeight; t.lineItems += g.lineItems;
    t.rollTareWeight += g.rollTareWeight; t.palletTareWeight += g.palletTareWeight;
    t.totalTareWeight += g.totalTareWeight; t.finalNetWeight += g.finalNetWeight;
    t.grossWeightKg += g.grossWeightKg; t.finalNetWeightKg += g.finalNetWeightKg;
    return t;
  }, { totalRolls: 0, grossWeight: 0, lineItems: 0, rollTareWeight: 0, palletTareWeight: 0, totalTareWeight: 0, finalNetWeight: 0, grossWeightKg: 0, finalNetWeightKg: 0 });

  return { lines: lines, totals: totals };
}

// One-shot: items → { header, orderRows, lines, totals, warnings }.
export function parseNexpac(items, opts) {
  var header = parseHeader(items);
  var orderRows = extractOrderRows(items);
  var agg = aggregate(orderRows, opts);
  var warnings = [];
  if (orderRows.length === 0) warnings.push('No order-history rows found — is this a NEXPAC report PDF?');
  if (header.totalRolls && agg.totals.totalRolls !== header.totalRolls) {
    warnings.push('Roll count mismatch: header says ' + header.totalRolls + ' but order rows sum to ' + agg.totals.totalRolls + '.');
  }
  var unmapped = agg.lines.filter(function (g) { return g.gradeMapped === false; });
  if (unmapped.length) {
    warnings.push('These grades did not match a known KTC tier (Stock / Standard Premium / Fortis / Luxurious) and were left as-is — review: ' + unmapped.map(function (g) { return g.ntGrade || g.ktcGrade; }).join('; ') + '.');
  }
  return { header: header, orderRows: orderRows, lines: agg.lines, totals: agg.totals, warnings: warnings };
}

export var NEXPAC_DEFAULTS = { rollTareFactor: ROLL_TARE_FACTOR, palletTarePerLine: PALLET_TARE_PER_LINE };
