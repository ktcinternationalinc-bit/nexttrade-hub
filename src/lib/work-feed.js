// v55.83-AAA — 📋 My work feed, build 1 (Max, 27 Nov: "feeds everyone gets depending on roles so they know items that need to be updated
// or corrected with a button that takes you to the exact place that needs to be reviewed and updated and then a back button to take you
// back to your feed" … "professional work feed - sharp and clear and user friendly with EXACT issues. How to resolve section and button
// that takes you there to resolve and then when resolved it goes to resolved grouping"). PURE: it only re-shapes what the Hub ALREADY
// decides needs fixing — the 🔔 Waiting for me sections (waitingFor in waiting-list.js, built from the Bills and Wires lists the server
// already filtered for this person) and the invoices awaiting bank confirmation (same filter + gate as the home screen's existing card).
// No new business rule, nothing written.

// The short line shown next to the Back button on the screen the button opens (the ZN "What to do here" line)
var TODO = {
  bill_flags: 'Look at the flagged price or amount on this bill and say what is right.',
  bill_validate: 'Finish this bill’s validation checks, then press “✓ Mark validated”.',
  bill_ready: 'This bill is validated and due soon — put it on a wire.',
  wire_fix: 'Fix what the wire check says, then press “🤖 Check again”.',
  wire_sign: 'Open each bill on this wire, check it, then sign.',
  wire_send: 'Send this wire at the bank, then press “📤 Mark as sent” with the confirmation.',
  wire_bank: 'Check the sent date, or pick the bank line for this wire by hand.',
  wire_proof: 'Attach the payer’s proof of payment and tick the bills it covers.',
  transfer_unused: 'Build a request from this money, or book the rest as their service fee.',
  invoice_bank: 'Match the bank payment on this invoice to the bank statement.'
};
export function todoFor(sectionKey) { return TODO[sectionKey] || 'Review this and correct what is wrong.'; }

// HOW TO RESOLVE — the steps, in order, as they are on the screen the button opens
var STEPS = {
  bill_flags: ['Press Go resolve — Bills opens on this bill with its checks open.', 'Compare the flagged price or amount with the vendor’s invoice.', 'Say what is right (accept the price, or correct the bill). The flag clears.'],
  bill_validate: ['Press Go resolve — Bills opens on this bill with its validation checks open.', 'Pick the bill type and inbound / outbound, and tick each of the 3 checks you actually did.', 'Press “✓ Mark validated”. The bill can now go on a wire.'],
  bill_ready: ['Press Go resolve — Bills opens on this bill.', 'Go to Wires and build a wire (or add it to an open one) that pays this bill.', 'Once it is on a wire it leaves this list.'],
  wire_fix: ['Press Go resolve — Wires opens on this wire.', 'Read what the check found and correct it (bills, amounts or payee).', 'Press “🤖 Check again”. When it passes it goes to signing.'],
  wire_sign: ['Press Go resolve — Wires opens on this wire.', 'Open each bill on it and check it against the paperwork.', 'Sign. A second, different person signs after you.'],
  wire_send: ['Press Go resolve — Wires opens on this wire.', 'Send the wire at the bank.', 'Press “📤 Mark as sent” and attach the bank confirmation.'],
  wire_bank: ['Press Go resolve — Wires opens on this wire.', 'Check that the sent date is right (correct it if not).', 'If the bank line is there under another date or text, pick it by hand.'],
  wire_proof: ['Press Go resolve — Wires opens on this wire.', 'Attach the payer’s proof that it paid the vendors.', 'Tick the bills that proof covers. When every bill has proof the wire is done.'],
  transfer_unused: ['Press Go resolve — Wires opens.', 'Build a request that uses this transfer’s money for validated bills,', 'or book the rest as the company’s service fee.'],
  invoice_bank: ['Press Go resolve — the invoice opens.', 'Find the payment in the bank statement.', 'Confirm the payment against that bank line. The invoice leaves this list.']
};
export function stepsFor(sectionKey) { return STEPS[sectionKey] || ['Press Go resolve and correct what is wrong.']; }

// THE ISSUE — one exact sentence naming the bill / wire / invoice and what is wrong with it
function issueFor(key, x) {
  var t = x.title || ''; var d = x.detail || '';
  if (key === 'bill_flags') { return t + ': the price check flagged a price or amount that does not match the rules.'; }
  if (key === 'bill_validate') { return t + ': not validated yet' + (/\bstarted\b/.test(d) ? ' (validation was started but not finished)' : '') + ' — it cannot be paid until it is.'; }
  if (key === 'bill_ready') { return t + ': validated but on no wire, and ' + (x.chip ? x.chip.replace(/^late · /, 'late by ') : 'due soon') + '.'; }
  if (key === 'wire_fix') { return t + ': ' + (/problem/.test(d) ? 'the wire check found a problem.' : 'not checked yet.'); }
  if (key === 'wire_sign') { return t + ': waiting for your signature' + (/one signature in/.test(d) ? ' (one signature is already in).' : '.'); }
  if (key === 'wire_send') { return t + ': both signatures are in, but it is not sent yet.'; }
  if (key === 'wire_bank') { return t + ': marked sent, but no bank line found after 7 days.'; }
  if (key === 'wire_proof') { return t + ': paid, but proof of payment to the vendors is missing (' + d.replace(/^.*?(\d+ bill\(s\) without proof).*$/, '$1') + ').'; }
  if (key === 'transfer_unused') { return t + ': ' + (x.amount || 'money') + ' of it is not used by any bill or fee yet.'; }
  return t + (d ? ': ' + d : '');
}

// Where the button goes. kind 'bill' = Accounting → Bills opened ON that bill; 'wire' = Accounting → Wires opened ON that wire;
// 'acct' = an Accounting screen; 'invoice' = Sales → that invoice.
function targetFor(section, item) {
  if (item.kind === 'bill') { return { kind: 'bill', id: item.id, bill_number: item.bill_number || '', title: item.title, section: section.key }; }
  if (section.key === 'transfer_unused') { return { kind: 'acct', sub: 'wires' }; }
  if (section.go === 'wires') { return { kind: 'wire', id: item.id }; }
  return { kind: 'acct', sub: section.go || 'waiting' };
}

// input: { waiting: waitingFor(...) result | null, invoices: [...] | null (only passed when the person may see them) }
// → { groups: [{ key, lane ('main' | 'pay'), area, title, hint, items: [{ key, title, issue, steps, detail, amount, chip, stuck, todo, target }] }], total, stuck }
export function buildFeed(input) {
  var i = input || {}; var groups = [];
  ((i.waiting && i.waiting.sections) || []).forEach(function (s) {
    var items = (s.items || []).map(function (x) {
      return { key: s.key + ':' + x.id, title: x.title, issue: issueFor(s.key, x), steps: stepsFor(s.key), detail: x.detail, amount: x.amount, age: x.age, chip: x.chip || null, stuck: !!x.stuck, todo: todoFor(s.key), target: targetFor(s, x) };
    });
    // Max 27 Nov: "the bills no paid should be in it's own group away for the main feed but can be selected" — validated bills waiting to be
    // put on a wire (paid) go to their own lane, 💸 Bills not paid, chosen with its own count; they are not in the main To do.
    if (items.length) { groups.push({ key: s.key, lane: s.key === 'bill_ready' ? 'pay' : 'main', area: 'USA Accounting', title: s.key === 'bill_ready' ? 'Bills not paid — validated, not on a wire yet' : s.title, hint: s.hint, items: items }); }
  });
  if (i.invoices) {
    var inv = (i.invoices || []).filter(function (v) { return v && v.id && Number(v.total_pending_bank || 0) > 0; })
      .sort(function (a, b) { return Number(b.total_pending_bank || 0) - Number(a.total_pending_bank || 0); });
    if (inv.length) {
      groups.push({ key: 'invoice_bank', lane: 'main', area: 'Egypt Finance', title: 'Invoices awaiting bank confirmation', hint: 'A payment was recorded as a bank payment but is not matched to the bank statement yet.',
        items: inv.map(function (v) {
          var t = 'Invoice ' + (v.order_number || '—') + ' · ' + (v.customer_name || v.customer_name_en || '—');
          return { key: 'invoice_bank:' + v.id, title: t, issue: t + ': ' + fmtNum(v.total_pending_bank) + ' EGP is recorded as a bank payment but not matched to the bank statement.', steps: stepsFor('invoice_bank'),
            detail: (v.invoice_date ? 'dated ' + String(v.invoice_date).substring(0, 10) : ''), amount: fmtNum(v.total_pending_bank) + ' EGP',
            age: null, chip: null, stuck: false, todo: todoFor('invoice_bank'), target: { kind: 'invoice', id: v.id } };
        }) });
    }
  }
  return tally(groups);
}
// counts per lane: total / stuck = the main feed only; payTotal / payStuck = 💸 Bills not paid
export function tally(groups) {
  var t = { groups: groups || [], total: 0, stuck: 0, payTotal: 0, payStuck: 0 };
  t.groups.forEach(function (g) { var pay = g.lane === 'pay'; g.items.forEach(function (x) { if (pay) { t.payTotal++; if (x.stuck) { t.payStuck++; } } else { t.total++; if (x.stuck) { t.stuck++; } } }); });
  return t;
}
function fmtNum(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// What changed between two loads of the feed. An item that is no longer in the fresh feed = resolved; the item the person opened
// and that is still there = Still open. before / after: buildFeed results. Returns { fixed: [{ group, groupTitle, area, item }], openedKey, openedStillOpen }
export function compareFeed(before, after, openedKey) {
  var now = {};
  ((after && after.groups) || []).forEach(function (g) { g.items.forEach(function (x) { now[x.key] = true; }); });
  var fixed = [];
  ((before && before.groups) || []).forEach(function (g) {
    g.items.forEach(function (x) { if (!now[x.key]) { fixed.push({ group: g.key, groupTitle: g.title, area: g.area || '', item: x }); } });
  });
  return { fixed: fixed, openedKey: openedKey || null, openedStillOpen: !!(openedKey && now[openedKey]) };
}

// The RESOLVED group: what left the feed while this page was open, newest first, each once. If an item comes BACK into the feed
// (someone reopened it), it leaves Resolved again. at = time label. Kept only in the open page — nothing is stored.
export function addResolved(resolved, fixed, after, at) {
  var now = {};
  ((after && after.groups) || []).forEach(function (g) { g.items.forEach(function (x) { now[x.key] = true; }); });
  var seen = {}; var out = [];
  (fixed || []).forEach(function (f) { if (f && f.item && !seen[f.item.key] && !now[f.item.key]) { seen[f.item.key] = 1; out.push({ key: f.item.key, title: f.item.title, issue: f.item.issue || '', groupTitle: f.groupTitle, area: f.area || '', at: at || '' }); } });
  (resolved || []).forEach(function (r) { if (r && !seen[r.key] && !now[r.key]) { seen[r.key] = 1; out.push(r); } });
  return out.slice(0, 50);
}
