import { createClient } from '@supabase/supabase-js';
import { createBackupHandlers } from '../../../../lib/backup-handlers';

export var dynamic = 'force-dynamic';
export var runtime = 'nodejs';
var handlers = createBackupHandlers(createClient, process.env);
export var maxDuration = 60;
export async function GET(request) { return handlers.download(request); }
