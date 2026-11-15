// Targeted tests: social provider adapter + dispatch route wiring.
var fs=require('fs'), path=require('path');
var fails=[];
function ok(name,cond,extra){ if(!cond){fails.push(name+(extra?' :: '+extra:''));} }

// ---- provider lib loads as a module (strip ES export for Node eval) ----
var libSrc=fs.readFileSync('src/lib/social-providers.js','utf8');
var script=libSrc.replace(/export\s*\{[^}]*\}\s*;?/,'')+'\nmodule.exports={PROVIDERS,isLive,labelFor,composeText,publish};';
var mod={}; (function(){ var module={exports:{}}; eval(script); mod=module.exports; })();

ok('PROVIDERS has linkedin/facebook/instagram',
   mod.PROVIDERS && mod.PROVIDERS.linkedin && mod.PROVIDERS.facebook && mod.PROVIDERS.instagram);
ok('all platforms start NOT live (manual until approval)',
   !mod.PROVIDERS.linkedin.live && !mod.PROVIDERS.facebook.live && !mod.PROVIDERS.instagram.live);
ok('isLive false when not approved', mod.isLive('linkedin')===false);
ok('labelFor maps', mod.labelFor('instagram')==='Instagram');

// composeText: caption + #hashtags, normalizes missing leading #
var t=mod.composeText('Hello world',['oem','#pvc','leather']);
ok('composeText keeps caption', /Hello world/.test(t));
ok('composeText adds # to bare tag', /#oem/.test(t));
ok('composeText keeps existing #', /#pvc/.test(t));
ok('composeText handles no hashtags', mod.composeText('Just text',[])==='Just text');

// publish() in manual mode returns ready-to-paste text, never throws
(async function(){
  var r=await mod.publish('linkedin','Buy our PVC leather',['stocklot']);
  ok('publish manual mode returns mode:manual', r && r.mode==='manual', JSON.stringify(r));
  ok('publish manual returns paste text', r && /Buy our PVC leather/.test(r.text) && /#stocklot/.test(r.text));

  // ---- dispatch route: structural checks (rules + claim-once + routing) ----
  var disp=fs.readFileSync('src/app/api/social/dispatch/route.js','utf8');
  ok('dispatch: no template literals (backticks)', disp.indexOf('`')===-1, 'found backtick');
  ok('dispatch: no let/const', !/\b(let|const)\s/.test(disp));
  ok('dispatch: claims via is(claimed_at,null)', /\.is\('claimed_at', null\)/.test(disp));
  ok('dispatch: queries due rows (lte scheduled_for)', /\.lte\('scheduled_for'/.test(disp));
  ok('dispatch: auto_posted path updates social_posts posted', /status: 'posted'/.test(disp));
  ok('dispatch: manual path sets awaiting_manual', /awaiting_manual/.test(disp));
  ok('dispatch: pings via notifyServer social_ready', /notifyServer\('social_ready'/.test(disp));
  ok('dispatch: stamps dispatched_at + outcome', /dispatched_at/.test(disp) && /outcome:/.test(disp));
  ok('dispatch: exports GET and POST', /export async function GET/.test(disp) && /export async function POST/.test(disp));

  if(fails.length){ console.log('FAIL ('+fails.length+'):\n - '+fails.join('\n - ')); process.exit(1); }
  else console.log('PASS — social scheduling (provider + dispatch) all checks');
})();
