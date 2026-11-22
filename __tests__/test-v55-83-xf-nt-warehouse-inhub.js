// v55.83-XF — NT Warehouse inside the Hub (both links visible to everyone). Static checks.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/components/SettingsTab.jsx'), 'utf8');
const whatsnew = fs.readFileSync(path.join(root, 'src/components/WhatsNewWidget.jsx'), 'utf8');
const flat = page.replace(/\s+/g, ' ');
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok: ' + msg); pass++; }
ok(/\{ id: 'ntwarehouse', label: '[^']*', icon: '[^']*' \}/.test(page), "'ntwarehouse' tab registered in TABS");
ok(/tab === 'ntwarehouse' && \(/.test(page), "content area renders a block for tab === 'ntwarehouse'");
const panelIdx = page.indexOf("tab === 'ntwarehouse' && (");
const panel = page.slice(panelIdx, panelIdx + 1200);
ok(/<iframe\s+src="https:\/\/nextradeindustries\.com\/admin"/.test(panel), 'the panel embeds the live warehouse in an iframe');
ok(/Open in its own window/.test(panel), 'panel has an open-in-new-window fallback');
ok(/navigate\('ntwarehouse'\)/.test(page), 'sidebar production entry navigates to the in-Hub tab');
ok(!/modulePerms\?\.\['NT Warehouse'\]/.test(page), 'production entry no longer gated by a switch (everyone)');
ok(!/items: \[[^\]]*'ntwarehouse'/.test(page), "'ntwarehouse' not placed in a sidebar group (hidden tab)");
// staging link visible to EVERYONE now (not wrapped in isSuperAdmin)
ok(!/\{isSuperAdmin && \(\s*<a href="https:\/\/fix\.nextrade-staging\.com\/admin"/.test(flat), 'staging link is NOT gated to super admin (everyone sees it)');
ok(page.includes('href="https://fix.nextrade-staging.com/admin"') && page.includes('STAGING · TEST'), 'staging link present, new tab, TEST-marked');
ok(/href="https:\/\/fix\.nextrade-staging\.com\/admin"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(flat), 'staging link opens a new tab with noopener');
ok(!/NT Warehouse/.test(settings), 'the NT Warehouse permission key is removed from SettingsTab');
ok(!/<iframe[^>]*(token|userProfile|modulePerms|session)/i.test(panel), 'the iframe carries no Hub token/profile/session');
ok(page.includes('v55.83-XF'), 'badge bumped to v55.83-XF');
ok(/version: 'v55\.83-XF'/.test(whatsnew), "What's New has a v55.83-XF entry");
console.log('\nXF nt-warehouse-inhub: ' + pass + '/' + pass + ' checks passed');
process.exit(0);
