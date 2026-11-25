// v55.83-VG — reads the words of a PDF IN THE BROWSER (nothing is uploaded) and hands them to the statement reader.
// Kept in its own file so the Egypt Bank screen and the browser check run exactly the same code.
// pdfjs-dist is loaded only when a PDF is actually picked (its own lazy chunk); the worker runs on the main thread.
import { statementFromTextItems } from './pdf-statement';

export async function readPdfPagesInBrowser(arrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.entry');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default || worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false });
  const pages = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      pages.push(tc.items.map(i => {
        const [x, y] = viewport.convertToViewportPoint(i.transform[4], i.transform[5]);
        return { str: i.str, x, y: -y, w: i.width };
      }));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
export async function readPdfStatementInBrowser(arrayBuffer) { return statementFromTextItems(await readPdfPagesInBrowser(arrayBuffer)); }
