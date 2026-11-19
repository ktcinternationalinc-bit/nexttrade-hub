// v55.83-VG — reads the words of a PDF IN THE BROWSER (nothing is uploaded) and hands them to the statement reader.
// Kept in its own file so the Egypt Bank screen and the browser check run exactly the same code.
// pdfjs-dist is loaded only when a PDF is actually picked (its own lazy chunk); the worker runs on the main thread.
import { statementFromTextItems } from './pdf-statement';

export async function readPdfPagesInBrowser(arrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.entry');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default || worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    pages.push(tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
  }
  return pages;
}
export async function readPdfStatementInBrowser(arrayBuffer) { return statementFromTextItems(await readPdfPagesInBrowser(arrayBuffer)); }
