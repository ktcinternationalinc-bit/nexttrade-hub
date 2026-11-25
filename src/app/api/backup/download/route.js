import { createNoStoreClient as createClient } from '../../../../lib/no-store-db'; // v55.83-YY — every read fresh (no Data Cache)
import { createBackupHandlers } from '../../../../lib/backup-handlers';
// v55.83-YY — this GET-only route never keeps its reads in Next's Data Cache (it would otherwise keep them forever, across deployments)
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export var dynamic = 'force-dynamic';
export var runtime = 'nodejs';
var handlers = createBackupHandlers(createClient, process.env);
export var maxDuration = 60;
export async function GET(request) { return handlers.download(request); }
