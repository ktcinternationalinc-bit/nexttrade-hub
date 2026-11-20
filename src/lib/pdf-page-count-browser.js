// v55.83-VV — how many pages a PDF has, counted IN THE BROWSER (nothing is uploaded for this). Used by bill import so the
// page list the reader reports can be compared with the real number of pages. Best effort: a locked or damaged PDF, or a
// slow reader, answers null and the import carries on without the count (the server then says the count was not checked).
// pdfjs-dist is loaded only when a PDF is actually picked (its own lazy chunk, shared with the Egypt Bank statement reader).
export async function pdfPageCountFromBase64(b64, waitMs) {
  try {
    var work = (async function () {
      var pdfjs = await import('pdfjs-dist/legacy/build/pdf');
      var worker = await import('pdfjs-dist/legacy/build/pdf.worker.entry');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default || worker;
      var bin = atob(String(b64 || ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
      var doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
      var n = doc.numPages;
      try { doc.destroy(); } catch (eD) { /* nothing to free */ }
      return (typeof n === 'number' && n >= 1) ? n : null;
    })();
    var guard = new Promise(function (res) { setTimeout(function () { res(null); }, waitMs || 6000); });
    return await Promise.race([work, guard]);
  } catch (e) { return null; }
}
