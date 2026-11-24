'use strict';
// Keep the synchronous deployment engine, but use ONE authenticated SSH connection.
// The worker thread handles asynchronous SSH I/O while the engine waits for each result.
const { Worker } = require('worker_threads');
const path = require('path');
function session(cfg) {
  const shared = new SharedArrayBuffer(4 * 1024 * 1024);
  const state = new Int32Array(shared, 0, 2);
  let worker; let closed = false;
  function call(message, timeout = 180000) {
    if (closed) return { code: 1, out: 'SSH session is closed.' };
    if (!worker) {
      worker = new Worker(path.join(__dirname, 'ssh-session-thread.js'), { workerData: { cfg, shared } });
      worker.on('error', () => {}); worker.unref();
    }
    Atomics.store(state, 0, 0);
    worker.postMessage(message);
    if (Atomics.wait(state, 0, 0, timeout) === 'timed-out') {
      closed = true; worker.postMessage({ kind: 'close' }); worker.unref();
      return { code: 1, out: 'SSH operation timed out. Session closed; do not retry an uncertain write.' };
    }
    return JSON.parse(Buffer.from(new Uint8Array(shared, 8, Atomics.load(state, 1))).toString());
  }
  function close() {
    if (!closed && worker) { call({ kind: 'close' }, 5000); closed = true; worker.terminate(); }
  }
  process.once('exit', close);
  return { run: cmd => call({ kind: 'run', cmd }), put: (local, remote) => call({ kind: 'put', local, remote }), close };
}
module.exports = { session };
