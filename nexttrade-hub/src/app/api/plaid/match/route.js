import { NextResponse } from 'next/server';

// v55.83-GV — LEGACY ROUTE DISABLED (410 Gone).
//
// This route used to stamp bank_transactions.matched_invoice_id (POST) and
// clear it (DELETE). That was accounting-unsafe: it never created or voided
// accounting_invoice_payments / payment_matches, never recomputed invoice
// balances, never wrote an audit row, and never queued a Wave payment. A
// transaction looked matched/unmatched in the Bank tab while the books posted
// nothing — silent corruption.
//
// Matching + unmatching now live ONLY in Accounting -> Bank Review & Matching,
// which runs the accounting-safe engine (payment_matches +
// accounting_invoice_payments + balance recompute + audit + Wave sync queue +
// silo selection). This route is hard-blocked so nothing — UI, scripts, or
// stale clients — can mutate bank_transactions through it again.

var GONE_MSG = 'Legacy Plaid match route disabled. Use accounting-safe Bank Review & Matching (Accounting -> Bank Review) for matching and unmatching.';

function gone() {
  return NextResponse.json({ error: GONE_MSG, disabled: true }, { status: 410 });
}

export async function POST() {
  return gone();
}

export async function DELETE() {
  return gone();
}

export async function GET() {
  return gone();
}

export async function PUT() {
  return gone();
}
