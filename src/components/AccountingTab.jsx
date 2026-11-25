// v55.83-AD — Accounting tab: groups the accounting screens under one tab.
// (The Plaid bank connection/import stays in the Bank tab.)
import { useEffect, useState } from 'react';
import WaveBusinessFilter from './WaveBusinessFilter';
import AccountingDashboard from './AccountingDashboard';
import { acctAccess, screenHub } from '../lib/accounting-access'; // v55.83-RE / RF
import CompanyProfileTab from './CompanyProfileTab';
import AccountingCustomerHistory from './AccountingCustomerHistory';
import CustomerLedger from './CustomerLedger';
import WaveHub from './WaveHub';
import WaveHistoryTab, { fetchHistory } from './WaveHistoryTab';
import AccountingCustomersTab from './AccountingCustomersTab';
import AccountingInvoicesTab from './AccountingInvoicesTab';
import NexttradeReconciliation from './NexttradeReconciliation';
import OpenBalancesTab from './OpenBalancesTab';
import CashOnHandPanel from './CashOnHandPanel'; // v55.83-YF — Cash on Hand
import CustomersOverviewTab from './CustomersOverviewTab'; // v55.83-VN — every customer: invoiced, paid, received, owed, by period
import SalesReportTab from './SalesReportTab';
import PnLTab from './PnLTab';
import ArrivalRemindersTab from './ArrivalRemindersTab'; // v55.83-XG — arrival + final-payment reminders (Max, 22 Nov)
import OrderMonitorTab from './OrderMonitorTab'; // v55.83-TI — order lifecycle, exceptions, deposits, 30-hour deadline
import ProfitabilityTab from './ProfitabilityTab'; // v55.83-SY — profitability by product / customer / invoice (not the cash report)
import { canOpenTypedPnl } from '../lib/margin-visibility';
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
import CompanyBooksTab from './CompanyBooksTab'; // v55.83-TW
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
  // v55.83-SO (Max, Nov 15: "Add an obvious Close/Back control to transaction details and other pages opened
  // during quick actions. Return me to the previous screen while preserving my filters and position.")
  // A jump made from INSIDE a screen (a card, a queue button, "open in Bank Review") remembers where the
  // person was. That screen stays alive but hidden, so its filters, open rows and typed text are untouched,
  // and Back returns to the same scroll position. Picking a tab from the strip is a fresh start (no Back).
  var [back, setBack] = useState(null); // { sub, y } | null
  function goFrom(k) {
    if (!k || k === sub) { return; }
    var y0 = 0; try { y0 = window.scrollY || 0; } catch (e0) {}
    setBack({ sub: sub, y: y0 });
    setSub(k);
    try { window.scrollTo(0, 0); } catch (e1) {}
  }
  function goBack() {
    var b0 = back; if (!b0) { return; }
    setBack(null); setBillTarget(null); setSub(b0.sub);
    setTimeout(function () {
      try { window.scrollTo(0, b0.y || 0); window.dispatchEvent(new CustomEvent('nt-acct-returned', { detail: { sub: b0.sub } })); } catch (e2) {}
    }, 60);
  }
  function pickTab(k) { setBack(null); setBillTarget(null); setSub(k); }
  // v55.83-XL — "Open this bill" from Waiting for me: Bills opens on that exact bill; the Back button (SO) returns to the list
  var [billTarget, setBillTarget] = useState(null); // { id, bill_number, title, section, n } | null
  function openBillFrom(t) { if (!t || !t.id) { return; } setBillTarget(Object.assign({}, t, { n: Date.now() })); goFrom('bills'); }
  // v55.83-XX (Max, 23 Nov: Nextrade bills "will be available for only Nextrade payments wires") — 🟦 Nextrade bills → Pay ▸ → "From a KTC
  // transfer to NextTrade" asks (window event hub-open-nextrade-wire) for Wires → ＋ New wire to NextTrade with that bill ticked. goFrom keeps
  // the SO Back button. Nothing is written by opening it; the transfer is picked by the person.
  var [wirePreset, setWirePreset] = useState(null); // { payee, bill_id, bill_number, n } | null
  useEffect(function () {
    function onOpenWire(e) {
      var d = (e && e.detail) || {}; if (!d.bill_id) { return; }
      setWirePreset({ payee: d.payee || 'NextTrade Industries', bill_id: d.bill_id, bill_number: d.bill_number || '', n: Date.now() });
      goFrom('wires');
    }
    try { window.addEventListener('hub-open-nextrade-wire', onOpenWire); } catch (e0) { return undefined; }
    return function () { try { window.removeEventListener('hub-open-nextrade-wire', onOpenWire); } catch (e1) {} };
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(function () { if (sub !== 'wires' && wirePreset) { setWirePreset(null); } }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps -- leaving Wires forgets the preset (a later visit opens nothing by itself)
  function alive(k) { return sub === k || (back && back.sub === k); }
  function shown(k) { return { display: sub === k ? 'block' : 'none' }; }
  var [waveKey, setWaveKey] = useState('');
  var [historyAccess, setHistoryAccess] = useState(null);
  var authUserId = props.user?.id;
  useEffect(function () {
    var active = true;
    setHistoryAccess(null);
    if (authUserId) fetchHistory({ action: 'access' }).then(function (access) {
      if (active) setHistoryAccess({ ...access, userId: authUserId });
    }).catch(function () {});
    return function () { active = false; };
  }, [authUserId]);
  var mayViewWaveHistory = !!historyAccess && historyAccess.userId === authUserId;
  var tabs = [
    ['dashboard', '📊 Dashboard'],
    ['books_home', '🏦 Books'], // v55.83-PB — ONE home: cash in/out, match queues, bills due
    ['waiting', '🔔 Waiting for me'], // v55.83-SI — master plan build 2: what needs this person in Bills and Wires, and what is stuck
    ['nextrade', '🟦 Nextrade'], // v55.83-TW — Nextrade's own books (no Wave)
    ['rtm', '🟪 RTM'], // v55.83-TW — RTM's own books (no Wave)
    ['bills', '💸 Bills'], // v55.83-PB — vendor bills (AP): what we owe, pay from the bank feed
    ['wires', '🏦 Wires'], // v55.83-RG — wires sent: audit + AI + two-person sign-off, click → every bill paid
    ['forecast', '📈 Forecast'], // v55.83-PD — 30/60/90 in vs out, shortages, click-through drill
    ['journals', '✍️ Journal entries'], // v55.83-SL — written by one person, approved by another, then in the ledger
    ['monthend', '📅 Month-end'], // v55.83-SK — reconcile each bank account to its statement, then close the month
    ['period_stats', '📉 Stats & Income Statement (cash)'], // v55.83-PH — Jun 1 → : invoices & bills, monthly breakdown
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
    ['orders', '🚚 Orders — stage & what is missing'], // v55.83-TI (Max, Nov 16)
    ['arrival_reminders', '📨 Arrival & final-payment reminders'], // v55.83-XG (Max, 22 Nov)
    ['recon', '🔎 Order Reconciliation'], // v55.83-NV — moved from Admin: it is accounting work
    ['customers_overview', '👥 Customers overview (invoiced · paid · owed)'], // v55.83-VN (Max, Nov 19)
    ['balances', '💰 Open Balances'], // v55.83-OJ — who owes what, overdue in orange
    ['sales_report', '📈 Sales Report'], // v55.83-ON — by product + customer, avg price, shipping separate
    ['profitability', '📊 Profitability (product · customer · invoice)'], // v55.83-SY — actual bill costs, transportation charged vs paid, by release
    ['pnl', '📊 P&L (typed costs)'], // v55.83-OO — effective-dated costs, profit per product/invoice, own permissions
    ['all_invoices', '📚 All Invoices'], // v55.83-OQ — US/Egypt split, open+closed+drafts, nothing hidden
    ['proformas', '📄 Proformas'],
    ['purchaseorders', '📦 Purchase Orders'],
    ['review', '🏦 Bank Review & Matching'],
    // v55.83-MD — the three scattered Wave tabs (Connection / Import / Sync Center) are now ONE guided
    // "🌊 Wave" tab (WaveHub) with a Connect → Import → Review&Push step flow.
    ['wavehub', '🌊 Wave'],
  ];
  if (mayViewWaveHistory) tabs.push(['wavehistory', 'Wave History']);
  // v55.83-GB — Wave Sync Center is now permission-gated: only super_admin OR a user granted
  // wave.sync.view sees the tab and can mount the screen. (Server routes already enforce the
  // specific push/import/settings permissions; this controls the screen itself.)
  var mp = props.modulePerms || {};
  var userProfile = props.userProfile; // v55.83-RG — was referenced (Audit Trail tab, wires gate) but never declared
  var isSuper = props.isSuperAdmin === true || (props.userProfile && props.userProfile.role === 'super_admin');
  var canOpenProfitability = isSuper || mp['pnl.view'] === true;
  var canOpenPnl = canOpenTypedPnl(isSuper, mp);
  tabs = tabs.filter(function (tab) {
    if (tab[0] === 'profitability') { return canOpenProfitability; }
    if (tab[0] === 'pnl') { return canOpenPnl; }
    return true;
  });
  // v55.83-YF — Cash on Hand is a PRIVATE account: the tab shows for the super admin or "Bank: See private accounts" (the server decides again)
  if (isSuper || mp['bank.view_private'] === true) { tabs.splice(tabs.findIndex(function (t) { return t[0] === 'balances'; }) + 1, 0, ['cash', '💵 Cash on Hand']); }
  // v55.83-SA (Max, Nov 12 07:27: "Why are people not seeing bills when they have permission") — owner / admin = every switch
  // (the permissions box says "always (admin)" and the server already agrees); the screen gates now say the same.
  var bossA = isSuper; /* v55.83-UG (Max, Nov 18: "the admin should not just have access, i need to give him access") — only the super admin bypasses; admins/owners use their switches */
  // v55.83-PW (Max): LEVEL 1 — "permission to see accounting in general".
  // The umbrella accounting.view opens the area; so does ANY specific
  // accounting permission (backward compatible). Super admin always.
  // v55.83-PZ (Max, Nov 7 11:17: "i need this organized in a better way...
  // to make sense") — tabs grouped by WHAT YOU'RE DOING, labeled rows like
  // the Books-home card groups. Order Reconciliation under SELLING (Max,
  // 11:19). Same tabs, same permissions — only the arrangement changed.
  var TAB_GROUPS = [
    ['📥 DAILY WORK — handle the money', ['books_home', 'all_txns', 'review', 'cash', 'categories']],
    ['🧾 SELLING — customers & what they owe', ['orders', 'arrival_reminders', 'invoices', 'all_invoices', 'proformas', 'recon', 'customers', 'arhistory', 'ledger', 'customers_overview', 'balances']],
    ['🛒 BUYING — vendors & what we owe', ['waiting', 'bills', 'wires', 'purchaseorders']],
    ['📊 REPORTS · SALES & CUSTOMERS', ['dashboard', 'sales_report', 'profitability', 'pnl']],
    ['📊 REPORTS · MONEY & CASH', ['period_stats', 'forecast', 'monthend']],
    ['📊 REPORTS · LEDGER (ClickBooks)', ['clickbooks_reports', 'journals']],
    ['📚 HISTORICAL REPORTS', ['wavehistory']],
    ['🏢 OTHER COMPANIES — their own books', ['nextrade', 'rtm']], // v55.83-TW (Max: three separate companies)
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
  if (sub === 'pnl' && !canOpenPnl && canOpenProfitability) { sub = 'profitability'; }
  if (!hubAllows(sub) || (sub === 'profitability' && !canOpenProfitability) || (sub === 'pnl' && !canOpenPnl)) {
    sub = acctV.ktc ? 'books_home' : 'dashboard';
  }
  return (
    <div>
      <div className="p-3 border-b border-slate-800">
        {TAB_GROUPS.map(function (g) {
          var keep = {};
          tabs.filter(function (t) { return hubAllows(t[0]) && (isSuper || mp['pnl.view_revenue'] !== false || t[0] === 'profitability' || t[0] === 'pnl') /* v55.83-XK — a researcher sees only Profitability and P&L (the server refuses the rest) */ &&(t[0] !== 'clickbooks_reports' || (reportsEnabled && canClickbooks)) && (t[0] !== 'clickbooks_admin' || (clickbooksEnabled && financialAccess.isVerifiedSuperAdmin === true)) && (t[0] !== 'bills' || bossA || mp['bills.view'] === true || mp['bills.manage'] === true) && (t[0] !== 'journals' || bossA || mp['journals.prepare'] === true || mp['journals.approve'] === true) && (t[0] !== 'waiting' || bossA || mp['bills.view'] === true || mp['bills.manage'] === true || mp['wires.view'] === true || mp['wires.prepare'] === true || mp['wires.signoff'] === true || mp['wires.send'] === true) && (t[0] !== 'wires' || isSuper || mp['wires.view'] === true || mp['wires.prepare'] === true || mp['wires.signoff'] === true || mp['wires.send'] === true) && (t[0] !== 'forecast' || acctV.access) && (t[0] !== 'period_stats' || acctV.access) && (t[0] !== 'categories' || bossA || mp['bank.classify'] === true) && (t[0] !== 'all_txns' || bossA || mp['bank.classify'] === true) && (t[0] !== 'audit' || bossA || mp['audit.view'] === true) && (t[0] !== 'nextrade' || isSuper || mp['company.nextrade.view'] === true || mp['company.nextrade.manage'] === true) && (t[0] !== 'rtm' || isSuper || mp['company.rtm.view'] === true || mp['company.rtm.manage'] === true) && (t[0] !== 'orders' || bossA || mp['orders.monitor'] === true || mp['orders.manage'] === true); }).forEach(function (t2) { keep[t2[0]] = t2[1]; });
          var items = g[1].filter(function (k) { return keep[k]; });
          if (!items.length) { return null; }
          return <div key={g[0]} className="mb-1.5">
            <div className="text-[9px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: '#64748b' }}>{g[0]}</div>
            <div className="flex flex-wrap gap-1">
              {items.map(function (k) {
                return <button key={k} onClick={function () { pickTab(k); }}
                  className={'px-3 py-1.5 text-xs rounded font-bold ' + (sub === k ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')}>
                  {keep[k]}
                </button>;
              })}
            </div>
          </div>;
        })}
      </div>
      {sub !== 'wavehistory' && sub !== 'books_home' && sub !== 'nextrade' && sub !== 'rtm' && sub !== 'bills' && sub !== 'wires' && sub !== 'waiting' && sub !== 'monthend' && sub !== 'journals' && sub !== 'forecast' && sub !== 'period_stats' && sub !== 'categories' && sub !== 'all_txns' && sub !== 'clickbooks_reports' && sub !== 'clickbooks_admin' && <div className="px-3 pt-3">
        <WaveBusinessFilter onChange={function (b) { setWaveKey(b || ''); }} />
      </div>}
      {/* v55.83-SO — the obvious way back after a quick jump, or after arriving from another part of the Hub */}
      {((back && back.sub !== sub) || props.onReturn) && <div className="px-3 pt-3 flex items-center gap-2 flex-wrap">
        {back && back.sub !== sub && <button onClick={goBack} className="px-4 py-2 rounded-lg text-[13px] font-extrabold" style={{ background: '#ffffff', color: '#0f172a', border: '2px solid #1d4ed8' }}>← Back to {labelOfSub(tabs, back.sub)}</button>}
        {!(back && back.sub !== sub) && props.onReturn && <button onClick={props.onReturn} className="px-4 py-2 rounded-lg text-[13px] font-extrabold" style={{ background: '#ffffff', color: '#0f172a', border: '2px solid #1d4ed8' }}>← Back to {props.returnLabel || 'where you were'}</button>}
        <span className="text-[11px]" style={{ color: '#cbd5e1' }}>Your filters and place are kept.</span>
      </div>}
      {alive('dashboard') && <div style={shown('dashboard')}><AccountingDashboard key={'acct-dash|' + waveKey} {...props} onOpenBankReview={function () { goFrom('review'); }} /></div>}
      {alive('books_home') && <div className="p-3" style={shown('books_home')}><BooksHomeTab {...props} onGo={goFrom} /></div>}
      {alive('waiting') && <div className="p-3" style={shown('waiting')}><WaitingTab {...props} onGo={goFrom} onOpenBill={openBillFrom} /></div>}
      {sub === 'monthend' && <div className="p-3"><MonthEndTab /></div>}
      {sub === 'journals' && <div className="p-3"><JournalEntriesTab /></div>}
      {sub === 'nextrade' && <div className="p-3"><CompanyBooksTab key="nextrade" company="nextrade" userProfile={props.userProfile} toast={props.toast} canManage={isSuper || mp['company.nextrade.manage'] === true} /></div>}
      {sub === 'rtm' && <div className="p-3"><CompanyBooksTab key="rtm" company="rtm" userProfile={props.userProfile} toast={props.toast} canManage={isSuper || mp['company.rtm.manage'] === true} /></div>}
      {sub === 'bills' && <div className="p-3"><BillsTab {...props} openBillTarget={back && back.sub === 'waiting' ? billTarget : null} onBackFromBill={back && back.sub === 'waiting' ? goBack : null} /></div>}
      {sub === 'wires' && <div className="p-3"><WiresTab {...props} wirePreset={wirePreset} /></div>}
      {alive('forecast') && <div className="p-3" style={shown('forecast')}><CashForecastTab {...props} onGo={goFrom} /></div>}
      {alive('period_stats') && <div className="p-3" style={shown('period_stats')}><PeriodStatsTab {...props} onGo={goFrom} /></div>}
      {sub === 'categories' && <div className="p-3"><ExpenseRulesTab {...props} /></div>}
      {alive('all_txns') && <div className="p-3" style={shown('all_txns')}><AllTransactionsTab {...props} onGo={goFrom} /></div>}
      {sub === 'clickbooks_reports' && reportsEnabled && canClickbooks && <ClickBooksUSReports {...props} onGo={goFrom} />}
      {sub === 'clickbooks_admin' && clickbooksEnabled && <ClickBooksAdmin workflowsEnabled={workflowsEnabled} cutoverEnabled={cutoverEnabled} canClickbooks={canClickbooks} />}
      {sub === 'audit' && <div className="p-3"><AuditTrailTab userProfile={userProfile} isSuperAdmin={isSuper} /></div>}
      {sub === 'company' && <CompanyProfileTab {...props} />}
      {alive('arhistory') && <div style={shown('arhistory')}><AccountingCustomerHistory key={'acct-arh|' + waveKey} {...props} onGo={goFrom} /></div>}
      {sub === 'ledger' && <CustomerLedger key={'acct-led|' + waveKey} {...props} />}
      {sub === 'customers' && <AccountingCustomersTab key={'acct-cus|' + waveKey} {...props} />}
      {sub === 'invoices' && <AccountingInvoicesTab key={'acct-inv|' + waveKey} {...props} defaultMode="invoices" />}
      {sub === 'recon' && <NexttradeReconciliation {...props} />}
      {sub === 'customers_overview' && <CustomersOverviewTab {...props} onGo={goFrom} />}
      {sub === 'balances' && <OpenBalancesTab {...props} />}
      {sub === 'cash' && <div className="p-3"><CashOnHandPanel userProfile={props.userProfile} toast={props.toast} /></div>}
      {sub === 'sales_report' && <SalesReportTab {...props} />}
      {sub === 'pnl' && <PnLTab {...props} />}
      {alive('orders') && <div className="p-3" style={shown('orders')}><OrderMonitorTab {...props} onGo={goFrom} /></div>}
      {sub === 'arrival_reminders' && <div className="p-3"><ArrivalRemindersTab {...props} /></div>}
      {sub === 'profitability' && <div className="p-3"><ProfitabilityTab {...props} onGo={goFrom} /></div>}
      {alive('all_invoices') && <div style={shown('all_invoices')}><BusinessBooksTab {...props} onGo={goFrom} /></div>}
      {sub === 'proformas' && <AccountingInvoicesTab key={'acct-pf|' + waveKey} {...props} defaultMode="proformas" />}
      {sub === 'purchaseorders' && <PurchaseOrdersTab {...props} />}
      {sub === 'review' && <BankReviewTab key={'acct-rev|' + waveKey} {...props} onBack={back ? goBack : (props.onReturn || null)} backLabel={back ? labelOfSub(tabs, back.sub) : (props.returnLabel || '')} />}
      {sub === 'wavehub' && <WaveHub key={'acct-wavehub|' + waveKey} {...props} waveKey={waveKey} canWaveSync={canWaveSync} initialWaveStep={_initWaveStep} />}
      {sub === 'wavehistory' && mayViewWaveHistory && <WaveHistoryTab mayManage={historyAccess.mayManage} />}
    </div>
  );
}

// v55.83-SO — the plain name of a screen for the Back button (the tab label without its icon)
export function labelOfSub(tabs, k) {
  var hit = null;
  (tabs || []).forEach(function (t) { if (t && t[0] === k) { hit = t[1]; } });
  return hit ? String(hit).replace(/^[^A-Za-z0-9]+/, '').trim() : 'the previous screen';
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
