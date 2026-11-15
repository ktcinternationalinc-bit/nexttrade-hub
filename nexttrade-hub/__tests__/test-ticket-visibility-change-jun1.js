var fs=require('fs');
var src=fs.readFileSync('src/components/TicketsTab.jsx','utf8');
var fails=[];
function ok(n,c){ if(!c) fails.push(n); }

ok('Visibility control added', /Visibility \/ /.test(src));
ok('three options normal/confidential/private', /value="normal"/.test(src) && /value="confidential"/.test(src) && /value="private"/.test(src));
ok('private gated to super admin in handler', /wantPrivate && !isSuperAdmin/.test(src));
ok('private option only shown to super_admin or already-private', /\(isSuperAdmin \|\| sel\.is_private\) && <option value="private"/.test(src));
ok('mutually exclusive: sets both flags from single choice', /is_private: wantPrivate/.test(src) && /is_confidential: wantConfidential/.test(src));
ok('private_to set to creator when private, null otherwise', /private_to: wantPrivate \? myId : null/.test(src));
ok('saves via dbUpdate to tickets', /dbUpdate\('tickets', sel\.id, patch, myId\)/.test(src));
ok('writes audit system comment', /Visibility changed to/.test(src) && /is_system: true/.test(src));
ok('logs activity', /Changed visibility of/.test(src));
ok('optimistic rollback on error', /setSel\(prev\)/.test(src));
ok('only editors see control', /canEditTicketContent\(sel\) && \(\s*<div className="rounded-lg p-3 bg-slate-100">/.test(src.replace(/\n/g,' ')) || /canEditTicketContent\(sel\) &&/.test(src));
// guardrails
ok('no template literals introduced in new block', !/Visibility changed to[^']*`/.test(src));

if(fails.length){ console.log('FAIL:\n - '+fails.join('\n - ')); process.exit(1); }
console.log('PASS — ticket visibility-after-creation ('+12+' checks)');
