/**
 * NextTrade Hub - Data Seed Script
 * 
 * Run: SUPABASE_URL=xxx SUPABASE_KEY=xxx node scripts/seed.js
 * 
 * This imports the existing Excel data into Supabase.
 * You only need to run this ONCE after setting up the database.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log('🌱 Starting data seed...\n');

  // Load JSON data files
  const dataDir = path.join(__dirname, '..', 'data');

  // 1. INVOICES
  console.log('📋 Importing invoices...');
  const sales = JSON.parse(fs.readFileSync(path.join(dataDir, 'sales.json'), 'utf8'));
  const invoiceBatch = sales.map(s => ({
    order_number: s.o,
    customer_name: s.c,
    invoice_date: s.d || '2024-01-01',
    total_amount: s.a || 0,
    total_collected: s.p || 0,
    outstanding: Math.max(0, (s.a || 0) - (s.p || 0)),
    source: 'import',
  }));

  // Insert in batches of 100
  for (let i = 0; i < invoiceBatch.length; i += 100) {
    const batch = invoiceBatch.slice(i, i + 100);
    const { error } = await supabase.from('invoices').upsert(batch, { onConflict: 'order_number' });
    if (error) console.error('  Invoice error:', error.message);
    else console.log(`  Batch ${i / 100 + 1}: ${batch.length} invoices`);
  }
  console.log(`  ✅ ${invoiceBatch.length} invoices imported\n`);

  // 2. TREASURY
  console.log('🏦 Importing treasury...');
  const treasury = JSON.parse(fs.readFileSync(path.join(dataDir, 'treasury.json'), 'utf8'));
  const treasuryBatch = treasury.map(t => ({
    transaction_date: t.d,
    order_number: t.o || '',
    description: t.n || '',
    cash_in: t.i || 0,
    cash_out: t.e || 0,
    source: 'main',
  }));

  for (let i = 0; i < treasuryBatch.length; i += 100) {
    const batch = treasuryBatch.slice(i, i + 100);
    const { error } = await supabase.from('treasury').insert(batch);
    if (error) console.error('  Treasury error:', error.message);
    else console.log(`  Batch ${i / 100 + 1}: ${batch.length} transactions`);
  }
  console.log(`  ✅ ${treasuryBatch.length} treasury transactions imported\n`);

  // 3. CHECKS
  console.log('📝 Importing checks...');
  const checks = JSON.parse(fs.readFileSync(path.join(dataDir, 'checks.json'), 'utf8'));
  const checkBatch = checks.map(c => ({
    customer_name: c.c,
    order_number: c.o || '',
    amount: c.a || 0,
    check_date: c.ck || '',
    collection_date: c.cd || null,
    status: c.cd ? 'collected' : 'pending',
  }));

  const { error: checkErr } = await supabase.from('checks').insert(checkBatch);
  if (checkErr) console.error('  Check error:', checkErr.message);
  else console.log(`  ✅ ${checkBatch.length} checks imported\n`);

  // 4. DEBTS
  console.log('⚠️ Importing debts...');
  const debts = JSON.parse(fs.readFileSync(path.join(dataDir, 'debts.json'), 'utf8'));
  const debtBatch = debts.filter(d => d.c !== 'الاجمالى').map(d => ({
    customer_name: d.c,
    total_debt: d.t || 0,
  }));

  const { error: debtErr } = await supabase.from('debts').insert(debtBatch);
  if (debtErr) console.error('  Debt error:', debtErr.message);
  else console.log(`  ✅ ${debtBatch.length} debts imported\n`);

  // 5. WAREHOUSE EXPENSES
  console.log('🏭 Importing warehouse expenses...');
  if (fs.existsSync(path.join(dataDir, 'warehouse.json'))) {
    const warehouse = JSON.parse(fs.readFileSync(path.join(dataDir, 'warehouse.json'), 'utf8'));
    for (let i = 0; i < warehouse.length; i += 100) {
      const batch = warehouse.slice(i, i + 100).map(w => ({
        expense_date: w.d,
        description: w.n || '',
        amount: w.a || 0,
        category: w.cat || '',
      }));
      const { error } = await supabase.from('warehouse_expenses').insert(batch);
      if (error) console.error('  Warehouse error:', error.message);
      else console.log(`  Batch ${i / 100 + 1}: ${batch.length} expenses`);
    }
    console.log(`  ✅ ${warehouse.length} warehouse expenses imported\n`);
  }

  // 6. EXPENSE RULES
  console.log('📁 Creating expense rules...');
  const rules = [
    { description_match: 'عهدة المخزن', category: 'Warehouse' },
    { description_match: 'مرتبات', category: 'Salaries' },
    { description_match: 'مواصلات', category: 'Transport' },
    { description_match: 'ايجار', category: 'Rent' },
    { description_match: 'عمالة', category: 'Labor' },
    { description_match: 'اكراميات', category: 'Labor' },
    { description_match: 'سحب المالك', category: 'Owner Draws' },
    { description_match: 'تحويلات بنكية', category: 'Banking' },
    { description_match: 'تحويل بنكى', category: 'Banking' },
    { description_match: 'زكاة', category: 'Charity' },
    { description_match: 'صدقات', category: 'Charity' },
    { description_match: 'شحن', category: 'Shipping' },
    { description_match: 'جمارك', category: 'Shipping' },
    { description_match: 'عينات', category: 'Samples' },
    { description_match: 'ضرائب', category: 'Taxes' },
  ];

  const { error: ruleErr } = await supabase.from('expense_rules').insert(rules);
  if (ruleErr) console.error('  Rule error:', ruleErr.message);
  else console.log(`  ✅ ${rules.length} expense rules created\n`);

  console.log('🎉 Seed complete!');
}

seed().catch(console.error);
