// NEXPAC expected vs actual — AI line matcher.
// Takes the expected (NEXPAC) lines + the actual received lines for ONE inbound
// shipment and asks Claude to match each expected line to the actual item(s) it
// corresponds to, then report the differences. Returns structured JSON.
//
// SWC/Vercel constraint: var + string concatenation only. No template literals.

export async function POST(req) {
  try {
    var body = await req.json();
    var expected = (body && body.expected) || [];
    var actual = (body && body.actual) || [];

    if (!expected.length && !actual.length) {
      return Response.json({ ok: false, error: 'Nothing to compare — no expected or actual lines were provided.' });
    }

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ ok: false, error: 'AI key not configured. Add ANTHROPIC_API_KEY in Vercel.' });
    }

    // Build compact, labeled tables so the model can reference rows by id.
    var expLines = '';
    var i;
    for (i = 0; i < expected.length; i++) {
      var e = expected[i];
      expLines += 'E' + (i + 1)
        + ' | grade=' + String(e.ktcGrade || e.nt_grade || '')
        + ' | sourceGrade=' + String(e.ntGrade || e.nt_grade || '')
        + ' | color=' + String(e.color || '')
        + ' | productType=' + String(e.productType || e.product_type || '')
        + ' | rolls=' + String(e.totalRolls != null ? e.totalRolls : (e.total_rolls != null ? e.total_rolls : ''))
        + ' | grossLbs=' + String(e.grossWeight != null ? e.grossWeight : (e.gross_weight != null ? e.gross_weight : ''))
        + ' | finalNetLbs=' + String(e.finalNetWeight != null ? e.finalNetWeight : (e.final_net_weight != null ? e.final_net_weight : ''))
        + ' | finalNetKg=' + String(e.finalNetWeightKg != null ? e.finalNetWeightKg : (e.final_net_weight_kg != null ? e.final_net_weight_kg : ''))
        + '\n';
    }
    var actLines = '';
    for (i = 0; i < actual.length; i++) {
      var a = actual[i];
      actLines += 'A' + (i + 1)
        + ' | sku=' + String(a.sku || '')
        + ' | description=' + String(a.description || '')
        + ' | qty=' + String(a.qty != null ? a.qty : '')
        + ' | unit=' + String(a.unit || '')
        + ' | rolls=' + String(a.rolls != null ? a.rolls : '')
        + ' | received=' + String(a.received != null ? a.received : '')
        + '\n';
    }

    var system = 'You match leather inbound shipment lines. The EXPECTED lines come from a NEXPAC mill report, grouped by grade and color (grade tiers: Stock, Standard Premium, Fortis, Luxurious). The ACTUAL lines are SKU items the warehouse selected/received. '
      + 'Match each ACTUAL item to the single EXPECTED line it most likely belongs to, using grade words (grade A/thirds/seconds=Stock, premium=Standard Premium, suede=Fortis, obsolete=Luxurious), color words, and roll/weight closeness. One expected line can have several actual items. Some lines on either side may have no match. '
      + 'Be precise and conservative: if a match is uncertain, mark confidence "low" and explain. Compute roll and weight differences (actual minus expected). '
      + 'Respond with ONLY valid JSON, no prose, no markdown fences. Shape: '
      + '{"matches":[{"expectedId":"E1","actualIds":["A1","A2"],"expectedRolls":number,"actualRolls":number,"rollDiff":number,"expectedNetKg":number,"confidence":"high|medium|low","note":"short reason"}],'
      + '"unmatchedExpected":["E3"],"unmatchedActual":["A5"],"summary":"one sentence overall"}';

    var userMsg = 'EXPECTED (NEXPAC):\n' + (expLines || '(none)') + '\nACTUAL (received):\n' + (actLines || '(none)') + '\n\nReturn the JSON now.';

    var models = ['claude-sonnet-4-6', 'claude-haiku-4-5'];
    var lastErr = '';
    var mi;
    for (mi = 0; mi < models.length; mi++) {
      try {
        var resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: models[mi],
            max_tokens: 1500,
            system: system,
            messages: [{ role: 'user', content: userMsg }],
          }),
        });
        if (!resp.ok) { lastErr = 'HTTP ' + resp.status + ' on ' + models[mi]; continue; }
        var data = await resp.json();
        var text = '';
        if (data && data.content && data.content.length) {
          var c;
          for (c = 0; c < data.content.length; c++) {
            if (data.content[c] && data.content[c].type === 'text') text += data.content[c].text;
          }
        }
        var clean = String(text).replace(/[\u0060]/g, '').trim();
        var first = clean.indexOf('{');
        var last = clean.lastIndexOf('}');
        if (first >= 0 && last > first) clean = clean.substring(first, last + 1);
        var parsed;
        try { parsed = JSON.parse(clean); }
        catch (pe) { lastErr = 'Could not read the AI response.'; continue; }
        return Response.json({ ok: true, model: models[mi], result: parsed });
      } catch (innerErr) {
        lastErr = (innerErr && innerErr.message) || String(innerErr);
      }
    }
    return Response.json({ ok: false, error: lastErr || 'AI request failed.' });
  } catch (err) {
    return Response.json({ ok: false, error: (err && err.message) || String(err) });
  }
}
