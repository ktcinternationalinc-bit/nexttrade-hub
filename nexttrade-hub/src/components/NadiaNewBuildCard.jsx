'use client';
// ============================================================
// NadiaNewBuildCard — v55.60.
//
// What this does:
//   When a new build deploys and the user logs in, Nadia surfaces a
//   small dashboard card with the latest build's label + first 2-3
//   highlights. User taps "✓ Got it" and the card disappears for
//   that build version. Next build → card reappears with the new
//   highlights.
//
// How it knows what's new:
//   Reads BUILD_HISTORY[0] (newest entry) from WhatsNewWidget. The
//   key `nadia_seen_build_version` in localStorage tracks which
//   version this user has already acknowledged. If it doesn't match
//   the latest version, show the card.
//
//   Key is per-user-browser (localStorage) — same user on a
//   different device sees the card again, which is intentional:
//   they may have used a different browser to see the update.
//
// Why dashboard-only:
//   Surfacing "What's new" everywhere would be annoying. The
//   dashboard is where Nadia already greets the user; this just
//   plugs into that flow.
// ============================================================
import { useState, useEffect } from 'react';
import { BUILD_HISTORY } from './WhatsNewWidget';

var STORAGE_KEY = 'nadia_seen_build_version';

export default function NadiaNewBuildCard({ isAdmin, isSuperAdmin } = {}) {
  // v55.74 — Privacy + crash fix.
  // (1) BUILD_HISTORY items can be plain string OR { text, adminOnly,
  //     superAdminOnly } objects. Rendering raw objects crashes React (#31).
  // (2) Items tagged superAdminOnly must NOT be shown to non-super-admins.
  // We filter the same way WhatsNewWidget does.
  var canSeeAdminInternals = !!(isAdmin || isSuperAdmin);
  var canSeeAiConfidential = !!isSuperAdmin;
  var [shouldShow, setShouldShow] = useState(false);
  var [latest, setLatest] = useState(null);

  useEffect(function () {
    try {
      if (!Array.isArray(BUILD_HISTORY) || BUILD_HISTORY.length === 0) return;
      var newest = BUILD_HISTORY[0];
      if (!newest || !newest.version) return;
      var seen = null;
      try { seen = window.localStorage.getItem(STORAGE_KEY); } catch (_) {}
      if (seen !== newest.version) {
        setLatest(newest);
        setShouldShow(true);
      }
    } catch (_) {
      // Don't ever block the dashboard if this fails
    }
  }, []);

  var dismiss = function () {
    try {
      if (latest && latest.version) {
        window.localStorage.setItem(STORAGE_KEY, latest.version);
      }
    } catch (_) {}
    setShouldShow(false);
  };

  if (!shouldShow || !latest) return null;

  // v55.74 — Pick top 3 items from the changelog, filtered by admin level.
  // Items tagged superAdminOnly hidden from non-super-admins. Items tagged
  // adminOnly hidden from non-admins. Plain strings always shown.
  var highlights = (latest.items || []).filter(function (it) {
    if (typeof it === 'string') return true;
    if (it && it.superAdminOnly && !canSeeAiConfidential) return false;
    if (it && it.adminOnly && !canSeeAdminInternals) return false;
    return true;
  }).slice(0, 3);

  return (
    <div style={{
      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
      borderRadius: 16,
      padding: '14px 16px',
      marginBottom: 16,
      color: 'white',
      boxShadow: '0 8px 24px rgba(139, 92, 246, 0.3)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative orb */}
      <div style={{
        position: 'absolute', top: -30, right: -30,
        width: 120, height: 120, borderRadius: '50%',
        background: 'rgba(255,255,255,0.08)',
        pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 22 }}>🤖</span>
        <div style={{ fontWeight: 800, fontSize: 14 }}>
          Hey! There's a new build — <span style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: 6, fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>{latest.version}</span>
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 10, fontWeight: 600 }}>
        {latest.label}
      </div>

      {highlights.length > 0 && (
        <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Top highlights
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, lineHeight: 1.5 }}>
            {highlights.map(function (h, i) {
              // v55.74 CRASH FIX — items can be plain string OR
              // { text, adminOnly, superAdminOnly } object since v55.73.
              // Rendering {h} directly when h is an object throws
              // React error #31 ("object with keys {superAdminOnly, text}")
              // and crashes the entire portal at startup. Extract the text safely.
              var itemText = typeof h === 'string' ? h : (h && h.text) || '';
              if (!itemText) return null;
              return (
                <li key={i} style={{ marginBottom: i < highlights.length - 1 ? 4 : 0 }}>{itemText}</li>
              );
            })}
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={dismiss}
          style={{
            background: 'rgba(255,255,255,0.95)',
            color: '#6d28d9',
            border: 'none',
            borderRadius: 8,
            padding: '6px 14px',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          }}
        >
          ✓ Got it
        </button>
      </div>
    </div>
  );
}
