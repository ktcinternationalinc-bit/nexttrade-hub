import { authorizeUserAdmin, readUserAdminJson, requireTargetUserId, userAdminErrorResponse } from './user-admin-auth.js';
import { authorizeUserAdminTarget } from './user-admin-protection.js';

// Dependency injection keeps authorization testable without calling a live service.
// The production wrapper passes only the server environment and Supabase SDK.
export function createUserAdminHandlers(createClient, env) {
function adminJson(body, options) {
  return Response.json(body, Object.assign({}, options, { headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization, Origin', 'X-Content-Type-Options': 'nosniff' } }));
}
// POST /api/users — Create new team member (auth + users table)
async function POST(request) {
  try {
    var authorized = await authorizeUserAdmin(request, createClient, env);
    var supabase = authorized.db;
    var body = await readUserAdminJson(request);
    var email = body.email;
    var password = body.password;
    var name = body.name;
    var nameAr = body.name_ar || '';
    var role = body.role || 'team';
    var reportsTo = body.reports_to || null;
    var phone = body.phone || '';

    if (!email || !password || !name) {
      return adminJson({ error: 'Email, password, and name are required' }, { status: 400 });
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return adminJson({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured in Vercel env vars. This is required to create user accounts.' }, { status: 500 });
    }

    // Step 1: Create auth user
    var authResult = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    });

    if (authResult.error) {
      return adminJson({ error: 'Auth creation failed: ' + authResult.error.message }, { status: 400 });
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
      return adminJson({
        warning: 'Auth account created but users table insert failed: ' + dbResult.error.message,
        auth_created: true,
        user: null
      });
    }

    // Step 3: Set module permissions for ALL modules
    var allModules = ['Dashboard', 'Sales', 'Customers', 'Treasury', 'Checks', 'Debts',
      'Warehouse', 'Inventory', 'CRM', 'Tickets', 'Calendar', 'Customs',
      'Shipping Rates', 'Daily Log', 'Admin', 'AI Assistant', 'Communications', 'Settings', 'Import',
      'Bank', 'Egypt Bank', 'Quotes', 'Reports', 'Welcome Briefing'];
    var selectedMods = body.modules && Array.isArray(body.modules) ? body.modules : [];
    var permRecords = allModules.map(function(mod) {
      return { user_id: dbResult.data.id, module_name: mod, has_access: selectedMods.includes(mod) };
    });
    await supabase.from('module_permissions').insert(permRecords);

    return adminJson({ success: true, user: dbResult.data });
  } catch (err) {
    return userAdminErrorResponse(err);
  }
}

// PUT /api/users — Update team member
async function PUT(request) {
  try {
    var authorized = await authorizeUserAdmin(request, createClient, env);
    var supabase = authorized.db;
    var body = await readUserAdminJson(request);
    var userId = requireTargetUserId(body.id);
    if (!userId) return adminJson({ error: 'User ID required' }, { status: 400 });
    var targetIdentity = await authorizeUserAdminTarget(authorized, userId, env);
    if (body.new_password && !targetIdentity.authUserId) return adminJson({ error: 'This profile has no verified sign-in whose password can be changed.' }, { status: 409 });

    var updates = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.name_ar !== undefined) updates.name_ar = body.name_ar;
    if (body.role !== undefined) updates.role = body.role;
    if (body.reports_to !== undefined) updates.reports_to = body.reports_to || null;
    if (body.active !== undefined) updates.active = body.active;
    if (body.phone !== undefined) updates.phone = body.phone;

    if (Object.keys(updates).length === 0 && !body.new_password) {
      return adminJson({ error: 'No updates provided' }, { status: 400 });
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      var result = await supabase.from('users').update(updates).eq('id', userId).select().single();
      if (result.error) return adminJson({ error: result.error.message }, { status: 400 });
    }

    // Update password if provided
    if (body.new_password) {
      var passwordResult = await supabase.auth.admin.updateUserById(targetIdentity.authUserId, { password: body.new_password });
      if (passwordResult.error) return adminJson({ error: 'The authentication password could not be updated.' }, { status: 400 });
    }

    return adminJson({ success: true });
  } catch (err) {
    return userAdminErrorResponse(err);
  }
}

// DELETE /api/users — Deactivate or permanently delete team member
async function DELETE(request) {
  try {
    var authorized = await authorizeUserAdmin(request, createClient, env);
    var supabase = authorized.db;
    var url = new URL(request.url);
    var userId = requireTargetUserId(url.searchParams.get('id'));
    var permanent = url.searchParams.get('permanent') === 'true';
    if (!userId) return adminJson({ error: 'User ID required' }, { status: 400 });
    var targetIdentity = await authorizeUserAdminTarget(authorized, userId, env);

    if (!permanent) {
      var result = await supabase.from('users').update({ active: false, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
      if (result.error) return adminJson({ error: result.error.message }, { status: 400 });
      return adminJson({ success: true, action: 'deactivated' });
    }

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
    if (delResult.error) return adminJson({ error: 'Delete failed: ' + delResult.error.message }, { status: 400 });

    // Delete from Supabase Auth
    if (targetIdentity.authUserId) {
      try {
        var deletedAuth = await supabase.auth.admin.deleteUser(targetIdentity.authUserId);
        if (deletedAuth.error) return adminJson({ success: false, action: 'profile_deleted', error: 'The profile was deleted but its sign-in could not be removed. A super administrator must finish removing that sign-in.' }, { status: 502 });
      } catch(e) { return adminJson({ success: false, action: 'profile_deleted', error: 'The profile was deleted but sign-in removal could not be confirmed. A super administrator must check the sign-in.' }, { status: 502 }); }
    }

    return adminJson({ success: true, action: 'permanently_deleted' });
  } catch (err) {
    return userAdminErrorResponse(err);
  }
}

return { POST: POST, PUT: PUT, DELETE: DELETE };
}
