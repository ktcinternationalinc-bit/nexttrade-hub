// v55.83-XG — ARRIVAL + FINAL-PAYMENT REMINDERS (Max, 22 Nov 2026). Pure helpers: no database, no network.
// "for each order, message the customer the expected arrival and ask them to prepare final payment; connected to the real
// invoices so it knows what's received / partially received / how much remains; by the arrival day-counter phase; in the
// customer's language (default English, selectable Spanish / French / Arabic)".
// The 16 texts below are the wording Max approved on 22 Nov 2026 (4 phases x 4 languages). They are fixed: nothing here is
// written by AI at send time. The only parts that change are the fields in curly brackets.
// Phases follow the warehouse Day Counter colours: 15-21 days friendly, 8-14 firmer, 0-7 urgent, past the date = overdue.
// SWC-safe: var + string concatenation only.

export var LANGS = ['en', 'es', 'fr', 'ar'];
export var LANG_NAMES = { en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic' };
export var PHASES = ['friendly', 'firmer', 'urgent', 'overdue'];
export var PHASE_WORDS = { friendly: 'Friendly (15–21 days)', firmer: 'Firmer (8–14 days)', urgent: 'Urgent (0–7 days)', overdue: 'Beyond urgent (past the arrival date)' };
// how many reminders each phase gets when the automatic schedule is switched on (Phase 3; overdue = one every day)
export var PHASE_SENDS = { friendly: 1, firmer: 2, urgent: 4, overdue: null };
export var SIGNATURE = 'KTC International';

// Port of Loading, from the release number's prefix (Max, 22 Nov 2026: "1 ok. but you should look at other things if
// neither 1002 or 1001, as they will always be as you stated BUT need to ask to be confirmed when 1003").
//   1002- = Houston · 1001- = Canada: always, used without asking.
//   any other prefix (1003-, …): NOT guessed. The warehouse name is offered as a suggestion and a person confirms it.
export var POL_BY_PREFIX = { '1002': 'Houston', '1001': 'Canada' };
export function polOfRelease(release) {
  var m = /^\s*(\d{4})\s*-/.exec(String(release || ''));
  var prefix = m ? m[1] : null;
  if (prefix && Object.prototype.hasOwnProperty.call(POL_BY_PREFIX, prefix)) { return { pol: POL_BY_PREFIX[prefix], certain: true, prefix: prefix }; }
  return { pol: null, certain: false, prefix: prefix };
}

export function langOf(s) { var t = String(s || '').trim().toLowerCase().substring(0, 2); return LANGS.indexOf(t) >= 0 ? t : 'en'; }

// whole days from "today" to the arrival date, both plain YYYY-MM-DD dates (no clock, no time zone arithmetic)
export function daysBetween(todayIso, arrivalIso) {
  var a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(todayIso || '')); var b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(arrivalIso || ''));
  if (!a || !b) { return null; }
  var ta = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3])); var tb = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((tb - ta) / 86400000);
}
// the warehouse runs on New York time, so "today" for the day counter is the New York calendar date
export function todayInNewYork(nowMs) {
  var d = new Date(nowMs === undefined || nowMs === null ? Date.now() : nowMs);
  var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  var o = {}; parts.forEach(function (p) { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}
// null = more than 21 days away (or no date): no reminder yet
export function phaseOf(days) {
  if (days === null || days === undefined || isNaN(Number(days))) { return null; }
  var n = Number(days);
  if (n < 0) { return 'overdue'; }
  if (n <= 7) { return 'urgent'; }
  if (n <= 14) { return 'firmer'; }
  if (n <= 21) { return 'friendly'; }
  return null;
}
// the slot inside a phase. One slot = one reminder; the automatic schedule never sends the same slot twice.
//   friendly: 1 slot · firmer: days 14-12, 11-8 · urgent: days 7-6, 5-4, 3-2, 1-0 · overdue: one per calendar day
export function slotOf(days, todayIso) {
  var ph = phaseOf(days); if (!ph) { return null; }
  var n = Number(days);
  if (ph === 'friendly') { return 'friendly-1'; }
  if (ph === 'firmer') { return n >= 12 ? 'firmer-1' : 'firmer-2'; }
  if (ph === 'urgent') { return n >= 6 ? 'urgent-1' : (n >= 4 ? 'urgent-2' : (n >= 2 ? 'urgent-3' : 'urgent-4')); }
  return 'overdue-' + String(todayIso || '').substring(0, 10);
}

// ── money (whole cents inside, never floating sums) ──
export function cents(x) { return Math.round((Number(x) || 0) * 100); }
export function money(x) { return '$' + (Number(x) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// invoices: [{ id, number, total, paid, currency, customer_id, customer_name, releases: n }] — only live, counted invoices.
// Returns the three figures of the message, or a reason nothing can be stated.
export function balanceOf(invoices) {
  var list = Array.isArray(invoices) ? invoices : [];
  if (!list.length) { return { ok: false, reason: 'No invoice is linked to this release in the Hub — there is no balance to state.' }; }
  var other = list.filter(function (i) { return String(i.currency || 'USD').toUpperCase() !== 'USD'; });
  if (other.length) { return { ok: false, reason: 'An invoice on this release is not in US dollars (' + other.map(function (i) { return i.number + ' ' + i.currency; }).join(', ') + ') — the reminder states dollars only.' }; }
  var total = 0; var paid = 0; var over = 0; var remaining = 0;
  list.forEach(function (i) {
    var t = cents(i.total); var p = cents(i.paid); total += t; paid += p;
    if (p > t) { over += p - t; } else { remaining += t - p; }
  });
  // an overpayment on one invoice never hides what is still owed on another: received is capped per invoice
  var received = total - remaining;
  return { ok: true, total: total / 100, received: received / 100, remaining: remaining / 100, overpaid: over / 100, paid_in_full: remaining <= 0, invoice_count: list.length };
}

// ── dates and day counts, per language ──
var LOCALE = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', ar: 'ar-EG-u-nu-latn' };
export function dateWords(iso, lang) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) { return String(iso || ''); }
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  try { return new Intl.DateTimeFormat(LOCALE[langOf(lang)], { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(d); } catch (e) { return m[0]; }
}
// Arabic counts: 3-10 take the plural (أيام), 11 and up the singular accusative (يومًا)
function arDays(n) { return n === 1 ? 'يوم واحد' : (n === 2 ? 'يومين' : (n >= 3 && n <= 10 ? n + ' أيام' : n + ' يومًا')); }
function daysCount(n, lang) {
  if (lang === 'ar') { return arDays(n); }
  if (lang === 'es') { return n + (n === 1 ? ' día' : ' días'); }
  if (lang === 'fr') { return n + (n === 1 ? ' jour' : ' jours'); }
  return n + (n === 1 ? ' day' : ' days');
}
// the closing words of the urgent sentence: "5 days away" / "tomorrow" / "today" (a count of 0 or 1 is never printed as "0 days")
function urgentWhen(n, lang) {
  if (lang === 'ar') { return n <= 0 ? 'اليوم' : (n === 1 ? 'غدًا' : 'خلال ' + arDays(n)); }
  if (lang === 'es') { return n <= 0 ? 'hoy' : (n === 1 ? 'mañana' : 'dentro de ' + daysCount(n, 'es')); }
  if (lang === 'fr') { return n <= 0 ? 'aujourd\u2019hui' : (n === 1 ? 'demain' : 'dans ' + daysCount(n, 'fr')); }
  return n <= 0 ? 'today' : (n === 1 ? 'tomorrow' : daysCount(n, 'en') + ' away');
}

// ── the 16 approved texts. {name} {release} {pol} {destination} {container} {date} {days} {when} {total} {received} {remaining} ──
var ACCOUNT = {
  en: 'Your account for this shipment:\n• Invoice total: {total}\n• Received to date: {received}\n• Balance remaining: {remaining}',
  es: 'Estado de su cuenta para este envío:\n• Total de la factura: {total}\n• Recibido a la fecha: {received}\n• Saldo pendiente: {remaining}',
  fr: 'État de votre compte pour cette expédition :\n• Total de la facture : {total}\n• Reçu à ce jour : {received}\n• Solde restant : {remaining}',
  ar: 'حالة حسابكم لهذه الشحنة:\n• إجمالي الفاتورة: {total}\n• المبلغ المستلم حتى الآن: {received}\n• الرصيد المتبقي: {remaining}'
};
// Max, 22 Nov 2026 (one invoice covering several releases): "just list all releases on that invoice and balance totals".
// When the invoice(s) of this order also cover other releases, the first line of the account block names every release and the
// three amounts are the totals of the whole invoice — nothing is split per release (no allocation is invented).
var ACCOUNT_HEAD = {
  en: ['Your account for this shipment:', 'Your account for releases {releases}, which are invoiced together:'],
  es: ['Estado de su cuenta para este envío:', 'Estado de su cuenta para los embarques {releases}, facturados conjuntamente:'],
  fr: ['État de votre compte pour cette expédition :', 'État de votre compte pour les envois {releases}, facturés ensemble :'],
  ar: ['حالة حسابكم لهذه الشحنة:', 'حالة حسابكم للشحنات {releases} المفوترة معًا:']
};
export function releaseList(list) {
  var out = []; var seen = {};
  (Array.isArray(list) ? list : []).forEach(function (r) { var t = clean(r, 40).replace(/[{}<>]/g, ''); var k = t.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (k && !seen[k]) { seen[k] = true; out.push(t); } });
  return out;
}
var TEXTS = {
  en: {
    friendly: ['Dear {name},',
      'Good news — your shipment is on the way. Release {release} ({pol} → {destination}, container {container}) is expected to arrive on {date}, about {days} from now.',
      'To keep clearance and delivery smooth, please begin preparing the final payment ahead of arrival.',
      '{account}',
      'If you have any questions about the balance or the arrival, just reply to this message and we\u2019ll be glad to help.',
      'Warm regards,\n{signature}'],
    firmer: ['Dear {name},',
      'Your shipment is approaching. Release {release} ({pol} → {destination}, container {container}) is expected to arrive on {date}, in about {days}.',
      'Please arrange the final payment now so there is no delay at arrival. Cleared funds are needed before release of the container.',
      '{account}',
      'Kindly confirm when payment has been sent, or reply if you need the banking details again.',
      'Regards,\n{signature}'],
    urgent: ['Dear {name},',
      'Your shipment arrives very soon. Release {release} ({pol} → {destination}, container {container}) is expected on {date} — {when}.',
      'The balance below must be settled before the container can be released. To avoid storage/demurrage charges, please send the final payment today.',
      '{account}',
      'Please reply with your payment confirmation as soon as it is sent.',
      'Regards,\n{signature}'],
    overdue: ['Dear {name},',
      'Release {release} ({pol} → {destination}, container {container}) has arrived (expected {date}) and the balance below is now overdue.',
      'The container cannot be released and daily storage/demurrage charges may apply until payment is received. Please send the outstanding balance immediately.',
      '{account}',
      'If payment has already been sent, please reply with the confirmation so we can update your account.',
      'Regards,\n{signature}']
  },
  es: {
    friendly: ['Estimado/a {name}:',
      'Buenas noticias: su envío está en camino. El embarque {release} ({pol} → {destination}, contenedor {container}) tiene llegada prevista el {date}, dentro de unos {days}.',
      'Para que el despacho y la entrega sean ágiles, le pedimos que comience a preparar el pago final antes de la llegada.',
      '{account}',
      'Si tiene cualquier duda sobre el saldo o la llegada, responda a este mensaje y con gusto le ayudamos.',
      'Un cordial saludo,\n{signature}'],
    firmer: ['Estimado/a {name}:',
      'Su envío se acerca. El embarque {release} ({pol} → {destination}, contenedor {container}) tiene llegada prevista el {date}, en unos {days}.',
      'Le pedimos que gestione ahora el pago final para evitar demoras en la llegada. Se requieren fondos acreditados antes de liberar el contenedor.',
      '{account}',
      'Le agradecemos confirmar cuando haya realizado el pago, o responder si necesita nuevamente los datos bancarios.',
      'Atentamente,\n{signature}'],
    urgent: ['Estimado/a {name}:',
      'Su envío llega muy pronto. El embarque {release} ({pol} → {destination}, contenedor {container}) se espera el {date}, {when}.',
      'El saldo indicado debe liquidarse antes de poder liberar el contenedor. Para evitar cargos por almacenaje/demora, envíe hoy mismo el pago final.',
      '{account}',
      'Por favor, responda con el comprobante de pago en cuanto lo haya enviado.',
      'Atentamente,\n{signature}'],
    overdue: ['Estimado/a {name}:',
      'El embarque {release} ({pol} → {destination}, contenedor {container}) ya ha llegado (fecha prevista {date}) y el saldo indicado está vencido.',
      'El contenedor no puede liberarse y pueden aplicarse cargos diarios de almacenaje/demora hasta recibir el pago. Le pedimos enviar de inmediato el saldo pendiente.',
      '{account}',
      'Si ya realizó el pago, responda con el comprobante para actualizar su cuenta.',
      'Atentamente,\n{signature}']
  },
  fr: {
    friendly: ['Cher/Chère {name},',
      'Bonne nouvelle : votre expédition est en route. L\u2019envoi {release} ({pol} → {destination}, conteneur {container}) devrait arriver le {date}, dans environ {days}.',
      'Afin que le dédouanement et la livraison se déroulent sans accroc, nous vous invitons à préparer le paiement final avant l\u2019arrivée.',
      '{account}',
      'Pour toute question concernant le solde ou l\u2019arrivée, répondez simplement à ce message : nous serons ravis de vous aider.',
      'Cordialement,\n{signature}'],
    firmer: ['Cher/Chère {name},',
      'Votre expédition approche. L\u2019envoi {release} ({pol} → {destination}, conteneur {container}) devrait arriver le {date}, dans environ {days}.',
      'Nous vous invitons à effectuer dès maintenant le paiement final afin d\u2019éviter tout retard à l\u2019arrivée. Les fonds doivent être crédités avant la libération du conteneur.',
      '{account}',
      'Merci de nous confirmer l\u2019envoi du paiement, ou de répondre si vous avez de nouveau besoin des coordonnées bancaires.',
      'Cordialement,\n{signature}'],
    urgent: ['Cher/Chère {name},',
      'Votre expédition arrive très bientôt. L\u2019envoi {release} ({pol} → {destination}, conteneur {container}) est attendu le {date}, {when}.',
      'Le solde ci-dessous doit être réglé avant que le conteneur puisse être libéré. Pour éviter des frais de stockage/surestaries, veuillez envoyer le paiement final dès aujourd\u2019hui.',
      '{account}',
      'Merci de répondre avec votre confirmation de paiement dès son envoi.',
      'Cordialement,\n{signature}'],
    overdue: ['Cher/Chère {name},',
      'L\u2019envoi {release} ({pol} → {destination}, conteneur {container}) est arrivé (prévu le {date}) et le solde ci-dessous est désormais échu.',
      'Le conteneur ne peut pas être libéré et des frais quotidiens de stockage/surestaries peuvent s\u2019appliquer jusqu\u2019à réception du paiement. Merci d\u2019envoyer immédiatement le solde dû.',
      '{account}',
      'Si le paiement a déjà été envoyé, merci de répondre avec la confirmation afin que nous mettions votre compte à jour.',
      'Cordialement,\n{signature}']
  },
  ar: {
    friendly: ['عزيزي/عزيزتي {name}،',
      'خبر سار — شحنتكم في طريقها إليكم. من المتوقع وصول الشحنة {release} ({pol} ← {destination}، الحاوية {container}) بتاريخ {date}، أي بعد نحو {days}.',
      'لتسهيل التخليص والتسليم، نرجو منكم البدء في تجهيز الدفعة النهائية قبل الوصول.',
      '{account}',
      'لأي استفسار بخصوص الرصيد أو موعد الوصول، يسعدنا مساعدتكم — فقط قوموا بالرد على هذه الرسالة.',
      'مع خالص التحية،\n{signature}'],
    firmer: ['عزيزي/عزيزتي {name}،',
      'تقترب شحنتكم من الوصول. من المتوقع وصول الشحنة {release} ({pol} ← {destination}، الحاوية {container}) بتاريخ {date}، أي بعد نحو {days}.',
      'نرجو ترتيب الدفعة النهائية الآن لتفادي أي تأخير عند الوصول، حيث يلزم توفّر المبلغ قبل الإفراج عن الحاوية.',
      '{account}',
      'نرجو إبلاغنا عند إتمام الدفع، أو الرد علينا إذا كنتم بحاجة إلى بيانات التحويل البنكي مجددًا.',
      'مع التحية،\n{signature}'],
    urgent: ['عزيزي/عزيزتي {name}،',
      'شحنتكم على وشك الوصول. من المتوقع وصول الشحنة {release} ({pol} ← {destination}، الحاوية {container}) بتاريخ {date}، {when}.',
      'يجب تسوية الرصيد الموضّح أدناه قبل التمكّن من الإفراج عن الحاوية. ولتفادي رسوم التخزين/الأرضيات، نرجو إرسال الدفعة النهائية اليوم.',
      '{account}',
      'نرجو الرد بإشعار الدفع فور إرساله.',
      'مع التحية،\n{signature}'],
    overdue: ['عزيزي/عزيزتي {name}،',
      'وصلت الشحنة {release} ({pol} ← {destination}، الحاوية {container}) (الموعد المتوقع {date})، وأصبح الرصيد الموضّح أدناه مستحقًا ومتأخرًا.',
      'لا يمكن الإفراج عن الحاوية، وقد تُطبّق رسوم تخزين/أرضيات يومية حتى استلام الدفع. نرجو إرسال الرصيد المستحق فورًا.',
      '{account}',
      'إذا كنتم قد أرسلتم الدفعة بالفعل، نرجو الرد بالإشعار لتحديث حسابكم.',
      'مع التحية،\n{signature}']
  }
};

function clean(s, n) { return String(s === null || s === undefined ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().substring(0, n || 120); }
// fills {field} once, from the values only: a value that itself contains "{total}" is never filled again
function fill(text, vals) { return String(text).replace(/\{([a-z_]+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vals, k) ? String(vals[k]) : m; }); }

// Subject (Max): {Release #} · KTC · {Port of Loading} → {Destination} · Container {#}  — the same in every language
export function subjectOf(f) {
  return clean(f.release, 60) + ' · KTC · ' + clean(f.pol, 60) + ' → ' + clean(f.destination, 60) + ' · Container ' + clean(f.container, 40);
}
// what stops a reminder from being written at all (a message with a blank in it is never sent)
export function missingFields(f) {
  var out = [];
  if (!clean(f.name)) { out.push('the customer\u2019s name'); }
  if (!clean(f.release)) { out.push('the release number'); }
  if (!clean(f.pol)) { out.push('the port of loading (the order\u2019s warehouse)'); }
  if (!clean(f.destination)) { out.push('the destination (the order\u2019s country)'); }
  var c = clean(f.container); if (!c || c === '0') { out.push('the container number'); }
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(f.arrival_date || ''))) { out.push('the arrival date'); }
  return out;
}
// f: { name, release, pol, destination, container, arrival_date, days, total, received, remaining }
export function composeReminder(lang, phase, f) {
  var lg = langOf(lang);
  if (PHASES.indexOf(phase) < 0) { return { ok: false, error: 'No reminder is due for this order yet (the arrival is more than 21 days away, or has no date).' }; }
  var miss = missingFields(f || {});
  if (miss.length) { return { ok: false, error: 'This reminder cannot be written yet — missing: ' + miss.join(', ') + '.', missing: miss }; }
  var n = Number(f.days); if (isNaN(n)) { return { ok: false, error: 'The day counter is not known for this order.' }; }
  var vals = { name: clean(f.name), release: clean(f.release, 60), pol: clean(f.pol, 60), destination: clean(f.destination, 60), container: clean(f.container, 40),
    date: dateWords(f.arrival_date, lg), days: daysCount(Math.abs(n), lg), when: urgentWhen(n, lg),
    total: money(f.total), received: money(f.received), remaining: money(f.remaining), signature: SIGNATURE };
  var rels = releaseList(f.releases); var shared = rels.length > 1;
  if (rels.length > 12) { return { ok: false, error: 'The invoice on this release covers ' + rels.length + ' releases — too many to list in a reminder. Write to this customer by hand.' }; }
  vals.releases = rels.join(', ');
  var account = ACCOUNT[lg].split(ACCOUNT_HEAD[lg][0]).join(shared ? ACCOUNT_HEAD[lg][1] : ACCOUNT_HEAD[lg][0]);
  if (account.indexOf(shared ? ACCOUNT_HEAD[lg][1] : ACCOUNT_HEAD[lg][0]) !== 0) { return { ok: false, error: 'The account block of the message could not be written.' }; }
  var paras = TEXTS[lg][phase].map(function (p) { return p === '{account}' ? fill(account, vals) : fill(p, vals); });
  return { ok: true, lang: lg, phase: phase, rtl: lg === 'ar', shared_invoice: shared, subject: subjectOf(f), body: paras.join('\n\n') };
}

// the same text as a simple HTML e-mail (right-to-left for Arabic); every character of the text is escaped
export function htmlOf(body, rtl) {
  var esc = String(body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<div dir="' + (rtl ? 'rtl' : 'ltr') + '" style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:650px;margin:0 auto;font-size:14px;line-height:1.7;color:#1e293b;text-align:' + (rtl ? 'right' : 'left') + '">'
    + esc.replace(/\n/g, '<br/>') + '</div>';
}

// what the warehouse shows for an order: the last real reminder, how many, and the balance as it was stated
export function statusOf(logRows) {
  var real = (Array.isArray(logRows) ? logRows : []).filter(function (r) { return r && r.status === 'sent' && r.mode !== 'test'; })
    .sort(function (a, b) { return String(b.sent_at || b.created_at || '').localeCompare(String(a.sent_at || a.created_at || '')); });
  // delivery unconfirmed: the mail server never answered ('unknown'), or the send never finished ('sending'). Never counted as sent,
  // never hidden: a person must look before another reminder goes to the customer.
  var unsure = (Array.isArray(logRows) ? logRows : []).filter(function (r) { return r && (r.status === 'unknown' || r.status === 'sending') && r.mode !== 'test'; })
    .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
  var un = unsure.length ? { count: unsure.length, at: unsure[0].created_at || null, sent_to: unsure[0].sent_to || null, slot: unsure[0].slot || null } : null;
  if (!real.length) { return { sent: 0, last: null, unconfirmed: un }; }
  var l = real[0];
  return { sent: real.length, unconfirmed: un, last: { at: l.sent_at || l.created_at, phase: l.phase, slot: l.slot, channel: l.channel, language: l.language, mode: l.mode, sent_to: l.sent_to,
    total: l.total === null || l.total === undefined ? null : Number(l.total), received: l.received === null || l.received === undefined ? null : Number(l.received), remaining: l.remaining === null || l.remaining === undefined ? null : Number(l.remaining) } };
}
