// v55.83-YA — the warehouse feed answer is read and named plainly instead of "answered 200".
// rev2 (Codex 23 Nov 22:15): three different messages — a REAL time-limit abort, a body read that broke without an abort,
// and JSON that stops part-way or is malformed (even when it arrives at once). No size / compression / measured cause is
// stated for any failure. No body text and no token in any message.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFeedBody, feedIncompleteMessage, feedBrokenMessage, feedDamagedMessage } from '../src/lib/warehouse-feed-read.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } }
function resp(status, text, opts) {
  return { status, ok: status >= 200 && status < 300,
    text: async () => { if (opts && opts.throwText) { throw new Error(opts.throwText); } return text; } };
}
const ctlOff = { signal: { aborted: false } }; const ctlOn = { signal: { aborted: true } };
const SECRET = 'TOKEN-abc123-should-never-appear';
const ENDS = /Nothing was changed in the Hub\.$/;
const NO_CLAIM = (s) => !/10 MB|compress|too slowly|is sending it/i.test(s); // never a size, compression or a measured cause
const errors = [];
function keep(r) { if (r && r.error) { errors.push(r.error); } return r; }

console.log('a complete list');
let r = await readFeedBody(resp(200, JSON.stringify({ ok: true, orders: [1, 2] })), ctlOff, 40);
ok(r.json && r.json.ok === true && r.json.orders.length === 2 && !r.error, 'a complete JSON list is returned as json, no error');

console.log('(a) a REAL abort — the time limit fired while the list was arriving');
r = keep(await readFeedBody(resp(200, '', { throwText: 'This operation was aborted' }), ctlOn, 40));
ok(r.aborted === true && r.incomplete === true && r.error === feedIncompleteMessage(40), 'body read aborted by the limit → the "still arriving" message, marked aborted');
ok(/still arriving after 40 seconds and was cut off/.test(r.error) && /may be sending it slowly; try again later/.test(r.error), '… "still arriving after 40 seconds and was cut off — the warehouse may be sending it slowly; try again later"');
ok(ENDS.test(r.error) && NO_CLAIM(r.error) && !/answered 200/.test(r.error), '… ends "Nothing was changed in the Hub.", no size / compression claim, never "answered 200"');
ok(/after 25 seconds/.test(feedIncompleteMessage(25)), '… N is the caller’s own limit');
r = keep(await readFeedBody(resp(200, '{"ok":true,"orders":[{"id":3'), ctlOn, 40));
ok(r.aborted === true && r.error === feedIncompleteMessage(40), 'a partial body handed back after the abort → also the "cut off" message (the abort is what happened)');

console.log('(b) the body read failed WITHOUT an abort');
r = keep(await readFeedBody(resp(200, '', { throwText: 'terminated: other side closed' }), ctlOff, 40));
ok(r.error === feedBrokenMessage() && /connection broke while the order list was arriving/.test(r.error), 'a broken connection → "the connection broke while the order list was arriving"');
ok(!r.aborted && !/seconds|cut off|slow/i.test(r.error), '… never claims a time limit or a slow warehouse');
ok(ENDS.test(r.error) && NO_CLAIM(r.error), '… ends "Nothing was changed in the Hub.", no size / compression claim');

console.log('(c) JSON that stops part-way or is malformed — arrives at once, no abort');
r = keep(await readFeedBody(resp(200, '{"ok":true,"source":"nextrade-staging","orders":[{"id":325,"release_number":"1002-7'), ctlOff, 40));
ok(r.error === feedDamagedMessage() && /arrived incomplete or damaged/.test(r.error), 'a JSON body that stops part-way → "arrived incomplete or damaged"');
ok(!r.aborted && !/seconds|cut off|slow/i.test(r.error), '… no time limit or slow-warehouse claim when no abort happened');
r = keep(await readFeedBody(resp(200, '{ok: true, token: "' + SECRET + '"}'), ctlOff, 40));
ok(r.error === feedDamagedMessage(), 'immediately malformed JSON (bad syntax, complete) → "incomplete or damaged"');
r = keep(await readFeedBody(resp(200, '[{"id":1},'), ctlOff, 40));
ok(r.error === feedDamagedMessage(), 'a JSON array that stops part-way → "incomplete or damaged"');
ok(ENDS.test(r.error) && NO_CLAIM(r.error), '… ends "Nothing was changed in the Hub.", no size / compression claim');

console.log('not the list at all');
const page = '<!DOCTYPE html><html><title>Sign in</title><body>' + SECRET + '</body></html>';
r = keep(await readFeedBody(resp(200, page), ctlOff, 40));
ok(/did not send the order list/.test(r.error) && /a web page/.test(r.error) && new RegExp(String(page.length)).test(r.error), 'a web page is named as "a web page" with its size');
ok(r.error.indexOf('Sign in') < 0 && ENDS.test(r.error), '… its text is never put into the message, and it ends "Nothing was changed in the Hub."');
r = keep(await readFeedBody(resp(200, 'Internal error ' + SECRET), ctlOff, 40));
ok(/it sent text, /.test(r.error), 'plain text is named "text" with its size');
r = keep(await readFeedBody(resp(200, ''), ctlOff, 40));
ok(/an empty answer/.test(r.error) && ENDS.test(r.error), 'an empty body is named "an empty answer"');

console.log('kept from YA');
r = await readFeedBody(resp(401, '{"ok":false,"error":"unauthorized"}'), ctlOff, 40);
ok(r.json && r.json.error === 'unauthorized' && !r.error, 'a 401 JSON answer is returned as json (the route keeps its "answered 401: unauthorized" message)');
r = await readFeedBody({ status: 200, ok: true, json: async () => ({ ok: true, orders: [] }) }, ctlOff, 40);
ok(r.json && r.json.ok === true, 'a Response without text() falls back to json() as before');
r = keep(await readFeedBody({ status: 200, ok: true, json: async () => { throw new Error('aborted'); } }, ctlOn, 40));
ok(r.aborted === true && r.error === feedIncompleteMessage(40), '… and its aborted json() → the "cut off" message');
r = keep(await readFeedBody({ status: 200, ok: true, json: async () => { throw new Error('Unexpected end'); } }, ctlOff, 40));
ok(/did not send a readable order list/.test(r.error) && ENDS.test(r.error) && !r.aborted, '… its failed json() without an abort → "did not send a readable order list", no abort claim');

console.log('no leak, every message');
ok(errors.length >= 11, 'collected ' + errors.length + ' failure messages');
ok(errors.every((e) => e.indexOf(SECRET) < 0 && e.indexOf('TOKEN-') < 0), 'no message contains the token or the body text');
ok(errors.every((e) => ENDS.test(e)), 'every failure message ends "Nothing was changed in the Hub."');
ok(errors.every(NO_CLAIM), 'no failure message states a size, compression or a measured cause');

console.log('wiring');
for (const f of ['src/app/api/accounting/order-monitor/route.js', 'src/app/api/accounting/arrival-reminders/route.js', 'src/app/api/accounting/warehouse-shipping/route.js']) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  ok(/import \{ readFeedBody \} from '..\/..\/..\/..\/lib\/warehouse-feed-read'/.test(s) && /readFeedBody\(res, ctl, FEED_WAIT_SECONDS\)/.test(s), f + ' imports and uses readFeedBody');
  ok(/redirect: 'error'/.test(s) && /'X-Hub-Feed-Token': cfg\.token/.test(s), f + ' still sends the token only with redirect:error');
  // rev2 — the 40-second timer is set before the try and cleared ONLY in finally, after the body has been read
  const a = s.indexOf('var ctl = new AbortController(); var tm = setTimeout(function () { ctl.abort(); }, FEED_WAIT_MS);'); // v55.83-YR (Max, Nov 24): the limit is 150 s, named once per route
  const fin = s.indexOf('finally { clearTimeout(tm); }', a);
  const blk = a >= 0 && fin > a ? s.substring(a, fin) : '';
  ok(!!blk && blk.indexOf('readFeedBody(res, ctl, FEED_WAIT_SECONDS)') > 0 && s.indexOf('var FEED_WAIT_SECONDS = 150; var FEED_WAIT_MS = FEED_WAIT_SECONDS * 1000;') > 0 && s.indexOf('export const maxDuration = 300;') > 0 && blk.indexOf('clearTimeout') < 0 && /^[^\n]*\n\s*try \{/.test(blk), f + ' keeps the time limit (150 s since v55.83-YR, inside maxDuration 300) through fetch AND readFeedBody, cleared only in finally');
}
const lib = fs.readFileSync(path.join(root, 'src/lib/warehouse-feed-read.js'), 'utf8');
ok(!/^['"]use client['"]/m.test(lib), 'the helper is server-safe (no use client)');
const page2 = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const wn = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
const top = /BUILD_HISTORY = \[\s*\{\s*version: '(v55\.83-[A-Z]+)'/.exec(wn);
ok(wn.indexOf("version: 'v55.83-YA'") > 0 && !!top && page2.indexOf('>' + top[1] + '</span>') > 0, 'What’s New has YA and the badge names the newest entry');
const ya = wn.substring(wn.indexOf("version: 'v55.83-YA'"), wn.indexOf("version: 'v55.83-", wn.indexOf("version: 'v55.83-YA'") + 10));
const plain = ya.split('\n').filter((l) => /\{ text: /.test(l)).join('\n');
const tech = ya.split('\n').filter((l) => /superAdminOnly: true/.test(l)).join('\n');
ok(!!plain && NO_CLAIM(plain) && !/came in incomplete — the warehouse is sending it too slowly/.test(plain), 'What’s New YA (everyone) promises no measured cause, size or compression');
ok(/cut off/.test(plain) && /connection broke/.test(plain) && /incomplete or damaged/.test(plain), '… and names the three cases');
ok(/Observation on 23 Nov/.test(tech) && /compression on the staging site is a separate change awaiting Max/.test(tech), 'the technical note keeps 23 Nov as a dated observation and says compression is separate, awaiting Max');

console.log('\nYA feed-incomplete: ' + pass + ' passed, ' + fail + ' failed');
if (fail) { process.exit(1); }
