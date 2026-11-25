// v55.83-YW (Max 25 Nov: "even change history shows 0") — the Supabase client for every /api/releases route.
// Next.js 14 keeps the answers of GET database reads made inside a GET-only route in its Data Cache with NO expiry, even with
// `dynamic = 'force-dynamic'` (the cache also survives new deployments). Change Schedule therefore kept showing the worker
// status and history of ~24 Nov 12:08 UTC. Every read here is sent with cache: 'no-store', and each release route also exports
// `revalidate = 0` + `fetchCache = 'force-no-store'` (either alone is enough; both are kept on purpose).
// Server only. SWC-safe (var + concatenation).
import { createClient } from '@supabase/supabase-js';

export function noStoreFetch(input, init) {
  return fetch(input, Object.assign({}, init || {}, { cache: 'no-store' }));
}

export function releaseDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
}
