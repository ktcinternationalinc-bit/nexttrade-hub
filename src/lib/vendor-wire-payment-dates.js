export function applyVendorWirePaymentDates(payments, proofLines) {
  const byPayment = new Map();
  for (const line of proofLines) {
    if (!line.payment_id || line.is_open || !line.rtm_file_id || !line.rtm_confirmed_at || !line.rtm_paid_date) continue;
    const previous = byPayment.get(line.payment_id);
    if (!previous || previous.rtm_confirmed_at < line.rtm_confirmed_at) byPayment.set(line.payment_id, line);
  }
  return payments.map(payment => {
    if (payment.voided || payment.method !== 'rtm') return payment;
    const proof = byPayment.get(payment.id);
    if (!proof || proof.bill_id !== payment.bill_id) return payment;
    return { ...payment, paid_date: proof.rtm_paid_date, vendor_payment_proof: true };
  });
}
