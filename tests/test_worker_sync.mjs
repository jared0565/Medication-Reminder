import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationUrl = new URL('../worker/migrations/0003_scoped_pairing_credentials.sql', import.meta.url);
const packageUrl = new URL('../worker/package.json', import.meta.url);
const schemaUrl = new URL('../worker/schema.sql', import.meta.url);

const additiveColumns = [
  'invitation_token_hash',
  'invitation_expires_at',
  'invitation_consumed_at',
  'mobile_token_hash',
  'mobile_claimed_at',
];
const schemaCredentialColumns = [
  'invitation_token_hash',
  'invitation_expires_at',
  'invitation_consumed_at',
  'mobile_token_hash',
  'mobile_device_id',
  'mobile_claimed_at',
];
const indexStatements = new Map([
  [
    'idx_sync_pairs_user_id_pair',
    'create index if not exists idx_sync_pairs_user_id_pair on sync_pairs(user_id, pair_id)',
  ],
  [
    'idx_sync_pairs_invitation_expiry',
    'create index if not exists idx_sync_pairs_invitation_expiry on sync_pairs(invitation_expires_at) where invitation_token_hash is not null',
  ],
  [
    'idx_sync_pairs_mobile_token',
    'create index if not exists idx_sync_pairs_mobile_token on sync_pairs(mobile_token_hash) where mobile_token_hash is not null',
  ],
]);

function normalizeSql(sql) {
  return sql
    .replace(/--.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s*,\s*/g, ', ')
    .trim()
    .replace(/;$/, '')
    .toLowerCase();
}

function sqlStatements(sql) {
  return sql
    .split(';')
    .map(normalizeSql)
    .filter(Boolean);
}

function assertIndexDefinitions(statements, source) {
  for (const expected of indexStatements.values()) {
    assert.equal(
      statements.filter(statement => statement === expected).length,
      1,
      `${source} must contain exactly one complete "${expected}" definition`,
    );
  }
}

function syncPairColumnDefinitions(schema) {
  const table = schema.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+sync_pairs\s*\(([\s\S]*?)\)\s*;/i);
  assert.ok(table, 'schema.sql must define sync_pairs');
  return table[1]
    .split(',')
    .map(definition => definition.trim())
    .filter(Boolean);
}

function withoutScopedCredentials(schema) {
  let legacySchema = schema;
  for (const column of additiveColumns) {
    legacySchema = legacySchema.replace(
      new RegExp(`^[ \\t]+${column}[ \\t]+TEXT,[ \\t]*\\r?\\n`, 'gmi'),
      '',
    );
  }

  return legacySchema
    .split(';')
    .filter(statement => ![...indexStatements.values()].includes(normalizeSql(statement)))
    .join(';\n');
}

function inspectSyncPairs(...scripts) {
  const database = new DatabaseSync(':memory:');
  try {
    for (const script of scripts) {
      database.exec(script);
    }

    const columns = database
      .prepare("SELECT name, type FROM pragma_table_info('sync_pairs') ORDER BY cid")
      .all()
      .map(({ name, type }) => ({ name, type }));
    const indexList = database.prepare("PRAGMA index_list('sync_pairs')").all();
    const indexes = Object.fromEntries(
      [...indexStatements].map(([name]) => {
        const record = database
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(name);
        assert.ok(record, `executed schema must create ${name}`);
        return [
          name,
          {
            columns: database
              .prepare(`PRAGMA index_info('${name}')`)
              .all()
              .map(row => row.name),
            partial: indexList.find(index => index.name === name)?.partial,
            sql: normalizeSql(record.sql),
          },
        ];
      }),
    );
    return { columns, indexes };
  } finally {
    database.close();
  }
}

test('scoped pairing credentials migration has exactly five additive columns', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const statements = sqlStatements(migration);
  const additions = statements.filter(statement => /\badd column\b/.test(statement));

  assert.deepEqual(
    additions,
    additiveColumns.map(column => `alter table sync_pairs add column ${column} text`),
  );
  assert.equal(additions.length, 5);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE)\b/i);
});

test('scoped pairing credentials migration has complete index definitions', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const statements = sqlStatements(migration);
  const indexes = statements.filter(statement => statement.startsWith('create index'));

  assert.deepEqual(indexes, [...indexStatements.values()]);
  assertIndexDefinitions(statements, 'migration 0003');
});

test('canonical schema has one copy of every scoped credential column and index', async () => {
  const schema = await readFile(schemaUrl, 'utf8');
  const definitions = syncPairColumnDefinitions(schema);
  const columnNames = definitions.map(definition => definition.split(/\s+/, 1)[0].toLowerCase());

  for (const column of schemaCredentialColumns) {
    assert.equal(
      definitions.filter(definition => new RegExp(`^${column}\\s+TEXT\\b`, 'i').test(definition)).length,
      1,
      `schema.sql must define ${column} as TEXT exactly once`,
    );
  }
  const firstCredentialColumn = columnNames.indexOf(schemaCredentialColumns[0]);
  assert.deepEqual(
    columnNames.slice(firstCredentialColumn, firstCredentialColumn + schemaCredentialColumns.length),
    schemaCredentialColumns,
    'scoped credential columns must remain in logical order',
  );
  assertIndexDefinitions(sqlStatements(schema), 'schema.sql');
});

test('migration result and fresh schema are executable and expose equivalent scoped structures', async () => {
  const [migration, schema] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(schemaUrl, 'utf8'),
  ]);
  const migrated = inspectSyncPairs(withoutScopedCredentials(schema), migration);
  const fresh = inspectSyncPairs(schema);
  const expectedIndexShape = {
    idx_sync_pairs_user_id_pair: {
      columns: ['user_id', 'pair_id'],
      partial: 0,
      sql: indexStatements.get('idx_sync_pairs_user_id_pair').replace(' if not exists', ''),
    },
    idx_sync_pairs_invitation_expiry: {
      columns: ['invitation_expires_at'],
      partial: 1,
      sql: indexStatements.get('idx_sync_pairs_invitation_expiry').replace(' if not exists', ''),
    },
    idx_sync_pairs_mobile_token: {
      columns: ['mobile_token_hash'],
      partial: 1,
      sql: indexStatements.get('idx_sync_pairs_mobile_token').replace(' if not exists', ''),
    },
  };

  for (const result of [migrated, fresh]) {
    for (const column of schemaCredentialColumns) {
      assert.deepEqual(
        result.columns.filter(definition => definition.name === column),
        [{ name: column, type: 'TEXT' }],
      );
    }
    assert.deepEqual(result.indexes, expectedIndexShape);
  }
});

test('worker test script runs authentication and schema contracts', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'));
  const testScript = packageJson.scripts?.test ?? '';

  assert.match(testScript, /\.\.\/tests\/test_worker_auth\.mjs\b/);
  assert.match(testScript, /\.\.\/tests\/test_worker_sync\.mjs\b/);
});
