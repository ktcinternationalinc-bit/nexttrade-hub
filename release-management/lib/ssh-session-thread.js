'use strict';
const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const { cfg, shared } = workerData;
const state = new Int32Array(shared, 0, 2);
let child; let pending; let buffer = ''; let failure = ''; let stderr = '';
function answer(value) {
  let bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > shared.byteLength - 8) bytes = Buffer.from(JSON.stringify({ code: 1, out: 'SSH response exceeded the safe limit.' }));
  new Uint8Array(shared, 8, bytes.length).set(bytes);
  Atomics.store(state, 1, bytes.length); Atomics.store(state, 0, 1); Atomics.notify(state, 0);
}
function fail(message) {
  failure = message;
  if (pending) { pending = null; answer({ code: 255, out: message }); }
}
function start() {
  child = spawn('ssh', ['-i', cfg.keyPath, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=yes', '-T', '-p', String(cfg.port), cfg.sshUser + '@' + cfg.host, 'sh'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.on('error', e => fail(e.message));
  child.stdin.on('error', e => fail(e.message));
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
  child.on('close', code => fail('SSH session ended (' + code + '). ' + stderr));
  child.stdout.on('data', data => {
    buffer += data.toString();
    if (!pending) return;
    const begin = buffer.indexOf(pending.begin + '\n');
    const end = buffer.indexOf('\n' + pending.end, begin + pending.begin.length);
    if (begin < 0 || end < 0) return;
    const tail = buffer.slice(end + pending.end.length + 1);
    const match = /^(\d+)\r?\n/.exec(tail);
    if (!match) return;
    const out = buffer.slice(begin + pending.begin.length + 1, end);
    buffer = ''; pending = null; answer({ code: Number(match[1]), out });
  });
}
parentPort.on('message', message => {
  if (message.kind === 'close') { if (child) { child.stdin.end(); child.kill(); } pending = null; answer({ code: 0, out: '' }); return; }
  if (failure) { answer({ code: 255, out: failure }); return; }
  try {
    if (!child) start();
    let cmd = message.cmd;
    if (message.kind === 'put') {
      if (!/^\/[A-Za-z0-9._\/-]+$/.test(message.remote) || message.remote.split('/').includes('..')) throw new Error('Unsafe upload path');
      const content = fs.readFileSync(message.local);
      if (content.length > 20 * 1024 * 1024) throw new Error('Artifact exceeds 20 MB limit');
      cmd = "printf '%s' '" + content.toString('base64') + "' | base64 -d > '" + message.remote + "'";
    }
    if (typeof cmd !== 'string') throw new Error('Command required');
    const nonce = crypto.randomBytes(16).toString('hex');
    pending = { begin: 'NT_START_' + nonce, end: 'NT_END_' + nonce + ':' };
    buffer = '';
    child.stdin.write("printf '" + pending.begin + "\\n'\n(\n" + cmd + "\n)\nnt_rc=$?\nprintf '\\n" + pending.end + "%s\\n' \"$nt_rc\"\n");
  } catch (e) { pending = null; answer({ code: 1, out: e.message }); }
});
parentPort.on('close', () => { if (child) child.kill(); });
