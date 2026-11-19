// v55.83-TW — a small in-memory stand-in for the Supabase client, for tests that RUN server code (no network).
// Supports select/eq/neq/in/is/gte/lte/order/limit/range/maybeSingle/insert/update/upsert and the unique rules a test
// declares (array of column names per table, optional `where` row filter for partial unique indexes).
function FakeDb(uniques) {
  var self = this; self.t = {}; var seq = 0; self.uniques = uniques || {}; self.fail = {};
  self.maxRows = 1000; // like Supabase/PostgREST: at most 1,000 rows per request unless paged with range()
  function Q(table) { this.table = table; this.filters = []; this.op = 'select'; this.one = false; }
  Q.prototype.select = function () { return this; };
  Q.prototype.eq = function (k, v) { this.filters.push(function (r) { return String(r[k]) === String(v); }); return this; };
  Q.prototype.neq = function (k, v) { this.filters.push(function (r) { return String(r[k]) !== String(v); }); return this; };
  Q.prototype.in = function (k, vs) { this.filters.push(function (r) { return vs.map(String).indexOf(String(r[k])) >= 0; }); return this; };
  Q.prototype.is = function (k, v) { this.filters.push(function (r) { return (r[k] == null) === (v == null); }); return this; };
  Q.prototype.gte = function (k, v) { this.filters.push(function (r) { return String(r[k]) >= String(v); }); return this; };
  Q.prototype.lte = function (k, v) { this.filters.push(function (r) { return String(r[k]) <= String(v); }); return this; };
  Q.prototype.not = function () { return this; };
  Q.prototype.or = function () { return this; };
  Q.prototype.limit = function (n) { this.lim = n; return this; };
  Q.prototype.order = function (col, o) { (this.sorts = this.sorts || []).push({ col: col, asc: !(o && o.ascending === false) }); return this; };
  Q.prototype.range = function (a, b) { this.rng = [a, b]; return this; };
  Q.prototype.maybeSingle = function () { this.one = true; return this; };
  Q.prototype.single = function () { this.one = true; return this; }; // v55.83-UM — same as maybeSingle here (a missing row is data: null)
  Q.prototype.insert = function (row) { this.op = 'insert'; this.row = row; return this; };
  Q.prototype.update = function (p) { this.op = 'update'; this.patch = p; return this; };
  Q.prototype.delete = function () { this.op = 'delete'; return this; }; // v55.83-UM — removes the matching rows, returns them
  Q.prototype.upsert = function (row, o) { this.op = 'upsert'; this.row = row; this.conflict = String((o && o.onConflict) || '').split(','); return this; };
  function violates(table, row, skipId) {
    var us = self.uniques[table] || []; var rows = self.t[table] || [];
    for (var i = 0; i < us.length; i++) {
      var u = us[i]; var cols = u.cols || u; var where = u.where || function () { return true; };
      if (!where(row) || cols.some(function (c) { return row[c] == null; })) { continue; }
      if (rows.some(function (x) { return x.id !== skipId && where(x) && cols.every(function (c) { return String(x[c]) === String(row[c]); }); })) { return true; }
    }
    return false;
  }
  Q.prototype.exec = function () {
    if (self.fail[this.table] && self.fail[this.table][this.op]) { return { error: { message: self.fail[this.table][this.op] }, data: null }; }
    var rows = self.t[this.table] || (self.t[this.table] = []); var f = this.filters;
    function match(r) { for (var i = 0; i < f.length; i++) { if (!f[i](r)) { return false; } } return true; }
    var stamp = function () { return new Date(Date.now() + (++seq)).toISOString(); };
    if (this.op === 'insert') {
      var list = Array.isArray(this.row) ? this.row : [this.row]; var made = [];
      for (var i = 0; i < list.length; i++) {
        if (violates(this.table, list[i], null)) { return { error: { code: '23505', message: 'duplicate key value violates unique constraint' }, data: null }; }
        var n = Object.assign({ id: 'id' + (++seq), updated_at: stamp(), created_at: stamp() }, list[i]); rows.push(n); made.push(n);
      }
      return { error: null, data: this.one ? made[0] : made };
    }
    if (this.op === 'upsert') {
      var row = this.row; var cc = this.conflict;
      var ex = rows.filter(function (x) { return cc.every(function (c) { return String(x[c]) === String(row[c]); }); })[0];
      if (ex) { Object.assign(ex, row); return { error: null, data: [ex] }; }
      var nn = Object.assign({ id: 'id' + (++seq), updated_at: stamp() }, row); rows.push(nn); return { error: null, data: [nn] };
    }
    if (this.op === 'update') {
      var hit = rows.filter(match); var p = this.patch; var tbl = this.table;
      for (var h = 0; h < hit.length; h++) { if (violates(tbl, Object.assign({}, hit[h], p), hit[h].id)) { return { error: { code: '23505', message: 'duplicate key value violates unique constraint' }, data: null }; } }
      hit.forEach(function (r) { Object.assign(r, p); if (!p.updated_at) { r.updated_at = stamp(); } });
      return { error: null, data: hit };
    }
    if (this.op === 'delete') {
      var gone = rows.filter(match); self.t[this.table] = rows.filter(function (r) { return !match(r); });
      return { error: null, data: gone };
    }
    var out = rows.filter(match);
    var sorts = this.sorts || [];
    if (sorts.length) { out = out.slice().sort(function (x, y) { for (var si = 0; si < sorts.length; si++) { var c = sorts[si].col; var a = x[c], b = y[c]; if (a === b) { continue; } if (a == null) { return 1; } if (b == null) { return -1; } var r = a < b ? -1 : 1; return sorts[si].asc ? r : -r; } return 0; }); }
    if (this.rng) { out = out.slice(this.rng[0], this.rng[1] + 1); }
    if (this.lim != null) { out = out.slice(0, this.lim); }
    if (!this.one && self.maxRows && out.length > self.maxRows) { out = out.slice(0, self.maxRows); }
    return { error: null, data: this.one ? (out[0] || null) : out };
  };
  Q.prototype.then = function (res, rej) { try { return Promise.resolve(this.exec()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } };
  self.from = function (t) { return new Q(t); };
  self.rpcs = {};
  self.rpc = function (name, args) { var fn = self.rpcs[name]; return Promise.resolve(fn ? fn(args, self) : { error: { message: 'no rpc ' + name }, data: null }); };
}
module.exports = { FakeDb: FakeDb };
