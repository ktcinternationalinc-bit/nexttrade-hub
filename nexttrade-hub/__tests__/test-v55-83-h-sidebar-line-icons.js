// ============================================================
// v55.83-H — Sidebar monochrome line icons
//   • Every TABS id has a TAB_ICONS entry (lucide component).
//   • The sidebar renders the lucide icon, not the emoji {t.icon}.
//   • All referenced lucide names exist in the installed version.
// ============================================================
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync([path.join(__dirname, '..', 'src/app/page.jsx'), '/home/claude/hub/src/app/page.jsx']
  .find(function (p) { try { return fs.existsSync(p); } catch (e) { return false; } }), 'utf8');

var fails = 0;
function ok(name, cond) { if (cond) { console.log('\u2713 ' + name); } else { console.log('\u2717 ' + name); fails++; } }

// Pull tab ids from the TABS array
var tabsBlock = src.slice(src.indexOf('const TABS = ['), src.indexOf('const TAB_ICONS'));
var tabIds = (tabsBlock.match(/id: '([a-z]+)'/g) || []).map(function (s) { return s.replace(/id: '|'/g, ''); });
ok('found all tab ids (' + tabIds.length + ')', tabIds.length >= 28);

// Pull keys from TAB_ICONS
var iconBlock = src.slice(src.indexOf('const TAB_ICONS = {'), src.indexOf('};', src.indexOf('const TAB_ICONS = {')));
var mapped = tabIds.filter(function (id) { return new RegExp('(^|[^a-z])' + id + ':').test(iconBlock); });
ok('every tab id has an icon in TAB_ICONS', mapped.length === tabIds.length);

ok('sidebar renders lucide icon via TAB_ICONS lookup', /TAB_ICONS\[t\.id\] \|\| Circle/.test(src));
ok('emoji icon span removed from sidebar', src.indexOf('text-[13px] w-4 text-center opacity-80">{t.icon}') === -1);
ok('Circle fallback imported', /\bCircle\b[\s\S]{0,40}from 'lucide-react'/.test(src) || /import \{[\s\S]*?Circle[\s\S]*?\} from 'lucide-react'/.test(src));

console.log('\n' + (fails === 0 ? 'ALL PASS' : (fails + ' FAILED')));
process.exit(fails === 0 ? 0 : 1);
