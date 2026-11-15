// v55.83-A.6.27 (Max May 14 2026) — FX rate helpers
//
// Strategy per Max: default to API, allow manual override at finalize time.
// We cache rates in inv_fx_rates so the same date isn't fetched twice and
// so there's an audit trail of what rate was used when.
//
// API source: exchangerate.host (free, no key needed). If it fails, we fall
// back to fixer.io (needs key) or the user enters manually.
//
// SCHEMA NOTE: inv_fx_rates was created by the foundation schema with columns:
//   id, from_currency, to_currency, rate, rate_date, source, set_by, notes,
//   created_at, UNIQUE(from_currency, to_currency, rate_date)
// This file uses those exact column names. The UNIQUE constraint is on
// (from_currency, to_currency, rate_date) — NOT on source — so we must
// upsert with onConflict on those three columns (a manual override REPLACES
// the API rate for the same day, which is the desired behavior).
//
// IMPORTANT (Vercel SWC constraint per Max's permanent rules):
//   - var + string concatenation only, no template literals/backticks
//   - this file lives in lib/ but is consumed by both API routes and client
//     components, so the constraint applies throughout.

import { supabase } from './supabase';

var FX_API_BASE = 'https://api.exchangerate.host';

// In-memory cache for current session — avoids hitting DB every render.
var sessionCache = {};

// Look up rate from DB cache; null if not present.
async function getCachedRate(rateDate, base, quote) {
  var key = rateDate + ':' + base + ':' + quote;
  if (sessionCache[key]) return sessionCache[key];
  try {
    var r = await supabase.from('inv_fx_rates')
      .select('*')
      .eq('rate_date', rateDate)
      .eq('from_currency', base)
      .eq('to_currency', quote)
      .order('created_at', { ascending: false })
      .limit(1);
    if (r.error || !r.data || r.data.length === 0) return null;
    sessionCache[key] = r.data[0];
    return r.data[0];
  } catch (e) {
    return null;
  }
}

// Persist a rate to the DB cache.
// UNIQUE on (from_currency, to_currency, rate_date) — manual override
// will replace any earlier API row for that same day.
async function saveRate(rateDate, base, quote, rate, source) {
  try {
    var resp = await supabase.from('inv_fx_rates').upsert({
      rate_date: rateDate,
      from_currency: base,
      to_currency: quote,
      rate: rate,
      source: source,
    }, { onConflict: 'from_currency,to_currency,rate_date' }).select().single();
    if (resp.error) {
      console.warn('[fx] save failed:', resp.error.message);
      return null;
    }
    var key = rateDate + ':' + base + ':' + quote;
    sessionCache[key] = resp.data;
    return resp.data;
  } catch (e) {
    console.warn('[fx] save threw:', e && e.message);
    return null;
  }
}

// Fetch a single rate from the public API.
async function fetchFromApi(rateDate, base, quote) {
  try {
    var url = FX_API_BASE + '/' + rateDate + '?base=' + base + '&symbols=' + quote;
    var resp = await fetch(url);
    if (!resp.ok) return null;
    var data = await resp.json();
    if (!data || !data.rates || data.rates[quote] == null) return null;
    return {
      rate: Number(data.rates[quote]),
      source: 'api:exchangerate.host',
    };
  } catch (e) {
    console.warn('[fx] api failed:', e && e.message);
    return null;
  }
}

// Public: get a rate. Tries cache first, then API, then null.
// Caller may then prompt the user for manual entry.
//   rateDate: 'YYYY-MM-DD' string
//   base:    'USD'
//   quote:   'EGP'
// Returns: { rate, source, isFromCache, isFromApi } | null
export async function getFxRate(rateDate, base, quote) {
  if (base === quote) {
    return { rate: 1, source: 'identity', isFromCache: false, isFromApi: false };
  }
  // 1. Cache
  var cached = await getCachedRate(rateDate, base, quote);
  if (cached) {
    return {
      rate: Number(cached.rate),
      source: cached.source,
      isFromCache: true,
      isFromApi: cached.source && cached.source.indexOf('api:') === 0,
    };
  }
  // 2. API
  var apiResult = await fetchFromApi(rateDate, base, quote);
  if (apiResult) {
    await saveRate(rateDate, base, quote, apiResult.rate, apiResult.source);
    return {
      rate: apiResult.rate,
      source: apiResult.source,
      isFromCache: false,
      isFromApi: true,
    };
  }
  // 3. Try the seed/manual fallback by ignoring the date filter — use the
  // latest rate we have for this pair regardless of date. Foundation
  // seeded USD/EGP=50 etc, so this gives a sane fallback when offline.
  try {
    var latest = await supabase.from('inv_fx_rates')
      .select('*')
      .eq('from_currency', base)
      .eq('to_currency', quote)
      .order('rate_date', { ascending: false })
      .limit(1);
    if (latest.data && latest.data.length > 0) {
      var row = latest.data[0];
      return {
        rate: Number(row.rate),
        source: row.source + ' (fallback ' + row.rate_date + ')',
        isFromCache: true,
        isFromApi: false,
      };
    }
  } catch (e) {}
  // 4. Nothing — caller must prompt user
  return null;
}

// Public: explicitly save a manual override. Used when the user types a rate
// in the finalize dialog or wants to correct an API rate.
export async function saveManualRate(rateDate, base, quote, rate, userId) {
  var saved = await saveRate(rateDate, base, quote, Number(rate), 'manual');
  if (saved) {
    return {
      rate: Number(saved.rate),
      source: 'manual',
      isFromCache: false,
      isFromApi: false,
    };
  }
  return null;
}

// Public: convert an amount from one currency to another.
//   amount: Number
//   fromCcy: 'EUR', toCcy: 'USD'
//   rateDate: 'YYYY-MM-DD'
// Returns: { converted, rate, source } | null
export async function convert(amount, fromCcy, toCcy, rateDate) {
  if (!amount || isNaN(Number(amount))) return null;
  if (fromCcy === toCcy) {
    return { converted: Number(amount), rate: 1, source: 'identity' };
  }
  // Try direct rate first
  var direct = await getFxRate(rateDate, fromCcy, toCcy);
  if (direct) {
    return { converted: Number(amount) * direct.rate, rate: direct.rate, source: direct.source };
  }
  // Try inverse
  var inverse = await getFxRate(rateDate, toCcy, fromCcy);
  if (inverse && inverse.rate > 0) {
    return { converted: Number(amount) / inverse.rate, rate: 1 / inverse.rate, source: inverse.source + ' (inverse)' };
  }
  // Try USD bridging (most reliable third-party path)
  if (fromCcy !== 'USD' && toCcy !== 'USD') {
    var toUSD = await getFxRate(rateDate, fromCcy, 'USD');
    var fromUSD = await getFxRate(rateDate, 'USD', toCcy);
    if (toUSD && fromUSD) {
      var via = Number(amount) * toUSD.rate * fromUSD.rate;
      return { converted: via, rate: toUSD.rate * fromUSD.rate, source: 'bridged via USD' };
    }
  }
  return null;
}
