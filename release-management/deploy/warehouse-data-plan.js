'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { supportedDataPlan } = require('../lib/selection');

const SCRIPT = path.join(__dirname, 'pallet-unit-correction.php');
const PREVENTION_SHA = 'e505fc6de87388bbbe4c213553a9c5d77b162de6abd4a40e02ef4c2b021b4a64';

function prepareDataCommand(item, requestId, appRoot) {
  if (!supportedDataPlan(item) || !Number.isSafeInteger(requestId) || requestId < 1 || appRoot !== '~/public_html') {
    throw new Error('The production database operation was not recognized.');
  }
  const plan = item.manifest.dataPlan;
  const source = fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');
  if (createHash('sha256').update(source).digest('hex') !== plan.scriptHash) throw new Error('The reviewed database program fingerprint differs.');
  const backup = 'zz_bug001_units_before_' + requestId;
  // Never source PHP from the request. Send the reviewed program and the approved snapshot.
  const script = source + `
    if (hash_file('sha256', 'app/Http/Controllers/Admin/ScanInController.php') !== '${PREVENTION_SHA}') {
        echo json_encode(['state' => 'blocked', 'reason' => 'The exact pallet-unit prevention build must be live first.']);
        exit(0);
    }
    require 'vendor/autoload.php';
    $app = require 'bootstrap/app.php';
    $app->make(\\Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
    $db = $app->make('db')->connection()->getPdo();
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $engine = $db->query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scan_in_logs'")->fetchColumn();
    if ($engine !== 'InnoDB') {
        echo json_encode(['state' => 'blocked', 'reason' => 'The pallet table does not support a transactional correction.']);
        exit(0);
    }
    $approvedCount = ${plan.eligibleCount};
    try {
        $updated = correctPalletUnits($db, $approvedCount, '${plan.snapshotHash}', '${backup}');
        echo json_encode(['state' => 'moved', 'updated' => $updated]);
    } catch (RuntimeException $failure) {
        if ($failure->getMessage() === 'The eligible pallet records changed since approval.') {
            echo json_encode(['state' => 'blocked', 'reason' => 'The matching pallet records changed since approval. A fresh dry run is required.']);
            exit(0);
        }
        throw $failure;
    }
  `;
  const wire = Buffer.from(script).toString('base64');
  return { command: "cd ~/public_html && printf '%s' '" + wire + "' | base64 -d | /usr/local/bin/php",
    backup, eligibleCount: plan.eligibleCount };
}

function executeDataCommand(item, data, runner) {
  const response = runner.run(data.command);
  if (response.code !== 0) throw new Error('Pallet correction did not confirm a result. Inspect backup table ' + data.backup + ' before continuing.');
  let result;
  try { result = JSON.parse(response.out); }
  catch { throw new Error('Pallet correction did not confirm a result. Inspect backup table ' + data.backup + ' before continuing.'); }
  if (result.state === 'blocked') return { action: 'failed', detail: { title: item.title, outcome: 'not_replaced', note: result.reason } };
  if (result.state !== 'moved' || result.updated !== data.eligibleCount) {
    throw new Error('The pallet correction row count is unconfirmed. Inspect backup table ' + data.backup + ' before continuing.');
  }
  return { action: 'moved', detail: { title: item.title, backup: data.backup,
    note: result.updated + ' pallet units corrected and the prior values kept in the backup table.',
    dependsOn: item.dependsOn } };
}

module.exports = { prepareDataCommand, executeDataCommand };
