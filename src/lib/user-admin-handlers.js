import { authorizeUserAdmin, readUserAdminJson, requireTargetUserId, userAdminErrorResponse } from './user-admin-auth.js';
import { authorizeUserAdminTarget } from './user-admin-protection.js';
import { audit } from './audit-server.js'; // v55.83-WW

// v55.83-WW (Max's rule 1: only the super admin promotes someone to super admin; nobody raises their own access) — role rules.
var ROLE_OK = { super_admin: 1, admin: 1, team: 1, viewer: 1 };
async function roleOf(supabase, profileId) {
  var r = await supabase.from('users').select('id, role').eq('id', profileId).limit(1);
  if (r.error) { return { error: 'The profile could not be checked right now.' }; }
  var row = r.data && r.data[0];
  return { role: row ? row.role : null, found: !!row };
}

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
    if (!ROLE_OK[role]) { return adminJson({ error: 'Unknown role "' + role + '".' }, { status: 400 }); }
    var meC = await roleOf(supabase, authorized.profileId);
    if (meC.error) { return adminJson({ error: meC.error }, { status: 503 }); }
    if (role === 'super_admin' && meC.role !== 'super_admin') { return adminJson({ error: 'Only the super admin can make someone a super admin.' }, { status: 403 }); }
    // v55.83-WW (Codex 09:02 P1) — the starting switches are a grant like any other: only the super admin picks them. An admin can still add a
    // person, with every switch OFF; refused BEFORE any sign-in, profile or switch is created (never a half-made account).
    var askedMods = body.modules && Array.isArray(body.modules) ? body.modules.filter(function (m) { return typeof m === 'string' && m; }) : [];
    if (body.modules !== undefined && body.modules !== null && !Array.isArray(body.modules)) { return adminJson({ error: 'The starting switches must be a list.' }, { status: 400 }); }
    if (askedMods.length > 0 && meC.role !== 'super_admin') { return adminJson({ error: 'Only the super admin can choose the starting permission switches. Add the person with none ticked, then ask the super admin to switch on what they need.' }, { status: 403 }); }
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
    var selectedMods = askedMods;
    var permRecords = allModules.map(function(mod) {
      return { user_id: dbResult.data.id, module_name: mod, has_access: selectedMods.includes(mod) };
    });
    var permIns = await supabase.from('module_permissions').insert(permRecords);
    // audit what is really stored (read back), not what was asked
    var effective = []; var permErr = permIns && permIns.error ? permIns.error.message : null;
    try { var rb = await supabase.from('module_permissions').select('module_name, has_access').eq('user_id', dbResult.data.id); (rb.data || []).forEach(function (r) { if (r.has_access === true) { effective.push(r.module_name); } }); if (rb.error && !permErr) { permErr = rb.error.message; } } catch (eRb) { permErr = permErr || 'read-back failed'; }
    await audit(supabase, authorized.profileId, 'user_created', 'user', dbResult.data.id, { role: role, switches_on: effective, switches_asked: selectedMods, switch_save_error: permErr });
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
    var meP = await roleOf(supabase, authorized.profileId); var tgP = await roleOf(supabase, userId);
    if (meP.error || tgP.error) { return adminJson({ error: meP.error || tgP.error }, { status: 503 }); }
    if (tgP.role === 'super_admin' && meP.role !== 'super_admin') { return adminJson({ error: 'Only the super admin can change a super admin\'s account.' }, { status: 403 }); }
    if (body.role !== undefined) {
      if (!ROLE_OK[body.role]) { return adminJson({ error: 'Unknown role "' + body.role + '".' }, { status: 400 }); }
      if (String(userId).toLowerCase() === String(authorized.profileId).toLowerCase() && body.role !== tgP.role) { return adminJson({ error: 'Nobody can change their own role.' }, { status: 403 }); }
      if (body.role === 'super_admin' && tgP.role !== 'super_admin' && meP.role !== 'super_admin') { return adminJson({ error: 'Only the super admin can make someone a super admin.' }, { status: 403 }); }
    }
    if (body.active === false && String(userId).toLowerCase() === String(authorized.profileId).toLowerCase()) { return adminJson({ error: 'You cannot switch off your own account.' }, { status: 403 }); }
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
      if (updates.role !== undefined && updates.role !== tgP.role) { await audit(supabase, authorized.profileId, 'user_role_changed', 'user', userId, { before: tgP.role, after: updates.role }); }
      if (updates.active !== undefined) { await audit(supabase, authorized.profileId, updates.active ? 'user_reactivated' : 'user_deactivated', 'user', userId, { role: tgP.role }); }
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
    if (String(userId).toLowerCase() === String(authorized.profileId).toLowerCase()) { return adminJson({ error: 'You cannot switch off or delete your own account.' }, { status: 403 }); }
    var meD = await roleOf(supabase, authorized.profileId); var tgD = await roleOf(supabase, userId);
    if (meD.error || tgD.error) { return adminJson({ error: meD.error || tgD.error }, { status: 503 }); }
    if ((tgD.role === 'super_admin' || permanent) && meD.role !== 'super_admin') { return adminJson({ error: permanent ? 'Only the super admin can delete an account for good.' : 'Only the super admin can switch off a super admin\'s account.' }, { status: 403 }); }

    if (!permanent) {
      var result = await supabase.from('users').update({ active: false, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
      if (result.error) return adminJson({ error: result.error.message }, { status: 400 });
      await audit(supabase, authorized.profileId, 'user_deactivated', 'user', userId, { role: tgD.role });
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

    await audit(supabase, authorized.profileId, 'user_deleted_permanently', 'user', userId, { role: tgD.role }); // written before the row goes, by the super admin
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
