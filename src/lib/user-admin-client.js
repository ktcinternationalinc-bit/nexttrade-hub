// This helper forwards the signed-in browser's real Supabase session only to
// the same-origin users endpoint. The server independently verifies the token.
export async function fetchUserAdmin(supabase, url, init) {
  if (typeof url !== 'string' || !/^\/api\/users(?:\?|$)/.test(url)) throw new Error('Invalid team administration endpoint.');
  var result = await supabase.auth.getSession();
  var token = result && result.data && result.data.session && result.data.session.access_token;
  if (!result || result.error || typeof token !== 'string' || !token) throw new Error('Sign in again to administer team members.');
  var headers = new Headers(init && init.headers);
  headers.set('Authorization', 'Bearer ' + token);
  headers.set('Content-Type', 'application/json');
  return fetch(url, Object.assign({}, init, { headers: headers, credentials: 'same-origin' }));
}
