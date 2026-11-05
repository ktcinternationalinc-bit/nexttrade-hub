import { authorizeBackupAdmin, authorizeBackupCron, backupId, backupQuery, readBackupJson, backupNotes, backupJson, backupErrorResponse, backupDownload, redactBackupData, BackupError } from './backup-security.js';
import { createBusinessBackup } from './backup-snapshot.js';

// Tests inject the snapshot worker, never a weaker authorization policy.
export function createBackupHandlers(createClient, env, snapshotWorker) {
  var snapshot = snapshotWorker || createBusinessBackup;
  async function list(request) {
    try {
      var access = await authorizeBackupAdmin(request, createClient, env);
      backupQuery(request, []);
      var result = await access.db.from('backups')
        .select('id,created_at,kind,triggered_by,triggered_by_name,tables_included,row_counts,size_bytes,duration_ms,notes,pinned')
        .order('created_at', { ascending: false }).limit(200);
      if (result.error) throw new Error('Backup storage unavailable');
      return backupJson({ ok: true, backups: redactBackupData({ metadata: result.data || [] }, env).data.metadata });
    } catch (error) { return backupErrorResponse(error); }
  }
  async function download(request) {
    try {
      var access = await authorizeBackupAdmin(request, createClient, env);
      var id = backupId(backupQuery(request, ['id']).get('id'));
      var result = await access.db.from('backups').select('*').eq('id', id).maybeSingle();
      if (result.error) throw new Error('Backup storage unavailable');
      if (!result.data) throw new BackupError('This backup was not found.', 404);
      var file = backupDownload(result.data, env);
      // The filename uses a validated UUID, never stored/user-controlled text.
      return backupJson(file, 200, { 'Content-Disposition': 'attachment; filename="ktc-backup-' + id + '.json"' });
    } catch (error) { return backupErrorResponse(error); }
  }
  async function remove(request) {
    try {
      var access = await authorizeBackupAdmin(request, createClient, env);
      var id = backupId(backupQuery(request, ['id']).get('id'));
      var result = await access.db.from('backups').delete().eq('id', id).select('id').maybeSingle();
      if (result.error) throw new Error('Backup deletion failed');
      if (!result.data) throw new BackupError('This backup was not found.', 404);
      return backupJson({ ok: true, id: id });
    } catch (error) { return backupErrorResponse(error); }
  }
  async function manage(request) {
    try {
      var access = await authorizeBackupAdmin(request, createClient, env);
      backupQuery(request, []);
      var body = await readBackupJson(request), id = backupId(body.id), update = {};
      if (Object.keys(body).some(function (key) { return !['id', 'pinned', 'notes'].includes(key); })) throw new BackupError('Invalid backup change.', 400);
      if (body.pinned !== undefined) {
        if (typeof body.pinned !== 'boolean') throw new BackupError('Choose an explicit pin setting.', 400);
        update.pinned = body.pinned;
      }
      if (body.notes !== undefined) update.notes = backupNotes(body.notes);
      if (!Object.keys(update).length) throw new BackupError('Choose a backup change.', 400);
      var result = await access.db.from('backups').update(update).eq('id', id).select('id,pinned,notes').maybeSingle();
      if (result.error) throw new Error('Backup update failed');
      if (!result.data) throw new BackupError('This backup was not found.', 404);
      return backupJson({ ok: true, backup: result.data });
    } catch (error) { return backupErrorResponse(error); }
  }
  async function manualSnapshot(request) {
    try {
      var access = await authorizeBackupAdmin(request, createClient, env);
      backupQuery(request, []);
      var body = await readBackupJson(request);
      if (body.kind !== undefined && body.kind !== 'manual') throw new BackupError('Interactive backups use the manual snapshot type.', 400);
      if (body.pinned !== undefined && typeof body.pinned !== 'boolean') throw new BackupError('Choose an explicit pin setting.', 400);
      // Ignore legacy claimed actor fields; the verified identity is authoritative.
      var result = await snapshot(access.db, { kind: 'manual', triggered_by: access.profileId,
        triggered_by_name: 'Verified super admin', notes: backupNotes(body.notes), pinned: body.pinned === true }, env);
      return backupJson(result);
    } catch (error) { return backupErrorResponse(error); }
  }
  async function scheduledSnapshot(request) {
    try {
      var db = authorizeBackupCron(request, createClient, env);
      var kind = backupQuery(request, ['kind']).get('kind');
      if (kind && !['daily', 'weekly', 'monthly'].includes(kind)) throw new BackupError('Choose a scheduled snapshot type.', 400);
      if (kind) return backupJson(await snapshot(db, { kind: kind, triggered_by: null, triggered_by_name: 'Scheduled backup' }, env));
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', day: 'numeric' }).formatToParts(new Date());
      var weekday = parts.find(function (part) { return part.type === 'weekday'; })?.value;
      var day = parts.find(function (part) { return part.type === 'day'; })?.value;
      var kinds = ['daily'];
      if (weekday === 'Sun') kinds.push('weekly');
      if (day === '1') kinds.push('monthly');
      var results = [];
      for (var i = 0; i < kinds.length; i++) results.push(await snapshot(db, { kind: kinds[i], triggered_by: null, triggered_by_name: 'Scheduled backup' }, env));
      return backupJson({ ok: true, snapshots: results });
    } catch (error) { return backupErrorResponse(error); }
  }
  return { list: list, download: download, remove: remove, manage: manage, manualSnapshot: manualSnapshot, scheduledSnapshot: scheduledSnapshot };
}
