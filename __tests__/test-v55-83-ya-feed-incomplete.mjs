// v55.83-YA — the warehouse feed answer is read and named plainly (incomplete list / web page) instead of "answered 200".
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFeedBody, feedIncompleteMessage } from '../src/lib/warehouse-feed-read.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } }
function resp(status, text, opts) {
  return { status, ok: status >= 200 && status < 300,
    text: async () => { if (opts && opts.throwText) { throw new Error('The operation was aborted'); } return text; } };
}
const ctlOff = { signal: { aborted: false } }; const ctlOn = { signal: { aborted: true } };
const SECRET = 'TOKEN-abc123-should-never-appear';

// 1. a good list
let r = await readFeedBody(resp(200, JSON.stringify({ ok: true, orders: [1, 2] })), ctlOff, 40);
ok(r.json && r.json.ok === true && r.json.orders.length === 2 && !r.error, 'a complete JSON list is returned as json, no error');

// 2. the body read is cut by the time limit (abort while reading)
r = await readFeedBody(resp(200, '', { throwText: true }), ctlOn, 40);
ok(r.incomplete === true && /still arriving after 40 seconds/.test(r.error) && /incomplete/.test(r.error), 'an abort while the list is arriving says "still arriving after 40 seconds … incomplete"');
ok(!/answered 200/.test(r.error), '… and never just "answered 200"');

// 3. a JSON list that stops part-way (what the Hub received on 23 Nov)
r = await readFeedBody(resp(200, '{"ok":true,"source":"nextrade-staging","orders":[{"id":325,"release_number":"1002-7'), ctlOff, 40);
ok(r.incomplete === true && /incomplete/.test(r.error), 'a JSON body that stops part-way is named incomplete');

// 4. a web page instead of the list — kind + size only, never its text
const page = '<!DOCTYPE html><html><title>Sign in</title><body>' + SECRET + '</body></html>';
r = await readFeedBody(resp(200, page), ctlOff, 40);
ok(/did not send the order list/.test(r.error) && /a web page/.test(r.error) && new RegExp(String(page.length)).test(r.error), 'a web page is named as "a web page" with its size');
ok(r.error.indexOf(SECRET) < 0 && r.error.indexOf('Sign in') < 0, '… and the body text is never put into the message');

// 5. empty answer
r = await readFeedBody(resp(200, ''), ctlOff, 40);
ok(/an empty answer/.test(r.error), 'an empty body is named "an empty answer"');

// 6. a refused answer (401 JSON) still parses, so the caller keeps its own "answered 401: unauthorized" message
r = await readFeedBody(resp(401, '{"ok":false,"error":"unauthorized"}'), ctlOff, 40);
ok(r.json && r.json.error === 'unauthorized', 'a 401 JSON answer is returned as json (the route keeps its "answered 401: unauthorized" message)');

// 7. older Response doubles without text(): parsed as before
r = await readFeedBody({ status: 200, ok: true, json: async () => ({ ok: true, orders: [] }) }, ctlOff, 40);
ok(r.json && r.json.ok === true, 'a Response without text() falls back to json() as before');

ok(/40 seconds/.test(feedIncompleteMessage(40)) && /Nothing was changed/.test(feedIncompleteMessage(40)), 'the message says nothing was changed in the Hub');

// 8. the three readers use it (and the token header / redirect rule is unchanged)
for (const f of ['src/app/api/accounting/order-monitor/route.js', 'src/app/api/accounting/arrival-reminders/route.js', 'src/app/api/accounting/warehouse-shipping/route.js']) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  ok(/import \{ readFeedBody \} from '..\/..\/..\/..\/lib\/warehouse-feed-read'/.test(s) && /readFeedBody\(res, ctl, 40\)/.test(s), f + ' imports and uses readFeedBody');
  ok(/redirect: 'error'/.test(s) && /'X-Hub-Feed-Token': cfg\.token/.test(s), f + ' still sends the token only with redirect:error');
}
const lib = fs.readFileSync(path.join(root, 'src/lib/warehouse-feed-read.js'), 'utf8');
ok(!/^['"]use client['"]/m.test(lib), 'the helper is server-safe (no use client)');
const page2 = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
const top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(wn);
ok(wn.indexOf("version: 'v55.83-YA'") > 0 && !!top && page2.indexOf('>' + top[1] + '</span>') > 0, 'What’s New has YA and the badge names the newest entry');

console.log('\nYA feed-incomplete: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
