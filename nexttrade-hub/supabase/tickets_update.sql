-- Add updated_by to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_number TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_name TEXT;
