# NextTrade Hub — KTC Complete Business Platform

## Quick Deploy (15 minutes)

### Step 1: Create Supabase Database
1. Go to [supabase.com](https://supabase.com) → Sign up with GitHub
2. Click "New Project" → Name: `nexttrade` → Pick a password → Region: US East
3. Wait 2 minutes
4. Go to **SQL Editor** → Click "New query"
5. Copy ALL content from `supabase/schema.sql` → Paste → Click **Run**

### Step 2: Get Your API Keys
1. Supabase → **Settings** → **API**
2. Copy **Project URL** (`https://xxxxx.supabase.co`)
3. Copy **anon public** key (`eyJ...`)

### Step 3: Create Your First User
1. Supabase → **Authentication** → **Users** → **Add User**
2. Enter email + password → Create

### Step 4: Deploy to Vercel
1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. Upload this folder to GitHub as a new repository
3. Vercel → **Add New Project** → Select the repo
4. Add Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
5. Click **Deploy** → Wait 60 seconds → You're live!

### Step 5: Import Your Data
```bash
npm install
SUPABASE_URL=xxx SUPABASE_KEY=xxx node scripts/seed.js
```

## What's Included

### Financial System
- ✅ Dashboard with clickable drill-downs
- ✅ Sales/Invoices (588 orders, 2014-2026) with reconciliation (2% tolerance)
- ✅ Treasury (6,010 transactions) with monthly → transaction drill-down
- ✅ Treasury editing with audit trail
- ✅ Manual invoice & transaction creation with sales rep field
- ✅ Customers with order history
- ✅ Checks (Pending/Collected)
- ✅ Debts with drill-down
- ✅ Warehouse expenses (2,947 entries) with America ref#
- ✅ Import system (Override/Insert/Append × 5 Excel files)
- ✅ Expense category rules (learnable)
- ✅ Cascading updates (edit → recalculates everything downstream)

### CRM
- ✅ Client database with groups, types, industry, lead source
- ✅ Client profiles with notes (user + timestamp)
- ✅ Follow-ups → auto-create calendar events
- ✅ Sort/filter by group, type, last note date, last order
- ✅ Credit limits, payment terms, tax ID
- ✅ Linked orders from accounting system

### Ticketing System
- ✅ Full status workflow: New → Acknowledged → In Progress → Waiting → Review → Testing → Ready → Closed → Reopened
- ✅ Assign to individuals or whole team
- ✅ Priority levels (High/Medium/Low)
- ✅ Comments with user + timestamp
- ✅ Link tickets to clients and orders
- ✅ Manager/Admin must close Review/Testing tickets
- ✅ Voice-to-ticket creation (browser speech API)

### Calendar
- ✅ Day and Month grid views
- ✅ Recurring events (daily/weekly/biweekly/monthly/custom days)
- ✅ Multi-assign (individuals or whole team)
- ✅ Event types (Meeting/Call/Visit/Task)
- ✅ Mark done, follow-ups show on calendar
- ✅ My Calendar vs Team view

### Daily Activity Log
- ✅ Auto-captures all actions (notes, tickets, status changes, completions)
- ✅ Manual log entries
- ✅ Team view for admin — see what everyone did
- ✅ Auto vs manual entry distinction (⚡ icon)

### Admin & Settings
- ✅ 3-tier roles: Super Admin → Admin/Manager → Team Member
- ✅ Per-user module access toggles (Financial, CRM, Tickets, etc.)
- ✅ Per-user notification toggles per notification type
- ✅ Email notifications on ticket assign, events, follow-ups
- ✅ Team member management (add/edit/roles/reporting lines)
- ✅ Full audit trail on all changes

### Bilingual
- ✅ English + Arabic throughout

## Database: 454 lines of SQL
- 20+ tables with indexes, triggers, row-level security
- Auto-timestamp updates
- Auto-categorize expenses
- Auto-calculate invoice outstanding
- Full audit log

## Tech Stack
- Next.js 14 + React 18 + Tailwind CSS + Recharts
- Supabase (PostgreSQL + Auth + RLS)
- Vercel (free hosting)

## Future Phases
- Inventory module with product catalog
- Customs brokerage tracking
- Bookings & freight rates comparison
- WhatsApp integration (per-user)
- Deal pipeline (Lead → Won/Lost)
- Client health scoring
