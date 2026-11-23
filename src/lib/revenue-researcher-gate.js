// v55.83-XK (Codex 22 Nov 19:38 / 23 Nov) — a "revenue researcher" ("P&L: See sales & revenue" OFF) is a VALIDATED configuration,
// not a warning: the switch can only go OFF when the person has none of the switches that lead to the same figures, and none of
// those can be switched ON while it is OFF. Both permission writers use this: /api/admin/permissions (module switches) and the
// Banking & Accounting Access writer (bank-balance / full-dashboard grants, src/lib/bank-visibility.js).
// Effective permissions are resolved (aliases, legacy names, role defaults), not only explicit ON rows. Fails closed.
// Server-only; SWC-safe: var + concatenation.
import { loadUserPermissions, userHasPermission, isRevenueConflict, revenueSwitchedOff, REVENUE_PERMISSION, ROLE_DEFAULTS_FOR_GATE } from './server-permissions';
import { PERMISSION_ALIASES, grantNames, permFamily } from './permission-aliases';

export var SQL_MISSING_XK = 'A person can be made a revenue researcher only after the database step is installed: run sql/v55-83-XK-revenue-researcher.sql in Supabase (Max). Nothing was changed.';

// does this switch name (canonical or a legacy name) belong to the revenue-conflict family?
// The screens need "Accounting access" + the KTC / Wave hub switch to OPEN the Accounting area (and reach Profitability), so a
// researcher may keep those three ON in Settings. The SERVER still refuses them to a researcher (isRevenueConflict), so no other
// accounting route answers that person; Profitability / P&L check only P&L: View.
export var RESEARCHER_NAV = { 'accounting.view': 1, 'accounting.clickbooks.access': 1, 'accounting.wavehub.access': 1 };
export function isConflictName(name) { var fam = grantNames(String(name || '')); if (fam.some(function (n) { return RESEARCHER_NAV[n] === 1; })) { return false; } return fam.some(function (n) { return isRevenueConflict(n); }); }
export function isRevenueName(name) { return permFamily(REVENUE_PERMISSION).indexOf(String(name || '')) >= 0 || String(name || '') === REVENUE_PERMISSION; }

// → { conflicts: [label] } | { error, status }. "Would this person have it if revenue were ON?" for every conflicting switch.
export async function researcherConflicts(db, profileId) {
  var ctx = await loadUserPermissions(db, profileId);
  if (ctx.readError) { return { error: 'The person’s switches could not be read — nothing was changed.', status: 503 }; }
  if (ctx.isSuperAdmin === true) { return { error: 'A super admin always sees everything.', status: 409 }; }
  // the same person with the revenue switch taken out of the picture
  var mp = Object.assign({}, ctx.mp); var deny = Object.assign({}, ctx.deny);
  permFamily(REVENUE_PERMISSION).concat([REVENUE_PERMISSION]).forEach(function (n) { delete mp[n]; delete deny[n]; });
  var probe = { role: ctx.role, isSuperAdmin: false, mp: mp, deny: deny };
  var cands = {};
  Object.keys(PERMISSION_ALIASES).forEach(function (k) { if (isConflictName(k)) { cands[k] = true; } });
  Object.keys(mp).forEach(function (n) { if (isConflictName(n)) { cands[n] = true; } });
  (ROLE_DEFAULTS_FOR_GATE[ctx.role] || []).forEach(function (k) { if (k !== '*' && isConflictName(k)) { cands[k] = true; } });
  var out = Object.keys(cands).filter(function (k) { return userHasPermission(probe, k); });
  // bank-balance / full-dashboard grants live in their own table (one per sign-in of this person)
  var ids = await db.rpc('bank_visibility_auth_ids_for_profile', { p_profile_id: profileId });
  if (ids.error) { return { error: 'The person’s bank-balance access could not be read — nothing was changed.', status: 503 }; }
  var authIds = (ids.data || []).map(function (r) { return r.auth_user_id; }).filter(Boolean);
  if (authIds.length) {
    var fv = await db.from('financial_visibility_permissions').select('auth_user_id, can_view_dashboard, can_view_bank_balances').in('auth_user_id', authIds);
    if (fv.error) { return { error: 'The person’s bank-balance access could not be read — nothing was changed.', status: 503 }; }
    (fv.data || []).forEach(function (r) { if (r.can_view_bank_balances === true && out.indexOf('Bank balances') < 0) { out.push('Bank balances'); } if (r.can_view_dashboard === true && out.indexOf('Full dashboard') < 0) { out.push('Full dashboard'); } });
  }
  return { conflicts: out.sort(), role: ctx.role };
}

// is the database half installed (row rules on the direct-read sales tables)?
export async function researcherGuardInstalled(db) {
  try { var r = await db.rpc('hub_revenue_guard_installed'); return !r.error && r.data === true; } catch (e) { return false; }
}

// is this person a researcher right now? → { off: bool } | { error, status }
export async function isResearcher(db, profileId) {
  var ctx = await loadUserPermissions(db, profileId);
  if (ctx.readError) { return { error: 'The person’s switches could not be read — nothing was changed.', status: 503 }; }
  return { off: revenueSwitchedOff(ctx) };
}
