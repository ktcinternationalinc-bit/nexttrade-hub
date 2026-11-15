// v55.83-HQ — Shared "restricted / locked / permission" notice.
// Uses INLINE styles (not Tailwind amber-100/amber-950 classes) on purpose: those classes
// were getting purged / overridden by the dark theme and rendered as unreadable dark-on-dark
// (brown-on-brown). Same lesson as SiloBanner. Inline styles always render, so the contrast
// is guaranteed: dark slate background, bright gold border, BRIGHT text.
import React from 'react';

export default function RestrictedNotice(props) {
  var title = props.title || 'Restricted';
  var message = props.message || '';
  // v55.83-HR — no emoji default (it rendered as mojibake in some encodings per Codex). Callers
  // may pass an icon explicitly; otherwise we show a clean ASCII lock cue in the title.
  var icon = props.icon || '[LOCKED]';
  // tone: 'amber' (default, permission/lock) | 'red' (blocked/error)
  var red = props.tone === 'red';
  var border = red ? '#f87171' : '#fbbf24';     // bright red / bright gold
  var titleColor = red ? '#fecaca' : '#fde68a';  // light red / light amber
  return (
    <div style={{
      borderRadius: 10, border: '2px solid ' + border, background: '#1e293b',
      padding: '16px 18px', margin: props.bare ? 0 : '4px 0'
    }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: titleColor }}>{icon} {title}</div>
      {message ? <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', marginTop: 4 }}>{message}</div> : null}
    </div>
  );
}
