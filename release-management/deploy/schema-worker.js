'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isSchemaRelease } = require('../lib/selection');
const { migrationFiles, uploadMigrationFiles } = require('./warehouse-data-plan');

const SCRIPT = path.join(__dirname, 'warehouse-schema-release.php');
const APP = '/home/nextueoa/public_html';
const BACKUPS = '/home/nextueoa/code-backups';

const FREEZE = String.raw`
    $freeze = static function () use ($settings) {
        $path = $settings['marker'];
        if (is_link($path) || !is_file($path) || (fileperms($path) & 0077) !== 0 ||
            fileowner($path) !== fileowner(dirname($settings['app'])) || !is_file($settings['app'] . '/storage/framework/down')) {
            throw new RuntimeException('The approved Warehouse write freeze is unavailable.');
        }
        $permit = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        $expiry = is_string($permit['expiresAt'] ?? null) ? strtotime($permit['expiresAt']) : false;
        if (($permit['requestId'] ?? null) !== $settings['request'] || ($permit['build'] ?? '') !== $settings['build'] ||
            ($permit['phase'] ?? '') !== 'writers-paused' || $expiry <= time() || $expiry > time() + 3600) {
            throw new RuntimeException('The write freeze does not cover this exact request and active window.');
        }
    };
    $freeze();
`;
function runProgram(runner, settings, php) {
  const encoded = Buffer.from(JSON.stringify(settings)).toString('base64');
  const program = "<?php\ndeclare(strict_types=1);\n$settings = json_decode(base64_decode('" + encoded + "'), true, 512, JSON_THROW_ON_ERROR);\n" + php;
  const payload = Buffer.from(program).toString('base64');
  return runner.run("cd '" + APP + "' && printf '%s' '" + payload + "' | base64 -d | /usr/local/bin/php");
}
function releaseSettings(item, requestId) {
  return { app: APP, marker: BACKUPS + '/warehouse-maintenance/request-' + requestId + '.json',
    request: requestId, build: item.manifest.sha, kind: item.manifest.dataPlan.kind };
}
function schemaWindow(item, requestId, config, runner) {
  if (!isSchemaRelease(item) || !Number.isSafeInteger(requestId) || requestId < 1 ||
      config.live.appRoot !== '~/public_html' || config.live.backupRoot !== '~/code-backups') return false;
  return runProgram(runner, releaseSettings(item, requestId), FREEZE).code === 0;
}
const BOOTSTRAP = String.raw`
    if (realpath(getcwd()) !== $settings['app']) throw new RuntimeException('Wrong Warehouse app directory.');
    require 'vendor/autoload.php';
    $app = require 'bootstrap/app.php';
    $kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();
    if (!$app->isDownForMaintenance()) throw new RuntimeException('The Warehouse application is accepting writes.');
`;
const MIGRATE = String.raw`
    $db = $app->make('db')->connection()->getPdo();
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $paths = $settings['files'];
    foreach ($paths as $index => $file) {
        if (!is_file($file) || is_link($file) || hash_file('sha256', $file) !== $settings['hashes'][$index]) {
            throw new RuntimeException('The reviewed migration bytes changed.');
        }
    }
    $result = warehouseSchemaRelease($db, $settings['kind'], $settings['request'], $paths, static function () use ($kernel, $paths) {
        if ($kernel->call('migrate', ['--force' => true, '--realpath' => true, '--path' => $paths]) !== 0) {
            throw new RuntimeException('A reviewed migration did not complete.');
        }
    }, $freeze);
    echo json_encode(['state' => 'ready', 'proof' => $result], JSON_THROW_ON_ERROR);
`;
const VERIFY = String.raw`
    if ($kernel->call('route:list', ['--path' => 'admin']) !== 0) throw new RuntimeException('New Warehouse code could not load its routes.');
    $freeze();
    echo '{"state":"ready"}';
`;

function loadSchemaRelease(item, requestId, warehouseRepo, tmpDir, runner) {
  if (!isSchemaRelease(item) || !Number.isSafeInteger(requestId) || requestId < 1) throw new Error('Unrecognized Warehouse schema release.');
  const source = fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');
  if (createHash('sha256').update(source).digest('hex') !== item.manifest.dataPlan.scriptHash) {
    throw new Error('The reviewed Warehouse schema program fingerprint differs.');
  }
  const migrations = migrationFiles(item, warehouseRepo, tmpDir);
  function run({ appRoot, backupDir }, body, files = []) {
    if (appRoot !== APP || !new RegExp('^' + BACKUPS + '/request-' + requestId + '-[0-9]{14}$').test(backupDir)) {
      throw new Error('Unexpected Warehouse application or backup path.');
    }
    const settings = { ...releaseSettings(item, requestId), files, hashes: migrations.map(file => file.sha256) };
    const result = runProgram(runner, settings, FREEZE + BOOTSTRAP + source.replace(/^<\?php\s+declare\(strict_types=1\);/, '') + body);
    if (result.code === 0) {
      try {
        const reply = JSON.parse(result.out);
        if (reply.state === 'ready') return reply;
      } catch { /* Unreadable output cannot confirm completion. */ }
    }
    throw new Error('Warehouse schema release or verification stopped. Keep writes paused and inspect request ' + requestId + ' backups and migration ledger.');
  }
  function prepareDatabase(context) {
    const paths = uploadMigrationFiles(migrations, context.backupDir, runner);
    const { proof } = run(context, MIGRATE, paths);
    if (!proof?.backups || !proof.originalRecords || Object.keys(proof.backups).length !== 3 ||
        !Object.values(proof.backups).every(name => typeof name === 'string' && name.startsWith('zz_wh_' + requestId + '_'))) {
      throw new Error('The Warehouse schema release did not confirm its original-record backups.');
    }
    return { note: 'All three reviewed migrations and original-record digests verified. Warehouse writes remain paused.',
      backup: Object.values(proof.backups).join(', '), proof };
  }
  function verifyAfterMove(context) {
    run(context, VERIFY);
    return { status: 'maintenance mode' };
  }
  return { prepareDatabase, verifyAfterMove };
}

module.exports = { schemaWindow, loadSchemaRelease };
