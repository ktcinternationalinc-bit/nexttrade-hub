// Actual React component in Chromium; warehouse contents are an isolated fixture.
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const os = require('os');
const root = path.join(__dirname, '..');
const { transform } = require(process.env.SUCRASE_PATH || 'sucrase');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const source = fs.readFileSync(path.join(root, 'src/components/NTWarehousePanel.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/NTWarehousePanel.module.css'), 'utf8');
const globals = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'src/app/page.jsx'), 'utf8');
const classes = Object.fromEntries([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map(m => [m[1], m[1]]));
const compiled = transform(source, { transforms: ['jsx', 'imports'], production: true }).code;
const libs = {
  '/react.js': path.join(root, 'node_modules/react/umd/react.development.js'),
  '/dom.js': path.join(root, 'node_modules/react-dom/umd/react-dom.development.js'),
  '/icons.js': path.join(root, 'node_modules/lucide-react/dist/umd/lucide-react.js'),
};

(async () => {
  assert(pageSource.includes("? 'flex-1 p-2 w-full max-w-none' : 'flex-1 p-4 max-w-7xl mx-auto lg:ml-0'"));
  assert(pageSource.includes('<NTWarehousePanel />') && pageSource.includes('<NTWarehousePanel staging />'));
  const utilities = (await postcss([tailwind({ content: [{ raw: pageSource, extension: 'jsx' }] })])
    .process('@tailwind base;@tailwind utilities;', { from: undefined })).css;
  const html = staging => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${utilities}\n${globals}\n${css}
    body{margin:0;background:#090b0c}header{height:56px;color:white}aside{width:224px;flex-shrink:0;color:white}@media(max-width:1023px){aside{display:none}}
    </style></head><body><header>KTC HUB</header><div style="display:flex"><aside>Hub navigation</aside><main class="flex-1 p-2 w-full max-w-none" style="min-width:0"><div id="root"></div></main></div>
    <script src="/react.js"></script><script>window.react=window.React</script><script src="/dom.js"></script><script src="/icons.js"></script>
    <script>const module={exports:{}},exports=module.exports;function require(n){if(n==='react')return React;if(n==='lucide-react')return LucideReact;if(n.endsWith('.css'))return ${JSON.stringify(classes)};throw Error(n)};${compiled}
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(module.exports.default,{staging:${staging}}));</script></body></html>`;
  const server = http.createServer((req, res) => {
    if (libs[req.url]) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(libs[req.url])); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(html(req.url === '/staging')); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let frameLoads = 0;
    await page.route('https://**/*', route => {
      assert(/^https:\/\/(fix\.nextrade-staging\.com|nextradeindustries\.com)\/admin$/.test(route.request().url()));
      frameLoads++;
      return route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;background:#eff5f2"><h1>Warehouse QA fixture</h1><div style="width:1440px;height:1600px;background:repeating-linear-gradient(90deg,#fff 0 119px,#b7c8c1 120px)">Release / Customer / Inventory / Weight / Shipping</div></body></html>' });
    });
    for (const staging of [false, true]) {
      for (const width of [1920, 1440, 1280, 390]) {
        const height = width === 390 ? 844 : 900;
        await page.setViewportSize({ width, height });
        await page.goto(`http://127.0.0.1:${server.address().port}/${staging ? 'staging' : ''}`);
        const title = staging ? 'NT Warehouse Staging' : 'NT Warehouse';
        await page.frameLocator(`iframe[title="${title}"]`).getByRole('heading').waitFor();
        const bottom = page.getByRole('region', { name: 'Warehouse horizontal scroll, bottom' });
        const top = page.getByRole('region', { name: 'Warehouse horizontal scroll, top' });
        const measures = await bottom.evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth + 1, bottom: el.getBoundingClientRect().bottom, thumb: getComputedStyle(el, '::-webkit-scrollbar').height }));
        assert(measures.bottom <= height, 'bottom scrollbar must fit on screen');
        assert.equal(measures.thumb, '14px');
        if (measures.overflow) {
          await top.waitFor({ state: 'visible' });
          await top.evaluate(el => { el.scrollLeft = 110; });
          await page.waitForFunction(() => document.querySelector('.viewport').scrollLeft === 110);
          await bottom.evaluate(el => { el.scrollLeft = 55; });
          await page.waitForFunction(() => document.querySelector('.topScroll').scrollLeft === 55);
          await top.focus();
          await page.keyboard.press('ArrowRight');
          await page.waitForFunction(() => document.querySelector('.viewport').scrollLeft > 55);
        } else { assert.equal(await top.count(), 0, 'unneeded top scrollbar is hidden'); }
        const before = frameLoads;
        await page.getByRole('button', { name: 'Expand warehouse view' }).click();
        assert.equal(await page.locator('section').evaluate(el => Math.round(el.getBoundingClientRect().width)), width);
        await page.getByRole('button', { name: 'Restore warehouse view' }).click();
        assert.equal(frameLoads, before, 'expand/restore must not reload the warehouse');
        await page.getByRole('button', { name: 'Expand warehouse view' }).click();
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: 'Expand warehouse view' }).getAttribute('aria-pressed'), 'false');
        assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        assert(await page.getByText(staging ? 'STAGING / TEST' : 'LIVE', { exact: true }).isVisible());
        assert.equal(await page.getByRole('link', { name: 'Open warehouse in its own window' }).getAttribute('href'), staging ? 'https://fix.nextrade-staging.com/admin' : 'https://nextradeindustries.com/admin');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must not overflow');
        if (width === 1440 || width === 390) await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS || os.tmpdir(), `yi-warehouse-${staging ? 'staging' : 'live'}-${width}.png`), fullPage: true });
        console.log(`PASS ${title} ${width}px: scrolling, viewport fit, expand/restore, no reload, source identity`);
      }
    }
    assert.deepEqual(errors, []);
    console.log('YI browser checks passed: 8 desktop/mobile live/staging scenarios, no page errors.');
  } finally { if (browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
