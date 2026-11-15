// v55.83-SN — helpers for showing the actual bill document on the Bills screen.
// Max, Nov 14: "How does one even read or view the bill, the actual bill in the bills area?"
// Bill documents are private: bucket 'bills-private', paths 'pv/…', signed links only.

export function docBucket(path) {
  return String(path || '').indexOf('pv/') === 0 ? 'bills-private' : 'attachments';
}

// 'pdf' | 'image' | 'other' | 'none'
export function docKind(path) {
  var p = String(path || '').trim().toLowerCase();
  if (!p) return 'none';
  var q = p.split('?')[0];
  if (/\.pdf$/.test(q)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp)$/.test(q)) return 'image';
  return 'other';
}

export function docName(path) {
  var p = String(path || '');
  var last = p.substring(p.lastIndexOf('/') + 1);
  return last.replace(/^\d{10,}-/, '') || 'bill';
}

// A new private storage path for a file being attached to a bill.
export function newDocPath(fileName, now) {
  var safe = String(fileName || 'bill').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60) || 'bill';
  return 'pv/' + String(now || Date.now()) + '-' + safe;
}

// The server accepts only a path this helper could have produced.
export function isPrivateDocPath(path) {
  return /^pv\/\d{10,}-[a-zA-Z0-9._-]{1,60}$/.test(String(path || ''));
}

export var DOC_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
export var DOC_MAX_BYTES = 15 * 1024 * 1024;
