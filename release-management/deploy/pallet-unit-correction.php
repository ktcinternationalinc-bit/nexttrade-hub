<?php

namespace NextTrade\WarehouseRelease;

use PDO;
use RuntimeException;
use Throwable;

/**
 * Apply the reviewed BUG-001 correction. The caller supplies the exact count
 * recorded with the approval and names a new backup table for that request.
 * The update and its before-values commit together.
 */
function correctPalletUnits(PDO $db, int $approvedCount, string $approvedSnapshot, string $backupTable): int
{
    if ($approvedCount <= 0 || !preg_match('/^[a-f0-9]{64}$/D', $approvedSnapshot) ||
        !preg_match('/^zz_bug001_units_before_[a-z0-9_]{1,30}$/D', $backupTable)) {
        throw new RuntimeException('The approved pallet snapshot and a new BUG-001 backup table are required.');
    }
    if ($db->inTransaction()) {
        throw new RuntimeException('The correction needs its own transaction.');
    }
    // Each execution has a new table. DDL runs before the transaction so MariaDB
    // cannot implicitly commit an update. The existing backup is never reused.
    $backup = '`' . $backupTable . '`';
    $db->exec("CREATE TABLE $backup ENGINE=InnoDB AS
        SELECT id, skew_number, unit, updated_at FROM scan_in_logs WHERE 1 = 0");
    $db->exec("ALTER TABLE $backup ADD PRIMARY KEY (id)");
    $db->beginTransaction();
    try {
        $eligible = "skew_number LIKE 'W.%' AND (unit IS NULL OR TRIM(unit) = '')";
        $rows = $db->query("SELECT id, skew_number, unit, updated_at FROM scan_in_logs
            WHERE $eligible ORDER BY id FOR UPDATE")->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) !== $approvedCount || hash('sha256', json_encode($rows, JSON_THROW_ON_ERROR)) !== $approvedSnapshot) {
            throw new RuntimeException('The eligible pallet records changed since approval.');
        }
        $copy = $db->prepare("INSERT INTO $backup (id, skew_number, unit, updated_at) VALUES (?, ?, ?, ?)");
        foreach ($rows as $row) {
            $copy->execute([$row['id'], $row['skew_number'], $row['unit'], $row['updated_at']]);
        }
        $updated = $db->exec("UPDATE scan_in_logs AS pallet INNER JOIN $backup AS before_unit ON before_unit.id = pallet.id
            SET pallet.unit = 'W', pallet.updated_at = pallet.updated_at
            WHERE pallet.unit <=> before_unit.unit
              AND pallet.skew_number <=> before_unit.skew_number
              AND pallet.updated_at <=> before_unit.updated_at");
        if ($updated !== $approvedCount || (int) $db->query("SELECT COUNT(*) FROM scan_in_logs WHERE $eligible")->fetchColumn() !== 0) {
            throw new RuntimeException('The changed rows did not match the approved snapshot.');
        }
        $db->commit();
        return $updated;
    } catch (Throwable $failure) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $failure;
    }
}
