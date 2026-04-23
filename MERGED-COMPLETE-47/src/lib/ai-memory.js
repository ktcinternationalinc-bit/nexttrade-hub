// ============================================================
// AI MEMORY — writer / reader / settings helpers
// Used by /api/ask and AIAssistant component.
// SERVER-SIDE ONLY (uses service-role supabase client).
// ============================================================

// Load super-admin settings. Always returns defaults if the row is missing.
export async function loadMemorySettings(supabase) {
  try {
    var r = await supabase.from('ai_memory_settings').select('*').eq('id', 1).maybeSingle();
    if (r && r.data) return r.data;
  } catch (e) {}
  return {
    auto_capture_enabled: true,
    capture_urgent: true,
    capture_meetings: true,
    capture_reminders: true,
    capture_notes: true,
    capture_follow_ups: true,
    default_note_retention_days: 30,
    cross_user_read: 'team_only',
    morning_briefing_enabled: true,
    briefing_hour_local: 8,
    max_memory_items_per_user: 500,
  };
}


// Load this user's active memory items + items targeted AT them by others.
// Filters dismissed and expired. Applies settings.cross_user_read to gate
// cross-user visibility.
export async function loadMemoryForUser(supabase, userId, settings) {
  if (!userId) return { own: [], targetedAtMe: [] };
  var nowIso = new Date().toISOString();
  var own = [];
  var targetedAtMe = [];
  try {
    var r1 = await supabase.from('ai_memory')
      .select('*')
      .eq('user_id', userId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    own = (r1.data || []).filter(function (m) {
      if (m.type === 'urgent') return true; // urgent never auto-hides
      if (!m.expires_at) return true;
      return m.expires_at > nowIso;
    });
  } catch (e) {}
  // Items targeted at this user
  if (settings && settings.cross_user_read !== 'disabled') {
    try {
      var r2 = await supabase.from('ai_memory')
        .select('*')
        .eq('target_user_id', userId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .limit(100);
      targetedAtMe = (r2.data || []).filter(function (m) {
        if (m.user_id === userId) return false; // already in own
        if (m.scope === 'private') return false;
        if (m.type === 'urgent') return true;
        if (!m.expires_at) return true;
        return m.expires_at > nowIso;
      });
    } catch (e) {}
  }
  return { own: own, targetedAtMe: targetedAtMe };
}


// Package memory + surrounding context into a system-prompt addendum.
// Returns plain-text block ready to append to Claude's system prompt.
export async function buildMemoryContext(supabase, userId, userProfile) {
  var settings = await loadMemorySettings(supabase);
  var mem = await loadMemoryForUser(supabase, userId, settings);

  var nowIso = new Date().toISOString();
  var today = nowIso.substring(0, 10);

  // Open urgent tickets assigned to this user
  var urgentTickets = [];
  try {
    var tk = await supabase.from('tickets')
      .select('id, title, priority, status, due_date')
      .eq('assigned_to', userId)
      .in('status', ['open', 'in_progress'])
      .in('priority', ['urgent', 'high'])
      .limit(20);
    urgentTickets = tk.data || [];
  } catch (e) {}

  // Today's calendar events (if calendar_events exists)
  var todaysEvents = [];
  try {
    var ev = await supabase.from('calendar_events')
      .select('id, title, start_time, end_time')
      .gte('start_time', today + 'T00:00:00')
      .lte('start_time', today + 'T23:59:59')
      .limit(20);
    todaysEvents = ev.data || [];
  } catch (e) {}

  // CRM follow-ups due today or overdue
  var crmFollowUps = [];
  try {
    var cr = await supabase.from('crm_leads')
      .select('id, customer_name, follow_up_date, stage')
      .eq('assigned_to', userId)
      .lte('follow_up_date', today)
      .limit(20);
    crmFollowUps = cr.data || [];
  } catch (e) {}

  // Build the prompt block
  var lines = [];
  lines.push('## YOUR MEMORY AND CONTEXT FOR THIS USER');
  lines.push('The following items belong to or relate to the current user. Reference them naturally when relevant. Do not list them unless asked or unless it serves the answer.');
  lines.push('');

  if (mem.own.length > 0) {
    lines.push('### Your active memory items for this user:');
    mem.own.slice(0, 50).forEach(function (m) {
      var tag = '[' + m.type.toUpperCase() + ']';
      var when = m.expires_at ? ' (expires ' + m.expires_at.substring(0, 10) + ')' : '';
      lines.push('- ' + tag + ' ' + m.content + when);
    });
    lines.push('');
  }

  if (mem.targetedAtMe.length > 0) {
    lines.push('### Items other employees have flagged for this user:');
    mem.targetedAtMe.slice(0, 30).forEach(function (m) {
      var tag = '[' + m.type.toUpperCase() + ' from another user]';
      lines.push('- ' + tag + ' ' + m.content);
    });
    lines.push('');
  }

  if (urgentTickets.length > 0) {
    lines.push('### Open urgent/high-priority tickets assigned to this user:');
    urgentTickets.forEach(function (t) {
      lines.push('- #' + String(t.id).substring(0, 8) + ' [' + (t.priority || 'high') + '] ' + (t.title || '(no title)') + (t.due_date ? ' — due ' + t.due_date : ''));
    });
    lines.push('');
  }

  if (todaysEvents.length > 0) {
    lines.push('### Today\'s calendar events:');
    todaysEvents.forEach(function (e) {
      lines.push('- ' + (e.start_time || '').substring(11, 16) + ' — ' + (e.title || '(untitled)'));
    });
    lines.push('');
  }

  if (crmFollowUps.length > 0) {
    lines.push('### CRM follow-ups due or overdue:');
    crmFollowUps.forEach(function (c) {
      lines.push('- ' + (c.customer_name || '(unknown)') + ' — due ' + (c.follow_up_date || 'unknown') + ' — stage: ' + (c.stage || 'n/a'));
    });
    lines.push('');
  }

  if (lines.length <= 3) {
    lines.push('(No active memory items or urgent items for this user at this time.)');
  }

  return {
    prompt: lines.join('\n'),
    counts: {
      ownMemory: mem.own.length,
      targetedAtMe: mem.targetedAtMe.length,
      urgentTickets: urgentTickets.length,
      todaysEvents: todaysEvents.length,
      crmFollowUps: crmFollowUps.length,
    },
    settings: settings,
  };
}


// ============================================================
// WRITER — extracts memory candidates from a user's chat message
// Uses Claude Haiku for cheap/fast extraction. Returns an array of
// candidate items the caller inserts into ai_memory.
// ============================================================
export async function extractMemoryCandidates(userMessage, aiResponse, userProfile, teamUsers, settings) {
  if (!settings || !settings.auto_capture_enabled) return [];
  if (!userMessage || userMessage.length < 8) return [];

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  // Build a minimal team roster for target resolution
  var roster = (teamUsers || []).slice(0, 30).map(function (u) {
    return { id: u.id, name: (u.name || u.full_name || '').trim(), nickname: (u.nickname || '').trim() };
  }).filter(function (u) { return u.name; });

  var rosterBlock = roster.length > 0
    ? 'TEAM ROSTER (resolve names to IDs):\n' + roster.map(function (u) { return '- ' + u.name + (u.nickname ? ' (aka ' + u.nickname + ')' : '') + ' → id=' + u.id; }).join('\n')
    : 'TEAM ROSTER: (empty)';

  var allowedTypes = [];
  if (settings.capture_urgent) allowedTypes.push('urgent');
  if (settings.capture_meetings) allowedTypes.push('meeting');
  if (settings.capture_reminders) allowedTypes.push('reminder');
  if (settings.capture_follow_ups) allowedTypes.push('follow_up');
  if (settings.capture_notes) allowedTypes.push('note');
  if (allowedTypes.length === 0) return [];

  var extractorPrompt =
    'You extract structured memory items from a conversation between a user and their AI assistant. '
    + 'Return a JSON array of memory items. Each item has: {"content": "<1-sentence summary>", "type": "' + allowedTypes.join('|') + '", "target_user_id": "<uuid or null>", "urgency_signal": "<word from the message that made you pick this type, or null>"}. '
    + 'RULES:\n'
    + '1. Only extract items the user is clearly committing to, being reminded of, or asking you to track. DO NOT extract trivia, hypotheticals, or background facts.\n'
    + '2. Types: urgent (explicit "urgent"/"asap"/"critical"/"don\'t forget"/"need today"), meeting (time+place+person), reminder (future commitment), follow_up (call/message someone later), note (general persistent fact the user wants kept).\n'
    + '3. If the user says "tell/remind [person]..." or "[person] needs to..." set target_user_id to that person\'s id from the roster. Match first names, full names, or nicknames case-insensitively. If you can\'t resolve a person, leave target_user_id null.\n'
    + '4. Keep content concise. Max 140 characters. Phrase in third person ("User will call X about Y" or "Omar needs to confirm shipping for 2284").\n'
    + '5. If nothing qualifies, return an empty array [].\n'
    + '6. Output ONLY the JSON array. No prose, no markdown fences.\n\n'
    + rosterBlock + '\n\n'
    + 'CURRENT USER: ' + (userProfile && userProfile.name ? userProfile.name : '(unknown)') + ' (id=' + (userProfile && userProfile.id ? userProfile.id : 'unknown') + ')\n\n'
    + 'USER MESSAGE:\n' + userMessage + '\n\n'
    + (aiResponse ? ('AI RESPONSE (for context only):\n' + String(aiResponse).substring(0, 800) + '\n\n') : '')
    + 'JSON array:';

  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: extractorPrompt }],
      }),
    });
    if (!r.ok) return [];
    var data = await r.json();
    var text = (data.content && data.content[0] && data.content[0].text) || '[]';
    // strip code fences if the model wrapped it
    text = text.replace(/```json|```/g, '').trim();
    var parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    // Sanitize
    return parsed.filter(function (it) {
      return it && typeof it.content === 'string' && it.content.length > 2 && allowedTypes.indexOf(it.type) >= 0;
    }).map(function (it) {
      return {
        content: String(it.content).substring(0, 500),
        type: it.type,
        target_user_id: it.target_user_id && /^[0-9a-f-]{8,}$/i.test(String(it.target_user_id)) ? it.target_user_id : null,
        urgency_signal: it.urgency_signal || null,
      };
    });
  } catch (e) {
    return [];
  }
}


// ============================================================
// Persist candidates as ai_memory rows.
// Applies default expiry per type based on settings.
// Caps at settings.max_memory_items_per_user.
// ============================================================
export async function persistMemoryCandidates(supabase, candidates, userId, userMessage, settings) {
  if (!candidates || candidates.length === 0) return { inserted: 0 };
  if (!userId) return { inserted: 0 };

  // Count current items for this user to enforce the cap
  var capped = settings.max_memory_items_per_user || 500;
  try {
    var cnt = await supabase.from('ai_memory')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('dismissed_at', null);
    if (cnt && cnt.count && cnt.count >= capped) return { inserted: 0, cap_reached: true };
  } catch (e) {}

  var now = new Date();
  var rows = candidates.map(function (c) {
    var expires = null;
    if (c.type === 'note') {
      var d = new Date(now.getTime() + (settings.default_note_retention_days || 30) * 86400000);
      expires = d.toISOString();
    }
    // meetings/reminders/follow_ups expire after 14 days unless the user manually extends;
    // urgent NEVER expires until dismissed.
    if (c.type === 'meeting' || c.type === 'reminder' || c.type === 'follow_up') {
      var d2 = new Date(now.getTime() + 14 * 86400000);
      expires = d2.toISOString();
    }
    return {
      user_id: userId,
      content: c.content,
      type: c.type,
      scope: c.target_user_id ? 'team' : 'private',
      target_user_id: c.target_user_id || null,
      source_table: 'chat',
      extracted_from_chat: String(userMessage || '').substring(0, 500),
      expires_at: expires,
      auto_captured: true,
      created_by: userId,
    };
  });

  try {
    var ins = await supabase.from('ai_memory').insert(rows).select('id');
    return { inserted: (ins.data || []).length, ids: (ins.data || []).map(function (x) { return x.id; }) };
  } catch (e) {
    return { inserted: 0, error: e.message };
  }
}
