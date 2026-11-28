'use strict';
const { SCHEMA_WORKER_VERSION } = require('./selection');
function channel(url, token) {
  if (url !== 'https://nexttrade-hub.vercel.app') throw new Error('Unexpected Hub worker endpoint.');
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Invalid worker credential.');
  async function call(body) {
    const response = await fetch(url + '/api/releases/worker', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    return response.json();
  }
  return {
    authorize: async (userId, requireSuperAdmin) => { const r = await call({ op: 'authorized', userId, requireSuperAdmin: requireSuperAdmin === true }); if (r.error) throw new Error(r.error.message); return r.data === true; },
    from(table) {
      let requests = false; let enabled;
      if (!['release_signoffs', 'release_worker_status'].includes(table)) throw new Error('Worker channel cannot access this table.');
      const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, in() { requests = true; return q; },
        upsert(row) { enabled = row.enabled === true; return q; },
        then(resolve, reject) { return call(table === 'release_worker_status' ? { op: 'heartbeat', enabled, version: SCHEMA_WORKER_VERSION } : { op: requests ? 'requests' : 'history' }).then(resolve, reject); } };
      return q;
    },
    rpc(name, p) {
      if (name === 'release_claim') return call({ op: 'claim', request: p.p_request, version: SCHEMA_WORKER_VERSION });
      if (name === 'release_finish') return call({ op: 'finish', request: p.p_request, event: p.p_event, attention: p.p_attention });
      throw new Error('Worker channel cannot call this function.');
    }
  };
}
module.exports = { channel };
