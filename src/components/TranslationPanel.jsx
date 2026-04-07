'use client';
import { useState, useEffect } from 'react';
import { supabase, dbUpdate } from '../lib/supabase';

const TRANSLATE_TABLES = [
  { table: 'treasury', label: 'Treasury / الخزنة', arCol: 'description', enCol: 'description_en', icon: '🏦' },
  { table: 'warehouse_expenses', label: 'Warehouse / المخزن', arCol: 'description', enCol: 'description_en', icon: '🏭' },
  { table: 'invoices', label: 'Invoices (Customer Names)', arCol: 'customer_name', enCol: 'customer_name_en', icon: '💰' },
  { table: 'checks', label: 'Checks (Customer Names)', arCol: 'customer_name', enCol: 'customer_name_en', icon: '📝' },
  { table: 'debts', label: 'Debts (Customer Names)', arCol: 'customer_name', enCol: 'customer_name_en', icon: '⚠️' },
  { table: 'invoice_items', label: 'Invoice Items', arCol: 'description', enCol: 'description_en', icon: '📦' },
  { table: 'customers', label: 'Customers', arCol: 'name', enCol: 'name_en', icon: '👥' },
  { table: 'inventory', label: 'Inventory / المخزون', arCol: 'description', enCol: 'description_en', icon: '📦' },
];

export default function TranslationPanel({ user, users, isAdmin }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [translating, setTranslating] = useState(null); // which table is being translated
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [log, setLog] = useState([]);

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_stats' }),
      });
      const data = await res.json();
      setStats(data.stats || {});
    } catch (err) {
      console.error('Load stats error:', err);
    }
    setLoading(false);
  };

  const translateTable = async (tableConfig) => {
    setTranslating(tableConfig.table);
    setProgress({ done: 0, total: 0 });
    setLog(prev => [...prev, `Starting ${tableConfig.label}...`]);

    let totalDone = 0;
    let batchNum = 0;

    try {
      while (true) {
        batchNum++;
        // 1. Fetch untranslated records
        const fetchRes = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'fetch_untranslated',
            table: tableConfig.table,
            arCol: tableConfig.arCol,
            enCol: tableConfig.enCol,
            limit: 100,
          }),
        });
        const fetchData = await fetchRes.json();
        const records = fetchData.records || [];

        if (records.length === 0) {
          setLog(prev => [...prev, `✅ ${tableConfig.label} — Complete! ${totalDone} translated.`]);
          break;
        }

        setProgress({ done: totalDone, total: totalDone + records.length });

        // 2. Send for translation
        const transRes = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batch_translate',
            texts: records,
            table: tableConfig.table,
            column: tableConfig.arCol,
          }),
        });
        const transData = await transRes.json();

        totalDone += transData.updated || 0;
        setProgress({ done: totalDone, total: totalDone });
        setLog(prev => [...prev, `Batch ${batchNum}: ${transData.updated || 0} updated (${transData.cached || 0} from cache, ${transData.translated || 0} new)`]);

        // Safety: if we've done 20 batches, stop (2000 records)
        if (batchNum >= 20) {
          setLog(prev => [...prev, `⏸️ Paused after 20 batches. Run again to continue.`]);
          break;
        }
      }
    } catch (err) {
      setLog(prev => [...prev, `❌ Error: ${err.message}`]);
    }

    setTranslating(null);
    await loadStats();
  };

  const translateAll = async () => {
    for (const tc of TRANSLATE_TABLES) {
      await translateTable(tc);
    }
    setLog(prev => [...prev, '🎉 All tables translated!']);
  };

  const updateLanguageAccess = async (userId, access) => {
    try {
      await dbUpdate('users', userId, { language_access: access }, user?.id);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  if (loading) return <div className="text-center py-6 text-slate-400">Loading translation stats...</div>;

  const totalRecords = TRANSLATE_TABLES.reduce((a, t) => a + (stats?.[t.table]?.total || 0), 0);
  const totalTranslated = TRANSLATE_TABLES.reduce((a, t) => a + (stats?.[t.table]?.translated || 0), 0);
  const overallPct = totalRecords > 0 ? Math.round((totalTranslated / totalRecords) * 100) : 0;

  return (
    <div>
      {/* Overall Progress */}
      <div className="bg-white rounded-xl p-5 mb-4 border border-slate-200">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className="text-sm font-bold">Translation Progress / تقدم الترجمة</h3>
            <p className="text-[10px] text-slate-400">
              {totalTranslated.toLocaleString()} / {totalRecords.toLocaleString()} records translated
              {stats?._cache && ` • ${stats._cache.total.toLocaleString()} cached translations`}
            </p>
          </div>
          <div className="text-2xl font-extrabold" style={{ color: overallPct >= 90 ? '#10b981' : overallPct >= 50 ? '#f59e0b' : '#ef4444' }}>
            {overallPct}%
          </div>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-3">
          <div className="h-3 rounded-full transition-all" style={{
            width: overallPct + '%',
            background: overallPct >= 90 ? '#10b981' : overallPct >= 50 ? '#f59e0b' : '#ef4444',
          }}></div>
        </div>
      </div>

      {/* Per-Table Progress */}
      <div className="bg-white rounded-xl p-4 mb-4 border border-slate-200">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-bold">Tables / الجداول</h3>
          <button onClick={translateAll} disabled={!!translating}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg text-xs font-semibold hover:bg-blue-600 disabled:opacity-50">
            {translating ? '⏳ Translating...' : '🌐 Translate All / ترجم الكل'}
          </button>
        </div>
        <div className="space-y-2">
          {TRANSLATE_TABLES.map(tc => {
            const s = stats?.[tc.table] || { total: 0, translated: 0 };
            const pct = s.total > 0 ? Math.round((s.translated / s.total) * 100) : 0;
            const remaining = s.total - s.translated;
            const isActive = translating === tc.table;

            return (
              <div key={tc.table} className={'rounded-lg p-3 border transition ' + (isActive ? 'border-blue-300 bg-blue-50' : 'border-slate-100')}>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span>{tc.icon}</span>
                    <div>
                      <div className="text-xs font-semibold">{tc.label}</div>
                      <div className="text-[10px] text-slate-400">
                        {s.translated.toLocaleString()} / {s.total.toLocaleString()}
                        {remaining > 0 && <span className="text-amber-500 ml-1">({remaining} remaining)</span>}
                        {s.error && <span className="text-red-500 ml-1">(column may not exist yet)</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold" style={{ color: pct >= 90 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>{pct}%</span>
                    {remaining > 0 && !translating && (
                      <button onClick={() => translateTable(tc)}
                        className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold hover:bg-blue-600">
                        Translate
                      </button>
                    )}
                    {isActive && <span className="text-blue-500 text-xs animate-pulse">Working...</span>}
                    {pct === 100 && <span className="text-emerald-500 text-xs">✓ Done</span>}
                  </div>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                  <div className="h-1.5 rounded-full transition-all" style={{
                    width: pct + '%',
                    background: pct >= 90 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444',
                  }}></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress during translation */}
      {translating && progress.total > 0 && (
        <div className="bg-blue-50 rounded-xl p-4 mb-4 border border-blue-200">
          <div className="text-xs font-bold text-blue-800 mb-1">Translating: {translating}</div>
          <div className="text-[10px] text-blue-600">{progress.done} records done</div>
          <div className="w-full bg-blue-200 rounded-full h-2 mt-1">
            <div className="bg-blue-500 h-2 rounded-full transition-all animate-pulse" style={{ width: '100%' }}></div>
          </div>
        </div>
      )}

      {/* Language Access Control */}
      {isAdmin && users && users.length > 0 && (
        <div className="bg-white rounded-xl p-4 mb-4 border border-slate-200">
          <h3 className="text-sm font-bold mb-2">Language Access / صلاحيات اللغة</h3>
          <p className="text-[10px] text-slate-400 mb-3">Control which users can see the English toggle. Super Admin always has access.</p>
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex justify-between items-center py-2 border-b border-slate-50">
                <div>
                  <div className="text-xs font-semibold">{u.name}</div>
                  <div className="text-[10px] text-slate-400">{u.role}</div>
                </div>
                <select
                  value={u.language_access || 'ar'}
                  onChange={e => updateLanguageAccess(u.id, e.target.value)}
                  disabled={u.role === 'super_admin'}
                  className="px-2 py-1 rounded border border-slate-200 text-xs">
                  <option value="ar">Arabic Only / عربي فقط</option>
                  <option value="en">English Only / إنجليزي فقط</option>
                  <option value="both">Can Toggle / يمكن التبديل</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Log */}
      {log.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-slate-200">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-bold">Translation Log</h3>
            <button onClick={() => setLog([])} className="text-[10px] text-slate-400 hover:text-slate-600">Clear</button>
          </div>
          <div className="max-h-[200px] overflow-auto bg-slate-50 rounded-lg p-3">
            {log.map((entry, i) => (
              <div key={i} className="text-[10px] text-slate-600 py-0.5 border-b border-slate-100">{entry}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
