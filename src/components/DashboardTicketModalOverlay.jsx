// v55.83-A.6.18 (Max May 14 2026) — Render the full ticket editor in a modal
// overlay ON the dashboard so the user never leaves the dashboard.
//
// Per Max May 14 2026: "prefer b. otherwise it will take you back to dashboard
// and like you are starting over". The existing pattern was setTab('tickets')
// + setOpenTicketId, then return-to-dashboard on modal close. That works but
// visibly flickers the tab and resets scroll position. This overlay mounts
// <TicketsTab> directly above the dashboard so the dashboard stays mounted
// underneath, unchanged.
//
// Implementation: a fixed-position overlay (z-50) with a backdrop. Inside,
// <TicketsTab> is mounted with `openTicketId` pre-set so it lands directly
// in the ticket detail view. When the user clicks Back inside TicketsTab,
// onTicketModalClosed fires and we close the overlay.
//
// Caveats:
//   • TicketsTab is mounted ONLY while overlay is open, so no double-mount.
//   • Closing fires both the user's onClose AND TicketsTab's own state reset.

import TicketsTab from './TicketsTab';

export default function DashboardTicketModalOverlay({
  ticketId,
  onClose,
  // pass-through props to TicketsTab
  toast,
  customers,
  user,
  userProfile,
  users,
  onReload,
  lang,
  isAdmin,
  modulePerms,
}) {
  if (!ticketId) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-2 sm:p-4"
      onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl my-4 relative"
        onClick={function (e) { e.stopPropagation(); }}>

        {/* Close button — top right corner, always visible */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-lg font-bold flex items-center justify-center shadow"
          title="Close / إغلاق">
          ×
        </button>

        <div className="p-3 sm:p-4">
          <TicketsTab
            toast={toast}
            customers={customers}
            user={user}
            userProfile={userProfile}
            users={users}
            onReload={onReload}
            lang={lang}
            isAdmin={isAdmin}
            modulePerms={modulePerms}
            openTicketId={ticketId}
            onOpenTicketHandled={function () { /* one-shot, no-op */ }}
            onTicketModalClosed={onClose}
          />
        </div>
      </div>
    </div>
  );
}
