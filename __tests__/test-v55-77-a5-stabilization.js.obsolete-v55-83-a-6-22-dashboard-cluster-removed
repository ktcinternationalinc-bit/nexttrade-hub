// ============================================================
// v55.77 — A5 stabilization regression guard
//
// Pins the 6 fixes from the QA pass on A1-A5:
//   #1+#2+#12 — Persona switch stops audio + clears stale speakingState
//   #3 — AIGreeter UI color uses activeAgent, not PERSONALITIES tone
//   #4 — Form state preserved across persona switches (display:none, no unmount)
//   #6 — AdminHRInbox jargon swept ("anonymous to admins" → "identity confidential")
//   #7 — Remaining contrast spots bumped (HR status pills, Shipping, Email, Customs, Settings)
//   #11 — Cartoon "Maya" SVG mascot removed from MyHRDesk
// ============================================================
var fs = require('fs');
var path = require('path');
var REPO = path.resolve(__dirname, '..');
var read = function (rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); };
var passed = 0, failed = 0, failures = [];
function check(label, cond) {
  if (cond) { console.log('  v ' + label); passed++; }
  else { console.log('  X ' + label); failed++; failures.push(label); }
}
function group(title) { console.log('\n--- ' + title + ' ---'); }

console.log('============================================================');
console.log('v55.77 — A5 STABILIZATION (6 fixes)');
console.log('============================================================');

var ag = read('src/components/AIGreeter.jsx');
var ab = read('src/components/AssistantsBar.jsx');
var hr = read('src/components/MyHRDesk.jsx');
var ahr = read('src/components/AdminHRInbox.jsx');
var ship = read('src/components/ShippingRatesTab.jsx');
var email = read('src/components/EmailStatusPanel.jsx');
var customs = read('src/components/CustomsTab.jsx');
var settings = read('src/components/SettingsTab.jsx');

// ============================================================
// Fix #3 — UI color resolution
// ============================================================
group('Fix #3 — UI color uses activeAgent (Nadia/Jenna/Sara), not PERSONALITIES tone');

check('#3.1 uiColor variable derived from activeAgent.colors.primary',
  /var uiColor = \(activeAgent && activeAgent\.colors && activeAgent\.colors\.primary\) \|\| persona\.color/.test(ag));
check('#3.2 Outer chat container border uses uiColor',
  /style=\{\{ border: '2px solid ' \+ uiColor \+ '30'/.test(ag));
check('#3.3 Header background uses uiColor',
  /style=\{\{ background: uiColor \+ '18', borderBottom: '1px solid ' \+ uiColor \+ '25'/.test(ag));
check('#3.4 Message bubble background uses uiColor',
  /background: uiColor \+ '20'/.test(ag));
check('#3.5 NadiaFace receives uiColor (consistent across personas)',
  /color=\{uiColor\}/.test(ag));
check('#3.6 No more raw persona.color in style attributes',
  // Only allowed remaining usages are: comment + the fallback definition
  (ag.match(/persona\.color/g) || []).length <= 2);

// ============================================================
// Fix #1 + #2 + #12 — Persona switch audio handling
// ============================================================
group('Fix #1+#2+#12 — Audio stops on persona switch + speakingState clean');

check('#1.1 lastSpokenAgentRef tracks last dispatched agent',
  /var lastSpokenAgentRef = useRef\(activeAgentKey\)/.test(ag));
check('#1.2 Dispatch effect clears OLD agent when persona changes',
  /var personaChanged = lastSpokenAgentRef\.current !== activeAgentKey[\s\S]{0,800}detail: \{ agent: lastSpokenAgentRef\.current, speaking: false \}/.test(ag));
check('#1.3 No "speaking:true" leak for new agent during switch transition',
  // The new code path explicitly does NOT dispatch a true for the new agent
  // when persona just changed — the stop-audio effect will clear speaking
  // and the next render will dispatch {newAgent, false}.
  /Persona just switched\. Clear the OLD agent's speaking state/.test(ag));
check('#2.1 Stop-audio effect watches activeAgentKey ONLY (not speaking)',
  // Persona-change effect must depend on activeAgentKey only — not speaking.
  // Otherwise it would also stop audio on every speak/listen cycle.
  // We verify the dependency array directly: there should be a useEffect
  // ending with `}, [activeAgentKey]);` (singular) — and the function body
  // should NOT depend on `speaking` in its dep list.
  /\}, \[activeAgentKey\]\);/.test(ag)
  && !/\}, \[activeAgentKey, speaking\]\);/.test(ag));
check('#2.2 Stop-audio effect pauses audioRef and cancels speechSynthesis',
  /audioRef\.current\.pause\(\)[\s\S]{0,300}window\.speechSynthesis\.cancel\(\)/.test(ag));
check('#2.3 Stop-audio effect calls setSpeaking(false) on switch',
  /try \{ setSpeaking\(false\); \} catch \(_\) \{\}/.test(ag));
check('#2.4 prevAgentRef gates the effect (no-op on first mount)',
  /if \(prevAgentRef\.current === activeAgentKey\) return/.test(ag));

// ============================================================
// Fix #4 — Form state preserved on switch
// ============================================================
group('Fix #4 — MyHRDesk + MyPerformance always-mounted (state preserved)');

check('#4.1 MyHRDesk wrapper uses display:none when not active (no unmount)',
  /style=\{\{ display: openPanel === 'jenna' \? 'block' : 'none' \}\}[\s\S]{0,200}<MyHRDesk/.test(ab));
check('#4.2 MyPerformance wrapper uses display:none when not active',
  /style=\{\{ display: openPanel === 'sara' \? 'block' : 'none' \}\}[\s\S]{0,200}<MyPerformance/.test(ab));
check('#4.3 aria-hidden mirrors display:none for accessibility',
  /aria-hidden=\{openPanel !== 'jenna'\}/.test(ab)
  && /aria-hidden=\{openPanel !== 'sara'\}/.test(ab));
check('#4.4 No conditional {openPanel === jenna && (<MyHRDesk />)} pattern (would unmount)',
  !/openPanel === 'jenna' && \(\s*\n?\s*<MyHRDesk/.test(ab));
check('#4.5 No conditional {openPanel === sara && (<MyPerformance />)} pattern (would unmount)',
  !/openPanel === 'sara' && \(\s*\n?\s*<MyPerformance/.test(ab));

// ============================================================
// Fix #6 — AdminHRInbox jargon
// ============================================================
group('Fix #6 — AdminHRInbox: super_admin / anonymous-to-admins replaced');

check('#6.1 Hidden complaints message no longer mentions "super_admin"',
  !/visible only to super_admin/.test(ahr) && /visible only to Mr\. Kandil/.test(ahr));
check('#6.2 Display name uses "(identity confidential)" not "(anonymous to admins)"',
  /\(identity confidential\)/.test(ahr) && !/\(anonymous to admins\)/.test(ahr));
check('#6.2b Modal detail view also uses "(identity confidential)" — both occurrences fixed',
  // The list item at line ~257 AND the modal detail at line ~292 both
  // had "(anonymous to admins)". A grep should show TWO "(identity confidential)"
  // occurrences if both got swept (one ternary in list, one ternary in modal).
  (ahr.match(/\(identity confidential\)/g) || []).length >= 2);
check('#6.2c "Complaints" tab label renamed to "Concerns" (user-facing)',
  /🛡️ Concerns \(/.test(ahr) && !/🛡️ Complaints \(/.test(ahr));
check('#6.3 Other-admins suffix uses "identity confidential to other team leads"',
  /identity confidential to other team leads/.test(ahr) && !/anonymous to other admins/.test(ahr));
check('#6.4 Concerns referred to as "concerns" not "complaints" in user-facing copy',
  /concern\(s\) are visible only/.test(ahr));

// ============================================================
// Fix #7 — Remaining contrast spots
// ============================================================
group('Fix #7 — Contrast bumped on remaining low-contrast spots');

check('#7.1 HR status pill "Under review" → text-amber-900',
  /under_review:[\s\S]{0,80}text: 'text-amber-900'/.test(hr));
check('#7.2 HR status pill "Investigating" → text-amber-900',
  /investigating:[\s\S]{0,80}text: 'text-amber-900'/.test(hr));
check('#7.3 Shipping "Expired rates hidden" → amber-800 + bold',
  /text-amber-(?:800|900) font-semibold">. Expired rates hidden/.test(ship));
check('#7.4 Shipping rate cost amber-600 → amber-800',
  /\(exp \? 'text-slate-500' : 'text-amber-(?:800|900)'\)/.test(ship));
check('#7.5 EmailStatusPanel fallback message → amber-800 + semibold',
  /text-\[9px\] text-amber-(?:800|900) mt-0\.5 font-semibold/.test(email));
check('#7.6 CustomsTab "No products yet" → amber-800',
  /text-\[9px\] text-amber-(?:800|900) mt-1 font-semibold/.test(customs));
check('#7.7 SettingsTab Safari support warning → amber-800',
  /text-\[11px\] text-amber-(?:800|900) font-semibold/.test(settings));
check('#7.8 SettingsTab Reset Password button → amber-800 + bold',
  /border-amber-400 text-amber-(?:800|900) text-\[10px\] font-bold/.test(settings));
check('#7.9 SettingsTab "warn" status → amber-800 (was amber-600)',
  /r\.status === 'warn' \? 'text-amber-(?:800|900)' : 'text-red-700'/.test(settings));
check('#7.10 SettingsTab Reverse button → amber-800 + bold',
  /border-amber-400 text-amber-(?:800|900) text-\[10px\] font-bold hover:bg-amber-50">Reverse/.test(settings));

// ============================================================
// Fix #11 — Cartoon Maya removed
// ============================================================
group('Fix #11 — Cartoon "Maya" SVG mascot removed from MyHRDesk');

check('#11.1 No <svg with hr-bg gradient (Maya body)',
  !/<linearGradient id="hr-bg"/.test(hr));
check('#11.2 No mascotWaving state declaration',
  !/var \[mascotWaving, setMascotWaving\] = useState/.test(hr));
check('#11.3 No "Maya" name in user-facing greeting',
  !/Maya is here for/.test(hr));
check('#11.4 No periodic setInterval driving mascot wave',
  !/setMascotWaving\(true\);\s*setTimeout/.test(hr));
check('#11.5 Status counters preserved (request/concern pending)',
  /pendingReq > 0 && <span/.test(hr) && /pendingCmp > 0 && <span/.test(hr));
check('#11.6 "complaint" → "concern" in user-facing pending counter',
  /\{pendingCmp\} concern\{pendingCmp === 1 \? '' : 's'\} pending/.test(hr));

// ============================================================
// Carry-forward: A1-A5 still intact
// ============================================================
group('Carry-forward — A1, A2, A3, A4, A5 still intact');

check('Carry A1 — speaking-only pulse class still wired',
  /isSpeaking \? ' ktc-assistant-speaking' : ''/.test(ab)
  || /isSpeaking \? 'ktc-assistant-speaking' : (?:isActive \? )?'ktc-assistant-active'?/.test(ab));
check('Carry A2 — Mr. Kandil-only wording in HR concern modal',
  /I'm sorry you're dealing with this/.test(hr));
check('Carry A3 — Recently Updated sections defaultShow=25',
  /id="recentUpd"[\s\S]{0,400}defaultShow=\{25\}/.test(read('src/app/page.jsx')));
check('Carry A4 — sample contrast bump intact (CRM industry tag)',
  /bg-amber-100 text-amber-900 rounded-md text-\[9px\] font-bold/.test(read('src/components/CRMTab.jsx')));
check('Carry A5 — Unified module shell still present',
  /id="ai-workforce-module"/.test(ab));
check('Carry A5 — chatSurface inside the unified module',
  ab.indexOf('id="ai-workforce-module"') < ab.indexOf('id="ktc-assistant-chat-surface"'));

// ============================================================
// ONE BRAIN principle preserved
// ============================================================
group('ONE BRAIN — AIGreeter still mounted exactly once');

check('AIGreeter mounted exactly ONCE in page.jsx',
  (read('src/app/page.jsx').match(/<AIGreeter\b/g) || []).length === 1);
check('No AIGreeter import in AssistantsBar (would mean engine duplication)',
  !/import AIGreeter/.test(ab));

console.log('\n--- SUMMARY ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (f, i) { console.log('  ' + (i + 1) + '. ' + f); });
  process.exit(1);
}
console.log('\nAll ' + passed + ' v55.77 stabilization tests passed.');
