// v55.83-VG — Egypt Bank import: is a row already in the bank table? Moved WORD FOR WORD out of EgyptBankTab.jsx (v55.83-A.6.14,
// Max May 14 2026) so it can be tested, e.g. the same statement imported once from Excel and again from PDF. Pure: it is handed
// the rows to import and every existing bank row; it reads and writes nothing.
//   CLEAN    — no match anywhere → imported
//   EXACT    — same date + amount + first 60 characters of the description, in ANY account → skipped
//   POSSIBLE — same date + amount with a different description, or same amount within 2 days with a similar description → a person decides
export function classifyAgainstExisting(toImport, allExisting) {
    // Build lookup index: key = date|amount|desc60, value = list of existing rows
    var exactIndex = {};
    var amountDateIndex = {}; // key = date|amount (for cross-description match)
    allExisting.forEach(function (e) {
      var dsc60 = (e.description || '').substring(0, 60).trim().toLowerCase();
      var key = e.date + '|' + e.amount + '|' + dsc60;
      if (!exactIndex[key]) exactIndex[key] = [];
      exactIndex[key].push(e);
      var ak = e.date + '|' + e.amount;
      if (!amountDateIndex[ak]) amountDateIndex[ak] = [];
      amountDateIndex[ak].push(e);
    });

    var classified = toImport.map(function (row) {
      var dsc60 = (row.description || '').substring(0, 60).trim().toLowerCase();
      var key = row.date + '|' + row.amount + '|' + dsc60;
      var exactMatches = exactIndex[key] || [];
      if (exactMatches.length > 0) {
        return { row: row, status: 'exact', matches: exactMatches, decision: 'skip' };
      }
      // Same date + amount but different description?
      var ak = row.date + '|' + row.amount;
      var sameDayAmount = (amountDateIndex[ak] || []).filter(function (e) {
        var edsc = (e.description || '').substring(0, 60).trim().toLowerCase();
        return edsc !== dsc60;
      });
      if (sameDayAmount.length > 0) {
        return { row: row, status: 'possible', matches: sameDayAmount, decision: 'review' };
      }
      // Adjacent date (±2 days), same amount, similar description?
      var rowDate = new Date(row.date);
      var nearMatches = allExisting.filter(function (e) {
        if (e.amount !== row.amount) return false;
        var ed = new Date(e.date);
        var diffDays = Math.abs((ed - rowDate) / 86400000);
        if (diffDays > 2 || diffDays === 0) return false;
        var edsc = (e.description || '').substring(0, 40).trim().toLowerCase();
        var rdsc = (row.description || '').substring(0, 40).trim().toLowerCase();
        // Both strings contain a common token longer than 6 chars
        if (edsc.length === 0 || rdsc.length === 0) return false;
        return edsc === rdsc || (edsc.length > 10 && rdsc.includes(edsc.substring(0, 10))) || (rdsc.length > 10 && edsc.includes(rdsc.substring(0, 10)));
      });
      if (nearMatches.length > 0) {
        return { row: row, status: 'possible', matches: nearMatches, decision: 'review' };
      }
      return { row: row, status: 'clean', matches: [], decision: 'import' };
    });
    return classified;
}
