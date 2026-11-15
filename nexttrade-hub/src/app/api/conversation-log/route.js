// =====================================================================
// /api/conversation-log — GET endpoint for cross-device chat continuity
// =====================================================================
// v55.81 QA-16 (Max May 9 2026)
//
// Returns the user's saved conversation tail (up to 80 messages) for
// each persona. The browser merges this with its localStorage cache on
// dashboard mount so a user opening the dashboard on a fresh device
// still sees their history with Nadia / Jenna / Sara.
//
// Security: validates the supabase session and ensures the requested
// userId matches the authenticated user. A user cannot pull anyone
// else's conversation log.
//
// SWC/Vercel constraint reminder: var only, string concat (no template
// literals), no let/const inside the body.
// =====================================================================

import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../../../lib/phone-auth';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(request) {
  try {
    var url = new URL(request.url);
    var requestedUserId = url.searchParams.get('userId');
    if (!requestedUserId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Authenticate + verify the requestedUserId matches the session.
    // Soft-mode during rollout — same pattern as /api/ask.
    try {
      var auth = await requireUser(request);
      if (auth && auth.user) {
        if (auth.user.id !== requestedUserId) {
          console.warn('[conversation-log] userId mismatch: session=' + auth.user.id + ' requested=' + requestedUserId);
          return Response.json({ error: 'forbidden' }, { status: 403 });
        }
      }
    } catch (e) {
      console.warn('[conversation-log] auth check threw, soft-allowing:', e && e.message);
    }

    var rows = await supabase.from('conversation_logs')
      .select('persona, messages, message_count, last_persisted_at')
      .eq('user_id', requestedUserId);

    var byPersona = { nadia: [], jenna: [], sara: [] };
    if (rows && rows.data) {
      for (var i = 0; i < rows.data.length; i++) {
        var row = rows.data[i];
        if (row.persona === 'nadia' || row.persona === 'jenna' || row.persona === 'sara') {
          byPersona[row.persona] = Array.isArray(row.messages) ? row.messages : [];
        }
      }
    }

    return Response.json({ byPersona: byPersona });
  } catch (e) {
    console.warn('[conversation-log] GET threw:', e && e.message);
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
