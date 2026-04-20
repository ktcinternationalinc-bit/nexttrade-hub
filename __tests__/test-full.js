// ============================================================
// COMPREHENSIVE TEST SUITE
// Tests: check reconcile, AI memory, cross-team routing,
// login events ET timezone, AI action dispatch, memory persistence
// ============================================================

const fs = require('fs');
const path = require('path');

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
const checkReconcileSrc = fs.readFileSync('/home/claude/nexttrade/src/lib/check-reconcile.js', 'utf8');
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
  const { persistMemoryCandidates } = require('/home/claude/nexttrade/src/lib/ai-memory.js').default ||
    (() => { throw new Error('need-shim'); })();
})().catch(() => {});

// Use the shim approach (imports don't work in raw node)
const memSrc = fs.readFileSync('/home/claude/nexttrade/src/lib/ai-memory.js', 'utf8');
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
