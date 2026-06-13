// v55.83-AD — Accounting tab: groups the accounting screens under one tab.
// (The Plaid bank connection/import stays in the Bank tab.)
import { useState } from 'react';
import WaveBusinessFilter from './WaveBusinessFilter';
import AccountingDashboard from './AccountingDashboard';
import CompanyProfileTab from './CompanyProfileTab';
import AccountingCustomerHistory from './AccountingCustomerHistory';
import CustomerLedger from './CustomerLedger';
import WaveConnectionTab from './WaveConnectionTab';
import WaveImportTab from './WaveImportTab';
import WaveSyncCenter from './WaveSyncCenter';
import AccountingCustomersTab from './AccountingCustomersTab';
import AccountingInvoicesTab from './AccountingInvoicesTab';
import BankReviewTab from './BankReviewTab';
import PurchaseOrdersTab from './PurchaseOrdersTab';

export default function AccountingTab(props) {
  var [sub, setSub] = useState('dashboard');
  var [waveKey, setWaveKey] = useState('');
  var tabs = [
    ['dashboard', '📊 Dashboard'],
    ['company', '🏢 Company Profile'],
    ['arhistory', '📒 Customer AR History'],
    ['ledger', '📑 Customer Ledger'],
    ['customers', '👤 Customers'],
    ['invoices', '🧾 Invoices'],
    ['proformas', '📄 Proformas'],
    ['purchaseorders', '📦 Purchase Orders'],
    ['review', '🏦 Bank Review & Matching'],
    ['wave', '🌊 Wave Connection'],
    ['waveimport', '⬇️ Wave Import'],
    ['wavesync', '🔄 Wave Sync Center'],
  ];
  return (
    <div>
      <div className="flex flex-wrap gap-1 p-3 border-b border-slate-800">
        {tabs.map(function (t) {
          return (
            <button key={t[0]} onClick={function () { setSub(t[0]); }}
              className={'px-3 py-1.5 text-xs rounded font-bold ' + (sub === t[0] ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>
              {t[1]}
            </button>
          );
        })}
      </div>
      <div className="px-3 pt-3">
        <WaveBusinessFilter onChange={function (b) { setWaveKey(b || ''); }} />
      </div>
      {sub === 'dashboard' && <AccountingDashboard key={'acct-dash|' + waveKey} {...props} onOpenBankReview={function () { setSub('review'); }} />}
      {sub === 'company' && <CompanyProfileTab {...props} />}
      {sub === 'arhistory' && <AccountingCustomerHistory key={'acct-arh|' + waveKey} {...props} />}
      {sub === 'ledger' && <CustomerLedger key={'acct-led|' + waveKey} {...props} />}
      {sub === 'customers' && <AccountingCustomersTab key={'acct-cus|' + waveKey} {...props} />}
      {sub === 'invoices' && <AccountingInvoicesTab key={'acct-inv|' + waveKey} {...props} defaultMode="invoices" />}
      {sub === 'proformas' && <AccountingInvoicesTab key={'acct-pf|' + waveKey} {...props} defaultMode="proformas" />}
      {sub === 'purchaseorders' && <PurchaseOrdersTab {...props} />}
      {sub === 'review' && <BankReviewTab key={'acct-rev|' + waveKey} {...props} />}
      {sub === 'wave' && <WaveConnectionTab {...props} />}
      {sub === 'waveimport' && <WaveImportTab {...props} />}
      {sub === 'wavesync' && <WaveSyncCenter key={'acct-sync|' + waveKey} {...props} />}
    </div>
  );
}
