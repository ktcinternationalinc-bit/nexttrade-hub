'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { supabase, dbInsert, dbUpdate, dbDelete, logActivity } from '../lib/supabase';
import { notifyTicketAssigned, notifyTicketStatus, notifyTicketComment, notifyTicketReassigned, notifyTicketPriority, notifyTicketDueDate, ticketRecipients } from '../lib/notify';
import { sanitizeRichText, isHtmlComment, richTextToPlain } from '../lib/utils';
import RichCommentComposer from './RichCommentComposer';
import PriorityBoard from './PriorityBoard';

const STATUSES = ['New','Acknowledged','In Progress','Blocked','On Hold','Review','Closed','Reopened'];
// S16 — Distinct priority colors that don't collide with due-today orange.
// High   → crimson   #dc2626  (critical importance)
// Medium → yellow    #eab308  (warning)
// Low    → emerald   #10b981  (normal/no concern)
const PRIORITIES = [{v:'high',l:'High / عالي',c:'#dc2626'},{v:'medium',l:'Medium / متوسط',c:'#eab308'},{v:'low',l:'Low / منخفض',c:'#10b981'}];
// S17 — STATUS_COLORS used for summary cards and top-level indicators.
// Closed switched from green (#10b981) to dark slate (#1e293b) so it reads
// as archive-like, distinct from Acknowledged (purple) and Resolved (green).
const STATUS_COLORS = {New:'#3b82f6',Acknowledged:'#8b5cf6','In Progress':'#eab308',Blocked:'#ef4444','On Hold':'#f97316',Review:'#06b6d4',Closed:'#1e293b',Reopened:'#eab308'};
const STATUS_DESC = {New:'Just created — nobody has looked at it yet',Acknowledged:'Assigned person has seen and accepted it','In Progress':'Actively being worked on',Blocked:'Cannot proceed — waiting on something external',
  'On Hold':'Paused intentionally — not urgent right now',Review:'Work done — needs someone to check/approve',Closed:'Complete — no more action needed',Reopened:'Was closed but needs more work'};
const USER_COLORS = ['#8b5cf6','#0ea5e9','#f59e0b','#10b981','#ec4899','#ef4444','#6366f1','#14b8a6','#f97316','#06b6d4','#a855f7','#84cc16'];

export default function TicketsTab({ toast, customers, user, userProfile, users, onReload, lang, isAdmin, modulePerms, openTicketId, onOpenTicketHandled }) {
  const myId = userProfile?.id || user?.id;
  const canManage = isAdmin || userProfile?.role === 'super_admin' || userProfile?.role === 'admin';
  const isSuperAdmin = userProfile?.role === 'super_admin';
  const isAdminRole = userProfile?.role === 'admin' || userProfile?.role === 'super_admin';
  const hasDeletePerm = modulePerms?.['Delete Tickets'] === true;

  // Multi-assign helpers
  const parseAssignees = (t) => {
    const list = [t.assigned_to].filter(Boolean);
    try { const extra = JSON.parse(t.additional_assignees || '[]'); if (Array.isArray(extra)) extra.forEach(id => { if (id && !list.includes(id)) list.push(id); }); } catch(e) { console.warn(e); }
    return list;
  };
  const isAssignedToMe = (t) => parseAssignees(t).includes(myId);
  const allAssigneeNames = (t) => parseAssignees(t).map(id => getUserName(id)).filter(Boolean);
  const [uploading, setUploading] = useState(false);

  const canDeleteTicket = (ticket) => {
    if (!ticket) return false;
    if (isSuperAdmin) return true; // super admin: delete anything
    const isOwner = ticket.created_by === myId;
    const ageMs = Date.now() - new Date(ticket.created_at).getTime();
    const within3Days = ageMs < 3 * 24 * 60 * 60 * 1000;
    if (isOwner && within3Days) return true; // owner: within 3 days
    if ((isAdminRole || hasDeletePerm) && !isOwner) return true; // admin/perm: others' tickets anytime
    if ((isAdminRole || hasDeletePerm) && isOwner && within3Days) return true; // admin/perm: own tickets within 3 days
    return false;
  };
  // Stable color per user
  const userColorMap = useMemo(() => {
    const map = {};
    (users || []).forEach((u, i) => { map[u.id] = USER_COLORS[i % USER_COLORS.length]; });
    return map;
  }, [users]);
  const [tickets, setTickets] = useState([]);
  const [comments, setComments] = useState([]);
  // v55.44 — guard against double-submit when Max taps Send 2-3 times in a row.
  // Set true on entry to addComment, released in finally. Passed to the
  // composer so the Send button disables visually too.
  const [submittingComment, setSubmittingComment] = useState(false);
  // v55.57 — creating + closing state to prevent double-submit on Create
  // Ticket and Close-with-Comment buttons. Reported by Max May 6 2026:
  // "entering tickets sometimes are duplicated when I send" — a quick
  // double-tap on the Create button created two tickets with sequential
  // numbers (TKT-0042 + TKT-0043) for the same submission. Same risk on
  // the close-with-comment button.
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [closingTicket, setClosingTicket] = useState(false);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState(() => isAdmin ? 'all' : 'open');
  const [ownerF, setOwnerF] = useState('all');
  const [assignedF, setAssignedF] = useState('all');
  const [priorityF, setPriorityF] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({});
  const [sortBy, setSortBy] = useState('date');
  const [loaded, setLoaded] = useState(false);
  const [listening, setListening] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  // S21 (Apr 23 2026) — view toggle for Priority Board vs List
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'board'
  // R7: inline edit of title/description. editingField = 'title' | 'description' | null
  const [editingField, setEditingField] = useState(null);
  const [editBuf, setEditBuf] = useState({ title: '', description: '' });
  // S17 — Close-with-comment modal state. Opens when user chooses to close
  // a ticket. User MUST type a closing comment to proceed. Optional link
  // field for attaching a related URL (e.g., PR / doc / external ticket).
  const [closeModal, setCloseModal] = useState(null); // { ticket, comment: '', link: '' } or null

  const todayStr = new Date().toISOString().substring(0, 10);
  const getUserName = (id) => (users || []).find(u => u.id === id)?.name || '';
  // v55.52 — Active users only, for assignee dropdowns. We keep `users` as
  // the full list so historical assignments still resolve to a name even
  // for terminated/deactivated teammates. `activeUsers` is what shows up in
  // every "pick a person" UI so deactivated users disappear from selection.
  const activeUsers = (users || []).filter(u => u && u.active !== false);
  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '';

  const startVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { alert('Voice not supported'); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = false;
    setListening(true);
    recognition.onresult = (event) => { const text = event.results[0][0].transcript; setListening(false); let priority = 'medium'; if (/urgent|high|asap/i.test(text)) priority = 'high'; if (/\blow\b/i.test(text)) priority = 'low'; let assignTo = ''; (users || []).forEach(u => { if (text.toLowerCase().includes((u.name || '').toLowerCase())) assignTo = u.id; }); let dueDate = ''; if (/today/i.test(text)) dueDate = todayStr; if (/tomorrow/i.test(text)) { const d = new Date(); d.setDate(d.getDate() + 1); dueDate = d.toISOString().substring(0, 10); } setF({ title: text, priority, assignedTo: assignTo, dueDate }); setShowAdd(true); };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const loadTickets = async () => { const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false }); setTickets(data || []); setLoaded(true); };
  const loadComments = async (ticketId) => { const { data } = await supabase.from('ticket_comments').select('*').eq('ticket_id', ticketId).order('created_at'); setComments(data || []); };
  if (!loaded) loadTickets();

  // Auto-open ticket from dashboard click
  useEffect(() => {
    if (openTicketId && tickets.length > 0) {
      const t = tickets.find(x => x.id === openTicketId);
      if (t) { setSel(t); loadComments(t.id); setStatusF('all'); }
      if (onOpenTicketHandled) onOpenTicketHandled();
    }
  }, [openTicketId, tickets]);

  const filtered = useMemo(() => {
    let arr = tickets;
    if (statusF === 'open') arr = arr.filter(t => t.status !== 'Closed');
    else if (statusF === 'mine') arr = arr.filter(t => isAssignedToMe(t) && t.status !== 'Closed');
    else if (statusF === 'team') arr = arr.filter(t => t.status !== 'Closed' && (t.assigned_to || t.additional_assignees) && !isAssignedToMe(t));
    else if (statusF === 'created') arr = arr.filter(t => t.created_by === myId && t.status !== 'Closed');
    else if (statusF === 'overdue') arr = arr.filter(t => t.due_date && t.due_date < todayStr && t.status !== 'Closed');
    else if (statusF !== 'all') arr = arr.filter(t => t.status === statusF);
    if (q) arr = arr.filter(t => {
      const ql = q.toLowerCase();
      return (t.title||'').toLowerCase().includes(ql) || (t.description||'').toLowerCase().includes(ql) || (t.order_number||'').toLowerCase().includes(ql) || (t.ticket_number||'').toLowerCase().includes(ql) || (t.client_name||'').toLowerCase().includes(ql) || (getUserName(t.assigned_to)||'').toLowerCase().includes(ql) || (getUserName(t.created_by)||'').toLowerCase().includes(ql);
    });
    if (ownerF !== 'all') arr = arr.filter(t => t.created_by === ownerF);
    if (assignedF !== 'all') arr = arr.filter(t => assignedF === 'unassigned' ? !t.assigned_to : t.assigned_to === assignedF);
    if (priorityF !== 'all') arr = arr.filter(t => t.priority === priorityF);
    // Sort
    const priOrder = { high: 0, medium: 1, low: 2 };
    if (sortBy === 'priority') arr = [...arr].sort((a, b) => (priOrder[a.priority] ?? 1) - (priOrder[b.priority] ?? 1));
    else if (sortBy === 'owner') arr = [...arr].sort((a, b) => (getUserName(a.assigned_to) || 'zzz').localeCompare(getUserName(b.assigned_to) || 'zzz'));
    else if (sortBy === 'due') arr = [...arr].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    else arr = [...arr].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return arr;
  }, [tickets, statusF, q, user, sortBy, ownerF, assignedF, priorityF]);

  const handleAddTicket = async () => {
    if (!f.title) return;
    // v55.57 — Double-submit guard. Without this, a quick double-tap on
    // Create created two tickets with sequential ticket numbers because
    // both clicks ran past the count-query and inserted before either
    // had finished. Now: first click flips creatingTicket true and the
    // button disables; the second click bails out at this top guard.
    if (creatingTicket) return;
    setCreatingTicket(true);
    try {
      // Auto-generate ticket number
      const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true });
      const ticketNum = 'TKT-' + String((count || 0) + 1).padStart(4, '0');
      const assignedName = getUserName(f.assignedTo);
      const creatorName = getUserName(myId);
      const extraAssignees = (f.extraAssignees || []).filter(id => id !== f.assignedTo);
      await dbInsert('tickets', { ticket_number: ticketNum, title: f.title, description: f.description || '', priority: f.priority || 'medium', order_number: f.orderNumber || '', due_date: f.dueDate || null, customer_id: f.customerId || null, client_name: f.clientName || '', status: 'New', assigned_to: f.assignedTo || null, additional_assignees: extraAssignees.length ? JSON.stringify(extraAssignees) : null, created_by: myId || null }, myId || null);
      await logActivity(myId, 'Created ' + ticketNum + ': ' + f.title + (assignedName ? ' → ' + assignedName : ''), 'ticket');
      const allToNotify = [f.assignedTo, ...extraAssignees].filter(id => id && id !== myId);
      if (allToNotify.length) notifyTicketAssigned(allToNotify, ticketNum + ' ' + f.title, myId);
      setShowAdd(false); setF({}); loadTickets();
    } catch (err) {
      toast ? toast.error(err.message) : alert(err.message);
    } finally {
      setCreatingTicket(false);
    }
  };

  const updateStatus = async (ticket, newStatus) => {
    // S17 — Closing a ticket now requires a closing comment. Intercept and
    // open the close modal instead of performing the update immediately.
    // The modal's submit handler calls finalizeClose which writes the comment
    // (and optional link) BEFORE the status update, so the audit trail is
    // always complete.
    if (newStatus === 'Closed') {
      setCloseModal({ ticket: ticket, comment: '', link: '' });
      return;
    }
    try {
      const updates = { status: newStatus, updated_by: myId };
      await dbUpdate('tickets', ticket.id, updates, myId);
      const myName = getUserName(myId) || 'Unknown';
      await dbInsert('ticket_comments', { ticket_id: ticket.id, comment_text: '📋 Status changed to ' + newStatus + ' by ' + myName, is_system: true, created_by: myId }, myId);
      await logActivity(myId, 'Ticket status → ' + newStatus + ': ' + ticket.title, 'ticket');
      if (ticket.assigned_to && ticket.assigned_to !== myId) notifyTicketStatus([ticket.assigned_to], ticket.title, newStatus, myId);
      if (ticket.created_by && ticket.created_by !== myId && ticket.created_by !== ticket.assigned_to) notifyTicketStatus([ticket.created_by], ticket.title, newStatus, myId);
      const extras = parseAssignees(ticket).filter(id => id !== myId && id !== ticket.assigned_to && id !== ticket.created_by);
      if (extras.length) notifyTicketStatus(extras, ticket.title, newStatus, myId);
      loadTickets();
      if (sel && sel.id === ticket.id) { setSel({...sel, ...updates}); loadComments(ticket.id); }
    } catch (err) { toast ? toast.error(err.message) : alert(err.message); }
  };

  // S17 — Finalize a Closed status with the mandatory closing comment.
  // Called by the close modal's Submit button after validation.
  const finalizeClose = async () => {
    if (!closeModal) return;
    // v55.57 — Double-submit guard. Without this, a quick double-tap on
    // "Close" added two closing comments + ran two status updates back
    // to back. First click flips closingTicket true; second click bails.
    if (closingTicket) return;
    const { ticket, comment, link } = closeModal;
    const trimmed = (comment || '').trim();
    if (!trimmed) {
      // S22.4 (Apr 23 2026) — Both a toast AND a browser alert so the user
      // cannot miss it. Max reported clicking Close and "nothing happens"
      // because the disabled button gave no feedback; now the button is
      // always clickable and we enforce here with maximum visibility.
      try { if (toast) toast.error('Please type a closing comment first — required for audit trail'); } catch (_) {}
      alert('⚠️ A closing comment is required.\n\nPlease type what was done to resolve this ticket before closing. This is saved on the ticket for the audit trail.');
      // Focus the textarea so the user lands in the right field
      try {
        var ta = document.querySelector('textarea[placeholder^="Describe how this was resolved"]');
        if (ta) ta.focus();
      } catch (_) {}
      return;
    }
    // Validate optional URL — if they typed something, it must look like a URL
    const trimmedLink = (link || '').trim();
    if (trimmedLink && !/^(https?:\/\/|\/|mailto:)/i.test(trimmedLink)) {
      toast ? toast.error('Link must start with http://, https://, /, or mailto:') : alert('Link must start with http://, https://, /, or mailto:');
      return;
    }
    setClosingTicket(true);
    try {
      const myName = getUserName(myId) || 'Unknown';
      // S22 (Apr 23 2026) — Resilient close. Some tickets tables don't have
      // closed_at / closed_by columns yet. If the full update fails because
      // those columns don't exist, retry with just status + updated_by so
      // the close still succeeds — the closing comment captures "who" and
      // "when" anyway via ticket_comments.created_by and created_at.
      try {
        await dbUpdate('tickets', ticket.id, {
          status: 'Closed',
          updated_by: myId,
          closed_at: new Date().toISOString(),
          closed_by: myId,
        }, myId);
      } catch (e1) {
        const msg = String(e1 && e1.message || '');
        if (/closed_at|closed_by|column/i.test(msg)) {
          // Fall back to the minimal payload
          await dbUpdate('tickets', ticket.id, { status: 'Closed', updated_by: myId }, myId);
        } else {
          throw e1;
        }
      }
      // Write the closing comment as a visible (non-system) comment so it's
      // obvious in the ticket history what the resolution was.
      const commentBody = '🔒 CLOSED by ' + myName + '\n\n' + trimmed
        + (trimmedLink ? '\n\n🔗 ' + trimmedLink : '');
      try {
        await dbInsert('ticket_comments', { ticket_id: ticket.id, comment_text: commentBody, is_system: false, created_by: myId }, myId);
      } catch (commentErr) {
        // Don't block the close itself if the comment fails to save
        console.warn('[close] could not save closing comment:', commentErr && commentErr.message);
      }
      try { await logActivity(myId, 'Closed ticket: ' + ticket.title, 'ticket'); } catch (_) {}
      try {
        if (ticket.assigned_to && ticket.assigned_to !== myId) notifyTicketStatus([ticket.assigned_to], ticket.title, 'Closed', myId);
        if (ticket.created_by && ticket.created_by !== myId && ticket.created_by !== ticket.assigned_to) notifyTicketStatus([ticket.created_by], ticket.title, 'Closed', myId);
        const extras = parseAssignees(ticket).filter(id => id !== myId && id !== ticket.assigned_to && id !== ticket.created_by);
        if (extras.length) notifyTicketStatus(extras, ticket.title, 'Closed', myId);
      } catch (_) {}
      setCloseModal(null);
      loadTickets();
      if (sel && sel.id === ticket.id) { setSel({...sel, status: 'Closed'}); loadComments(ticket.id); }
      if (toast) toast.success('Ticket closed ✓');
    } catch (err) {
      const m = err && err.message ? err.message : String(err);
      toast ? toast.error('Could not close: ' + m) : alert('Could not close: ' + m);
    } finally {
      setClosingTicket(false);
    }
  };

  const reassignTicket = async (ticket, newUserId) => {
    try {
      await dbUpdate('tickets', ticket.id, { assigned_to: newUserId, updated_by: myId }, myId);
      const newName = getUserName(newUserId);
      const myName = getUserName(myId);
      await dbInsert('ticket_comments', { ticket_id: ticket.id, comment_text: '👤 Reassigned to ' + newName + ' by ' + myName, is_system: true, created_by: myId }, myId);
      await logActivity(myId, 'Reassigned ticket to ' + newName + ': ' + ticket.title, 'ticket');
      if (newUserId) notifyTicketReassigned([newUserId], ticket.title, myId);
      if (ticket.assigned_to && ticket.assigned_to !== newUserId && ticket.assigned_to !== myId) notifyTicketReassigned([ticket.assigned_to], ticket.title, myId);
      if (ticket.created_by && ticket.created_by !== myId && ticket.created_by !== newUserId && ticket.created_by !== ticket.assigned_to) notifyTicketReassigned([ticket.created_by], ticket.title, myId);
      loadTickets();
      if (sel && sel.id === ticket.id) { setSel({...sel, assigned_to: newUserId}); loadComments(ticket.id); }
    } catch (err) { toast ? toast.error(err.message) : alert(err.message); }
  };

  // R7: who can edit title/description.
  // Super admin always. Otherwise: creator, current assignee, any additional_assignee. Admin/manager can also edit.
  const canEditTicketContent = (ticket) => {
    if (!ticket) return false;
    if (isSuperAdmin) return true;
    if (isAdminRole) return true;
    if (ticket.created_by === myId) return true;
    if (parseAssignees(ticket).includes(myId)) return true;
    return false;
  };

  // R7: save an inline edit to title or description. Writes a system comment
  // with the original→new diff so the audit trail is preserved inside the ticket.
  const saveTicketEdit = async (field) => {
    if (!sel) return;
    // Defense-in-depth: re-check permission at the function level. The UI hides
    // the pencil when canEditTicketContent is false, but a user could call this
    // via the console. Reject early instead of silently saving.
    if (!canEditTicketContent(sel)) {
      toast ? toast.error('You do not have permission to edit this ticket / لا تملك صلاحية التعديل') : alert('Not permitted');
      setEditingField(null);
      return;
    }
    const oldVal = String(sel[field] || '');
    const newVal = String((editBuf[field] || '')).trim();
    if (newVal === oldVal) { setEditingField(null); return; }
    if (field === 'title' && !newVal) {
      toast ? toast.warning('Title cannot be empty / لا يمكن أن يكون العنوان فارغًا') : alert('Title required');
      return;
    }
    try {
      await dbUpdate('tickets', sel.id, { [field]: newVal, updated_by: myId }, myId);
      const myName = getUserName(myId) || 'Someone';
      // Truncate long field values in the audit comment so we don't store a novel in ticket_comments
      const clip = (s) => { s = String(s || ''); return s.length > 500 ? s.substring(0, 500) + '…' : s; };
      const fieldLabel = field === 'title' ? 'Title / العنوان' : 'Description / الوصف';
      const auditText =
        '✏️ ' + fieldLabel + ' edited by ' + myName + '\n' +
        'BEFORE: ' + (oldVal ? clip(oldVal) : '(empty)') + '\n' +
        'AFTER: ' + clip(newVal);
      await dbInsert('ticket_comments', {
        ticket_id: sel.id,
        comment_text: auditText,
        is_system: true,
        created_by: myId,
      }, myId);
      await logActivity(myId, 'Edited ' + field + ' on ' + (sel.ticket_number || sel.title), 'ticket');
      // Update local sel + reload
      setSel({...sel, [field]: newVal, updated_by: myId, updated_at: new Date().toISOString()});
      setEditingField(null);
      loadTickets();
      loadComments(sel.id);
      if (toast) toast.success(fieldLabel + ' updated ✓');
    } catch (err) {
      toast ? toast.error(err.message) : alert(err.message);
    }
  };

  const addComment = async () => {
    if (!f.comment || !sel) return;
    // v55.44 — hard guard against rapid re-taps. If a save is already in
    // flight, the new tap is silently dropped. The composer's button is
    // also disabled visually while submittingComment === true.
    if (submittingComment) return;
    // f.comment is HTML from the contenteditable; sanitize to the tag allow-list.
    var safeHtml = sanitizeRichText(String(f.comment));
    // Empty check — if user typed only whitespace / pressed toolbar without typing, skip
    var plain = richTextToPlain(safeHtml);
    if (!plain.trim()) return;
    setSubmittingComment(true);
    try {
      await dbInsert('ticket_comments', { ticket_id: sel.id, comment_text: safeHtml, is_system: false, created_by: myId }, myId);
      await dbUpdate('tickets', sel.id, { updated_by: myId }, myId);
      await logActivity(myId, 'Comment on ticket: ' + sel.title, 'ticket');
      // Notifications use the plain-text preview, not the HTML (email clients render tags as text)
      var preview = plain.length > 200 ? plain.substring(0, 200) + '…' : plain;
      if (sel.assigned_to && sel.assigned_to !== myId) notifyTicketComment([sel.assigned_to], sel.title, preview, myId);
      if (sel.created_by && sel.created_by !== myId && sel.created_by !== sel.assigned_to) notifyTicketComment([sel.created_by], sel.title, preview, myId);
      const extras = parseAssignees(sel).filter(id => id !== myId && id !== sel.assigned_to && id !== sel.created_by);
      if (extras.length) notifyTicketComment(extras, sel.title, preview, myId);
      setF({...f, comment: ''}); loadComments(sel.id);
    } catch (err) { toast ? toast.error(err.message) : alert(err.message); }
    finally { setSubmittingComment(false); }
  };

  const deleteTicket = async (ticket) => {
    if (!canDeleteTicket(ticket)) return;
    setConfirmDel(ticket);
  };

  const executeDelete = async () => {
    const ticket = confirmDel;
    if (!ticket) return;
    // v51.1 — previous version called setConfirmDel(null) BEFORE the async
    // work, so any error was invisible: modal closed, ticket stayed. Now we
    // keep the modal open, show a red error, and only close on success.
    try { console.log('[delete] starting', ticket.id, ticket.ticket_number); } catch(_) {}
    try {
      // Pre-clear referenced rows that might lack ON DELETE CASCADE on all
      // environments. Belt-and-suspenders against schema drift.
      try {
        await supabase.from('ticket_comments').delete().eq('ticket_id', ticket.id);
        try { console.log('[delete] comments cleared'); } catch(_) {}
      } catch (e) {
        try { console.warn('[delete] comment clear failed (continuing):', e && e.message); } catch(_) {}
      }
      // v51.1 — clear per-assignee priority rows if that table exists (s22 schema).
      try {
        await supabase.from('ticket_assignee_priorities').delete().eq('ticket_id', ticket.id);
      } catch (_) { /* table may not exist on older schemas */ }
      // v51.1 — drop any ai_alerts referencing this ticket so Nadia doesn't
      // bring it up as a stale reminder after deletion.
      try {
        await supabase.from('ai_alerts').delete().eq('related_entity_id', ticket.id);
      } catch (_) {}

      await dbDelete('tickets', ticket.id, myId);
      try { console.log('[delete] ticket row deleted'); } catch(_) {}

      await logActivity(myId, 'Deleted ticket: ' + (ticket.ticket_number || '') + ' ' + (ticket.title || ''), 'ticket');
      setConfirmDel(null);
      setSel(null);
      setComments([]);
      loadTickets();
      if (toast) toast.success('Ticket deleted');
    } catch (err) {
      try { console.error('[delete] FAILED:', err); } catch(_) {}
      // Keep the modal open and tell the user why. Before: error was swallowed
      // and the user just saw an unchanged ticket list with no feedback.
      var msg = (err && (err.message || err.error_description)) || 'Delete failed';
      if (toast) toast.error('Delete failed: ' + msg);
      else alert('Delete failed: ' + msg);
    }
  };

  // Bulk actions
  const toggleBulk = (id) => {
    const next = new Set(bulkSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setBulkSelected(next);
  };
  const toggleAllBulk = () => {
    if (bulkSelected.size === filtered.length) setBulkSelected(new Set());
    else setBulkSelected(new Set(filtered.map(t => t.id)));
  };
  const executeBulk = async (action, value) => {
    if (!bulkSelected.size) return;
    const ids = [...bulkSelected];
    try {
      if (action === 'status') {
        for (const id of ids) {
          await dbUpdate('tickets', id, { status: value, updated_by: myId }, myId);
        }
      } else if (action === 'assign') {
        for (const id of ids) {
          await dbUpdate('tickets', id, { assigned_to: value || null, updated_by: myId }, myId);
        }
      } else if (action === 'delete') {
        for (const id of ids) {
          await supabase.from('ticket_comments').delete().eq('ticket_id', id);
          await dbDelete('tickets', id, myId);
        }
      }
      await logActivity(myId, 'Bulk ' + action + ' on ' + ids.length + ' tickets', 'ticket');
      setBulkSelected(new Set());
      setBulkAction(null);
      loadTickets();
    } catch (err) { toast ? toast.error(err.message) : alert(err.message); }
  };

  // ===== SHARED MODALS =====
  // v55.45 — These modals MUST be rendered from both the detail view AND
  // the list view. Previously the delete-confirm modal lived only inside
  // the list-view return block. The Delete button in the detail view
  // (line ~457) called setConfirmDel(ticket) which flipped the state
  // correctly, but the modal had nowhere to render until the user pressed
  // Back. Same exact bug as the S22 close-with-comment modal had earlier.
  // Lifting both modals into one shared JSX const guarantees they render
  // from either view AND prevents the same regression next time someone
  // adds a new modal.
  const sharedModals = (<>
    {confirmDel && (
      <div className="fixed inset-0 bg-black/50 z-[250] flex items-center justify-center p-4" onClick={() => setConfirmDel(null)}>
        <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-2 text-red-600">🗑 Delete Ticket</h3>
          <p className="text-sm text-slate-600 mb-1">Permanently delete <b>{confirmDel.ticket_number}</b>:</p>
          <p className="text-sm font-bold mb-4">"{confirmDel.title}"</p>
          <p className="text-xs text-red-500 mb-5">This cannot be undone. All comments will also be deleted.</p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setConfirmDel(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold">Cancel</button>
            <button onClick={executeDelete} className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600">Delete Permanently</button>
          </div>
        </div>
      </div>
    )}
    {closeModal && (
      <div className="fixed inset-0 bg-black/60 z-[250] flex items-center justify-center p-4" onClick={() => setCloseModal(null)}>
        <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span>🔒</span> Close Ticket
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {closeModal.ticket.ticket_number && <span className="font-mono font-bold mr-2">{closeModal.ticket.ticket_number}</span>}
                {closeModal.ticket.title}
              </p>
            </div>
            <button onClick={() => setCloseModal(null)}
              className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>
          {/* S22.4 — Assertive enforcement banner. Tells the user up-front
              they MUST type a comment. Previously the disabled button gave
              no feedback ("clicked Close... nothing happens"). */}
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-900 font-semibold flex items-start gap-2">
            <span>⚠️</span>
            <span>You must type a closing comment below — this is required for the audit trail.</span>
          </div>
          <div className="mb-4">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Closing Comment <span className="text-red-500">*</span>
            </label>
            <textarea
              value={closeModal.comment}
              onChange={e => setCloseModal({...closeModal, comment: e.target.value})}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  finalizeClose();
                }
              }}
              autoFocus
              rows={4}
              placeholder="Describe how this was resolved, what was done, what was learned..."
              className={'w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ' + (!closeModal.comment.trim() ? 'border-2 border-red-400 focus:ring-red-400 focus:border-red-400' : 'border border-slate-300 focus:ring-emerald-400 focus:border-emerald-400')}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              This comment will be visible on the ticket history. Required for audit trail.
            </p>
          </div>
          <div className="mb-5">
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Related Link <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="url"
              value={closeModal.link}
              onChange={e => setCloseModal({...closeModal, link: e.target.value})}
              placeholder="https://... or mailto:..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Attach a related URL — a doc, PR, external ticket, or email thread.
            </p>
          </div>
          <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
            <button onClick={() => setCloseModal(null)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50">
              Cancel
            </button>
            {/* S22.4 — Button is ALWAYS clickable. If comment is empty,
                finalizeClose() shows a loud error toast + scrolls the
                comment field into view. No more silent non-responsive
                button. */}
            <button onClick={finalizeClose}
              disabled={closingTicket}
              className={'px-5 py-2.5 rounded-lg text-sm font-extrabold text-white shadow-md transition hover:shadow-lg ' + (closingTicket ? 'cursor-not-allowed' : '')}
              style={{ background: closingTicket ? '#94a3b8' : (!closeModal.comment.trim() ? '#94a3b8' : 'linear-gradient(135deg, #059669, #047857)') }}>
              {closingTicket ? '⏳ Closing…' : '✓ Close Ticket'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>);

  // ===== TICKET DETAIL VIEW =====
  if (sel) {
    const priInfo = PRIORITIES.find(p => p.v === sel.priority) || PRIORITIES[1];
    const isOverdue = sel.due_date && sel.due_date < todayStr && sel.status !== 'Closed';
    const createdByName = getUserName(sel.created_by) || 'Unknown';
    const assignedName = getUserName(sel.assigned_to) || 'UNASSIGNED';
    const allAssignees = parseAssignees(sel);
    const systemComments = comments.filter(c => c.is_system);
    const userComments = comments.filter(c => !c.is_system);

    return (<div>
      <div className="flex justify-between items-center mb-3">
        <button onClick={() => { setSel(null); setComments([]); }} className="px-3 py-1 rounded border border-slate-200 text-xs font-semibold">← Back</button>
        {canDeleteTicket(sel) && (
          <button onClick={() => deleteTicket(sel)}
            className="px-3 py-1 rounded border border-red-300 text-red-600 text-xs font-semibold hover:bg-red-50 transition">
            🗑 Delete Ticket
          </button>
        )}
      </div>

      {/* TICKET HEADER */}
      <div className={'bg-white rounded-xl p-5 mb-3 border-l-4'} style={{ borderLeftColor: STATUS_COLORS[sel.status] || '#6b7280' }}>
        <div className="flex justify-between items-start mb-3">
          {/* R7: Title — click pencil to edit. Edit writes a system comment diff. */}
          {editingField === 'title' ? (
            <div className="flex-1 flex gap-2 items-start">
              {sel.ticket_number && <span className="text-blue-400 mr-1 self-center">{sel.ticket_number}</span>}
              <input autoFocus
                value={editBuf.title}
                onChange={e => setEditBuf({...editBuf, title: e.target.value})}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveTicketEdit('title');
                  else if (e.key === 'Escape') setEditingField(null);
                }}
                className="flex-1 text-lg font-extrabold px-2 py-1 border rounded" />
              <button onClick={() => saveTicketEdit('title')} className="px-2 py-1 rounded bg-emerald-500 text-white text-xs font-bold">Save</button>
              <button onClick={() => setEditingField(null)} className="px-2 py-1 rounded bg-slate-200 text-slate-700 text-xs">Cancel</button>
            </div>
          ) : (
            <h3 className="text-lg font-extrabold flex-1 flex items-center gap-2">
              {sel.ticket_number && <span className="text-blue-400 mr-2">{sel.ticket_number}</span>}
              <span>{sel.title}</span>
              {canEditTicketContent(sel) && (
                <button onClick={() => { setEditBuf({...editBuf, title: sel.title || ''}); setEditingField('title'); }}
                  title="Edit title / تعديل العنوان"
                  className="text-slate-400 hover:text-blue-600 text-sm font-normal">✏️</button>
              )}
            </h3>
          )}
          <span className="px-3 py-1 rounded-full text-xs font-bold text-white ml-2" style={{ background: STATUS_COLORS[sel.status] }}>{sel.status}</span>
        </div>

        {/* R7: Description — editable by anyone with content-edit permission. Shown even when empty
            so the owner/assignee has somewhere to click to add one. */}
        {editingField === 'description' ? (
          <div className="mb-4 flex flex-col gap-2">
            <textarea autoFocus rows={4}
              value={editBuf.description}
              onChange={e => setEditBuf({...editBuf, description: e.target.value})}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveTicketEdit('description');
                else if (e.key === 'Escape') setEditingField(null);
              }}
              className="w-full text-sm px-3 py-2 border rounded-lg bg-slate-50"
              placeholder="Describe the ticket / اوصف التذكرة" />
            <div className="flex gap-2">
              <button onClick={() => saveTicketEdit('description')} className="px-3 py-1 rounded bg-emerald-500 text-white text-xs font-bold">Save (Ctrl+Enter)</button>
              <button onClick={() => setEditingField(null)} className="px-3 py-1 rounded bg-slate-200 text-slate-700 text-xs">Cancel (Esc)</button>
            </div>
          </div>
        ) : sel.description ? (
          <div className="text-sm text-slate-600 mb-4 bg-slate-50 rounded-lg p-3 flex justify-between items-start gap-2">
            <p className="flex-1 whitespace-pre-wrap">{sel.description}</p>
            {canEditTicketContent(sel) && (
              <button onClick={() => { setEditBuf({...editBuf, description: sel.description || ''}); setEditingField('description'); }}
                title="Edit description / تعديل الوصف"
                className="text-slate-400 hover:text-blue-600 text-sm shrink-0">✏️</button>
            )}
          </div>
        ) : canEditTicketContent(sel) ? (
          <button onClick={() => { setEditBuf({...editBuf, description: ''}); setEditingField('description'); }}
            className="text-xs text-slate-400 mb-4 italic hover:text-blue-500">
            + Add description / إضافة وصف
          </button>
        ) : null}

        {/* KEY DETAILS GRID */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 font-semibold">Opened By / أنشأها</div>
            <div className="text-sm font-bold text-blue-600">{createdByName}</div>
            <div className="text-[10px] text-slate-400">{fmtDate(sel.created_at)}</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3">
            <div className="text-[10px] text-slate-500 font-semibold">Assigned To / معيّن إلى</div>
            <div className="flex flex-wrap gap-1 mt-1 mb-1">
              {allAssignees.length > 0 ? allAssignees.map(uid => (
                <span key={uid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: userColorMap[uid] || '#8b5cf6' }}>
                  {getUserName(uid) || '?'}
                  {canManage && <button onClick={async () => {
                    const newExtras = parseAssignees(sel).filter(id => id !== uid);
                    const primary = uid === sel.assigned_to ? (newExtras[0] || null) : sel.assigned_to;
                    const extras = newExtras.filter(id => id !== primary);
                    await dbUpdate('tickets', sel.id, { assigned_to: primary, additional_assignees: extras.length ? JSON.stringify(extras) : null, updated_by: myId }, myId);
                    loadTickets(); setSel({...sel, assigned_to: primary, additional_assignees: extras.length ? JSON.stringify(extras) : null});
                  }} className="ml-0.5 text-white/70 hover:text-white">✕</button>}
                </span>
              )) : <span className="text-[10px] text-red-500 font-bold">UNASSIGNED</span>}
            </div>
            {canManage && (
              <select value="" onChange={async (e) => {
                const newId = e.target.value; if (!newId) return;
                if (parseAssignees(sel).includes(newId)) return;
                const current = parseAssignees(sel);
                const primary = sel.assigned_to || newId;
                const extras = [...current, newId].filter(id => id !== primary);
                await dbUpdate('tickets', sel.id, { assigned_to: primary, additional_assignees: extras.length ? JSON.stringify(extras) : null, updated_by: myId }, myId);
                await dbInsert('ticket_comments', { ticket_id: sel.id, comment_text: '👤 ' + getUserName(newId) + ' added as assignee by ' + (getUserName(myId) || ''), is_system: true, created_by: myId }, myId);
                notifyTicketAssigned([newId], sel.title, myId);
                loadTickets(); loadComments(sel.id); setSel({...sel, assigned_to: primary, additional_assignees: extras.length ? JSON.stringify(extras) : null});
              }} className="w-full px-2 py-1 rounded border border-purple-200 text-[10px] bg-white mt-1">
                <option value="">+ Add assignee...</option>
                {activeUsers.filter(u => !parseAssignees(sel).includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>
          <div className={'rounded-lg p-3 ' + (isOverdue ? 'bg-red-50 border border-red-200' : 'bg-slate-50')}>
            <div className="text-[10px] text-slate-500 font-semibold">Due Date / تاريخ الاستحقاق</div>
            <div className={'text-sm font-bold ' + (isOverdue ? 'text-red-600' : sel.due_date ? '' : 'text-slate-400')}>
              {sel.due_date || 'No due date'}
            </div>
            {isOverdue && <div className="text-[10px] font-bold text-red-600">🚨 {Math.floor((Date.now() - new Date(sel.due_date).getTime()) / 86400000)} days OVERDUE</div>}
            {(() => {
              const isSuperAdmin = userProfile?.role === 'super_admin';
              const isManager = userProfile?.role === 'admin';
              const canEditDue = isSuperAdmin || (isManager && sel.assigned_to !== myId);
              return canEditDue ? (
                <div className="flex gap-1 mt-1">
                  <input type="date" id="ticket-due-date" defaultValue={sel.due_date || ''} key={sel.id + '-due-' + (sel.due_date || '')}
                    className="flex-1 px-2 py-1 rounded border text-[10px] bg-white" />
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    const val = document.getElementById('ticket-due-date')?.value || null;
                    // v55.44 — capture old value BEFORE the update so the
                    // audit comment can show "before → after". Used both
                    // for the system comment and the activity log entry.
                    const oldVal = sel.due_date || null;
                    if ((oldVal || null) === (val || null)) return; // no-op
                    try {
                      await dbUpdate('tickets', sel.id, { due_date: val, updated_by: myId }, myId);
                      // v55.44 — write a system comment so the change is
                      // visible right in the ticket thread, not buried in
                      // the activity log. Same pattern as status / reassign.
                      try {
                        const myName = getUserName(myId) || 'Unknown';
                        const fmtDate = (d) => d ? d : 'no date';
                        const auditText = '📅 Due date changed: ' + fmtDate(oldVal) + ' → ' + fmtDate(val) + ' (by ' + myName + ')';
                        await dbInsert('ticket_comments', { ticket_id: sel.id, comment_text: auditText, is_system: true, created_by: myId }, myId);
                      } catch (auditErr) {
                        // Audit comment is best-effort — don't break the
                        // due-date save if the comments insert fails.
                        try { console.warn('[audit] could not save due-date comment:', auditErr && auditErr.message); } catch(_) {}
                      }
                      await logActivity(myId, 'Changed due date on ' + (sel.ticket_number || sel.title) + ': ' + (oldVal || 'none') + ' → ' + (val || 'none'), 'ticket');
                      // v55.44 — Fan out the due-date change to creator +
                      // all assignees (deduped, never self) via email + bell.
                      try {
                        const recips = ticketRecipients(sel, myId, parseAssignees(sel));
                        if (recips.length) notifyTicketDueDate(recips, sel.title, oldVal, val, myId);
                      } catch (notifyErr) {
                        try { console.warn('[notify] due-date fan-out failed:', notifyErr && notifyErr.message); } catch(_) {}
                      }
                      loadTickets(); setSel({...sel, due_date: val});
                      // Refresh the comments list if we're viewing it so
                      // the new audit entry shows up immediately.
                      try { loadComments(sel.id); } catch(_) {}
                    } catch(err) { toast ? toast.error(err.message) : alert(err.message); }
                  }} className="px-3 py-1 bg-blue-500 text-white rounded text-[10px] font-semibold">Set</button>
                </div>
              ) : (
                <div className="text-[9px] text-slate-400 mt-1">Only super admins and managers can change due dates</div>
              );
            })()}
          </div>
          <div className="rounded-lg p-3" style={{ background: priInfo.c + '15' }}>
            <div className="text-[10px] text-slate-500 font-semibold">Priority / الأولوية</div>
            {canEditTicketContent(sel) ? (
              <select value={sel.priority || 'medium'} onChange={async (e) => {
                var newPri = e.target.value;
                var oldPri = sel.priority;
                if (newPri === oldPri) return;
                try {
                  await dbUpdate('tickets', sel.id, { priority: newPri, updated_at: new Date().toISOString(), updated_by: myId }, myId);
                  // v55.44 — system comment in the ticket thread so the
                  // priority bump is visible to anyone reading the ticket,
                  // not just buried in the activity log.
                  try {
                    const myName = getUserName(myId) || 'Unknown';
                    const auditText = '⚡ Priority changed: ' + (oldPri || 'none').toUpperCase() + ' → ' + newPri.toUpperCase() + ' (by ' + myName + ')';
                    await dbInsert('ticket_comments', { ticket_id: sel.id, comment_text: auditText, is_system: true, created_by: myId }, myId);
                  } catch (auditErr) {
                    try { console.warn('[audit] could not save priority comment:', auditErr && auditErr.message); } catch(_) {}
                  }
                  await logActivity(myId, 'Changed priority of ' + (sel.ticket_number || sel.title) + ' from ' + (oldPri || 'none') + ' to ' + newPri, 'ticket');
                  // v55.44 — Fan out the priority change to creator + all
                  // assignees (deduped, never self) via email AND dashboard
                  // bell. ticketRecipients() handles the dedup so we don't
                  // double-notify the creator if they're also the assignee.
                  try {
                    const recips = ticketRecipients(sel, myId, parseAssignees(sel));
                    if (recips.length) notifyTicketPriority(recips, sel.title, oldPri, newPri, myId);
                  } catch (notifyErr) {
                    try { console.warn('[notify] priority fan-out failed:', notifyErr && notifyErr.message); } catch(_) {}
                  }
                  if (toast) toast.success('Priority changed: ' + oldPri + ' → ' + newPri);
                  setSel({ ...sel, priority: newPri });
                  // Refresh comments list so the audit entry appears immediately.
                  try { loadComments(sel.id); } catch(_) {}
                  if (onReload) onReload();
                } catch (err) { if (toast) toast.error(err.message); else alert(err.message); }
              }} className="text-sm font-bold bg-transparent border-0 cursor-pointer outline-none w-full" style={{ color: priInfo.c }}>
                {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.v.toUpperCase()}</option>)}
              </select>
            ) : (
              <div className="text-sm font-bold" style={{ color: priInfo.c }}>{sel.priority?.toUpperCase()}</div>
            )}
            {sel.order_number && <div className="text-[10px] text-slate-500 mt-1">Order #{sel.order_number}</div>}
            {sel.client_name && <div className="text-[10px] text-slate-500">Client: {sel.client_name}</div>}
          </div>
        </div>

        {/* LAST UPDATED INFO */}
        {sel.updated_at && (
          <div className="flex items-center gap-2 mb-3 text-[10px] text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
            <span>🕐 Last updated: {fmtDate(sel.updated_at)}</span>
            {sel.updated_by && <span>by <span className="font-semibold text-purple-500">{getUserName(sel.updated_by) || 'Unknown'}</span></span>}
            {sel.closed_by && sel.status === 'Closed' && <span>• Closed by: <span className="font-semibold text-purple-500">{getUserName(sel.closed_by) || 'Unknown'}</span></span>}
          </div>
        )}

        {/* ACKNOWLEDGE BUTTON */}
        {sel.status === 'New' && sel.assigned_to === myId && (
          <button onClick={() => updateStatus(sel, 'Acknowledged')}
            className="w-full mb-3 px-4 py-3 bg-purple-600 text-white rounded-lg text-sm font-bold animate-pulse">
            ✓ Acknowledge Ticket</button>
        )}

        {/* STATUS CHANGE BUTTONS */}
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-500 mr-1 self-center">Change status:</span>
          {STATUSES.filter(s => s !== sel.status).map(s => (
            <button key={s} onClick={() => updateStatus(sel, s)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold text-white hover:opacity-90 hover:shadow transition"
              style={ s === 'Closed'
                ? { background: 'linear-gradient(135deg, #059669, #047857)', boxShadow: '0 2px 8px rgba(5,150,105,0.3)' }
                : { background: STATUS_COLORS[s] }
              }>{s === 'Closed' ? '✓ Close' : s}</button>
          ))}
        </div>
      </div>

      {/* ACTIVITY LOG (system events) */}
      <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
        <h4 className="text-sm font-bold mb-2">📋 Activity Log ({systemComments.length})</h4>
        {systemComments.length > 0 ? (
          <div className="space-y-1 max-h-[200px] overflow-auto">
            {systemComments.map(c => {
              const updaterName = getUserName(c.created_by) || 'System';
              return (
                <div key={c.id} className="flex items-start gap-2 py-1.5 border-b border-slate-50">
                  <span className="text-xs mt-0.5">📋</span>
                  <div className="flex-1">
                    <div className="text-xs whitespace-pre-wrap">{c.comment_text}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      <span className="font-semibold text-purple-500">{updaterName}</span>
                      <span className="ml-2">{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-slate-400">No status changes yet</div>
        )}
      </div>

      {/* COMMENTS / NOTES */}
      <div className="bg-white rounded-xl p-4 mb-3 border border-slate-200">
        <h4 className="text-sm font-bold mb-2">💬 Comments & Attachments ({userComments.length})</h4>
        {userComments.length > 0 && (
          <div className="space-y-2 max-h-[300px] overflow-auto mb-3">
            {userComments.map(c => {
              const authorName = getUserName(c.created_by) || 'Unknown';
              const isMe = c.created_by === myId;
              // Linkify: make URLs in comment text clickable (plain-text path only)
              const linkify = (text) => {
                if (!text) return text;
                const urlRegex = /(https?:\/\/[^\s<]+)/g;
                const parts = text.split(urlRegex);
                return parts.map((part, i) => urlRegex.test(part) 
                  ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline break-all">{part.length > 50 ? part.substring(0,50) + '...' : part}</a>
                  : part
                );
              };
              // R8: comment may be rich text (HTML) or plain text. We pick the renderer per row so
              // every legacy comment still renders exactly as before; only new rich comments go through
              // the sanitizer + dangerouslySetInnerHTML. The sanitizer strips any tag outside the
              // allow-list so nothing arbitrary can land in the DOM.
              const rawText = c.comment_text || '';
              const isRich = isHtmlComment(rawText);
              const safeHtml = isRich ? sanitizeRichText(rawText) : null;
              return (
                <div key={c.id} className={'rounded-lg p-3 ' + (isMe ? 'bg-blue-50 ml-8' : 'bg-slate-50 mr-8')}>
                  {isRich
                    ? <div className="text-xs rich-comment" dangerouslySetInnerHTML={{ __html: safeHtml }} />
                    : <div className="text-xs whitespace-pre-wrap">{linkify(rawText)}</div>
                  }
                  {c.attachment_url && (
                    <a href={c.attachment_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1 px-2 py-1 bg-white rounded border border-slate-200 text-[10px] text-blue-600 font-semibold hover:bg-blue-50">
                      📎 {c.attachment_name || 'Attachment'}
                    </a>
                  )}
                  <div className="text-[10px] text-slate-400 mt-1">
                    <span className={'font-semibold ' + (isMe ? 'text-blue-500' : 'text-purple-500')}>{authorName}</span>
                    <span className="ml-2">{fmtDate(c.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* R8: Rich-text comment composer — toolbar + contenteditable.
            Output is HTML; sanitizeRichText strips everything outside the tag
            allow-list before insert. Legacy plain-text comments render via the
            linkify path above unchanged. */}
        <RichCommentComposer
          value={f.comment || ''}
          onChange={(html) => setF({...f, comment: html})}
          onSubmit={addComment}
          uploading={uploading}
          submitting={submittingComment}
          onAttach={async (file) => {
            if (!file || !sel) return;
            if (file.size > 10 * 1024 * 1024) { toast ? toast.warning('File too large — max 10MB / الملف كبير جداً') : alert('File too large — max 10MB'); return; }
            setUploading(true);
            try {
              const ext = file.name.split('.').pop();
              const fileName = sel.ticket_number + '_' + Date.now() + '.' + ext;
              const { data: upData, error: upErr } = await supabase.storage.from('ticket-attachments').upload(fileName, file);
              if (upErr) throw upErr;
              const { data: urlData } = supabase.storage.from('ticket-attachments').getPublicUrl(fileName);
              const url = urlData?.publicUrl || '';
              await dbInsert('ticket_comments', { ticket_id: sel.id, comment_text: '📎 Attached: ' + file.name, attachment_url: url, attachment_name: file.name, is_system: false, created_by: myId }, myId);
              await dbUpdate('tickets', sel.id, { updated_by: myId }, myId);
              loadComments(sel.id);
              if (toast) toast.success('File attached ✓');
            } catch (err) { toast ? toast.error('Upload failed: ' + err.message) : alert('Upload failed: ' + err.message); }
            setUploading(false);
          }}
        />
      </div>

      {/* v55.45 — both close modal AND delete confirm now live in
          sharedModals (declared above the if (sel) early return) so they
          render from either view. Previously only the close modal was
          duplicated here; the delete modal was never rendered when the
          user clicked Delete from the detail view. */}
      {sharedModals}
    </div>);
  }

  // ===== TICKET LIST VIEW =====
  return (<div>
    <div className="flex justify-between flex-wrap gap-2 mb-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-extrabold">Tickets / التذاكر</h2>
        {/* S21 — view toggle: List vs Priority Board */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setViewMode('list')}
            className={'px-2.5 py-1 rounded text-[11px] font-semibold ' + (viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
            📋 List
          </button>
          <button onClick={() => setViewMode('board')}
            className={'px-2.5 py-1 rounded text-[11px] font-semibold ' + (viewMode === 'board' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
            title="Visual drag-and-drop priority board">
            🗂️ Priority Board
          </button>
        </div>
      </div>
      <div className="flex gap-2 items-center">
        <div className="relative">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search tickets... / بحث" className="px-3 py-1.5 rounded-lg border text-xs w-48 pr-6" />
          {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">✕</button>}
        </div>
        <button onClick={() => { setShowAdd(true); setF({}); }} className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-xs font-semibold">+ Ticket</button>
        <button onClick={startVoice} className={'px-3 py-1.5 rounded-lg text-xs font-semibold ' + (listening ? 'bg-red-500 text-white animate-pulse' : 'bg-amber-500 text-white')}>
          {listening ? '🎙 Listening...' : '🎤 Voice'}</button>
      </div>
    </div>

    {/* S21 — Priority Board view */}
    {viewMode === 'board' && (
      <PriorityBoard
        tickets={tickets}
        users={users}
        currentUserId={myId}
        isAdmin={canManage}
        onReorder={() => { loadTickets(); }}
        onSelectTicket={(t) => { setSel(t); loadComments(t.id); }}
        onRefresh={() => { loadTickets(); }}
        lang={lang}
      />
    )}

    {viewMode === 'list' && (<>

    {/* Filters — S18.4: status preset no longer resets the person/priority
        filters; person/priority no longer reset status. Max: he needs to be
        able to look at "Closed tickets assigned to Omar" etc. Filters
        combine. A separate Clear filters button fully resets. */}
    <div className="flex gap-2 mb-3 flex-wrap">
      {[['open','Open'],['mine','Assigned to Me'],['team','Assigned to Team'],['created','Created by Me'],['overdue','Overdue'],['all','All'],...STATUSES.map(s=>[s,s])].map(([v,l]) => (
        <button key={v} onClick={() => { setStatusF(v); }}
          className={'px-3 py-1 rounded-md text-xs font-semibold transition ' + (statusF === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{l}</button>
      ))}
    </div>

    {/* Sort + Filters */}
    <div className="flex gap-2 mb-3 items-center flex-wrap">
      <select value={ownerF} onChange={e => { setOwnerF(e.target.value); }} className="px-2 py-1 rounded-lg border text-xs font-semibold">
        <option value="all">👤 Owner: All</option>
        {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select value={assignedF} onChange={e => { setAssignedF(e.target.value); }} className="px-2 py-1 rounded-lg border text-xs font-semibold">
        <option value="all">🎯 Assigned: All</option>
        <option value="unassigned">Unassigned</option>
        {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select value={priorityF} onChange={e => { setPriorityF(e.target.value); }} className="px-2 py-1 rounded-lg border text-xs font-semibold">
        <option value="all">⚡ Priority: All</option>
        <option value="high">🔴 High</option>
        <option value="medium">🟡 Medium</option>
        <option value="low">🟢 Low</option>
      </select>
      {(ownerF !== 'all' || assignedF !== 'all' || priorityF !== 'all' || (statusF !== 'open' && statusF !== 'all')) && (
        <button onClick={() => { setOwnerF('all'); setAssignedF('all'); setPriorityF('all'); setStatusF('open'); }}
          className="px-2 py-1 rounded-lg text-[10px] font-semibold text-red-500 bg-red-50 border border-red-200">✕ Clear all filters</button>
      )}
      <span className="text-[10px] text-slate-400 font-semibold">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
    </div>

    {/* Sort */}
    <div className="flex gap-2 mb-3 items-center">
      <span className="text-[10px] text-slate-500 font-semibold">Sort:</span>
      {[['date','Newest'],['priority','Priority ↑'],['owner','Owner'],['due','Due Date']].map(([v,l]) => (
        <button key={v} onClick={() => setSortBy(v)}
          className={'px-2.5 py-1 rounded-md text-[10px] font-semibold transition ' + (sortBy === v ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-600')}>{l}</button>
      ))}
    </div>

    {/* Stats — click to filter */}
    <div className="grid grid-cols-4 gap-3 mb-3">
      <div onClick={() => setStatusF('open')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow transition" style={{borderLeftWidth:3,borderLeftColor:'#3b82f6'}}><div className="text-[10px] text-slate-500">Open</div><div className="text-lg font-extrabold">{tickets.filter(t=>t.status!=='Closed').length}</div></div>
      <div onClick={() => setStatusF('overdue')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow transition" style={{borderLeftWidth:3,borderLeftColor:'#ef4444'}}><div className="text-[10px] text-slate-500">Overdue</div><div className="text-lg font-extrabold text-red-500">{tickets.filter(t=>t.due_date&&t.due_date<todayStr&&t.status!=='Closed').length}</div></div>
      <div onClick={() => { setPriorityF('high'); }} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow transition" style={{borderLeftWidth:3,borderLeftColor:'#f59e0b'}}><div className="text-[10px] text-slate-500">High Priority</div><div className="text-lg font-extrabold text-amber-500">{tickets.filter(t=>t.priority==='high'&&t.status!=='Closed').length}</div></div>
      <div onClick={() => setStatusF('Closed')} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow transition" style={{borderLeftWidth:3,borderLeftColor:'#1e293b'}}><div className="text-[10px] text-slate-500">Closed</div><div className="text-lg font-extrabold text-slate-800">{tickets.filter(t=>t.status==='Closed').length}</div></div>
    </div>

    {/* Status Legend — collapsible */}
    <details className="mb-3">
      <summary className="text-[10px] text-blue-500 font-bold cursor-pointer hover:underline">ℹ️ Status Guide — what each status means</summary>
      <div className="bg-white rounded-xl p-3 mt-1 grid grid-cols-2 md:grid-cols-4 gap-2">
        {STATUSES.map(s => (
          <div key={s} className="rounded-lg p-2 border border-slate-100 cursor-pointer hover:shadow transition" onClick={() => { setStatusF(s); }}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{background: STATUS_COLORS[s]}} />
              <span className="text-xs font-bold">{s}</span>
              <span className="text-[9px] text-slate-400 ml-auto">{tickets.filter(t => t.status === s).length}</span>
            </div>
            <div className="text-[9px] text-slate-500 leading-tight">{STATUS_DESC[s]}</div>
          </div>
        ))}
      </div>
    </details>

    {/* Add Ticket Form */}
    {showAdd && (<div className="bg-blue-50 rounded-xl p-4 mb-3 border border-blue-200">
      <h3 className="text-sm font-bold text-blue-800 mb-3">New Ticket</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="text-[10px] font-semibold">Title *</label>
          <input value={f.title||''} onChange={e=>setF({...f,title:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div className="col-span-2"><label className="text-[10px] font-semibold">Description</label>
          <textarea value={f.description||''} onChange={e=>setF({...f,description:e.target.value})} rows={3} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Priority</label>
          <select value={f.priority||'medium'} onChange={e=>setF({...f,priority:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
            {PRIORITIES.map(p=><option key={p.v} value={p.v}>{p.l}</option>)}</select></div>
        <div><label className="text-[10px] font-semibold">Due Date</label>
          <input type="date" value={f.dueDate||''} onChange={e=>setF({...f,dueDate:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div><label className="text-[10px] font-semibold">Assign To</label>
          <select value={f.assignedTo||''} onChange={e=>setF({...f,assignedTo:e.target.value})} className="w-full px-3 py-2 rounded border text-sm">
            <option value="">Unassigned</option>{activeUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>
          {f.assignedTo && (<div className="mt-1">
            <div className="text-[9px] text-slate-500 font-semibold mb-1">Additional assignees:</div>
            <div className="flex flex-wrap gap-1">
              {activeUsers.filter(u => u.id !== f.assignedTo).map(u => {
                const checked = (f.extraAssignees || []).includes(u.id);
                return <label key={u.id} className={'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] cursor-pointer ' + (checked ? 'bg-purple-100 border-purple-300 text-purple-700 font-bold' : 'bg-white border-slate-200 text-slate-500')}>
                  <input type="checkbox" className="w-3 h-3" checked={checked} onChange={() => {
                    const cur = f.extraAssignees || [];
                    setF({...f, extraAssignees: checked ? cur.filter(id => id !== u.id) : [...cur, u.id]});
                  }} />{u.name}</label>;
              })}
            </div>
          </div>)}
        </div>
        <div><label className="text-[10px] font-semibold">Order #</label>
          <input value={f.orderNumber||''} onChange={e=>setF({...f,orderNumber:e.target.value})} className="w-full px-3 py-2 rounded border text-sm" /></div>
        <div className="col-span-2"><label className="text-[10px] font-semibold">Client</label>
          <input list="tkt-cl" value={f.clientName||''} onChange={e=>{ const m=customers.find(c=>c.name===e.target.value); setF({...f,clientName:e.target.value,customerId:m?m.id:''}); }} className="w-full px-3 py-2 rounded border text-sm" />
          <datalist id="tkt-cl">{customers.map(c=><option key={c.id} value={c.name}/>)}</datalist></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={handleAddTicket}
          disabled={creatingTicket}
          className={'px-4 py-2 rounded-lg text-sm font-semibold transition ' + (creatingTicket ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600')}>
          {creatingTicket ? '⏳ Creating…' : 'Create'}
        </button>
        <button onClick={()=>setShowAdd(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm">Cancel</button>
      </div>
    </div>)}

    {/* v55.45 — modals lifted to sharedModals (declared before the if (sel)
        early return) so they render from either view. The inline duplicates
        of the delete-confirm and close-with-comment modals that previously
        lived here have been removed. */}
    {sharedModals}

    {/* Bulk Action Bar */}
    {bulkSelected.size > 0 && (
      <div className="sticky top-0 z-20 bg-blue-600 text-white rounded-xl p-3 mb-3 flex items-center gap-3 flex-wrap shadow-lg">
        <span className="text-sm font-bold">{bulkSelected.size} selected</span>
        <select value="" onChange={async (e) => {
          if (!e.target.value) return;
          // S17 — Bulk "Closed" is blocked because each close requires its
          // own comment. Tell the user to close them individually.
          if (e.target.value === 'Closed') {
            alert('To close tickets, open each one and use the Close button — a closing comment is required per ticket.');
            e.target.value = '';
            return;
          }
          const ok = window.confirm('Change status of ' + bulkSelected.size + ' tickets to "' + e.target.value + '"?');
          if (ok) await executeBulk('status', e.target.value);
          e.target.value = '';
        }} className="px-2 py-1 rounded text-xs text-slate-800 font-semibold">
          <option value="">Change Status...</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value="" onChange={async (e) => { if (e.target.value) { await executeBulk('assign', e.target.value === '_none' ? null : e.target.value); e.target.value = ''; } }}
          className="px-2 py-1 rounded text-xs text-slate-800 font-semibold">
          <option value="">Reassign...</option>
          <option value="_none">Unassign</option>
          {activeUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {canManage && (
          <button onClick={async () => { const ok = window.confirm('Delete ' + bulkSelected.size + ' tickets permanently?'); if (ok) await executeBulk('delete'); }}
            className="px-3 py-1 bg-red-500 rounded text-xs font-bold hover:bg-red-600">🗑 Delete ({bulkSelected.size})</button>
        )}
        <button onClick={() => setBulkSelected(new Set())} className="px-3 py-1 bg-white/20 rounded text-xs font-semibold ml-auto">✕ Clear</button>
      </div>
    )}

    {/* Ticket Cards */}
    <div className="space-y-2">
      {filtered.length > 0 && (
        <label className="flex items-center gap-2 px-4 py-1 text-[10px] text-slate-400 font-semibold cursor-pointer hover:text-slate-600">
          <input type="checkbox" checked={bulkSelected.size === filtered.length && filtered.length > 0}
            onChange={toggleAllBulk} className="w-3.5 h-3.5 rounded" />
          Select All ({filtered.length})
        </label>
      )}
      {filtered.map(t => {
        // S15 — Tickets tab redesign to match dashboard visual language.
        //   * Title is the star: fontSize 15, bold, full prominence
        //   * Ticket # demoted to small grey monospace tag
        //   * Status = colored pill with border (not inline chip)
        //   * Overdue = explicit "N DAYS OVERDUE" badge, red
        //   * Due today = amber "DUE TODAY" badge
        //   * Priority color drives the CARD left border so urgent tickets
        //     jump out. Overdue overrides to red, due-today to amber.
        //   * More breathing room — gap between cards, padding inside
        const priColor = PRIORITIES.find(p=>p.v===t.priority)?.c||'#f59e0b';
        const tAssignees = parseAssignees(t);
        const createdName = getUserName(t.created_by);
        const isOverdue = t.due_date && t.due_date < todayStr && t.status !== 'Closed';
        const isDueToday = t.due_date === todayStr && t.status !== 'Closed';
        const daysOverdue = isOverdue
          ? Math.floor((new Date(todayStr).getTime() - new Date(t.due_date).getTime()) / 86400000)
          : 0;
        const needsAck = t.status === 'New' && isAssignedToMe(t);
        const isBulked = bulkSelected.has(t.id);

        // Left border: overdue > due-today > priority color.
        // S16: Distinct colors — overdue=red, due-today=orange (new), else priority color.
        // Previously due-today and medium-priority both used amber = visually confusing.
        const leftBorderColor = isOverdue ? '#ef4444' : (isDueToday ? '#f97316' : priColor);

        // Status pill color map (matches the dashboard palette).
        // S17 — Closed made VERY distinct: dark slate/charcoal with white text,
        // unlike Acknowledged (light indigo) which was too similar before.
        const statusPill = {
          'New':          { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' },
          'Acknowledged': { bg: '#e0e7ff', fg: '#3730a3', border: '#a5b4fc' },
          'In Progress':  { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
          'Blocked':      { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
          'On Hold':      { bg: '#ffedd5', fg: '#9a3412', border: '#fdba74' },
          'Review':       { bg: '#cffafe', fg: '#155e75', border: '#67e8f9' },
          'Resolved':     { bg: '#d1fae5', fg: '#065f46', border: '#6ee7b7' },
          'Closed':       { bg: '#1e293b', fg: '#f1f5f9', border: '#334155' },
          'Reopened':     { bg: '#fef3c7', fg: '#854d0e', border: '#facc15' },
        };
        const sp = statusPill[t.status] || { bg: '#ede9fe', fg: '#6d28d9', border: '#c4b5fd' };

        return (
          <div key={t.id}
            className={'bg-white rounded-xl hover:shadow-md transition cursor-pointer overflow-hidden ' + (isBulked ? 'ring-2 ring-blue-400' : '')}
            style={{ borderLeft: '4px solid ' + leftBorderColor, border: isBulked ? undefined : '1px solid #e2e8f0', borderLeftWidth: 4, borderLeftColor: leftBorderColor }}>
            <div className="px-4 py-3">
              {/* Top row: bulk select + title (the star) + status pill */}
              <div className="flex items-start gap-3 mb-2">
                <input type="checkbox" checked={isBulked} onChange={(e) => { e.stopPropagation(); toggleBulk(t.id); }}
                  onClick={e => e.stopPropagation()} className="w-4 h-4 rounded mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0" onClick={()=>{setSel(t);loadComments(t.id);}}>
                  <div className="font-bold text-[15px] text-slate-900 leading-tight mb-1"
                    style={{ wordBreak: 'break-word' }}>
                    {t.title}
                  </div>
                  {/* Info row — ticket#, status pill, and urgency badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.ticket_number && (
                      <span className="text-[10px] font-mono font-bold text-slate-500 tracking-wider">
                        {t.ticket_number}
                      </span>
                    )}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold"
                      style={{ background: sp.bg, color: sp.fg, border: '1px solid ' + sp.border }}>
                      {t.status}
                    </span>
                    {daysOverdue > 0 && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider"
                        style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }}>
                        {daysOverdue === 1 ? '1 DAY OVERDUE' : daysOverdue + ' DAYS OVERDUE'}
                      </span>
                    )}
                    {isDueToday && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider"
                        style={{ background: '#ffedd5', color: '#c2410c', border: '1px solid #fdba74' }}>
                        DUE TODAY
                      </span>
                    )}
                    {/* Priority dot with label */}
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 capitalize">
                      <span className="w-2 h-2 rounded-full" style={{ background: priColor }} />
                      {t.priority || 'medium'}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 flex-shrink-0">
                  {new Date(t.created_at).toLocaleDateString()}
                </span>
              </div>

              {/* Description (if present) */}
              {t.description && (
                <div className="text-[12px] text-slate-600 mb-2 line-clamp-2 pl-7" onClick={()=>{setSel(t);loadComments(t.id);}}>
                  {t.description}
                </div>
              )}

              {/* Meta row: created by / assignees / due date / order */}
              <div className="flex items-center gap-2 flex-wrap pl-7" onClick={()=>{setSel(t);loadComments(t.id);}}>
                <span className="inline-flex items-center gap-1 text-[10px] bg-slate-50 text-slate-600 px-2 py-0.5 rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />by {createdName || '?'}
                </span>
                {tAssignees.length > 0 ? tAssignees.map(uid => (
                  <span key={uid} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold"
                    style={{ background: (userColorMap[uid] || '#8b5cf6') + '18', color: userColorMap[uid] || '#8b5cf6' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: userColorMap[uid] || '#8b5cf6' }} />
                    → {getUserName(uid) || '?'}
                  </span>
                )) : (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold bg-red-50 text-red-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />Unassigned
                  </span>
                )}
                {t.due_date && !isOverdue && !isDueToday && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-50 text-slate-600">
                    📅 Due {t.due_date}
                  </span>
                )}
                {t.order_number && (
                  <span className="text-[10px] bg-slate-50 text-slate-500 px-2 py-0.5 rounded">
                    #{t.order_number}
                  </span>
                )}
              </div>
            </div>
            {needsAck && (
              <button onClick={(e) => { e.stopPropagation(); updateStatus(t, 'Acknowledged'); }}
                className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition">
                ✓ Acknowledge
              </button>
            )}
          </div>
        );
      })}
      {filtered.length === 0 && <div className="bg-white rounded-xl p-6 text-center text-slate-400 text-sm">No tickets</div>}
    </div>
    </>)}
  </div>);
}
