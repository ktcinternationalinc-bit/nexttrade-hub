// Creates only a dedicated release-worker secret, never a production database credential.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const file = process.argv[2];
if (!file || !path.isAbsolute(file)) throw new Error('An absolute private output path is required.');
fs.mkdirSync(path.dirname(file), { recursive: true });
const token = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(file, JSON.stringify({ token }) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ file, tokenHash: crypto.createHash('sha256').update(token).digest('hex') }));
