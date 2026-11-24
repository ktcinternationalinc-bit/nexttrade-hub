const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { transform } = require('sucrase');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..');
const deps = process.env.TEST_DEPS || path.join(root, 'node_modules');
const code = transform(fs.readFileSync(path.join(root, 'src/components/ChangeScheduleTab.jsx'), 'utf8'), { transforms: ['jsx', 'imports'] }).code;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 390]) {
      for (const manager of [true, false]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', r => r.abort());
        await page.setContent('<div role="banner" aria-label="App header" style="height:66px;position:sticky;top:0"></div><div id="root"></div>');
        await page.addScriptTag({ path: path.join(deps, 'react/umd/react.development.js') });
        await page.addScriptTag({ path: path.join(deps, 'react-dom/umd/react-dom.development.js') });
        await page.evaluate(({ code, manager }) => {
          const items = ['One', 'Two', 'Three', 'Blocked'].map((name, i) => ({ id: 'fix-' + i, title: name, needsMax: true, manifest: { sha: 'a'.repeat(40), files: [{ path: 'resources/views/' + name + '.blade.php' }] } }));
          const signoffs = Object.fromEntries(items.map((it, i) => [it.id, { head: 0, manifestDigest: 'b'.repeat(64), where: 'staging', canGo: manager && i < 3, canRollback: false, why: i === 3 ? 'Staging QA missing' : '' }]));
          const data = { ok: true, items, signoffs, canSign: manager, workerOnline: false, worker: { enabled: false, last_seen: '2026-11-24T12:49:07Z' }, executionReady: true, history: [] };
          window.releaseData = data;
          window.posts = [];
          window.fetch = async (url, opts) => ({ json: async () => {
            if (opts?.method === 'POST') {
              const body = JSON.parse(opts.body);
              window.posts.push(body);
              if (url === '/api/releases/review') {
                const passed = body.item_ids.every(id => signoffs[id].canGo);
                const results = items.filter(it => body.item_ids.includes(it.id)).map(it => ({ id: it.id, sha: it.manifest.sha, files: it.manifest.files.map(file => file.path), steps: [], note: signoffs[it.id].why }));
                return { ok: true, passed, results, receipt: passed ? 'review-fixture' : null,
                  heads: Object.fromEntries(body.item_ids.map(id => [id, 0])),
                  builds: Object.fromEntries(body.item_ids.map(id => [id, 'a'.repeat(40)])),
                  digests: Object.fromEntries(body.item_ids.map(id => [id, 'b'.repeat(64)])) };
              }
              body.item_ids.forEach((id, i) => { Object.assign(signoffs[id], { kind: 'go', head: i + 1, requestId: i + 1,
                at: '2026-11-24T13:12:14Z', by: 'Max', sha: 'a'.repeat(40), canGo: false, canWithdraw: true }); });
              return { ok: true, note: 'Queued for execution, not yet deployed.' };
            }
            return data;
          } });
          const mod = { exports: {} };
          new Function('require', 'module', 'exports', code)(id => id === 'react' ? React : { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } } }, mod, mod.exports);
          ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(mod.exports.default));
        }, { code, manager });
        await page.getByRole('heading', { name: 'One', exact: true }).waitFor();
        if (manager) {
          const toolbar = page.getByRole('group', { name: 'Selected Warehouse changes' });
          const reviewButton = toolbar.getByRole('button', { name: 'Review selected deployments', exact: true });
          assert.equal(await page.getByRole('button', { name: 'Review deployment', exact: true }).count(), 0);
          assert.ok(await reviewButton.isDisabled());
          await page.getByRole('checkbox', { name: 'Select One', exact: true }).check();
          await page.getByRole('checkbox', { name: 'Select Three', exact: true }).check();
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForFunction(() => {
            const bar = document.querySelector('[aria-label="Selected Warehouse changes"]');
            const top = bar.getBoundingClientRect().top;
            return top >= 65 && top <= 67 && scrollY > 100;
          });
          await reviewButton.click();
          const dialog = page.getByRole('dialog');
          assert.ok((await dialog.innerText()).includes('One') && !(await dialog.innerText()).includes('Two'));
          assert.ok(await page.getByRole('checkbox', { name: 'Select One', exact: true }).isDisabled());
          await dialog.getByText('Review passed.', { exact: false }).waitFor();
          assert.equal(await page.evaluate(() => window.posts.length), 1);
          await dialog.getByRole('button', { name: 'Approve and queue deployment', exact: true }).click();
          await page.getByText('Queued for execution, not yet deployed.').waitFor();
          const posts = await page.evaluate(() => window.posts);
          assert.deepEqual(posts[0].item_ids, ['fix-0', 'fix-2']);
          assert.deepEqual(posts[1].item_ids, ['fix-0', 'fix-2']);
          assert.equal(posts[1].digests['fix-0'], 'b'.repeat(64));
          assert.equal(posts[1].review_receipt, 'review-fixture');
          const active = page.getByRole('region', { name: 'Active release requests' });
          const future = page.getByRole('region', { name: 'Changes awaiting approval' });
          await active.getByRole('heading', { name: 'One', exact: true }).waitFor();
          assert.equal(await active.getByText('Approved - waiting for worker activation', { exact: false }).count(), 2);
          assert.equal(await active.getByText('Needs your go', { exact: true }).count(), 0);
          assert.equal(await active.getByRole('checkbox').count(), 0);
          assert.equal(await future.getByRole('heading', { name: 'One', exact: true }).count(), 0);
          assert.equal(await page.getByRole('checkbox', { name: 'Select One', exact: true }).count(), 0);
          assert.ok((await active.innerText()).includes('Request #1'));
          await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await active.getByRole('heading', { name: 'One', exact: true }).waitFor();
          assert.equal(await page.getByRole('checkbox', { name: 'Select One', exact: true }).count(), 0);
          await page.evaluate(() => { const d = window.releaseData; d.worker.enabled = true; d.workerOnline = true;
            Object.assign(d.signoffs['fix-0'], { executing: true, canWithdraw: false, execution: { request_id: 1, phase: 'running', started_at: '2026-11-24T13:15:00Z' } }); });
          await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await active.getByText('Running', { exact: false }).waitFor();
          await page.evaluate(() => { window.releaseData.workerOnline = false; });
          await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await active.getByText('Started - worker contact lost; completion unconfirmed', { exact: false }).waitFor();
          await page.evaluate(() => { window.releaseData.signoffs['fix-0'].execution.phase = 'attention'; });
          await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await active.getByText('Blocked - recovery check required', { exact: false }).waitFor();
          await page.evaluate(() => { Object.assign(window.releaseData.signoffs['fix-0'], { kind: 'none', where: 'deployed', executing: false, execution: null, requestId: null, canCheck: true }); });
          await page.getByRole('button', { name: 'Refresh', exact: true }).click();
          await page.getByText('On production — not yet checked', { exact: true }).waitFor();
          assert.equal(await active.getByRole('heading', { name: 'One', exact: true }).count(), 0);
          assert.equal(await future.getByRole('heading', { name: 'One', exact: true }).count(), 0);
          await page.getByRole('checkbox', { name: 'Select Blocked', exact: true }).check();
          await reviewButton.click();
          await page.getByText('Staging QA missing', { exact: true }).last().waitFor();
          assert.ok(await page.getByRole('button', { name: 'Approve and queue deployment', exact: true }).isDisabled());
          if (process.env.TEST_SCREENSHOT) await page.screenshot({ path: process.env.TEST_SCREENSHOT.replace('.png', '-' + width + '.png'), fullPage: true });
        } else {
          assert.equal(await page.getByRole('checkbox').count(), 0);
          assert.equal(await page.getByRole('button', { name: /Review selected|Run review/ }).count(), 0);
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
