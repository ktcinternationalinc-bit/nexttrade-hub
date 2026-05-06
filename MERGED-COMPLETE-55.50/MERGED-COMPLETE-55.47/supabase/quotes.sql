-- Quote Companies (your company profiles)
CREATE TABLE IF NOT EXISTS quote_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_url TEXT,
  tax_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Customer Quotes
CREATE TABLE IF NOT EXISTS customer_quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_number TEXT,
  company_id UUID REFERENCES quote_companies(id),
  client_name TEXT,
  client_email TEXT,
  date DATE,
  validity_days INTEGER DEFAULT 30,
  currency TEXT DEFAULT 'USD',
  include_vat BOOLEAN DEFAULT false,
  vat_rate NUMERIC(5,2) DEFAULT 14,
  line_items JSONB DEFAULT '[]',
  notes TEXT,
  internal_notes TEXT,
  status TEXT DEFAULT 'draft',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE quote_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON quote_companies FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON customer_quotes FOR ALL USING (true);
