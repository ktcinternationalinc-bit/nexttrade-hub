// ═══════════════════════════════════════════════════════════════════════════
// v55.83-SN — Max, Nov 14 19:53: "How does one even read or view the bill, the actual bill in the bills area?
// If I see all the, you know, the AI stuff about it and stuff like that, where do I view the bill?"
// and Nov 15 01:41, on the fix I proposed: "Yes on your other suggestion".
// The bill document is shown on the Bills screen next to what the Hub read; a bill with no file says so and can
// have one attached. Bill documents stay private: 'pv/' paths in bills-private, signed links only.
// ═══════════════════════════════════════════════════════════════════════════
var path = require('path'); var fs = require('fs');
var root = path.join(__dirname, '..');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
require(path.join(root, 'node_modules/sucrase/register'));
var R = function (p) { return fs.readFileSync(path.join(root, p), 'utf8'); };
var D = require(path.join(root, 'src/lib/bill-doc.js'));
var pass = 0, failN = 0;
function check(label, cond, extra) { if (cond) { pass++; } else { failN++; } console.log((cond ? '  ✓ ' : '  ✗ FAIL: ') + label + (cond ? '' : '  ' + JSON.stringify(extra || '').substring(0, 600))); }
console.log('SN — view the actual bill');
check('1: file kinds: PDF shown in a frame, photos shown as a picture, anything else offered as a link, nothing = "none"',
  D.docKind('pv/1731500000000-Bill.PDF') === 'pdf' && D.docKind('pv/1-x.jpeg') === 'image' && D.docKind('pv/1-x.png') === 'image' && D.docKind('pv/1-x.xlsx') === 'other' && D.docKind('') === 'none' && D.docKind(null) === 'none');
check('2: private files come from the private bucket; only old non-private paths use the old one', D.docBucket('pv/1-x.pdf') === 'bills-private' && D.docBucket('bills/x.pdf') === 'attachments');
check('3: the name shown drops the storage prefix', D.docName('pv/1731500000000-NexPac_4411.pdf') === 'NexPac_4411.pdf');
var np = D.newDocPath('Nex Pac #4411 (final).pdf', 1731500000000);
check('4: a new attachment gets a private path with a safe name, and the server check accepts exactly that shape', np === 'pv/1731500000000-Nex_Pac__4411__final_.pdf' && D.isPrivateDocPath(np), np);
check('5: the server check refuses anything else — public paths, other folders, path tricks',
  !D.isPrivateDocPath('attachments/x.pdf') && !D.isPrivateDocPath('pv/../x.pdf') && !D.isPrivateDocPath('pv/1731500000000-a/b.pdf') && !D.isPrivateDocPath('') && !D.isPrivateDocPath('pv/x.pdf'));
var React = require('react'); var RS = require('react-dom/server');
var V = require(path.join(root, 'src/components/BillDocViewer.jsx'));
var h0 = RS.renderToStaticMarkup(React.createElement(V.default, { bill: { id: 'b1' }, canManage: true, api: function () {} }));
check('6: a bill with no file says so in plain words and offers "Attach the bill" (never a dead or hidden button)',
  h0.indexOf('No file is attached to this bill') > 0 && h0.indexOf('Attach the bill (PDF or photo)') > 0);
var h1 = RS.renderToStaticMarkup(React.createElement(V.default, { bill: { id: 'b1' }, canManage: false, api: function () {} }));
check('7: someone who cannot manage bills sees the same note but no attach button', h1.indexOf('No file is attached') > 0 && h1.indexOf('Attach the bill') < 0);
var h2 = RS.renderToStaticMarkup(React.createElement(V.default, { bill: { id: 'b1', attachment_path: 'pv/1731500000000-NexPac_4411.pdf' }, canManage: true, api: function () {} }));
check('8: a bill with a file shows its name and "Opening the bill…" until the private link arrives', h2.indexOf('NexPac_4411.pdf') > 0 && h2.indexOf('Opening the bill') > 0);
var h3 = RS.renderToStaticMarkup(React.createElement(V.BillDocToggle, { bill: { id: 'b1', attachment_path: 'pv/1731500000000-a.pdf' } }));
check('9: inside the validation checks there is a "View the bill" button', h3.indexOf('View the bill') > 0);
var VS = R('src/components/BillDocViewer.jsx'), TAB = R('src/components/BillsTab.jsx'), RT = R('src/app/api/accounting/bills/route.js');
check('10: private link only (1 hour) — the viewer never asks for a public link', VS.indexOf('createSignedUrl(path, 3600)') > 0 && VS.indexOf('getPublicUrl') < 0);
check('11: readable in the dark skin — explicit dark text on white, the file input carries nt-light, no browser pop-ups',
  VS.indexOf("background: '#ffffff', color: '#0f172a'") > 0 && VS.indexOf('className="nt-light"') > 0 && !/window\.(alert|confirm|prompt)\(/.test(VS));
check('12: Bills list — a clear "📄 View bill" button on the row (the tiny paperclip is gone); a bill without a file reads "View · no file"',
  TAB.indexOf("'📄 View bill' : 'View · no file'") > 0 && TAB.indexOf('>📎</button>') < 0);
check('13: the open bill shows the document beside the lines (side by side on a wide screen, stacked on a phone) and in the validation panel',
  TAB.indexOf('grid grid-cols-1 lg:grid-cols-2') > 0 && TAB.indexOf('<BillDocViewer bill={b}') > 0 && TAB.indexOf('<BillDocToggle bill={validating.bill}') > 0);
var seg = RT.substring(RT.indexOf("if (action === 'attach_bill_file')"), RT.indexOf("if (action === 'advance_flag')"));
check('14: server — attaching needs Bills: Manage (a write action), a private path, an existing bill that is not deleted',
  RT.indexOf('attach_bill_file: 1') > 0 && seg.indexOf('^pv\\/\\d{10,}-[a-zA-Z0-9._-]{1,60}$') > 0 && seg.indexOf("record_status === 'deleted'") > 0);
check('15: server — a bill that already has its file keeps it (never replaced), and every attach is on the audit trail',
  seg.indexOf('already has its file') > 0 && seg.indexOf("'bill_file_attached'") > 0 && seg.indexOf('status: 409') > 0);
check('16: API route style — var + string concatenation only in the new action', !/\b(let|const)\s/.test(seg) && seg.indexOf('`') < 0);
console.log('\n' + pass + ' passed, ' + failN + ' failed');
process.exit(failN ? 1 : 0);
