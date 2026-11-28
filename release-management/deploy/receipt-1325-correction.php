<?php

namespace NextTrade\WarehouseRelease;

use PDO;
use RuntimeException;
use Throwable;

const RECEIPT_1325_BEFORE = '1984-11-06 03:00:53';
const RECEIPT_1325_AFTER = '2024-10-11 03:00:53';

function receipt1325BackupName(string $backup): string
{
    if (!preg_match('/^zz_fix1325_before_[0-9]{8}_[0-9a-z]{1,20}$/D', $backup)) {
        throw new RuntimeException('A new receipt 1325 backup table name is required.');
    }
    return '`' . $backup . '`';
}

function createReceipt1325Backup(PDO $db, string $backup): void
{
    if ($db->inTransaction()) {
        throw new RuntimeException('Create the backup table before the correction transaction.');
    }
    $backup = receipt1325BackupName($backup);
    $engine = $db->query("SELECT ENGINE FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scan_in_inventories'")->fetchColumn();
    $triggers = $db->query("SELECT COUNT(*) FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'scan_in_inventories' AND EVENT_MANIPULATION = 'UPDATE'")->fetchColumn();
    if ($engine !== 'InnoDB' || (int) $triggers !== 0) {
        throw new RuntimeException('The receipt table or its update triggers require a separate review.');
    }
    $db->exec("CREATE TABLE $backup ENGINE=InnoDB AS
        SELECT id, created_at, updated_at FROM scan_in_inventories WHERE 1 = 0");
    $db->exec("ALTER TABLE $backup ADD PRIMARY KEY (id)");
}

function correctReceipt1325(PDO $db, string $backup): string
{
    $backup = receipt1325BackupName($backup);
    if ($db->inTransaction()) {
        throw new RuntimeException('The receipt correction requires its own transaction.');
    }
    $db->beginTransaction();
    try {
        $locked = $db->query('SELECT created_at, updated_at FROM scan_in_inventories WHERE id = 1325 FOR UPDATE')->fetch(PDO::FETCH_ASSOC);
        if (!$locked || $locked['created_at'] !== RECEIPT_1325_BEFORE) {
            throw new RuntimeException('Receipt 1325 no longer has the reviewed original timestamp.');
        }

        $copy = $db->prepare("INSERT INTO $backup (id, created_at, updated_at) VALUES (1325, ?, ?)");
        $copy->execute([$locked['created_at'], $locked['updated_at']]);
        $update = $db->prepare('UPDATE scan_in_inventories SET created_at = ?, updated_at = updated_at
            WHERE id = 1325 AND created_at = ? AND updated_at <=> ?');
        $update->execute([RECEIPT_1325_AFTER, RECEIPT_1325_BEFORE, $locked['updated_at']]);
        $after = $db->query('SELECT created_at, updated_at FROM scan_in_inventories WHERE id = 1325')->fetch(PDO::FETCH_ASSOC);
        $saved = $db->query("SELECT created_at, updated_at FROM $backup WHERE id = 1325")->fetch(PDO::FETCH_ASSOC);
        if ($update->rowCount() !== 1 || $after !== ['created_at' => RECEIPT_1325_AFTER, 'updated_at' => $locked['updated_at']] || $saved !== $locked) {
            throw new RuntimeException('Receipt 1325 or its backup did not match the expected result.');
        }
        $db->commit();
        return RECEIPT_1325_AFTER;
    } catch (Throwable $failure) {
        if ($db->inTransaction()) $db->rollBack();
        throw $failure;
    }
}
