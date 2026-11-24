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
const row = { key: 'fixture', label: 'Regression fixture', pounds: 100, goods_revenue: 1234.56, transport_revenue: 200, base_cost: 12, commission: 1.5, inbound_allowance: 2, outbound_cost: 150, bonded: 0, total_cost: 165.5, profit: 1269.06, transport_profit: 50, complete: true, invoice_ids: ['fixture'] };
const fixture = { ok: true, totals: row, counts: { invoices_in_period: 1 }, reconciled: { product: true, customer: true, invoice: true }, by_product: [row], by_customer: [row], by_invoice: [row], cells: [], flags: [], can_see_margin: true };
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const hidden of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.route('**/*', route => route.abort());
      const errors = [];
      page.on('pageerror', err => { errors.push(err.message); console.error(err.message); });
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ path: path.join(deps, 'react/umd/react.development.js') });
      await page.addScriptTag({ path: path.join(deps, 'react-dom/umd/react-dom.development.js') });
      const data = JSON.parse(JSON.stringify(fixture));
      if (hidden) {
        data.revenue_hidden = true; data.can_see_margin = false;
        for (const target of [data.totals, ...data.by_product, ...data.by_customer, ...data.by_invoice]) {
          for (const key of ['goods_revenue', 'transport_revenue', 'profit', 'transport_profit']) delete target[key];
        }
      }
      await page.evaluate(({ modules, entry, data }) => {
        window.fetch = async () => ({ json: async () => data });
        const stub = { __esModule: true, default: () => null, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } } };
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
      assert.equal(text.includes('$1,234.56'), !hidden, 'revenue redaction preserved');
      if (hidden) assert.ok(text.includes('\uD83D\uDD12'));
      await page.getByRole('button', { name: 'By invoice', exact: true }).click();
      await page.getByRole('button', { name: 'By product', exact: true }).click();
      assert.deepEqual(errors, []);
      if (process.env.TEST_SCREENSHOT && !hidden) await page.screenshot({ path: process.env.TEST_SCREENSHOT, fullPage: true });
      console.log('PASS real screen: ' + (hidden ? 'revenue hidden, costs visible' : 'amounts visible') + ', report loaded and tabs switched');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
