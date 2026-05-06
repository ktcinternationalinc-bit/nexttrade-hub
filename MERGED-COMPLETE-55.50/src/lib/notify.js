// Fire-and-forget notification sender
// Usage: notify('ticket_assigned', [userId1, userId2], 'New Ticket #123', '<p>You were assigned...</p>', currentUserId)
export function notify(type, recipientIds, subject, body, triggeredBy) {
  if (!recipientIds?.length) return;
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, recipientIds, subject, body, triggeredBy }),
  }).catch(() => {}); // silent fail — notifications should never block UI
}

// Convenience helpers
export const notifyTicketAssigned = (assigneeIds, ticketTitle, triggeredBy) =>
  notify('ticket_assigned', assigneeIds, `Ticket Assigned: ${ticketTitle}`,
    `<p>You have been assigned to ticket: <strong>${ticketTitle}</strong></p>`, triggeredBy);

export const notifyTicketStatus = (assigneeIds, ticketTitle, newStatus, triggeredBy) =>
  notify('ticket_status', assigneeIds, `Ticket Status → ${newStatus}: ${ticketTitle}`,
    `<p>Ticket <strong>${ticketTitle}</strong> status changed to <strong>${newStatus}</strong></p>`, triggeredBy);

export const notifyTicketComment = (assigneeIds, ticketTitle, commentPreview, triggeredBy) =>
  notify('ticket_comment', assigneeIds, `New Comment on: ${ticketTitle}`,
    `<p>New comment on <strong>${ticketTitle}</strong>:</p><p style="color:#64748b;font-style:italic;">"${commentPreview.slice(0, 200)}"</p>`, triggeredBy);

export const notifyTicketReassigned = (newAssigneeIds, ticketTitle, triggeredBy) =>
  notify('ticket_reassigned', newAssigneeIds, `Ticket Reassigned: ${ticketTitle}`,
    `<p>You have been reassigned to ticket: <strong>${ticketTitle}</strong></p>`, triggeredBy);

// v55.44 — Ticket priority change. Goes to creator + all assignees.
export const notifyTicketPriority = (recipientIds, ticketTitle, oldPri, newPri, triggeredBy) =>
  notify('ticket_priority', recipientIds, `Priority Changed: ${ticketTitle}`,
    `<p>Priority on <strong>${ticketTitle}</strong> changed: <strong>${(oldPri || 'none').toUpperCase()}</strong> → <strong>${(newPri || 'none').toUpperCase()}</strong></p>`, triggeredBy);

// v55.44 — Ticket due-date change. Goes to creator + all assignees.
export const notifyTicketDueDate = (recipientIds, ticketTitle, oldDate, newDate, triggeredBy) =>
  notify('ticket_due_date', recipientIds, `Due Date Changed: ${ticketTitle}`,
    `<p>Due date on <strong>${ticketTitle}</strong> changed: <strong>${oldDate || 'no date'}</strong> → <strong>${newDate || 'no date'}</strong></p>`, triggeredBy);

// v55.44 — Generic ticket update (title/description/etc.). Goes to creator + all assignees.
export const notifyTicketUpdate = (recipientIds, ticketTitle, whatChanged, triggeredBy) =>
  notify('ticket_update', recipientIds, `Ticket Updated: ${ticketTitle}`,
    `<p>${whatChanged || 'A ticket you\'re on has been updated'}: <strong>${ticketTitle}</strong></p>`, triggeredBy);

// v55.44 — Helper: build the recipient list for a ticket update.
// Returns deduped list of: creator + current assignee + additional_assignees,
// minus the actor themselves (don't notify yourself about your own change).
// Pass the parsed-assignees array as the optional second argument; if omitted,
// the function tries to read additional_assignees from the ticket.
export function ticketRecipients(ticket, actorId, parsedExtras) {
  if (!ticket) return [];
  const ids = new Set();
  if (ticket.assigned_to) ids.add(ticket.assigned_to);
  if (ticket.created_by) ids.add(ticket.created_by);
  let extras = parsedExtras;
  if (!extras) {
    try {
      const raw = ticket.additional_assignees;
      if (raw) extras = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) { extras = []; }
  }
  if (Array.isArray(extras)) extras.forEach(id => { if (id) ids.add(id); });
  if (actorId) ids.delete(actorId); // never notify yourself about your own change
  return Array.from(ids).filter(Boolean);
}

export const notifyEventScheduled = (attendeeIds, eventTitle, date, triggeredBy) =>
  notify('event_scheduled', attendeeIds, `Event: ${eventTitle}`,
    `<p>You have been invited to: <strong>${eventTitle}</strong> on <strong>${date}</strong></p>`, triggeredBy);

export const notifyFollowUp = (assigneeIds, clientName, note, triggeredBy) =>
  notify('followup_created', assigneeIds, `Follow-up: ${clientName}`,
    `<p>New follow-up scheduled for <strong>${clientName}</strong></p><p>${note?.slice(0, 200) || ''}</p>`, triggeredBy);

export const notifyShippingRate = (userIds, origin, destination, triggeredBy) =>
  notify('shipping_rate_added', userIds, `New Shipping Rate: ${origin} → ${destination}`,
    `<p>A new shipping rate has been added from <strong>${origin}</strong> to <strong>${destination}</strong></p>`, triggeredBy);

export const notifyShippingBooked = (userIds, bookingRef, triggeredBy) =>
  notify('shipping_rate_booked', userIds, `Shipping Booked: ${bookingRef}`,
    `<p>Shipping booking confirmed: <strong>${bookingRef}</strong></p>`, triggeredBy);

export const notifyCRMStatus = (repIds, clientName, newStage, triggeredBy) =>
  notify('crm_status_change', repIds, `CRM: ${clientName} → ${newStage}`,
    `<p>Client <strong>${clientName}</strong> moved to <strong>${newStage}</strong></p>`, triggeredBy);

export const notifyClientAssigned = (repIds, clientName, triggeredBy) =>
  notify('client_assigned', repIds, `Client Assigned: ${clientName}`,
    `<p>You have been assigned as rep for <strong>${clientName}</strong></p>`, triggeredBy);
