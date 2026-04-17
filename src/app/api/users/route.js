import { createClient } from '@supabase/supabase-js';

var supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST /api/users — Create new team member (auth + users table)
export async function POST(request) {
  try {
    var body = await request.json();
    var email = body.email;
    var password = body.password;
    var name = body.name;
    var nameAr = body.name_ar || '';
    var role = body.role || 'team';
    var reportsTo = body.reports_to || null;
    var phone = body.phone || '';

    if (!email || !password || !name) {
      return Response.json({ error: 'Email, password, and name are required' }, { status: 400 });
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured in Vercel env vars. This is required to create user accounts.' }, { status: 500 });
    }

    // Step 1: Create auth user
    var authResult = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    });

    if (authResult.error) {
      return Response.json({ error: 'Auth creation failed: ' + authResult.error.message }, { status: 400 });
    }

    // Step 2: Create users table entry with SAME ID as auth user
    var userRecord = {
      id: authResult.data.user.id,
      email: email,
      name: name,
      name_ar: nameAr,
      role: role,
      active: true
    };
    if (reportsTo) userRecord.reports_to = reportsTo;
    if (phone) userRecord.phone = phone;

    var dbResult = await supabase.from('users').insert(userRecord).select().single();

    if (dbResult.error) {
      // If DB insert fails, still return partial success since auth was created
      return Response.json({
        warning: 'Auth account created but users table insert failed: ' + dbResult.error.message,
        auth_created: true,
        user: null
      });
    }

    // Step 3: Set module permissions for ALL modules
    var allModules = ['Dashboard', 'Sales', 'Customers', 'Treasury', 'Checks', 'Debts',
      'Warehouse', 'Inventory', 'CRM', 'Tickets', 'Calendar', 'Customs',
      'Shipping Rates', 'Daily Log', 'Admin', 'AI Assistant', 'Communications', 'Settings', 'Import',
      'Bank', 'Egypt Bank', 'Quotes', 'Reports'];
    var selectedMods = body.modules && Array.isArray(body.modules) ? body.modules : [];
    var permRecords = allModules.map(function(mod) {
      return { user_id: dbResult.data.id, module_name: mod, has_access: selectedMods.includes(mod) };
    });
    await supabase.from('module_permissions').insert(permRecords);

    return Response.json({ success: true, user: dbResult.data });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/users — Update team member
export async function PUT(request) {
  try {
    var body = await request.json();
    var userId = body.id;
    if (!userId) return Response.json({ error: 'User ID required' }, { status: 400 });

    var updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.name_ar !== undefined) updates.name_ar = body.name_ar;
    if (body.role !== undefined) updates.role = body.role;
    if (body.reports_to !== undefined) updates.reports_to = body.reports_to || null;
    if (body.active !== undefined) updates.active = body.active;
    if (body.phone !== undefined) updates.phone = body.phone;

    if (Object.keys(updates).length === 0 && !body.new_password) {
      return Response.json({ error: 'No updates provided' }, { status: 400 });
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      var result = await supabase.from('users').update(updates).eq('id', userId).select().single();
      if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    }

    // Update password if provided
    if (body.new_password) {
      var userRow = await supabase.from('users').select('email').eq('id', userId).single();
      var userEmail = userRow.data ? userRow.data.email : null;
      if (userEmail) {
        var listResult = await supabase.auth.admin.listUsers();
        if (listResult.data && listResult.data.users) {
          var authUser = listResult.data.users.find(function(u) { return u.email === userEmail; });
          if (authUser) {
            await supabase.auth.admin.updateUserById(authUser.id, { password: body.new_password });
          }
        }
      }
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/users — Deactivate or permanently delete team member
export async function DELETE(request) {
  try {
    var url = new URL(request.url);
    var userId = url.searchParams.get('id');
    var permanent = url.searchParams.get('permanent') === 'true';
    if (!userId) return Response.json({ error: 'User ID required' }, { status: 400 });

    if (!permanent) {
      var result = await supabase.from('users').update({ active: false, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
      if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
      return Response.json({ success: true, action: 'deactivated' });
    }

    // Permanent delete — get user email first for auth deletion
    var userRow = await supabase.from('users').select('email').eq('id', userId).single();
    var userEmail = userRow.data ? userRow.data.email : null;

    // NULL out all FK references (so no constraint violations)
    var fkUpdates = [
      supabase.from('tickets').update({ assigned_to: null }).eq('assigned_to', userId),
      supabase.from('tickets').update({ created_by: null }).eq('created_by', userId),
      supabase.from('tickets').update({ updated_by: null }).eq('updated_by', userId),
      supabase.from('tickets').update({ closed_by: null }).eq('closed_by', userId),
      supabase.from('ticket_comments').update({ created_by: null }).eq('created_by', userId),
      supabase.from('invoices').update({ created_by: null }).eq('created_by', userId),
      supabase.from('invoices').update({ sales_rep: null }).eq('sales_rep', userId),
      supabase.from('treasury').update({ created_by: null }).eq('created_by', userId),
      supabase.from('checks').update({ created_by: null }).eq('created_by', userId),
      supabase.from('calendar_events').update({ assigned_to: null }).eq('assigned_to', userId),
      supabase.from('calendar_events').update({ created_by: null }).eq('created_by', userId),
      supabase.from('follow_ups').update({ assigned_to: null }).eq('assigned_to', userId),
      supabase.from('follow_ups').update({ created_by: null }).eq('created_by', userId),
      supabase.from('client_notes').update({ created_by: null }).eq('created_by', userId),
      supabase.from('customers').update({ assigned_rep: null }).eq('assigned_rep', userId),
      supabase.from('announcements').update({ posted_by: null }).eq('posted_by', userId),
      supabase.from('warehouse_expenses').update({ created_by: null }).eq('created_by', userId),
      supabase.from('users').update({ reports_to: null }).eq('reports_to', userId),
    ];
    await Promise.allSettled(fkUpdates);

    // DELETE from tables with user_id FK (logs, permissions, sessions)
    var fkDeletes = [
      supabase.from('module_permissions').delete().eq('user_id', userId),
      supabase.from('user_sessions').delete().eq('user_id', userId),
      supabase.from('audit_log').delete().eq('changed_by', userId),
      supabase.from('daily_log').delete().eq('user_id', userId),
      supabase.from('notification_log').delete().eq('user_id', userId),
      supabase.from('notification_prefs').delete().eq('user_id', userId),
      supabase.from('team_reminders').delete().eq('created_by', userId),
      supabase.from('announcement_acks').delete().eq('user_id', userId),
      supabase.from('contact_log').delete().eq('contacted_by', userId),
    ];
    await Promise.allSettled(fkDeletes);

    // Delete the user row
    var delResult = await supabase.from('users').delete().eq('id', userId);
    if (delResult.error) return Response.json({ error: 'Delete failed: ' + delResult.error.message }, { status: 400 });

    // Delete from Supabase Auth
    if (userEmail) {
      try {
        var listResult = await supabase.auth.admin.listUsers();
        if (listResult.data && listResult.data.users) {
          var authUser = listResult.data.users.find(function(u) { return u.email === userEmail; });
          if (authUser) await supabase.auth.admin.deleteUser(authUser.id);
        }
      } catch(e) { /* auth deletion is non-fatal */ }
    }

    return Response.json({ success: true, action: 'permanently_deleted' });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
