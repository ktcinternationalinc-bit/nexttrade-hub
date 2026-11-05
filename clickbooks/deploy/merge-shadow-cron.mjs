// Opt-in LOCAL config edit only. No remote deployment occurs here.
// Usage: node clickbooks/deploy/merge-shadow-cron.mjs --enable-shadow-only
import {readFile,writeFile} from 'node:fs/promises';
if(process.argv[2]!=='--enable-shadow-only')throw new Error('Explicit --enable-shadow-only required. Verify ClickBooks history, mappings, route auth and hosting schedule limits first.');
const path='vercel.json',raw=await readFile(path,'utf8'),config=JSON.parse(raw);if(config.crons!==undefined&&!Array.isArray(config.crons))throw new Error('Unexpected crons config');
const route='/api/accounting/clickbooks-us/shadow-job';if((config.crons||[]).some(x=>x.path===route))throw new Error('Shadow route already scheduled; review the existing schedule instead of duplicating it.');
config.crons=[...(config.crons||[]),{path:route,schedule:'*/15 * * * *'}];
await writeFile('clickbooks/deploy/vercel-before-shadow.json',raw,{flag:'wx'});await writeFile(path,JSON.stringify(config,null,2)+'\n');
console.log('Added local ClickBooks shadow cron every 15 minutes; preserved all existing jobs. Review diff and deploy explicitly. No remote schedule has changed.');
