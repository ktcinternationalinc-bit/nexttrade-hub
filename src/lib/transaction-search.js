function normalize(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/\$/g, '').replace(/(\d),(?=\d)/g, '$1').replace(/\s+/g, ' ').trim();
}

export function transactionSearchText(t, labels) {
  var amount = Number(t.amount).toFixed(2);
  var parts = String(t.date || '').split('-');
  var dateUS = parts.length === 3 ? parts[1] + '/' + parts[2] + '/' + parts[0] + ' ' + Number(parts[1]) + '/' + Number(parts[2]) : '';
  return [t.who, t.who_full, t.date, dateUS, t.account, amount, (labels || {})[t.classification] || t.classification,
    t.direction === 'in' ? 'deposit money in' : 'payment money out', t.matched ? 'matched' : '',
    t.transfer ? 'transfer' : '', t.advance ? 'advance' : '', t.third_party ? 'rtm paid through ' + t.third_party : '',
    t.verified ? 'verified' : '', t.review_status].filter(function (x) { return x != null; }).join(' ');
}

export function matchesTransaction(t, query, wholeWords, labels) {
  var words = normalize(query).split(' ').filter(Boolean);
  var text = normalize(transactionSearchText(t, labels));
  return words.every(function (word) {
    if (!wholeWords) { return text.indexOf(word) >= 0; }
    var escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^\\p{L}\\p{N}_])' + escaped + '(?=$|[^\\p{L}\\p{N}_])', 'u').test(text);
  });
}

// Return text fragments, not HTML, so descriptions remain safe to render.
export function searchFragments(text, query, wholeWords) {
  var words = String(query || '').trim().split(/\s+/).filter(Boolean).map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  if (!words.length) { return [{ text: String(text || ''), match: false }]; }
  var re = new RegExp(wholeWords ? '(^|[^\\p{L}\\p{N}_])(' + words.join('|') + ')(?=$|[^\\p{L}\\p{N}_])' : '(' + words.join('|') + ')', 'giu');
  var result = []; var last = 0; var hit; var value = String(text || '');
  while ((hit = re.exec(value))) {
    var start = hit.index + (wholeWords ? hit[1].length : 0);
    var found = wholeWords ? hit[2] : hit[1];
    if (start > last) { result.push({ text: value.slice(last, start), match: false }); }
    result.push({ text: found, match: true }); last = start + found.length;
  }
  if (last < value.length) { result.push({ text: value.slice(last), match: false }); }
  return result;
}
