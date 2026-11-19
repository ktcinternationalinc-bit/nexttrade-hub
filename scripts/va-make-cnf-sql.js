// v55.83-VA — writes the REAL "KTC Egypt / Moustafa are CNF" SQL from the template and the exact customers Max confirmed.
//   node scripts/va-make-cnf-sql.js <approved.json> <out.sql>
// approved.json = [{ "id": "<customer uuid>", "name": "<the name exactly as the read-only list showed it>" }, ...]
// The ids are written into the SQL as literals (uuid-checked here); the name is the drift guard the SQL re-checks before changing.
var fs = require('fs'); var path = require('path');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function make(approved) {
  if (!Array.isArray(approved) || !approved.length) { throw new Error('no customers given'); }
  var seen = {};
  var rows = approved.map(function (a) {
    var id = String(a.id || '').trim().toLowerCase(); var name = String(a.name === null || a.name === undefined ? '' : a.name);
    if (!UUID.test(id)) { throw new Error('not a customer id: ' + a.id); }
    if (!name.trim()) { throw new Error('no confirmed name for ' + id); }
    if (seen[id]) { throw new Error('listed twice: ' + id); } seen[id] = true;
    return "  ('" + id + "'::uuid, '" + name.split("'").join("''") + "'::text)";
  }).join(',\n');
  var tpl = fs.readFileSync(path.join(__dirname, '..', 'sql', 'v55-83-VA-egypt-moustafa-cnf.TEMPLATE.sql'), 'utf8');
  var parts = tpl.split('/*APPROVED*/'); // split / join: never String.replace (the SQL holds $$)
  if (parts.length !== 4) { throw new Error('template: expected 3 places for the customer list, found ' + (parts.length - 1)); }
  return parts.join(rows).split('-- TEMPLATE: scripts/va-make-cnf-sql.js writes the real file from the customer ids Max confirmed. Do NOT run this template.').join('-- Written by scripts/va-make-cnf-sql.js for exactly ' + approved.length + ' customer(s) Max confirmed.');
}
module.exports = { make: make };
if (require.main === module) {
  var out = make(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  fs.writeFileSync(process.argv[3], out);
  console.log('written ' + process.argv[3] + ' (' + out.length + ' characters)');
}
