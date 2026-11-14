// v55.83-AD — Accounting tab: groups the accounting screens under one tab.
// (The Plaid bank connection/import stays in the Bank tab.)
import { useState } from 'react';
import WaveBusinessFilter from './WaveBusinessFilter';
import AccountingDashboard from './AccountingDashboard';
import { acctAccess, screenHub } from '../lib/accounting-access'; // v55.83-RE / RF
import CompanyProfileTab from './CompanyProfileTab';
import AccountingCustomerHistory from './AccountingCustomerHistory';
import CustomerLedger from './CustomerLedger';
import WaveHub from './WaveHub';
import AccountingCustomersTab from './AccountingCustomersTab';
import AccountingInvoicesTab from './AccountingInvoicesTab';
import NexttradeReconciliation from './NexttradeReconciliation';
import OpenBalancesTab from './OpenBalancesTab';
import SalesReportTab from './SalesReportTab';
import PnLTab from './PnLTab';
import BusinessBooksTab from './BusinessBooksTab';
import BankReviewTab from './BankReviewTab';
import PurchaseOrdersTab from './PurchaseOrdersTab';
// v55.83-PB — LedgerlyHub hidden per Max ('i don't know what ledgerly is so hide it');
// the component file stays on disk but is no longer imported or routed.
import BooksHomeTab from './BooksHomeTab';
import JournalEntriesTab from './JournalEntriesTab'; // v55.83-SL
import MonthEndTab from './MonthEndTab'; // v55.83-SK
import WaitingTab from './WaitingTab'; // v55.83-SI
import BillsTab from './BillsTab';
import CashForecastTab from './CashForecastTab';
import PeriodStatsTab from './PeriodStatsTab';
import ExpenseRulesTab from './ExpenseRulesTab'; // v55.83-PI
import AllTransactionsTab from './AllTransactionsTab'; // v55.83-PW
import ClickBooksUSCore from './ClickBooksUSCore';
import ClickBooksUSWorkflows from './ClickBooksUSWorkflows';
import ClickBooksUSReports from './ClickBooksUSReports';
import ClickBooksUSCutover from './ClickBooksUSCutover';
import AuditTrailTab from './AuditTrailTab'; // v55.83-QI
import WiresTab from './WiresTab'; // v55.83-RG
import { useBankVisibility } from '../lib/use-bank-visibility';

export default function AccountingTab(props) {
  var financialAccess = useBankVisibility();
  // v55.83-IN — open directly on a deep-linked sub-tab (e.g. Bank Review from the Bank tab's
  // "Match in Bank Review" button). props.deepLink = { sub, txnId }; txnId flows to children via {...props}.
  var _initSub = (props.deepLink && props.deepLink.sub) || 'dashboard';
  // v55.83-MD/ME — old deep-links to the three separate Wave tabs now land on the unified Wave hub, but we
  // PRESERVE which sub-section was intended so a go-to-import/sync jump doesn't strand the user on Connect.
  var _initWaveStep = null;
  if (_initSub === 'wave') { _initWaveStep = 'connect'; }
  else if (_initSub === 'waveimport') { _initWaveStep = 'mirror'; }
  else if (_initSub === 'wavesync') { _initWaveStep = 'sync'; }
  if (_initWaveStep) { _initSub = 'wavehub'; }
  var [sub, setSub] = useState(_initSub);
  var [waveKey, setWaveKey] = useState('');
  var tabs = [
    ['dashboard', '📊 Dashboard'],
    ['books_home', '🏦 Books'], // v55.83-PB — ONE home: cash in/out, match queues, bills due
    ['waiting', '🔔 Waiting for me'], // v55.83-SI — master plan build 2: what needs this person in Bills and Wires, and what is stuck
    ['bills', '💸 Bills'], // v55.83-PB — vendor bills (AP): what we owe, pay from the bank feed
    ['wires', '🏦 Wires'], // v55.83-RG — wires sent: audit + AI + two-person sign-off, click → every bill paid
    ['forecast', '📈 Forecast'], // v55.83-PD — 30/60/90 in vs out, shortages, click-through drill
    ['journals', '✍️ Journal entries'], // v55.83-SL — written by one person, approved by another, then in the ledger
    ['monthend', '📅 Month-end'], // v55.83-SK — reconcile each bank account to its statement, then close the month
    ['period_stats', '📉 Stats'], // v55.83-PH — Jun 1 → : invoices & bills, monthly breakdown
    ['categories', '🏷 Categories & Rules'], // v55.83-PI — own categories, learned rules, verified stamp
    ['all_txns', '📑 All Transactions'], // v55.83-PW — every account, sort/filter/bulk-categorize
    ['clickbooks_reports', '📊 Financial Reports'], // v55.83-PB — P&L / balance sheet / GL from the real ledger
    ['clickbooks_admin', '⚙️ ClickBooks Admin'], // v55.83-PB — foundation/rules/migration/cutover, tucked away
    ['audit', '🧾 Audit Trail'], // v55.83-QI (Max 12:33) — who changed/matched/created/validated what, append-only
    ['company', '🏢 Company Profile'],
    ['arhistory', '📒 Customer AR History'],
    ['ledger', '📑 Customer Ledger'],
    ['customers', '👤 Customers'],
    ['invoices', '🧾 Invoices'],
    ['recon', '🔎 Order Reconciliation'], // v55.83-NV — moved from Admin: it is accounting work
    ['balances', '💰 Open Balances'], // v55.83-OJ — who owes what, overdue in orange
    ['sales_report', '📈 Sales Report'], // v55.83-ON — by product + customer, avg price, shipping separate
    ['pnl', '📊 P&L'], // v55.83-OO — effective-dated costs, profit per product/invoice, own permissions
    ['all_invoices', '📚 All Invoices'], // v55.83-OQ — US/Egypt split, open+closed+drafts, nothing hidden
    ['proformas', '📄 Proformas'],
    ['purchaseorders', '📦 Purchase Orders'],
    ['review', '🏦 Bank Review & Matching'],
    // v55.83-MD — the three scattered Wave tabs (Connection / Import / Sync Center) are now ONE guided
    // "🌊 Wave" tab (WaveHub) with a Connect → Import → Review&Push step flow.
    ['wavehub', '🌊 Wave'],
  ];
  // v55.83-GB — Wave Sync Center is now permission-gated: only super_admin OR a user granted
  // wave.sync.view sees the tab and can mount the screen. (Server routes already enforce the
  // specific push/import/settings permissions; this controls the screen itself.)
  var mp = props.modulePerms || {};
  var userProfile = props.userProfile; // v55.83-RG — was referenced (Audit Trail tab, wires gate) but never declared
  var isSuper = props.isSuperAdmin === true || (props.userProfile && props.userProfile.role === 'super_admin');
  // v55.83-SA (Max, Nov 12 07:27: "Why are people not seeing bills when they have permission") — owner / admin = every switch
  // (the permissions box says "always (admin)" and the server already agrees); the screen gates now say the same.
  var bossA = isSuper || (props.userProfile && (props.userProfile.role === 'owner' || props.userProfile.role === 'admin'));
  // v55.83-PW (Max): LEVEL 1 — "permission to see accounting in general".
  // The umbrella accounting.view opens the area; so does ANY specific
  // accounting permission (backward compatible). Super admin always.
  // v55.83-PZ (Max, Nov 7 11:17: "i need this organized in a better way...
  // to make sense") — tabs grouped by WHAT YOU'RE DOING, labeled rows like
  // the Books-home card groups. Order Reconciliation under SELLING (Max,
  // 11:19). Same tabs, same permissions — only the arrangement changed.
  var TAB_GROUPS = [
    ['📥 DAILY WORK — handle the money', ['books_home', 'all_txns', 'review', 'categories']],
    ['🧾 SELLING — customers & what they owe', ['invoices', 'all_invoices', 'proformas', 'recon', 'customers', 'arhistory', 'ledger', 'balances']],
    ['🛒 BUYING — vendors & what we owe', ['waiting', 'bills', 'wires', 'purchaseorders']],
    ['📊 REPORTS · SALES & CUSTOMERS', ['dashboard', 'sales_report', 'pnl']],
    ['📊 REPORTS · MONEY & CASH', ['period_stats', 'forecast', 'monthend']],
    ['📊 REPORTS · LEDGER (ClickBooks)', ['clickbooks_reports', 'journals']],
    ['⚙️ SYSTEM — rarely touched', ['company', 'wavehub', 'clickbooks_admin', 'audit']],
  ];
  // v55.83-RE (Max, Nov 8 15:12) — P1 "Accounting Access" is REQUIRED before
  // any other accounting permission takes effect (both hubs, one definition).
  var acctV = acctAccess(isSuper, mp, props.userProfile && props.userProfile.role);
  var hasAnyAccounting = acctV.access;
  // v55.83-RF (Max, Nov 8 15:25: "2 switches with same permissioning for both")
  // — each screen belongs to ONE hub and shows only with that hub's switch;
  // P2/P3 rules are identical inside both. The audit trail serves either hub.
  function hubAllows(k) { var h = screenHub(k); return h === 'ktc' ? acctV.ktc : h === 'wave' ? acctV.wave : acctV.access; }

  var canWaveSync = isSuper || mp['wave.sync.view'] === true;
  var clickbooksEnabled = process.env.NEXT_PUBLIC_CLICKBOOKS_US_ENABLED === 'true';
  var workflowsEnabled = clickbooksEnabled && process.env.NEXT_PUBLIC_CLICKBOOKS_US_WORKBENCH_ENABLED === 'true';
  var reportsEnabled = clickbooksEnabled && process.env.NEXT_PUBLIC_CLICKBOOKS_US_REPORTS_ENABLED === 'true';
  var cutoverEnabled = clickbooksEnabled && process.env.NEXT_PUBLIC_CLICKBOOKS_US_CUTOVER_ENABLED === 'true';
  var canClickbooks = financialAccess.canViewFullDashboard === true || financialAccess.isVerifiedSuperAdmin === true;
  var canLedgerly = financialAccess.canViewFullDashboard === true || financialAccess.canViewBankBalances === true;
  if (!hasAnyAccounting) {
    return <div className="p-6"><div className="rounded-xl p-4 text-sm" style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', maxWidth: 560 }}>
      <b>Accounting is locked for your account.</b> Ask an admin for <b>P1a · ClickBooks (KTC Hub) Access</b> and/or <b>P1b · Wave Hub Access</b> in Settings → 🏦 Banking & Accounting Access — every other accounting permission takes effect only with one of them.</div></div>;
  }
  // v55.83-RF — never render a screen of a hub this user has no switch for (deep links, card jumps)
  if (!hubAllows(sub)) { sub = acctV.ktc ? 'books_home' : 'dashboard'; }
  return (
    <div>
      <div className="p-3 border-b border-slate-800">
        {TAB_GROUPS.map(function (g) {
          var keep = {};
          tabs.filter(function (t) { return hubAllows(t[0]) && (t[0] !== 'clickbooks_reports' || (reportsEnabled && canClickbooks)) && (t[0] !== 'clickbooks_admin' || (clickbooksEnabled && financialAccess.isVerifiedSuperAdmin === true)) && (t[0] !== 'bills' || bossA || mp['bills.view'] === true || mp['bills.manage'] === true) && (t[0] !== 'journals' || bossA || mp['journals.prepare'] === true || mp['journals.approve'] === true) && (t[0] !== 'waiting' || bossA || mp['bills.view'] === true || mp['bills.manage'] === true || mp['wires.view'] === true || mp['wires.prepare'] === true || mp['wires.signoff'] === true || mp['wires.send'] === true) && (t[0] !== 'wires' || isSuper || mp['wires.view'] === true || mp['wires.prepare'] === true || mp['wires.signoff'] === true || mp['wires.send'] === true || (userProfile && (userProfile.role === 'owner' || userProfile.role === 'admin'))) && (t[0] !== 'forecast' || acctV.access) && (t[0] !== 'period_stats' || acctV.access) && (t[0] !== 'categories' || bossA || mp['bank.classify'] === true) && (t[0] !== 'all_txns' || bossA || mp['bank.classify'] === true) && (t[0] !== 'audit' || bossA || mp['audit.view'] === true); }).forEach(function (t2) { keep[t2[0]] = t2[1]; });
          var items = g[1].filter(function (k) { return keep[k]; });
          if (!items.length) { return null; }
          return <div key={g[0]} className="mb-1.5">
            <div className="text-[9px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: '#64748b' }}>{g[0]}</div>
            <div className="flex flex-wrap gap-1">
              {items.map(function (k) {
                return <button key={k} onClick={function () { setSub(k); }}
                  className={'px-3 py-1.5 text-xs rounded font-bold ' + (sub === k ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>
                  {keep[k]}
                </button>;
              })}
            </div>
          </div>;
        })}
      </div>
      {sub !== 'books_home' && sub !== 'bills' && sub !== 'wires' && sub !== 'waiting' && sub !== 'monthend' && sub !== 'journals' && sub !== 'forecast' && sub !== 'period_stats' && sub !== 'categories' && sub !== 'all_txns' && sub !== 'clickbooks_reports' && sub !== 'clickbooks_admin' && <div className="px-3 pt-3">
        <WaveBusinessFilter onChange={function (b) { setWaveKey(b || ''); }} />
      </div>}
      {sub === 'dashboard' && <AccountingDashboard key={'acct-dash|' + waveKey} {...props} onOpenBankReview={function () { setSub('review'); }} />}
      {sub === 'books_home' && <div className="p-3"><BooksHomeTab {...props} onGo={setSub} /></div>}
      {sub === 'waiting' && <div className="p-3"><WaitingTab {...props} onGo={setSub} /></div>}
      {sub === 'monthend' && <div className="p-3"><MonthEndTab /></div>}
      {sub === 'journals' && <div className="p-3"><JournalEntriesTab /></div>}
      {sub === 'bills' && <div className="p-3"><BillsTab {...props} /></div>}
      {sub === 'wires' && <div className="p-3"><WiresTab {...props} /></div>}
      {sub === 'forecast' && <div className="p-3"><CashForecastTab {...props} onGo={setSub} /></div>}
      {sub === 'period_stats' && <div className="p-3"><PeriodStatsTab {...props} onGo={setSub} /></div>}
      {sub === 'categories' && <div className="p-3"><ExpenseRulesTab {...props} /></div>}
      {sub === 'all_txns' && <div className="p-3"><AllTransactionsTab {...props} onGo={setSub} /></div>}
      {sub === 'clickbooks_reports' && reportsEnabled && canClickbooks && <ClickBooksUSReports />}
      {sub === 'clickbooks_admin' && clickbooksEnabled && <ClickBooksAdmin workflowsEnabled={workflowsEnabled} cutoverEnabled={cutoverEnabled} canClickbooks={canClickbooks} />}
      {sub === 'audit' && <div className="p-3"><AuditTrailTab userProfile={userProfile} /></div>}
      {sub === 'company' && <CompanyProfileTab {...props} />}
      {sub === 'arhistory' && <AccountingCustomerHistory key={'acct-arh|' + waveKey} {...props} onGo={setSub} />}
      {sub === 'ledger' && <CustomerLedger key={'acct-led|' + waveKey} {...props} />}
      {sub === 'customers' && <AccountingCustomersTab key={'acct-cus|' + waveKey} {...props} />}
      {sub === 'invoices' && <AccountingInvoicesTab key={'acct-inv|' + waveKey} {...props} defaultMode="invoices" />}
      {sub === 'recon' && <NexttradeReconciliation {...props} />}
      {sub === 'balances' && <OpenBalancesTab {...props} />}
      {sub === 'sales_report' && <SalesReportTab {...props} />}
      {sub === 'pnl' && <PnLTab {...props} />}
      {sub === 'all_invoices' && <BusinessBooksTab {...props} onGo={setSub} />}
      {sub === 'proformas' && <AccountingInvoicesTab key={'acct-pf|' + waveKey} {...props} defaultMode="proformas" />}
      {sub === 'purchaseorders' && <PurchaseOrdersTab {...props} />}
      {sub === 'review' && <BankReviewTab key={'acct-rev|' + waveKey} {...props} />}
      {sub === 'wavehub' && <WaveHub key={'acct-wavehub|' + waveKey} {...props} waveKey={waveKey} canWaveSync={canWaveSync} initialWaveStep={_initWaveStep} />}
    </div>
  );
}

// v55.83-PB — the four engine-room ClickBooks screens live behind ONE admin tab
// (Max: "what is this shit with the tabs of clickbook. just useless shit").
// Daily value lives in 🏦 Books and 📊 Financial Reports; this is the machinery.
function ClickBooksAdmin(props) {
  var [view, setView] = useState('foundation');
  var views = [
    ['foundation', 'Foundation audit'],
    ['workflows', 'Rules & Migration'],
    ['cutover', 'Parallel & Cutover'],
  ];
  return (
    <div className="p-3">
      <div className="flex gap-1 mb-3">
        {views.map(function (v) {
          if (v[0] === 'workflows' && !props.workflowsEnabled) { return null; }
          if (v[0] === 'cutover' && !props.cutoverEnabled) { return null; }
          return (
            <button key={v[0]} onClick={function () { setView(v[0]); }}
              className={'px-3 py-1.5 text-xs rounded font-bold ' + (view === v[0] ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>
              {v[1]}
            </button>
          );
        })}
      </div>
      {view === 'foundation' && <ClickBooksUSCore canView={props.canClickbooks} />}
      {view === 'workflows' && props.workflowsEnabled && <ClickBooksUSWorkflows />}
      {view === 'cutover' && props.cutoverEnabled && <ClickBooksUSCutover />}
    </div>
  );
}
