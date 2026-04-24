-- Bank Connections (Plaid)
CREATE TABLE IF NOT EXISTS bank_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plaid_item_id TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT DEFAULT 'Unknown Bank',
  status TEXT DEFAULT 'active',
  last_synced TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bank Transactions
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID REFERENCES bank_connections(id) ON DELETE CASCADE,
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  name TEXT,
  merchant_name TEXT,
  category TEXT,
  pending BOOLEAN DEFAULT false,
  account_id TEXT,
  matched_invoice_id UUID,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txn_matched ON bank_transactions(matched_invoice_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_connection ON bank_transactions(connection_id);

-- RLS
ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON bank_connections FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON bank_transactions FOR ALL USING (true);
