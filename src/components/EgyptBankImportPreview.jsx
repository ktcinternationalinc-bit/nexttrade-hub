'use client';
// v55.83-VI — Egypt Bank → Import: the PREVIEW of the selected statement files, moved out of EgyptBankTab word for word so the
// whole path (page to a row, tick it, import) can be tested as the screen runs it. No state of its own and no data access:
// everything comes in as props and every click goes out through a callback.
import { fileResultLines, previewPage } from '../lib/egypt-bank-multi-file';

export default function EgyptBankImportPreview({ importData, fileResults, seeBankBalances, importAccount, previewPageNo, previewOnlyMarked, onPage, onOnlyMarked, onToggle, onBack, onImport }) {
            const included = importData.filter(r => r._include);
            const totalDeposits = included.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
            const totalWithdrawals = included.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
            const fileLines = fileResultLines(fileResults, importData, seeBankBalances);
            const severalFiles = fileResults.length > 1;
            const pv = previewPage(importData, previewPageNo, 200, previewOnlyMarked);
            return (
            <div>
              <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                <h3 className="font-bold text-sm">Preview — {included.length} of {importData.length} rows</h3>
                <div className="flex gap-2">
                  <button onClick={onBack} className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold">← Back</button>
                  <button onClick={onImport} disabled={!importAccount || included.length === 0} className="px-4 py-2 bg-green-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">✅ Import {included.length} rows</button>
                </div>
              </div>
              {!importAccount && <p className="text-xs text-red-500 font-semibold mb-2">⚠️ Select an account above first</p>}
              {/* v55.83-VI — one line per selected file: accepted (with its balance check) or refused (with the reason). Amounts only
                  for people who may see bank balances. A refused file adds nothing and does not stop the others. */}
              {fileResults.length > 1 && <p className="text-xs font-bold text-slate-700 mb-1">{fileResults.length} files selected — {fileLines.filter(f => f.ok).length} read, {fileLines.filter(f => !f.ok).length} not imported. Nothing is saved until you press Import.</p>}
              {fileLines.map((f, i) => <p key={i} className={'text-xs font-semibold mb-2 rounded-lg p-2 border ' + (f.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-300 text-red-900')} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{f.text}</p>)}
              {importData.length === 0 && <p className="text-xs font-bold text-red-700 mb-2">Nothing to import from this selection. Press ← Back to choose other files.</p>}
              {/* v55.83-VI (Codex 18:48) — every row of every file can be reached: pages of 200, and a switch to see only the unticked copies */}
              {(pv.pages > 1 || pv.marked > 0) && <div className="flex items-center gap-2 flex-wrap mb-2 text-[11px] text-slate-700">
                <span className="font-semibold">Rows {pv.from}–{pv.to} of {pv.total}{previewOnlyMarked ? ' unticked copies' : ''} · page {pv.page + 1} of {pv.pages}</span>
                <button disabled={pv.page === 0} onClick={() => onPage(pv.page - 1)} className="px-2 py-1 rounded border border-slate-300 font-bold disabled:opacity-40">← Previous</button>
                <button disabled={pv.page >= pv.pages - 1} onClick={() => onPage(pv.page + 1)} className="px-2 py-1 rounded border border-slate-300 font-bold disabled:opacity-40">Next →</button>
                {pv.marked > 0 && <button onClick={() => onOnlyMarked(!previewOnlyMarked)} className={'px-2 py-1 rounded border font-bold ' + (previewOnlyMarked ? 'bg-amber-200 border-amber-400 text-amber-900' : 'border-amber-300 text-amber-900')}>{previewOnlyMarked ? 'Show all rows' : 'Show only the ' + pv.marked + ' row' + (pv.marked === 1 ? ' marked as a copy' : 's marked as copies')}</button>}
                <span className="text-slate-500">Ticks are kept when you change page; every ticked row is imported.</span>
              </div>}
              {/* Summary */}
              {seeBankBalances && <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-green-50 rounded-lg p-2 border border-green-200 text-center">
                  <div className="text-[9px] text-green-600 font-bold">Deposits</div>
                  <div className="text-sm font-black text-green-700">+{totalDeposits.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                  <div className="text-[9px] text-green-500">{included.filter(r => r.amount > 0).length} transactions</div>
                </div>
                <div className="bg-red-50 rounded-lg p-2 border border-red-200 text-center">
                  <div className="text-[9px] text-red-600 font-bold">Withdrawals</div>
                  <div className="text-sm font-black text-red-700">-{totalWithdrawals.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                  <div className="text-[9px] text-red-500">{included.filter(r => r.amount < 0).length} transactions</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-2 border border-blue-200 text-center">
                  <div className="text-[9px] text-blue-600 font-bold">Net</div>
                  <div className={'text-sm font-black ' + ((totalDeposits - totalWithdrawals) >= 0 ? 'text-blue-700' : 'text-red-700')}>{(totalDeposits - totalWithdrawals).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                </div>
              </div>}
              <div className="overflow-auto max-h-[500px] bg-white rounded-xl border">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-2 py-2 text-left">✓</th>
                      <th className="px-2 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-right text-green-600">Deposit</th>
                      <th className="px-2 py-2 text-right text-red-600">Withdrawal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pv.items.map(({ row: r, index: i }) => (
                      <tr key={i} className={r._include ? '' : 'opacity-30'}>
                        <td className="px-2 py-1.5"><input type="checkbox" checked={!!r._include} onChange={() => onToggle(i)} /></td>
                        <td className="px-2 py-1.5">{r.date}</td>
                        <td className="px-2 py-1.5" style={{ wordBreak: 'break-word' }}>{r.description}
                          {severalFiles && <div className="text-[10px] text-slate-500">📄 {r._file}</div>}
                          {r._crossDup && <div className="text-[10px] font-bold text-amber-800">{r._crossDup === 'exact' ? 'Same line as in ' : 'Same date and amount as a line in '}{r._crossDupFile || 'another selected file'}{r._include ? ' — you ticked it, so it WILL be imported' : ' — unticked' + (r._crossDup === 'exact' ? '' : '; tick it only if it is a different payment')}</div>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold text-green-600">{r.amount > 0 ? '+' + r.amount.toLocaleString(undefined, {minimumFractionDigits:2}) : ''}</td>
                        <td className="px-2 py-1.5 text-right font-bold text-red-600">{r.amount < 0 ? Math.abs(r.amount).toLocaleString(undefined, {minimumFractionDigits:2}) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            );
}
