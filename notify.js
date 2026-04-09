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
