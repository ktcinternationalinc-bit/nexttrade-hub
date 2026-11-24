// Browser regression: real ProfitabilityTab and pure helpers, synthetic API data.
// External dialogs and backend clients are stubbed; no production data is accessed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const deps = process.env.TEST_DEPS || path.join(root, 'node_modules');
const { transform } = require(path.join(deps, 'sucrase'));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const modules = {};
function bundle(file) {
  const id = path.relative(root, file).replaceAll('\\', '/');
  if (modules[id]) return id;
  modules[id] = '';
  let source = process.env.TEST_SOURCE_REF && id === 'src/components/ProfitabilityTab.jsx'
    ? execFileSync('git', ['show', process.env.TEST_SOURCE_REF + ':' + id], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(file, 'utf8');
  let code = transform(source, { transforms: ['jsx', 'imports'] }).code;
  code = code.replace(/require\(['"]([^'"]+)['"]\)/g, (all, name) => {
    if (!name.startsWith('.')) return all;
    let dest = path.resolve(path.dirname(file), name);
    if (!path.extname(dest)) dest += fs.existsSync(dest + '.js') ? '.js' : '.jsx';
    if (dest.includes(path.join('src', 'components')) || /[\\/](supabase|hub-fetch)\.js$/.test(dest)) return 'require("stub")';
    return 'require(' + JSON.stringify(bundle(dest)) + ')';
  });
  modules[id] = code;
  return id;
}
const entry = bundle(path.join(root, 'src/components/ProfitabilityTab.jsx'));
const row = { key: 'fixture', label: 'Regression fixture', pounds: 100, goods_revenue: 1234.56, transport_revenue: 200, base_cost: 12, commission: 1.5, inbound_allowance: 2, outbound_cost: 150, bonded: 0, total_cost: 165.5, goods_profit: 1219.06, profit: 1269.06, transport_profit: 50, complete: true, invoice_ids: ['fixture'], release_list: ['1002-1'] };
const cell = { ...row, invoice_id: 'fixture', line_id: 'line', invoice: 'Test invoice', invoice_date: '2026-11-19', customer: 'fixture', product_key: 'fixture', product: 'Fixture product', description: 'Fixture shipment', release: '1002-1', release_raw: '1002-1', brokerage: 0, trucking_cost: 70, freight_cost: 80 };
const fixture = { ok: true, totals: row, counts: { invoices_in_period: 1 }, reconciled: { product: true, customer: true, invoice: true }, by_product: [row], by_customer: [row], by_invoice: [row], cells: [cell], flags: [], can_see_margin: true };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const permissions of ['full', 'hide margin', 'hide revenue']) {
      const canSeeMargin = permissions === 'full';
      const canSeeRevenue = permissions !== 'hide revenue';
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.route('**/*', route => route.abort());
      const errors = [];
      page.on('pageerror', err => { errors.push(err.message); console.error(err.message); });
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ path: path.join(deps, 'react/umd/react.development.js') });
      await page.addScriptTag({ path: path.join(deps, 'react-dom/umd/react-dom.development.js') });
      const data = JSON.parse(JSON.stringify(fixture));
      data.can_see_margin = canSeeMargin;
      data.revenue_hidden = !canSeeRevenue;
      for (const target of [data.totals, ...data.by_product, ...data.by_customer, ...data.by_invoice, ...data.cells]) {
        if (!canSeeMargin) for (const key of ['goods_profit', 'profit', 'transport_profit']) delete target[key];
        if (!canSeeRevenue) for (const key of ['goods_revenue', 'transport_revenue']) delete target[key];
      }
      await page.evaluate(({ modules, entry, data }) => {
        window.fetch = async () => ({ json: async () => data });
        URL.createObjectURL = blob => {
          window.reportCsv = blob.text();
          return '#test-export';
        };
        HTMLAnchorElement.prototype.click = () => {};
        const stub = {
          __esModule: true,
          default: () => null,
          BalanceCell: () => null,
          hubFetch: async () => ({ ok: false, json: async () => ({ ok: false, error: 'Fixture only' }) }),
          supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } },
        };
        const cache = {};
        function load(id) {
          if (id === 'react') return React;
          if (id === 'react-dom') return ReactDOM;
          if (id === 'stub') return stub;
          if (cache[id]) return cache[id].exports;
          if (!modules[id]) throw new Error('Unexpected dependency ' + id);
          const mod = { exports: {} }; cache[id] = mod;
          new Function('require', 'module', 'exports', modules[id])(load, mod, mod.exports);
          return mod.exports;
        }
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(load(entry).default, { userProfile: { id: 'fixture' } }));
      }, { modules, entry, data });
      await page.getByText('Regression fixture', { exact: false }).first().waitFor({ timeout: 10000 });
      assert.deepEqual(errors, []);
      const text = await page.locator('body').innerText();
      assert.ok(text.includes('$12.00'), 'visible goods costs render');
      assert.equal(text.includes('$1,234.56'), canSeeRevenue, 'revenue redaction preserved');
      assert.equal(text.includes('$1,269.06'), canSeeMargin, 'profit amount matches permission');
      const profitHeaders = page.getByRole('columnheader', { name: /\b(profit|margin)\b|final p&l/i });
      for (const view of ['By product', 'By invoice', 'By customer']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        assert.equal(await profitHeaders.count(), canSeeMargin ? 3 : 0, view);
        const table = page.getByRole('table').first();
        const headerCount = await table.locator('thead th').count();
        assert.equal(await table.locator('tbody > tr').first().locator('td').count(), headerCount, view + ' cells align with headers');
        await table.getByText('Regression fixture', { exact: false }).click();
        assert.equal(await profitHeaders.count(), canSeeMargin ? 6 : 0, view + ' drill-down');
        assert.equal(await table.locator('tbody > tr').nth(1).locator(':scope > td').getAttribute('colspan'), String(headerCount));
      }
      await page.getByRole('button', { name: /P&L by period/ }).click();
      assert.equal(await profitHeaders.count() > 0, canSeeMargin, 'period columns');
      await page.getByRole('row').filter({ hasText: 'Nov 2026' }).first().click();
      assert.equal(await profitHeaders.count() > 0, canSeeMargin, 'period drill-down columns');
      await page.getByRole('button', { name: /CSV/ }).click();
      const csv = await page.evaluate(() => window.reportCsv);
      assert.ok(csv.startsWith('Period,Lines,Pounds,'));
      assert.equal(/\b(profit|margin)\b|final p&l/i.test(csv.split('\n')[0]), canSeeMargin, 'restricted headers omitted from export');
      assert.deepEqual(errors, []);
      if (process.env.TEST_SCREENSHOT && canSeeMargin) await page.screenshot({ path: process.env.TEST_SCREENSHOT, fullPage: true });
      console.log('PASS real screen: ' + permissions + ', including detail tables and CSV');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
