// Shared accounting-silo banner. Uses INLINE styles (not Tailwind color classes)
// so the dark background + white text always render — Tailwind purge / dark-theme
// overrides were turning the old amber-100 version into unreadable brown-on-brown.
import React from 'react';

export default function SiloBanner(props) {
  var registered = props.registered;        // boolean: business is in the registry
  var isTest = props.isTest;                // boolean
  var canWrite = props.canWrite;            // boolean
  var label = props.label || 'No business selected';

  // Palettes — dark bg, bright border, white text in every case.
  var palette;
  if (!registered) {
    palette = { bg: '#7f1d1d', border: '#f87171', badgeBg: '#dc2626' };        // dark red
  } else if (isTest) {
    palette = { bg: '#134e4a', border: '#2dd4bf', badgeBg: '#0d9488' };        // dark teal
  } else {
    palette = { bg: '#1e293b', border: '#f59e0b', badgeBg: '#b91c1c' };        // dark slate (production)
  }

  return (
    <div style={{
      marginBottom: 12, borderRadius: 10, border: '2px solid ' + palette.border,
      background: palette.bg, padding: '12px 16px', display: 'flex',
      flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12
    }}>
      <div style={{ color: '#ffffff' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>Current Accounting Silo</div>
        <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.15, color: '#ffffff' }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: 'rgba(255,255,255,0.92)' }}>
          {registered
            ? 'Bank data, customers & invoices scoped to this silo only.'
            : 'NOT registered — scoping is OFF and ALL businesses\u2019 data is shown. Register it in Wave Import to silo it.'}
        </div>
      </div>
      {registered && (
        <div style={{
          background: palette.badgeBg, color: '#ffffff', fontWeight: 800, fontSize: 14,
          padding: '6px 12px', borderRadius: 8, whiteSpace: 'nowrap'
        }}>
          {(isTest ? 'TEST' : 'PRODUCTION') + ' \u00b7 ' + (canWrite ? 'READ-WRITE' : 'READ-ONLY')}
        </div>
      )}
    </div>
  );
}
