// ReportTable.jsx — generic, bilingual (EN/AR), RTL-aware table renderer driven by a column
// definition array (see inventory-report-defs.js). Pure presentation: it formats cells, hides
// valuation columns as "Restricted" when not permitted, and computes column totals. Reused by
// any report so individual reports never hand-build a <table>.

function fmtNumber(v, decimals) {
  var n = Number(v);
  if (!isFinite(n)) { return ''; }
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCell(value, col, lang, showValuation) {
  if (col.valuation && !showValuation) { return lang === 'ar' ? 'مقيّد' : 'Restricted'; }
  if (value === null || value === undefined || value === '') { return ''; }
  if (col.format === 'number') { return fmtNumber(value, 2); }
  if (col.format === 'money') { return fmtNumber(value, 2); }
  if (col.format === 'percent') {
    var p = Number(value);
    return isFinite(p) ? (p.toFixed(1) + '%') : '';
  }
  return String(value);
}

export default function ReportTable(props) {
  var columns = props.columns || [];
  var rows = props.rows || [];
  var lang = props.lang === 'ar' ? 'ar' : 'en';
  var showValuation = props.showValuation === true;
  var isRtl = lang === 'ar';

  // Column totals (only for total:'sum' numeric columns, and only when valuation is allowed
  // for valuation columns — otherwise a total would leak the restricted figure).
  var totals = {};
  columns.forEach(function (c) {
    if (c.total === 'sum' && !(c.valuation && !showValuation)) {
      var s = 0, any = false;
      rows.forEach(function (r) { var n = Number(r[c.key]); if (isFinite(n)) { s += n; any = true; } });
      if (any) { totals[c.key] = s; }
    }
  });
  var hasTotals = Object.keys(totals).length > 0;

  function alignClass(a) { return a === 'right' ? 'text-right' : (a === 'center' ? 'text-center' : 'text-left'); }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="overflow-x-auto border border-slate-200 rounded">
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="bg-slate-100 text-slate-700">
            {columns.map(function (c) {
              return <th key={c.key} className={'px-2 py-1.5 font-bold border-b border-slate-300 ' + alignClass(c.align)}>{isRtl ? c.label_ar : c.label_en}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-2 py-4 text-center text-slate-400 italic">{isRtl ? 'لا توجد بيانات' : 'No data'}</td></tr>
          ) : rows.map(function (r, ri) {
            return (
              <tr key={ri} className={ri % 2 ? 'bg-white' : 'bg-slate-50'}>
                {columns.map(function (c) {
                  return <td key={c.key} className={'px-2 py-1 border-b border-slate-100 ' + alignClass(c.align)}>{formatCell(r[c.key], c, lang, showValuation)}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr className="bg-slate-200 font-bold text-slate-900">
              {columns.map(function (c, ci) {
                if (totals[c.key] !== undefined) { return <td key={c.key} className={'px-2 py-1.5 ' + alignClass(c.align)}>{fmtNumber(totals[c.key], 2)}</td>; }
                return <td key={c.key} className={'px-2 py-1.5 ' + alignClass(c.align)}>{ci === 0 ? (isRtl ? 'الإجمالي' : 'Total') : ''}</td>;
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
