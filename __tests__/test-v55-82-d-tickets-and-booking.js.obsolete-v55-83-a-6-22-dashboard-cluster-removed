// ============================================================
// v55.82-D — Closed-ticket greying, Critical priority, two-stage shipping
//             booking (Request → Confirm)
//
// Max May 10, 2026:
//   "Close tickets should be highlighted in grey to indicate they are
//    closed, easy on the eyes."
//   "Need a critical priority — must be done within the next couple of
//    hours — extra status above high."
//   "In shipping, be able to create a booking that you can send to the
//    freight forwarder for that rate, AND when you create the booking you
//    enter customer info / release number / expected date / booking number.
//    Two buttons: Request Booking (email/WhatsApp the forwarder) and
//    Confirm Booking (capture the booking number after they reply)."
//
// Coverage:
//
//   #1 PRIORITY — Critical tier added above High
//      PRIORITIES array adds {v:'critical', c:'#7f1d1d'} as element [0].
//      priOrder map: critical=0, high=1, medium=2, low=3.
//      Voice recognition matches "critical|emergency|drop everything".
//      Filter dropdown + summary card both show critical.
//      AdminTab list view + detail view + PersonalDashboard show
//      critical with 🚨 icon + dark red text.
//      Dashboard briefing surfaces critical line ABOVE overdue/high.
//
//   #2 GREY CLOSED TICKETS — visual de-emphasis
//      Tickets with status === 'Closed' get bg-slate-50 + opacity-70
//      + slate-400 border (overrides the priority color). Hover bumps
//      back to opacity-100 so they're still readable on click.
//      PersonalDashboard MyTickets card mirrors the treatment.
//
//   #3 SHIPPING BOOKING — two-stage flow
//      Stage 1: handleRequestBooking(rate) → bookingRequestModal.
//        - generateBookingRequest builds the email/WhatsApp body
//        - submitBookingRequest stamps the rate with booking_requested
//          + booking_requested_at + customer + order + release +
//          expected_date
//        - Email / WhatsApp / Copy buttons all trigger the stamp
//      Stage 2: handleConfirmBooking(rate) → bookingConfirmModal.
//        - Booking number is required (autoFocus, can't save without)
//        - Customer fields prefill from booking_requested_* if present
//        - finalizeBookingConfirm inserts shipping_bookings row +
//          flips rate.booked=true + clears booking_requested
//      Rate row shows three states: BOOKED (green) / REQUESTED (amber)
//      / idle. Both buttons coexist on a fresh active rate so user can
//      skip request if they already have the booking# in hand.
//
//   #4 SCHEMA — migration for booking_requested* columns
// ============================================================

var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var ticketsTab = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var pageJsx    = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'page.jsx'), 'utf8');
var adminTab   = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AdminTab.jsx'), 'utf8');
var personalDash = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalDashboard.jsx'), 'utf8');
var shipTab    = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ShippingRatesTab.jsx'), 'utf8');
var migrationsDir = path.join(__dirname, '..', 'migrations');

// =====================================================================
// FIX #1 — Critical priority tier
// =====================================================================

// 1a — PRIORITIES array contains critical as element [0]
ok('1a: PRIORITIES array starts with {v:\'critical\',c:\'#7f1d1d\'}',
  /const PRIORITIES = \[\s*\{v:'critical'[^}]*c:'#7f1d1d'/.test(ticketsTab),
  'critical must be the highest tier — element [0] of PRIORITIES'
);

// 1b — All four tiers present in correct order
ok('1b: PRIORITIES array has critical → high → medium → low order',
  (function() {
    var match = ticketsTab.match(/const PRIORITIES = \[([\s\S]*?)\];/);
    if (!match) return false;
    var src = match[1];
    var ic = src.indexOf("'critical'");
    var ih = src.indexOf("'high'");
    var im = src.indexOf("'medium'");
    var il = src.indexOf("'low'");
    return ic >= 0 && ih > ic && im > ih && il > im;
  })()
);

// 1c — priOrder map: critical=0, high=1
ok('1c: priOrder map ranks critical=0, high=1',
  /priOrder = \{ critical: 0, high: 1, medium: 2, low: 3 \}/.test(ticketsTab)
);

// 1d — voice recognition catches "critical|emergency|drop everything"
ok('1d: voice recognition pattern detects critical phrases',
  /\/critical\|emergency\|drop everything\|right now\/i\.test\(text\)\) priority = 'critical'/.test(ticketsTab)
);

// 1e — filter dropdown has Critical option
ok('1e: filter dropdown <option value="critical"> present',
  /<option value="critical">🚨 Critical<\/option>/.test(ticketsTab)
);

// 1f — Stats grid bumped to 5 columns and Critical card present
ok('1f: stats grid has Critical card with #7f1d1d accent',
  /grid-cols-5[\s\S]{0,3000}🚨 Critical[\s\S]{0,400}t\.priority==='critical'&&t\.status!=='Closed'/.test(ticketsTab)
);

// 1g — Dashboard priColor + priBorderColor handle critical
ok('1g: Dashboard priColor handles critical → #7f1d1d',
  /priColor = \(p\) => p === 'critical' \? '#7f1d1d'/.test(pageJsx)
);
ok('1g2: Dashboard priBorderColor handles critical → #7f1d1d',
  /if \(p === 'critical'\) return '#7f1d1d'/.test(pageJsx)
);

// 1h — Dashboard briefing surfaces critical message ABOVE overdue
ok('1h: Dashboard briefing has criticalPriority filter',
  /criticalPriority = myTickets\.filter\(t => t\.priority === 'critical'\)/.test(pageJsx)
);
ok('1h2: critical priority briefing message present, surfaces "drop everything"',
  /CRITICAL ticket[\s\S]{0,200}must be handled within hours[\s\S]{0,200}Drop everything/.test(pageJsx)
);

// 1i — AdminTab list view colors critical dark red
ok('1i: AdminTab list view priority cell handles critical (text-red-900)',
  /t\.priority==='critical'\?'text-red-900'/.test(adminTab)
);

// 1j — AdminTab detail view shows 🚨 CRITICAL
ok('1j: AdminTab detail view shows 🚨 CRITICAL label',
  /viewTicket\.priority==='critical'\?'🚨 CRITICAL'/.test(adminTab)
);

// 1k — PersonalDashboard MyTickets shows 🚨 for critical
ok('1k: PersonalDashboard MyTickets renders 🚨 for critical priority',
  /t\.priority==='critical'&&<span[\s\S]{0,200}🚨/.test(personalDash)
);

// 1l — PersonalDashboard urgent items list shows 🚨 CRITICAL
ok('1l: PersonalDashboard urgent items shows 🚨 CRITICAL',
  /item\.priority === 'critical'[\s\S]{0,200}🚨 CRITICAL/.test(personalDash)
);

// =====================================================================
// FIX #2 — Closed tickets greyed out
// =====================================================================

// 2a — v55.82-S: Closed tickets get bg-slate-200 on outer card. The
// inner text muting is now per-child (title gets slate-600, badges
// get their own muted colors) rather than blanket text-slate-600 on
// the parent. This avoids React inheritance issues with the inline-
// styled colored pills.
ok('2a: v55.82-S — TicketsTab row applies bg-slate-200 when status===Closed',
  /t\.status === 'Closed'[\s\S]{0,80}'bg-slate-200 '/.test(ticketsTab),
  'closed tickets must be visibly grey (no longer near-white)'
);

// 2b — v55.82-Q: closed-ticket left border bumped to darker slate (#64748b)
// for the same contrast reason. Previously #94a3b8.
ok('2b: v55.82-Q — TicketsTab row uses darker slate left border for closed',
  /t\.status === 'Closed' \? '#64748b' : leftBorderColor/.test(ticketsTab)
);

// 2c — v55.82-Q: opacity-70/hover gimmick removed in favor of static
// darker bg. Closed tickets are always at full readable opacity now.
ok('2c: v55.82-Q — closed-ticket greying no longer uses opacity tricks',
  /t\.status === 'Closed'[\s\S]{0,80}'bg-slate-200/.test(ticketsTab) &&
  !/'Closed' \? 'bg-slate-50 opacity-70/.test(ticketsTab),
  'opacity-70 hover-opacity-100 gimmick replaced with stable bg-slate-200'
);

// 2d — PersonalDashboard My Tickets list also greys closed
ok('2d: PersonalDashboard My Tickets list greys closed (border-slate-200 bg-slate-50)',
  /t\.status==='Closed'\?'border-slate-200 bg-slate-50 opacity-70'/.test(personalDash)
);

// =====================================================================
// FIX #3 — Two-stage shipping booking flow
// =====================================================================

// 3a — Two new state hooks for the new modals
ok('3a: bookingRequestModal state hook exists',
  /const \[bookingRequestModal, setBookingRequestModal\] = useState\(null\)/.test(shipTab)
);
ok('3a2: bookingConfirmModal state hook exists',
  /const \[bookingConfirmModal, setBookingConfirmModal\] = useState\(null\)/.test(shipTab)
);

// 3b — Two handler stubs that open the modals
ok('3b: handleRequestBooking sets bookingRequestModal',
  /handleRequestBooking = \(rate\) => \{ setBookingRequestModal\(rate\); \}/.test(shipTab)
);
ok('3b2: handleConfirmBooking sets bookingConfirmModal',
  /handleConfirmBooking = \(rate\) => \{ setBookingConfirmModal\(rate\); \}/.test(shipTab)
);

// 3c — generateBookingRequest helper builds an email/WhatsApp body
ok('3c: generateBookingRequest helper exists and accepts rate + vendor + customer + order + release + expectedDate',
  /generateBookingRequest = \(rate, vendor, customerName, orderNumber, releaseNumber, expectedDate\)/.test(shipTab)
);

// 3d — Body includes route + container + rate + customer + release info
ok('3d: generated body includes route + container + rate + release + expected ship date',
  (function() {
    var idx = shipTab.indexOf('generateBookingRequest = ');
    if (idx < 0) return false;
    var slice = shipTab.slice(idx, idx + 5000);
    return /'Origin: '/.test(slice)
      && /'Container Type: '/.test(slice)
      && /'Customer: '/.test(slice)
      && /'Release #: '/.test(slice)
      && /Expected Cargo Ready Date/.test(slice);
  })()
);

// 3e — submitBookingRequest stamps booking_requested + booking_requested_at on the rate
ok('3e: submitBookingRequest writes booking_requested + booking_requested_at',
  /submitBookingRequest[\s\S]{0,2000}booking_requested: true[\s\S]{0,200}booking_requested_at: new Date\(\)\.toISOString\(\)/.test(shipTab)
);
ok('3e2: submitBookingRequest captures customer/order/release/expected_date',
  /submitBookingRequest[\s\S]{0,2000}booking_requested_customer[\s\S]{0,200}booking_requested_order[\s\S]{0,200}booking_requested_release[\s\S]{0,200}booking_requested_expected_date/.test(shipTab)
);

// 3f — submitBookingRequest is defensive about missing schema columns
ok('3f: submitBookingRequest catches schema-missing errors gracefully',
  /submitBookingRequest[\s\S]{0,3000}schema may be missing booking_requested columns/.test(shipTab)
);

// 3g — finalizeBookingConfirm inserts into shipping_bookings AND flips rate.booked
ok('3g: finalizeBookingConfirm inserts shipping_bookings row',
  /finalizeBookingConfirm[\s\S]{0,3000}dbInsert\('shipping_bookings'/.test(shipTab)
);
ok('3g2: finalizeBookingConfirm flips rate.booked = true',
  /finalizeBookingConfirm[\s\S]{0,3000}booked: true,[\s\S]{0,400}shipment_reference: f\.bookConfirmNumber/.test(shipTab)
);

// 3h — finalizeBookingConfirm requires the booking number
ok('3h: finalizeBookingConfirm rejects missing booking number',
  /finalizeBookingConfirm[\s\S]{0,500}if \(!rate \|\| !f\.bookConfirmNumber\)/.test(shipTab)
);

// 3i — Modal markup: Request Booking modal renders
ok('3i: Request Booking modal renders with editable message body',
  /\{bookingRequestModal && \(\(\) => \{[\s\S]{0,2000}Request Booking[\s\S]{0,3000}Message preview \(edit before sending\)/.test(shipTab)
);

// 3j — Request modal has Email / WhatsApp / Copy buttons that all call submitBookingRequest
ok('3j: Request modal Email button calls openEmail + submitBookingRequest',
  /openEmail\(vendor\.email[\s\S]{0,200}await submitBookingRequest\(rate\)/.test(shipTab)
);
ok('3j2: Request modal WhatsApp button calls openWhatsApp + submitBookingRequest',
  /openWhatsApp\(vendor\.whatsapp[\s\S]{0,200}await submitBookingRequest\(rate\)/.test(shipTab)
);

// 3k — Request modal warns when vendor contact missing
ok('3k: Request modal warns when no vendor contact saved',
  /No vendor contact saved for[\s\S]{0,300}Add this forwarder under Vendor Contacts/.test(shipTab)
);

// 3l — Confirm Booking modal exists with required Booking Number field
ok('3l: Confirm Booking modal has required Booking Number input with autoFocus',
  /\{bookingConfirmModal && \(\(\) => \{[\s\S]{0,3000}Booking Number \/ BL # \*[\s\S]{0,800}autoFocus/.test(shipTab)
);

// 3m — Confirm modal pre-fills customer/order/release/expected from booking_requested_*
ok('3m: Confirm modal pre-fills from booking_requested_* fields',
  /preCust  = f\.bookConfirmCustomer != null \? f\.bookConfirmCustomer : \(rate\.booking_requested_customer/.test(shipTab)
);

// 3n — Confirm button disabled when booking number empty
ok('3n: Confirm Booking save button disabled until booking number typed',
  /onClick=\{\(\) => finalizeBookingConfirm\(rate\)\} disabled=\{!f\.bookConfirmNumber\}/.test(shipTab)
);

// 3o — Rate row has Request Booking + Confirm Booking buttons
ok('3o: rate row renders 📨 Request Booking button when not booked + not requested',
  /!exp && !r\.booked && !r\.booking_requested[\s\S]{0,400}📨 Request Booking/.test(shipTab)
);
ok('3o2: rate row renders ✅ Confirm Booking button when not booked',
  /!exp && !r\.booked[\s\S]{0,400}✅ Confirm Booking/.test(shipTab)
);

// 3p — Rate row shows three-state booking display (BOOKED / REQUESTED / idle)
ok('3p: rate row shows three states: BOOKED, REQUESTED, idle',
  /✓ BOOKED[\s\S]{0,1500}r\.booking_requested[\s\S]{0,800}⏳ REQUESTED/.test(shipTab)
);

// 3q — Activity log entries written for both stages
ok('3q: activity log written for booking request',
  /logActivity\(myId, 'Requested booking: '/.test(shipTab)
);
ok('3q2: activity log written for booking confirm',
  /logActivity\(myId, 'Confirmed booking: '/.test(shipTab)
);

// =====================================================================
// FIX #4 — Migration for new columns
// =====================================================================

ok('4a: migration v55.82-d-shipping-booking-requested.sql exists',
  fs.existsSync(path.join(migrationsDir, 'v55.82-d-shipping-booking-requested.sql'))
);

ok('4b: migration adds all six booking_requested* columns idempotently',
  (function() {
    var p = path.join(migrationsDir, 'v55.82-d-shipping-booking-requested.sql');
    if (!fs.existsSync(p)) return false;
    var sql = fs.readFileSync(p, 'utf8');
    return /ADD COLUMN IF NOT EXISTS booking_requested BOOLEAN/.test(sql)
      && /ADD COLUMN IF NOT EXISTS booking_requested_at TIMESTAMPTZ/.test(sql)
      && /ADD COLUMN IF NOT EXISTS booking_requested_customer TEXT/.test(sql)
      && /ADD COLUMN IF NOT EXISTS booking_requested_order TEXT/.test(sql)
      && /ADD COLUMN IF NOT EXISTS booking_requested_release TEXT/.test(sql)
      && /ADD COLUMN IF NOT EXISTS booking_requested_expected_date DATE/.test(sql);
  })()
);

// =====================================================================
// Final
// =====================================================================

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-D tests passed (Critical priority + Closed greying + 2-stage booking)');
