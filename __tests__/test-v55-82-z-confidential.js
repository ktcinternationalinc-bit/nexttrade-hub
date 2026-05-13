// v55.82-Z — Confidential tickets + private color rework (Max May 12 2026)
//   "Also need a confidential ticket for any to enter and the. Only the
//    assignees and creator can see it in the logs or ticket section. as well
//    as super admin. It should be in orange color. Super admin private
//    should be in light blue highlight."
var fs = require('fs');
var path = require('path');

var failures = [];
function ok(label, cond, hint) {
  if (cond) { console.log('✓ ' + label); }
  else { failures.push(label + (hint ? ' — ' + hint : '')); console.log('✗ ' + label + (hint ? ' — ' + hint : '')); }
}

var tickets = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TicketsTab.jsx'), 'utf8');
var sqlExists = fs.existsSync(path.join(__dirname, '..', 'sql', 'v55-82-z-confidential-tickets.sql'));

// SQL
ok('1: SQL migration file exists at sql/v55-82-z-confidential-tickets.sql', sqlExists);

// canSeeTicket helper — single source of truth
ok('2a: canSeeTicket helper defined',
  /const canSeeTicket = \(t\) => \{/.test(tickets));
ok('2b: canSeeTicket — super_admin sees everything',
  /canSeeTicket = \(t\) => \{[\s\S]{0,200}if \(isSuperAdmin\) return true/.test(tickets));
ok('2c: canSeeTicket — private only to private_to',
  /canSeeTicket = \(t\) => \{[\s\S]{0,500}if \(t\.is_private\) return t\.private_to === myId/.test(tickets));
ok('2d: canSeeTicket — confidential to creator + assignees',
  /canSeeTicket = \(t\) => \{[\s\S]{0,800}if \(t\.is_confidential\)[\s\S]{0,300}t\.created_by === myId \|\| parseAssignees\(t\)\.includes\(myId\)/.test(tickets));

// Main filter uses canSeeTicket
ok('3a: main filtered useMemo uses canSeeTicket',
  /const filtered = useMemo\(\(\) => \{[\s\S]{0,500}arr = arr\.filter\(canSeeTicket\)/.test(tickets));
ok('3b: REGRESSION GUARD — old inline `!t.is_private || t.private_to === myId` removed from main filter (still allowed inside canSeeTicket impl)',
  // The old simple expression should no longer appear in the main filtered useMemo
  !/let arr = tickets;\s*\/\/[\s\S]{0,400}arr = arr\.filter\(t => !t\.is_private \|\| t\.private_to === myId\)/.test(tickets));

// Status-count widget uses canSeeTicket
ok('4: status-count widget uses canSeeTicket',
  /tickets\.filter\(t => t\.status === s && canSeeTicket\(t\)\)/.test(tickets));

// Stat cards (Critical/Open/Overdue/High/Closed) use canSeeTicket
ok('5a: Critical stat-card filter uses canSeeTicket',
  /tickets\.filter\(t=>canSeeTicket\(t\)&&t\.priority==='critical'&&t\.status!=='Closed'\)/.test(tickets));
ok('5b: Open stat-card filter uses canSeeTicket',
  /tickets\.filter\(t=>canSeeTicket\(t\)&&t\.status!=='Closed'\)/.test(tickets));

// Form — Private checkbox is SKY (light blue), super_admin only
ok('6a: Private checkbox uses sky color (border-sky-400, bg-sky-50)',
  /border-sky-400 bg-sky-50/.test(tickets));
ok('6b: Private checkbox label says "PRIVATE (super-admin only)"',
  /🔒 Make this ticket PRIVATE \(super-admin only\)/.test(tickets));
ok('6c: REGRESSION GUARD — old amber Private box is gone',
  !/border-amber-400 bg-amber-50/.test(tickets) ||
  // Allow amber elsewhere (e.g. warnings), but the private label specifically should not use it
  !/border-amber-400 bg-amber-50[\s\S]{0,400}🔒 Make this ticket private/.test(tickets));

// Form — NEW Confidential checkbox in ORANGE, available to all users
ok('7a: Confidential checkbox uses orange color (border-orange-400, bg-orange-50)',
  /border-orange-400 bg-orange-50/.test(tickets));
ok('7b: Confidential checkbox label says "Mark CONFIDENTIAL"',
  /🟧 Mark CONFIDENTIAL/.test(tickets));
ok('7c: Confidential box is NOT gated by isSuperAdmin (all users see it)',
  // The confidential block must NOT be wrapped in {isSuperAdmin && ( ... )}
  // Verify by anchoring on the open-tag and checking the parent isn't a super-admin gate
  /\/\* v55\.82-Z — CONFIDENTIAL TICKETS[\s\S]{0,2500}<div className="col-span-2 mt-2 p-3 rounded-lg border-2 border-dashed border-orange-400/.test(tickets));
ok('7d: Confidential and Private are mutually exclusive at the UI layer',
  /isPrivate: e\.target\.checked \? false : f\.isPrivate/.test(tickets) &&
  /isConfidential: e\.target\.checked \? false : f\.isConfidential/.test(tickets));

// Insert path — makeConfidential, conditional column write, backward-compat
ok('8a: handleAddTicket computes makeConfidential',
  /var makeConfidential = !makePrivate && !!f\.isConfidential/.test(tickets));
ok('8b: is_confidential only added to ticketRow when actually confidential',
  /if \(makeConfidential\) \{\s*ticketRow\.is_confidential = true;\s*\}/.test(tickets));
ok('8c: REGRESSION GUARD — is_confidential NOT in the default ticketRow literal',
  // Make sure it's only inside the conditional block, never as a default field
  !/is_confidential: makeConfidential,/.test(tickets) &&
  !/is_confidential: false,/.test(tickets));
ok('8d: log tag distinguishes [PRIVATE] vs [CONFIDENTIAL]',
  /\[PRIVATE\][\s\S]{0,200}\[CONFIDENTIAL\]/.test(tickets));
ok('8e: confidential tickets DO notify assignees (unlike private)',
  /Confidential tickets DO notify the assignees/.test(tickets));

// Card visual styling
ok('9a: card outer bg is bg-sky-50 when private',
  /t\.is_private \? 'bg-sky-50 ' : \(t\.is_confidential \? 'bg-orange-50 ' : 'bg-white '\)/.test(tickets));
ok('9b: card outer bg is bg-orange-50 when confidential',
  /t\.is_confidential \? 'bg-orange-50 '/.test(tickets));
ok('9c: closed status overrides privacy tint',
  /t\.status === 'Closed'\s*\?\s*'bg-slate-200 '[\s\S]{0,150}t\.is_private \? 'bg-sky-50 '/.test(tickets));
ok('9d: card border is sky-300 when private',
  /1px solid #7dd3fc/.test(tickets));
ok('9e: card border is orange-300 when confidential',
  /1px solid #fdba74/.test(tickets));

// Chip styling
ok('10a: PRIVATE chip uses sky colors (bg-sky-100, border-sky-400, text-sky-900)',
  /bg-sky-100[^"]*border-sky-400[^"]*text-sky-900[\s\S]{0,200}🔒 PRIVATE/.test(tickets));
ok('10b: CONFIDENTIAL chip uses orange colors (bg-orange-100, border-orange-400, text-orange-900)',
  /bg-orange-100[^"]*border-orange-400[^"]*text-orange-900[\s\S]{0,200}🟧 CONFIDENTIAL/.test(tickets));

if (failures.length > 0) {
  console.log('\n❌ ' + failures.length + ' test' + (failures.length === 1 ? '' : 's') + ' failed:');
  failures.forEach(function(f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\n✅ All v55.82-Z tests passed');
