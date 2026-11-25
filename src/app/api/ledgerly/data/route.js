import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { createLedgerlyDataHandler } from '../../../../lib/ledgerly-data-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0; // v55.83-YY — already fresh; force-no-store + the no-store client added so every GET-only route follows one rule
export const fetchCache = 'force-no-store';
var readData = createLedgerlyDataHandler(createClient, process.env);
export async function GET(request) { return readData(request); }
