'use client';
// ============================================================
// ToastContext — shared toast/confirm UI context.
// ============================================================
// v55.25 — Lives in its own file to avoid circular imports.
// Multiple components (CalendarTab, AdminTab, etc) need to consume
// the toast context. Originally page.jsx held the context with no
// export, so child components silently fell back to `if (toast)`
// guards that always evaluated to false. The user got NO feedback
// for permission denials, validation errors, or successes —
// exactly the "I click cancel and nothing happens" bug.
//
// Provider is set up in src/app/page.jsx around the App tree.
// Consumers do:
//   import { ToastContext } from '../lib/toast-context';
//   const toast = useContext(ToastContext);
//   if (toast) toast.success('Saved');
//
// Toast may be null if a component renders outside the provider
// (e.g. test scaffolding). Always guard with `if (toast)`.
// ============================================================

import React from 'react';

export const ToastContext = React.createContext(null);
