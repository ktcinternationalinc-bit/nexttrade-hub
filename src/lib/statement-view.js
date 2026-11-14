// v55.83-SM — Statement view (print + Excel) for Open Accounts.
//
// Max, Nov 14 2026:
//   "Should we add 2 columns to have the running EGP and usd balance after each transaction"
//   "if EGP only then Show only EGP transactions and balances. Same for usd"
//   "Color coded so the invoice is green and the billed is red"
//   "Mirrored colors for customer copy. But everything else you recommended"
//
// One pure model (buildStatement) feeds both the printed page (statementHtml) and the
// Excel sheet (statementSheet), so the two can never disagree. The numbers are the same
// in the internal and the customer copy — only wording and colours change.
// Currencies are never added together.

import { T as t18n } from './open-account-i18n.js';

var EPS = 0.005;
var GREEN = '#15803d';
var RED = '#b91c1c';
var GREY = '#475569';

export function stSigned(e) {
  if (!e) return 0;
  var cr = Number(e.credit_amount || 0);
  var dr = Number(e.debit_amount || 0);
  switch (e.transaction_type) {
    case 'payment_sent':      return +dr;
    case 'sales_invoice':     return +cr;
    case 'payment_received':  return -cr;
    case 'vendor_bill':       return -dr;
    case 'credit_adjustment': return dr - cr;
    case 'offset':            return 0;
    default:                  return cr - dr;
  }
}

export function stMoney(n) {
  var v = Math.abs(Number(n) || 0);
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function curOf(e) { return e._currency || String(e.currency || 'USD').toUpperCase().trim(); }
function dayOf(s) {
  if (!s) return '';
  try { return new Date(s).toISOString().substring(0, 10); } catch (x) { return String(s).substring(0, 10); }
}
function daysBetween(a, b) {
  var da = Date.parse(a + 'T00:00:00Z'), db = Date.parse(b + 'T00:00:00Z');
  if (isNaN(da) || isNaN(db)) return null;
  return Math.max(0, Math.round((db - da) / 86400000));
}
function cleanNote(s) {
  return s ? String(s).replace(/Auto-synced from invoice[\s\S]*?Edit the invoice to change this entry\.?/gi, '').trim() : '';
}
function cleanDesc(s) {
  var raw = String(s || '');
  var m = raw.match(/^(.+?)\s*Auto-synced from invoice .+?\.\s*Edit the invoice to change this entry\.\s*$/i);
  return m ? m[1].trim() : raw;
}

// side: 'they' (the counterparty owes us) | 'we' (we owe them) | 'none'
// Internal copy: they = green, we = red. Customer copy is mirrored.
export function stColor(side, perspective) {
  if (side !== 'they' && side !== 'we') return GREY;
  var theyGreen = perspective !== 'customer';
  if (side === 'they') return theyGreen ? GREEN : RED;
  return theyGreen ? RED : GREEN;
}

function fifoApplications(rows) {
  var applied = {}, st = {};
  function s(c) { if (!st[c]) st[c] = { tp: 0, op: 0, inv: [], bill: [] }; return st[c]; }
  function eat(list, amt) {
    while (amt > 0.001 && list.length > 0) {
      var d = list[0], ap = Math.min(d.rem, amt);
      d.rem -= ap; applied[d.id] = (applied[d.id] || 0) + ap; amt -= ap;
      if (d.rem < 0.001) list.shift();
    }
    return amt;
  }
  rows.forEach(function (e) {
    var x = s(curOf(e)), t = e.transaction_type;
    var amt = Number(e.credit_amount || 0) || Number(e.debit_amount || 0);
    if (t === 'sales_invoice') {
      var f = Math.min(x.tp, amt); x.tp -= f; applied[e.id] = f;
      if (amt - f > 0.001) x.inv.push({ id: e.id, rem: amt - f });
    } else if (t === 'vendor_bill') {
      var g = Math.min(x.op, amt); x.op -= g; applied[e.id] = g;
      if (amt - g > 0.001) x.bill.push({ id: e.id, rem: amt - g });
    } else if (t === 'payment_received') {
      x.tp += eat(x.inv, amt);
    } else if (t === 'payment_sent') {
      x.op += eat(x.bill, amt);
    }
  });
  return applied;
}

// opts: perspective 'internal'|'customer', bilingual, layout 'combined'|'per_currency',
//       currency 'ALL'|<code>, applications {entryId: paid}, today 'YYYY-MM-DD', generatedAt
export function buildStatement(account, entity, entries, opts) {
  opts = opts || {};
  var perspective = opts.perspective === 'customer' ? 'customer' : 'internal';
  var bilingual = opts.bilingual === true;
  var all = (entries || []).filter(Boolean);
  var today = opts.today || new Date().toISOString().substring(0, 10);

  var refById = {}, typeById = {};
  all.forEach(function (e) { if (e.id) { refById[e.id] = e.reference_number; typeById[e.id] = e.transaction_type; } });
  var links = {};
  all.forEach(function (o) {
    if (o.transaction_type !== 'offset') return;
    var invId = o.offset_invoice_id, billId = o.offset_bill_id;
    if (typeById[invId] !== 'sales_invoice' || typeById[billId] !== 'vendor_bill') return;
    if (!(Number(o.debit_amount || 0) > 0)) return;
    var amt = Number(o.debit_amount);
    (links[invId] = links[invId] || []).push({ ref: refById[billId] || '', otherType: 'vendor_bill', amount: amt });
    (links[billId] = links[billId] || []).push({ ref: refById[invId] || '', otherType: 'sales_invoice', amount: amt });
  });

  var rowsIn = all.filter(function (e) { return e.transaction_type !== 'offset'; }).map(function (e, i) { return { e: e, i: i }; });
  rowsIn.sort(function (a, b) {
    var d = dayOf(a.e.entry_date).localeCompare(dayOf(b.e.entry_date));
    if (d !== 0) return d;
    var c = String(a.e.created_at || '').localeCompare(String(b.e.created_at || ''));
    return c !== 0 ? c : a.i - b.i;
  });
  var sorted = rowsIn.map(function (x) { return x.e; });
  var applications = opts.applications || fifoApplications(sorted);

  var allCurrencies = [];
  sorted.forEach(function (e) { var c = curOf(e); if (allCurrencies.indexOf(c) < 0) allCurrencies.push(c); });
  allCurrencies.sort();
  var want = opts.currency && opts.currency !== 'ALL' ? String(opts.currency).toUpperCase() : null;
  var currencies = want ? allCurrencies.filter(function (c) { return c === want; }) : allCurrencies;
  if (want && currencies.length === 0) currencies = [want];
  var layout = (opts.layout === 'combined' && currencies.length > 1) ? 'combined' : 'per_currency';

  function L(key) { return t18n(key, 'en', perspective); }
  function LA(key) { return t18n(key, 'ar', perspective); }
  function balanceOf(v) {
    var side = v > EPS ? 'they' : v < -EPS ? 'we' : 'none';
    var key = side === 'they' ? 'st_bal_they' : side === 'we' ? 'st_bal_we' : 'st_settled';
    return { value: v, amount: stMoney(v), side: side, words: L(key), wordsAr: LA(key), color: stColor(side, perspective) };
  }

  var running = {}, by = {};
  currencies.forEach(function (c) {
    running[c] = 0;
    by[c] = { invoiced: 0, received: 0, billed: 0, sent: 0, adjust: 0, count: 0 };
  });
  var rows = [], stillOpen = [];
  sorted.forEach(function (e) {
    var cur = curOf(e);
    if (currencies.indexOf(cur) < 0) return;
    var t = e.transaction_type;
    var cr = Number(e.credit_amount || 0), dr = Number(e.debit_amount || 0);
    running[cur] += stSigned(e);
    var b = by[cur]; b.count++;
    var typeKey = 'st_' + t;
    if (['sales_invoice', 'vendor_bill', 'payment_received', 'payment_sent', 'credit_adjustment'].indexOf(t) < 0) typeKey = 'st_other';
    var they = null, we = null, tone = 'none';
    if (t === 'sales_invoice')         { b.invoiced += cr; tone = 'they'; they = { amount: cr, minus: false, side: 'they' }; }
    else if (t === 'vendor_bill')      { b.billed += dr;   tone = 'we';   we = { amount: dr, minus: false, side: 'we' }; }
    else if (t === 'payment_received') { b.received += cr; they = { amount: cr, minus: true, side: 'none', note: L('st_less_they'), noteAr: LA('st_less_they') }; }
    else if (t === 'payment_sent')     { b.sent += dr;     we = { amount: dr, minus: true, side: 'none', note: L('st_less_we'), noteAr: LA('st_less_we') }; }
    else if (t === 'credit_adjustment') {
      b.adjust += dr - cr;
      if (cr > EPS) they = { amount: cr, minus: true, side: 'none', note: L('st_less_they'), noteAr: LA('st_less_they') };
      if (dr > EPS) we = { amount: dr, minus: true, side: 'none', note: L('st_less_we'), noteAr: LA('st_less_we') };
    } else {
      b.adjust += cr - dr;
      if (cr > EPS) they = { amount: cr, minus: false, side: 'none' };
      if (dr > EPS) we = { amount: dr, minus: false, side: 'none' };
    }
    var open = null, link = null;
    if (t === 'sales_invoice' || t === 'vendor_bill') {
      var face = cr || dr;
      var rem = Math.max(0, face - (applications[e.id] || 0));
      open = rem > EPS ? { state: 'open', amount: rem } : { state: 'paid', amount: 0 };
      var ls = (links[e.id] || []).slice().sort(function (x, y) { return y.amount - x.amount; });
      if (ls.length > 0) {
        var ok = rem > EPS ? 'st_offset_part' : 'st_offset_vs';
        var other = 'st_' + ls[0].otherType;
        link = {
          text: L(ok) + ' ' + L(other).toLowerCase() + ' ' + (ls[0].ref || '') + (ls.length > 1 ? ' + ' + (ls.length - 1) + ' more' : ''),
          textAr: LA(ok) + ' ' + LA(other) + ' ' + (ls[0].ref || ''),
        };
      }
      if (rem > EPS) {
        var d0 = dayOf(e.entry_date);
        stillOpen.push({ currency: cur, label: L(typeKey), labelAr: LA(typeKey), ref: e.reference_number || '', date: d0,
          days: daysBetween(d0, today), amount: rem, side: tone, color: stColor(tone, perspective) });
      }
    }
    var balances = {};
    currencies.forEach(function (c) { var x = balanceOf(running[c]); x.active = (c === cur); balances[c] = x; });
    rows.push({
      id: e.id, date: dayOf(e.entry_date), type: t, typeLabel: L(typeKey), typeLabelAr: LA(typeKey),
      tone: tone, color: stColor(tone, perspective),
      description: cleanDesc(e.description), note: perspective === 'customer' ? '' : cleanNote(e.notes),
      reference: e.reference_number || '', currency: cur, they: they, we: we, open: open, link: link, balances: balances,
    });
  });

  var summary = {};
  currencies.forEach(function (c) {
    var b = by[c];
    var closing = b.invoiced - b.received - b.billed + b.sent + b.adjust;
    summary[c] = {
      invoiced: b.invoiced, received: b.received, billed: b.billed, sent: b.sent, adjust: b.adjust, count: b.count,
      closing: balanceOf(closing),
      lines: [
        { key: 'st_invoiced', label: L('st_invoiced'), labelAr: LA('st_invoiced'), value: b.invoiced },
        { key: 'st_received', label: L('st_received'), labelAr: LA('st_received'), value: -b.received },
        { key: 'st_billed', label: L('st_billed'), labelAr: LA('st_billed'), value: -b.billed },
        { key: 'st_sent', label: L('st_sent'), labelAr: LA('st_sent'), value: b.sent },
        { key: 'st_adjust', label: L('st_adjust'), labelAr: LA('st_adjust'), value: b.adjust },
      ].filter(function (l) { return Math.abs(l.value) > EPS; }),
    };
    // Show the build-up from the side of the closing balance, so the lines add up to the
    // big number as printed (a "we owe them" box reads: billed 18,500 − paid 7,538.97).
    if (summary[c].closing.side === 'we') summary[c].lines.forEach(function (l) { l.value = -l.value; });
  });

  var ent = entity || null;
  return {
    perspective: perspective, bilingual: bilingual, layout: layout,
    currencies: currencies, allCurrencies: allCurrencies, filtered: !!want,
    title: t18n(perspective === 'customer' ? 'customer_statement' : 'internal_statement', 'en'),
    titleAr: t18n(perspective === 'customer' ? 'customer_statement' : 'internal_statement', 'ar'),
    banner: L('st_banner'), bannerAr: LA('st_banner'),
    accountName: (account && account.account_name) || '', accountNameAr: (account && account.account_name_ar) || '',
    accountNotes: perspective === 'customer' ? '' : ((account && account.notes) || ''),
    entity: ent, today: today, generatedAt: opts.generatedAt || new Date().toISOString().substring(0, 16).replace('T', ' '),
    period: rows.length ? { from: rows[0].date, to: rows[rows.length - 1].date } : null,
    rows: rows, summary: summary, stillOpen: stillOpen,
    labels: {
      they: L('st_col_they'), theyAr: LA('st_col_they'), we: L('st_col_we'), weAr: LA('st_col_we'),
      balance: L('st_balance'), balanceAr: LA('st_balance'), open: L('st_open'), openAr: LA('st_open'),
      paid: L('st_paid'), paidAr: LA('st_paid'), stillOpen: L('st_still_open'), stillOpenAr: LA('st_still_open'),
      days: L('st_days'), daysAr: LA('st_days'), totals: L('st_totals'), totalsAr: LA('st_totals'),
      closing: L('st_closing'), closingAr: LA('st_closing'),
      date: t18n('date', 'en'), dateAr: t18n('date', 'ar'), type: t18n('type', 'en'), typeAr: t18n('type', 'ar'),
      description: t18n('description', 'en'), descriptionAr: t18n('description', 'ar'),
    },
    colors: { they: stColor('they', perspective), we: stColor('we', perspective), neutral: GREY },
  };
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function statementHtml(m) {
  var bi = m.bilingual, Lb = m.labels;
  function two(en, ar) { return esc(en) + (bi && ar ? '<span class="ar" dir="rtl">' + esc(ar) + '</span>' : ''); }
  function balCell(x, cur, showCur) {
    if (!x.active) return '<td class="num dim">' + (x.side === 'none' ? '0.00' : esc(x.amount)) + (showCur ? ' <span class="cc">' + esc(cur) + '</span>' : '') + '</td>';
    return '<td class="num" style="color:' + x.color + '"><span class="bw">' + two(x.words, x.wordsAr) + '</span><strong>' + (x.side === 'none' ? '0.00' : esc(x.amount)) + '</strong></td>';
  }
  function moneyCell(c) {
    if (!c || !(c.amount > EPS)) return '<td class="num"></td>';
    var col = c.side === 'none' ? m.colors.neutral : (c.side === 'they' ? m.colors.they : m.colors.we);
    return '<td class="num" style="color:' + col + '"><strong>' + (c.minus ? '&minus; ' : '') + esc(stMoney(c.amount)) + '</strong>'
      + (c.note ? '<span class="sub">' + two(c.note, c.noteAr) + '</span>' : '') + '</td>';
  }
  function table(curs, rows, showCurCol) {
    var nBal = curs.length;
    var wBal = nBal > 2 ? 9 : 11;
    var fixed = 9 + 12 + (showCurCol ? 5 : 0) + 12 + 12 + 11 + wBal * nBal;
    var wDesc = Math.max(14, 100 - fixed);
    var head = '<colgroup><col style="width:9%"><col style="width:12%"><col style="width:' + wDesc + '%">'
      + (showCurCol ? '<col style="width:5%">' : '') + '<col style="width:12%"><col style="width:12%"><col style="width:11%">'
      + curs.map(function () { return '<col style="width:' + wBal + '%">'; }).join('') + '</colgroup>'
      + '<thead><tr><th>' + two(Lb.date, Lb.dateAr) + '</th><th>' + two(Lb.type, Lb.typeAr) + '</th><th>' + two(Lb.description, Lb.descriptionAr) + '</th>'
      + (showCurCol ? '<th class="ctr">Cur.</th>' : '')
      + '<th class="num" style="border-bottom:3px solid ' + m.colors.they + '">' + two(Lb.they, Lb.theyAr) + '</th>'
      + '<th class="num" style="border-bottom:3px solid ' + m.colors.we + '">' + two(Lb.we, Lb.weAr) + '</th>'
      + '<th class="num">' + two(Lb.open, Lb.openAr) + '</th>'
      + curs.map(function (c) { return '<th class="num">' + esc(c) + ' ' + two(Lb.balance, Lb.balanceAr) + '</th>'; }).join('')
      + '</tr></thead>';
    var body = rows.map(function (r) {
      var openHtml = '';
      if (r.open) {
        openHtml = r.open.state === 'open'
          ? '<span style="color:' + r.color + '"><span class="bw">' + two(Lb.open, Lb.openAr) + '</span><strong>' + esc(stMoney(r.open.amount)) + '</strong></span>'
          : '<span class="paid">&#10003; ' + two(Lb.paid, Lb.paidAr) + '</span>';
      }
      return '<tr>'
        + '<td>' + esc(r.date) + '</td>'
        + '<td><span class="tag" style="color:' + r.color + ';border-color:' + r.color + '">' + two(r.typeLabel, r.typeLabelAr) + '</span></td>'
        + '<td class="desc"><div class="dm">' + esc(r.description) + '</div>'
        + (r.reference ? '<div class="ref">' + esc(r.reference) + '</div>' : '')
        + (r.note ? '<div class="nt">' + esc(r.note) + '</div>' : '')
        + (r.link ? '<div class="lk">' + two(r.link.text, r.link.textAr) + '</div>' : '')
        + '</td>'
        + (showCurCol ? '<td class="ctr"><strong>' + esc(r.currency) + '</strong></td>' : '')
        + moneyCell(r.they) + moneyCell(r.we)
        + '<td class="num">' + openHtml + '</td>'
        + curs.map(function (c) { return balCell(r.balances[c], c, false); }).join('')
        + '</tr>';
    }).join('');
    if (!body) body = '<tr><td colspan="' + (6 + (showCurCol ? 1 : 0) + nBal) + '" class="empty">No entries</td></tr>';
    var foot = curs.map(function (c) {
      var s = m.summary[c];
      function tl(en, ar, v, minus) { return v > EPS ? '<span class="tl">' + two(en, ar) + ' <strong>' + (minus ? '&minus; ' : '') + esc(stMoney(v)) + '</strong></span>' : ''; }
      return '<tr class="tot"><td colspan="' + (showCurCol ? 4 : 3) + '">' + esc(c) + ' ' + two(Lb.totals, Lb.totalsAr) + '</td>'
        + '<td class="num">' + tl('invoiced', '', s.invoiced, false) + tl('paid', '', s.received, true) + '</td>'
        + '<td class="num">' + tl('billed', '', s.billed, false) + tl('paid', '', s.sent, true) + '</td>'
        + '<td></td>'
        + curs.map(function (c2) {
            if (c2 !== c) return '<td></td>';
            return '<td class="num" style="color:' + s.closing.color + '"><span class="bw">' + two(s.closing.words, s.closing.wordsAr) + '</span><strong>' + esc(s.closing.side === 'none' ? '0.00' : s.closing.amount) + '</strong></td>';
          }).join('')
        + '</tr>';
    }).join('');
    return '<table>' + head + '<tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table>';
  }

  var boxes = m.currencies.map(function (c) {
    var s = m.summary[c], cl = s.closing;
    return '<div class="box" style="border-color:' + cl.color + '">'
      + '<div class="bx-l">' + esc(c) + ' &middot; ' + two(cl.words, cl.wordsAr) + '</div>'
      + '<div class="bx-v" style="color:' + cl.color + '">' + esc(cl.side === 'none' ? '0.00' : cl.amount) + ' <span class="cc">' + esc(c) + '</span></div>'
      + s.lines.map(function (l) {
          return '<div class="bx-r"><span>' + two(l.label, l.labelAr) + '</span><span>' + (l.value < 0 ? '&minus; ' : '') + esc(stMoney(l.value)) + '</span></div>';
        }).join('')
      + '</div>';
  }).join('');

  var openHtml = m.stillOpen.length === 0 ? '' :
    '<div class="open"><div class="open-h">' + two(Lb.stillOpen, Lb.stillOpenAr) + '</div>'
    + m.stillOpen.map(function (o) {
        return '<div class="open-r"><span>' + two(o.label, o.labelAr) + ' <span class="mono">' + esc(o.ref) + '</span> &middot; ' + esc(o.date)
          + (o.days != null ? ' &middot; ' + o.days + ' ' + two(Lb.days, Lb.daysAr) : '') + '</span>'
          + '<strong style="color:' + o.color + '">' + esc(stMoney(o.amount)) + ' ' + esc(o.currency) + '</strong></div>';
      }).join('')
    + '</div>';

  var sections;
  if (m.currencies.length === 0) sections = '<p class="empty">No ledger entries yet.</p>';
  else if (m.layout === 'combined') sections = table(m.currencies, m.rows, true);
  else sections = m.currencies.map(function (c) {
    var rs = m.rows.filter(function (r) { return r.currency === c; });
    return (m.currencies.length > 1 ? '<h2>' + esc(c) + '</h2>' : '') + table([c], rs, false);
  }).join('');

  var e = m.entity, entLines = [];
  if (e) {
    var addr = [e.address_line1, e.address_line2, [e.city, e.region, e.postal_code].filter(Boolean).join(', '), e.country].filter(Boolean).map(esc).join('<br>');
    if (addr) entLines.push(addr);
    var contact = [e.phone ? 'Tel: ' + esc(e.phone) : '', esc(e.email || '')].filter(Boolean).join(' &middot; ');
    if (contact) entLines.push(contact);
    if (e.tax_id) entLines.push('Tax ID: ' + esc(e.tax_id));
  }
  var customer = m.perspective === 'customer';
  var gName = customer ? '"KTC owes you"' : '"they owe us"';
  var rName = customer ? '"you owe KTC"' : '"we owe them"';
  var legend = 'How to read this: <strong style="color:' + GREEN + '">green</strong> means ' + gName
    + ', <strong style="color:' + RED + '">red</strong> means ' + rName
    + '. A payment is shown in grey with a minus sign because it lowers a balance. '
    + (m.allCurrencies.length > 1 ? 'Each currency has its own balance; currencies are never added together.' : '');
  var wide = m.layout === 'combined';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Statement — ' + esc(m.accountName) + '</title><style>'
    + 'body{font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;margin:0;background:#fff;color:#0f172a;font-size:12px;}'
    + '.page{max-width:' + (wide ? 1120 : 900) + 'px;margin:0 auto;padding:20px 24px;box-sizing:border-box;}'
    + '.bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;color:#334155;font-size:11px;}'
    + '.bar button{padding:6px 14px;background:#1e293b;color:#fff;border:0;border-radius:4px;font-weight:700;cursor:pointer;}'
    + '.banner{padding:6px 12px;border-radius:4px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:' + (customer ? '#1d4ed8' : '#0f172a') + ';margin-bottom:12px;}'
    + '.hd{display:flex;justify-content:space-between;gap:24px;margin-bottom:12px;}'
    + '.en{font-size:16px;font-weight:800;}.el{font-size:11px;line-height:1.5;color:#334155;}'
    + '.tt{font-size:20px;font-weight:800;text-align:right;}.mt{font-size:10px;color:#475569;text-align:right;margin-top:3px;}'
    + '.for{background:#f1f5f9;padding:10px 14px;border-radius:4px;margin-bottom:12px;}.for-l{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#475569;}.for-n{font-size:14px;font-weight:700;color:#0f172a;}'
    + '.boxes{display:flex;gap:12px;margin-bottom:12px;}.box{flex:1;border:2px solid;border-radius:6px;padding:10px 14px;background:#fff;}'
    + '.bx-l{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#334155;}.bx-v{font-size:24px;font-weight:900;line-height:1.2;margin:2px 0 6px;}'
    + '.bx-r{display:flex;justify-content:space-between;font-size:11px;color:#334155;padding:1px 0;}.bx-r>span:last-child{font-family:"SF Mono",Menlo,monospace;}'
    + '.open{border:1px solid #cbd5e1;border-radius:6px;padding:8px 14px;margin-bottom:14px;}.open-h{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#334155;margin-bottom:4px;}'
    + '.open-r{display:flex;justify-content:space-between;font-size:11px;color:#334155;padding:2px 0;}'
    + 'h2{font-size:15px;font-weight:900;margin:18px 0 4px;color:#0f172a;page-break-after:avoid;}'
    + 'table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6px;}thead{display:table-header-group;}tr{page-break-inside:avoid;break-inside:avoid;}'
    + 'th{background:#1e293b;color:#fff;padding:7px 6px;text-align:left;font-size:10px;font-weight:700;vertical-align:bottom;}'
    + 'td{padding:6px;border-bottom:1px solid #e2e8f0;vertical-align:top;color:#0f172a;word-break:break-word;overflow-wrap:anywhere;}'
    + '.num{text-align:right;font-family:"SF Mono",Menlo,monospace;}td.num strong{white-space:nowrap;}th.num{text-align:right;font-family:inherit;}.ctr{text-align:center;}'
    + '.dim,.dim .cc{color:#94a3b8;}.cc{font-size:10px;font-weight:700;color:#475569;}'
    + '.bw,.sub{display:block;font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;font-size:9px;font-weight:600;}.sub{color:#64748b;font-style:italic;}'
    + '.tag{display:inline-block;border:1px solid;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;background:#fff;}'
    + '.dm{font-weight:600;}.ref,.mono{font-family:"SF Mono",Menlo,monospace;font-size:10px;color:#475569;}.nt,.lk{font-size:10px;color:#64748b;}.lk{font-style:italic;}'
    + '.paid{display:inline-block;background:#e2e8f0;color:#334155;border-radius:4px;padding:2px 6px;font-size:9px;font-weight:700;font-family:-apple-system,system-ui,sans-serif;}'
    + 'tr.tot td{background:#f1f5f9;border-top:2px solid #0f172a;font-weight:800;}.tl{display:block;font-size:9px;font-weight:600;color:#334155;font-family:-apple-system,system-ui,sans-serif;}.tl strong{font-family:"SF Mono",Menlo,monospace;font-size:10px;}'
    + '.ar{display:inline;margin-left:8px;font-family:Tahoma,"Arial Unicode MS",sans-serif;font-weight:600;}th .ar,.tag .ar,.bw .ar,.sub .ar,.paid .ar{display:block;margin-left:0;}'
    + '.legend{margin-top:16px;padding:8px 12px;background:#f8fafc;border-left:3px solid #94a3b8;font-size:10px;color:#334155;}.empty{padding:20px;text-align:center;color:#475569;}'
    + '@page{size:A4 ' + (wide ? 'landscape' : 'portrait') + ';margin:10mm;}'
    + '@media print{.bar{display:none!important;}.page{max-width:100%;padding:0;}table{font-size:10px;}th,td{padding:4px 5px;}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}'
    + '</style></head><body><div class="page">'
    + '<div class="bar"><span><strong>Print this page</strong> to save it as a PDF or print it on paper.</span>'
    + '<button onclick="window.print()">Print now</button><button onclick="window.close()" style="background:#64748b">Close</button></div>'
    + '<div class="banner">' + two(m.banner, m.bannerAr) + '</div>'
    + '<div class="hd"><div><div class="en">' + esc((e && e.entity_name) || '') + '</div>'
    + (e && e.entity_name_ar ? '<div class="en" style="font-weight:600" dir="rtl">' + esc(e.entity_name_ar) + '</div>' : '')
    + '<div class="el">' + entLines.join('<br>') + '</div></div>'
    + '<div><div class="tt">' + esc(m.title) + (bi ? ' / <span dir="rtl">' + esc(m.titleAr) + '</span>' : '') + '</div>'
    + '<div class="mt">Generated: ' + esc(m.generatedAt) + '</div>'
    + (m.period ? '<div class="mt">Period: ' + esc(m.period.from) + ' to ' + esc(m.period.to) + '</div>' : '')
    + (m.filtered ? '<div class="mt"><strong>' + esc(m.currencies.join(', ')) + ' only</strong></div>'
        : (m.currencies.length > 1 ? '<div class="mt">Currencies: ' + m.currencies.map(esc).join(', ') + '</div>' : ''))
    + '</div></div>'
    + '<div class="for"><div class="for-l">Statement for / كشف حساب</div><div class="for-n">' + esc(m.accountName)
    + (m.accountNameAr ? ' &middot; <span dir="rtl">' + esc(m.accountNameAr) + '</span>' : '') + '</div>'
    + (m.accountNotes ? '<div style="font-size:11px;color:#475569;margin-top:4px">' + esc(m.accountNotes) + '</div>' : '') + '</div>'
    + '<div class="boxes">' + boxes + '</div>' + openHtml + sections
    + '<div class="legend">' + legend + '</div>'
    + '</div><script>setTimeout(function(){try{window.print();}catch(e){}},350);</script></body></html>';
}

// Excel rows (array of arrays). Money stays numeric so Excel can add it up. A payment is a
// negative number in its own column. Balance columns are signed and the header says what
// the sign means.
export function statementSheet(m) {
  var bi = m.bilingual, Lb = m.labels, rows = [], e = m.entity;
  function two(en, ar) { return bi && ar ? en + '\n' + ar : en; }
  rows.push([(e && e.entity_name) || 'KTC']);
  if (e && e.entity_name_ar) rows.push([e.entity_name_ar]);
  rows.push([m.title + ' — ' + m.banner]);
  rows.push(['Account:', m.accountName + (m.accountNameAr ? ' / ' + m.accountNameAr : '')]);
  rows.push(['Generated:', m.generatedAt]);
  if (m.period) rows.push(['Period:', m.period.from + ' to ' + m.period.to]);
  rows.push(['Currencies:', m.currencies.join(', ') + (m.filtered ? ' only' : '')]);
  rows.push([]);
  var plus = m.perspective === 'customer' ? 'you owe KTC' : 'they owe us';
  var minus = m.perspective === 'customer' ? 'KTC owes you' : 'we owe them';
  var head = [two(Lb.date, Lb.dateAr), two(Lb.type, Lb.typeAr), two(Lb.description, Lb.descriptionAr), 'Reference', 'Currency',
    two(Lb.they, Lb.theyAr), two(Lb.we, Lb.weAr), two(Lb.open, Lb.openAr)];
  m.currencies.forEach(function (c) { head.push(c + ' balance (+ ' + plus + ' / − ' + minus + ')'); });
  rows.push(head);
  var headerRow = rows.length - 1;
  m.rows.forEach(function (r) {
    var row = [r.date, two(r.typeLabel, r.typeLabelAr), r.description + (r.note ? ' — ' + r.note : '') + (r.link ? ' (' + r.link.text + ')' : ''),
      r.reference, r.currency,
      r.they ? (r.they.minus ? -r.they.amount : r.they.amount) : '',
      r.we ? (r.we.minus ? -r.we.amount : r.we.amount) : '',
      r.open ? (r.open.state === 'open' ? Math.round(r.open.amount * 100) / 100 : Lb.paid) : ''];
    m.currencies.forEach(function (c) { row.push(Math.round(r.balances[c].value * 100) / 100); });
    rows.push(row);
  });
  rows.push([]);
  m.currencies.forEach(function (c) {
    var s = m.summary[c];
    rows.push([c + ' ' + Lb.totals]);
    s.lines.forEach(function (l) { rows.push(['', '', l.label, '', c, Math.round(l.value * 100) / 100]); });
    rows.push(['', '', Lb.closing + ' — ' + s.closing.words, '', c, Math.round(Math.abs(s.closing.value) * 100) / 100]);
    rows.push([]);
  });
  if (m.stillOpen.length > 0) {
    rows.push([Lb.stillOpen]);
    m.stillOpen.forEach(function (o) {
      rows.push([o.date, o.label, (o.days != null ? o.days + ' ' + Lb.days : ''), o.ref, o.currency, Math.round(o.amount * 100) / 100]);
    });
  }
  return { rows: rows, headerRow: headerRow };
}
