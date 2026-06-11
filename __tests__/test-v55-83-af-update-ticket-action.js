const fs=require('fs');const path=require('path');
const p=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('  ✗ '+m);}};
const route=p('src/app/api/ask/route.js');

// the multi-action loop now handles update_ticket (pushes to actionsExecuted, not the canonical Response.json path)
ok(/v55\.83-AF — this multi-action loop/.test(route),'AF update_ticket branch present in multi-action loop');
ok(/actionsExecuted\.push\(\{ ok: true, type: 'update_ticket', message: execLine/.test(route),'branch records a successful update_ticket action');
ok(/normalizeTicketStatus\(actionData\.status\)/.test(route)&&/normalizeTicketPriority\(actionData\.priority\)/.test(route),'reuses canonical status/priority normalizers');
ok(/ticket_comments/.test(route)&&/notifyTicketAssignedServer/.test(route),'writes a comment + notifies new assignee');

// update_ticket must be handled BEFORE the Unknown-action throw in that loop
var afIdx=route.indexOf("v55.83-AF — this multi-action loop");
var throwIdx=route.indexOf("throw new Error('Unknown action type: ' + actionData.type)");
ok(afIdx>0 && throwIdx>0 && afIdx < throwIdx,'update_ticket branch precedes the Unknown-action fallthrough');

// SWC-safety of the added branch (no backticks/let/const inside it)
var branch=route.substring(afIdx, route.indexOf("} else {", afIdx));
ok(!/`/.test(branch)&&!/\blet \b/.test(branch)&&!/\bconst /.test(branch),'added branch is SWC-safe (var + concat only)');

ok(/version: 'v55\.83-AF'/.test(p('src/components/WhatsNewWidget.jsx')),'WhatsNew AF');
ok(/>v55\.83-AF</.test(p('src/app/page.jsx')),'page stamped AF');

console.log('\nv55.83-AF update_ticket action: '+pass+' passed, '+fail+' failed');
if(fail>0)process.exit(1);console.log('ALL PASS');
