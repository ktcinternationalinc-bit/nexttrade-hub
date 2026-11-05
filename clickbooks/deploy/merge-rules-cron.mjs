// Opt-in LOCAL config edit only. Never changes remote scheduling by itself.
// Usage: node clickbooks/deploy/merge-rules-cron.mjs --enable-proposals-only
import {readFile,writeFile} from 'node:fs/promises';
if(process.argv[2]!=='--enable-proposals-only')throw new Error('Explicit --enable-proposals-only required. Verify hosting limits first.');
const path='vercel.json',raw=await readFile(path,'utf8'),config=JSON.parse(raw);
if(config.crons!==undefined&&!Array.isArray(config.crons))throw new Error('Unexpected crons config');
const route='/api/accounting/clickbooks-us/rules-job';
if((config.crons||[]).some(x=>x.path===route))throw new Error('Route already scheduled; review the existing schedule instead of duplicating it.');
config.crons=[...(config.crons||[]),{path:route,schedule:'*/15 * * * *'}];
await writeFile('clickbooks/deploy/vercel-before-rules.json',raw,{flag:'wx'});
await writeFile(path,JSON.stringify(config,null,2)+'\n');
console.log('Added local proposal-only cron entry; preserved other jobs. Review diff, test route and deploy explicitly. No remote schedule has changed.');
