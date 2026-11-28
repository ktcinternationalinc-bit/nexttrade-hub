export const KTC_EXPENSES_CHANGED = 'nt-ktc-expenses-changed';

export function notifyKtcExpensesChanged(date) {
  window.dispatchEvent(new CustomEvent(KTC_EXPENSES_CHANGED, { detail: { date } }));
}
