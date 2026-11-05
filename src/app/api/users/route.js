import { createClient } from '@supabase/supabase-js';
import { createUserAdminHandlers } from '../../../lib/user-admin-handlers';

export const dynamic = 'force-dynamic';
const handlers = createUserAdminHandlers(createClient, process.env);
export async function POST(request) { return handlers.POST(request); }
export async function PUT(request) { return handlers.PUT(request); }
export async function DELETE(request) { return handlers.DELETE(request); }
