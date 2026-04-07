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

    // Step 2: Create users table entry
    var userRecord = {
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

    // Step 3: Set default module permissions if provided
    if (body.modules && Array.isArray(body.modules) && body.modules.length > 0) {
      var permRecords = body.modules.map(function(mod) {
        return { user_id: dbResult.data.id, module_name: mod, has_access: true };
      });
      await supabase.from('module_permissions').insert(permRecords);
    }

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

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No updates provided' }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    var result = await supabase.from('users').update(updates).eq('id', userId).select().single();
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });

    // Update password if provided
    if (body.new_password) {
      // Find auth user by email
      var userEmail = result.data.email;
      var listResult = await supabase.auth.admin.listUsers();
      if (listResult.data && listResult.data.users) {
        var authUser = listResult.data.users.find(function(u) { return u.email === userEmail; });
        if (authUser) {
          await supabase.auth.admin.updateUserById(authUser.id, { password: body.new_password });
        }
      }
    }

    return Response.json({ success: true, user: result.data });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// DELETE /api/users — Deactivate team member
export async function DELETE(request) {
  try {
    var url = new URL(request.url);
    var userId = url.searchParams.get('id');
    if (!userId) return Response.json({ error: 'User ID required' }, { status: 400 });

    var result = await supabase.from('users').update({ active: false, updated_at: new Date().toISOString() }).eq('id', userId).select().single();
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
