// ============================================================
// MorningBriefing.jsx — Phase 2 / S13 (Apr 22 2026)
//
// Visual card that appears at the top of Nadia's chat when you log in
// for the first time today. Shows the top 3 things needing your
// attention, each with a one-tap action button.
//
// Props:
//   briefing: { top3, headline, deferred_count, all_clear }
//   onAction: (item) => void  — fires when user taps an action button
//   useLang: 'en' | 'ar'
// ============================================================
'use client';
import React, { useState } from 'react';

var URGENCY_STYLES = {
  critical: { border: '#dc2626', bg: 'rgba(220, 38, 38, 0.12)', label: 'CRITICAL', labelAr: 'حرج', icon: '🔴' },
  high:     { border: '#ea580c', bg: 'rgba(234, 88, 12, 0.10)', label: 'HIGH', labelAr: 'مهم', icon: '🟠' },
  medium:   { border: '#ca8a04', bg: 'rgba(202, 138, 4, 0.10)', label: 'MEDIUM', labelAr: 'متوسط', icon: '🟡' },
};

export default function MorningBriefing({ briefing, onAction, useLang }) {
  var [dismissed, setDismissed] = useState({});

  if (!briefing) return null;

  var lang = useLang || 'en';
  var top3 = briefing.top3 || [];
  var visibleItems = top3.filter(function(it, idx) { return !dismissed[idx]; });

  // ALL CLEAR state — small celebratory card
  if (briefing.all_clear || (visibleItems.length === 0 && top3.length === 0)) {
    return (
      <div style={{
        margin: '8px 12px 12px 12px',
        padding: '14px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
        border: '1px solid #10b981',
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#065f46' }}>
          ✅ {lang === 'ar' ? 'كل شيء على ما يرام — لا توجد مهام عاجلة اليوم.' : 'All clear — nothing urgent today.'}
        </div>
        <div style={{ fontSize: 11, color: '#047857', marginTop: 4 }}>
          {lang === 'ar' ? 'استمتع بصباحك. سأخبرك إذا ظهر شيء.' : 'Enjoy your morning. I\'ll let you know if anything pops up.'}
        </div>
      </div>
    );
  }

  if (visibleItems.length === 0) return null; // user dismissed everything

  var headline = briefing.headline || (visibleItems.length + (lang === 'ar' ? ' أمور تحتاج اهتمامك' : ' things need your attention'));

  return (
    <div style={{ margin: '6px 12px 10px 12px' }}>
      {/* Headline */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 2px 8px 2px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#cbd5e1', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          ☀️ {lang === 'ar' ? 'موجز الصباح' : 'Morning Briefing'}
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{headline}</div>
      </div>

      {/* Priority cards */}
      {visibleItems.map(function(item, idx) {
        var style = URGENCY_STYLES[item.urgency] || URGENCY_STYLES.medium;
        return (
          <div key={idx} style={{
            marginBottom: 8,
            borderRadius: 10,
            background: style.bg,
            border: '1px solid ' + style.border,
            borderLeft: '4px solid ' + style.border,
            overflow: 'hidden',
          }}>
            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 14, lineHeight: 1, marginTop: 2 }}>{style.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'inline-block',
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.05em',
                  color: '#fff', background: style.border,
                  padding: '1px 6px', borderRadius: 3, marginBottom: 4,
                }}>
                  {lang === 'ar' ? style.labelAr : style.label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.3 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 3, lineHeight: 1.4 }}>
                  {item.why}
                </div>
              </div>
              {/* Dismiss X */}
              <button
                onClick={function() { setDismissed(function(d) { var c = Object.assign({}, d); c[idx] = true; return c; }); }}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, padding: 2 }}
                title={lang === 'ar' ? 'إخفاء' : 'Dismiss'}>
                ✕
              </button>
            </div>

            {/* Action row */}
            <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px 12px' }}>
              <button
                onClick={function() { if (onAction) onAction(item); }}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: style.border,
                  color: '#fff',
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}>
                {item.action_label || (lang === 'ar' ? 'افتح' : 'Open')}
              </button>
              <button
                onClick={function() { setDismissed(function(d) { var c = Object.assign({}, d); c[idx] = true; return c; }); }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'transparent',
                  color: '#94a3b8',
                  border: '1px solid #475569',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}>
                {lang === 'ar' ? 'لاحقاً' : 'Snooze'}
              </button>
            </div>
          </div>
        );
      })}

      {/* Footer — "X more stacked behind" */}
      {briefing.deferred_count > 0 && (
        <div style={{
          fontSize: 10, color: '#64748b', textAlign: 'center', padding: '4px',
          fontStyle: 'italic',
        }}>
          {lang === 'ar'
            ? '+ ' + briefing.deferred_count + ' أمور أخرى في الانتظار'
            : '+ ' + briefing.deferred_count + ' more items waiting (less urgent)'}
        </div>
      )}
    </div>
  );
}
