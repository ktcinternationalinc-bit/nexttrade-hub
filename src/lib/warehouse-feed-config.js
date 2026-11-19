// v55.83-UU (Codex QA 19 Nov 05:56, P2) — WHICH warehouse address the Hub may send its feed token to, and which copy it is.
// Server-only helper (no 'use client'), shared by the Orders report and the shipping-cost sync. SWC-safe: var + concatenation.
//  • https only, no other port;
//  • staging = nextrade-staging.com or one of its sub-sites (dot boundary: "evilnextrade-staging.com" is NOT staging);
//  • live = exactly nextradeindustries.com or www.nextradeindustries.com, and only with NEXTRADE_FEED_ALLOW_LIVE=yes (Max);
//  • any other address is refused BEFORE the token is sent;
//  • the feed's answer must say which copy it is, and it must be that copy (missing = refused).
// exact names only (Codex 06:13): compared as strings, never looked up on an object (so "constructor" / "__proto__" are not hosts)
var LIVE_HOSTS = ['nextradeindustries.com', 'www.nextradeindustries.com'];

export function warehouseFeedConfig(env) {
  var e = env || {};
  var url = String(e.NEXTRADE_FEED_URL || '').trim(); var token = String(e.NEXTRADE_FEED_TOKEN || '').trim();
  if (!url || !token) { return { error: 'The warehouse feed is not set up (NEXTRADE_FEED_URL / NEXTRADE_FEED_TOKEN in Vercel).' }; }
  var u = null; try { u = new URL(url); } catch (eU) { return { error: 'NEXTRADE_FEED_URL is not a web address.' }; }
  if (u.protocol !== 'https:') { return { error: 'NEXTRADE_FEED_URL must start with https:// — the token is never sent over plain http.' }; }
  if (u.port) { return { error: 'NEXTRADE_FEED_URL must not name a port.' }; }
  var host = String(u.hostname || '').toLowerCase();
  var source = null;
  if (/(^|\.)nextrade-staging\.com$/.test(host)) { source = 'nextrade-staging'; }
  else if (LIVE_HOSTS.indexOf(host) >= 0) { source = 'nextrade-live'; }
  if (!source) { return { error: 'NEXTRADE_FEED_URL points at ' + host + ', which is not an approved warehouse address (nextrade-staging.com or nextradeindustries.com) — nothing was sent.' }; }
  if (source === 'nextrade-live' && String(e.NEXTRADE_FEED_ALLOW_LIVE || '') !== 'yes') { return { error: 'The feed points at the LIVE warehouse; that needs Max’s go-ahead (NEXTRADE_FEED_ALLOW_LIVE=yes).' }; }
  return { url: url, token: token, host: host, source: source };
}

// null when the feed is the expected copy; otherwise the reason it is refused
export function feedIdentityProblem(feed, cfg) {
  var s = feed && typeof feed.source === 'string' ? feed.source.trim() : '';
  if (!s) { return 'The warehouse feed did not say which copy it is — refused.'; }
  if (!cfg || s !== cfg.source) { return 'The feed says it is ' + s + ', the Hub expected ' + ((cfg && cfg.source) || 'unknown') + ' — refused.'; }
  return null;
}
