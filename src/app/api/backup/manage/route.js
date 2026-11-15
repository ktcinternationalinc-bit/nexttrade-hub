import { createClient } from '@supabase/supabase-js';
import { createBackupHandlers } from '../../../../lib/backup-handlers';

export var dynamic = 'force-dynamic';
export var runtime = 'nodejs';
var handlers = createBackupHandlers(createClient, process.env);
export async function POST(request) { return handlers.manage(request); }
export async function DELETE(request) { return handlers.remove(request); }
