import { vendorKeyOf } from './bill-payments-report';
import { isPartnerFeeCategory } from './partner-fee';

export const NEXPAC_FEE_CENTS = 4525000;
const firstMonth = '2026-06';
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const feeLabel = /\b(?:operational|partner(?:ship)?)\s+fee\b/i;

function monthEnd(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

export function identifyNexPacFeeLines(bills, lines) {
  const byBill = new Map();
  for (const line of lines) {
    const bill = bills[line.bill_id];
    if (!bill || bill.record_status !== 'active' || (bill.currency || 'USD') !== 'USD' || vendorKeyOf(bill.vendor_name) !== 'nexpac corporation') continue;
    const description = String(line.description || '').trim();
    if (Math.round(Number(line.amount) * 100) !== NEXPAC_FEE_CENTS || !feeLabel.test(description)) continue;
    const named = description.toLowerCase().match(new RegExp('\\b(' + months.join('|') + ')\\s+(20\\d{2})\\b'));
    const month = named ? named[2] + '-' + String(months.indexOf(named[1]) + 1).padStart(2, '0') : String(bill.bill_date || '').slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < firstMonth) continue;
    const charge = { id: line.id, bill_id: bill.id, bill_number: bill.bill_number || '', month, date: monthEnd(month), description, cents: NEXPAC_FEE_CENTS };
    if (!byBill.has(bill.id)) byBill.set(bill.id, []);
    const fees = byBill.get(bill.id);
    if (!fees.some(fee => fee.month === month)) fees.push(charge);
  }
  for (const bill of Object.values(bills)) {
    if (byBill.has(bill.id) || bill.record_status !== 'active' || (bill.currency || 'USD') !== 'USD' || vendorKeyOf(bill.vendor_name) !== 'nexpac corporation') continue;
    if (!isPartnerFeeCategory(bill.category) || Math.round(Number(bill.total_amount) * 100) !== NEXPAC_FEE_CENTS) continue;
    const month = String(bill.bill_date || '').slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < firstMonth) continue;
    byBill.set(bill.id, [{ id: bill.id, bill_id: bill.id, bill_number: bill.bill_number || '', month, date: monthEnd(month), description: 'Partner fee on bill', cents: NEXPAC_FEE_CENTS }]);
  }
  return byBill;
}

export function nexPacFeeSchedule(feesByBill, from, to) {
  const byMonth = new Map();
  for (const fees of feesByBill.values()) {
    for (const fee of fees) {
      if (!byMonth.has(fee.month)) byMonth.set(fee.month, new Map());
      const sources = byMonth.get(fee.month);
      const key = fee.bill_number.trim().toLowerCase() || fee.bill_id;
      if (!sources.has(key)) sources.set(key, fee);
    }
  }
  const result = [];
  const cursor = new Date((from.slice(0, 7) < firstMonth ? firstMonth : from.slice(0, 7)) + '-01T00:00:00Z');
  while (cursor.toISOString().slice(0, 10) <= to) {
    const month = cursor.toISOString().slice(0, 7);
    const date = monthEnd(month);
    if (date >= from && date <= to) {
      const sources = Array.from(byMonth.get(month)?.values() || []);
      result.push({ id: 'nexpac-' + month, month, date, cents: NEXPAC_FEE_CENTS, sources });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}
