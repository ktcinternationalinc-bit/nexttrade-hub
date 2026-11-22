import { createHash } from 'node:crypto';
import {
  authorizeWaveHistory, composeWaveHistoryReport, getWaveHistoryComparison,
  WAVE_HISTORY_BUSINESS, waveHistoryRpc, waveReportParameters,
} from '../../../lib/wave-history-server';
import { MAX_WAVE_CSV_BYTES, parseWaveLedger, readWaveMinor, WaveHistoryError, waveCurrency, waveMonth } from '../../../lib/wave-history';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function respond(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function fail(error) {
  if (error instanceof WaveHistoryError) return respond({ error: error.message }, error.status);
  console.error('[wave-history] unexpected error', error?.name);
  return respond({ error: 'Wave History could not complete this request.' }, 500);
}

export async function GET(request) {
  try {
    const { db, mayViewInventory, mayManage } = await authorizeWaveHistory(request);
    const search = Object.fromEntries(new URL(request.url).searchParams);
    if (search.action === 'access') return respond({ mayManage });
    const params = waveReportParameters(search);
    if (search.action !== 'entries') {
      return respond({ comparison: await getWaveHistoryComparison(db, params), mayViewInventory, mayManage });
    }
    const period = search.period === 'prior' ? params.periods.prior : params.periods.current;
    const offset = Number(search.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 || (search.account || '').length > 600) {
      throw new WaveHistoryError('Invalid ledger page or account.');
    }
    const rows = await waveHistoryRpc(db, 'wave_history_entries', {
      p_business: WAVE_HISTORY_BUSINESS, p_currency: params.currency, p_from: period.start,
      p_until: period.end, p_account: search.account || null, p_offset: offset,
    });
    return respond({ rows: rows.slice(0, 100), hasMore: rows.length > 100 });
  } catch (error) {
    return fail(error);
  }
}

async function importMonth(request, db, actor) {
  let form;
  try { form = await request.formData(); }
  catch { throw new WaveHistoryError('Choose a Wave CSV to upload.'); }
  const file = form.get('csv');
  if (!file || typeof file.arrayBuffer !== 'function' || !file.size) throw new WaveHistoryError('Choose a Wave CSV to upload.');
  if (file.size > MAX_WAVE_CSV_BYTES) throw new WaveHistoryError('The monthly CSV exceeds the 3 MB upload limit.', 413);
  const month = waveMonth(form.get('month'));
  const currency = waveCurrency(form.get('currency'));
  const waveProfile = String(form.get('waveProfile') || '').trim().replace(/\s+/g, ' ');
  if (!waveProfile || waveProfile.length > 160) throw new WaveHistoryError('Enter the source business profile exactly as shown in Wave.');
  if (form.get('allAccounts') !== 'true') throw new WaveHistoryError('Confirm that the CSV covers all accounts on an accrual basis.');
  const pMonth = month + '-01';
  const bytes = new Uint8Array(await file.arrayBuffer());
  let csv;
  try { csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new WaveHistoryError('Use the original UTF-8 CSV downloaded from Wave.'); }
  const fingerprint = createHash('sha256').update(JSON.stringify([month, currency, waveProfile])).update(bytes).digest('hex');
  const ledger = parseWaveLedger(csv, month, currency);
  const debitText = String(form.get('waveDebit') || '').trim();
  const creditText = String(form.get('waveCredit') || '').trim();
  const expectedDebit = debitText ? readWaveMinor(debitText, currency, 'Wave debit total') : null;
  const expectedCredit = creditText ? readWaveMinor(creditText, currency, 'Wave credit total') : null;
  const balanced = ledger.debit === ledger.credit;
  const matchesWave = balanced && ledger.debit === expectedDebit && ledger.credit === expectedCredit;

  if (form.get('action') !== 'save') {
    const existing = await waveHistoryRpc(db, 'wave_history_month', { p_business: WAVE_HISTORY_BUSINESS, p_month: pMonth });
    return respond({
      preview: {
        fingerprint, existing, rowCount: ledger.entries.length, debit: ledger.debit, credit: ledger.credit,
        expectedDebit, expectedCredit, balanced, matchesWave, unclassified: ledger.unclassified, accounts: ledger.accounts,
      },
    });
  }
  if (!matchesWave) throw new WaveHistoryError('The CSV must balance and match both independent Wave totals before saving.', 422);
  const revision = String(form.get('revision') || '');
  if (fingerprint !== form.get('fingerprint') || !/^\d{1,9}$/.test(revision)) {
    throw new WaveHistoryError('Run a preview of this file and report scope before saving.', 409);
  }
  const result = await waveHistoryRpc(db, 'wave_history_save_month', {
    p_business: WAVE_HISTORY_BUSINESS, p_month: pMonth, p_currency: currency,
    p_wave_profile: waveProfile, p_file_name: String(file.name || 'wave-ledger.csv').slice(0, 240), p_fingerprint: fingerprint,
    p_revision: Number(revision), p_debit: expectedDebit, p_credit: expectedCredit, p_actor: actor, p_entries: ledger.entries,
  });
  return respond({ import: { month, revision: result.revision, rows: result.row_count, unchanged: result.unchanged } });
}

export async function POST(request) {
  try {
    const { db, actor, mayManage, mayViewInventory } = await authorizeWaveHistory(request);
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      if (!mayManage) throw new WaveHistoryError('You do not have permission to import Wave History.', 403);
      return await importMonth(request, db, actor);
    }
    let input;
    try { input = await request.json(); }
    catch { throw new WaveHistoryError('Invalid Wave History request.'); }
    if (input?.action === 'compose') {
      return respond(await composeWaveHistoryReport(db, waveReportParameters(input), input, mayViewInventory));
    }
    if (input?.action === 'category') {
      if (!mayManage) throw new WaveHistoryError('You do not have permission to edit Wave History categories.', 403);
      const { account, category } = input;
      if (typeof account !== 'string' || !account || account.length > 600 || typeof category !== 'string' || category.trim().length > 100) {
        throw new WaveHistoryError('Choose a Wave account and a category of up to 100 characters.');
      }
      await waveHistoryRpc(db, 'wave_history_set_category', {
        p_business: WAVE_HISTORY_BUSINESS, p_account: account, p_category: category.trim() || null,
      });
      return respond({ saved: true });
    }
    throw new WaveHistoryError('Unknown Wave History action.');
  } catch (error) {
    return fail(error);
  }
}
