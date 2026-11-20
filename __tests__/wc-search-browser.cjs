// Actual AllTransactionsTab, synthetic bank rows, no external requests or credentials.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { transform } = require('sucrase');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'wc-browser');
fs.mkdirSync(output, { recursive: true });
const modules = {};
for (const name of ['src/components/AllTransactionsTab.jsx', 'src/lib/transaction-search.js']) {
  modules[name] = transform(fs.readFileSync(path.join(root, name), 'utf8'), { transforms: ['jsx', 'imports'] }).code;
}
const fixtures = [
  { id: 'transfer', date: '2026-11-17', account: 'Checking 6338', who: 'Online Transfer to CHK 0225', amount: 20000, direction: 'out', pending: false },
  { id: 'fee', date: '2026-11-17', account: 'Checking 6338', who: 'NSF fee', amount: 35, direction: 'out', pending: false },
  { id: 'hidden', date: '2026-11-17', account: 'Checking 6338', who: 'Bank charge', who_full: 'Bank charge - NSF returned item', amount: 25, direction: 'out', pending: false },
  { id: 'other', date: '2026-11-19', account: 'Card 3774', who: 'Progressive Insurance', amount: 1253.03, direction: 'out', pending: true }
];
const react = fs.readFileSync(require.resolve('react/umd/react.development.js'.replace('/umd/react.development.js', '/package.json')).replace('package.json', 'umd/react.development.js'), 'utf8');
const reactDOM = fs.readFileSync(require.resolve('react-dom/package.json').replace('package.json', 'umd/react-dom.development.js'), 'utf8');
// Test harness only: styling is supplied by the app's built CSS when available.
const cssDir = path.join(root, '.next', 'static', 'css');
const css = fs.existsSync(cssDir) ? fs.readdirSync(cssDir).filter(x => x.endsWith('.css')).map(x => fs.readFileSync(path.join(cssDir, x), 'utf8')).join('\n') : '';
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '\nbody{font-family:Arial,sans-serif;margin:16px;background:#f1f5f9}table{width:100%;border-collapse:collapse}td,th{padding:10px;text-align:left}button,input,select{font:inherit}#notice{padding:12px;background:#fef3c7;color:#713f12;margin-bottom:12px}</style></head><body><div id="notice">WC LOCAL TRIAL - synthetic test transactions only. No bank connection.</div><div id="root"></div><script>' + react + '</script><script>' + reactDOM + '</script><script>\n' +
  'const modules=' + JSON.stringify(modules) + ';const fixtures=' + JSON.stringify(fixtures) + ';\n' +
  `window.fetch=async function(url,options){ const b=JSON.parse(options.body); if(b.action!=='all_transactions'&&b.action!=='list') throw new Error('Preview is read-only'); return {json:async()=>b.action==='list'?{ok:true,categories:[]}:{ok:true,transactions:fixtures,bank_sync_warning:'Bank sync needs attention for an account in this list. Check Bank sync details; some transactions may not be up to date.'}}; };
  const cache={};function load(name){if(cache[name])return cache[name].exports;const m={exports:{}};cache[name]=m;const req=(id)=>{if(id==='react')return React;if(id==='../lib/transaction-search')return load('src/lib/transaction-search.js');if(id.includes('supabase'))return {supabase:{}};if(id.includes('hub-fetch'))return {hubFetch:window.fetch};if(id.includes('bank-visibility-client'))return {bankSessionHeaders:async()=>({})};return {__esModule:true,default:()=>null};};new Function('require','module','exports',modules[name])(req,m,m.exports);return m.exports;}
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(load('src/components/AllTransactionsTab.jsx').default,{isSuperAdmin:true,userProfile:{id:'fixture'}}));` + '</script></body></html>';
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.goto(url);
    await page.getByText('4 of 4 shown', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Search transactions' }).fill('nsf');
    await page.getByText('3 of 4 shown', { exact: true }).waitFor();
    if (await page.locator('mark').count() !== 3) throw new Error('Partial matches not highlighted');
    await page.getByRole('checkbox', { name: 'Whole words' }).check();
    await page.getByText('2 of 4 shown', { exact: true }).waitFor();
    if (await page.getByText('Online Transfer to CHK 0225', { exact: true }).count()) throw new Error('Transfer leaked into whole-word NSF');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.getByRole('textbox', { name: 'Search transactions' }).fill('nonsense-no-match');
    await page.getByText('0 of 4 shown', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Search transactions' }).fill('');
    await page.getByText('4 of 4 shown', { exact: true }).waitFor();
    await page.getByRole('combobox').filter({ has: page.locator('option[value="Checking 6338"]') }).selectOption('Checking 6338');
    await page.getByText('3 of 4 shown', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Search transactions' }).fill('nsf');
    await page.getByText('2 of 4 shown', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('PASS actual-component browser: partial/whole-word, hidden description, highlights, clearing, no results, account filter, desktop/mobile. No external requests.');
  } finally { if (browser) await browser.close(); if (!process.argv.includes('--serve')) server.close(); }
  if (process.argv.includes('--serve')) console.log('READ-ONLY SYNTHETIC PREVIEW ' + url);
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
