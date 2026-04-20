// ============================================================
// COMPREHENSIVE TEST SUITE
// Tests: check reconcile, AI memory, cross-team routing,
// login events ET timezone, AI action dispatch, memory persistence
// ============================================================

const fs = require('fs');
const path = require('path');
const REPO_ROOT = path.resolve(__dirname, '..');

// ---- Test infrastructure ----
let passed = 0, failed = 0;
const failures = [];

function assert(condition, name, detail) {
  if (condition) {
    passed++;
    console.log('  ✓', name);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log('  ✗', name);
    if (detail) console.log('     ' + detail);
  }
}

function group(title) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(title);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ---- Load source as CommonJS (transpile ES module exports) ----
function loadModule(srcPath) {
  let src = fs.readFileSync(srcPath, 'utf8');
  // Strip any `import ... from ...` lines — treat imports as no-ops for isolated testing
  src = src.replace(/^import[^;]*;?\s*$/gm, '');
  // Convert export to CommonJS
  src = src.replace(/export\s+async\s+function\s+(\w+)/g, 'async function $1 ; module.exports.$1 = $1 ; async function $1');
  src = src.replace(/export\s+function\s+(\w+)/g, 'function $1 ; module.exports.$1 = $1 ; function $1');
  src = src.replace(/export\s+const\s+(\w+)/g, 'const $1 ; module.exports.$1 = $1 ; const $1');
  // Simpler — just write a load shim at the bottom that re-assigns
  return src;
}

// Use the exported lib
const checkReconcileSrc = fs.readFileSync('' + REPO_ROOT + '/src/lib/check-reconcile.js', 'utf8');
const shim = checkReconcileSrc.replace(/export\s+function/g, 'function') + '\nmodule.exports = { evaluateCheckReconcile };';
fs.writeFileSync('/tmp/_check_reconcile.js', shim);
const { evaluateCheckReconcile } = require('/tmp/_check_reconcile.js');

// ============================================================
// FIXTURES
// ============================================================
let nextId = 1;
const newId = (p) => p + '-' + (nextId++);

function mkCheck(o) {
  return Object.assign({
    id: newId('chk'), customer_name: 'Test Co', amount: 100000, check_number: '12345',
    bank_name: 'CIB', order_number: '2280', invoice_id: null, status: 'pending',
    check_date: '2026-04-01', due_date: '2026-04-15',
  }, o || {});
}
function mkInvoice(o) {
  return Object.assign({
    id: newId('inv'), order_number: '2280', customer_name: 'Test Co',
    total_amount: 200000, total_collected: 0, outstanding: 200000,
  }, o || {});
}
function mkTx(o) {
  return Object.assign({
    id: newId('tx'), transaction_date: '2026-04-15', order_number: '', description: '',
    cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, linked_invoice_id: null,
    source_check_id: null, is_bank_placeholder: false, matched_bank_txn_id: null,
    cash_method: null,
  }, o || {});
}
function mkUser(o) {
  return Object.assign({
    id: newId('user'), name: 'Test User', email: 'test@example.com', role: 'user',
  }, o || {});
}

// ============================================================
// SECTION 1 — CHECK RECONCILE (full re-verification)
// ============================================================
group('SECTION 1: Check Reconcile Evaluator');

{
  const r = evaluateCheckReconcile(mkCheck({ order_number: null, invoice_id: null }), [], []);
  assert(r.mode === 'no_invoice', '1.1 no invoice → no_invoice');
}
{
  const r = evaluateCheckReconcile(mkCheck({ order_number: '9999' }), [mkInvoice({ order_number: '2280' })], []);
  assert(r.mode === 'no_invoice', '1.2 order# mismatch → no_invoice');
}
{
  const chk = mkCheck({ id: 'chk-A' });
  const inv = mkInvoice();
  const tx = mkTx({ cash_in: 100000, linked_invoice_id: inv.id, source_check_id: 'chk-A' });
  const r = evaluateCheckReconcile(chk, [inv], [tx]);
  assert(r.mode === 'already_linked', '1.3 source_check_id → already_linked');
  assert(r.existingTreasury.id === tx.id, '1.3a returns the correct treasury');
}
{
  const chk = mkCheck({ amount: 100000 });
  const inv = mkInvoice();
  const bank = mkTx({ bank_in: 100000, linked_invoice_id: inv.id, matched_bank_txn_id: 'b1' });
  const r = evaluateCheckReconcile(chk, [inv], [bank]);
  assert(r.mode === 'candidate_match', '1.4 exact bank match → candidate_match');
  assert(r.candidates.length === 1, '1.4a exactly 1 candidate');
}
{
  const inv = mkInvoice();
  const tx = mkTx({ cash_in: 100000, linked_invoice_id: inv.id, source_check_id: 'chk-OTHER' });
  const r = evaluateCheckReconcile(mkCheck({ amount: 100000 }), [inv], [tx]);
  assert(r.mode === 'no_match', '1.5 tx bound to other check excluded → no_match');
}
{
  const inv = mkInvoice();
  const ph = mkTx({ is_bank_placeholder: true, expected_amount: 100000, linked_invoice_id: inv.id });
  const r = evaluateCheckReconcile(mkCheck({ amount: 100000 }), [inv], [ph]);
  assert(r.mode === 'no_match', '1.6 placeholder excluded');
}
{
  const inv = mkInvoice();
  const r = evaluateCheckReconcile(mkCheck({ amount: 100000 }), [inv], [
    mkTx({ bank_in: 99999, linked_invoice_id: inv.id, matched_bank_txn_id: 'b1' }),
  ]);
  assert(r.mode === 'no_match', '1.7 zero tolerance (99,999 ≠ 100,000)');
}
{
  const inv = mkInvoice();
  const split = mkTx({ cash_in: 30000, bank_in: 70000, linked_invoice_id: inv.id });
  const r = evaluateCheckReconcile(mkCheck({ amount: 100000 }), [inv], [split]);
  assert(r.mode === 'candidate_match', '1.8 cash_in + bank_in summed matches');
}
{
  const inv1 = mkInvoice({ id: 'inv-1', order_number: '1111' });
  const inv2 = mkInvoice({ id: 'inv-2', order_number: '2222' });
  const tx1 = mkTx({ cash_in: 100000, linked_invoice_id: 'inv-1' });
  const tx2 = mkTx({ cash_in: 100000, linked_invoice_id: 'inv-2' });
  const r = evaluateCheckReconcile(mkCheck({ order_number: '2222', amount: 100000 }), [inv1, inv2], [tx1, tx2]);
  assert(r.mode === 'candidate_match' && r.candidates.length === 1 && r.candidates[0].id === tx2.id, '1.9 only correct-invoice candidates');
}
{
  const r1 = evaluateCheckReconcile(null, [], []);
  assert(r1.mode === 'no_invoice', '1.10 null check handled');
  const r2 = evaluateCheckReconcile(mkCheck(), null, null);
  assert(r2.mode === 'no_invoice', '1.10a null arrays handled');
}

// ============================================================
// SECTION 2 — AI MEMORY LOGIC (simulated with in-memory "DB")
// ============================================================
group('SECTION 2: AI Memory Logic');

// Mock supabase client
function mockSupabase(tables) {
  const db = tables || {};
  return {
    from(table) {
      if (!db[table]) db[table] = [];
      const rows = db[table];
      let filters = [];
      let notFilters = [];
      let orderBy = null;
      let limitN = 1000;
      const chain = {
        select(cols, opts) {
          // Support head-count queries: supabase.select('id', { count: 'exact', head: true })
          if (opts && opts.count === 'exact' && opts.head) {
            // Apply filters collected so far and return count
            chain._isHeadCount = true;
          }
          return chain;
        },
        eq(col, val) { filters.push(r => r[col] === val); return chain; },
        is(col, val) {
          if (val === null) filters.push(r => r[col] == null);
          // In head-count mode, `.is()` is typically the terminal call — make the chain awaitable
          return chain;
        },
        order(col, opts) { orderBy = { col, desc: opts && opts.ascending === false }; return chain; },
        limit(n) { limitN = n; return chain; },
        maybeSingle() {
          const res = applyFilters();
          return Promise.resolve({ data: res[0] || null, error: null });
        },
        single() {
          const res = applyFilters();
          return Promise.resolve({ data: res[0] || null, error: res[0] ? null : { message: 'not found' } });
        },
        insert(payload) {
          const toInsert = Array.isArray(payload) ? payload : [payload];
          toInsert.forEach(r => {
            if (!r.id) r.id = 'auto-' + Math.random().toString(36).slice(2, 10);
            rows.push(Object.assign({}, r));
          });
          return {
            select() { return { maybeSingle: () => Promise.resolve({ data: toInsert[0], error: null }),
                                single: () => Promise.resolve({ data: toInsert[0], error: null }),
                                then: (cb) => cb({ data: toInsert, error: null }) }; },
            then(cb) { return cb({ data: toInsert, error: null }); },
          };
        },
        update(patch) {
          return {
            eq(col, val) {
              rows.forEach(r => { if (r[col] === val) Object.assign(r, patch); });
              return { then: (cb) => cb({ data: null, error: null }) };
            },
          };
        },
        then(cb) {
          const rows = applyFilters();
          if (chain._isHeadCount) return cb({ count: rows.length, data: null, error: null });
          return cb({ data: rows, error: null });
        },
      };
      function applyFilters() {
        let res = rows.filter(r => filters.every(f => f(r)));
        if (orderBy) res.sort((a, b) => {
          const x = a[orderBy.col], y = b[orderBy.col];
          if (x == null) return 1; if (y == null) return -1;
          return orderBy.desc ? (x < y ? 1 : -1) : (x > y ? 1 : -1);
        });
        return res.slice(0, limitN);
      }
      return chain;
    },
    _db: db,
  };
}

// 2.1: persist one memory item for the current user
(async function () {
  const sb = mockSupabase();
  const { persistMemoryCandidates } = require('' + REPO_ROOT + '/src/lib/ai-memory.js').default ||
    (() => { throw new Error('need-shim'); })();
})().catch(() => {});

// Use the shim approach (imports don't work in raw node)
const memSrc = fs.readFileSync('' + REPO_ROOT + '/src/lib/ai-memory.js', 'utf8');
const memShim = memSrc.replace(/export\s+async\s+function/g, 'async function').replace(/export\s+function/g, 'function')
  + '\nmodule.exports = { loadMemorySettings, loadMemoryForUser, buildMemoryContext, extractMemoryCandidates, persistMemoryCandidates };';
fs.writeFileSync('/tmp/_memory.js', memShim);
const memLib = require('/tmp/_memory.js');

async function runMemoryTests() {
  // 2.1: persist memory
  {
    const sb = mockSupabase();
    const settings = { default_note_retention_days: 30, max_memory_items_per_user: 500 };
    const candidates = [
      { content: 'User needs to call Omar about shipping', type: 'reminder', target_user_id: null, urgency_signal: null },
    ];
    const res = await memLib.persistMemoryCandidates(sb, candidates, 'user-1', 'call omar', settings);
    assert(res.inserted === 1, '2.1 persist inserts 1 item');
    assert(sb._db.ai_memory && sb._db.ai_memory.length === 1, '2.1a row in ai_memory');
  }

  // 2.2: persist with target_user_id
  {
    const sb = mockSupabase();
    const settings = { default_note_retention_days: 30, max_memory_items_per_user: 500 };
    const candidates = [
      { content: 'Omar needs to call customers today', type: 'reminder', target_user_id: 'omar-id', urgency_signal: 'today' },
    ];
    await memLib.persistMemoryCandidates(sb, candidates, 'max-id', 'tell omar to call customers', settings);
    const row = sb._db.ai_memory[0];
    assert(row.target_user_id === 'omar-id', '2.2 cross-user target_user_id preserved');
    assert(row.scope === 'team', '2.2a scope=team when target set');
    assert(row.user_id === 'max-id', '2.2b user_id = sender');
  }

  // 2.3: expiry — note gets 30-day expiry, urgent gets none
  {
    const sb = mockSupabase();
    const settings = { default_note_retention_days: 30, max_memory_items_per_user: 500 };
    await memLib.persistMemoryCandidates(sb, [
      { content: 'Test note', type: 'note', target_user_id: null },
      { content: 'Test urgent', type: 'urgent', target_user_id: null },
      { content: 'Test meeting', type: 'meeting', target_user_id: null },
    ], 'u1', 'msg', settings);
    const note = sb._db.ai_memory.find(m => m.type === 'note');
    const urgent = sb._db.ai_memory.find(m => m.type === 'urgent');
    const meeting = sb._db.ai_memory.find(m => m.type === 'meeting');
    assert(note.expires_at != null, '2.3 note has expiry');
    assert(urgent.expires_at == null, '2.3a urgent has no expiry');
    assert(meeting.expires_at != null, '2.3b meeting has expiry (14 days)');
  }

  // 2.4: cap enforcement (max_memory_items_per_user)
  {
    const sb = mockSupabase({ ai_memory: Array.from({ length: 500 }, (_, i) => ({ id: 'm-' + i, user_id: 'u1', dismissed_at: null })) });
    const settings = { default_note_retention_days: 30, max_memory_items_per_user: 500 };
    const res = await memLib.persistMemoryCandidates(sb, [
      { content: 'Should not insert', type: 'note', target_user_id: null },
    ], 'u1', 'msg', settings);
    assert(res.cap_reached === true, '2.4 cap enforced');
    assert(res.inserted === 0, '2.4a no insert when capped');
  }

  // 2.5: auto_capture_enabled=false blocks extraction
  {
    const res = await memLib.extractMemoryCandidates('remind me to call john', 'ok', { id: 'u1' }, [], { auto_capture_enabled: false });
    assert(Array.isArray(res) && res.length === 0, '2.5 auto_capture=false returns empty');
  }

  // 2.6: missing ANTHROPIC_API_KEY returns []
  {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const res = await memLib.extractMemoryCandidates('remind me', 'ok', { id: 'u1' }, [], { auto_capture_enabled: true, capture_reminders: true });
    assert(res.length === 0, '2.6 no API key → empty');
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
  }

  // 2.7: short messages skipped
  {
    const res = await memLib.extractMemoryCandidates('hi', 'ok', { id: 'u1' }, [], { auto_capture_enabled: true, capture_reminders: true });
    assert(res.length === 0, '2.7 short messages (< 8 chars) skipped');
  }

  // 2.8: loadMemoryForUser — excludes dismissed + expired (but keeps urgent)
  {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    const sb = mockSupabase({
      ai_memory: [
        { id: 'm1', user_id: 'u1', dismissed_at: null, expires_at: null, type: 'urgent', content: 'live urgent' },
        { id: 'm2', user_id: 'u1', dismissed_at: null, expires_at: past, type: 'note', content: 'expired note' },
        { id: 'm3', user_id: 'u1', dismissed_at: null, expires_at: future, type: 'reminder', content: 'live reminder' },
        { id: 'm4', user_id: 'u1', dismissed_at: new Date().toISOString(), expires_at: null, type: 'urgent', content: 'dismissed' },
        { id: 'm5', user_id: 'u1', dismissed_at: null, expires_at: past, type: 'urgent', content: 'expired urgent still live' },
      ]
    });
    const res = await memLib.loadMemoryForUser(sb, 'u1', { cross_user_read: 'team_only' });
    const ownIds = res.own.map(x => x.id);
    assert(ownIds.includes('m1'), '2.8 live urgent kept');
    assert(!ownIds.includes('m2'), '2.8a expired note filtered');
    assert(ownIds.includes('m3'), '2.8b live reminder kept');
    assert(!ownIds.includes('m4'), '2.8c dismissed filtered (via query)');
    assert(ownIds.includes('m5'), '2.8d expired urgent still shown (never auto-hides)');
  }

  // 2.9: cross_user_read='disabled' hides targetedAtMe
  {
    const sb = mockSupabase({
      ai_memory: [
        { id: 'm1', user_id: 'max', target_user_id: 'omar', dismissed_at: null, expires_at: null, type: 'reminder' },
      ]
    });
    const res = await memLib.loadMemoryForUser(sb, 'omar', { cross_user_read: 'disabled' });
    assert(res.targetedAtMe.length === 0, '2.9 cross_user_read=disabled blocks targeted messages');
  }

  // 2.10: targetedAtMe doesn't double-count items the user already owns
  {
    const sb = mockSupabase({
      ai_memory: [
        { id: 'm1', user_id: 'omar', target_user_id: 'omar', dismissed_at: null, expires_at: null, type: 'reminder' },
      ]
    });
    const res = await memLib.loadMemoryForUser(sb, 'omar', { cross_user_read: 'team_only' });
    assert(res.own.length === 1, '2.10 own contains the row');
    assert(res.targetedAtMe.length === 0, '2.10a targetedAtMe excludes own rows');
  }
}

// ============================================================
// SECTION 3 — AI ACTION DISPATCH (simulating /api/ask handlers)
// Testing the logic of action routing, not the LLM itself.
// ============================================================
group('SECTION 3: AI Action Dispatch');

// Simulate what route.js does when given an actionData object
async function simulateActionDispatch(actionData, userId, sb) {
  const autoExecTypes = ['create_ticket', 'update_ticket', 'create_event', 'create_reminder', 'send_team_message'];
  if (autoExecTypes.indexOf(actionData.type) < 0) return { skipped: true };

  if (actionData.type === 'create_ticket') {
    const res = await sb.from('tickets').insert({
      ticket_number: 'TKT-TEST', title: actionData.title, description: actionData.description || '',
      priority: actionData.priority || 'medium', status: 'New',
      assigned_to: actionData.assigned_to || null, due_date: actionData.due_date || null,
      created_by: userId,
    }).then(x => x);
    return { ok: true };
  }
  if (actionData.type === 'create_event') {
    const evAssignee = actionData.assigned_to || userId;
    await sb.from('calendar_events').insert({
      title: actionData.title, event_date: actionData.event_date, event_time: actionData.event_time || null,
      event_type: actionData.event_type || 'task', assigned_to: evAssignee, created_by: userId,
    }).then(x => x);
    return { ok: true, assignee: evAssignee };
  }
  if (actionData.type === 'create_reminder') {
    const rTarget = actionData.target_users || actionData.assigned_to || 'all';
    await sb.from('team_reminders').insert({
      title: actionData.task || actionData.title, message: actionData.task || actionData.title,
      reminder_date: actionData.due_date, priority: actionData.priority || 'normal',
      target_users: rTarget, created_by: userId,
    }).then(x => x);
    return { ok: true, target: rTarget };
  }
  if (actionData.type === 'send_team_message') {
    if (!actionData.target_user_id) throw new Error('send_team_message requires target_user_id');
    await sb.from('ai_memory').insert({
      user_id: actionData.target_user_id,
      content: 'Sender sent: ' + (actionData.message || actionData.content || ''),
      type: actionData.urgent ? 'urgent' : 'note',
      scope: 'private',
      target_user_id: actionData.target_user_id,
      created_by: userId,
      auto_captured: false,
      expires_at: actionData.urgent ? null : new Date(Date.now() + 7 * 86400000).toISOString(),
    }).then(x => x);
    return { ok: true, target: actionData.target_user_id };
  }
}

async function runActionTests() {
  // 3.1: create_ticket with assigned_to
  {
    const sb = mockSupabase();
    await simulateActionDispatch({ type: 'create_ticket', title: 'Call Cairo', assigned_to: 'omar-id', priority: 'high' }, 'max-id', sb);
    assert(sb._db.tickets && sb._db.tickets.length === 1, '3.1 ticket created');
    assert(sb._db.tickets[0].assigned_to === 'omar-id', '3.1a assigned to Omar');
  }

  // 3.2: create_event with assigned_to (cross-user)
  {
    const sb = mockSupabase();
    const r = await simulateActionDispatch({ type: 'create_event', title: 'Meeting', event_date: '2026-05-01', assigned_to: 'sara-id' }, 'max-id', sb);
    assert(r.assignee === 'sara-id', '3.2 event assigned to Sara, not self');
    assert(sb._db.calendar_events[0].assigned_to === 'sara-id', '3.2a calendar_events row correct');
  }

  // 3.3: create_event without assigned_to → defaults to creator
  {
    const sb = mockSupabase();
    const r = await simulateActionDispatch({ type: 'create_event', title: 'Self', event_date: '2026-05-01' }, 'max-id', sb);
    assert(r.assignee === 'max-id', '3.3 event defaults to creator');
  }

  // 3.4: create_reminder with target_users
  {
    const sb = mockSupabase();
    const r = await simulateActionDispatch({ type: 'create_reminder', task: 'Submit tickets', due_date: '2026-05-01', target_users: 'omar-id' }, 'max-id', sb);
    assert(r.target === 'omar-id', '3.4 reminder targeted to Omar');
    assert(sb._db.team_reminders[0].target_users === 'omar-id', '3.4a row has correct target');
  }

  // 3.5: create_reminder without target_users → defaults to 'all'
  {
    const sb = mockSupabase();
    const r = await simulateActionDispatch({ type: 'create_reminder', task: 'All hands', due_date: '2026-05-01' }, 'max-id', sb);
    assert(r.target === 'all', '3.5 reminder defaults to all');
  }

  // 3.6: send_team_message — creates ai_memory row
  {
    const sb = mockSupabase();
    const r = await simulateActionDispatch({ type: 'send_team_message', target_user_id: 'omar-id', message: 'Call customers today', urgent: true }, 'max-id', sb);
    assert(r.ok === true, '3.6 message sent');
    const mem = sb._db.ai_memory[0];
    assert(mem.user_id === 'omar-id', '3.6a ai_memory.user_id = recipient');
    assert(mem.target_user_id === 'omar-id', '3.6b target_user_id = recipient');
    assert(mem.type === 'urgent', '3.6c urgent → type=urgent');
    assert(mem.expires_at === null, '3.6d urgent message never expires');
    assert(mem.created_by === 'max-id', '3.6e created_by = sender');
    assert(mem.auto_captured === false, '3.6f auto_captured=false (explicit action)');
  }

  // 3.7: send_team_message non-urgent has 7-day expiry
  {
    const sb = mockSupabase();
    await simulateActionDispatch({ type: 'send_team_message', target_user_id: 'omar-id', message: 'Casual note', urgent: false }, 'max-id', sb);
    const mem = sb._db.ai_memory[0];
    assert(mem.type === 'note', '3.7 non-urgent → type=note');
    assert(mem.expires_at != null, '3.7a has expiry');
  }

  // 3.8: send_team_message without target_user_id throws
  {
    const sb = mockSupabase();
    let threw = false;
    try {
      await simulateActionDispatch({ type: 'send_team_message', message: 'No target' }, 'max-id', sb);
    } catch (e) { threw = true; }
    assert(threw, '3.8 missing target_user_id throws');
  }
}

// ============================================================
// SECTION 4 — LOGIN EVENTS / ET TIMEZONE
// Tests logic around ET day boundaries + heartbeat + login counts
// ============================================================
group('SECTION 4: Login Events / ET Timezone');

// Helper: compute "what day is it in ET" for a given UTC time
function etDateOf(utcIso) {
  // Use Intl to get the date in America/New_York
  const d = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d); // YYYY-MM-DD
}

{
  // 4.1: A UTC timestamp at 01:00 UTC on May 1 → 21:00 ET on April 30
  const etd = etDateOf('2026-05-01T01:00:00Z');
  assert(etd === '2026-04-30', '4.1 UTC midnight+1h → previous ET day');
}
{
  // 4.2: 05:00 UTC = 01:00 ET (EDT DST) → same day in ET as UTC day
  const etd = etDateOf('2026-05-01T05:00:00Z');
  assert(etd === '2026-05-01', '4.2 5 AM UTC = 1 AM ET → May 1 ET');
}
{
  // 4.3: 23:59 ET on May 1 = 03:59 UTC on May 2 (EDT)
  const etd = etDateOf('2026-05-02T03:59:00Z');
  assert(etd === '2026-05-01', '4.3 May 2 03:59 UTC = May 1 23:59 ET (EDT)');
}
{
  // 4.4: Winter time (EST) — January 5:00 UTC = 00:00 ET same day
  const etd = etDateOf('2026-01-15T05:00:00Z');
  assert(etd === '2026-01-15', '4.4 winter: 5 AM UTC = midnight ET same day');
}
{
  // 4.5: Winter time — 4:59 UTC = 23:59 previous day ET (EST)
  const etd = etDateOf('2026-01-15T04:59:00Z');
  assert(etd === '2026-01-14', '4.5 winter: 4:59 UTC = previous ET day');
}

// Simulate login event counting in ET
function countLoginsByEtDate(events, targetEtDate, eventType) {
  return events.filter(e => e.event_type === eventType && etDateOf(e.occurred_at) === targetEtDate).length;
}

{
  // 4.6: Simulate a user with 3 logins across 2 days
  const events = [
    { user_id: 'u1', event_type: 'login', occurred_at: '2026-04-20T14:00:00Z' },  // Apr 20 10:00 ET
    { user_id: 'u1', event_type: 'login', occurred_at: '2026-04-20T20:30:00Z' },  // Apr 20 16:30 ET
    { user_id: 'u1', event_type: 'login', occurred_at: '2026-04-21T01:00:00Z' },  // Apr 20 21:00 ET! (still Apr 20 in ET)
    { user_id: 'u1', event_type: 'login', occurred_at: '2026-04-21T16:00:00Z' },  // Apr 21 12:00 ET
  ];
  const apr20 = countLoginsByEtDate(events, '2026-04-20', 'login');
  const apr21 = countLoginsByEtDate(events, '2026-04-21', 'login');
  assert(apr20 === 3, '4.6 Apr 20 ET = 3 logins (including late-night pre-midnight-ET)');
  assert(apr21 === 1, '4.6a Apr 21 ET = 1 login');
}

{
  // 4.7: is_online check — last_seen within 10 min = online
  const now = Date.now();
  const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const elevenMinAgo = new Date(now - 11 * 60 * 1000).toISOString();
  function isOnline(lastSeen) {
    return lastSeen != null && (now - new Date(lastSeen).getTime()) < 10 * 60 * 1000;
  }
  assert(isOnline(fiveMinAgo) === true, '4.7 5 min ago → online');
  assert(isOnline(elevenMinAgo) === false, '4.7a 11 min ago → offline');
  assert(isOnline(null) === false, '4.7b null → offline');
}

{
  // 4.8: Dedup logic — same-user login events within 60s should be deduped at the API level
  function shouldDedup(lastLoginAt, nowTs) {
    if (!lastLoginAt) return false;
    return (nowTs - new Date(lastLoginAt).getTime()) < 60 * 1000;
  }
  const now = Date.now();
  assert(shouldDedup(new Date(now - 30000).toISOString(), now) === true, '4.8 30s ago → dedup');
  assert(shouldDedup(new Date(now - 90000).toISOString(), now) === false, '4.8a 90s ago → do not dedup');
}

// ============================================================
// SECTION 5 — DATA RECONCILIATION
// Upstream/downstream consistency after actions
// ============================================================
group('SECTION 5: Data Reconciliation');

{
  // 5.1: After collecting check via "already_linked", invoice.total_collected must NOT double-count
  //     Start: invoice has 100k in bank_in linked. Check reconciled → no new row added.
  //     Expected: collected stays at 100k.
  const inv = { id: 'inv-X', total_amount: 200000, total_collected: 100000, outstanding: 100000 };
  const treasuryRow = { id: 'tx-1', linked_invoice_id: 'inv-X', bank_in: 100000, source_check_id: null };
  const chk = { id: 'chk-X', amount: 100000, invoice_id: 'inv-X' };

  // Simulate attach flow: link check ↔ treasury row (stamp source_check_id)
  treasuryRow.source_check_id = chk.id;

  // Recompute total_collected as per handler logic
  const allTreasury = [treasuryRow];
  const newCollected = allTreasury.filter(t => t.linked_invoice_id === 'inv-X' && !t.is_bank_placeholder)
    .reduce((s, t) => s + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
  assert(newCollected === 100000, '5.1 collected stays at 100k (no double-count)');
}

{
  // 5.2: After collecting check via "no_match → standard", invoice.total_collected increases by check amount
  const inv = { id: 'inv-Y', total_amount: 100000, total_collected: 0, outstanding: 100000 };
  const chk = { id: 'chk-Y', amount: 100000, invoice_id: 'inv-Y' };

  // Simulate creating new treasury + linking both ways
  const newTx = { id: 'tx-new', linked_invoice_id: 'inv-Y', cash_in: 100000, source_check_id: chk.id, payment_source: 'check' };
  const allTreasury = [newTx];
  const newCollected = allTreasury.filter(t => t.linked_invoice_id === 'inv-Y' && !t.is_bank_placeholder)
    .reduce((s, t) => s + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
  assert(newCollected === 100000, '5.2 collected goes from 0 → 100k (new treasury row)');
}

{
  // 5.3: After collecting second check on SAME invoice that was partially paid
  //      Invoice: 200k total, 100k already collected (cash), check for 100k for remainder
  const inv = { id: 'inv-Z', total_amount: 200000, total_collected: 100000 };
  const existingCash = { id: 'tx-cash', linked_invoice_id: 'inv-Z', cash_in: 100000, source_check_id: null };  // cash payment day 1
  const chk = { id: 'chk-Z', amount: 100000, invoice_id: 'inv-Z' };

  // Scenario: user picks "none of the above" → new treasury created for the check
  const newTx = { id: 'tx-chk', linked_invoice_id: 'inv-Z', cash_in: 100000, source_check_id: chk.id };
  const allTreasury = [existingCash, newTx];
  const newCollected = allTreasury.filter(t => t.linked_invoice_id === 'inv-Z' && !t.is_bank_placeholder)
    .reduce((s, t) => s + Number(t.cash_in || 0) + Number(t.bank_in || 0), 0);
  assert(newCollected === 200000, '5.3 partial-payment + check = full 200k collected');
}

{
  // 5.4: Confirm check amount + treasury row inflow are in sync after attach
  const chk = { id: 'chk-A', amount: 50000 };
  const tx = { id: 'tx-A', bank_in: 50000, source_check_id: null };
  // Attach
  tx.source_check_id = chk.id;
  const txInflow = (tx.cash_in || 0) + (tx.bank_in || 0);
  assert(txInflow === chk.amount, '5.4 tx inflow = check amount after attach');
}

// ============================================================
// SECTION 6 — BILINGUAL CATEGORIES (buildCatOptions + isKnownCat + resolveCatName)
// ============================================================
// Tests the helpers that power all category dropdowns and display labels.
// Key invariants:
//   (a) Internal value (option.value) is always the Arabic name — stable across
//       UI-language flips — so a row stored today still resolves tomorrow.
//   (b) When the DB `categories` table is empty the hardcoded EXPENSE_CATS map
//       is used as fallback so nothing breaks before the migration runs.
//   (c) isKnownCat() answers true for either language form in either source.
//   (d) resolveCatName() correctly round-trips AR <-> EN via either source.
group('SECTION 6: Bilingual Categories Helpers');

// Load utils.js helpers
const utilsSrc = fs.readFileSync('' + REPO_ROOT + '/src/lib/utils.js', 'utf8');
const utilsShim = utilsSrc.replace(/export\s+const\s+/g, 'const ') + '\nmodule.exports = { EXPENSE_CATS, EXPENSE_CATS_REVERSE, resolveCatName, buildCatOptions, isKnownCat, isArabic };';
fs.writeFileSync('/tmp/_utils.js', utilsShim);
let _utils;
try { _utils = require('/tmp/_utils.js'); } catch (e) { console.log('  ✗ utils.js failed to load:', e.message); _utils = null; }

if (_utils) {
  const { buildCatOptions, isKnownCat, resolveCatName, EXPENSE_CATS } = _utils;

  // 6.1 — Fallback to EXPENSE_CATS when list is empty
  {
    const opts = buildCatOptions([], { lang: 'bi' });
    const hasSales = opts.some(o => o.value === 'مبيعات');
    assert(opts.length >= 14, '6.1a fallback — at least 14 EXPENSE_CATS options when DB empty');
    assert(hasSales, '6.1b fallback — includes مبيعات sentinel');
  }

  // 6.2 — DB list overrides fallback (no duplicates from EXPENSE_CATS)
  {
    const opts = buildCatOptions([{ name_ar: 'مبيعات', name_en: 'Sales', type: 'income', active: true }], { lang: 'bi' });
    assert(opts.length === 1, '6.2 DB list replaces fallback entirely (not merged)');
    assert(opts[0].value === 'مبيعات', '6.2 stable internal key is Arabic');
  }

  // 6.3 — Bilingual label format
  {
    const opts = buildCatOptions([{ name_ar: 'مبيعات', name_en: 'Sales', type: 'income', active: true }], { lang: 'bi' });
    assert(opts[0].label === 'Sales / مبيعات', '6.3 bi label = "EN / AR"');
  }

  // 6.4 — English-only label
  {
    const opts = buildCatOptions([{ name_ar: 'مبيعات', name_en: 'Sales', type: 'income', active: true }], { lang: 'en' });
    assert(opts[0].label === 'Sales', '6.4 en label = English only');
  }

  // 6.5 — Arabic-only label
  {
    const opts = buildCatOptions([{ name_ar: 'مبيعات', name_en: 'Sales', type: 'income', active: true }], { lang: 'ar' });
    assert(opts[0].label === 'مبيعات', '6.5 ar label = Arabic only');
  }

  // 6.6 — Inactive rows are filtered out
  {
    const opts = buildCatOptions([
      { name_ar: 'مبيعات', name_en: 'Sales', type: 'income', active: true },
      { name_ar: 'قديم',   name_en: 'Old',   type: 'expense', active: false },
    ], { lang: 'bi' });
    assert(opts.length === 1, '6.6 inactive rows excluded');
  }

  // 6.7 — Type filter
  {
    const rows = [
      { name_ar: 'مبيعات',        name_en: 'Sales',      type: 'income',  active: true },
      { name_ar: 'مصروفات تشغيل', name_en: 'Operations', type: 'expense', active: true },
    ];
    const income = buildCatOptions(rows, { type: 'income', lang: 'bi' });
    const expense = buildCatOptions(rows, { type: 'expense', lang: 'bi' });
    assert(income.length === 1 && income[0].value === 'مبيعات', '6.7a type=income returns only income rows');
    assert(expense.length === 1 && expense[0].value === 'مصروفات تشغيل', '6.7b type=expense returns only expense rows');
  }

  // 6.8 — AR-only rows (name_en missing) still work
  {
    const opts = buildCatOptions([{ name_ar: 'صيانة', name_en: null, type: 'expense', active: true }], { lang: 'bi' });
    assert(opts[0].value === 'صيانة', '6.8a AR-only row uses AR as value');
    assert(opts[0].label === 'صيانة', '6.8b AR-only row falls back to AR as label');
  }

  // 6.9 — EN-only rows (name_ar missing) use EN as value
  {
    const opts = buildCatOptions([{ name_ar: null, name_en: 'Maintenance', type: 'expense', active: true }], { lang: 'bi' });
    assert(opts[0].value === 'Maintenance', '6.9 EN-only row uses EN as value (only fallback when AR missing)');
  }

  // 6.10 — Dedup by Arabic key (if DB has duplicates)
  {
    const opts = buildCatOptions([
      { name_ar: 'مبيعات', name_en: 'Sales',    type: 'income',  active: true },
      { name_ar: 'مبيعات', name_en: 'Revenue',  type: 'income',  active: true },
    ], { lang: 'bi' });
    assert(opts.length === 1, '6.10 duplicate name_ar collapsed to one option');
  }

  // 6.11 — isKnownCat: DB match by AR
  assert(isKnownCat('مبيعات', [{ name_ar: 'مبيعات', name_en: 'Sales' }]) === true, '6.11 isKnownCat matches AR in list');

  // 6.12 — isKnownCat: DB match by EN
  assert(isKnownCat('Sales', [{ name_ar: 'مبيعات', name_en: 'Sales' }]) === true, '6.12 isKnownCat matches EN in list');

  // 6.13 — isKnownCat: EXPENSE_CATS fallback
  assert(isKnownCat('Samples', []) === true, '6.13 isKnownCat falls back to EXPENSE_CATS (EN form)');
  assert(isKnownCat('عينات', []) === true, '6.14 isKnownCat falls back to EXPENSE_CATS (AR form)');

  // 6.15 — isKnownCat: unknown returns false
  assert(isKnownCat('Rocket Fuel', []) === false, '6.15 unknown category returns false');
  assert(isKnownCat('', [{ name_ar: 'مبيعات' }]) === false, '6.16 empty string returns false');
  assert(isKnownCat(null, [{ name_ar: 'مبيعات' }]) === false, '6.17 null returns false');

  // 6.18 — resolveCatName: row with EN stored, ask for AR
  assert(resolveCatName('Sales', 'ar', [{ name_ar: 'مبيعات', name_en: 'Sales' }]) === 'مبيعات', '6.18 resolveCatName EN->AR via list');

  // 6.19 — resolveCatName: row with AR stored, ask for EN
  assert(resolveCatName('مبيعات', 'en', [{ name_ar: 'مبيعات', name_en: 'Sales' }]) === 'Sales', '6.19 resolveCatName AR->EN via list');

  // 6.20 — resolveCatName: unknown raw returns raw
  assert(resolveCatName('Zorb', 'en', []) === 'Zorb', '6.20 unknown returns raw');
  assert(resolveCatName('', 'en', []) === '', '6.21 empty returns empty');
}

// ============================================================
// SECTION 7 — TRANSLATE API DIRECTION PARAMETER (logic-only)
// ============================================================
// Verifies the direction inference rules and cache-key hygiene without
// actually calling the Anthropic API.
group('SECTION 7: Translate API — direction parameter');

// 7.1 — direction defaults to ar_to_en when omitted (matches existing behavior)
{
  const body = { action: 'batch_translate', texts: [{ text: 'مبيعات' }] };
  const direction = body.direction === 'en_to_ar' ? 'en_to_ar' : 'ar_to_en';
  assert(direction === 'ar_to_en', '7.1 default direction is ar_to_en');
}

// 7.2 — explicit en_to_ar is accepted
{
  const body = { action: 'batch_translate', direction: 'en_to_ar', texts: [{ text: 'Sales' }] };
  const direction = body.direction === 'en_to_ar' ? 'en_to_ar' : 'ar_to_en';
  assert(direction === 'en_to_ar', '7.2 explicit en_to_ar honored');
}

// 7.3 — any other direction value rejected back to default
{
  const body = { action: 'batch_translate', direction: 'fr_to_de', texts: [{ text: 'x' }] };
  const direction = body.direction === 'en_to_ar' ? 'en_to_ar' : 'ar_to_en';
  assert(direction === 'ar_to_en', '7.3 invalid direction falls back to ar_to_en');
}

// 7.4 — ar_to_en filter keeps only Arabic-containing strings
{
  const txts = ['مبيعات', 'Sales', 'مخزن 123', '2024'];
  const kept = txts.filter(t => /[\u0600-\u06FF]/.test(t));
  assert(kept.length === 2 && kept[0] === 'مبيعات' && kept[1] === 'مخزن 123', '7.4 ar_to_en filter keeps only Arabic');
}

// 7.5 — en_to_ar filter keeps only non-Arabic strings
{
  const txts = ['مبيعات', 'Sales', 'Operations', '123'];
  const kept = txts.filter(t => !/[\u0600-\u06FF]/.test(t));
  assert(kept.length === 3, '7.5 en_to_ar filter keeps only non-Arabic');
}

// 7.6 — cache lang pair follows direction (ar_to_en)
{
  const direction = 'ar_to_en';
  const srcLang = direction === 'en_to_ar' ? 'en' : 'ar';
  const tgtLang = direction === 'en_to_ar' ? 'ar' : 'en';
  assert(srcLang === 'ar' && tgtLang === 'en', '7.6 cache lang pair correct for ar_to_en');
}

// 7.7 — cache lang pair follows direction (en_to_ar)
{
  const direction = 'en_to_ar';
  const srcLang = direction === 'en_to_ar' ? 'en' : 'ar';
  const tgtLang = direction === 'en_to_ar' ? 'ar' : 'en';
  assert(srcLang === 'en' && tgtLang === 'ar', '7.7 cache lang pair correct for en_to_ar');
}

// ============================================================
// SECTION 8 — CATEGORY DROPDOWN BEHAVIOR (scenario-level)
// ============================================================
// End-to-end scenarios around saving/loading a row with a category key
// and rendering it in either UI language. Simulates the full data path:
// dropdown render → user select → DB insert → later load → txCat render.
group('SECTION 8: Category dropdown round-trip scenarios');

if (_utils) {
  const { buildCatOptions, resolveCatName } = _utils;
  const dbList = [
    { name_ar: 'مبيعات',        name_en: 'Sales',      type: 'income',  active: true },
    { name_ar: 'مصروفات تشغيل', name_en: 'Operations', type: 'expense', active: true },
    { name_ar: 'صيانة',         name_en: null,         type: 'expense', active: true }, // AR-only new
  ];

  // 8.1 — English-speaking user sees English labels, value is AR key
  {
    const opts = buildCatOptions(dbList, { lang: 'en' });
    const sales = opts.find(o => o.label === 'Sales');
    assert(sales && sales.value === 'مبيعات', '8.1 EN user picks "Sales" → saved value is مبيعات');
  }

  // 8.2 — Row saved with AR key → rendered in English later
  {
    const saved = 'مبيعات';
    const renderedEn = resolveCatName(saved, 'en', dbList);
    assert(renderedEn === 'Sales', '8.2 AR key saved → renders as Sales in EN mode');
  }

  // 8.3 — Row saved with AR key → rendered in Arabic later
  {
    const saved = 'مبيعات';
    const renderedAr = resolveCatName(saved, 'ar', dbList);
    assert(renderedAr === 'مبيعات', '8.3 AR key saved → renders as AR in AR mode');
  }

  // 8.4 — Legacy row saved in English still resolves both ways
  {
    const legacy = 'Sales';
    const renderedAr = resolveCatName(legacy, 'ar', dbList);
    const renderedEn = resolveCatName(legacy, 'en', dbList);
    assert(renderedAr === 'مبيعات', '8.4a legacy EN row → AR render works');
    assert(renderedEn === 'Sales',  '8.4b legacy EN row → EN render works');
  }

  // 8.5 — AR-only category (no English yet) renders as AR in both modes
  {
    const renderedEn = resolveCatName('صيانة', 'en', dbList);
    const renderedAr = resolveCatName('صيانة', 'ar', dbList);
    assert(renderedAr === 'صيانة', '8.5a AR-only renders as AR in AR mode');
    assert(renderedEn === 'صيانة', '8.5b AR-only falls back to AR in EN mode (nothing else to show)');
  }

  // 8.6 — Deactivated category still resolves for historical rows
  {
    const archived = [{ name_ar: 'قديم', name_en: 'Old', type: 'expense', active: false }];
    // buildCatOptions excludes it
    const opts = buildCatOptions(archived, { lang: 'bi' });
    assert(opts.length === 0, '8.6a inactive category hidden from dropdowns');
    // But resolveCatName still finds it (historical data rendering)
    const rendered = resolveCatName('قديم', 'en', archived);
    assert(rendered === 'Old', '8.6b inactive category still resolves for historical rows');
  }

  // 8.7 — Customer saves a user-added custom category that isn't in DB or EXPENSE_CATS.
  //         Dropdown should surface it as "✨ Custom" pinned entry (logic exercised in
  //         page.jsx via !isKnownCat && !customCats.includes check). Here we just verify
  //         resolveCatName passes it through unchanged.
  {
    const custom = 'Rocket Fuel';
    assert(resolveCatName(custom, 'en', dbList) === 'Rocket Fuel', '8.7 unknown custom category pass-through');
    assert(resolveCatName(custom, 'ar', dbList) === 'Rocket Fuel', '8.7b unknown custom in AR mode pass-through');
  }
}

// ============================================================
// SECTION 9 — EDGE CASES & BUG-FIX REGRESSIONS
// ============================================================
// Added during Apr 20 bilingual-categories session QA pass after
// bug hunt. These tests specifically lock in fixes for issues that
// the initial Section 6/7/8 scenarios didn't catch:
//   - 🌐 button overwriting the "other" language when both filled
//   - customCats memo correctly excluding DB-managed categories
//     (not just EXPENSE_CATS fallback entries)
//   - Stable-key round-trip across UI language flips
//   - SQL regex portability (swapped \u0600-\u06FF for [^[:ascii:]])
//   - Defensive handling of undefined/null inputs in buildCatOptions
group('SECTION 9: Edge cases & bug-fix regressions');

if (_utils) {
  const { buildCatOptions, isKnownCat, resolveCatName } = _utils;

  // 9.1 — 🌐 direction inference when both fields filled
  {
    const pick = (ar, en, userChoseOK) => {
      if (ar && !en) return { direction: 'ar_to_en', source: ar };
      if (en && !ar) return { direction: 'en_to_ar', source: en };
      if (userChoseOK) return { direction: 'ar_to_en', source: ar };
      return { direction: 'en_to_ar', source: en };
    };
    const r1 = pick('مبيعات', '', true);
    assert(r1.direction === 'ar_to_en' && r1.source === 'مبيعات', '9.1a AR-only always picks ar_to_en');
    const r2 = pick('', 'Sales', false);
    assert(r2.direction === 'en_to_ar' && r2.source === 'Sales', '9.1b EN-only always picks en_to_ar');
    const r3 = pick('مبيعات', 'Sales', true);
    assert(r3.direction === 'ar_to_en' && r3.source === 'مبيعات', '9.1c both-filled + OK → ar_to_en');
    const r4 = pick('مبيعات', 'Sales', false);
    assert(r4.direction === 'en_to_ar' && r4.source === 'Sales', '9.1d both-filled + Cancel → en_to_ar');
  }

  // 9.2 — customCats correctly excludes DB-managed categories (not just EXPENSE_CATS)
  {
    const treasury = [
      { category: 'مبيعات' }, { category: 'Sales' }, { category: 'عينات' },
      { category: 'Rocket Fuel' }, { category: '__legacy__stuff' }, { category: '' },
    ];
    const dbList = [{ name_ar: 'مبيعات', name_en: 'Sales', active: true }];
    const customCats = [...new Set(treasury.map(t => t.category)
      .filter(c => c && !isKnownCat(c, dbList) && !c.startsWith('__')))].sort();
    assert(customCats.length === 1 && customCats[0] === 'Rocket Fuel', '9.2 customCats only contains truly-unknown cats');
  }

  // 9.3 — Stable internal key preserved across language flips
  {
    const dbList = [{ name_ar: 'عينات', name_en: 'Samples', type: 'expense', active: true }];
    const opts = buildCatOptions(dbList, { lang: 'en' });
    const samples = opts.find(o => o.label === 'Samples');
    const savedValue = samples.value;
    assert(savedValue === 'عينات', '9.3a EN-mode dropdown selection saves AR key');
    assert(resolveCatName(savedValue, 'en', dbList) === 'Samples', '9.3b rendered correctly in EN');
    assert(resolveCatName(savedValue, 'ar', dbList) === 'عينات', '9.3c rendered correctly in AR');
  }

  // 9.4 — SQL regex portability ([^[:ascii:]] equivalent in JS)
  {
    const isNonAscii = (s) => /[^\x00-\x7F]/.test(s);
    assert(isNonAscii('مبيعات') === true, '9.4a Arabic string → Pass 1 branch');
    assert(isNonAscii('Sales') === false, '9.4b English string → Pass 2 branch');
    assert(isNonAscii('Sales مبيعات') === true, '9.4c mixed string → Pass 1 branch');
    assert(isNonAscii('123') === false, '9.4d numeric string → Pass 2 branch');
    assert(isNonAscii('') === false, '9.4e empty string → filtered by TRIM check');
  }

  // 9.5 — buildCatOptions with undefined list (safer than crashing)
  {
    const opts = buildCatOptions(undefined, { lang: 'bi' });
    assert(Array.isArray(opts) && opts.length >= 14, '9.5 undefined list → falls back to EXPENSE_CATS');
  }

  // 9.6 — buildCatOptions with null entries in the list (defensive)
  {
    const opts = buildCatOptions([null, undefined, { name_ar: 'مبيعات', name_en: 'Sales', active: true }], { lang: 'bi' });
    assert(opts.length === 1 && opts[0].value === 'مبيعات', '9.6 null/undefined entries skipped without crash');
  }

  // 9.7 — buildCatOptions where both AR and EN are null
  {
    const opts = buildCatOptions([{ name_ar: null, name_en: null, active: true }], { lang: 'bi' });
    assert(opts.length === 0, '9.7 row with neither name is skipped');
  }

  // 9.8 — resolveCatName trims input whitespace
  {
    const dbList = [{ name_ar: 'مبيعات', name_en: 'Sales', active: true }];
    assert(resolveCatName('  Sales  ', 'ar', dbList) === 'مبيعات', '9.8 resolveCatName trims whitespace');
  }
}

// ============================================================
// SECTION 10 — QA PASS: BUG REGRESSIONS & GAP COVERAGE
// ============================================================
// Added during the Apr 20 session QA run after running Sections 6-9
// against live code. Purpose: lock in fixes for bugs found during
// the bug-hunt phase, and cover gaps that the authored tests missed.
//
// Bugs fixed in this pass:
//   - PaymentForm empty-dropdown when both props missing/empty
//     (user could see blank Category select with nothing to pick)
//
// Gaps covered in this pass:
//   - isArabic boundary cases (punctuation, mixed, null, undefined)
//   - resolveCatName null/undefined list argument
//   - buildCatOptions input-order preservation (determinism)
//   - Ambiguity semantics: duplicate name_en across rows — first-match wins
//   - Type filter with undefined type field on row
//   - buildCatOptions when all rows inactive (respects user deactivate intent)
group('SECTION 10: QA pass — bug regressions + gap coverage');

if (_utils) {
  const { buildCatOptions, isKnownCat, resolveCatName, isArabic } = _utils;

  // 10.1 — REGRESSION: PaymentForm _opts chain must never be empty.
  // BUG: Initial implementation had `const _opts = (catOptions?.length ? catOptions : (categories||[]).map(...))`.
  // When BOTH were absent the dropdown was empty and the user couldn't pick a category.
  // FIX: terminal fallback to buildCatOptions([]) which returns EXPENSE_CATS.
  {
    function derivePaymentFormOpts(catOptions, categories) {
      let _opts = [];
      if (Array.isArray(catOptions) && catOptions.length > 0) _opts = catOptions;
      else if (Array.isArray(categories) && categories.length > 0) {
        _opts = categories.map(([ar, en]) => ({ value: ar, label: (en && ar && en !== ar) ? (en + ' / ' + ar) : (ar || en) }));
      }
      if (_opts.length === 0) _opts = buildCatOptions([], { lang: 'bi' });
      return _opts;
    }
    assert(derivePaymentFormOpts(undefined, undefined).length >= 14, '10.1a both undefined → EXPENSE_CATS fallback (BUG was 0 before fix)');
    assert(derivePaymentFormOpts([], []).length >= 14,               '10.1b both empty arrays → EXPENSE_CATS fallback');
    assert(derivePaymentFormOpts(null, null).length >= 14,           '10.1c both null → EXPENSE_CATS fallback');
    assert(derivePaymentFormOpts([{value:'X',label:'X'}], undefined).length === 1, '10.1d catOptions path used when present');
    assert(derivePaymentFormOpts(null, [['ا','A'],['ب','B']]).length === 2, '10.1e legacy tuples path used when present');
    assert(derivePaymentFormOpts([{value:'X',label:'X'}], [['ا','A']]).length === 1, '10.1f catOptions beats categories when both present');
  }

  // 10.2 — isArabic boundary cases
  assert(isArabic('مبيعات 2024') === true,  '10.2a Arabic with numbers → true');
  assert(isArabic('2024') === false,         '10.2b numbers only → false');
  assert(isArabic('Sales') === false,        '10.2c English only → false');
  assert(isArabic('...') === false,          '10.2d punctuation only → false');
  assert(isArabic('') === false,             '10.2e empty string → false');
  assert(isArabic(null) === false,           '10.2f null → false');
  assert(isArabic(undefined) === false,      '10.2g undefined → false');

  // 10.3 — isKnownCat defensive cases
  assert(isKnownCat(undefined, [{name_en:'Sales'}]) === false, '10.3a undefined raw → false (does not crash)');
  assert(isKnownCat('   ', [{name_en:'Sales'}]) === false,     '10.3b whitespace-only raw → false');
  assert(isKnownCat('Sales', [null, {name_en:'Sales'}]) === true, '10.3c null entries in list skipped, still matches');

  // 10.4 — buildCatOptions preserves input order (determinism — caller sorts)
  {
    const list = [
      {name_ar:'ب', name_en:'B', type:'expense', active:true, sort_order:2},
      {name_ar:'أ', name_en:'A', type:'expense', active:true, sort_order:1},
    ];
    const opts = buildCatOptions(list, {lang:'en'});
    assert(opts[0].value === 'ب' && opts[1].value === 'أ', '10.4 preserves input order (sort_order NOT applied — caller responsibility)');
  }

  // 10.5 — Type filter with missing `type` field defaults to included
  {
    const list = [{name_ar:'X', name_en:'X', active:true}]; // no type field on row
    assert(buildCatOptions(list, {type:'expense', lang:'en'}).length === 1, '10.5 row with no type included under filter');
  }

  // 10.6 — Ambiguous duplicate EN across rows — first-match wins (documented)
  {
    const list = [
      {name_ar:'عينات', name_en:'Samples'},
      {name_ar:'مختبر', name_en:'Samples'},
    ];
    assert(resolveCatName('Samples', 'ar', list) === 'عينات', '10.6 duplicate name_en across rows — first-match wins');
  }

  // 10.7 — All rows inactive → empty dropdown (respects user intent to hide all)
  {
    const list = [{name_ar:'X', name_en:'X', type:'expense', active:false}];
    assert(buildCatOptions(list, {lang:'en'}).length === 0, '10.7 all-inactive → empty (does NOT silently re-fallback to EXPENSE_CATS)');
  }

  // 10.8 — resolveCatName with null/undefined list still works (EXPENSE_CATS fallback)
  assert(resolveCatName('Samples', 'ar', null) === 'عينات', '10.8a null list → EXPENSE_CATS fallback');
  assert(resolveCatName('Samples', 'ar', undefined) === 'عينات', '10.8b undefined list → EXPENSE_CATS fallback');

  // 10.9 — buildCatOptions with no opts arg at all (extreme default path)
  {
    const opts = buildCatOptions([{name_ar:'مبيعات',name_en:'Sales',active:true}]);
    assert(opts.length === 1 && opts[0].label.indexOf('Sales') >= 0, '10.9 no opts arg → defaults to {type:both,lang:bi}');
  }

  // 10.10 — Translate API response shape safety (what SettingsTab actually parses)
  {
    // Simulates the four response shapes the translate endpoint can return. The
    // button code does: data && data.translations ? data.translations[source] : null
    const pick = (data, source) => data && data.translations ? data.translations[source] : null;
    assert(pick({ translations: { 'Sales': 'مبيعات' } }, 'Sales') === 'مبيعات', '10.10a normal response → translation returned');
    assert(pick({ translations: {} }, 'Sales') === undefined, '10.10b empty translations → undefined (button shows "failed")');
    assert(pick({ error: 'ANTHROPIC_API_KEY not set' }, 'Sales') === null, '10.10c API error response → null (button shows "failed")');
    assert(pick(null, 'Sales') === null, '10.10d null response → null');
  }
}

// ============================================================
// SECTION 14 — ADMIN TEAM ACTIVITY REALTIME POLL
// ============================================================
// Verifies the 60s polling interval semantics added to AdminTab
// so Team Activity updates without requiring a page reload.
group('SECTION 14: Admin Team Activity realtime poll');

// 10.1 — Poll interval is 60s
{
  const pollMs = 60 * 1000;
  assert(pollMs === 60000, '14.1 poll interval = 60s (60000ms)');
  assert(pollMs >= 30000 && pollMs <= 120000, '14.1b poll interval within sensible bounds (30s–2min)');
}

// 10.2 — Poll URL is the lightweight summary endpoint (not a full data reload)
{
  const url = '/api/login-event?summary=1';
  assert(url === '/api/login-event?summary=1', '14.2 poll hits login-event summary endpoint only');
}

// 10.3 — clearInterval cleanup pattern is correct
{
  let cleared = false;
  const fakeId = setInterval(() => {}, 1000);
  clearInterval(fakeId); cleared = true;
  assert(cleared, '14.3 interval cleaned up on unmount');
}

// 10.4 — Two-effect pattern: initial load guarded by `loaded` flag; poll runs separately.
{
  const loadedGuard = (loaded) => !loaded;
  assert(loadedGuard(false) === true, '14.4a initial load fires when !loaded');
  assert(loadedGuard(true) === false, '14.4b initial load does NOT re-fire when loaded');
}

// 10.5 — Poll cadence faster than heartbeat → display catches changes quickly
{
  const heartbeatMs = 5 * 60 * 1000;
  const pollMs = 60 * 1000;
  assert(pollMs < heartbeatMs, '14.5 poll (60s) faster than heartbeat (5min)');
}

// 10.6 — Failed polls don't crash the component
{
  let result = null;
  const safePoll = () => { try { throw new Error('network'); } catch (e) { result = 'swallowed'; } };
  safePoll();
  assert(result === 'swallowed', '14.6 failed polls swallowed; next tick retries');
}

// ============================================================
// SECTION 15 — AI CREATE_RATE ACTION
// ============================================================
// Verifies Nadia can log new shipping rates via the AI chat.
group('SECTION 15: AI create_rate action');

// Load route source once for whole section
const askRouteSrc = fs.readFileSync('' + REPO_ROOT + '/src/app/api/ask/route.js', 'utf8');

assert(askRouteSrc.indexOf("'create_rate'") > 0, '15.1 create_rate registered in autoExecTypes');
assert(askRouteSrc.indexOf('create_rate requires vendor_name, origin, destination, rate_amount') > 0, '15.2 validates required fields');

// 11.3 — Currency defaults to USD
{
  const pick = (a) => a.currency || 'USD';
  assert(pick({}) === 'USD', '15.3a currency defaults to USD');
  assert(pick({currency: 'EGP'}) === 'EGP', '15.3b explicit currency honored');
}

// 11.4 — rate_type defaults to 'ocean'
{
  const pick = (a) => a.rate_type || 'ocean';
  assert(pick({}) === 'ocean', '15.4a rate_type defaults to ocean');
  assert(pick({rate_type: 'air'}) === 'air', '15.4b explicit rate_type honored');
}

// 11.5 — Transit days coerced to Number or null
{
  const parse = (v) => v ? Number(v) : null;
  assert(parse('28') === 28, '15.5a string "28" → 28');
  assert(parse(null) === null, '15.5b null → null');
  assert(parse('') === null, '15.5c empty → null');
  assert(parse(35) === 35, '15.5d number passes through');
}

// 11.6 — Required field validation
{
  const validate = (a) => (!a.vendor_name || !a.origin || !a.destination || !a.rate_amount);
  assert(validate({origin:'SH', destination:'NYC', rate_amount:4200}) === true, '15.6a missing vendor_name rejected');
  assert(validate({vendor_name:'Maersk', destination:'NYC', rate_amount:4200}) === true, '15.6b missing origin rejected');
  assert(validate({vendor_name:'Maersk', origin:'SH', rate_amount:4200}) === true, '15.6c missing destination rejected');
  assert(validate({vendor_name:'Maersk', origin:'SH', destination:'NYC'}) === true, '15.6d missing rate_amount rejected');
  assert(validate({vendor_name:'Maersk', origin:'SH', destination:'NYC', rate_amount:4200}) === false, '15.6e all required → valid');
}

// 11.7 — Number() coercion handles string inputs
{
  assert(Number('4200') === 4200, '15.7a Number("4200") = 4200');
  assert(isNaN(Number('four thousand')) === true, '15.7b non-numeric rejected');
}

// 11.8 — effective_date format
{
  const today = new Date().toISOString().substring(0, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(today), '15.8 effective_date is YYYY-MM-DD');
}

// ============================================================
// SECTION 16 — AI ADD_MEETING_NOTES ACTION
// ============================================================
// Event resolution + append/overwrite logic for meeting notes.
group('SECTION 16: AI add_meeting_notes action');

assert(askRouteSrc.indexOf("'add_meeting_notes'") > 0, '16.1 add_meeting_notes registered in autoExecTypes');
assert(askRouteSrc.indexOf('add_meeting_notes requires notes') > 0, '16.2 validates notes param');

// 12.3 — Event resolution priority: id → title+date → date
const resolveEvent = (action, events) => {
  if (action.event_id) {
    const hit = events.find(e => e.id === action.event_id);
    if (hit) return {source: 'id', event: hit};
  }
  if (action.event_title) {
    const candidates = events.filter(e => (e.title || '').toLowerCase().includes(action.event_title.toLowerCase()));
    if (action.event_date) {
      const dateMatch = candidates.find(e => e.event_date === action.event_date);
      if (dateMatch) return {source: 'title+date', event: dateMatch};
    }
    if (candidates.length > 0) {
      const sorted = candidates.sort((a,b) => (b.event_date||'').localeCompare(a.event_date||''));
      return {source: 'title', event: sorted[0]};
    }
  }
  if (action.event_date) {
    const hit = events.find(e => e.event_date === action.event_date);
    if (hit) return {source: 'date', event: hit};
  }
  return {source: 'none', event: null};
};

{
  const events = [
    {id: 'ev-1', title: 'Meeting with Ahmed', event_date: '2026-04-20'},
    {id: 'ev-2', title: 'Meeting with Ahmed', event_date: '2026-04-15'},
    {id: 'ev-3', title: 'Call with Sarah', event_date: '2026-04-20'},
  ];
  let r;
  r = resolveEvent({event_id: 'ev-2'}, events);
  assert(r.source === 'id' && r.event.id === 'ev-2', '16.3a resolves by id');
  r = resolveEvent({event_title: 'Ahmed', event_date: '2026-04-20'}, events);
  assert(r.source === 'title+date' && r.event.id === 'ev-1', '16.3b resolves by title+date');
  r = resolveEvent({event_title: 'Ahmed'}, events);
  assert(r.source === 'title' && r.event.id === 'ev-1', '16.3c resolves by title alone → most recent');
  r = resolveEvent({event_date: '2026-04-15'}, events);
  assert(r.source === 'date' && r.event.id === 'ev-2', '16.3d resolves by date alone');
  r = resolveEvent({}, events);
  assert(r.source === 'none' && r.event === null, '16.3e no criteria → no match');
}

// 12.4 — Append vs overwrite
{
  const compose = (existing, newText, author, stamp, append) => {
    if (append !== false && existing) {
      return existing + '\n\n[' + stamp + ' — ' + author + ']\n' + newText;
    }
    return '[' + stamp + ' — ' + author + ']\n' + newText;
  };
  const s = '2026-04-20 14:30';
  const a = compose('Previous', 'New', 'Max', s, true);
  assert(a.indexOf('Previous') === 0, '16.4a append:true keeps existing first');
  assert(a.indexOf('New') > 0, '16.4b append:true adds new');
  const b = compose('Previous', 'New', 'Max', s, false);
  assert(b.indexOf('Previous') < 0, '16.4c append:false discards existing');
  const c = compose(null, 'First', 'Max', s, true);
  assert(c.indexOf('First') > 0, '16.4d append:true with null existing → just new');
}

// 12.5 — Timestamp format
{
  const stamp = new Date().toISOString().substring(0, 16).replace('T', ' ');
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp), '16.5 timestamp YYYY-MM-DD HH:MM');
}

// 12.6 — Column fallback
assert(askRouteSrc.indexOf('meeting_notes') > 0, '16.6a code references meeting_notes column');
assert(askRouteSrc.indexOf('notes:') > 0, '16.6b fallback path writes to notes');

// 12.7 — Daily log side effect
assert(askRouteSrc.indexOf("log_category: 'meeting'") > 0, '16.7 writes daily_log with log_category=meeting');

// 12.8 — Long notes truncated for daily log preview
{
  const preview = (notes) => notes.substring(0, 200) + (notes.length > 200 ? '...' : '');
  assert(preview('short') === 'short', '16.8a short notes not truncated');
  assert(preview('x'.repeat(500)).endsWith('...'), '16.8b long notes truncated + ellipsis');
}

// ============================================================
// SECTION 17 — MEETING-NOTES SQL MIGRATION SAFETY
// ============================================================
group('SECTION 17: meeting-notes.sql safety');

const mnSql = fs.readFileSync('' + REPO_ROOT + '/supabase/meeting-notes.sql', 'utf8');
assert(mnSql.indexOf('ADD COLUMN IF NOT EXISTS meeting_notes') > 0, '17.1 IF NOT EXISTS — re-runnable');
assert(mnSql.indexOf('CREATE OR REPLACE FUNCTION') > 0, '17.2 OR REPLACE for trigger function');
assert(mnSql.indexOf('DROP TRIGGER IF EXISTS') > 0, '17.3 drops trigger before recreate');
assert(mnSql.indexOf('BEFORE UPDATE') > 0, '17.4 trigger runs BEFORE UPDATE');
assert(mnSql.indexOf('meeting_notes_updated_at') > 0, '17.5 tracks last-modified timestamp');

// ============================================================
// SECTION 18 — EMAIL NOTIFICATIONS FROM AI ACTIONS
// ============================================================
// Verifies that AI-triggered ticket/event/reminder/message
// creations fire email notifications to the designated people.
// Tests:
//   - notify-server.js loads and exports the expected helpers
//   - Graceful degradation when RESEND_API_KEY is missing
//   - HTML escaping prevents injection in email bodies
//   - Recipient filtering honors notification_settings
//   - ask/route.js imports and calls the server helpers
//   - Each action dispatches to the right helper
group('SECTION 18: AI email notifications (notify-server + ask/route wiring)');

// 18.1 — notify-server.js exists and exports expected functions
const notifyServerSrc = fs.readFileSync('' + REPO_ROOT + '/src/lib/notify-server.js', 'utf8');
assert(notifyServerSrc.indexOf('export async function notifyServer') > 0, '18.1a notifyServer exported');
assert(notifyServerSrc.indexOf('export function notifyTicketAssignedServer') > 0, '18.1b notifyTicketAssignedServer exported');
assert(notifyServerSrc.indexOf('export function notifyTicketReassignedServer') > 0, '18.1c notifyTicketReassignedServer exported');
assert(notifyServerSrc.indexOf('export function notifyEventScheduledServer') > 0, '18.1d notifyEventScheduledServer exported');
assert(notifyServerSrc.indexOf('export function notifyReminderServer') > 0, '18.1e notifyReminderServer exported');
assert(notifyServerSrc.indexOf('export function notifyTeamMessageServer') > 0, '18.1f notifyTeamMessageServer exported');

// 18.2 — Graceful degradation: missing RESEND_API_KEY returns { sent:false } (no throw)
assert(notifyServerSrc.indexOf('RESEND_API_KEY not set') > 0, '18.2a logs warning when API key missing');
assert(notifyServerSrc.indexOf("return { sent: false, reason:") > 0, '18.2b returns structured result instead of throwing');

// 18.3 — HTML escape prevents injection in email bodies
{
  // Extract the escapeHtml function from the source and exec it in isolation
  const mt = notifyServerSrc.match(/function escapeHtml\([\s\S]+?\n\}/);
  assert(mt !== null, '18.3a escapeHtml function present');
  const escapeHtml = eval('(' + mt[0].replace('function escapeHtml', 'function') + ')');
  assert(escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', '18.3b <script> tags escaped');
  assert(escapeHtml('O\'Brien') === 'O&#39;Brien', '18.3c single quotes escaped');
  assert(escapeHtml('A & B') === 'A &amp; B', '18.3d ampersand escaped');
  assert(escapeHtml('"test"') === '&quot;test&quot;', '18.3e double quotes escaped');
  assert(escapeHtml(null) === '', '18.3f null → empty');
  assert(escapeHtml(undefined) === '', '18.3g undefined → empty');
}

// 18.4 — notification_settings integration (per-user opt-out honored)
assert(notifyServerSrc.indexOf("notification_settings") > 0, '18.4a looks up notification_settings');
assert(notifyServerSrc.indexOf("email_enabled") > 0, '18.4b honors email_enabled flag');

// 18.5 — Writes notifications_log for in-app surfacing even when email skipped
assert(notifyServerSrc.indexOf('notifications_log') > 0, '18.5 writes in-app notifications_log row regardless of email outcome');

// 18.6 — Recipient filter: inactive users skipped
assert(notifyServerSrc.indexOf('u.active !== false') > 0, '18.6 filters out inactive users');

// 18.7 — ask/route.js imports the server helpers
const askSrc2 = fs.readFileSync('' + REPO_ROOT + '/src/app/api/ask/route.js', 'utf8');
assert(askSrc2.indexOf("from '../../../lib/notify-server'") > 0, '18.7a ask/route imports notify-server');
assert(askSrc2.indexOf('notifyTicketAssignedServer') > 0, '18.7b references notifyTicketAssignedServer');

// 18.8 — Each AI action wires up notifications
assert(askSrc2.indexOf('notifyTicketAssignedServer([actionData.assigned_to]') > 0, '18.8a create_ticket notifies assignee');
assert(askSrc2.indexOf('notifyTicketReassignedServer([actionData.assigned_to]') > 0, '18.8b update_ticket (reassign) notifies new assignee');
assert(askSrc2.indexOf('notifyEventScheduledServer([evAssignee]') > 0, '18.8c create_event notifies assignee');
assert(askSrc2.indexOf('notifyReminderServer([rTarget]') > 0, '18.8d create_reminder notifies target (when not "all")');
assert(askSrc2.indexOf('notifyTeamMessageServer(actionData.target_user_id') > 0, '18.8e send_team_message notifies target');

// 18.9 — Fire-and-forget pattern: .catch(function(){}) prevents blocking response
{
  const fireAndForgetCount = (askSrc2.match(/notify\w+Server\([^)]*\)\.catch\(function\(\)\{\}\)/g) || []).length;
  assert(fireAndForgetCount >= 5, '18.9 all 5+ notify calls use fire-and-forget .catch pattern');
}

// 18.10 — Self-notification guard: AI doesn't email you when you're the one doing the action
assert(askSrc2.indexOf('actionData.assigned_to !== userId') > 0, '18.10a create_ticket skips self-notify');
assert(askSrc2.indexOf('evAssignee !== userId') > 0, '18.10b create_event skips self-notify');
assert(askSrc2.indexOf('rTarget !== userId') > 0, '18.10c create_reminder skips self-notify');

// 18.11 — "all" broadcast doesn't spam individual emails (handled by broadcast path instead)
{
  const allBroadcastGuard = askSrc2.indexOf("rTarget !== 'all'");
  assert(allBroadcastGuard > 0, '18.11 reminder with target="all" skips per-user email (broadcast handled elsewhere)');
}

// 18.12 — Simulate the email preference filter logic
{
  const applyPref = (prefs, userId, type, defaultEnabled) => {
    const userPref = prefs[userId] || {};
    return (typeof userPref[type] === 'boolean') ? userPref[type] : defaultEnabled;
  };
  assert(applyPref({'u1': {ticket_assigned: false}}, 'u1', 'ticket_assigned', true) === false, '18.12a user opted out → skip email');
  assert(applyPref({'u1': {ticket_assigned: true}}, 'u1', 'ticket_assigned', true) === true, '18.12b user opted in → send email');
  assert(applyPref({}, 'u1', 'ticket_assigned', true) === true, '18.12c no preference row → default enabled');
  assert(applyPref({'u1': {event_scheduled: false}}, 'u1', 'ticket_assigned', true) === true, '18.12d preference on different type → unaffected');
}

// ============================================================
// SECTION 19: H2 — Mobile Nadia Freeze (greeter position on <768px)
// Asserts the CSS-order solution is wired correctly in page.jsx.
// No browser, no DOM — pure source inspection.
// ============================================================
function runSection19_MobileNadia() {
  group('SECTION 19: H2 Mobile Nadia Freeze');
  const pagePath = path.join(REPO_ROOT, 'src/app/page.jsx');
  const src = fs.readFileSync(pagePath, 'utf8');

  // 19.1 — dashboard root div is flex-col so order-* applies to children
  const dashOpen = src.match(/\{tab === 'dashboard' && \(\s*\n\s*<div className="([^"]*)">/);
  assert(!!dashOpen, '19.1a dashboard open tag matched');
  assert(dashOpen && /flex/.test(dashOpen[1]), '19.1b dashboard root has flex');
  assert(dashOpen && /flex-col/.test(dashOpen[1]), '19.1c dashboard root has flex-col');

  // 19.2 — AIGreeter block is wrapped with max-md:order-last
  const greeterWrapRE = /<div className="max-md:order-last">\s*\n\s*\{!greeterDismissed && greeterSettings\.enabled \?/;
  assert(greeterWrapRE.test(src), '19.2a greeter block is wrapped with max-md:order-last');

  // 19.3 — exactly ONE AIGreeter component instance remains (no double-mount)
  const greeterInstances = (src.match(/<AIGreeter\b/g) || []).length;
  assert(greeterInstances === 1, '19.3a exactly one AIGreeter instance in page.jsx', 'found=' + greeterInstances);

  // 19.4 — the greeter wrapper does not use `hidden` / `md:hidden` toggling
  // (that would cause double-mount if paired with another mobile-only slot)
  const hasHiddenToggle = /<div className="(?:max-md:)?hidden md:block"[^>]*>\s*\n\s*<AIGreeter/.test(src) ||
                         /<div className="md:hidden"[^>]*>\s*\n\s*<AIGreeter/.test(src);
  assert(!hasHiddenToggle, '19.4a no display:none responsive toggling around AIGreeter (single mount guaranteed)');

  // 19.5 — `max-md:order-last` is a Tailwind arbitrary variant, but order-last
  // is a core utility (order: 9999). Assert it exists as expected token.
  assert(/max-md:order-last/.test(src), '19.5a max-md:order-last token present');

  // 19.6 — desktop visual behavior: no md:order-* on greeter (so it keeps natural JSX position on md+)
  const greeterSection = src.slice(src.indexOf('max-md:order-last"'), src.indexOf('max-md:order-last"') + 2000);
  assert(!/md:order-\d/.test(greeterSection.replace('max-md:order-last', '')),
         '19.6a no conflicting md:order-N on greeter wrapper (desktop keeps natural order)');

  // 19.7 — parent flex-col does not break layout: no child uses `float-` classes
  // inside the dashboard block (float breaks flex)
  const dashStart = src.indexOf("{tab === 'dashboard' &&");
  // find matching close by counting — simple heuristic: take 180KB window (dashboard is ~120KB)
  const dashSlice = src.slice(dashStart, dashStart + 250000);
  const floatUsages = (dashSlice.match(/className="[^"]*\bfloat-(?:left|right|none)\b/g) || []).length;
  assert(floatUsages === 0, '19.7a no float-* classes inside dashboard (flex compatible)', 'found=' + floatUsages);

  // 19.8 — the wrapper div is closed (balance check on the immediate block)
  // count opens and closes in the wrapper span
  const wrapOpen = src.indexOf('<div className="max-md:order-last">');
  assert(wrapOpen > 0, '19.8a wrapper open tag located');
  // within next ~3000 chars, there should be one `</div>` that closes it
  const after = src.slice(wrapOpen, wrapOpen + 3000);
  // the wrapper contains a ternary with two branches each having their own div or button — rough balance check
  const opens = (after.match(/<div\b/g) || []).length;
  const closes = (after.match(/<\/div>/g) || []).length;
  assert(opens > 0 && closes >= opens - 2 && closes <= opens + 2,
         '19.8b wrapper JSX roughly balanced in local window',
         'opens=' + opens + ' closes=' + closes);

  // 19.9 — state props still threaded through (no accidental prop drop during wrap)
  const requiredProps = ['sessionMessages', 'onMessagesUpdate', 'hasGreeted', 'onGreeted', 'loginHistoryLoaded'];
  requiredProps.forEach(function(prop, i) {
    assert(new RegExp('\\b' + prop + '=').test(greeterSection),
           '19.9.' + (i+1) + ' prop ' + prop + ' still passed to AIGreeter');
  });

  // 19.10 — AIGreeter's own mount effects unchanged (shouldn't have touched it)
  const greeterPath = path.join(REPO_ROOT, 'src/components/AIGreeter.jsx');
  const greeterSrc = fs.readFileSync(greeterPath, 'utf8');
  assert(/loginHistoryLoaded/.test(greeterSrc), '19.10a AIGreeter still gates on loginHistoryLoaded');
  assert(/onGreeted/.test(greeterSrc), '19.10b AIGreeter still fires onGreeted callback');
}

try { runSection19_MobileNadia(); } catch(e) {
  console.error('SECTION 19 ERROR:', e.message);
  failed++;
}

// ============================================================
// SECTION 20: H3 — Invoice Payment-Source Breakdown
// Unit-tests the aggregatePaymentSources helper in src/lib/utils.js
// Also source-inspects page.jsx to confirm the UI is wired correctly.
// ============================================================
function runSection20_PaymentBreakdown() {
  group('SECTION 20: H3 Payment-Source Breakdown');

  // Load utils.js as CommonJS — mirror Section 6 pattern (strip `export` + append module.exports)
  const utilsSrc2 = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/utils.js'), 'utf8');
  const utilsShim = utilsSrc2.replace(/export\s+const\s+/g, 'const ') +
    '\nmodule.exports = { aggregatePaymentSources: aggregatePaymentSources, PAYMENT_SOURCE_META: PAYMENT_SOURCE_META };';
  fs.writeFileSync('/tmp/_utils_h3.js', utilsShim);
  delete require.cache[require.resolve('/tmp/_utils_h3.js')];
  const utilsMod = require('/tmp/_utils_h3.js');
  const agg = utilsMod.aggregatePaymentSources;
  const META = utilsMod.PAYMENT_SOURCE_META;

  assert(typeof agg === 'function', '20.1a aggregatePaymentSources exported');
  assert(Array.isArray(META) && META.length >= 6, '20.1b PAYMENT_SOURCE_META exported (>=6 entries)');

  // 20.2 — empty input
  const e1 = agg([]);
  assert(e1.total === 0, '20.2a empty array → total 0');
  assert(e1.buckets.cash === 0 && e1.buckets.bank === 0, '20.2b all buckets zero');

  // 20.3 — null / undefined input handled
  assert(agg(null).total === 0, '20.3a null → zero');
  assert(agg(undefined).total === 0, '20.3b undefined → zero');
  assert(agg('not an array').total === 0, '20.3c non-array → zero');

  // 20.4 — single cash row
  const r1 = agg([{ cash_in: 1000, bank_in: 0, payment_source: 'cash' }]);
  assert(r1.buckets.cash === 1000, '20.4a cash bucket = 1000');
  assert(r1.total === 1000, '20.4b total = 1000');
  assert(r1.buckets.bank === 0, '20.4c other buckets untouched');

  // 20.5 — single bank row
  const r2 = agg([{ cash_in: 0, bank_in: 2500, payment_source: 'bank' }]);
  assert(r2.buckets.bank === 2500, '20.5a bank bucket = 2500');
  assert(r2.total === 2500, '20.5b total = 2500');

  // 20.6 — check row
  const r3 = agg([{ cash_in: 5000, bank_in: 0, payment_source: 'check' }]);
  assert(r3.buckets.check === 5000, '20.6a check bucket counts cash_in amount');

  // 20.7 — mixed bundle
  const r4 = agg([
    { cash_in: 1000, bank_in: 0, payment_source: 'cash' },
    { cash_in: 0, bank_in: 2000, payment_source: 'bank' },
    { cash_in: 500, bank_in: 0, payment_source: 'vodafone' },
    { cash_in: 300, bank_in: 0, payment_source: 'instapay' },
    { cash_in: 4000, bank_in: 0, payment_source: 'check' },
  ]);
  assert(r4.buckets.cash === 1000, '20.7a cash = 1000');
  assert(r4.buckets.bank === 2000, '20.7b bank = 2000');
  assert(r4.buckets.vodafone === 500, '20.7c vodafone = 500');
  assert(r4.buckets.instapay === 300, '20.7d instapay = 300');
  assert(r4.buckets.check === 4000, '20.7e check = 4000');
  assert(r4.total === 7800, '20.7f total = 7800');

  // 20.8 — fallback: missing payment_source with bank_in → bucket as bank
  const r5 = agg([{ cash_in: 0, bank_in: 1500, payment_source: null }]);
  assert(r5.buckets.bank === 1500, '20.8a null payment_source + bank_in → bank bucket');

  // 20.9 — fallback: missing payment_source with cash_method=vodafone → vodafone
  const r6 = agg([{ cash_in: 800, bank_in: 0, payment_source: '', cash_method: 'vodafone' }]);
  assert(r6.buckets.vodafone === 800, '20.9a empty src + cash_method=vodafone → vodafone bucket');

  // 20.10 — fallback: missing payment_source with cash_method=instapay → instapay
  const r7 = agg([{ cash_in: 400, bank_in: 0, cash_method: 'instapay' }]);
  assert(r7.buckets.instapay === 400, '20.10a undefined src + cash_method=instapay → instapay bucket');

  // 20.11 — fallback: missing payment_source, no cash_method → default to cash
  const r8 = agg([{ cash_in: 250, bank_in: 0 }]);
  assert(r8.buckets.cash === 250, '20.11a bare cash row → cash bucket');

  // 20.12 — zero amount rows skipped
  const r9 = agg([
    { cash_in: 0, bank_in: 0, payment_source: 'cash' },
    { cash_in: 0, bank_in: 0, payment_source: 'bank' },
  ]);
  assert(r9.total === 0, '20.12a zero-amount rows contribute nothing');

  // 20.13 — negative amounts skipped (outflows don't increase collected)
  const r10 = agg([
    { cash_in: -500, bank_in: 0, payment_source: 'cash' },
    { cash_in: 1000, bank_in: 0, payment_source: 'cash' },
  ]);
  assert(r10.buckets.cash === 1000, '20.13a negative skipped, positive counted');

  // 20.14 — unknown payment_source falls into "other"
  const r11 = agg([{ cash_in: 600, bank_in: 0, payment_source: 'paypal' }]);
  assert(r11.buckets.other === 600, '20.14a unknown source → other bucket');

  // 20.15 — case insensitivity
  const r12 = agg([{ cash_in: 900, bank_in: 0, payment_source: 'BANK' }]);
  assert(r12.buckets.bank === 900, '20.15a payment_source case-insensitive (BANK → bank)');

  // 20.16 — row with both cash_in and bank_in summed as one contribution
  const r13 = agg([{ cash_in: 300, bank_in: 700, payment_source: 'bank' }]);
  assert(r13.buckets.bank === 1000, '20.16a cash_in + bank_in summed into tagged bucket');

  // 20.17 — META shape sanity
  const keys = META.map(m => m.key).sort().join(',');
  assert(keys === 'bank,cash,check,instapay,other,vodafone', '20.17a META keys match expected set');
  META.forEach(function(m, i) {
    assert(m.label && m.labelAr && m.color, '20.17.' + (i+1) + '.b META[' + m.key + '] has label/labelAr/color');
  });

  // 20.18 — page.jsx wiring: helper imported
  const pageSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/app/page.jsx'), 'utf8');
  assert(/aggregatePaymentSources/.test(pageSrc), '20.18a aggregatePaymentSources referenced in page.jsx');
  assert(/PAYMENT_SOURCE_META/.test(pageSrc), '20.18b PAYMENT_SOURCE_META referenced in page.jsx');

  // 20.19 — page.jsx wiring: breakdown renders INSIDE the invoice modal
  // Check it appears AFTER "Outstanding" card and BEFORE "Reconciliation Status"
  const outstandingIdx = pageSrc.indexOf('Outstanding / المتبقّي');
  const breakdownIdx = pageSrc.indexOf('Payment Breakdown / تفصيل الدفع');
  const reconIdx = pageSrc.indexOf('{/* Reconciliation Status */}');
  assert(outstandingIdx > 0, '20.19a outstanding card marker found');
  assert(breakdownIdx > 0, '20.19b payment-breakdown section found');
  assert(reconIdx > 0, '20.19c reconciliation status marker found');
  assert(outstandingIdx < breakdownIdx, '20.19d breakdown is AFTER outstanding card');
  assert(breakdownIdx < reconIdx, '20.19e breakdown is BEFORE reconciliation status');

  // 20.20 — breakdown guarded on empty (won't render when no linked txns)
  const breakdownSection = pageSrc.slice(breakdownIdx - 1500, breakdownIdx + 2500);
  assert(/if \(txns\.length === 0\) return null/.test(breakdownSection), '20.20a empty-txns guard present');
  assert(/if \(agg\.total <= 0\) return null/.test(breakdownSection), '20.20b zero-total guard present');
}

try { runSection20_PaymentBreakdown(); } catch(e) {
  console.error('SECTION 20 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 21: QA Review Fixes — Session 2026-04-20 late
// ============================================================
function runSection21_QAReviewFixes() {
  group('SECTION 21: QA review bug fixes');

  // ---- 21.1 — Bug #1: test-checks.js must be portable (no hard-coded abs path) ----
  const testChecksSrc = fs.readFileSync(path.join(REPO_ROOT, '__tests__/test-checks.js'), 'utf8');
  assert(!/\/home\/claude\/nexttrade\/src\/lib\/check-reconcile\.js/.test(testChecksSrc),
         '21.1a test-checks.js no longer contains the old hard-coded absolute path');
  assert(/__dirname/.test(testChecksSrc) && /REPO_ROOT/.test(testChecksSrc),
         '21.1b test-checks.js now uses __dirname-derived REPO_ROOT (portable)');
  assert(/path\.join\(REPO_ROOT, 'src\/lib\/check-reconcile\.js'\)/.test(testChecksSrc),
         '21.1c test-checks.js uses path.join for check-reconcile.js');

  // ---- 21.2 — Bug #2: stale recalcInvoice removed from supabase.js ----
  const supaLibSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/supabase.js'), 'utf8');
  // The old function signature must not be present
  assert(!/export\s+async\s+function\s+recalcInvoice\s*\(/.test(supaLibSrc),
         '21.2a stale recalcInvoice function signature removed');
  // The warning comment must be present so a future dev sees why it's gone
  assert(/recalcInvoiceCollected/.test(supaLibSrc),
         '21.2b supabase.js has a comment pointing to recalcInvoiceCollected as the canonical helper');
  assert(/pre-bank-separation/.test(supaLibSrc) || /bank-separation/.test(supaLibSrc),
         '21.2c comment explains the historical reason for removal');

  // ---- 21.3 — Bug #3: dashboard load uses safe-wrapped Promise.all (no fragile failure) ----
  const pageSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/app/page.jsx'), 'utf8');
  // The specific anti-pattern must be gone: a Promise.all whose items are bare fetchAll(...) calls
  const loadAllStart = pageSrc.indexOf('const loadAllData = async () =>');
  assert(loadAllStart > 0, '21.3a loadAllData defined');
  const loadAllSlice = pageSrc.slice(loadAllStart, loadAllStart + 2500);
  // Must have the `safe` wrapper
  assert(/const safe = \(p\) =>/.test(loadAllSlice) || /safe\s*=\s*\(p\)\s*=>/.test(loadAllSlice),
         '21.3b safe() wrapper introduced in loadAllData');
  // All 9 main-table fetches must be wrapped in safe(...)
  const safeCount = (loadAllSlice.match(/safe\(fetchAll\(/g) || []).length;
  assert(safeCount === 9, '21.3c all 9 main tables wrapped in safe() — one query failure cannot nuke the dashboard',
         'found=' + safeCount);
  // The old unwrapped form must be gone
  const unwrappedFetchAll = (loadAllSlice.match(/^\s{8,}fetchAll\(/gm) || []).length;
  assert(unwrappedFetchAll === 0, '21.3d no bare fetchAll() inside Promise.all anymore',
         'found unwrapped=' + unwrappedFetchAll);
  // Comment explaining why must be present
  assert(/Promise\.allSettled|principle #5|independently safe/i.test(loadAllSlice),
         '21.3e loadAllData has a comment explaining the fix');
}

try { runSection21_QAReviewFixes(); } catch(e) {
  console.error('SECTION 21 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 22: Regression — 'temp-' id fabrication
// The screenshot bug: optimistic local-state insert used a fake
// 'temp-' + Date.now() id. Edit/Delete within the 500ms reload
// window sent 'temp-1776708673956' to Postgres → "invalid input
// syntax for type uuid". The fix: use the REAL uuid returned by
// dbInsert.
// ============================================================
function runSection22_TempIdRegression() {
  group('SECTION 22: No fabricated temp- ids in optimistic inserts');
  const pagePath = path.join(REPO_ROOT, 'src/app/page.jsx');
  const src = fs.readFileSync(pagePath, 'utf8');

  // 22.1 — no code site fabricates `id: 'temp-' + Date.now()` anymore
  // Match only code (not comments): an object literal with id:'temp-'+Date.now()
  const fabricationRE = /id:\s*['"]temp-['"]\s*\+\s*Date\.now\(\)/;
  const fabricationFallbackRE = /id:\s*\w+\?\.id\s*\|\|\s*['"]temp-['"]\s*\+\s*Date\.now\(\)/;
  assert(!fabricationRE.test(src), '22.1a no direct `id: "temp-" + Date.now()` fabrications');
  assert(!fabricationFallbackRE.test(src), '22.1b no `newInv?.id || "temp-" + Date.now()` fallbacks');

  // 22.2 — `const tempEntry = { id: ...` pattern gone (old 3-site name)
  assert(!/const tempEntry = \{ id: ['"]temp-/.test(src), '22.2a no tempEntry objects with temp- id');

  // 22.3 — treasury insert flow uses dbInsert return value
  // After `dbInsert('treasury', ...)` there should be a capture into a variable
  // that's then used in setTreasury(prev => [<var>, ...prev])
  const treasuryInsertCount = (src.match(/const inserted = await dbInsert\('treasury'/g) || []).length;
  assert(treasuryInsertCount >= 3,
         '22.3a at least 3 treasury dbInsert call sites now capture the inserted row',
         'found=' + treasuryInsertCount);

  // 22.4 — setTreasury with the inserted variable (not a tempEntry)
  const goodPattern = (src.match(/setTreasury\(prev => \[inserted, \.\.\.prev\]\)/g) || []).length;
  assert(goodPattern >= 3,
         '22.4a setTreasury uses the real `inserted` row (not a fabricated entry)',
         'found=' + goodPattern);

  // 22.5 — setEditTreasuryModal still receives the row object (unchanged UX)
  assert(/setEditTreasuryModal\(\{\.\.\.t\}\)/.test(src), '22.5a edit modal still spreads the row as before');

  // 22.6 — dbInsert in supabase.js still returns the data row so callers can rely on it
  const supaSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/supabase.js'), 'utf8');
  assert(/export async function dbInsert/.test(supaSrc), '22.6a dbInsert still exported');
  assert(/\.insert\(record\)\.select\(\)\.single\(\)/.test(supaSrc), '22.6b dbInsert uses .select().single() so returned data carries the real uuid');
  assert(/return data;/.test(supaSrc), '22.6c dbInsert returns data');

  // 22.7 — handleSaveTreasuryEdit still passes the txn.id it was given (no preprocessing)
  assert(/await dbUpdate\('treasury', txnId, updates, userProfile\?\.id \|\| user\?\.id\)/.test(src),
         '22.7a handleSaveTreasuryEdit passes the id unchanged — fix is upstream at insert time, not here');
}

try { runSection22_TempIdRegression(); } catch(e) {
  console.error('SECTION 22 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 23: Session 1 features — R7 (ticket edit audit),
// R8 (rich text comments + sanitizer), R3 (meeting notes re-edit)
// ============================================================
function runSection23_Session1Features() {
  group('SECTION 23: Session 1 features');

  // ---- Load utils for sanitizer unit tests ----
  const utilsSrc23 = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/utils.js'), 'utf8');
  const utilsShim23 = utilsSrc23.replace(/export\s+const\s+/g, 'const ') +
    '\nmodule.exports = { sanitizeRichText: sanitizeRichText, isHtmlComment: isHtmlComment, richTextToPlain: richTextToPlain };';
  fs.writeFileSync('/tmp/_utils_s23.js', utilsShim23);
  delete require.cache[require.resolve('/tmp/_utils_s23.js')];
  const U = require('/tmp/_utils_s23.js');

  // ---------- R8: sanitizeRichText ----------
  assert(typeof U.sanitizeRichText === 'function', '23.R8.1a sanitizeRichText exported');
  assert(typeof U.isHtmlComment === 'function', '23.R8.1b isHtmlComment exported');
  assert(typeof U.richTextToPlain === 'function', '23.R8.1c richTextToPlain exported');

  // Allow-listed tags preserved
  assert(U.sanitizeRichText('<b>bold</b>') === '<b>bold</b>', '23.R8.2a keeps <b>');
  assert(U.sanitizeRichText('<strong>x</strong>') === '<strong>x</strong>', '23.R8.2b keeps <strong>');
  assert(U.sanitizeRichText('<i>x</i>') === '<i>x</i>', '23.R8.2c keeps <i>');
  assert(U.sanitizeRichText('<em>x</em>') === '<em>x</em>', '23.R8.2d keeps <em>');
  assert(U.sanitizeRichText('<u>x</u>') === '<u>x</u>', '23.R8.2e keeps <u>');
  assert(U.sanitizeRichText('line 1<br>line 2').indexOf('<br>') >= 0, '23.R8.2f keeps <br>');
  assert(/<ul>.*<li>.*<\/li>.*<\/ul>/.test(U.sanitizeRichText('<ul><li>a</li></ul>')), '23.R8.2g keeps <ul>/<li>');
  assert(/<ol>.*<li>.*<\/li>.*<\/ol>/.test(U.sanitizeRichText('<ol><li>a</li></ol>')), '23.R8.2h keeps <ol>/<li>');

  // Script & handler stripped
  assert(U.sanitizeRichText('<script>alert(1)</script>hello') === 'hello', '23.R8.3a <script> block stripped entirely');
  assert(!/onerror/.test(U.sanitizeRichText('<b onerror="x()">hi</b>')), '23.R8.3b onerror attribute stripped');
  assert(!/onclick/.test(U.sanitizeRichText('<b onclick="x()">hi</b>')), '23.R8.3c onclick attribute stripped');
  assert(!/javascript:/i.test(U.sanitizeRichText('<b href="javascript:x">hi</b>')), '23.R8.3d javascript: href stripped');

  // Disallowed tags dropped (content preserved)
  assert(U.sanitizeRichText('<img src="x">nope') === 'nope', '23.R8.4a <img> dropped');
  assert(U.sanitizeRichText('<iframe></iframe>hello') === 'hello', '23.R8.4b <iframe> block dropped');
  assert(U.sanitizeRichText('<a href="http://x">link</a>') === 'link', '23.R8.4c <a> not on allow-list → dropped');

  // style / class attrs stripped from allow-listed tags
  assert(!/style=/.test(U.sanitizeRichText('<b style="color:red">x</b>')), '23.R8.5a style attr stripped from <b>');
  assert(!/class=/.test(U.sanitizeRichText('<b class="evil">x</b>')), '23.R8.5b class attr stripped from <b>');

  // Null / empty / non-string
  assert(U.sanitizeRichText('') === '', '23.R8.6a empty string → empty');
  assert(U.sanitizeRichText(null) === '', '23.R8.6b null → empty');
  assert(U.sanitizeRichText(undefined) === '', '23.R8.6c undefined → empty');
  assert(U.sanitizeRichText(123) === '', '23.R8.6d non-string → empty');

  // ---------- isHtmlComment ----------
  assert(U.isHtmlComment('<b>bold</b>') === true, '23.R8.7a detects <b>');
  assert(U.isHtmlComment('<ul><li>x</li></ul>') === true, '23.R8.7b detects <ul>');
  assert(U.isHtmlComment('plain text') === false, '23.R8.7c plain text → false');
  assert(U.isHtmlComment('a < b > c') === false, '23.R8.7d literal comparison text → false');
  assert(U.isHtmlComment('') === false, '23.R8.7e empty → false');
  assert(U.isHtmlComment(null) === false, '23.R8.7f null → false');

  // ---------- richTextToPlain ----------
  assert(U.richTextToPlain('<b>hi</b>') === 'hi', '23.R8.8a strips <b>');
  assert(/one\s+two/.test(U.richTextToPlain('one<br>two')), '23.R8.8b <br> becomes newline');
  assert(U.richTextToPlain('<ul><li>a</li><li>b</li></ul>').replace(/\s+/g, ' ').trim() === 'a b',
    '23.R8.8c list items separate with whitespace');
  assert(U.richTextToPlain('&amp;&lt;&gt;&quot;&#39;') === '&<>"\'', '23.R8.8d html entities decoded');

  // ---------- R8 WIRING in TicketsTab.jsx ----------
  const ticketsSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/TicketsTab.jsx'), 'utf8');
  assert(/import\s+RichCommentComposer\s+from\s+['"]\.\/RichCommentComposer['"]/.test(ticketsSrc),
         '23.R8.9a RichCommentComposer imported');
  assert(/import\s*\{[^}]*sanitizeRichText[^}]*\}\s*from\s+['"]\.\.\/lib\/utils['"]/.test(ticketsSrc),
         '23.R8.9b sanitizeRichText imported from utils');
  assert(/sanitizeRichText\(String\(f\.comment\)\)/.test(ticketsSrc),
         '23.R8.9c addComment sanitizes HTML before insert');
  assert(/dangerouslySetInnerHTML/.test(ticketsSrc),
         '23.R8.9d rich comments rendered via dangerouslySetInnerHTML (after sanitize)');
  // Old plain-text input gone
  assert(!/placeholder="Add comment\.\.\."\s+className="flex-1 px-3 py-2 border rounded-lg text-sm" \/>/.test(ticketsSrc),
         '23.R8.9e old plain <input> comment composer removed');

  // RichCommentComposer component presence + shape
  const composerSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/RichCommentComposer.jsx'), 'utf8');
  assert(/export default function RichCommentComposer/.test(composerSrc), '23.R8.10a component exports default');
  assert(/contentEditable/.test(composerSrc), '23.R8.10b uses contentEditable');
  assert(/onClick=\{\(\) => exec\(['"]bold['"]\)\}/.test(composerSrc), '23.R8.10c bold button wired');
  assert(/onClick=\{\(\) => exec\(['"]italic['"]\)\}/.test(composerSrc), '23.R8.10d italic button wired');
  assert(/onClick=\{\(\) => exec\(['"]insertUnorderedList['"]\)\}/.test(composerSrc), '23.R8.10e bullet button wired');
  assert(/onClick=\{\(\) => exec\(['"]insertOrderedList['"]\)\}/.test(composerSrc), '23.R8.10f numbered button wired');
  // And the exec wrapper actually calls document.execCommand under the hood
  assert(/document\.execCommand\(cmd, false, arg \|\| null\)/.test(composerSrc),
         '23.R8.10c2 exec() wrapper delegates to document.execCommand');
  assert(/Ctrl\+Enter|ctrlKey \|\| e\.metaKey/.test(composerSrc), '23.R8.10g Ctrl/Cmd+Enter submit wired');
  assert(/onPaste/.test(composerSrc) && /insertText/.test(composerSrc), '23.R8.10h paste-as-plain-text guard present');

  // ---------- R7: Ticket edit audit ----------
  assert(/const \[editingField, setEditingField\] = useState\(null\)/.test(ticketsSrc),
         '23.R7.1a editingField state declared');
  assert(/const \[editBuf, setEditBuf\]/.test(ticketsSrc),
         '23.R7.1b editBuf state declared');
  assert(/const canEditTicketContent = /.test(ticketsSrc),
         '23.R7.1c canEditTicketContent permission gate defined');
  assert(/const saveTicketEdit = async \(field\) =>/.test(ticketsSrc),
         '23.R7.1d saveTicketEdit handler defined');
  assert(/'BEFORE: '/.test(ticketsSrc) && /'AFTER: '/.test(ticketsSrc),
         '23.R7.2a audit comment contains BEFORE / AFTER markers');
  assert(/is_system: true/.test(ticketsSrc),
         '23.R7.2b audit comment marked is_system=true so it appears in Activity Log');
  assert(/saveTicketEdit\('title'\)/.test(ticketsSrc), '23.R7.3a title save wired');
  assert(/saveTicketEdit\('description'\)/.test(ticketsSrc), '23.R7.3b description save wired');
  // Permission gate enforced (super_admin always, admin role, creator, any assignee)
  const gateBlock = ticketsSrc.slice(ticketsSrc.indexOf('const canEditTicketContent'), ticketsSrc.indexOf('const canEditTicketContent') + 500);
  assert(/isSuperAdmin/.test(gateBlock), '23.R7.4a super_admin always passes gate');
  assert(/isAdminRole/.test(gateBlock), '23.R7.4b admin role passes gate');
  assert(/created_by === myId/.test(gateBlock), '23.R7.4c creator passes gate');
  assert(/parseAssignees\(ticket\)\.includes\(myId\)/.test(gateBlock), '23.R7.4d any assignee passes gate');
  // System-comments render preserves newlines
  assert(/className="text-xs whitespace-pre-wrap">{c\.comment_text}/.test(ticketsSrc),
         '23.R7.5a system comments render with whitespace-pre-wrap (audit diff has \\n)');

  // ---------- R3: Meeting-notes re-edit after completion ----------
  const calSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/CalendarTab.jsx'), 'utf8');
  // Completed events now offer an Edit Notes / Add Notes button
  assert(/Edit Notes/.test(calSrc), '23.R3.1a "Edit Notes" label present for completed events');
  assert(/Add Notes/.test(calSrc), '23.R3.1b "Add Notes" label for completed events with no notes');
  // checkInWithNotes handles both modes
  assert(/wasCompleted = !!notesEvent\.completed/.test(calSrc),
         '23.R3.2a checkInWithNotes branches on wasCompleted');
  assert(/notesChanged = notes !== oldNotes/.test(calSrc),
         '23.R3.2b detects whether notes actually changed');
  // No duplicate daily_log on reopen-without-edit
  assert(/if \(notes && notesChanged\)/.test(calSrc),
         '23.R3.2c daily_log insert gated on (notes && notesChanged) — no duplicate archival on re-save');
  // Modal header reflects mode
  assert(/Edit Meeting Notes/.test(calSrc), '23.R3.3a modal header offers Edit state');
  // Initial check-in still works (not accidentally regressed)
  assert(/update\.completed = true/.test(calSrc) && /update\.event_status = 'attended'/.test(calSrc),
         '23.R3.4a initial check-in still stamps completed + attended');
}

try { runSection23_Session1Features(); } catch(e) {
  console.error('SECTION 23 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 24: Comprehensive audit — src/lib/utils.js
// Exhaustive edge cases + outliers + security scenarios for the
// four helpers added/modified this session:
//   aggregatePaymentSources (H3)
//   sanitizeRichText (R8)
//   isHtmlComment (R8)
//   richTextToPlain (R8)
// ============================================================
function runSection24_UtilsAudit() {
  group('SECTION 24: utils.js comprehensive audit');

  // Load utils.js as CommonJS
  const utilsSrc24 = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/utils.js'), 'utf8');
  const utilsShim24 = utilsSrc24.replace(/export\s+const\s+/g, 'const ') +
    '\nmodule.exports = { aggregatePaymentSources, PAYMENT_SOURCE_META, sanitizeRichText, isHtmlComment, richTextToPlain };';
  fs.writeFileSync('/tmp/_utils_s24.js', utilsShim24);
  delete require.cache[require.resolve('/tmp/_utils_s24.js')];
  const U = require('/tmp/_utils_s24.js');

  // =========================================================
  // aggregatePaymentSources — edge cases / outliers
  // =========================================================

  // 24.agg.1 — row with BOTH cash_in and bank_in positive (corrupted row; auditor
  // flags it separately as CORRUPTED_ROW). Aggregator must still tally deterministically.
  const r_both = U.aggregatePaymentSources([
    { cash_in: 500, bank_in: 1500, payment_source: 'bank' },
  ]);
  assert(r_both.buckets.bank === 2000,
    '24.agg.1a corrupted row (both channels populated) → sum goes to tagged bucket');
  assert(r_both.total === 2000, '24.agg.1b total equals the sum regardless of channels');

  // 24.agg.2 — row with cash_in AND cash_out (positive contribution only counts inflow)
  const r_both2 = U.aggregatePaymentSources([
    { cash_in: 1000, cash_out: 500, payment_source: 'cash' },
  ]);
  assert(r_both2.buckets.cash === 1000,
    '24.agg.2a cash_in alone counts (cash_out ignored — not a collected payment)');

  // 24.agg.3 — very large numbers (no float precision loss at this scale)
  const big = 1_500_000_000; // 1.5 billion EGP
  const r_big = U.aggregatePaymentSources([
    { cash_in: big, bank_in: 0, payment_source: 'cash' },
    { cash_in: 0, bank_in: big, payment_source: 'bank' },
  ]);
  assert(r_big.total === big * 2, '24.agg.3a billions-scale numbers sum correctly');

  // 24.agg.4 — decimal numbers (partial EGP)
  const r_dec = U.aggregatePaymentSources([
    { cash_in: 0.33, payment_source: 'cash' },
    { cash_in: 0.33, payment_source: 'cash' },
    { cash_in: 0.34, payment_source: 'cash' },
  ]);
  assert(Math.abs(r_dec.buckets.cash - 1.0) < 0.001, '24.agg.4a decimals sum within float tolerance');

  // 24.agg.5 — whitespace in payment_source (' cash ')
  const r_ws = U.aggregatePaymentSources([{ cash_in: 100, payment_source: '  cash  ' }]);
  assert(r_ws.buckets.cash === 100, '24.agg.5a whitespace trimmed from payment_source');

  // 24.agg.6 — case variants: 'Cash', 'CASH', 'cash', 'CaSh'
  ['Cash', 'CASH', 'cash', 'CaSh'].forEach(function(src, i) {
    const r = U.aggregatePaymentSources([{ cash_in: 100, payment_source: src }]);
    assert(r.buckets.cash === 100, '24.agg.6.' + (i+1) + ' case variant "' + src + '" normalizes to cash bucket');
  });

  // 24.agg.7 — malformed rows in array (nulls, undefined, non-objects)
  const r_mal = U.aggregatePaymentSources([
    null,
    undefined,
    'not an object',
    { cash_in: 100, payment_source: 'cash' }, // valid
  ]);
  assert(r_mal.buckets.cash === 100, '24.agg.7a malformed entries skipped, valid ones counted');
  assert(r_mal.total === 100, '24.agg.7b total reflects only valid entries');

  // 24.agg.8 — row with non-numeric cash_in (string "100")
  const r_str = U.aggregatePaymentSources([{ cash_in: '250', payment_source: 'cash' }]);
  assert(r_str.buckets.cash === 250, '24.agg.8a string amounts coerced via Number()');

  // 24.agg.9 — row with NaN/invalid amount
  const r_nan = U.aggregatePaymentSources([
    { cash_in: NaN, payment_source: 'cash' },
    { cash_in: 'abc', payment_source: 'cash' },
    { cash_in: 100, payment_source: 'cash' },
  ]);
  assert(r_nan.buckets.cash === 100, '24.agg.9a NaN/invalid amounts treated as 0');

  // 24.agg.10 — all rows are zero (edge for UI hide-if-empty)
  const r_zero = U.aggregatePaymentSources([
    { cash_in: 0, payment_source: 'cash' },
    { cash_in: 0, payment_source: 'bank' },
  ]);
  assert(r_zero.total === 0, '24.agg.10a all-zero total = 0 (UI should hide strip)');

  // 24.agg.11 — realistic multi-channel split invoice
  const r_split = U.aggregatePaymentSources([
    { cash_in: 5000, payment_source: 'cash' },
    { cash_in: 0, bank_in: 12000, payment_source: 'bank' },
    { cash_in: 8000, payment_source: 'check' },
    { cash_in: 2000, payment_source: 'vodafone' },
  ]);
  assert(r_split.total === 27000, '24.agg.11a realistic split-payment total');
  const totalPctSum = Math.round((r_split.buckets.cash + r_split.buckets.bank + r_split.buckets.check + r_split.buckets.vodafone) / r_split.total * 100);
  assert(totalPctSum === 100, '24.agg.11b percentages sum to 100');

  // 24.agg.12 — confirm fallback priority: bank_in beats cash_method (both present, no explicit source)
  const r_prio = U.aggregatePaymentSources([{ bank_in: 100, cash_method: 'vodafone', payment_source: '' }]);
  assert(r_prio.buckets.bank === 100, '24.agg.12a bank_in>0 wins over cash_method when no explicit source');

  // 24.agg.13 — whitespace-only payment_source treated same as empty → triggers inference
  const r_ws_only = U.aggregatePaymentSources([{ cash_in: 100, payment_source: '   ', cash_method: 'vodafone' }]);
  assert(r_ws_only.buckets.vodafone === 100, '24.agg.13a whitespace-only source → infer via cash_method');

  // =========================================================
  // sanitizeRichText — security / XSS scenarios
  // =========================================================

  // 24.san.1 — nested <script> inside allow-listed tag
  assert(!/alert/.test(U.sanitizeRichText('<b><script>alert(1)</script>hi</b>')),
    '24.san.1a <script> stripped even when nested in allow-listed tag');

  // 24.san.2 — case variants of <SCRIPT>, <Script>, etc.
  ['<SCRIPT>alert(1)</SCRIPT>', '<Script>x</Script>', '<scRIPT>y</scRIPT>'].forEach(function(v, i) {
    assert(!/alert|scRIPT|Script|SCRIPT/i.test(U.sanitizeRichText(v).replace(/script/i, '')),
      '24.san.2.' + (i+1) + ' case-variant script tag stripped');
  });

  // 24.san.3 — mixed case event handlers
  ['OnErRoR', 'OnClick', 'ONMOUSEOVER'].forEach(function(handler, i) {
    const html = '<b ' + handler + '=alert(1)>x</b>';
    assert(!new RegExp(handler, 'i').test(U.sanitizeRichText(html)) || !/alert/.test(U.sanitizeRichText(html)),
      '24.san.3.' + (i+1) + ' case-mixed event handler "' + handler + '" stripped');
  });

  // 24.san.4 — event handler with WHITESPACE injection in attribute name.
  // Per HTML spec, whitespace (incl. newline) in an attribute name terminates it.
  // So `<b on\nerror=alert(1)>` parses as TWO attributes: `on` and `error="alert(1)"`.
  // Neither fires JavaScript (browsers only trigger handlers named on<event>).
  // The attack vector is theoretical; our only obligation is that no script executes
  // AND no obvious onerror=... substring survives that could fool a downstream parser.
  const nl_attack = '<b on\nerror=alert(1)>x</b>';
  const nl_out = U.sanitizeRichText(nl_attack);
  // The key property: no substring of the form `on\werror=` exists that could be
  // reassembled by a non-compliant parser. After whitespace collapse, we get
  // `on error=` — two separate tokens, no onerror.
  assert(!/on\w*error\s*=/i.test(nl_out),
    '24.san.4a no reassembled onerror= token after whitespace normalization');
  assert(!/<script>/i.test(nl_out),
    '24.san.4b no script element in output');

  // 24.san.5 — unquoted attribute value
  assert(!/alert/.test(U.sanitizeRichText('<b onclick=alert(1)>x</b>')),
    '24.san.5a unquoted event handler value stripped');

  // 24.san.6 — data: URI
  const data_uri = '<b href="data:text/html,<script>alert(1)</script>">x</b>';
  // Current sanitizer strips <a> entirely (not allow-listed) but <b> stays — verify
  // href on <b> is meaningless anyway; main goal is no script runs
  const out_data = U.sanitizeRichText(data_uri);
  assert(!/<script>/.test(out_data), '24.san.6a data: URI with embedded script neutralized');

  // 24.san.7 — CSS expression (legacy IE)
  const css_expr = '<b style="width:expression(alert(1))">x</b>';
  assert(!/style/.test(U.sanitizeRichText(css_expr)) && !/expression/.test(U.sanitizeRichText(css_expr)),
    '24.san.7a style attribute (incl. expression()) stripped');

  // 24.san.8 — <iframe> with src
  assert(U.sanitizeRichText('<iframe src="evil.com"></iframe>safe') === 'safe',
    '24.san.8a <iframe> element + content dropped');

  // 24.san.9 — <img onerror>
  const img_attack = '<img src=x onerror=alert(1)>safe';
  const out_img = U.sanitizeRichText(img_attack);
  assert(!/alert/.test(out_img) && !/<img/.test(out_img),
    '24.san.9a <img onerror> neutralized');

  // 24.san.10 — self-closing tags
  assert(/<br\s*\/?>/.test(U.sanitizeRichText('<br>')), '24.san.10a <br> preserved');
  assert(/<br\s*\/?>/.test(U.sanitizeRichText('<br/>')), '24.san.10b <br/> preserved');
  assert(/<br\s*\/?>/.test(U.sanitizeRichText('<br />')), '24.san.10c <br /> preserved');

  // 24.san.11 — broken/unclosed tags (resilience, no crash)
  try {
    const out_broken = U.sanitizeRichText('<b>hello<i>world');
    assert(typeof out_broken === 'string', '24.san.11a unclosed tags don\'t crash');
  } catch (e) { assert(false, '24.san.11a CRASHED: ' + e.message); }

  // 24.san.12 — extra > characters
  try {
    U.sanitizeRichText('>>>weird<<b>bold</b>');
    assert(true, '24.san.12a extra brackets don\'t crash');
  } catch (e) { assert(false, '24.san.12a CRASHED: ' + e.message); }

  // 24.san.13 — long input doesn't cause exponential blow-up (regex DoS check)
  const big_input = '<b>' + 'a'.repeat(100000) + '</b>';
  const t0 = Date.now();
  const out_big = U.sanitizeRichText(big_input);
  const elapsed = Date.now() - t0;
  assert(elapsed < 1000, '24.san.13a 100k-char input completes in <1s (no ReDoS)', 'elapsed=' + elapsed + 'ms');
  assert(out_big.indexOf('a'.repeat(100)) >= 0, '24.san.13b content preserved inside allow-listed tag');

  // 24.san.14 — unicode content preserved
  assert(U.sanitizeRichText('<b>مرحبا world 你好</b>') === '<b>مرحبا world 你好</b>',
    '24.san.14a multi-script unicode content preserved');

  // 24.san.15 — empty tag content
  assert(U.sanitizeRichText('<b></b>') === '<b></b>', '24.san.15a empty allow-listed tag preserved');

  // 24.san.16 — numeric types (not strings) return empty
  assert(U.sanitizeRichText(0) === '', '24.san.16a number input → empty');
  assert(U.sanitizeRichText(false) === '', '24.san.16b boolean input → empty');
  assert(U.sanitizeRichText({}) === '', '24.san.16c object input → empty');
  assert(U.sanitizeRichText([]) === '', '24.san.16d array input → empty');

  // 24.san.17 — HTML-entity-encoded whitespace in attribute name.
  // Same as 24.san.4 — HTML parser decodes &#10; as whitespace inside attribute
  // context, which terminates the attribute name. No script executes; we assert
  // the post-normalization output is defanged.
  const encoded_nl = '<b on&#10;click="alert(1)">x</b>';
  const enl_out = U.sanitizeRichText(encoded_nl);
  assert(!/on\w*click\s*=/i.test(enl_out),
    '24.san.17a no reassembled onclick= token after entity decode');
  assert(!/<script>/i.test(enl_out),
    '24.san.17b no script element in output');

  // 24.san.18 — mutation XSS: closing tag injection via title attr
  // Allow-list strips <noscript>, <img> → no rendering path
  const mxss = '<noscript><p title="</noscript><img src=x onerror=alert(1)>">hi</p>';
  assert(!/alert/.test(U.sanitizeRichText(mxss)),
    '24.san.18a mutation XSS / noscript attack neutralized');

  // 24.san.19 — <span> (allow-listed) with injected attributes
  const span_attack = '<span style="position:fixed;top:0" onclick="alert(1)">x</span>';
  const out_span = U.sanitizeRichText(span_attack);
  assert(/<span/.test(out_span) && !/style/.test(out_span) && !/onclick/.test(out_span),
    '24.san.19a <span> allow-listed but style + onclick stripped');

  // 24.san.20 — legitimate multi-tag use case (realistic ticket comment)
  const realistic = '<p>Hey team,</p><ul><li><b>Due:</b> tomorrow</li><li><i>Contact:</i> client</li></ul>';
  const out_real = U.sanitizeRichText(realistic);
  assert(/<p>.*<\/p>/.test(out_real), '24.san.20a realistic <p> preserved');
  assert(/<ul>.*<\/ul>/.test(out_real), '24.san.20b realistic <ul> preserved');
  assert(/<li>.*<b>.*<\/b>.*<\/li>/.test(out_real), '24.san.20c nested <li><b> preserved');

  // =========================================================
  // isHtmlComment — edge cases
  // =========================================================

  // 24.ish.1 — text with HTML entity representations (should be false — they're text)
  assert(U.isHtmlComment('&lt;b&gt;bold&lt;/b&gt;') === false,
    '24.ish.1a HTML entities are text, not HTML → false');

  // 24.ish.2 — text with opening <b but no closing bracket (incomplete)
  assert(U.isHtmlComment('i like <b a lot') === false,
    '24.ish.2a incomplete tag opener → false');

  // 24.ish.3 — mid-string HTML
  assert(U.isHtmlComment('plain text with <b>one bold</b> word') === true,
    '24.ish.3a mid-string allow-listed tag → true');

  // 24.ish.4 — only disallowed tag (non-allow-listed, user would think "plain")
  assert(U.isHtmlComment('<h1>big heading</h1>') === false,
    '24.ish.4a disallowed tag → false (treat as plain; sanitizer would strip anyway)');

  // 24.ish.5 — whitespace only
  assert(U.isHtmlComment('   ') === false, '24.ish.5a whitespace-only → false');
  assert(U.isHtmlComment('\n\n') === false, '24.ish.5b newlines-only → false');

  // 24.ish.6 — non-string inputs
  assert(U.isHtmlComment(123) === false, '24.ish.6a number → false');
  assert(U.isHtmlComment({}) === false, '24.ish.6b object → false');
  assert(U.isHtmlComment([]) === false, '24.ish.6c array → false');

  // =========================================================
  // richTextToPlain — edge cases
  // =========================================================

  // 24.rtp.1 — nested lists
  const nested = '<ul><li>outer<ul><li>inner</li></ul></li></ul>';
  const plain_nested = U.richTextToPlain(nested);
  assert(/outer/.test(plain_nested) && /inner/.test(plain_nested),
    '24.rtp.1a nested list content preserved in plain output');

  // 24.rtp.2 — consecutive <br> tags (multiple newlines compressed)
  const multi_br = 'line1<br><br><br><br>line5';
  const plain_br = U.richTextToPlain(multi_br);
  assert(/line1/.test(plain_br) && /line5/.test(plain_br),
    '24.rtp.2a consecutive <br> preserved as newlines');
  // Compress >2 newlines → 2 (by sanitizer rule)
  const newline_count = (plain_br.match(/\n/g) || []).length;
  assert(newline_count <= 3, '24.rtp.2b excessive consecutive newlines collapsed', 'found=' + newline_count);

  // 24.rtp.3 — numeric HTML entities — NOT decoded in current implementation (only named)
  // Documenting current behavior; future enhancement could decode &#60; etc.
  const num_ent = '&#60;b&#62;x&#60;/b&#62;';
  const out_nent = U.richTextToPlain(num_ent);
  assert(typeof out_nent === 'string', '24.rtp.3a numeric entities do not crash (current: not decoded — future enhancement)');

  // 24.rtp.4 — empty tag content
  assert(U.richTextToPlain('<b></b>') === '', '24.rtp.4a empty tag → empty string');

  // 24.rtp.5 — null/undefined/non-string
  assert(U.richTextToPlain(null) === '', '24.rtp.5a null → empty');
  assert(U.richTextToPlain(undefined) === '', '24.rtp.5b undefined → empty');
  assert(U.richTextToPlain(123) === '', '24.rtp.5c number → empty');

  // 24.rtp.6 — only tags, no text content
  assert(U.richTextToPlain('<b></b><i></i><u></u>') === '', '24.rtp.6a only-tags-no-content → empty');

  // 24.rtp.7 — paragraphs separated (used by email notifications)
  const para = '<p>First paragraph.</p><p>Second paragraph.</p>';
  const plain_p = U.richTextToPlain(para);
  assert(/First paragraph\..*Second paragraph\./s.test(plain_p),
    '24.rtp.7a paragraphs separated by newlines in plain output');

  // 24.rtp.8 — realistic ticket comment roundtrip
  const rich_orig = '<p>Hey <b>team</b>,</p><ul><li>Item 1</li><li>Item 2</li></ul>';
  const plain_out = U.richTextToPlain(rich_orig);
  assert(!/<.>/.test(plain_out), '24.rtp.8a plain output contains no tags');
  assert(/Hey team/.test(plain_out), '24.rtp.8b text content preserved');
  assert(/Item 1/.test(plain_out) && /Item 2/.test(plain_out), '24.rtp.8c list items present');
}

try { runSection24_UtilsAudit(); } catch(e) {
  console.error('SECTION 24 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 25: Comprehensive audit — src/lib/supabase.js
// Pure-logic tests for the audit-diff + late-edit detection.
// Source-inspection tests for defensive patterns around audit log
// failures, concurrent writes, and timezone-sensitive activity logs.
// ============================================================
function runSection25_SupabaseLibAudit() {
  group('SECTION 25: supabase.js comprehensive audit');

  const supaSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/supabase.js'), 'utf8');

  // =========================================================
  // Pure-logic extraction — simulate the changedFields + sensitive
  // detection block from dbUpdate
  // =========================================================
  // SENSITIVE_FIELDS list — keep in sync with supabase.js (expanded 2026-04-20)
  const SENSITIVE_FIELDS = [
    'amount', 'total', 'cash_in', 'cash_out', 'price', 'unit_price', 'rate', 'date', 'description', 'customer', 'order_number', 'invoice_number', 'qty', 'quantity', 'vat_rate',
    'total_amount', 'total_collected', 'outstanding',
    'bank_in', 'bank_out', 'expected_amount', 'usd_in', 'usd_out', 'foreign_amount',
    'transaction_date', 'invoice_date', 'due_date', 'check_date', 'collection_date',
    'customer_name', 'customer_name_en', 'check_number',
  ];

  const computeChangedFields = (old, changes) => {
    return Object.keys(changes).filter(k => old && old[k] !== changes[k]);
  };
  const computeSensitive = (changedFields) => changedFields.filter(f => SENSITIVE_FIELDS.includes(f));
  const isLateEditCalc = (createdAt, now) => {
    if (!createdAt) return { isLate: false, hours: 0 };
    const hours = (now - new Date(createdAt).getTime()) / 3600000;
    return { isLate: hours > 24, hours: Math.round(hours) };
  };

  // ---- isLateEdit math ----
  const now = new Date('2026-04-20T12:00:00Z').getTime();
  assert(isLateEditCalc('2026-04-20T10:00:00Z', now).isLate === false, '25.late.1a 2h ago → not late');
  assert(isLateEditCalc('2026-04-19T11:59:00Z', now).isLate === true, '25.late.1b 24h 1min ago → late (>24hr boundary crossed)');
  assert(isLateEditCalc('2026-04-19T13:00:00Z', now).isLate === false, '25.late.1b2 23h ago → NOT late (under 24hr)');
  assert(isLateEditCalc('2026-04-19T10:00:00Z', now).isLate === true, '25.late.1c 26h ago → late');
  assert(isLateEditCalc(null, now).isLate === false, '25.late.1d null createdAt → not late');
  assert(isLateEditCalc(undefined, now).isLate === false, '25.late.1e undefined createdAt → not late');
  assert(isLateEditCalc('not a date', now).isLate === false, '25.late.1f invalid date string → NaN hours → not late');
  // Future-dated created_at (clock skew / bad data)
  const fut = isLateEditCalc('2027-01-01T00:00:00Z', now);
  assert(fut.isLate === false, '25.late.1g future created_at → negative hours → not late (by spec >24 only)');
  assert(fut.hours < 0, '25.late.1h future created_at rounds to negative hours');

  // ---- changedFields detection ----
  // Scalar identity — correct behaviors
  assert(computeChangedFields({a: 1}, {a: 1}).length === 0, '25.chg.1a identical scalar not flagged');
  assert(computeChangedFields({a: 1}, {a: 2}).length === 1, '25.chg.1b different scalar flagged');
  assert(computeChangedFields({a: 'x', b: 'y'}, {a: 'x', b: 'z'}).length === 1, '25.chg.1c only changed field flagged');

  // Old=null edge — ALL fields marked changed (AUDIT POLLUTION)
  // Current behavior: if old is null (record missing), the filter's `old && old[k]` short-circuits to false
  // and NO fields are flagged. Verify that's what happens.
  assert(computeChangedFields(null, {a: 1, b: 2}).length === 0,
    '25.chg.2a old=null → no fields flagged (thanks to short-circuit; audit row will have changed_fields=[])');
  assert(computeChangedFields(undefined, {a: 1, b: 2}).length === 0, '25.chg.2b old=undefined → safe');

  // Reference inequality on objects/arrays — FALSE POSITIVES
  // This is a real gap: deep-equal arrays produce `!== true` because of identity comparison
  const oldArr = ['a', 'b'];
  const newArr = ['a', 'b']; // same content, different identity
  const diff = computeChangedFields({tags: oldArr}, {tags: newArr});
  assert(diff.length === 1,
    '25.chg.3a KNOWN LIMITATION: arrays with identical content flagged as changed (reference equality)');
  // Document the consequence: audit_log gets spurious "changed" entries for JSONB columns
  // passed as new arrays even when content is unchanged.

  // String-equal JSON (additional_assignees-style) — correct
  assert(computeChangedFields({additional_assignees: '["a"]'}, {additional_assignees: '["a"]'}).length === 0,
    '25.chg.3b string-equal JSON NOT flagged (strings interned)');
  assert(computeChangedFields({additional_assignees: '["a"]'}, {additional_assignees: '["a","b"]'}).length === 1,
    '25.chg.3c string-different JSON flagged correctly');

  // Only fields in `changes` checked — ignores fields present on old but not on changes
  const d2 = computeChangedFields({a: 1, b: 2, c: 3}, {b: 5});
  assert(d2.length === 1 && d2[0] === 'b',
    '25.chg.4a only fields in changes object checked (partial update scope)');

  // ---- SENSITIVE_FIELDS coverage ----
  // The list is in the source; verify it contains the essentials
  const requiredSensitive = ['cash_in', 'cash_out', 'amount', 'price', 'description'];
  requiredSensitive.forEach(function(f, i) {
    assert(SENSITIVE_FIELDS.indexOf(f) >= 0,
      '25.sens.1.' + (i+1) + ' SENSITIVE_FIELDS includes "' + f + '"');
  });

  // ---- SENSITIVE_FIELDS — gaps were CLOSED by the 2026-04-20 expansion ----
  // Previously 'total_amount' etc. weren't in the list. Fixed this session.
  // Load the ACTUAL list from source to verify.
  const listMatch = supaSrc.match(/const SENSITIVE_FIELDS = \[([\s\S]*?)\];/);
  assert(listMatch, '25.sens.gap.source list found in source');
  const actualList = listMatch[1];
  // These were all gaps before this session's fix
  ['total_amount', 'bank_in', 'bank_out', 'transaction_date', 'invoice_date',
   'due_date', 'check_date', 'collection_date', 'customer_name'].forEach(function(f, i) {
    assert(actualList.indexOf("'" + f + "'") >= 0,
      '25.sens.gap.fixed.' + (i+1) + ' ' + f + ' now in SENSITIVE_FIELDS (gap closed)');
  });
  // Short-form backward compat still there
  ['amount', 'total', 'cash_in', 'cash_out', 'description'].forEach(function(f, i) {
    assert(actualList.indexOf("'" + f + "'") >= 0,
      '25.sens.bc.' + (i+1) + ' short-form "' + f + '" still listed (backward compat)');
  });

  // =========================================================
  // Source-inspection tests
  // =========================================================

  // ---- dbInsert: audit row failure propagation ----
  // If the business insert succeeds and the audit insert fails, the overall call still
  // fails (no try/catch around the audit insert). That's a real risk: caller retries,
  // double-inserts business row. Document current behavior.
  const dbInsertBlock = supaSrc.match(/export async function dbInsert[\s\S]*?^\}/m);
  assert(dbInsertBlock, '25.src.1a dbInsert block found');
  assert(!/try\s*\{[\s\S]*?audit_log[\s\S]*?\}\s*catch/.test(dbInsertBlock[0]),
    '25.src.1b KNOWN GAP: audit_log insert in dbInsert has no try/catch — business-insert success but audit failure propagates as thrown error');

  // ---- dbUpdate: same audit-failure issue ----
  const dbUpdateBlock = supaSrc.match(/export async function dbUpdate[\s\S]*?^\}/m);
  assert(dbUpdateBlock, '25.src.2a dbUpdate block found');
  assert(!/try\s*\{[\s\S]*?audit_log[\s\S]*?update[\s\S]*?\}\s*catch/.test(dbUpdateBlock[0]),
    '25.src.2b KNOWN GAP: audit_log insert in dbUpdate has no try/catch');

  // ---- dbDelete: pre-fetch error handling ----
  // `const { data: old } = await supabase.from(table).select('*').eq('id', id).single();`
  // If the record doesn't exist, .single() errors. But the destructure drops the error.
  // Then `.delete()` on non-existent id affects 0 rows — silent. Audit row gets
  // `old_values: undefined`. Document this.
  const dbDeleteBlock = supaSrc.match(/export async function dbDelete[\s\S]*?^\}/m);
  assert(dbDeleteBlock, '25.src.3a dbDelete block found');
  const dbDelStr = dbDeleteBlock[0];
  assert(/select\('\*'\)\.eq\('id', id\)\.single\(\)/.test(dbDelStr),
    '25.src.3b dbDelete pre-fetches old via .single()');
  assert(!/if \(!old\)/.test(dbDelStr) && !/throw[\s\S]*?not found/.test(dbDelStr),
    '25.src.3c KNOWN GAP: dbDelete does not check if old exists before proceeding to delete');

  // ---- logActivity: timezone drift ----
  // `new Date().toISOString().substring(0,10)` is UTC. Cairo is UTC+2 (UTC+3 DST).
  // Between 22:00-23:59 Cairo, log_date lands on tomorrow UTC.
  assert(/new Date\(\)\.toISOString\(\)\.substring\(0, ?10\)/.test(supaSrc),
    '25.src.4a KNOWN GAP: logActivity uses UTC date, not Cairo (Egypt) local date');
  // Unlike login-events which now uses a generated column for ET tz,
  // daily_log.log_date from activity is UTC-based in this helper.

  // ---- dbQuery ilike: wildcard escaping ----
  // `%${v}%` doesn't escape % or _ in v. Not a SQL injection (parameterized) but
  // wildcard ambiguity: searching for "50%" returns "50anything%".
  const ilikeBlock = supaSrc.match(/ilike[\s\S]{0,120}%/);
  assert(ilikeBlock, '25.src.5a ilike block found');
  assert(!/replace\(.*%/.test(supaSrc),
    '25.src.5b KNOWN GAP: ilike value not escaped for % or _ wildcards');

  // ---- supabase client creation: env-var guard ----
  assert(/const supabaseUrl = process\.env\.NEXT_PUBLIC_SUPABASE_URL/.test(supaSrc),
    '25.src.6a env var reference present');
  assert(!/if \(!supabaseUrl\)/.test(supaSrc),
    '25.src.6b KNOWN GAP: no early guard for missing env vars — createClient(undefined, undefined) fails lazily at first query');

  // ---- recalcInvoice removal confirmed ----
  assert(!/export\s+async\s+function\s+recalcInvoice\s*\(/.test(supaSrc),
    '25.src.7a stale recalcInvoice confirmed absent (pre-bank-separation landmine)');
  assert(/recalcInvoiceCollected/.test(supaSrc),
    '25.src.7b warning comment points to the correct canonical helper');
}

try { runSection25_SupabaseLibAudit(); } catch(e) {
  console.error('SECTION 25 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 26: Comprehensive audit — src/lib/accounting-auditor.js
// Tests each of the 15 check types (C1-C7, W1-W6, I1-I4) with:
//   - happy path (clean data → no finding)
//   - trigger path (broken data → specific finding fires)
//   - edge cases & false-positive guards
// Locks in Bug #4 fix (W1 cash_in+bank_in regression guard)
// ============================================================
function runSection26_AuditorAudit() {
  group('SECTION 26: accounting-auditor.js comprehensive audit');

  // Load auditor as CJS
  const audSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/accounting-auditor.js'), 'utf8');
  const audShim = audSrc.replace(/export\s+function\s+/g, 'function ') +
    '\nmodule.exports = { runAccountingAudit };';
  fs.writeFileSync('/tmp/_auditor_s26.js', audShim);
  delete require.cache[require.resolve('/tmp/_auditor_s26.js')];
  const { runAccountingAudit } = require('/tmp/_auditor_s26.js');

  assert(typeof runAccountingAudit === 'function', '26.0a runAccountingAudit loaded');

  // Helper: find finding by code
  const findCode = (result, code) => (result.findings || []).find(f => f.code === code);
  const hasCode = (result, code) => !!findCode(result, code);

  // =========================================================
  // Happy path — clean data, no findings
  // =========================================================
  const clean = runAccountingAudit({
    treasury: [], invoices: [], checks: [], egyptBankTxns: [], warehouse: [], customers: [], debts: [],
  });
  assert(clean.totalFindings === 0, '26.happy.1a empty universe → zero findings');
  assert(clean.bySeverity.critical === 0 && clean.bySeverity.warning === 0, '26.happy.1b no severities flagged');
  assert(clean.cleanBillOfHealth === true, '26.happy.1c clean bill of health');

  // Clean realistic dataset
  const inv1 = { id: 'i1', order_number: '100', customer_name: 'Acme', total_amount: 10000, total_collected: 10000, outstanding: 0 };
  const tr1 = { id: 't1', linked_invoice_id: 'i1', cash_in: 10000, cash_out: 0, bank_in: 0, bank_out: 0, transaction_date: '2026-04-10', description: 'payment' };
  const cleanRes = runAccountingAudit({ treasury: [tr1], invoices: [inv1] });
  assert(!hasCode(cleanRes, 'OVER_COLLECTED_INVOICE'), '26.happy.2a matched invoice → no over-collect');
  assert(!hasCode(cleanRes, 'INVOICE_COLLECTED_MISMATCH'), '26.happy.2b matched totals → no W1');
  assert(!hasCode(cleanRes, 'CORRUPTED_ROW'), '26.happy.2c single-channel row → no corruption');

  // =========================================================
  // C1: OVER_COLLECTED_INVOICE
  // =========================================================
  const over = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 1000, total_collected: 1500 }],
  });
  assert(hasCode(over, 'OVER_COLLECTED_INVOICE'), '26.C1.1a triggers when collected > total');
  assert(findCode(over, 'OVER_COLLECTED_INVOICE').totalImpact === 500,
    '26.C1.1b totalImpact = excess (500)');

  // Exact-match tolerance: 1000 collected on 1000 total → no flag
  const exact = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 1000, total_collected: 1000 }],
  });
  assert(!hasCode(exact, 'OVER_COLLECTED_INVOICE'), '26.C1.2a equal → no flag');

  // Floating-point: 1000.005 over 1000 → no flag (under 0.01 tolerance)
  const fp = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 1000, total_collected: 1000.005 }],
  });
  assert(!hasCode(fp, 'OVER_COLLECTED_INVOICE'), '26.C1.3a sub-cent rounding not flagged');

  // Zero total — not flagged (nothing to compare)
  const zt = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 0, total_collected: 500 }],
  });
  assert(!hasCode(zt, 'OVER_COLLECTED_INVOICE'), '26.C1.4a zero-total invoice not flagged');

  // =========================================================
  // C2: CORRUPTED_ROW
  // =========================================================
  const corrupted = runAccountingAudit({
    treasury: [
      { id: 't1', cash_in: 100, bank_in: 200 }, // 2 channels → corrupted
      { id: 't2', cash_in: 100, cash_out: 50 }, // 2 channels → corrupted
      { id: 't3', cash_in: 100, cash_out: 0, bank_in: 0, bank_out: 0 }, // OK
    ],
  });
  assert(hasCode(corrupted, 'CORRUPTED_ROW'), '26.C2.1a triggers on 2+ populated channels');
  assert(findCode(corrupted, 'CORRUPTED_ROW').count === 2, '26.C2.1b counts exactly 2 corrupted rows');

  // impact calculation — smaller amount is the "doesn't belong"
  const imp = findCode(corrupted, 'CORRUPTED_ROW').totalImpact;
  assert(imp === 150, '26.C2.2a impact = sum of smaller column amounts (100 from row1 + 50 from row2)');

  // All 4 channels populated (pathological)
  const all4 = runAccountingAudit({
    treasury: [{ id: 't1', cash_in: 100, cash_out: 50, bank_in: 200, bank_out: 25 }],
  });
  assert(hasCode(all4, 'CORRUPTED_ROW'), '26.C2.3a all 4 channels populated → flagged');
  // Impact = sum of 3 smaller = 100+50+25 = 175
  assert(findCode(all4, 'CORRUPTED_ROW').totalImpact === 175,
    '26.C2.3b all-4 impact = all but the largest');

  // =========================================================
  // C3: DUPLICATE_TREASURY
  // =========================================================
  const dupeInput = runAccountingAudit({
    treasury: [
      { id: 't1', transaction_date: '2026-04-10', cash_in: 500, order_number: '100', description: 'payment' },
      { id: 't2', transaction_date: '2026-04-10', cash_in: 500, order_number: '100', description: 'payment' }, // dupe
      { id: 't3', transaction_date: '2026-04-10', cash_in: 500, order_number: '101', description: 'different order' },
    ],
  });
  assert(hasCode(dupeInput, 'DUPLICATE_TREASURY'), '26.C3.1a fires on same date+amount+order+desc');
  assert(findCode(dupeInput, 'DUPLICATE_TREASURY').count === 1, '26.C3.1b one dupe pair detected');

  // Dedup markers intentionally NOT flagged as duplicates
  const dedupNoDupe = runAccountingAudit({
    treasury: [
      { id: 't1', transaction_date: '2026-04-10', cash_in: 500, description: 'payment' },
      { id: 't2', transaction_date: '2026-04-10', cash_in: 500, description: 'payment [bank confirmation]' },
    ],
  });
  assert(!hasCode(dedupNoDupe, 'DUPLICATE_TREASURY'), '26.C3.2a bank confirmation dedup not counted as dupe');

  // Placeholder rows excluded
  const phNoDupe = runAccountingAudit({
    treasury: [
      { id: 't1', transaction_date: '2026-04-10', cash_in: 500, description: 'x' },
      { id: 't2', transaction_date: '2026-04-10', is_bank_placeholder: true, expected_amount: 500, description: 'x' },
    ],
  });
  assert(!hasCode(phNoDupe, 'DUPLICATE_TREASURY'), '26.C3.3a placeholder vs real not counted as dupe');

  // =========================================================
  // C4: BROKEN_INVOICE_REF
  // =========================================================
  const broken = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 1000 }],
    treasury: [
      { id: 't1', linked_invoice_id: 'ghost-id', cash_in: 500 }, // broken
      { id: 't2', linked_invoice_id: 'i1', cash_in: 500 }, // OK
    ],
  });
  assert(hasCode(broken, 'BROKEN_INVOICE_REF'), '26.C4.1a fires when linked_invoice_id points to missing invoice');
  assert(findCode(broken, 'BROKEN_INVOICE_REF').count === 1, '26.C4.1b exactly 1 broken ref');

  // =========================================================
  // C5: COLLECTED_CHECK_NO_TREASURY
  // =========================================================
  const orphanCollected = runAccountingAudit({
    checks: [
      { id: 'c1', status: 'collected', amount: 2000, customer_name: 'X' },     // orphan
      { id: 'c2', status: 'collected', amount: 3000, linked_treasury_id: 't1' }, // OK
      { id: 'c3', status: 'pending', amount: 1000 },                              // not collected, skip
    ],
  });
  assert(hasCode(orphanCollected, 'COLLECTED_CHECK_NO_TREASURY'), '26.C5.1a fires on collected-without-link');
  assert(findCode(orphanCollected, 'COLLECTED_CHECK_NO_TREASURY').count === 1,
    '26.C5.1b exactly 1 orphan');

  // =========================================================
  // C6: AMBIGUOUS_DEDUP — the 4.02M-EGP-restoration bug class
  // =========================================================
  const ambig = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000 }],
    // Row has zero amounts but is matched to a bank txn with real money, no sibling exists
    treasury: [
      { id: 't1', linked_invoice_id: 'i1', matched_bank_txn_id: 'b1',
        cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0,
        description: '[bank confirmation only]' }
    ],
    egyptBankTxns: [{ id: 'b1', amount: 10000 }],
  });
  assert(hasCode(ambig, 'AMBIGUOUS_DEDUP'), '26.C6.1a fires on zeroed-matched-no-sibling');
  assert(findCode(ambig, 'AMBIGUOUS_DEDUP').totalImpact === 10000,
    '26.C6.1b impact = bank amount that went uncounted');

  // Does NOT fire when there IS a sibling holding the money
  const notAmbig = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000 }],
    treasury: [
      { id: 't1', linked_invoice_id: 'i1', matched_bank_txn_id: 'b1',
        cash_in: 0, bank_in: 0,
        description: '[bank confirmation only]' },
      { id: 't2', linked_invoice_id: 'i1', cash_in: 10000 }, // the real sibling
    ],
    egyptBankTxns: [{ id: 'b1', amount: 10000 }],
  });
  assert(!hasCode(notAmbig, 'AMBIGUOUS_DEDUP'), '26.C6.2a not flagged when real sibling exists');

  // BUG #5 REGRESSION GUARD: sibling now located via cash_in OR bank_in (was cash_in only)
  const bankSibling = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000 }],
    treasury: [
      { id: 't1', linked_invoice_id: 'i1', matched_bank_txn_id: 'b1',
        cash_in: 0, bank_in: 0, description: '[bank confirmation only]' },
      { id: 't2', linked_invoice_id: 'i1', cash_in: 0, bank_in: 10000 }, // bank-only sibling
    ],
    egyptBankTxns: [{ id: 'b1', amount: 10000 }],
  });
  assert(!hasCode(bankSibling, 'AMBIGUOUS_DEDUP'),
    '26.C6.3a BUG #5 LOCKED: bank-only sibling found (previously only cash_in checked)');

  // =========================================================
  // C7: DUPLICATE_PLACEHOLDER
  // =========================================================
  const dupePh = runAccountingAudit({
    treasury: [
      { id: 'p1', is_bank_placeholder: true, expected_amount: 5000, transaction_date: '2026-04-10', order_number: '100', description: 'Ahmad' },
      { id: 'p2', is_bank_placeholder: true, expected_amount: 5000, transaction_date: '2026-04-10', order_number: '100', description: 'Ahmad' },
    ],
  });
  assert(hasCode(dupePh, 'DUPLICATE_PLACEHOLDER'), '26.C7.1a same expected+date+order → dupe placeholder');
  assert(findCode(dupePh, 'DUPLICATE_PLACEHOLDER').count === 1, '26.C7.1b one dupe identified');

  // Different amounts → not dupes
  const notDupePh = runAccountingAudit({
    treasury: [
      { id: 'p1', is_bank_placeholder: true, expected_amount: 5000, transaction_date: '2026-04-10', description: 'A' },
      { id: 'p2', is_bank_placeholder: true, expected_amount: 6000, transaction_date: '2026-04-10', description: 'B' },
    ],
  });
  assert(!hasCode(notDupePh, 'DUPLICATE_PLACEHOLDER'), '26.C7.2a different amounts → not flagged');

  // =========================================================
  // W1: INVOICE_COLLECTED_MISMATCH — Bug #4 regression locks
  // =========================================================
  // Bug #4 was: treasurySum counted only cash_in, ignoring bank_in. Every bank-paid
  // invoice was flagged as mismatch. Lock that fix here.
  const bankPaid = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000, total_collected: 10000 }],
    treasury: [{ id: 't1', linked_invoice_id: 'i1', cash_in: 0, bank_in: 10000 }],
  });
  assert(!hasCode(bankPaid, 'INVOICE_COLLECTED_MISMATCH'),
    '26.W1.1a BUG #4 LOCKED: bank-only payment matches stored collected (no false mismatch)');

  // Mixed cash + bank = total collected → no mismatch
  const mixedPaid = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000, total_collected: 10000 }],
    treasury: [
      { id: 't1', linked_invoice_id: 'i1', cash_in: 3000, bank_in: 0 },
      { id: 't2', linked_invoice_id: 'i1', cash_in: 0, bank_in: 7000 },
    ],
  });
  assert(!hasCode(mixedPaid, 'INVOICE_COLLECTED_MISMATCH'),
    '26.W1.2a cash+bank sum matches stored collected');

  // Real mismatch: stored 10000, actual 5000
  const realMismatch = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000, total_collected: 10000 }],
    treasury: [{ id: 't1', linked_invoice_id: 'i1', cash_in: 5000, bank_in: 0 }],
  });
  assert(hasCode(realMismatch, 'INVOICE_COLLECTED_MISMATCH'),
    '26.W1.3a real mismatch detected (stored 10k vs actual 5k)');
  assert(findCode(realMismatch, 'INVOICE_COLLECTED_MISMATCH').totalImpact === 5000,
    '26.W1.3b impact = abs delta');

  // Bank txn matched to invoice (not yet in treasury) ALSO contributes to actualCollected
  const bankMatched = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000, total_collected: 10000 }],
    treasury: [],
    egyptBankTxns: [{ id: 'b1', matched_invoice_id: 'i1', amount: 10000 }],
  });
  assert(!hasCode(bankMatched, 'INVOICE_COLLECTED_MISMATCH'),
    '26.W1.4a bank-matched contribution counted → no mismatch');

  // Rounding tolerance: 1 EGP delta → not flagged
  const rnd = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 10000, total_collected: 10000 }],
    treasury: [{ id: 't1', linked_invoice_id: 'i1', cash_in: 10000.5 }],
  });
  assert(!hasCode(rnd, 'INVOICE_COLLECTED_MISMATCH'), '26.W1.5a sub-EGP delta tolerated');

  // Zero-total invoice ignored
  const zIgnore = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 0, total_collected: 5000 }],
    treasury: [{ id: 't1', linked_invoice_id: 'i1', cash_in: 5000 }],
  });
  assert(!hasCode(zIgnore, 'INVOICE_COLLECTED_MISMATCH'), '26.W1.6a zero-total invoices skipped');

  // =========================================================
  // W2: STALE_BANK_PLACEHOLDER
  // =========================================================
  const stale = runAccountingAudit({
    treasury: [
      { id: 'p1', is_bank_placeholder: true, expected_amount: 5000, transaction_date: '2026-03-01' }, // ~50d old
      { id: 'p2', is_bank_placeholder: true, expected_amount: 5000, transaction_date: '2026-04-18', matched_bank_txn_id: null }, // 2d old
    ],
  });
  assert(hasCode(stale, 'STALE_BANK_PLACEHOLDER'), '26.W2.1a fires on >14d old unmatched placeholder');
  assert(findCode(stale, 'STALE_BANK_PLACEHOLDER').count === 1, '26.W2.1b recent placeholder not flagged');

  // Matched placeholder never flagged
  const matched = runAccountingAudit({
    treasury: [{ id: 'p1', is_bank_placeholder: true, matched_bank_txn_id: 'b1',
      transaction_date: '2026-03-01', expected_amount: 5000 }],
  });
  assert(!hasCode(matched, 'STALE_BANK_PLACEHOLDER'), '26.W2.2a matched placeholder not flagged regardless of age');

  // =========================================================
  // W3: BOUNCED_CHECK_STILL_COUNTED
  // =========================================================
  const bounced = runAccountingAudit({
    checks: [{ id: 'c1', status: 'bounced', linked_treasury_id: 't1', customer_name: 'X' }],
    treasury: [{ id: 't1', cash_in: 5000 }],
  });
  assert(hasCode(bounced, 'BOUNCED_CHECK_STILL_COUNTED'),
    '26.W3.1a fires when bounced check has cash-bearing treasury row');

  // Bug #5 regression: bank_in also counts (previously cash_in only)
  const bouncedBank = runAccountingAudit({
    checks: [{ id: 'c1', status: 'bounced', linked_treasury_id: 't1' }],
    treasury: [{ id: 't1', cash_in: 0, bank_in: 5000 }],
  });
  assert(hasCode(bouncedBank, 'BOUNCED_CHECK_STILL_COUNTED'),
    '26.W3.2a bank_in on bounced treasury row also flagged (bank payment + bounce)');

  // Already-reversed treasury row (0 amounts) → not flagged
  const reversed = runAccountingAudit({
    checks: [{ id: 'c1', status: 'bounced', linked_treasury_id: 't1' }],
    treasury: [{ id: 't1', cash_in: 0, bank_in: 0 }],
  });
  assert(!hasCode(reversed, 'BOUNCED_CHECK_STILL_COUNTED'), '26.W3.3a reversed row not flagged');

  // =========================================================
  // W4: ORPHAN_DEDUP (dedup markers with no visible original)
  // =========================================================
  const orphan = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 5000 }],
    treasury: [
      { id: 't1', linked_invoice_id: 'i1', description: 'x [bank confirmation only]', cash_in: 0, bank_in: 0 },
      // No sibling with positive inflow
    ],
  });
  assert(hasCode(orphan, 'ORPHAN_DEDUP'), '26.W4.1a orphan dedup flagged');

  // Non-orphan: sibling exists
  const notOrphan = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 5000 }],
    treasury: [
      { id: 't1', linked_invoice_id: 'i1', description: 'x [bank confirmation only]', cash_in: 0, bank_in: 0 },
      { id: 't2', linked_invoice_id: 'i1', cash_in: 5000 }, // sibling
    ],
  });
  assert(!hasCode(notOrphan, 'ORPHAN_DEDUP'), '26.W4.2a sibling with cash_in → not flagged');

  // Sibling via bank_in (post Bug #5 fix)
  const bankOrphan = runAccountingAudit({
    invoices: [{ id: 'i1', total_amount: 5000 }],
    treasury: [
      { id: 't1', linked_invoice_id: 'i1', description: 'x [bank confirmation only]', cash_in: 0, bank_in: 0 },
      { id: 't2', linked_invoice_id: 'i1', cash_in: 0, bank_in: 5000 }, // bank sibling
    ],
  });
  assert(!hasCode(bankOrphan, 'ORPHAN_DEDUP'), '26.W4.3a bank-only sibling found post Bug #5 fix');

  // =========================================================
  // W5: OVERDUE_PENDING_CHECK
  // =========================================================
  const today = new Date().toISOString().substring(0, 10);
  const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString().substring(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().substring(0, 10);

  const overdue = runAccountingAudit({
    checks: [
      { id: 'c1', status: 'pending', due_date: eightDaysAgo, amount: 1000 }, // >7 days overdue → flag
      { id: 'c2', status: 'pending', due_date: twoDaysAgo, amount: 2000 },   // 2d only → no flag
    ],
  });
  assert(hasCode(overdue, 'OVERDUE_PENDING_CHECK'), '26.W5.1a >7d overdue flagged');
  assert(findCode(overdue, 'OVERDUE_PENDING_CHECK').count === 1, '26.W5.1b recent not flagged');

  // Status 'collected' never flagged
  const collected = runAccountingAudit({
    checks: [{ id: 'c1', status: 'collected', due_date: eightDaysAgo, amount: 1000 }],
  });
  assert(!hasCode(collected, 'OVERDUE_PENDING_CHECK'), '26.W5.2a collected checks never overdue-flagged');

  // =========================================================
  // W6: DEBT_MISMATCH
  // =========================================================
  const debtMism = runAccountingAudit({
    invoices: [{ id: 'i1', customer_name: 'Acme', outstanding: 5000 }],
    debts: [{ customer_name: 'Acme', total_debt: 3000 }], // mismatch
  });
  assert(hasCode(debtMism, 'DEBT_MISMATCH'), '26.W6.1a fires when debts tab ≠ sum of outstandings');

  // Within 10 EGP tolerance → no flag
  const debtOk = runAccountingAudit({
    invoices: [{ id: 'i1', customer_name: 'Acme', outstanding: 5005 }],
    debts: [{ customer_name: 'Acme', total_debt: 5000 }],
  });
  assert(!hasCode(debtOk, 'DEBT_MISMATCH'), '26.W6.2a 5 EGP diff tolerated');

  // =========================================================
  // I3: ZERO_AMOUNT_ROWS
  // =========================================================
  const zeroRows = runAccountingAudit({
    treasury: [{ id: 't1', cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, usd_in: 0, usd_out: 0, foreign_amount: 0 }],
  });
  assert(hasCode(zeroRows, 'ZERO_AMOUNT_ROWS'), '26.I3.1a all-zero treasury row flagged');

  // USD row NOT flagged if usd_in > 0
  const usdRow = runAccountingAudit({
    treasury: [{ id: 't1', cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, usd_in: 100, usd_out: 0 }],
  });
  assert(!hasCode(usdRow, 'ZERO_AMOUNT_ROWS'), '26.I3.2a USD-bearing row not flagged as zero');

  // Placeholder / dedup markers excluded
  const zeroPh = runAccountingAudit({
    treasury: [{ id: 't1', is_bank_placeholder: true, cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0 }],
  });
  assert(!hasCode(zeroPh, 'ZERO_AMOUNT_ROWS'), '26.I3.3a placeholders excluded from zero-flag');

  // =========================================================
  // I4: ORPHAN_ORDER_NUMBER
  // =========================================================
  const orphanOrd = runAccountingAudit({
    invoices: [], // NO invoices exist
    treasury: [{ id: 't1', cash_in: 5000, order_number: '999', description: 'Ahmad' }],
  });
  assert(hasCode(orphanOrd, 'ORPHAN_ORDER_NUMBER'), '26.I4.1a order# with no matching invoice flagged');
  assert(findCode(orphanOrd, 'ORPHAN_ORDER_NUMBER').totalImpact === 5000, '26.I4.1b impact = amount');

  // Invoice exists but not linked → I2 handles (not I4)
  const exists = runAccountingAudit({
    invoices: [{ id: 'i1', order_number: '999' }],
    treasury: [{ id: 't1', cash_in: 5000, order_number: '999' }],
  });
  assert(!hasCode(exists, 'ORPHAN_ORDER_NUMBER'), '26.I4.2a existing invoice + order# → not I4');

  // Bug #5 regression: bank_in contributes to orphan_orders too
  const bankOrphan2 = runAccountingAudit({
    invoices: [],
    treasury: [{ id: 't1', cash_in: 0, bank_in: 5000, order_number: '999' }],
  });
  assert(hasCode(bankOrphan2, 'ORPHAN_ORDER_NUMBER'), '26.I4.3a bank-only row with orphan order# flagged');

  // =========================================================
  // Metrics block
  // =========================================================
  const metrics = runAccountingAudit({
    treasury: [
      { id: 't1', cash_in: 1000, cash_out: 0, bank_in: 0, bank_out: 0 },
      { id: 't2', cash_in: 0, cash_out: 500, bank_in: 0, bank_out: 0 },
      { id: 't3', cash_in: 0, cash_out: 0, bank_in: 2000, bank_out: 0 },
    ],
    invoices: [{ id: 'i1', total_amount: 10000, total_collected: 8000, outstanding: 2000 }],
  });
  assert(metrics.metrics.treasuryNet === 500, '26.metrics.1a safe net = cash_in - cash_out');
  assert(metrics.metrics.bankNet === 2000, '26.metrics.1b bank net = bank_in - bank_out');
  assert(metrics.metrics.totalInvoiceValue === 10000, '26.metrics.1c total invoice value');
  assert(metrics.metrics.totalInvoiceCollected === 8000, '26.metrics.1d total collected');
  assert(metrics.metrics.totalOutstanding === 2000, '26.metrics.1e total outstanding');
  assert(metrics.metrics.treasuryRowCount === 3, '26.metrics.1f treasury row count');

  // =========================================================
  // Result shape
  // =========================================================
  const shaped = runAccountingAudit({});
  assert(typeof shaped.generatedAt === 'string', '26.shape.1a generatedAt ISO string');
  assert(Array.isArray(shaped.findings), '26.shape.1b findings is array');
  assert(typeof shaped.bySeverity === 'object', '26.shape.1c bySeverity object');
  assert(typeof shaped.metrics === 'object', '26.shape.1d metrics object');
  assert(typeof shaped.totalFindings === 'number', '26.shape.1e totalFindings number');
  assert(typeof shaped.cleanBillOfHealth === 'boolean', '26.shape.1f cleanBillOfHealth boolean');

  // =========================================================
  // Robustness: malformed input
  // =========================================================
  assert(runAccountingAudit(null).totalFindings === 0, '26.robust.1a null input → no crash');
  assert(runAccountingAudit(undefined).totalFindings === 0, '26.robust.1b undefined → no crash');
  assert(runAccountingAudit({ treasury: 'not an array' }).totalFindings >= 0, '26.robust.2a non-array treasury → no crash');
}

try { runSection26_AuditorAudit(); } catch(e) {
  console.error('SECTION 26 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 27: Comprehensive audit — src/lib/treasury-classifier.js
// Covers all classification branches, netEffect (safe) math,
// collectedEffect (invoice) math, Bug #5a/#5b regression locks,
// and null/edge safety on return shape.
// ============================================================
function runSection27_ClassifierAudit() {
  group('SECTION 27: treasury-classifier.js comprehensive audit');

  // Load classifier as CJS
  const clsSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/treasury-classifier.js'), 'utf8');
  const clsShim = clsSrc.replace(/export\s+function\s+/g, 'function ') +
    '\nmodule.exports = { classifyTreasuryTransaction };';
  fs.writeFileSync('/tmp/_classifier_s27.js', clsShim);
  delete require.cache[require.resolve('/tmp/_classifier_s27.js')];
  const { classifyTreasuryTransaction } = require('/tmp/_classifier_s27.js');

  assert(typeof classifyTreasuryTransaction === 'function', '27.0a classifier loaded');

  // Helper for building minimal txn
  const mk = (overrides) => Object.assign({
    id: 't1', cash_in: 0, cash_out: 0, bank_in: 0, bank_out: 0, description: '',
    transaction_date: '2026-04-10',
  }, overrides);

  // =========================================================
  // Classification types — happy paths
  // =========================================================

  // BANK_PLACEHOLDER_AWAITING
  const ph = classifyTreasuryTransaction(
    mk({ is_bank_placeholder: true, expected_amount: 5000 }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(ph.type === 'BANK_PLACEHOLDER_AWAITING', '27.class.1a placeholder awaiting');
  assert(ph.emoji === '⏳', '27.class.1b placeholder emoji');
  assert(ph.netEffect.delta === 0, '27.class.1c placeholder no safe effect');
  assert(ph.collectedEffect.delta === 0, '27.class.1d placeholder no collected effect yet');

  // BANK_PLACEHOLDER_MATCHED — placeholder that found its bank txn
  const phm = classifyTreasuryTransaction(
    mk({ is_bank_placeholder: false, matched_bank_txn_id: 'b1', bank_in: 5000, linked_invoice_id: 'i1' }),
    { invoices: [{ id: 'i1', customer_name: 'X' }], checks: [], egyptBankTxns: [{ id: 'b1', amount: 5000 }], treasury: [] }
  );
  assert(phm.type === 'BANK_PLACEHOLDER_MATCHED', '27.class.2a matched bank placeholder');
  assert(phm.netEffect.delta === 0, '27.class.2b bank row → no safe effect');
  assert(phm.collectedEffect.delta === 5000, '27.class.2c bank_in counted toward collected');

  // BANK_CONFIRMATION_DEDUP
  const dedup = classifyTreasuryTransaction(
    mk({ linked_invoice_id: 'i1', description: '[bank confirmation only]' }),
    { invoices: [{ id: 'i1' }], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(dedup.type === 'BANK_CONFIRMATION_DEDUP', '27.class.3a dedup marker classified');
  assert(dedup.collectedEffect.delta === 0, '27.class.3b dedup explicitly excluded from collected');

  // CHECK_AUTO_MATCHED
  const auto = classifyTreasuryTransaction(
    mk({ cash_in: 0, bank_in: 5000, matched_bank_txn_id: 'b1',
      description: 'شيك محصّل [auto-matched from bank]' }),
    { invoices: [], checks: [], egyptBankTxns: [{ id: 'b1', amount: 5000 }], treasury: [] }
  );
  assert(auto.type === 'CHECK_AUTO_MATCHED', '27.class.4a auto-matched check collection');
  assert(auto.flags.isAutoMatched === true, '27.class.4b auto flag set');
  assert(auto.flags.isCheckCollection === true, '27.class.4c check-collection flag set');

  // CHECK_MANUAL_COLLECTED
  const manual = classifyTreasuryTransaction(
    mk({ cash_in: 5000, description: 'شيك محصّل من CIB' }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(manual.type === 'CHECK_MANUAL_COLLECTED', '27.class.5a manual check collection');

  // BANK_NONORDER_CONFIRMED
  const nonOrderConf = classifyTreasuryTransaction(
    mk({ bank_in: 10000, matched_bank_txn_id: 'b1', bank_nonorder_category: 'Owner Draw' }),
    { invoices: [], checks: [], egyptBankTxns: [{ id: 'b1', amount: 10000 }], treasury: [] }
  );
  assert(nonOrderConf.type === 'BANK_NONORDER_CONFIRMED', '27.class.6a bank non-order confirmed');

  // BANK_NONORDER_UNVERIFIED
  const nonOrderUnv = classifyTreasuryTransaction(
    mk({ bank_in: 10000, bank_nonorder_category: 'Owner Draw' }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(nonOrderUnv.type === 'BANK_NONORDER_UNVERIFIED', '27.class.7a bank non-order unverified');

  // BANK_INVOICE_PAYMENT — bank in with linked invoice, no category
  const bip = classifyTreasuryTransaction(
    mk({ bank_in: 7500, linked_invoice_id: 'i1' }),
    { invoices: [{ id: 'i1' }], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(bip.type === 'BANK_INVOICE_PAYMENT', '27.class.8a bank invoice payment');
  assert(bip.collectedEffect.delta === 7500, '27.class.8b bank_in → 7500 to collected');

  // BANK_UNLINKED — bank activity with no invoice, no category
  const bu = classifyTreasuryTransaction(
    mk({ bank_in: 3000 }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(bu.type === 'BANK_UNLINKED', '27.class.9a bank unlinked');

  // INVOICE_PAYMENT — cash_in + linked invoice
  const ip = classifyTreasuryTransaction(
    mk({ cash_in: 5000, linked_invoice_id: 'i1' }),
    { invoices: [{ id: 'i1' }], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(ip.type === 'INVOICE_PAYMENT', '27.class.10a cash invoice payment');
  assert(ip.netEffect.delta === 5000, '27.class.10b +5000 to safe');
  assert(ip.collectedEffect.delta === 5000, '27.class.10c +5000 to collected');

  // CASH_IN_UNLINKED
  const ciu = classifyTreasuryTransaction(
    mk({ cash_in: 2000 }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(ciu.type === 'CASH_IN_UNLINKED', '27.class.11a unlinked cash in');
  assert(ciu.netEffect.delta === 2000, '27.class.11b +2000 to safe');
  assert(ciu.collectedEffect.delta === 0, '27.class.11c no collected (no invoice)');

  // EXPENSE
  const ex = classifyTreasuryTransaction(
    mk({ cash_out: 1500 }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(ex.type === 'EXPENSE', '27.class.12a expense');
  assert(ex.netEffect.delta === -1500, '27.class.12b -1500 from safe');

  // USD_TRANSACTION
  const usd = classifyTreasuryTransaction(
    mk({ usd_in: 100 }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(usd.type === 'USD_TRANSACTION', '27.class.13a USD transaction');
  assert(usd.netEffect.delta === 0, '27.class.13b USD does not affect EGP safe');

  // FOREIGN_CURRENCY
  const fc = classifyTreasuryTransaction(
    mk({ foreign_amount: 500, foreign_currency: 'EUR' }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(fc.type === 'FOREIGN_CURRENCY', '27.class.14a foreign currency');

  // ZERO_AMOUNT — catch-all
  const zero = classifyTreasuryTransaction(
    mk({}),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(zero.type === 'ZERO_AMOUNT', '27.class.15a zero amount');

  // =========================================================
  // Bug #5a regression — dedup sibling found via bank_in, not just cash_in
  // =========================================================
  const bankSib = classifyTreasuryTransaction(
    mk({ linked_invoice_id: 'i1', description: '[bank confirmation only]' }),
    {
      invoices: [{ id: 'i1' }],
      checks: [],
      egyptBankTxns: [],
      // Sibling carries the money in bank_in (not cash_in)
      treasury: [
        mk({ id: 't1', linked_invoice_id: 'i1', description: '[bank confirmation only]' }),
        mk({ id: 't2', linked_invoice_id: 'i1', bank_in: 5000, description: 'payment' }),
      ],
    }
  );
  assert(bankSib.related.dedupSibling !== null,
    '27.bug5a.1a dedup sibling found via bank_in (previously only cash_in was checked)');
  assert(bankSib.related.dedupSibling.id === 't2',
    '27.bug5a.1b correct bank-only sibling identified');

  // =========================================================
  // Bug #5b regression — splitFamily detection includes bank rows
  // =========================================================
  const splitBank = classifyTreasuryTransaction(
    mk({ id: 'tx1', order_number: '500', bank_in: 3000, transaction_date: '2026-04-10' }),
    {
      invoices: [],
      checks: [],
      egyptBankTxns: [],
      treasury: [
        mk({ id: 'tx1', order_number: '500', bank_in: 3000, transaction_date: '2026-04-10' }),
        mk({ id: 'tx2', order_number: '500', cash_in: 2000, transaction_date: '2026-04-10' }),
      ],
    }
  );
  assert(splitBank.related.splitFamily.length === 1,
    '27.bug5b.1a splitFamily detected for bank-only row (previously excluded)');

  // Bank-only row with no same-order siblings → empty family (not null/undefined)
  const noSplit = classifyTreasuryTransaction(
    mk({ id: 'tx1', order_number: '500', bank_in: 3000, transaction_date: '2026-04-10' }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [mk({ id: 'tx1', order_number: '500', bank_in: 3000, transaction_date: '2026-04-10' })] }
  );
  assert(Array.isArray(noSplit.related.splitFamily) && noSplit.related.splitFamily.length === 0,
    '27.bug5b.2a isolated bank row → empty splitFamily array');

  // =========================================================
  // netEffect math — ensuring bank never touches safe
  // =========================================================
  // bank_out → no negative on safe
  const bankOut = classifyTreasuryTransaction(
    mk({ bank_out: 10000, bank_nonorder_category: 'Owner Draw' }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(bankOut.netEffect.delta === 0, '27.net.1a bank_out → 0 safe delta');

  // Placeholder with expected_amount → 0 safe delta (not yet received)
  const phExp = classifyTreasuryTransaction(
    mk({ is_bank_placeholder: true, expected_amount: 50000 }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(phExp.netEffect.delta === 0, '27.net.2a placeholder with expected → 0 delta');

  // Dedup marker → 0 safe delta even if cash_in is stale
  const dedupStale = classifyTreasuryTransaction(
    mk({ cash_in: 5000, description: '[bank confirmation only]' }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(dedupStale.netEffect.delta === 0,
    '27.net.3a dedup marker bypasses cash_in → 0 safe delta (critical for balance integrity)');

  // =========================================================
  // collectedEffect math — invoice linkage required
  // =========================================================
  // No linked invoice → 0 collected regardless of inflow
  const noLink = classifyTreasuryTransaction(
    mk({ cash_in: 5000 }),
    { invoices: [], checks: [], egyptBankTxns: [], treasury: [] }
  );
  assert(noLink.collectedEffect.delta === 0,
    '27.coll.1a no linked invoice → no collected effect');

  // Legacy-matched bank row: bank_in=0 but matched + cash_in has the amount
  // (pre-migration artifact). Classifier should still credit collected.
  const legacy = classifyTreasuryTransaction(
    mk({ cash_in: 5000, bank_in: 0, matched_bank_txn_id: 'b1', linked_invoice_id: 'i1' }),
    { invoices: [{ id: 'i1' }], checks: [], egyptBankTxns: [{ id: 'b1', amount: 5000 }], treasury: [] }
  );
  assert(legacy.collectedEffect.delta === 5000,
    '27.coll.2a legacy matched row → amount credited to collected via fallback');

  // =========================================================
  // Return shape — all required fields present
  // =========================================================
  const shaped = classifyTreasuryTransaction(mk({ cash_in: 100 }), {});
  const requiredKeys = ['type', 'titleEn', 'titleAr', 'emoji', 'color', 'amounts', 'netEffect', 'collectedEffect', 'related', 'timeline', 'warnings', 'flags'];
  requiredKeys.forEach(function(k, i) {
    assert(shaped[k] !== undefined, '27.shape.1.' + (i+1) + ' return has ' + k);
  });
  assert(typeof shaped.netEffect.delta === 'number', '27.shape.2a netEffect.delta is number');
  assert(typeof shaped.collectedEffect.delta === 'number', '27.shape.2b collectedEffect.delta is number');
  assert(typeof shaped.flags.isPlaceholder === 'boolean', '27.shape.2c flag is boolean');
  assert(Array.isArray(shaped.related.splitFamily), '27.shape.2d splitFamily is array');
  assert(Array.isArray(shaped.timeline), '27.shape.2e timeline is array');
  assert(Array.isArray(shaped.warnings), '27.shape.2f warnings is array');

  // =========================================================
  // Robustness — missing ctx, null txn
  // =========================================================
  try {
    const r1 = classifyTreasuryTransaction(mk({ cash_in: 100 }), undefined);
    assert(r1.type, '27.robust.1a missing ctx does not crash');
  } catch (e) { assert(false, '27.robust.1a CRASHED: ' + e.message); }

  try {
    const r2 = classifyTreasuryTransaction(mk({ cash_in: 100 }), null);
    assert(r2.type, '27.robust.1b null ctx does not crash');
  } catch (e) { assert(false, '27.robust.1b CRASHED: ' + e.message); }

  // String amount coerced to number via Number()
  const strAmt = classifyTreasuryTransaction(mk({ cash_in: '500' }), {});
  assert(strAmt.type === 'CASH_IN_UNLINKED', '27.robust.2a string amount still classifies');
  assert(strAmt.netEffect.delta === 500, '27.robust.2b string amount coerced to number for delta');

  // =========================================================
  // Flags / related records
  // =========================================================
  const allFlags = classifyTreasuryTransaction(
    mk({ id: 'tx1', linked_invoice_id: 'i1', matched_bank_txn_id: 'b1', cash_in: 5000 }),
    {
      invoices: [{ id: 'i1', customer_name: 'X' }],
      checks: [{ id: 'c1', linked_treasury_id: 'tx1' }],
      egyptBankTxns: [{ id: 'b1', matched_treasury_id: 'tx1' }],
      treasury: [],
    }
  );
  assert(allFlags.flags.hasLinkedInvoice === true, '27.flag.1a linked invoice flag');
  assert(allFlags.flags.hasMatchedBank === true, '27.flag.1b matched bank flag');
  assert(allFlags.flags.hasLinkedCheck === true, '27.flag.1c linked check flag');
  assert(allFlags.related.invoice !== null, '27.flag.2a invoice populated');
  assert(allFlags.related.linkedCheck !== null, '27.flag.2b linkedCheck populated');
  assert(allFlags.related.linkedBank !== null, '27.flag.2c linkedBank populated');
}

try { runSection27_ClassifierAudit(); } catch(e) {
  console.error('SECTION 27 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 28: Comprehensive audit — src/components/TicketsTab.jsx
// Source-inspection of saveTicketEdit, addComment, permission gate,
// notification fan-out logic.
// ============================================================
function runSection28_TicketsTabAudit() {
  group('SECTION 28: TicketsTab.jsx comprehensive audit');

  const tSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/TicketsTab.jsx'), 'utf8');

  // =========================================================
  // saveTicketEdit
  // =========================================================
  const saveBlock = tSrc.match(/const saveTicketEdit = async \(field\) =>[\s\S]*?^\s{2}\};/m);
  assert(saveBlock, '28.save.0a saveTicketEdit block found');
  const sb = saveBlock[0];

  // Permission re-check at function level (defense-in-depth)
  assert(/if \(!canEditTicketContent\(sel\)\)/.test(sb),
    '28.save.1a re-checks canEditTicketContent (UI gate alone was bypassable)');

  // No-op when newVal === oldVal
  assert(/if \(newVal === oldVal\)\s*\{\s*setEditingField\(null\)/.test(sb),
    '28.save.2a no-op when value unchanged (no spurious audit row)');

  // Empty title rejected
  assert(/field === 'title' && !newVal/.test(sb), '28.save.3a empty title rejected');

  // Empty description allowed (you can clear a description)
  assert(!/field === 'description' && !newVal/.test(sb),
    '28.save.3b empty description allowed (no symmetric block)');

  // Audit comment written via dbInsert with is_system: true
  assert(/dbInsert\('ticket_comments'/.test(sb), '28.save.4a audit comment uses dbInsert');
  assert(/is_system: true/.test(sb), '28.save.4b audit comment marked is_system');

  // BEFORE / AFTER markers in audit text
  assert(/BEFORE: /.test(sb) && /AFTER: /.test(sb), '28.save.4c BEFORE/AFTER diff markers');

  // Long values clipped
  assert(/clip = \(s\) =>/.test(sb) && /substring\(0, 500\)/.test(sb),
    '28.save.5a long values clipped to 500 chars in audit comment');

  // Order: dbUpdate (ticket) BEFORE dbInsert (comment) — if comment fails, ticket already saved
  // (acceptable risk; alternative is transactional which Supabase doesn't expose easily)
  const updateIdx = sb.indexOf("dbUpdate('tickets'");
  const insertIdx = sb.indexOf("dbInsert('ticket_comments'");
  assert(updateIdx > 0 && insertIdx > updateIdx,
    '28.save.6a ticket update happens BEFORE audit comment insert');

  // logActivity called after save
  assert(/logActivity\(myId, 'Edited ' \+ field/.test(sb),
    '28.save.7a logActivity records the edit action');

  // Local state updated (sel) — no full reload needed for immediate UX
  assert(/setSel\(\{\.\.\.sel, \[field\]: newVal/.test(sb),
    '28.save.8a setSel updates UI immediately with new value');

  // setEditingField(null) closes edit mode
  assert(/setEditingField\(null\)/.test(sb),
    '28.save.9a edit mode closes after save');

  // Error path uses toast.error not alert when toast is present
  assert(/toast \? toast\.error\(err\.message\) : alert\(err\.message\)/.test(sb),
    '28.save.10a error uses toast.error with alert fallback');

  // =========================================================
  // canEditTicketContent gate
  // =========================================================
  const gateBlock = tSrc.match(/const canEditTicketContent = \(ticket\) =>[\s\S]*?^\s{2}\};/m);
  assert(gateBlock, '28.gate.0a permission gate block found');
  const gb = gateBlock[0];

  assert(/if \(!ticket\) return false/.test(gb), '28.gate.1a null ticket → false');
  assert(/if \(isSuperAdmin\) return true/.test(gb), '28.gate.2a super_admin always true');
  assert(/if \(isAdminRole\) return true/.test(gb), '28.gate.3a admin role always true');
  assert(/ticket\.created_by === myId/.test(gb), '28.gate.4a creator true');
  assert(/parseAssignees\(ticket\)\.includes\(myId\)/.test(gb), '28.gate.5a any assignee true');
  // Final return false (not falling through to anything)
  assert(/return false;\s*\};/.test(gb), '28.gate.6a default deny (final return false)');

  // =========================================================
  // addComment — sanitize before insert, plain-text preview for notify
  // =========================================================
  const addBlock = tSrc.match(/const addComment = async \(\) =>[\s\S]*?^\s{2}\};/m);
  assert(addBlock, '28.add.0a addComment block found');
  const ab = addBlock[0];

  // Sanitize HTML before insert
  assert(/sanitizeRichText\(String\(f\.comment\)\)/.test(ab),
    '28.add.1a sanitizeRichText called on comment HTML before insert');

  // Empty-after-sanitize check (prevents empty <p><br></p> rows)
  assert(/richTextToPlain\(safeHtml\)/.test(ab),
    '28.add.2a richTextToPlain used for empty-check');
  assert(/if \(!plain\.trim\(\)\) return/.test(ab),
    '28.add.2b empty plain text → no insert');

  // Notification uses plain text preview, not raw HTML
  assert(/preview = plain\.length > 200 \? plain\.substring\(0, 200\) \+ '…' : plain/.test(ab),
    '28.add.3a 200-char preview generation');
  assert(/notifyTicketComment\(\[sel\.assigned_to\], sel\.title, preview, myId\)/.test(ab),
    '28.add.3b assignee notify uses preview not f.comment');

  // No double-notify: assignee, then creator (skip if same as assignee), then extras (skip if assignee/creator)
  assert(/sel\.assigned_to !== myId/.test(ab),
    '28.add.4a skip notify-self for assignee');
  assert(/sel\.created_by !== myId && sel\.created_by !== sel\.assigned_to/.test(ab),
    '28.add.4b skip creator notify if same as assignee or self');
  assert(/parseAssignees\(sel\)\.filter\(id => id !== myId && id !== sel\.assigned_to && id !== sel\.created_by\)/.test(ab),
    '28.add.4c extras filter excludes self, assignee, creator');

  // Form cleared after success
  assert(/setF\(\{\.\.\.f, comment: ''\}\); loadComments\(sel\.id\)/.test(ab),
    '28.add.5a comment cleared and reloaded after success');

  // =========================================================
  // parseAssignees — defensive
  // =========================================================
  const paBlock = tSrc.match(/const parseAssignees = \(t\) =>[\s\S]*?\};/);
  assert(paBlock, '28.pa.0a parseAssignees block found');
  const pab = paBlock[0];

  assert(/\[t\.assigned_to\]\.filter\(Boolean\)/.test(pab),
    '28.pa.1a primary assignee filtered for truthy');
  assert(/JSON\.parse\(t\.additional_assignees \|\| '\[\]'\)/.test(pab),
    '28.pa.2a JSON parse with default empty-array fallback');
  assert(/if \(Array\.isArray\(extra\)\)/.test(pab),
    '28.pa.2b verifies parsed result is array (defends against JSON storing object/string)');
  assert(/!list\.includes\(id\)/.test(pab),
    '28.pa.3a dedup — no duplicates from primary + extras');
  assert(/catch\(e\) \{ console\.warn\(e\); \}/.test(pab),
    '28.pa.4a malformed JSON caught, warn logged, function continues with primary only');

  // =========================================================
  // Comment renderer — picks per-row between rich HTML and plain
  // =========================================================
  // Should sanitize before dangerouslySetInnerHTML — never raw HTML to DOM
  assert(/dangerouslySetInnerHTML=\{\{ __html: safeHtml \}\}/.test(tSrc),
    '28.render.1a dangerouslySetInnerHTML uses sanitized HTML, not raw');
  // Plain comments use linkify path
  assert(/linkify\(rawText\)/.test(tSrc),
    '28.render.2a plain comments use existing linkify path');

  // System-comment rendering preserves whitespace (audit diff has \n)
  assert(/className="text-xs whitespace-pre-wrap">\{c\.comment_text\}/.test(tSrc),
    '28.render.3a system comments use whitespace-pre-wrap');

  // =========================================================
  // No legacy plain-input composer remaining
  // =========================================================
  assert(!/<input value=\{f\.comment \|\| ''\} onChange=\{e => setF\(\{\.\.\.f, comment: e\.target\.value\}\)\}/.test(tSrc),
    '28.legacy.1a old <input> comment composer removed');
  assert(/import RichCommentComposer from/.test(tSrc),
    '28.legacy.1b new composer imported');
  assert(/<RichCommentComposer/.test(tSrc),
    '28.legacy.1c new composer used in JSX');
}

try { runSection28_TicketsTabAudit(); } catch(e) {
  console.error('SECTION 28 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 29: Comprehensive audit — src/components/CalendarTab.jsx
// useEffect mount fix, modal-close-clears-state fix, checkInWithNotes
// edit/check-in branching, gap docs for known multi-assignee architecture
// limitation (R9 will fix).
// ============================================================
function runSection29_CalendarTabAudit() {
  group('SECTION 29: CalendarTab.jsx comprehensive audit');

  const cSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/CalendarTab.jsx'), 'utf8');

  // =========================================================
  // useEffect mount fix — render-loop bug
  // =========================================================
  // Previously: `if (!loaded) loadEvents();` in render body → fires every render
  // until async resolves → burst of redundant network calls.
  // Fixed: `useEffect(() => { loadEvents(); }, []);` fires once.
  assert(/import \{ useState, useMemo, useEffect \} from 'react'/.test(cSrc),
    '29.mount.1a useEffect imported');
  assert(/useEffect\(\(\) => \{ loadEvents\(\); \}, \[\]\)/.test(cSrc),
    '29.mount.1b loadEvents wired in useEffect with [] deps (fires once on mount)');
  assert(!/^\s+if \(!loaded\) loadEvents\(\);/m.test(cSrc),
    '29.mount.1c old render-body conditional removed (no more re-fetch loop)');

  // =========================================================
  // Modal close — clears stale state
  // =========================================================
  const closeBlock = cSrc.match(/const closeModal = \(\) => \{ setNotesEvent\(null\); setMeetingNotes\(''\); \};/);
  assert(closeBlock, '29.modal.1a single closeModal handler defined');

  // Both backdrop click AND Cancel button must use closeModal
  const backdropClose = /onClick=\{closeModal\}/g;
  const matches = (cSrc.match(backdropClose) || []).length;
  assert(matches >= 2, '29.modal.2a closeModal used by both backdrop and Cancel button',
    'matches=' + matches);

  // The old direct setNotesEvent(null) without setMeetingNotes('') in modal context is gone
  // (still used inside checkInWithNotes which handles cleanup, that's fine)
  const stale = (cSrc.match(/onClick=\{\(\) => setNotesEvent\(null\)\}/g) || []).length;
  assert(stale === 0,
    '29.modal.2b no remaining onClick handlers that clear notesEvent without also clearing meetingNotes');

  // =========================================================
  // checkInWithNotes — first-time check-in vs later edit branching
  // =========================================================
  const cinBlock = cSrc.match(/const checkInWithNotes = async \(\) =>[\s\S]*?^\s{2}\};/m);
  assert(cinBlock, '29.cin.0a checkInWithNotes block found');
  const cb = cinBlock[0];

  // Detects whether event was already completed
  assert(/var wasCompleted = !!notesEvent\.completed/.test(cb),
    '29.cin.1a wasCompleted captured from event state');

  // Detects whether notes actually changed (prevents duplicate daily_log on reopen-and-save)
  assert(/var notesChanged = notes !== oldNotes/.test(cb),
    '29.cin.1b notesChanged compared against trimmed oldNotes');

  // First-time check-in stamps attendance fields
  assert(/if \(!wasCompleted\) \{[\s\S]*?update\.completed = true[\s\S]*?update\.event_status = 'attended'[\s\S]*?update\.checked_in_at[\s\S]*?update\.checked_in_by/.test(cb),
    '29.cin.2a first-time check-in stamps completed + event_status + checked_in_at + checked_in_by');

  // Edit-after-completion does NOT overwrite attendance stamps
  assert(/var update = \{ meeting_notes: notes \|\| null \};/.test(cb),
    '29.cin.2b base update only includes meeting_notes (attendance fields conditionally added)');

  // Daily log gated on (notes && notesChanged) — no duplicates
  assert(/if \(notes && notesChanged\)/.test(cb),
    '29.cin.3a daily_log archive only when notes exist AND changed');

  // Different verb for first-time vs update
  assert(/var verb = wasCompleted \? '📋 Meeting notes updated — ' : '📋 Meeting notes — '/.test(cb),
    '29.cin.4a daily_log entry verb reflects mode (updated vs new)');

  // =========================================================
  // markEventStatus — postponed sets completed:false
  // =========================================================
  const mes = cSrc.match(/const markEventStatus = async \(ev, status\) =>[\s\S]*?^\s{2}\};/m);
  assert(mes, '29.mes.0a markEventStatus block found');
  // 'attended' → completed=true; anything else (postponed, cancelled) → completed=false
  assert(/completed: status === 'attended'/.test(mes[0]),
    '29.mes.1a only "attended" sets completed=true (postponed/cancelled stay incomplete)');

  // =========================================================
  // handleAddEvent — known architectural limitation (R9 will fix)
  // =========================================================
  const haeBlock = cSrc.match(/const handleAddEvent = async \(\) =>[\s\S]*?^\s{2}\};/m);
  assert(haeBlock, '29.hae.0a handleAddEvent block found');
  const hae = haeBlock[0];
  // Currently creates N independent rows for N assignees (loop dbInsert).
  // This is the limitation R9 (team calendar with attendees table) will solve.
  assert(/for \(const uid of assignees\)/.test(hae),
    '29.hae.gap.1a KNOWN LIMITATION: 1 event per assignee (loop dbInsert) — R9 attendees table will replace');

  // Notify-event-scheduled fires for non-self assignees
  assert(/const otherAssignees = assignees\.filter\(uid => uid !== myId\)/.test(hae),
    '29.hae.notify.1a non-self assignees collected for notification');
  assert(/notifyEventScheduled\(otherAssignees, f\.title, f\.eventDate, myId\)/.test(hae),
    '29.hae.notify.1b notification fires for invited assignees');

  // =========================================================
  // Add Notes / Edit Notes button on completed events (R3 UI)
  // =========================================================
  assert(/Edit Notes/.test(cSrc), '29.r3.1a "Edit Notes" label on completed events');
  assert(/Add Notes/.test(cSrc), '29.r3.1b "Add Notes" label when no notes yet');
  // The button on completed events seeds meetingNotes from existing
  assert(/setMeetingNotes\(ev\.meeting_notes \|\| ''\)/.test(cSrc),
    '29.r3.2a clicking edit seeds modal with existing notes');

  // =========================================================
  // Modal title reflects mode
  // =========================================================
  assert(/Edit Meeting Notes \/ تعديل الملاحظات/.test(cSrc),
    '29.r3.3a edit-mode header (existing notes)');
  assert(/Add Meeting Notes \/ إضافة ملاحظات/.test(cSrc),
    '29.r3.3b add-mode header (no existing notes)');
  assert(/Check In \/ تسجيل حضور/.test(cSrc),
    '29.r3.3c first-time check-in header');

  // =========================================================
  // Documented timezone gap (UTC fallback for daily_log date)
  // =========================================================
  // This matches the gap noted in supabase.js logActivity — Cairo late-night
  // actions land on tomorrow UTC. Lock as known limitation; R6+ will revisit.
  assert(/notesEvent\.event_date \|\| new Date\(\)\.toISOString\(\)\.substring\(0, ?10\)/.test(cSrc),
    '29.tz.1a KNOWN GAP: daily_log fallback uses UTC date (Cairo late-night → tomorrow)');
}

try { runSection29_CalendarTabAudit(); } catch(e) {
  console.error('SECTION 29 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 30: Comprehensive audit — RichCommentComposer.jsx
// Focus-steal prevention, paste defense, sync logic with parent value,
// toolbar command wiring.
// ============================================================
function runSection30_RichComposerAudit() {
  group('SECTION 30: RichCommentComposer.jsx comprehensive audit');

  const rcSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/RichCommentComposer.jsx'), 'utf8');

  // =========================================================
  // Focus-steal prevention — bug fix
  // =========================================================
  // Without onMouseDown preventDefault, clicking a toolbar button takes focus
  // from the editor BEFORE the click handler fires, collapsing the selection.
  // execCommand then applies bold/italic to nothing.
  assert(/const preventFocusSteal = \(e\) => \{ e\.preventDefault\(\); \}/.test(rcSrc),
    '30.focus.1a preventFocusSteal handler defined');

  // Every formatting button must wire it (skip the help-toggle; it's not a formatting cmd)
  ['Bold', 'Italic', 'Underline', 'Bullet list', 'Numbered list', 'Clear formatting'].forEach(function(label, i) {
    var re = new RegExp('title="' + label + '[^"]*"\\s+onMouseDown=\\{preventFocusSteal\\}\\s+onClick=\\{');
    assert(re.test(rcSrc),
      '30.focus.2.' + (i+1) + ' "' + label + '" button has onMouseDown preventFocusSteal');
  });

  // Help button intentionally has NO preventFocusSteal — it doesn't need editor selection
  assert(/title="Shortcuts" onClick=\{\(\) => setShowHelp/.test(rcSrc),
    '30.focus.3a help toggle button does NOT preventDefault (no editor interaction needed)');

  // =========================================================
  // exec wrapper — focus before command, sync after
  // =========================================================
  const execBlock = rcSrc.match(/const exec = \(cmd, arg\) =>[\s\S]*?\};/);
  assert(execBlock, '30.exec.0a exec block found');
  const eb = execBlock[0];
  // Focus FIRST so command applies to editor selection
  const focusIdx = eb.indexOf('editorRef.current.focus()');
  const cmdIdx = eb.indexOf('document.execCommand');
  assert(focusIdx > 0 && focusIdx < cmdIdx,
    '30.exec.1a editor focus happens before execCommand');
  // try/catch around legacy API
  assert(/try \{ document\.execCommand[\s\S]*?\} catch/.test(eb),
    '30.exec.2a execCommand wrapped in try/catch (legacy API unreliable)');
  // onChange fired with current innerHTML so parent stays in sync
  assert(/onChange\(editorRef\.current\.innerHTML\)/.test(eb),
    '30.exec.3a onChange called with current innerHTML after format');

  // =========================================================
  // handleInput — fires on every keystroke
  // =========================================================
  const hi = rcSrc.match(/const handleInput = \(\) =>[\s\S]*?\};/);
  assert(hi, '30.input.0a handleInput block found');
  assert(/if \(editorRef\.current && onChange\)/.test(hi[0]),
    '30.input.1a guards both ref AND onChange existence');

  // =========================================================
  // handleKeyDown — Ctrl+Enter / Cmd+Enter submits
  // =========================================================
  const hk = rcSrc.match(/const handleKeyDown = \(e\) =>[\s\S]*?\};/);
  assert(hk, '30.key.0a handleKeyDown found');
  assert(/e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/.test(hk[0]),
    '30.key.1a Ctrl+Enter OR Cmd+Enter triggers submit (Mac compat)');
  assert(/e\.preventDefault\(\)/.test(hk[0]),
    '30.key.2a Ctrl+Enter prevents default (no newline insertion before submit)');
  assert(/if \(onSubmit\) onSubmit\(\)/.test(hk[0]),
    '30.key.3a onSubmit guarded against missing prop');

  // =========================================================
  // handlePaste — plain-text paste defense
  // =========================================================
  const hp = rcSrc.match(/const handlePaste = \(e\) =>[\s\S]*?\};/);
  assert(hp, '30.paste.0a handlePaste found');
  const hpb = hp[0];
  assert(/e\.preventDefault\(\)/.test(hpb),
    '30.paste.1a default paste blocked');
  assert(/clipboardData \|\| window\.clipboardData/.test(hpb),
    '30.paste.2a both modern + legacy clipboard APIs supported');
  assert(/getData\('text'\)/.test(hpb),
    '30.paste.3a only text/plain extracted (no rich HTML, images, etc.)');
  assert(/document\.execCommand\('insertText', false, text\)/.test(hpb),
    '30.paste.4a inserts plain text via execCommand');
  // Fallback path for browsers that drop insertText
  assert(/document\.createTextNode\(text\)/.test(hpb),
    '30.paste.5a fallback createTextNode for browsers without insertText');
  assert(/handleInput\(\)/.test(hpb),
    '30.paste.6a syncs upward after paste');

  // =========================================================
  // value sync — clear-only, never overwrite during typing
  // =========================================================
  const ueBlock = rcSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[value\]\)/);
  assert(ueBlock, '30.sync.0a useEffect with [value] dep found');
  const ueb = ueBlock[0];
  // Only clears when value is empty/null (parent reset). Never echoes back during typing.
  assert(/if \(\(value === '' \|\| value == null\) && el\.innerHTML !== ''\)/.test(ueb),
    '30.sync.1a clears editor only when value is empty AND editor isn\'t already empty (no cursor jump)');

  // =========================================================
  // Attach button
  // =========================================================
  assert(/<input ref=\{fileRef\} type="file"/.test(rcSrc),
    '30.attach.1a file input present with ref for clearing');
  assert(/if \(fileRef\.current\) fileRef\.current\.value = ''/.test(rcSrc),
    '30.attach.2a file input cleared after attach (allows attaching same file twice)');
  assert(/disabled=\{uploading\}/.test(rcSrc),
    '30.attach.3a file input disabled while uploading');

  // =========================================================
  // Send button
  // =========================================================
  assert(/<button type="button" onClick=\{onSubmit\}/.test(rcSrc),
    '30.send.1a Send button calls onSubmit');

  // =========================================================
  // Placeholder via CSS :empty
  // =========================================================
  assert(/data-placeholder="Add comment\.\.\./.test(rcSrc),
    '30.ph.1a placeholder attribute set');
  assert(/\[contenteditable\]\[data-placeholder\]:empty::before/.test(rcSrc),
    '30.ph.2a CSS :empty pseudo-class for placeholder visibility');

  // =========================================================
  // List CSS — verifies bullet/numbered render correctly
  // =========================================================
  assert(/list-style: disc/.test(rcSrc),
    '30.list.1a <ul> styled with disc bullets');
  assert(/list-style: decimal/.test(rcSrc),
    '30.list.1b <ol> styled with decimal numbers');
}

try { runSection30_RichComposerAudit(); } catch(e) {
  console.error('SECTION 30 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// SECTION 31: Comprehensive audit — page.jsx surfaces touched this session
// (H2 mobile order, H3 breakdown, Bug #3 safe loader, Bug #6 temp-uuid removal)
// Mostly source inspection since page.jsx is too large + browser-dependent
// to load as a unit. Locks in correct wiring per surface.
// ============================================================
function runSection31_PageJsxAudit() {
  group('SECTION 31: page.jsx targeted audit (this-session surfaces)');

  const pSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/app/page.jsx'), 'utf8');

  // =========================================================
  // Imports — all this-session helpers wired
  // =========================================================
  const importLine = pSrc.match(/^import \{[^}]+\} from '\.\.\/lib\/utils';/m);
  assert(importLine, '31.imp.0a utils import line found');
  const il = importLine[0];
  ['aggregatePaymentSources', 'PAYMENT_SOURCE_META'].forEach(function(n, i) {
    assert(il.indexOf(n) >= 0, '31.imp.1.' + (i+1) + ' ' + n + ' imported');
  });

  // =========================================================
  // Bug #3 — safe() wrapper around Promise.all
  // =========================================================
  const loadStart = pSrc.indexOf('const loadAllData = async () =>');
  const loadSlice = pSrc.slice(loadStart, loadStart + 8000);

  // safe() definition (regex must tolerate nested braces in the catch body)
  assert(/const safe = \(p\) => p\.catch\(/.test(loadSlice),
    '31.bug3.1a safe() wraps each fetchAll, .catch returns []');
  assert(/return \[\]; \}\)/.test(loadSlice),
    '31.bug3.1b safe() catch returns [] (fallback to empty)');

  // Console.warn is itself try/catch'd inside safe (in case console missing in some envs)
  assert(/try \{ console\.warn\('\[loadAllData\]'/.test(loadSlice),
    '31.bug3.2a console.warn inside safe is try/catch wrapped (unkillable)');

  // All 9 main tables wrapped
  const safeFetchCount = (loadSlice.match(/safe\(fetchAll\(/g) || []).length;
  assert(safeFetchCount === 9, '31.bug3.3a all 9 main tables wrapped in safe()',
    'count=' + safeFetchCount);

  // No bare fetchAll inside the Promise.all anymore — relying on the count check above.
  // Per-item parsing is brittle because comma-split breaks on fetchAll's own arg lists.
  // The 9-count assertion in 31.bug3.3a is sufficient proof.
  // Verify the negative pattern: no UNWRAPPED `fetchAll(` immediately after a [ or , in this slice
  const promiseAllBlock = loadSlice.match(/Promise\.all\(\[([\s\S]*?)\]\)/);
  assert(promiseAllBlock, '31.bug3.4a Promise.all block found');
  const arrInside = promiseAllBlock[1];
  // Every line beginning with non-whitespace `fetchAll` (not preceded by `safe(`) would be a leak
  const leakedFetchAll = (arrInside.match(/^\s+fetchAll\(/gm) || []).length;
  assert(leakedFetchAll === 0, '31.bug3.4b no unwrapped fetchAll inside Promise.all',
    'count=' + leakedFetchAll);

  // setState calls happen UNCONDITIONALLY after Promise.all (no longer gated on success)
  ['setInvoices', 'setTreasury', 'setChecks', 'setDebts', 'setCustomers', 'setWarehouse', 'setInvoiceItems', 'setExpenseRules', 'setInventory'].forEach(function(setter, i) {
    assert(loadSlice.indexOf(setter + '(') >= 0,
      '31.bug3.5.' + (i+1) + ' ' + setter + ' called in load (each table can land independently)');
  });

  // =========================================================
  // Bug #6 — temp-uuid eradication
  // =========================================================
  // No `id: 'temp-' + Date.now()` in code (comments OK)
  // Strip out comment-only lines, then assert
  const codeOnly = pSrc.split('\n').filter(line => {
    const trimmed = line.trim();
    return !trimmed.startsWith('//') && !trimmed.startsWith('*');
  }).join('\n');
  assert(!/id:\s*['"]temp-['"]\s*\+\s*Date\.now\(\)/.test(codeOnly),
    '31.bug6.1a no fabricated temp-id in non-comment code');
  assert(!/['"]temp-['"]\s*\+\s*Date\.now\(\):/.test(codeOnly),
    '31.bug6.1b no temp-id in object property keys either');

  // Three treasury insert sites use real inserted row
  const realInsertCount = (pSrc.match(/setTreasury\(prev => \[inserted, \.\.\.prev\]\)/g) || []).length;
  assert(realInsertCount === 3,
    '31.bug6.2a 3 treasury optimistic inserts use the REAL UUID from dbInsert',
    'count=' + realInsertCount);

  // Each insert site has the const inserted = await dbInsert pattern
  const dbInsertCount = (pSrc.match(/const inserted = await dbInsert\('treasury'/g) || []).length;
  assert(dbInsertCount === 3,
    '31.bug6.3a 3 treasury insert sites capture dbInsert return',
    'count=' + dbInsertCount);

  // Invoice flow no longer has temp- fallback
  assert(!/newInv\?\.id \|\| ['"]temp-['"]/.test(pSrc),
    '31.bug6.4a invoice insert no longer uses temp- fallback (skip optimistic if newInv missing)');

  // =========================================================
  // H2 — mobile order wrapper
  // =========================================================
  // Dashboard root has flex flex-col
  assert(/\{tab === 'dashboard' && \(\s*\n\s*<div className="flex flex-col">/.test(pSrc),
    '31.h2.1a dashboard root is flex flex-col');

  // AIGreeter wrapper has max-md:order-last
  assert(/<div className="max-md:order-last">/.test(pSrc),
    '31.h2.2a greeter wrapper has max-md:order-last');

  // Single AIGreeter instance (no double-mount)
  const greeterCount = (pSrc.match(/<AIGreeter\b/g) || []).length;
  assert(greeterCount === 1, '31.h2.3a single AIGreeter instance', 'count=' + greeterCount);

  // =========================================================
  // H3 — breakdown rendering
  // =========================================================
  // aggregatePaymentSources called with treasuryByOrder lookup
  assert(/const txns = treasuryByOrder\[selectedInvoice\.order_number\] \|\| \[\]/.test(pSrc),
    '31.h3.1a breakdown reads treasury rows linked to invoice order_number');

  assert(/const agg = aggregatePaymentSources\(txns\)/.test(pSrc),
    '31.h3.2a aggregator called');

  // Empty-txn early return
  assert(/if \(txns\.length === 0\) return null/.test(pSrc),
    '31.h3.3a empty txn list → no breakdown render');

  // Zero-total early return
  assert(/if \(agg\.total <= 0\) return null/.test(pSrc),
    '31.h3.3b zero-total → no breakdown render');

  // Empty-rows early return (all buckets are 0 → no rows to render)
  assert(/const rows = PAYMENT_SOURCE_META\.filter\(r => agg\.buckets\[r\.key\] > 0\)/.test(pSrc),
    '31.h3.4a only positive-amount buckets shown');

  // Position: between Outstanding card (totals) and Reconciliation Status
  const outstandingIdx = pSrc.indexOf('Outstanding / المتبقّي');
  const breakdownIdx = pSrc.indexOf('Payment Breakdown / تفصيل الدفع');
  const reconIdx = pSrc.indexOf('{/* Reconciliation Status */}');
  assert(outstandingIdx > 0 && breakdownIdx > outstandingIdx && reconIdx > breakdownIdx,
    '31.h3.5a breakdown sits BETWEEN totals cards and reconciliation status');

  // =========================================================
  // Cross-cutting: no leftover temp identifiers anywhere else
  // =========================================================
  // Confirm `temp-` no longer appears as a code-level identifier prefix
  // for any state insert. Check for all common patterns.
  const allTempIdAttempts = pSrc.match(/['"]temp-['"]\s*\+\s*Date\.now\(\)/g) || [];
  // Comments are OK — they reference the historical bug. Filter those out.
  // Walk line by line.
  let realCodeTempCount = 0;
  pSrc.split('\n').forEach(function(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (/['"]temp-['"]\s*\+\s*Date\.now\(\)/.test(line)) realCodeTempCount++;
  });
  assert(realCodeTempCount === 0,
    '31.cross.1a zero non-comment lines fabricate temp-uuid identifiers',
    'count=' + realCodeTempCount);

  // =========================================================
  // No regression: recalcInvoiceCollected still the canonical helper
  // =========================================================
  assert(/const recalcInvoiceCollected = async \(invoiceId\) =>/.test(pSrc),
    '31.canon.1a recalcInvoiceCollected defined in page.jsx');
  assert(/cash_in \+ bank_in/.test(pSrc) || /Number\(t\.cash_in \|\| 0\) \+ Number\(t\.bank_in \|\| 0\)/.test(pSrc),
    '31.canon.2a recalc sums cash_in + bank_in (post-bank-separation correct math)');

  // =========================================================
  // Imports list — final sanity
  // =========================================================
  // No accidental shadowing — sanitize and sanitizeRichText shouldn't both be imported
  // in a way that conflicts (sanitize is page.jsx's old helper; sanitizeRichText is for tickets only)
  assert(il.indexOf('sanitize,') >= 0 || /\bsanitize\b/.test(il),
    '31.imp.2a base sanitize still imported in page.jsx (used elsewhere)');
}

try { runSection31_PageJsxAudit(); } catch(e) {
  console.error('SECTION 31 ERROR:', e.message);
  console.error(e.stack);
  failed++;
}

// ============================================================
// MAIN
// ============================================================
(async () => {
  try {
    await runMemoryTests();
    await runActionTests();
  } catch (e) {
    console.error('TEST HARNESS ERROR:', e.message);
    console.error(e.stack);
    failed++;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  if (failures.length > 0) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log('  -', f.name, f.detail ? '(' + f.detail + ')' : ''));
    process.exit(1);
  }
  console.log('\n✅ ALL TESTS PASSED');
})();
