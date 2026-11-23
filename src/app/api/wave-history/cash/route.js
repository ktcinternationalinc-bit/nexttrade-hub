import { createHash } from 'node:crypto';
import { authorizeWaveHistory, waveHistoryRpc } from '../../../../lib/wave-history-server';
import { MAX_WAVE_CSV_BYTES, waveCurrency, WaveHistoryError } from '../../../../lib/wave-history';
import { parseWaveCashHistory, cashHistoryPeriod } from '../../../../lib/wave-cash-history';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function fail(error) {
  return reply({ error: error instanceof WaveHistoryError ? error.message : 'Cash history could not complete this request.' }, error.status || 500);
}
export async function GET(request) {
  try {
    const { db, mayManage } = await authorizeWaveHistory(request);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (q.source) {
      if (!/^\d+$/.test(q.source)) throw new WaveHistoryError('Invalid source.');
      const source = await waveHistoryRpc(db, 'wave_cash_source', { p_id: q.source });
      if (!source) throw new WaveHistoryError('Source not found.', 404);
      return new Response(source.raw_csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(source.file_name), 'Cache-Control': 'private, no-store' } });
    }
    const offset = Number(q.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || (q.account || '').length > 600) throw new WaveHistoryError('Invalid ledger page.');
    const data = await waveHistoryRpc(db, 'wave_cash_read', { ...cashHistoryPeriod(q.from, q.to),
      p_currency: waveCurrency(q.currency), p_account: q.account || null, p_offset: offset });
    return reply({ ...data, mayManage });
  } catch (error) { return fail(error); }
}
export async function POST(request) {
  try {
    const { db, actor, mayManage } = await authorizeWaveHistory(request);
    if (!mayManage) throw new WaveHistoryError('Wave History manage permission is required.', 403);
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await request.formData(), file = form.get('csv');
      if (!file?.size || typeof file.arrayBuffer !== 'function') throw new WaveHistoryError('Choose the original Wave CSV.');
      if (file.size > MAX_WAVE_CSV_BYTES) throw new WaveHistoryError('The CSV exceeds 3 MB.', 413);
      const currency = waveCurrency(form.get('currency'));
      if (form.get('confirmed') !== 'true') throw new WaveHistoryError('Confirm all accounts and the business currency.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let csv;
      try { csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new WaveHistoryError('Use the original UTF-8 export.'); }
      const parsed = parseWaveCashHistory(csv, currency);
      const fingerprint = createHash('sha256').update(currency).update(bytes).digest('hex');
      if (form.get('action') === 'preview') return reply({ preview: { ...parsed, entries: undefined, fingerprint, rows: parsed.entries.length } });
      if (form.get('action') !== 'save' || form.get('fingerprint') !== fingerprint) throw new WaveHistoryError('Preview this file before saving.', 409);
      const result = await waveHistoryRpc(db, 'wave_cash_save', { p_actor: actor, p_data: { ...parsed,
        fingerprint, raw_csv: csv, file_name: String(file.name || 'wave-cash.csv').slice(0, 240) } });
      return reply({ import: result });
    }
    const input = await request.json();
    if (input.action !== 'mapping' || typeof input.account !== 'string' || !input.account || input.account.length > 600 ||
        !['expense','income','other','unclassified'].includes(input.kind) || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
        [input.nextrade, input.ktc].some(v => v !== null && (typeof v !== 'string' || v.length > 100))) {
      throw new WaveHistoryError('Choose valid account classifications and category mappings.');
    }
    const mapping = await waveHistoryRpc(db, 'wave_cash_map', { p_actor: actor, p_account: input.account, p_kind: input.kind,
      p_nextrade: input.nextrade || null, p_ktc: input.ktc || null, p_revision: input.revision });
    return reply({ mapping });
  } catch (error) { return fail(error); }
}
