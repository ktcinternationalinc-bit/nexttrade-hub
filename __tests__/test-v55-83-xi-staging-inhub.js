// v55.83-XI — Staging warehouse opens INSIDE the Hub (embedded panel) like production. Static checks.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const whatsnew = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
const flat = page.replace(/\s+/g, ' ');
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok: ' + msg); pass++; }

// Tab registered.
ok(/\{ id: 'ntwarehouse-staging', label: '[^']*', icon: '[^']*' \}/.test(page), "'ntwarehouse-staging' tab registered in TABS");

// Sidebar staging entry is now an in-Hub navigate button, NOT a new-tab link.
ok(/navigate\('ntwarehouse-staging'\)/.test(page), 'sidebar staging entry navigates to the in-Hub panel');
// The old sidebar new-tab <a> for staging is gone: only ONE staging-admin new-tab link remains,
// and it is the in-panel "Open in its own window" fallback, not a sidebar entry.
ok((flat.match(/href="https:\/\/fix\.nextrade-staging\.com\/admin" target="_blank"/g) || []).length === 1, 'exactly one staging new-tab link remains (the panel fallback); the sidebar entry is no longer a new-tab link');
// The sidebar staging button is a <button>, and the STAGING · TEST marking is kept.
ok(/navigate\('ntwarehouse-staging'\)[\s\S]{0,1200}STAGING · TEST/.test(page), 'sidebar staging button keeps the STAGING · TEST marking');

// Content panel exists and embeds the staging admin with an open-in-window fallback.
ok(/tab === 'ntwarehouse-staging' && \(/.test(page), "content area renders a block for tab === 'ntwarehouse-staging'");
const idx = page.indexOf("tab === 'ntwarehouse-staging' && (");
const panel = page.slice(idx, idx + 1600);
ok(/<iframe\s+src="https:\/\/fix\.nextrade-staging\.com\/admin"/.test(panel), 'the staging panel embeds fix.nextrade-staging.com/admin in an iframe');
ok(/Open in its own window/.test(panel), 'staging panel has an open-in-new-window fallback');
ok(/target="_blank"[^>]*rel="noopener noreferrer"/.test(panel.replace(/\s+/g, ' ')), 'the fallback link opens a new tab with noopener');
ok(/STAGING · TEST/.test(panel), 'the staging panel shows the STAGING · TEST banner (distinct from production)');
ok(!/token|userProfile|modulePerms|session/i.test(panel), 'the staging iframe carries no Hub token/profile/session');

// It must NOT be placed in a sidebar group (hidden tab, like production ntwarehouse).
ok(!/items: \[[^\]]*'ntwarehouse-staging'/.test(page), "'ntwarehouse-staging' not placed in a sidebar group (hidden tab)");

// The production panel is untouched.
ok(/<iframe src="https:\/\/nextradeindustries\.com\/admin" title="NT Warehouse"/.test(page), 'the production NT Warehouse panel is still present/untouched');

// Badge + What's New.
ok(page.includes('>v55.83-XI</span>'), 'badge bumped to v55.83-XI');
ok(/version: 'v55\.83-XI'/.test(whatsnew), "What's New has a v55.83-XI entry");

console.log('\nXI staging-inhub: ' + pass + '/' + pass + ' checks passed');
process.exit(0);
