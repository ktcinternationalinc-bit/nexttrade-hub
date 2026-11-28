<?php
declare(strict_types=1);

function warehouseSchemaId(string $identifier): string
{
    if (!preg_match('/^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/D', $identifier)) {
        throw new RuntimeException('Invalid Warehouse database identifier.');
    }
    return chr(96) . $identifier . chr(96);
}

function warehouseSchemaColumns(PDO $db, string $table): array
{
    $statement = $db->prepare(
        'SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY, COLUMN_DEFAULT, IS_NULLABLE
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION'
    );
    $statement->execute([$table]);
    return array_column($statement->fetchAll(PDO::FETCH_ASSOC), null, 'COLUMN_NAME');
}

function warehouseSchemaDigest(PDO $db, string $table, array $columns, string $key): array
{
    $select = implode(',', array_map('warehouseSchemaId', $columns));
    $buffered = $db->getAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY);
    $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
    $statement = null;
    try {
        $statement = $db->query('SELECT ' . $select . ' FROM ' . warehouseSchemaId($table) . ' ORDER BY ' . warehouseSchemaId($key));
        $digest = hash_init('sha256');
        $count = 0;
        while (($record = $statement->fetch(PDO::FETCH_NUM)) !== false) {
            hash_update($digest, serialize($record));
            $count++;
        }
        return ['records' => $count, 'sha256' => hash_final($digest)];
    } finally {
        $statement?->closeCursor();
        $db->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, $buffered);
    }
}

/** Run the named, additive Laravel release against the authorized connection. */
function warehouseSchemaRelease(PDO $db, string $kind, int $request, array $migrations, callable $migrate, callable $verifyFreeze): array
{
    $scope = match ($kind) {
        'warehouse-acid-schema-v1' => [
            'order_status_requirements' => ['shipping_doc_type', 'order_payment_type', 'load_time_known'],
            'order_statuses' => ['note'],
        ],
        'warehouse-rolls-schema-v1' => [
            'c_g_t_grades' => ['not_rolls'],
            'order_queues' => ['form', 'form_at', 'form_by'],
        ],
        default => throw new RuntimeException('Unknown Warehouse schema release.'),
    };
    if ($request < 1 || count($migrations) !== 3 || count(array_unique($migrations)) !== 3) {
        throw new RuntimeException('Invalid Warehouse migration specification.');
    }
    $verifyFreeze();
    $db->exec('SET SESSION lock_wait_timeout=20');
    $db->exec('SET SESSION innodb_lock_wait_timeout=20');
    $db->exec('SET SESSION max_statement_time=180');
    $migrateNames = array_map(static fn(string $file): string => basename($file, '.php'), $migrations);
    $checkMigrations = $db->prepare('SELECT migration FROM migrations WHERE migration IN (?, ?, ?) ORDER BY migration');
    $checkMigrations->execute($migrateNames);
    if ($checkMigrations->fetchAll(PDO::FETCH_COLUMN)) {
        throw new RuntimeException('The migration ledger already contains entries for this release.');
    }

    $current = [];
    $primaryKeys = [];
    $backups = [];
    $engine = $db->prepare('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?');
    foreach ($scope + ['migrations' => []] as $table => $added) {
        $engine->execute([$table]);
        if ($engine->fetchColumn() !== 'InnoDB') throw new RuntimeException('Expected an InnoDB table: ' . $table);
        $definition = warehouseSchemaColumns($db, $table);
        $keys = array_keys(array_filter($definition, static fn(array $column): bool => $column['COLUMN_KEY'] === 'PRI'));
        if ($keys !== ['id'] || array_intersect($added, array_keys($definition))) {
            throw new RuntimeException('Unexpected baseline schema or partial migration: ' . $table);
        }
        $backup = 'zz_wh_' . $request . '_' . $table;
        if (warehouseSchemaColumns($db, $backup)) throw new RuntimeException('A backup already exists for this request: ' . $backup);
        $backups[$table] = $backup;
        $current[$table] = $definition;
        $primaryKeys[$table] = $keys[0];
    }
    $seedFilter = "(UPPER(TRIM(slug)),UPPER(TRIM(grade_name))) IN (('BC','BOX SECONDS'),('4U','BALES'),('PVB','PVC BOXES'))";
    if ($kind === 'warehouse-acid-schema-v1') {
        if (($current['order_status_requirements']['load_date']['DATA_TYPE'] ?? '') !== 'datetime') {
            throw new RuntimeException('The approved ACID baseline requires existing DATETIME load timestamps.');
        }
    } else {
        $openDuplicates = $db->query('SELECT COUNT(*) FROM (SELECT 1 FROM order_queues WHERE released_at IS NULL
            GROUP BY order_id,color_id,nt_id HAVING COUNT(*) > 1) AS duplicate_groups')->fetchColumn();
        $fractional = $db->query('SELECT COUNT(*) FROM order_queues WHERE released_at IS NULL AND order_column > 0
            AND order_column <> FLOOR(order_column)')->fetchColumn();
        $seeds = $db->query('SELECT COUNT(*) FROM c_g_t_grades WHERE ' . $seedFilter)->fetchColumn();
        if ((int)$openDuplicates !== 0 || (int)$fractional !== 0 || (int)$seeds !== 3) {
            throw new RuntimeException('Reservations or grade classifications changed. Review the production baseline again.');
        }
    }

    $digests = [];
    foreach ($backups as $table => $backup) {
        $db->exec('CREATE TABLE ' . warehouseSchemaId($backup) . ' LIKE ' . warehouseSchemaId($table));
        $columns = array_keys($current[$table]);
        $ordered = implode(',', array_map('warehouseSchemaId', $columns));
        $db->exec('INSERT INTO ' . warehouseSchemaId($backup) . ' (' . $ordered . ') SELECT ' . $ordered . ' FROM ' . warehouseSchemaId($table));
        $digests[$table] = warehouseSchemaDigest($db, $backup, $columns, $primaryKeys[$table]);
        if (warehouseSchemaColumns($db, $backup) !== $current[$table] ||
            warehouseSchemaDigest($db, $table, $columns, $primaryKeys[$table]) !== $digests[$table]) {
            throw new RuntimeException('The backup did not match the original schema and rows: ' . $table);
        }
    }

    $verifyFreeze();
    $migrate();
    $verifyFreeze();
    $checkMigrations->execute($migrateNames);
    $expectedNames = $migrateNames;
    sort($expectedNames);
    if ($checkMigrations->fetchAll(PDO::FETCH_COLUMN) !== $expectedNames) {
        throw new RuntimeException('The migration ledger did not record each reviewed migration exactly once.');
    }
    foreach ($scope as $table => $added) {
        $after = warehouseSchemaColumns($db, $table);
        if (array_diff($added, array_keys($after)) || array_diff(array_keys($after), array_merge(array_keys($current[$table]), $added)) ||
            array_intersect_key($after, $current[$table]) !== $current[$table] ||
            warehouseSchemaDigest($db, $table, array_keys($current[$table]), $primaryKeys[$table]) !== $digests[$table]) {
            throw new RuntimeException('Post-migration schema or original rows differ: ' . $table);
        }
    }
    $beforeLedger = warehouseSchemaId($backups['migrations']);
    $ledgerDrift = $db->query('SELECT COUNT(*) FROM ' . $beforeLedger . ' b LEFT JOIN migrations m ON m.id=b.id
        WHERE m.id IS NULL OR NOT (m.migration <=> b.migration AND m.batch <=> b.batch)')->fetchColumn();
    if ((int)$ledgerDrift !== 0 || (int)$db->query('SELECT COUNT(*) FROM migrations')->fetchColumn() !== $digests['migrations']['records'] + 3) {
        throw new RuntimeException('The prior migration ledger changed.');
    }
    if ($kind === 'warehouse-acid-schema-v1') {
        $invalid = (int)$db->query('SELECT COUNT(*) FROM order_status_requirements
            WHERE shipping_doc_type IS NOT NULL OR order_payment_type IS NOT NULL OR NOT (load_time_known <=> 0)')->fetchColumn()
            + (int)$db->query('SELECT COUNT(*) FROM order_statuses WHERE note IS NOT NULL')->fetchColumn();
    } else {
        $invalid = (int)$db->query('SELECT COUNT(*) FROM c_g_t_grades
            WHERE NOT (not_rolls <=> CASE WHEN ' . $seedFilter . ' THEN 1 ELSE 0 END)')->fetchColumn()
            + (int)$db->query("SELECT COUNT(*) FROM order_queues WHERE NOT (form <=> 'mixed') OR form_at IS NOT NULL OR form_by IS NOT NULL")->fetchColumn();
    }
    if ($invalid !== 0) throw new RuntimeException('The new columns contain unexpected values.');
    return ['backups' => $backups, 'originalRecords' => $digests];
}
