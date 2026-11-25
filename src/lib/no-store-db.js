// v55.83-YY (follows YW) — a Supabase client whose every request is sent with cache: 'no-store'.
// Next.js 14 keeps the answers of GET fetches made inside a route that exports ONLY `GET` in its Data Cache with NO expiry
// (store.revalidate = userland.revalidate ?? false), even with `dynamic = 'force-dynamic'`, and the Vercel Data Cache survives
// new deployments. supabase-js select() reads and auth.getUser() are GET fetches, so such routes could answer from a copy of the
// database taken the first time they ran. Every GET-only API route also exports `revalidate = 0` + `fetchCache = 'force-no-store'`
// (any one of the three is enough; all three are kept on purpose).
// Same signature as createClient, so a route can import it as `createClient` and pass it on to helpers that take a factory.
// Server only. SWC-safe (var + concatenation).
import { createClient } from '@supabase/supabase-js';

export function noStoreFetch(input, init) {
  return fetch(input, Object.assign({}, init || {}, { cache: 'no-store' }));
}

export function createNoStoreClient(url, key, options) {
  var o = Object.assign({}, options || {});
  o.global = Object.assign({}, o.global || {}, { fetch: noStoreFetch });
  return createClient(url, key, o);
}
