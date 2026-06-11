// v55.83-AD — Accounting tab: groups the accounting screens under one tab.
// (The Plaid bank connection/import stays in the Bank tab.)
import { useState } from 'react';
import AccountingDashboard from './AccountingDashboard';
import AccountingCustomersTab from './AccountingCustomersTab';
import AccountingInvoicesTab from './AccountingInvoicesTab';
import BankReviewTab from './BankReviewTab';

export default function AccountingTab(props) {
  var [sub, setSub] = useState('dashboard');
  var tabs = [
    ['dashboard', '📊 Dashboard'],
    ['customers', '👤 Customers'],
    ['invoices', '🧾 Invoices'],
    ['proformas', '📄 Proformas'],
    ['review', '🏦 Bank Review & Matching'],
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
      {sub === 'dashboard' && <AccountingDashboard {...props} />}
      {sub === 'customers' && <AccountingCustomersTab {...props} />}
      {sub === 'invoices' && <AccountingInvoicesTab key="acct-inv" {...props} defaultMode="invoices" />}
      {sub === 'proformas' && <AccountingInvoicesTab key="acct-pf" {...props} defaultMode="proformas" />}
      {sub === 'review' && <BankReviewTab {...props} />}
    </div>
  );
}
