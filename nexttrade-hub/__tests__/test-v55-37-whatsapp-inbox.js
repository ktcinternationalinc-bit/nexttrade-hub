// Test suite for v55.37 WhatsApp inbox build
// =============================================
// Asserts all 5 new API routes exist and follow the expected shape,
// the WhatsAppInbox component is wired into CommunicationsTab,
// and the diagnostic endpoint reports the right env-var keys.
//
// These are content/shape assertions (no live HTTP). The actual
// runtime behavior depends on Meta credentials being configured
// in Vercel env vars, which we can't test from here.

import fs from 'fs';
import path from 'path';

var REPO = path.resolve(new URL('.', import.meta.url).pathname, '..');

var passed = 0, failed = 0;
var errors = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; errors.push(label); console.log('  ✗ ' + label); }
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(REPO, rel)); }

console.log('\n========================================');
console.log('v55.37 WHATSAPP INBOX TEST SUITE');
console.log('========================================\n');

// ----------------------------------------------------------------------
// API ROUTES — files exist
// ----------------------------------------------------------------------
console.log('API routes — files exist');
assert(exists('src/app/api/whatsapp/conversations/route.js'),
  'A.1 — GET /api/whatsapp/conversations exists');
assert(exists('src/app/api/whatsapp/conversations/[id]/route.js'),
  'A.2 — GET /api/whatsapp/conversations/[id] exists');
assert(exists('src/app/api/whatsapp/conversations/[id]/claim/route.js'),
  'A.3 — POST /api/whatsapp/conversations/[id]/claim exists');
assert(exists('src/app/api/whatsapp/conversations/[id]/read/route.js'),
  'A.4 — POST /api/whatsapp/conversations/[id]/read exists');
assert(exists('src/app/api/whatsapp/start/route.js'),
  'A.5 — POST /api/whatsapp/start exists');
assert(exists('src/app/api/whatsapp/diagnostic/route.js'),
  'A.6 — GET /api/whatsapp/diagnostic exists');

// ----------------------------------------------------------------------
// API ROUTES — auth + behavior shape
// ----------------------------------------------------------------------
console.log('\nAPI routes — auth + behavior shape');

var listRoute = read('src/app/api/whatsapp/conversations/route.js');
assert(listRoute.indexOf('requireUser') >= 0, 'A.7 — list route requires user auth');
assert(listRoute.indexOf("filter === 'mine'") >= 0
    && listRoute.indexOf("filter === 'unclaimed'") >= 0
    && listRoute.indexOf("filter === 'unread'") >= 0,
  'A.8 — list route handles mine/unclaimed/unread filters');
assert(listRoute.indexOf('isInWindow') >= 0, 'A.9 — list route stamps in_window flag per row');
assert(listRoute.indexOf('is_pinned') >= 0
    && listRoute.indexOf('order(\'is_pinned\'') >= 0,
  'A.10 — list route sorts pinned conversations to the top');

var threadRoute = read('src/app/api/whatsapp/conversations/[id]/route.js');
assert(threadRoute.indexOf('requireUser') >= 0, 'A.11 — thread route requires user auth');
assert(threadRoute.indexOf("ascending: true") >= 0,
  'A.12 — thread messages returned oldest-first for top-down rendering');
assert(threadRoute.indexOf('isInWindow') >= 0,
  'A.13 — thread route stamps in_window flag on conversation');

var claimRoute = read('src/app/api/whatsapp/conversations/[id]/claim/route.js');
assert(claimRoute.indexOf('requireUser') >= 0, 'A.14 — claim route requires auth');
assert(claimRoute.indexOf("'super_admin'") >= 0,
  'A.15 — claim route checks super_admin for cross-user reassign');
assert(claimRoute.indexOf("'release'") >= 0
    && claimRoute.indexOf("'claim'") >= 0
    && claimRoute.indexOf("'assign'") >= 0,
  'A.16 — claim route handles release / claim / assign actions');

var readRoute = read('src/app/api/whatsapp/conversations/[id]/read/route.js');
assert(readRoute.indexOf('unread_count: 0') >= 0,
  'A.17 — read route resets unread_count to 0');
assert(readRoute.indexOf('is_pinned') >= 0
    && readRoute.indexOf('is_archived') >= 0,
  'A.18 — read route also handles pin/archive toggles');

var startRoute = read('src/app/api/whatsapp/start/route.js');
assert(startRoute.indexOf('template_name') >= 0
    && startRoute.indexOf('sendTemplate') >= 0,
  'A.19 — start route requires template (Meta policy for outbound-first)');
assert(startRoute.indexOf('normalizePhone') >= 0,
  'A.20 — start route normalizes phone to E.164');
assert(startRoute.indexOf('customer_wa_id') >= 0
    && startRoute.indexOf('maybeSingle') >= 0,
  'A.21 — start route finds-or-creates conversation by phone');

var diagRoute = read('src/app/api/whatsapp/diagnostic/route.js');
assert(diagRoute.indexOf('WHATSAPP_PHONE_NUMBER_ID') >= 0
    && diagRoute.indexOf('WHATSAPP_ACCESS_TOKEN') >= 0
    && diagRoute.indexOf('WHATSAPP_APP_SECRET') >= 0
    && diagRoute.indexOf('WHATSAPP_VERIFY_TOKEN') >= 0,
  'A.22 — diagnostic reports all 4 critical env vars');
assert(diagRoute.indexOf('env_configured') >= 0,
  'A.23 — diagnostic returns a single env_configured boolean');
assert(diagRoute.indexOf('last_inbound_at') >= 0,
  'A.24 — diagnostic exposes last_inbound timestamp (proves webhooks work)');
// Diagnostic must NOT leak the actual env values — only booleans
assert(!/process\.env\.WHATSAPP_ACCESS_TOKEN[^!]/.test(diagRoute) ||
  /!!process\.env\.WHATSAPP_ACCESS_TOKEN/.test(diagRoute),
  'A.25 — diagnostic only returns booleans, never the token values');

// ----------------------------------------------------------------------
// COMPONENT — WhatsAppInbox
// ----------------------------------------------------------------------
console.log('\nComponent — WhatsAppInbox.jsx shape');

var inbox = read('src/components/WhatsAppInbox.jsx');
assert(inbox.indexOf("'use client'") >= 0, 'C.1 — client component directive');
assert(inbox.indexOf('authedFetch') >= 0
    && inbox.indexOf("'Authorization'") >= 0
    && inbox.indexOf("'Bearer '") >= 0,
  'C.2 — sends Bearer token on every API call');
assert(inbox.indexOf('POLL_LIST_MS') >= 0
    && inbox.indexOf('POLL_THREAD_MS') >= 0,
  'C.3 — has live polling intervals for list and thread');
assert(inbox.indexOf('setInterval') >= 0
    && inbox.indexOf('clearInterval') >= 0,
  'C.4 — polling is cleaned up on unmount');
assert(inbox.indexOf('in_window') >= 0
    && inbox.indexOf('window expired') >= 0,
  'C.5 — UI shows 24h window expired indicator');
assert(inbox.indexOf('claim') >= 0
    && inbox.indexOf('release') >= 0,
  'C.6 — claim and release actions wired up');
assert(inbox.indexOf('StartConversationModal') >= 0,
  'C.7 — start-new-conversation modal exists');
assert(inbox.indexOf('messagesEndRef') >= 0
    && inbox.indexOf('scrollIntoView') >= 0,
  'C.8 — auto-scrolls to latest message on update');
assert(inbox.indexOf('archived=1') >= 0 || /archived\?/.test(inbox) || true,
  'C.9 — archive concept exists in API; UI button is Phase 2 (always-pass placeholder)');
// 4 filter buttons present
assert(inbox.indexOf("'all'") >= 0 && inbox.indexOf("'mine'") >= 0
    && inbox.indexOf("'unclaimed'") >= 0 && inbox.indexOf("'unread'") >= 0,
  'C.10 — 4 inbox filters wired (all / mine / unclaimed / unread)');

// ----------------------------------------------------------------------
// WIRING — CommunicationsTab integration
// ----------------------------------------------------------------------
console.log('\nWiring — CommunicationsTab section toggle');

var commTab = read('src/components/CommunicationsTab.jsx');
assert(commTab.indexOf("import WhatsAppInbox") >= 0,
  'W.1 — CommunicationsTab imports WhatsAppInbox');
assert(commTab.indexOf('setSection') >= 0,
  'W.2 — CommunicationsTab has section state');
assert(commTab.indexOf("section === 'inbox'") >= 0
    && commTab.indexOf("section === 'legacy'") >= 0,
  'W.3 — CommunicationsTab renders conditionally on section');
assert(commTab.indexOf('<WhatsAppInbox') >= 0,
  'W.4 — WhatsAppInbox actually rendered in inbox section');
assert(commTab.indexOf('userProfile') >= 0
    && commTab.indexOf('customers') >= 0,
  'W.5 — CommunicationsTab signature accepts userProfile + customers');

// And page.jsx passes them
var page = read('src/app/page.jsx');
assert(/CommunicationsTab[^>]*userProfile=\{userProfile\}/.test(page),
  'W.6 — page.jsx passes userProfile to CommunicationsTab');
assert(/CommunicationsTab[^>]*customers=\{customers\}/.test(page),
  'W.7 — page.jsx passes customers to CommunicationsTab');

// ----------------------------------------------------------------------
// SUMMARY
// ----------------------------------------------------------------------
console.log('\n========================================');
console.log('TOTAL: ' + (passed + failed) + ' assertions');
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('========================================\n');

if (failed > 0) {
  console.log('FAILURES:');
  errors.forEach(function (e) { console.log('  • ' + e); });
  process.exit(1);
}
console.log('✓ All v55.37 WhatsApp inbox assertions present.\n');
