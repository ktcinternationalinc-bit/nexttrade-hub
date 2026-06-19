// v55.83-BE — paginate past Supabase's 1000-row default limit on client reads.
// Returns Promise<{ data: [...] }> so it's a drop-in for supabase.from(t).select(c).
import { supabase } from './supabase';

// v55.83-JL — optional gteFilter {col, value} applies a `.gte(col, value)` AT THE QUERY so older
// rows are never loaded into client state (admin history-visibility floor for non-super-admins).
// Codex's rule: do not fetch-all-then-hide on screens that claim to enforce the window.
export function fetchAllRows(table, columns, orderCol, asc, gteFilter) {
  var all = [];
  function loop(from) {
    var q = supabase.from(table).select(columns || '*').range(from, from + 999);
    if (gteFilter && gteFilter.col && gteFilter.value) { q = q.gte(gteFilter.col, gteFilter.value); }
    if (orderCol) { q = q.order(orderCol, { ascending: asc !== false }); }
    return q.then(function (res) {
      if (res.error || !res.data || res.data.length === 0) { return { data: all, error: res.error }; }
      all = all.concat(res.data);
      if (res.data.length < 1000) { return { data: all }; }
      return loop(from + 1000);
    });
  }
  return loop(0);
}
