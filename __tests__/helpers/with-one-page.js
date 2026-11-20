// v55.83-VV — since VV the bill reader is asked to say which pages of a PDF are the bill, and a several-files import
// refuses a PDF whose page answer is missing or contradictory. The older import tests feed the reader a canned answer
// written before those keys existed; this adds what a real reader now answers for a ONE-PAGE bill (page 1 is the bill).
// An answer that already speaks about pages, or is not JSON, is passed through untouched.
module.exports = function withOnePage(text) {
  try {
    var o = JSON.parse(text);
    if (!o || typeof o !== 'object' || Array.isArray(o) || 'page_count' in o || 'bill_pages' in o) { return text; }
    o.page_count = 1; o.bill_pages = [1]; o.other_pages = []; o.attached_release = null; o.attached_release_page = null;
    return JSON.stringify(o);
  } catch (e) { return text; }
};
