// test stand-in for src/lib/verified-caller.js: the in-memory tests have no sign-in server, so the caller is the user in the body.
// A body with { _no_token: true } behaves like a request without a valid sign-in (401).
module.exports = { verifiedCaller: function (req, body) { if (body && body._no_token) { return Promise.resolve({ error: 'Sign in again — your sign-in could not be verified.', status: 401 }); } return Promise.resolve({ userId: body && body.user_id }); } };
