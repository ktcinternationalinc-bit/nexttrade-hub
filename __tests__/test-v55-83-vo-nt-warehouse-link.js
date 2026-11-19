// v55.83-VO — NT Warehouse sidebar link. Static checks (no DOM/build needed).
// Verifies: two external links present, correct URLs + rel, production gated by
// the permission switch or super admin, staging gated by super admin only with a
// NON-TRUNCATING TEST badge, and the new permission key registered in SettingsTab.
// Run: node __tests__/test-v55-83-vo-nt-warehouse-link.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
const whatsnew = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok: ' + msg); pass++; }

// 1. Production link present, correct URL, opens in a new tab safely.
ok(page.includes('href="https://nextradeindustries.com/admin"'), 'production link points at the live warehouse');
const prodIdx = page.indexOf('https://nextradeindustries.com/admin');
const prodAnchor = page.slice(prodIdx - 400, prodIdx + 200);
ok(/target="_blank"/.test(prodAnchor) && /rel="noopener noreferrer"/.test(prodAnchor), 'production link opens a new tab with noopener noreferrer');

// 2. Staging link present and marked TEST.
ok(page.includes('href="https://fix.nextrade-staging.com/admin"'), 'staging link points at fix staging');
ok(page.includes('STAGING · TEST'), 'staging link carries a visible TEST label');
const stgIdx = page.indexOf('https://fix.nextrade-staging.com/admin');
const stgAnchor = page.slice(stgIdx - 400, stgIdx + 1400);
ok(/target="_blank"/.test(stgAnchor) && /rel="noopener noreferrer"/.test(stgAnchor), 'staging link opens a new tab with noopener noreferrer');

// 2b. Codex 15:18 P2: the TEST badge is on its own line, NOT inside a truncate span.
const stgFlat = stgAnchor.replace(/\s+/g, ' ');
ok(stgFlat.includes('flex-1 min-w-0') && stgFlat.includes('block truncate">NT Warehouse</span>'), 'staging name sits in a min-w-0 wrapper with its own truncating line');
ok(!/truncate flex-1">\s*<span>NT Warehouse <\/span>\s*<span[^>]*>STAGING/.test(stgFlat), 'the TEST badge is NOT inside the truncating name span (old clipped layout is gone)');
ok(page.includes('do not perform real work here'), 'staging link title reworded per Codex');

// 3. Gating: production block = super admin OR the switch; staging = super admin only.
ok(page.includes("isSuperAdmin || modulePerms?.['NT Warehouse'] === true"), 'production section gated by super admin or the NT Warehouse switch');
ok(/\{isSuperAdmin && \(\s*<a href="https:\/\/fix\.nextrade-staging\.com\/admin"/.test(page.replace(/\n/g, ' ').replace(/\s+/g, ' ')), 'staging link is wrapped in an isSuperAdmin-only guard');

// 4. It must NOT be a Hub tab.
ok(!/id:\s*'ntwarehouse'/.test(page) && !/navigate\('ntwarehouse'\)/.test(page), 'no fake Hub tab was added for the warehouse');

// 5. Permission key registered, default OFF (ACTION_PERMS, not TAB_PERMS).
ok(/'NT Warehouse',\s*\/\/ v55\.83-VO/.test(settings), 'NT Warehouse added to the MODULES list');
const actionIdx = settings.indexOf('const ACTION_PERMS');
const tabIdx = settings.indexOf('const TAB_PERMS');
const keyIdx = settings.indexOf("key: 'NT Warehouse'");
ok(keyIdx > actionIdx && actionIdx > tabIdx, 'NT Warehouse permission lives in ACTION_PERMS (default OFF), not TAB_PERMS (default ON)');

// 6. Version + What's New bumped.
ok(page.includes('v55.83-VO'), 'badge bumped to v55.83-VO');
ok(/version: 'v55\.83-VO'/.test(whatsnew), "What's New has a v55.83-VO entry");

console.log('\nVO nt-warehouse-link: ' + pass + '/' + pass + ' checks passed');
process.exit(0);
