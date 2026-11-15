// v55.83-A — Inventory Module Permissions
//
// Three-tier visibility model agreed with Max:
//   1. inv.view      — see SKU names, descriptions, quantities, warehouses
//                      (granted automatically with tab access)
//   2. inv.see_costs — also see landed cost, avg unit cost, FX rates
//                      (super_admin gets this automatically; admins by grant)
//   3. inv.see_pnl   — also see Gross Profit, FX Impact, Total Profit
//                      (super_admin only by default; granted per-user)
//
// These checks run BOTH client-side (to hide UI) AND server-side (to refuse
// data in API responses). Defense in depth.

/**
 * Does the given user have permission to see costs in the Inventory module?
 * Costs include: landed cost, avg unit cost, last purchase cost, FX rates,
 * cost breakdown on shipments.
 */
export function canSeeInventoryCosts(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (!modulePerms) return false;
  // Accept either the formal permission key or older "admin" flag.
  return modulePerms['inv.see_costs'] === true
      || modulePerms['Inventory Costs'] === true;
}

/**
 * Does the given user have permission to see P&L in the Inventory module?
 * P&L includes: gross profit, FX impact, total profit, margins, profitability
 * dashboards, P&L-related AI insights.
 *
 * STRICTER than canSeeInventoryCosts — seeing costs doesn't imply seeing P&L,
 * but seeing P&L implies seeing costs (you can't have profit without cost).
 */
export function canSeeInventoryPnL(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (!modulePerms) return false;
  return modulePerms['inv.see_pnl'] === true
      || modulePerms['Inventory P&L'] === true;
}

/**
 * Basic Inventory access — see the tab and SKU list.
 */
export function canViewInventory(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (!modulePerms) return false;
  return modulePerms['inv.view'] === true
      || modulePerms['Inventory'] === true
      || modulePerms['View Inventory'] === true;
}

/**
 * Can edit SKUs, warehouses, basic data — but NOT original quantities
 * (those need canEditOriginalQty below).
 */
export function canEditInventory(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (userProfile.role === 'admin') return true;
  if (!modulePerms) return false;
  return modulePerms['inv.edit'] === true
      || modulePerms['Edit Inventory'] === true;
}

/**
 * Can edit ORIGINAL quantities on shipment lines and SKU master rows.
 * Stricter than canEditInventory because original-quantity edits rewrite
 * historical data and require an audit journal entry.
 *
 * Per Max's addendum spec section 3-4: only super_admin or users with
 * explicit high-level permission.
 */
export function canEditOriginalQty(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (!modulePerms) return false;
  return modulePerms['inv.edit_original_qty'] === true;
}

/**
 * Can approve large inventory adjustments (above the auto-approve threshold).
 * Threshold is 5% of current stock by default; configurable in settings.
 */
export function canApproveAdjustments(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (userProfile.role === 'admin') return true;
  if (!modulePerms) return false;
  return modulePerms['inv.approve_adjustments'] === true;
}

/**
 * Inventory Report Center — view reports. Its own grantable permission, but anyone with
 * basic inventory access can view (reports are read-only views of data they can already see).
 */
export function canViewInventoryReports(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (modulePerms && (modulePerms['inventory.reports.view'] === true || modulePerms['Inventory Reports'] === true)) return true;
  return canViewInventory(userProfile, modulePerms);
}

/**
 * Export inventory reports to Excel/CSV. Stricter than view — explicit grant or admin.
 */
export function canExportInventoryReports(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (userProfile.role === 'admin') return true;
  if (!modulePerms) return false;
  return modulePerms['inventory.reports.export'] === true;
}

/**
 * See cost / valuation columns inside reports. Maps to its own key, and anyone who can
 * already see inventory costs sees valuation too.
 */
export function canSeeValuationInReports(userProfile, modulePerms) {
  if (!userProfile) return false;
  if (userProfile.role === 'super_admin') return true;
  if (modulePerms && modulePerms['inventory.valuation.view'] === true) return true;
  return canSeeInventoryCosts(userProfile, modulePerms);
}

/**
 * Helper for strip-and-return: takes a row from inv_skus / inv_shipments /
 * inv_invoice_lines and removes the cost/P&L fields if the viewer doesn't
 * have permission. Use in BOTH server responses and client renderers.
 *
 * Why both? The server check is the security boundary — it ensures sensitive
 * data never leaves the database. The client check is for UX — it hides
 * columns and chrome even when the data is somehow present (e.g. cached state
 * from a previous higher-permission session).
 */
export function stripSensitiveFields(row, userProfile, modulePerms) {
  if (!row) return row;
  var seeCosts = canSeeInventoryCosts(userProfile, modulePerms);
  var seePnL = canSeeInventoryPnL(userProfile, modulePerms);
  if (seePnL && seeCosts) return row; // No stripping needed.

  var stripped = Object.assign({}, row);
  if (!seeCosts) {
    // Cost fields across all inv_* tables
    delete stripped.avg_landed_cost;
    delete stripped.last_purchase_cost;
    delete stripped.standard_cost;
    delete stripped.unit_cost;
    delete stripped.unit_cost_currency;
    delete stripped.landed_unit_cost_egp;
    delete stripped.landed_unit_cost_usd;
    delete stripped.landed_cost_egp;
    delete stripped.landed_cost_usd;
    delete stripped.purchase_cost;
    delete stripped.freight_cost;
    delete stripped.customs_cost;
    delete stripped.port_fees;
    delete stripped.inland_transport;
    delete stripped.handling_fees;
    delete stripped.other_charges;
    delete stripped.base_fx_egp_per_usd;
    delete stripped.base_fx_egp_per_eur;
    delete stripped.base_fx_usd_per_eur;
    delete stripped.base_fx_to_egp;
    delete stripped.base_fx_to_usd;
    delete stripped.avg_base_fx_to_egp;
    delete stripped.avg_base_fx_to_usd;
    delete stripped.cogs_unit_cost;
    delete stripped.cogs_egp;
    delete stripped.cogs_usd;
    delete stripped.cogs_avg_fx_to_egp;
    delete stripped.cogs_avg_fx_to_usd;
    delete stripped.unit_cost_at_movement;
    delete stripped.fx_to_egp_at_movement;
    delete stripped.fx_to_usd_at_movement;
    delete stripped.running_avg_cost_after;
    delete stripped.running_avg_fx_egp_after;
    delete stripped.running_avg_fx_usd_after;
  }
  if (!seePnL) {
    delete stripped.gross_profit_egp;
    delete stripped.fx_impact_egp;
    delete stripped.total_profit_egp;
    delete stripped.gross_profit_usd;
    delete stripped.fx_impact_usd;
    delete stripped.total_profit_usd;
    delete stripped.target_revenue_egp;
    delete stripped.target_revenue_usd;
    delete stripped.target_sell_price;
    delete stripped.target_sell_currency;
    delete stripped.revenue_egp;
    delete stripped.revenue_usd;
    delete stripped.financial_impact_egp;
    delete stripped.financial_impact_usd;
  }
  return stripped;
}

/**
 * Strip a list of rows. Convenience wrapper around stripSensitiveFields.
 */
export function stripSensitiveRows(rows, userProfile, modulePerms) {
  if (!Array.isArray(rows)) return [];
  return rows.map(function (r) { return stripSensitiveFields(r, userProfile, modulePerms); });
}
