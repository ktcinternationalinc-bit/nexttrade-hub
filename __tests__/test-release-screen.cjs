const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { transform } = require('sucrase');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const code = transform(fs.readFileSync(path.join(root, 'src/components/ChangeScheduleTab.jsx'), 'utf8'), { transforms: ['jsx', 'imports'] }).code;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 390]) {
      for (const manager of [true, false]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', r => r.abort());
        await page.setContent('<div id="root"></div>');
        await page.addScriptTag({ path: path.join(root, 'node_modules/react/umd/react.development.js') });
        await page.addScriptTag({ path: path.join(root, 'node_modules/react-dom/umd/react-dom.development.js') });
        await page.evaluate(({ code, manager }) => {
          const items = ['One', 'Two', 'Three', 'Blocked'].map((name, i) => ({ id: 'fix-' + i, title: name, manifest: { sha: 'a'.repeat(40), files: [{ path: 'resources/views/' + name + '.blade.php' }] } }));
          const signoffs = Object.fromEntries(items.map((it, i) => [it.id, { head: 0, manifestDigest: 'b'.repeat(64), where: 'staging', canGo: manager && i < 3, canRollback: false, why: i === 3 ? 'Staging QA missing' : '' }]));
          const data = { ok: true, items, signoffs, canSign: manager, workerOnline: true, executionReady: true, history: [] };
          window.posts = [];
          window.fetch = async (url, opts) => ({ json: async () => {
            if (opts?.method === 'POST') { window.posts.push(JSON.parse(opts.body)); return { ok: true, note: 'Queued for execution, not yet deployed.' }; }
            return data;
          } });
          const mod = { exports: {} };
          new Function('require', 'module', 'exports', code)(id => id === 'react' ? React : { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } } }, mod, mod.exports);
          ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(mod.exports.default));
        }, { code, manager });
        await page.getByRole('heading', { name: 'One', exact: true }).waitFor();
        if (manager) {
          await page.getByRole('checkbox', { name: 'Select One', exact: true }).check();
          await page.getByRole('checkbox', { name: 'Select Three', exact: true }).check();
          await page.getByRole('button', { name: 'Review selected deployments', exact: true }).click();
          const dialog = page.getByRole('dialog');
          assert.ok((await dialog.innerText()).includes('One') && !(await dialog.innerText()).includes('Two'));
          await dialog.getByRole('button', { name: 'Confirm and queue deployment', exact: true }).click();
          await page.getByText('Queued for execution, not yet deployed.').waitFor();
          const posts = await page.evaluate(() => window.posts);
          assert.deepEqual(posts[0].item_ids, ['fix-0', 'fix-2']);
          assert.equal(posts[0].digests['fix-0'], 'b'.repeat(64));
          await page.getByRole('checkbox', { name: 'Select Blocked', exact: true }).check();
          await page.getByRole('button', { name: 'Review selected deployments', exact: true }).click();
          assert.ok(await page.getByRole('button', { name: 'Confirm and queue deployment', exact: true }).isDisabled());
          if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT.replace('.png', '-' + width + '.png'), fullPage: true });
        } else {
          assert.equal(await page.getByRole('checkbox').count(), 0);
          assert.equal(await page.getByRole('button', { name: /Review selected/ }).count(), 0);
        }
        assert.deepEqual(errors, []);
        const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
        assert.ok(sizes.scroll <= sizes.width, JSON.stringify(sizes));
        console.log('PASS browser ' + width + 'px ' + (manager ? 'selection, confirmation, blocked QA, exact payload' : 'view only'));
        await page.close();
      }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
