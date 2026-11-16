// v55.83-TG (Max, Nov 16 2026): "need permissioning so the column that shows the profit margin is restricted if you do not
// have permissioning or not a super admin". Permission key: pnl.view_margin (super admin always passes).
// The SERVER removes every profit / margin figure from a report before it is sent, so a hidden column cannot be read from the
// browser either. Pure, no database. SWC-safe (var + concat).
export var MARGIN_PERMISSION = 'pnl.view_margin';
var PROFIT_KEY = /profit|margin/i;

// returns a deep copy with every key whose name contains "profit" or "margin" removed
export function stripProfit(v) {
  if (Array.isArray(v)) { return v.map(stripProfit); }
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    var out = {};
    Object.keys(v).forEach(function (k) { if (k === 'can_see_margin' || !PROFIT_KEY.test(k)) { out[k] = stripProfit(v[k]); } });
    return out;
  }
  return v;
}

// client side: may this person see profit / margin? (the server enforces it as well)
export function canSeeMargin(isSuperAdmin, modulePerms) { return isSuperAdmin === true || !!(modulePerms && modulePerms[MARGIN_PERMISSION] === true); }
