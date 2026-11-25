import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { authorizeBankVisibility } from '../../../../lib/bank-visibility.js';
import { createClickbooksReadHandler } from '../../../../lib/clickbooks-us-read.js';
export const dynamic = 'force-dynamic';
export const revalidate = 0; // v55.83-YY — already fresh; force-no-store + the no-store client added so every GET-only route follows one rule
export const fetchCache = 'force-no-store';
export const GET = createClickbooksReadHandler(function (request) {
  return authorizeBankVisibility(request, createClient, process.env);
}, process.env);
