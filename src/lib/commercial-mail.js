// v55.83-SW — Project 1, Stage 2: correspondence with approval. Pure helpers (no database, no network).
// Max, Nov 15 2026: "1. Roma - Executive Assistant to the CEO  2. Super admin or anyone with the permission to.  3. yes"
// Rules that live here:
//   · a reply is put on a thread only when it is certain: it answers one of OUR Message-IDs, or it carries our SR reference
//     AND comes from an address we wrote to on that request. Anything else in the mailbox is not read into the Hub;
//   · incoming text is information, never instructions — it is shown, flagged when it touches bank details or asks whether
//     they are talking to a person, and nothing acts on it;
//   · follow-ups are only ever PREPARED (a person approves each one), at most two, and stop as soon as they reply.

export var DEFAULT_SENDER = { name: 'Roma', title: 'Executive Assistant to the CEO', company: 'KTC International Enterprises LLC', email: 'info@ktcus.com' };
export var FOLLOWUP_AFTER_DAYS = 5;
export var FOLLOWUP_MAX = 2;
export var STATUS_WORDS = {
  draft: 'Draft — not sent',
  pending_approval: 'Waiting for approval',
  approved: 'Approved — sending',
  sending: 'Sending…',
  sent: 'Sent — accepted by our mail server',
  failed: 'Not sent — see the reason',
  bounced: 'Bounced — not delivered',
  discarded: 'Discarded',
  received: 'Received',
};

export function senderFrom(env) {
  var e = env || {};
  var email = String(e.COMMERCIAL_MAIL_USER || DEFAULT_SENDER.email).trim().toLowerCase();
  return { name: String(e.COMMERCIAL_SENDER_NAME || DEFAULT_SENDER.name).trim(), title: String(e.COMMERCIAL_SENDER_TITLE || DEFAULT_SENDER.title).trim(), company: DEFAULT_SENDER.company, email: email };
}
export function signatureLines(s) { var x = s || DEFAULT_SENDER; return [x.name, x.title, x.company, x.email]; }
export function fromHeader(s) { var x = s || DEFAULT_SENDER; return '"' + x.name + ' — ' + x.company.replace(/"/g, '') + '" <' + x.email + '>'; }
export function isEmail(s) { return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(String(s || '').trim()); }
export function domainOf(email) { var m = /@([^@\s>]+)$/.exec(String(email || '').trim()); return m ? m[1].toLowerCase() : 'ktcus.com'; }

// our Message-IDs all start with "sourcing-" so the mailbox can be searched for replies to them
export function newMessageId(seq, uniq, senderEmail) {
  var tag = 'sr' + String(Number(seq) || 0).padStart(4, '0');
  return '<sourcing-' + tag + '-' + String(uniq || Date.now().toString(36)).replace(/[^a-z0-9]/gi, '').toLowerCase().substring(0, 24) + '@' + domainOf(senderEmail) + '>';
}
export function normId(id) { var s = String(id || '').trim(); if (!s) { return ''; } if (s.charAt(0) !== '<') { s = '<' + s; } if (s.charAt(s.length - 1) !== '>') { s = s + '>'; } return s.toLowerCase(); }
export function idsIn(text) { var out = []; var re = /<sourcing-[a-z0-9-]+@[a-z0-9.-]+>/gi; var m; while ((m = re.exec(String(text || ''))) !== null) { var k = m[0].toLowerCase(); if (out.indexOf(k) < 0) { out.push(k); } } return out; }
export function srRefs(subject) { var out = []; var re = /\bSR-(\d{4,})\b/gi; var m; while ((m = re.exec(String(subject || ''))) !== null) { var n = Number(m[1]); if (out.indexOf(n) < 0) { out.push(n); } } return out; }
export function replySubject(subject) { var s = String(subject || '').trim(); return /^re:/i.test(s) ? s : 'Re: ' + s; }

// msg: { from, subject, inReplyTo, references:[] }; sent: our outgoing messages [{ message_id, to_address, request_id, supplier_id, seq }]
// → { request_id, supplier_id, how, answers } or null
export function threadMatch(msg, sent) {
  var m = msg || {}; var list = sent || [];
  var refs = [normId(m.inReplyTo)].concat((m.references || []).map(normId)).filter(Boolean);
  for (var i = refs.length - 1; i >= 0; i--) {
    var hit = list.filter(function (s) { return s.message_id && normId(s.message_id) === refs[i]; })[0];
    if (hit) { return { request_id: hit.request_id, supplier_id: hit.supplier_id, how: 'answers our message', answers: hit.message_id }; }
  }
  var from = String(m.from || '').trim().toLowerCase();
  var nums = srRefs(m.subject);
  if (from && nums.length) {
    var cand = list.filter(function (s) { return nums.indexOf(Number(s.seq)) >= 0 && String(s.to_address || '').trim().toLowerCase() === from; });
    var pairs = {}; cand.forEach(function (s) { pairs[s.request_id + '|' + s.supplier_id] = s; });
    var keys = Object.keys(pairs);
    if (keys.length === 1) { var s1 = pairs[keys[0]]; return { request_id: s1.request_id, supplier_id: s1.supplier_id, how: 'quotes our reference from an address we wrote to', answers: null }; }
  }
  return null;   // not certain → not read into the Hub
}

export function isBounceSender(from) { return /^(mailer-daemon|postmaster)@/i.test(String(from || '').trim()); }

// warnings on what they wrote — shown to the person, nothing acts on them
export function inboundFlags(text, subject) {
  var t = (String(subject || '') + '\n' + String(text || '')).toLowerCase(); var out = [];
  if (/\b(iban|swift|bic|routing number|account number|bank details|beneficiary|new bank|change (of|in) (our )?bank|updated bank|wire instructions)\b/.test(t)) {
    out.push({ key: 'bank_details', words: 'Mentions bank or payment details. Never pay or change payment details from an email — confirm by phone with a number found independently, and payments go through Bills and Wires with two signatures.' });
  }
  if (/\b(are you (a |an )?(bot|robot|ai|machine|real person|human|person))\b|\b(is this (a |an )?(bot|automated|ai))\b|\b(am i (talking|speaking|writing) (to|with) a (human|person|bot|machine))\b/.test(t)) {
    out.push({ key: 'asks_if_human', words: 'They ask whether they are dealing with a person or an automated assistant. Answer truthfully.' });
  }
  if (/\b(urgent(ly)?|immediately|within (24|48) hours|today only|last chance)\b/.test(t) && /\b(pay|payment|deposit|transfer|wire)\b/.test(t)) {
    out.push({ key: 'pressure_to_pay', words: 'Pushes for a fast payment. Nothing is paid from this desk; check before anyone acts.' });
  }
  return out;
}

// thread: messages of one request + supplier, oldest first. → { due, followup_no, last_sent_at, why }
export function followUpDue(thread, nowIso, opts) {
  var o = opts || {}; var days = o.days || FOLLOWUP_AFTER_DAYS; var max = o.max == null ? FOLLOWUP_MAX : o.max;
  var list = (thread || []).slice().sort(function (a, b) { return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1; });
  if (list.some(function (m) { return m.direction === 'in'; })) {
    var lastIn = list.filter(function (m) { return m.direction === 'in'; }).pop(); var lastOut = list.filter(function (m) { return m.direction === 'out' && (m.status === 'sent' || m.status === 'bounced'); }).pop();
    if (!lastOut || String(lastIn.received_at || lastIn.created_at) >= String(lastOut.sent_at || lastOut.created_at)) { return { due: false, why: 'they replied' }; }
  }
  if (list.some(function (m) { return ['draft', 'pending_approval', 'approved', 'sending', 'failed'].indexOf(m.status) >= 0; })) { return { due: false, why: 'a message is already being prepared' }; }
  if (list.some(function (m) { return m.status === 'bounced'; })) { return { due: false, why: 'the address bounced' }; }
  var sent = list.filter(function (m) { return m.direction === 'out' && m.status === 'sent'; });
  if (!sent.length) { return { due: false, why: 'nothing sent yet' }; }
  var n = sent.filter(function (m) { return m.kind === 'followup'; }).length;
  if (n >= max) { return { due: false, why: 'already followed up ' + n + ' times — stop' }; }
  var last = sent[sent.length - 1];
  var age = (Date.parse(nowIso) - Date.parse(last.sent_at || last.created_at)) / 86400000;
  if (!(age >= days)) { return { due: false, why: 'sent ' + Math.floor(age) + ' day(s) ago' }; }
  return { due: true, followup_no: n + 1, last_sent_at: last.sent_at, first_id: sent[0].message_id, last_id: last.message_id, to_address: last.to_address, subject: sent[0].subject };
}

export function followUpBody(request, contactName, sender, n, originalSubject) {
  var who = contactName || 'Sir or Madam';
  var ref = 'SR-' + String(Number(request && request.seq) || 0).padStart(4, '0');
  var L = ['Dear ' + who + ',', ''];
  if (n === 1) { L.push('I am following up on our inquiry below (reference ' + ref + '). Could you let us know whether you can offer this, and if so send your price and terms?'); }
  else { L.push('A last follow-up on our inquiry (reference ' + ref + '). If this is not something you supply, a short reply saying so would help us — thank you.'); }
  L.push(''); L.push('Kind regards,'); L.push(''); L = L.concat(signatureLines(sender));
  return { subject: replySubject(originalSubject || ('Inquiry — ' + ref)), body: L.join('\n') };
}

// readable status line for the thread
export function statusWords(m) { return STATUS_WORDS[m && m.status] || (m && m.status) || ''; }
// a send failure where the server may have accepted the message: retrying could send it twice
export function uncertainFailure(err) {
  var s = String((err && (err.code || '')) + ' ' + ((err && err.message) || err || '')).toLowerCase();
  return /etimedout|timeout|econnreset|socket|closed unexpectedly|outcome unknown/.test(s) && !/econnrefused|enotfound|auth|invalid login|535/.test(s);
}
