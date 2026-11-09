// A tiny in-memory stand-in for the Supabase client (enough of PostgREST's chain for these routes).
var crypto = require('crypto');
function MemDB(seed) { this.t = seed || {}; this.seq = 1; }
MemDB.prototype.from = function (name) { var db = this; if (!db.t[name]) { db.t[name] = []; } return new Q(db, name); };
function Q(db, name) { this.db = db; this.name = name; this.filters = []; this.op = 'select'; this.payload = null; this.sgl = 0; this.lim = null; this.rng = null; this.wantRows = false; }
['eq', 'neq', 'gte', 'lte', 'in', 'is'].forEach(function (k) {
  Q.prototype[k] = function (col, val) { this.filters.push([k, col, val]); return this; };
});
Q.prototype.not = function (col, op, val) { this.filters.push(['not_' + op, col, val]); return this; };
Q.prototype.or = function (expr) { this.filters.push(['or', expr, null]); return this; };
Q.prototype.like = function (col, pat) { this.filters.push(['like', col, pat]); return this; };
Q.prototype.ilike = function (col, pat) { this.filters.push(['ilike', col, pat]); return this; };
Q.prototype.select = function () { if (this.op !== 'select') { this.wantRows = true; } return this; };
Q.prototype.order = function () { return this; };
Q.prototype.limit = function (n) { this.lim = n; return this; };
Q.prototype.range = function (a, b) { this.rng = [a, b]; return this; };
Q.prototype.maybeSingle = function () { this.sgl = 1; return this; };
Q.prototype.single = function () { this.sgl = 2; return this; };
Q.prototype.insert = function (rows) { this.op = 'insert'; this.payload = rows; return this; };
Q.prototype.update = function (obj) { this.op = 'update'; this.payload = obj; return this; };
Q.prototype.delete = function () { this.op = 'delete'; return this; };
function match(r, f) {
  var v = r[f[1]];
  if (f[0] === 'eq') { return String(v) === String(f[2]); }
  if (f[0] === 'neq') { return String(v) !== String(f[2]); }
  if (f[0] === 'gte') { return v != null && String(v) >= String(f[2]); }
  if (f[0] === 'lte') { return v != null && String(v) <= String(f[2]); }
  if (f[0] === 'in') { return f[2].map(String).indexOf(String(v)) >= 0; }
  if (f[0] === 'not_is') { return f[2] === null ? !(v === null || v === undefined) : v !== f[2]; }
  if (f[0] === 'like' || f[0] === 'ilike') { var re = new RegExp('^' + String(f[2]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', f[0] === 'ilike' ? 'i' : ''); return re.test(String(v == null ? '' : v)); }
  if (f[0] === 'or') {
    return String(f[1]).split(',').some(function (part) {
      var bits = part.split('.'); var c = bits[0]; var op = bits[1]; var val = bits.slice(2).join('.'); var x = r[c];
      if (op === 'is') { return val === 'null' ? (x === null || x === undefined) : String(x) === val; }
      if (op === 'eq') { return String(x) === val; }
      if (op === 'neq') { return x !== null && x !== undefined && String(x) !== val; }
      if (op === 'lt') { return x != null && String(x) < val; }
      if (op === 'gt') { return x != null && String(x) > val; }
      return false;
    });
  }
  if (f[0] === 'is') { return f[2] === null ? (v === null || v === undefined) : v === f[2]; }
  return true;
}
Q.prototype.then = function (res, rej) {
  try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); }
};
Q.prototype.run = function () {
  var db = this.db; var tbl = db.t[this.name]; var self = this;
  var hooks = db.hooks && db.hooks[this.name];
  var rows = tbl.filter(function (r) { return self.filters.every(function (f) { return match(r, f); }); });
  if (this.op === 'insert') {
    var arr = Array.isArray(this.payload) ? this.payload : [this.payload];
    var made = [];
    for (var i = 0; i < arr.length; i++) {
      var r = Object.assign({ id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, arr[i]);
      if (this.name === 'wire_packages') { r.seq = db.seq++; r.status = r.status || 'draft'; r.fee_amount = r.fee_amount || 0; }
      if (this.name === 'wire_package_lines') {
        if (r.is_open === undefined) { r.is_open = true; }
        if (tbl.some(function (x) { return x.is_open && x.bill_id === r.bill_id; })) { return { data: null, error: { message: 'duplicate key value violates unique constraint "uq_wpkg_line_open_bill"' } }; }
      }
      if (hooks && hooks.insert) { var he = hooks.insert(r); if (he) { return { data: null, error: { message: he } }; } }
      made.push(r);
    }
    made.forEach(function (r) { tbl.push(r); });
    return this.shape(made);
  }
  if (this.op === 'update') {
    for (var j = 0; j < rows.length; j++) {
      if (hooks && hooks.update) { var ue = hooks.update(rows[j], this.payload); if (ue) { return { data: null, error: { message: ue } }; } }
    }
    var pl = this.payload;
    rows.forEach(function (r) { Object.assign(r, pl); if (pl.updated_at === undefined && r.updated_at) { r.updated_at = new Date(Date.now() + Math.random() * 1000).toISOString(); } });
    return this.wantRows || this.sgl ? this.shape(rows) : { data: null, error: null };
  }
  if (this.op === 'delete') { db.t[this.name] = tbl.filter(function (r) { return rows.indexOf(r) < 0; }); return { data: null, error: null }; }
  if (this.rng) { rows = rows.slice(this.rng[0], this.rng[1] + 1); }
  if (this.lim != null) { rows = rows.slice(0, this.lim); }
  return this.shape(rows.map(function (r) { return Object.assign({}, r); }));
};
Q.prototype.shape = function (rows) {
  if (this.sgl) { return { data: rows[0] || null, error: (this.sgl === 2 && !rows[0]) ? { message: 'no rows' } : null }; }
  return { data: rows, error: null };
};
module.exports = MemDB;
