'use strict';
async function authorized(db, id, requireSuperAdmin) {
  if (db.authorize) return db.authorize(id, requireSuperAdmin);
  const result = await db.from('users').select('id,role,active').eq('id', id).maybeSingle();
  if (result.error) throw new Error('Approver could not be verified.');
  const user = result.data;
  if (!user || user.active === false) return false;
  if (user.role === 'super_admin') return true;
  if (requireSuperAdmin) return false;
  const perms = await db.from('module_permissions').select('has_access').eq('user_id', id).eq('module_name', 'releases.manage');
  if (perms.error) throw new Error('Approver permissions could not be verified.');
  return perms.data.some(p => p.has_access === true) && !perms.data.some(p => p.has_access === false);
}
module.exports = { authorized };
