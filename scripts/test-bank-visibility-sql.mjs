// Disposable, local PostgreSQL verification. This script never reads .env files
// or opens a network/database connection. Install its pinned runtime OUTSIDE the
// app: npm install --prefix /tmp/hub-sql-verification --save-exact --ignore-scripts
//   --no-audit --no-fund @electric-sql/pglite@0.5.11
// Run: node scripts/test-bank-visibility-sql.mjs
//   /tmp/hub-sql-verification/node_modules/@electric-sql/pglite/dist/index.js
// The app's package.json, node_modules and lockfile do not need modification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

if (!process.argv[2]) throw new Error('Pass the local PGlite dist/index.js path; see the script header.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const migration = await readFile(new URL('../sql/bank-balance-visibility.sql', import.meta.url), 'utf8');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = uuid(1), target = uuid(2), targetProfile = uuid(102);
const connection = uuid(201), account = uuid(202), backup = uuid(203);

await test('actual PostgreSQL financial-visibility migration and role boundaries', async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  const version = (await db.query('select version() as version')).rows[0].version;
  t.diagnostic(version);
  t.diagnostic(`Migration SHA-256: ${createHash('sha256').update(migration).digest('hex')}`);
  async function asRole(role, fn) {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
    await db.exec(`set role ${role}`);
    try { return await fn(); }
    finally { await db.exec('reset role'); }
  }
  async function denied(sql, params = []) {
    await assert.rejects(db.query(sql, params), (error) => error.code === '42501', sql);
  }
  async function mapped(id) {
    return (await db.query('select * from public.bank_visibility_profile_for_identity($1::uuid)', [id])).rows;
  }
  async function grant(dashboard, bank, profile = targetProfile, authId = target) {
    return (await db.query('select public.bank_visibility_set_grant($1::uuid,$2::uuid,$3::uuid,$4::boolean,$5::boolean) as result',
      [profile, authId, actor, dashboard, bank])).rows[0].result;
  }

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to service_role;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz,
      phone_confirmed_at timestamptz, confirmed_at timestamptz,
      deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean default false
    );
    create table public.users (id uuid primary key, name text, email text, active boolean default true);
    create table public.bank_connections (
      id uuid primary key, institution_id text, institution_name text, status text,
      last_synced timestamptz, created_at timestamptz default now(),
      access_token text, plaid_cursor text
    );
    create table public.plaid_accounts (
      id uuid primary key, connection_id uuid, business_id uuid, plaid_account_id text,
      name text, official_name text, mask text, type text, subtype text, iso_currency text,
      current_balance numeric(14,2), available_balance numeric(14,2),
      is_read_only boolean default true, updated_at timestamptz default now()
    );
    create table public.backups (id uuid primary key, kind text, data jsonb, notes text);
    create table public.wave_sync_log (id uuid primary key, entity_type text, response_payload jsonb);
    create table public.bank_transactions (id uuid primary key, amount numeric, description text);
    create table public.financial_visibility_permissions (
      auth_user_id uuid primary key references auth.users(id) on delete cascade,
      can_view_dashboard boolean not null default false,
      can_view_bank_balances boolean not null default false,
      updated_by uuid not null, updated_at timestamptz not null default now()
    );
    create table public.financial_visibility_permission_audit (
      id uuid primary key default gen_random_uuid(), actor_auth_user_id uuid not null,
      target_auth_user_id uuid not null, target_profile_id uuid not null,
      previous_can_view_dashboard boolean not null, previous_can_view_bank_balances boolean not null,
      can_view_dashboard boolean not null, can_view_bank_balances boolean not null,
      created_at timestamptz not null default now()
    );
    grant all on all tables in schema public to public, anon, authenticated;
    grant select (access_token) on public.bank_connections to public, anon, authenticated;
    grant select (current_balance,available_balance) on public.plaid_accounts to public, anon, authenticated;
    grant select (data) on public.backups to public, anon, authenticated;
    grant update (can_view_dashboard,can_view_bank_balances) on public.financial_visibility_permissions to public, anon, authenticated;
  `);
  for (const table of ['bank_connections', 'plaid_accounts', 'backups', 'financial_visibility_permissions', 'financial_visibility_permission_audit']) {
    await db.exec(`alter table public.${table} enable row level security;
      create policy legacy_open on public.${table} for all to public using (true) with check (true);`);
  }
  const identities = [
    [1, 'actor@example.invalid', true, true, null, null, false],
    [2, ' Legacy@Example.Invalid ', true, true, null, null, false],
    [3, 'inactive@example.invalid', true, true, null, null, false],
    [4, 'duplicate@example.invalid', true, true, null, null, false],
    [5, 'duplicate@example.invalid', true, true, null, null, false],
    [6, 'two-profiles@example.invalid', true, true, null, null, false],
    [7, 'seven@example.invalid', true, true, null, null, false],
    [8, 'eight@example.invalid', true, true, null, null, false],
    [9, 'phone-only@example.invalid', false, true, null, null, false],
    [10, 'anonymous@example.invalid', true, true, null, null, true],
    [11, 'banned@example.invalid', true, true, null, '2099-01-01', false],
    [12, 'deleted@example.invalid', true, true, '2020-01-01', null, false],
    [13, 'exact-unconfirmed@example.invalid', false, false, null, null, false],
  ];
  for (const [id, email, confirmedEmail, confirmedPhone, deleted, banned, anonymous] of identities) {
    await db.query(`insert into auth.users
      (id,email,email_confirmed_at,phone_confirmed_at,confirmed_at,deleted_at,banned_until,is_anonymous)
      values ($1,$2,$3,$4,$4,$5,$6,$7)`,
      [uuid(id), email, confirmedEmail ? '2020-01-01' : null, confirmedPhone ? '2020-01-01' : null, deleted, banned, anonymous]);
  }
  for (const [id, email, active] of [
    [1, 'actor@example.invalid', true], [102, 'legacy@example.invalid', true],
    [3, 'inactive@example.invalid', false], [104, 'duplicate@example.invalid', true],
    [106, 'two-profiles@example.invalid', true], [107, 'two-profiles@example.invalid', false],
    [7, 'eight@example.invalid', true], [8, 'eight@example.invalid', true],
    [109, 'phone-only@example.invalid', true], [10, 'anonymous@example.invalid', true],
    [11, 'banned@example.invalid', true], [12, 'deleted@example.invalid', true],
    [13, 'exact-unconfirmed@example.invalid', true],
  ]) {
    await db.query('insert into public.users (id,name,email,active) values ($1,$2,$3,$4)', [uuid(id), `Fixture ${id}`, email, active]);
  }
  await db.query('insert into public.bank_connections (id,institution_id,institution_name,status,access_token) values ($1,$2,$3,$4,$5)',
    [connection, 'ins_fixture', 'Fixture Bank', 'active', 'access-sandbox-fixture-only']);
  await db.query(`insert into public.plaid_accounts
    (id,connection_id,plaid_account_id,name,mask,type,subtype,iso_currency,current_balance,available_balance)
    values ($1,$2,'fixture_account','Operating','4242','depository','checking','USD',98765.43,97531.20)`, [account, connection]);
  await db.query('insert into public.backups (id,kind,data,notes) values ($1,$2,$3,$4)',
    [backup, 'daily', { plaid_accounts: [{ current_balance: 98765.43 }], bank_connections: [{ access_token: 'old-fixture-token' }] }, 'Fixture']);
  await db.query('insert into public.bank_transactions (id,amount,description) values ($1,123.45,$2)', [uuid(204), 'Invoice payment']);
  const oldLog = {
    accounts: [{ account_id: 'fixture_account', name: 'Operating', mask: '4242',
      balances: { current: 98765.43, available: 97531.20, iso_currency_code: 'USD' },
      current_balance: 98765.43, available_balance: 97531.20 }],
    added: [{ transaction_id: 'fixture_transaction', amount: 123.45, name: 'Invoice payment' }],
    nested: { access_token: 'nested-fixture-token' }, access_token: 'access-sandbox-fixture-only',
  };
  await db.query('insert into public.wave_sync_log (id,entity_type,response_payload) values ($1,$2,$3)', [uuid(205), 'plaid_transactions', oldLog]);
  await db.query('insert into public.wave_sync_log (id,entity_type,response_payload) values ($1,$2,$3)',
    [uuid(206), 'invoices', { amount: 123.45, status: 'paid' }]);

  await t.test('unmodified migration applies to an existing permissive schema', async () => {
    await db.exec(migration);
    const row = (await db.query("select count(*)::integer as n from information_schema.columns where table_schema='public' and table_name='plaid_accounts' and column_name='wave_business_id'")).rows[0];
    assert.equal(row.n, 1);
  });
  await t.test('authenticated reads account labels, masks and currency', async () => {
    await asRole('authenticated', async () => {
      assert.deepEqual((await db.query('select name,mask,iso_currency from public.plaid_accounts')).rows,
        [{ name: 'Operating', mask: '4242', iso_currency: 'USD' }]);
      assert.equal((await db.query('select institution_name,status from public.bank_connections')).rows[0].institution_name, 'Fixture Bank');
    });
  });
  await t.test('old table and column grants cannot expose balances, credentials or backups', async () => {
    for (const role of ['authenticated', 'anon']) await asRole(role, async () => {
      for (const sql of [
        'select current_balance from public.plaid_accounts', 'select available_balance from public.plaid_accounts',
        'select * from public.plaid_accounts', 'select access_token from public.bank_connections',
        'select * from public.bank_connections', 'select data from public.backups', 'select id from public.backups',
        'select * from public.financial_visibility_permissions', 'select * from public.financial_visibility_permission_audit',
      ]) await denied(sql);
      await denied('update public.financial_visibility_permissions set can_view_dashboard=true,can_view_bank_balances=true');
      await denied('update public.plaid_accounts set name=\'forged\'');
      await denied('update public.bank_connections set status=\'forged\'');
      await denied('delete from public.backups');
    });
  });
  await t.test('anonymous callers do not receive even account metadata', async () => {
    await asRole('anon', () => denied('select name,mask from public.plaid_accounts'));
  });
  await t.test('no browser role may execute identity or permission RPCs', async () => {
    for (const role of ['authenticated', 'anon']) await asRole(role, async () => {
      for (const sql of [
        'select * from public.bank_visibility_identity_map()',
        `select * from public.bank_visibility_profile_for_identity('${actor}')`,
        `select * from public.bank_visibility_auth_ids_for_profile('${targetProfile}')`,
        'select public.bank_visibility_list_profiles()',
        `select public.bank_visibility_set_grant('${targetProfile}','${target}','${actor}',true,true)`,
      ]) await denied(sql);
    });
  });
  await t.test('normal transaction rows and operational writes are preserved', async () => {
    await asRole('authenticated', async () => {
      assert.deepEqual((await db.query('select amount,description from public.bank_transactions')).rows,
        [{ amount: '123.45', description: 'Invoice payment' }]);
      await db.query('update public.bank_transactions set description=$1 where id=$2', ['Categorized invoice payment', uuid(204)]);
    });
  });
  await t.test('service role reads protected balances and maintains backups', async () => {
    await asRole('service_role', async () => {
      assert.equal((await db.query('select current_balance from public.plaid_accounts')).rows[0].current_balance, '98765.43');
      assert.equal((await db.query('select access_token from public.bank_connections')).rows[0].access_token, 'access-sandbox-fixture-only');
      await db.query('update public.backups set notes=$1 where id=$2', ['Service verified', backup]);
      assert.equal((await db.query('select notes from public.backups')).rows[0].notes, 'Service verified');
    });
  });
  await t.test('identity map accepts exact IDs and unique confirmed legacy emails', async () => {
    await asRole('service_role', async () => {
      assert.deepEqual(await mapped(actor), [{ profile_id: actor, auth_user_id: actor }]);
      assert.deepEqual(await mapped(target), [{ profile_id: targetProfile, auth_user_id: target }]);
      assert.deepEqual(await mapped(uuid(13)), [{ profile_id: uuid(13), auth_user_id: uuid(13) }]);
    });
  });
  await t.test('ambiguity on either side, inactive, anonymous, banned and unverified-email mappings fail closed', async () => {
    await asRole('service_role', async () => {
      for (const id of [3,4,5,6,7,8,9,10,11,12]) assert.deepEqual(await mapped(uuid(id)), [], `Auth fixture ${id}`);
      const profiles = (await db.query('select public.bank_visibility_list_profiles() as profiles')).rows[0].profiles;
      assert.deepEqual(profiles.map((row) => row.auth_user_id).sort(), [actor, target, uuid(13)].sort());
      const inactive = (await db.query('select * from public.bank_visibility_auth_ids_for_profile($1)', [uuid(3)])).rows;
      assert.deepEqual(inactive, [{ auth_user_id: uuid(3) }], 'account-admin protection still identifies inactive targets');
    });
  });
  await t.test('partial grants independently preserve the other flag and append exact audit transitions', async () => {
    await asRole('service_role', async () => {
      assert.deepEqual(await grant(null, true), { can_view_dashboard: false, can_view_bank_balances: true });
      assert.deepEqual(await grant(true, null), { can_view_dashboard: true, can_view_bank_balances: true });
      assert.deepEqual(await grant(null, false), { can_view_dashboard: true, can_view_bank_balances: false });
      assert.deepEqual(await grant(false, null), { can_view_dashboard: false, can_view_bank_balances: false });
      const audits = (await db.query(`select actor_auth_user_id,target_auth_user_id,target_profile_id,
        previous_can_view_dashboard,previous_can_view_bank_balances,can_view_dashboard,can_view_bank_balances
        from public.financial_visibility_permission_audit order by created_at`)).rows;
      assert.equal(audits.length, 4);
      assert.deepEqual(audits.map((r) => [r.previous_can_view_dashboard,r.previous_can_view_bank_balances,r.can_view_dashboard,r.can_view_bank_balances]),
        [[false,false,false,true],[false,true,true,true],[true,true,true,false],[true,false,false,false]]);
      for (const row of audits) {
        assert.equal(row.actor_auth_user_id, actor); assert.equal(row.target_auth_user_id, target); assert.equal(row.target_profile_id, targetProfile);
      }
    });
  });
  await t.test('changed targets and inactive actors cannot create a grant or audit', async () => {
    await asRole('service_role', async () => {
      assert.equal(await grant(true, true, uuid(999)), null);
      assert.equal(await grant(true, true, uuid(3), uuid(3)), null);
      assert.equal(await grant(null, null), null);
      const rejected = await db.query('select public.bank_visibility_set_grant($1,$2,$3,true,true) as result', [targetProfile,target,uuid(3)]);
      assert.equal(rejected.rows[0].result, null);
      assert.equal((await db.query('select count(*)::integer as n from public.financial_visibility_permission_audit')).rows[0].n, 4);
    });
  });
  await t.test('audit failure rolls back the permission change', async () => {
    await db.exec(`create function public.fixture_fail_audit() returns trigger language plpgsql as $$
      begin raise exception 'fixture audit unavailable'; end; $$;
      create trigger fixture_fail_audit before insert on public.financial_visibility_permission_audit
      for each row execute function public.fixture_fail_audit();`);
    try {
      await asRole('service_role', async () => {
        await assert.rejects(grant(true, true), (error) => error.code === 'P0001');
        assert.deepEqual((await db.query('select can_view_dashboard,can_view_bank_balances from public.financial_visibility_permissions')).rows,
          [{ can_view_dashboard: false, can_view_bank_balances: false }]);
        assert.equal((await db.query('select count(*)::integer as n from public.financial_visibility_permission_audit')).rows[0].n, 4);
      });
    } finally { await db.exec('drop trigger fixture_fail_audit on public.financial_visibility_permission_audit; drop function public.fixture_fail_audit();'); }
  });
  await t.test('historical sync logs lose balance and token fields but retain transactions', async () => {
    const logs = (await db.query('select entity_type,response_payload from public.wave_sync_log order by entity_type')).rows;
    assert.deepEqual(logs.find((r) => r.entity_type === 'invoices').response_payload, { amount: 123.45, status: 'paid' });
    const payload = logs.find((r) => r.entity_type === 'plaid_transactions').response_payload;
    assert.deepEqual(payload.accounts, [{ account_id: 'fixture_account', name: 'Operating', mask: '4242' }]);
    assert.deepEqual(payload.added, oldLog.added);
    assert.deepEqual(payload.nested, {});
    assert.equal(Object.hasOwn(payload, 'access_token'), false);
  });
  await t.test('migration is repeatable without changing grants or operational records', async () => {
    await db.exec(migration);
    await asRole('authenticated', async () => {
      assert.equal((await db.query('select name from public.plaid_accounts')).rows[0].name, 'Operating');
      assert.equal((await db.query('select description from public.bank_transactions')).rows[0].description, 'Categorized invoice payment');
      await denied('select current_balance from public.plaid_accounts');
      await denied('select data from public.backups');
    });
    await asRole('service_role', async () => {
      assert.equal((await db.query('select count(*)::integer as n from public.financial_visibility_permission_audit')).rows[0].n, 4);
      assert.deepEqual((await db.query('select can_view_dashboard,can_view_bank_balances from public.financial_visibility_permissions')).rows,
        [{ can_view_dashboard: false, can_view_bank_balances: false }]);
    });
  });
});
