// Bearer-authenticated same-origin backup requests. Downloads use this helper
// too; a window.open URL cannot carry the signed-in user's authorization.
export async function fetchBackup(supabase, url, init) {
  if (typeof url !== 'string' || !/^\/api\/backup\/(?:list|download|manage|snapshot)(?:\?|$)/.test(url)) throw new Error('Invalid backup endpoint.');
  var session = await supabase.auth.getSession();
  var token = session?.data?.session?.access_token;
  if (session?.error || typeof token !== 'string' || !token) throw new Error('Sign in again to access backups.');
  var headers = new Headers(init && init.headers);
  headers.set('Authorization', 'Bearer ' + token);
  if (init && !['GET', 'HEAD'].includes(init.method || 'GET')) headers.set('Content-Type', 'application/json');
  return fetch(url, Object.assign({}, init, { headers: headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
}
