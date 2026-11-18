// v55.83-UK — the toast provider must wrap App, so App's useContext(ToastContext) gets the REAL toast (not the silent fallback)
// that it hands to every Accounting screen. Before: <ToastProvider> was rendered INSIDE App's own return → App read null.
var fs = require('fs'); var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'src/app/page.jsx'), 'utf8').replace(/\r\n/g, '\n');
var pass = 0, failN = 0;
function check(label, cond) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label); }
console.log('UK — toast provider wraps the whole app');
var iApp = src.indexOf('export default function App() {'); var iHub = src.indexOf('function HubApp() {');
check('App renders <ToastProvider><HubApp /></ToastProvider> and nothing else', /export default function App\(\) \{\n  return <ToastProvider><HubApp \/><\/ToastProvider>;\n\}/.test(src));
check('HubApp (the old App body) holds the useContext(ToastContext) call', iHub > iApp && src.indexOf('const _toastRaw = useContext(ToastContext);') > iHub);
var hubBody = src.substring(iHub);
check('HubApp does NOT render a ToastProvider of its own (a context cannot be read by the component that provides it)', hubBody.indexOf('<ToastProvider>') < 0 && hubBody.indexOf('</ToastProvider>') < 0);
check('exactly one ToastProvider in the page', src.split('<ToastProvider>').length === 2);
check('App still hands its toast to Accounting', /<AccountingTab toast=\{toast\}/.test(src));
check('the provider gives success / error / confirm', /success: \(msg\) => addToast\(msg, 'success'\)/.test(src) && /confirm: confirmFn/.test(src));
console.log('\nUK toast provider: ' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
