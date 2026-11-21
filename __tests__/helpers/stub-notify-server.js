// Test stand-in for src/lib/notify-server.js: records every e-mail the route asks for and answers like the real sender
// ({ attempted, sent, skipped }). global.__mailMode = 'ok' | 'off' (mail service not set up) | 'throw'.
global.__mails = global.__mails || [];
async function notifyServer(type, ids, subject, body, by) {
  global.__mails.push({ type: type, ids: ids.slice(), subject: subject, body: body, by: by });
  if (global.__mailMode === 'throw') { throw new Error('mail service down'); }
  if (global.__mailMode === 'off') { return { attempted: ids.length, sent: 0, skipped: ids.length }; }
  return { attempted: ids.length, sent: ids.length, skipped: 0 };
}
module.exports = { notifyServer: notifyServer };
