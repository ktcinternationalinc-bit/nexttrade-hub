// v55.83-XJ — warehouse iframe panels scroll horizontally (no clipped edges). Static checks.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const whatsnew = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok: ' + msg); pass++; }

// Helper: grab a tab's content block.
function block(tabId) {
  const i = page.indexOf("tab === '" + tabId + "' && (");
  assert.ok(i >= 0, "block for " + tabId + " exists");
  return page.slice(i, i + 2400);
}

['ntwarehouse', 'ntwarehouse-staging'].forEach(function (tabId) {
  const b = block(tabId);
  // The iframe is wrapped in a horizontally-scrolling div.
  ok(/overflow-x-auto/.test(b) && /overflow-y-hidden/.test(b), tabId + ': iframe wrapper scrolls horizontally (overflow-x-auto, overflow-y-hidden)');
  // The iframe lays out at its full min-width so nothing is clipped.
  ok(/minWidth: 1440/.test(b), tabId + ': iframe has min-width 1440 so the full layout shows');
  ok(/width: '100%'/.test(b), tabId + ': iframe width 100%');
  // The iframe is still inside the wrapper div (wrapper opens before the iframe tag).
  const wrapIdx = b.indexOf('overflow-x-auto');
  const iframeIdx = b.indexOf('<iframe');
  ok(wrapIdx >= 0 && iframeIdx > wrapIdx, tabId + ': the iframe sits inside the scroll wrapper');
  // Still the right src + the open-in-window fallback.
  const src = tabId === 'ntwarehouse' ? 'https://nextradeindustries.com/admin' : 'https://fix.nextrade-staging.com/admin';
  ok(b.indexOf('<iframe src="' + src + '"') >= 0, tabId + ': iframe still points at ' + src);
  ok(/Open in its own window/.test(b), tabId + ': open-in-window fallback still present');
  // No Hub data crosses the frame.
  ok(!/<iframe[^>]*(token|userProfile|modulePerms|session)/i.test(b), tabId + ': iframe carries no Hub token/profile/session');
});

// Staging panel keeps its STAGING · TEST distinction.
ok(/STAGING · TEST/.test(block('ntwarehouse-staging')), 'staging panel keeps the STAGING · TEST marking');

// No stale "NEW TAB" wording left in the sidebar comment.
ok(!/opens the staging\s*\n?\s*copy in a NEW TAB/.test(page) && page.indexOf('NEW TAB') < 0, 'the stale "NEW TAB" sidebar comment is fixed');

// Badge + What's New.
ok(page.includes('>v55.83-XJ</span>'), 'badge bumped to v55.83-XJ');
ok(/version: 'v55\.83-XJ'/.test(whatsnew), "What's New has a v55.83-XJ entry");

console.log('\nXJ warehouse-iframe-scroll: ' + pass + '/' + pass + ' checks passed');
process.exit(0);
