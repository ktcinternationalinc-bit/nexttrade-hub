import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// POST: match a transaction to an invoice
export async function POST(req) {
  try {
    const { transaction_id, invoice_id } = await req.json();
    const { error } = await supabase
      .from('bank_transactions')
      .update({ matched_invoice_id: invoice_id, matched_at: new Date().toISOString() })
      .eq('id', transaction_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE: unmatch a transaction
export async function DELETE(req) {
  try {
    const { transaction_id } = await req.json();
    const { error } = await supabase
      .from('bank_transactions')
      .update({ matched_invoice_id: null, matched_at: null })
      .eq('id', transaction_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
