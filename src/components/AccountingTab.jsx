// v55.83-AD — Accounting tab: groups the accounting screens under one tab.
// (The Plaid bank connection/import stays in the Bank tab.)
import { useState } from 'react';
import WaveBusinessFilter from './WaveBusinessFilter';
import AccountingDashboard from './AccountingDashboard';
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
import LedgerlyHub from './LedgerlyHub';
import ClickBooksUSCore from './ClickBooksUSCore';
import ClickBooksUSWorkflows from './ClickBooksUSWorkflows';
import ClickBooksUSReports from './ClickBooksUSReports';
import ClickBooksUSCutover from './ClickBooksUSCutover';
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
    ['ledgerly', '📗 Ledgerly'],
    ['clickbooks_us', 'ClickBooks · US'],
    ['clickbooks_workflows', 'ClickBooks · Rules & Migration'],
    ['clickbooks_reports', 'ClickBooks · Reports & Tax'],
    ['clickbooks_cutover', 'ClickBooks · Parallel & Cutover'],
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
  var isSuper = props.isSuperAdmin === true || (props.userProfile && props.userProfile.role === 'super_admin');
  var canWaveSync = isSuper || mp['wave.sync.view'] === true;
  var clickbooksEnabled = process.env.NEXT_PUBLIC_CLICKBOOKS_US_ENABLED === 'true';
  var workflowsEnabled = clickbooksEnabled && process.env.NEXT_PUBLIC_CLICKBOOKS_US_WORKBENCH_ENABLED === 'true';
  var reportsEnabled = clickbooksEnabled && process.env.NEXT_PUBLIC_CLICKBOOKS_US_REPORTS_ENABLED === 'true';
  var cutoverEnabled = clickbooksEnabled && process.env.NEXT_PUBLIC_CLICKBOOKS_US_CUTOVER_ENABLED === 'true';
  var canClickbooks = financialAccess.canViewFullDashboard === true || financialAccess.isVerifiedSuperAdmin === true;
  var canLedgerly = financialAccess.canViewFullDashboard === true || financialAccess.canViewBankBalances === true;
  return (
    <div>
      <div className="flex flex-wrap gap-1 p-3 border-b border-slate-800">
        {tabs.filter(function (t) { return (t[0] !== 'ledgerly' || canLedgerly) && (t[0] !== 'clickbooks_us' || (clickbooksEnabled && canClickbooks)) && (t[0] !== 'clickbooks_workflows' || workflowsEnabled) && (t[0] !== 'clickbooks_reports' || (reportsEnabled && canClickbooks)) && (t[0] !== 'clickbooks_cutover' || cutoverEnabled); }).map(function (t) {
          return (
            <button key={t[0]} onClick={function () { setSub(t[0]); }}
              className={'px-3 py-1.5 text-xs rounded font-bold ' + (sub === t[0] ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>
              {t[1]}
            </button>
          );
        })}
      </div>
      {sub !== 'ledgerly' && sub !== 'clickbooks_us' && sub !== 'clickbooks_workflows' && sub !== 'clickbooks_reports' && sub !== 'clickbooks_cutover' && <div className="px-3 pt-3">
        <WaveBusinessFilter onChange={function (b) { setWaveKey(b || ''); }} />
      </div>}
      {sub === 'dashboard' && <AccountingDashboard key={'acct-dash|' + waveKey} {...props} onOpenBankReview={function () { setSub('review'); }} />}
      {sub === 'ledgerly' && <LedgerlyHub {...props} canView={canLedgerly} />}
      {sub === 'clickbooks_us' && clickbooksEnabled && <ClickBooksUSCore canView={canClickbooks} />}
      {sub === 'clickbooks_workflows' && workflowsEnabled && <ClickBooksUSWorkflows />}
      {sub === 'clickbooks_reports' && reportsEnabled && canClickbooks && <ClickBooksUSReports />}
      {sub === 'clickbooks_cutover' && cutoverEnabled && <ClickBooksUSCutover />}
      {sub === 'company' && <CompanyProfileTab {...props} />}
      {sub === 'arhistory' && <AccountingCustomerHistory key={'acct-arh|' + waveKey} {...props} />}
      {sub === 'ledger' && <CustomerLedger key={'acct-led|' + waveKey} {...props} />}
      {sub === 'customers' && <AccountingCustomersTab key={'acct-cus|' + waveKey} {...props} />}
      {sub === 'invoices' && <AccountingInvoicesTab key={'acct-inv|' + waveKey} {...props} defaultMode="invoices" />}
      {sub === 'recon' && <NexttradeReconciliation {...props} />}
      {sub === 'balances' && <OpenBalancesTab {...props} />}
      {sub === 'sales_report' && <SalesReportTab {...props} />}
      {sub === 'pnl' && <PnLTab {...props} />}
      {sub === 'all_invoices' && <BusinessBooksTab {...props} />}
      {sub === 'proformas' && <AccountingInvoicesTab key={'acct-pf|' + waveKey} {...props} defaultMode="proformas" />}
      {sub === 'purchaseorders' && <PurchaseOrdersTab {...props} />}
      {sub === 'review' && <BankReviewTab key={'acct-rev|' + waveKey} {...props} />}
      {sub === 'wavehub' && <WaveHub key={'acct-wavehub|' + waveKey} {...props} waveKey={waveKey} canWaveSync={canWaveSync} initialWaveStep={_initWaveStep} />}
    </div>
  );
}
