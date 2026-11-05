'use client';

import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { createBankVisibilityStore, EMPTY_BANK_VISIBILITY } from './bank-visibility-client';

var store = null;
function subscribe(listener) {
  if (!store) store = createBankVisibilityStore({ client: supabase, fetch: window.fetch.bind(window), window: window, document: document });
  return store.subscribe(listener);
}
function snapshot() { return store ? store.getSnapshot() : EMPTY_BANK_VISIBILITY; }
function serverSnapshot() { return EMPTY_BANK_VISIBILITY; }

export function useBankVisibility() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function refreshBankVisibility() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('bank-visibility-changed'));
}
