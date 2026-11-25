// v55.83-ZJ — Max 25 Nov (photo of Aman's screen): the 📞 Call button was clipped below a
// 70vh overflow-hidden panel on a short screen. Static checks on PhoneWidget.jsx.
// Run: node __tests__/test-v55-83-zj-phone-call-button.js
var fs = require('fs'); var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'src/components/PhoneWidget.jsx'), 'utf8');
var pass = 0, failN = 0;
function check(label, cond) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label); }
var panel = /<div className="fixed bottom-20 left-4[^"]*"[^>]*>/.exec(src);
check('phone panel exists', !!panel);
check('panel scrolls (overflow-y-auto), no longer overflow-hidden', panel && /overflow-y-auto/.test(panel[0]) && !/overflow-hidden/.test(panel[0]));
check('panel height uses the screen minus the button area', panel && /calc\(100vh - 6rem\)/.test(panel[0]));
var dial = src.slice(src.indexOf("{tab === 'dial' && ("), src.indexOf("{tab === 'log' && ("));
var iCall = dial.indexOf('📞 Call</button>'); var iKeys = dial.indexOf('DIAL_KEYS.flat()'); var iInput = dial.indexOf('<input value={number}');
check('dial tab has the input, the Call button and the keypad', iCall > 0 && iKeys > 0 && iInput >= 0);
check('Call button comes BEFORE the keypad (always visible)', iCall > 0 && iKeys > 0 && iCall < iKeys);
check('Call button keeps its guards (number, toE164, idle)', /onClick=\{\(\) => makeCall\(\)\} disabled=\{!number \|\| !toE164\(number\) \|\| callState !== 'idle'\}/.test(dial));
check('Enter in the number box calls, with the same guards', /onKeyDown=\{e => \{ if \(e\.key === 'Enter' && number && toE164\(number\) && callState === 'idle'\) \{ e\.preventDefault\(\); makeCall\(\); \} \}\}/.test(dial));
console.log('\n' + pass + ' passed, ' + failN + ' failed'); process.exit(failN ? 1 : 0);
