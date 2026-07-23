import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker, {
  claimLegacyPair,
  consumeInvitation,
  deriveMobileToken,
  loadAccountPair,
  loadLegacyPair,
  loadMobilePair,
} from '../worker/src/index.js';
import { hasCloudSync } from '../worker/src/auth.js';

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

function fakeDb(resolve) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        async first() {
          calls.push({ operation: 'first', sql, bindings });
          return resolve({ operation: 'first', sql, bindings });
        },
        async run() {
          calls.push({ operation: 'run', sql, bindings });
          return resolve({ operation: 'run', sql, bindings }) || { meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };
}

const invitationFixture = {
  pairId: 'pair_identifier_1234',
  invitationTokenHash: 'invitation_hash',
  mobileTokenHash: 'mobile_hash',
  mobileDeviceId: 'mobile_device_1234',
};

test('advanced entitlement is required for cloud synchronization', () => {
  assert.equal(hasCloudSync({ entitlements: new Set(['advanced']) }), true);
  assert.equal(hasCloudSync({ entitlements: new Set(['free']) }), false);
  assert.equal(hasCloudSync(null), false);
});

test('mobile credential derivation is deterministic, secret-backed, and domain separated', async () => {
  const value = {
    pairId: 'pair_identifier_1234',
    invitationTokenHash: 'a'.repeat(64),
    mobileDeviceId: 'mobile_device_1234',
    claimNonce: 'A'.repeat(43),
  };
  const first = await deriveMobileToken({ MOBILE_CREDENTIAL_SECRET: 'T'.repeat(43) }, value);
  const retry = await deriveMobileToken({ MOBILE_CREDENTIAL_SECRET: 'T'.repeat(43) }, value);
  const otherSecret = await deriveMobileToken({ MOBILE_CREDENTIAL_SECRET: 'U'.repeat(43) }, value);
  const otherPair = await deriveMobileToken(
    { MOBILE_CREDENTIAL_SECRET: 'T'.repeat(43) },
    { ...value, pairId: 'other_pair_1234567' },
  );
  const otherInvitation = await deriveMobileToken(
    { MOBILE_CREDENTIAL_SECRET: 'T'.repeat(43) },
    { ...value, invitationTokenHash: 'b'.repeat(64) },
  );
  const otherDevice = await deriveMobileToken(
    { MOBILE_CREDENTIAL_SECRET: 'T'.repeat(43) },
    { ...value, mobileDeviceId: 'other_mobile_1234' },
  );
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first, retry);
  assert.notEqual(first, value.claimNonce);
  assert.notEqual(first, otherSecret);
  assert.notEqual(first, otherPair);
  assert.notEqual(first, otherInvitation);
  assert.notEqual(first, otherDevice);
});

test('account pairing lookup binds both pair and tenant', async () => {
  const DB = fakeDb(({ bindings }) => bindings[1] === 'user_b' ? { pair_id: 'pair_b' } : null);
  const pair = await loadAccountPair({ DB }, 'pair_b', 'user_a');
  assert.equal(pair, null);
  assert.match(DB.calls[0].sql, /pair_id = \? AND user_id = \?/);
  assert.doesNotMatch(DB.calls[0].sql, /SELECT \*/);
  assert.deepEqual(DB.calls[0].bindings, ['pair_b', 'user_a']);
});

test('mobile lookup binds pair, device, and hashed mobile credential', async () => {
  const DB = fakeDb(() => null);
  await loadMobilePair({ DB }, 'pair_a', 'device_a', 'hash_a');
  assert.match(DB.calls[0].sql, /pair_id = \?.*mobile_device_id = \?.*mobile_token_hash = \?/s);
  assert.doesNotMatch(DB.calls[0].sql, /SELECT \*/);
  assert.deepEqual(DB.calls[0].bindings, ['pair_a', 'device_a', 'hash_a']);
});

test('invitation consumption is atomic and single-use', async () => {
  let unused = true;
  const DB = fakeDb(({ operation }) => {
    if (operation !== 'first' || !unused) return null;
    unused = false;
    return { pair_id: invitationFixture.pairId };
  });
  assert.deepEqual(await consumeInvitation({ DB }, invitationFixture), {
    pair_id: invitationFixture.pairId,
  });
  assert.equal(await consumeInvitation({ DB }, invitationFixture), null);
  assert.match(DB.calls[0].sql, /invitation_consumed_at IS NULL/);
  assert.match(DB.calls[0].sql, /invitation_expires_at > CURRENT_TIMESTAMP/);
  assert.match(DB.calls[0].sql, /mobile_device_id IS NULL/);
  assert.match(DB.calls[0].sql, /RETURNING pair_id/);
});

test('legacy lookup requires a null account owner and legacy token hash', async () => {
  const DB = fakeDb(() => ({ pair_id: 'legacy_pair' }));
  await loadLegacyPair({ DB }, 'legacy_pair', 'legacy_hash');
  assert.match(DB.calls[0].sql, /user_id IS NULL/);
  assert.match(DB.calls[0].sql, /token_hash = \?/);
  assert.doesNotMatch(DB.calls[0].sql, /SELECT \*/);
});

test('legacy claim is a conditional atomic update with retry-safe device binding', async () => {
  const DB = fakeDb(() => ({ pair_id: 'legacy_pair' }));
  await claimLegacyPair({ DB }, {
    pairId: 'legacy_pair',
    legacyTokenHash: 'legacy_hash',
    mobileDeviceId: 'legacy_mobile_1234',
    pushEndpoint: null,
  });
  assert.match(DB.calls[0].sql, /^UPDATE sync_pairs SET/s);
  assert.match(DB.calls[0].sql, /user_id IS NULL/);
  assert.match(DB.calls[0].sql, /token_hash = \?/);
  assert.match(DB.calls[0].sql, /mobile_device_id IS NULL OR mobile_device_id = \?/);
  assert.match(DB.calls[0].sql, /RETURNING pair_id/);
});

const encoder = new TextEncoder();
const appOrigin = 'https://medication.bytesfx.com';
const validEncryptedSchedule = {
  ciphertext: 'encrypted-payload-value',
  iv: 'initialization-vector',
  updatedBy: 'source_device_1234',
};
function randomClaimNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function mobileClaim(mobileDeviceId, claimNonce = randomClaimNonce(), overrides = {}) {
  return { mobileDeviceId, claimNonce, ...overrides };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sqliteD1(database) {
  function wrapStatement(sql) {
    let bindings = [];
    const statement = {
      bind(...values) {
        bindings = values;
        return statement;
      },
      async first() {
        return database.prepare(sql).get(...bindings) || null;
      },
      async all() {
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes || 0) } };
      },
    };
    return statement;
  }
  return {
    prepare: wrapStatement,
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function workerFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(schemaUrl, 'utf8'));
  const sessions = {};
  for (const [suffix, entitled] of [['a', true], ['b', true], ['free', false]]) {
    const userId = `user_${suffix}`;
    const sessionToken = `mrs_${suffix.toUpperCase().padEnd(43, suffix === 'free' ? 'F' : suffix.toUpperCase())}`;
    database.prepare(`INSERT INTO app_users
      (user_id, google_subject, email_normalized, display_name)
      VALUES (?, ?, ?, ?)`).run(userId, `google_${suffix}`, `${suffix}@example.test`, `User ${suffix}`);
    database.prepare(`INSERT INTO app_sessions (session_hash, user_id, expires_at)
      VALUES (?, ?, ?)`).run(await sha256Hex(sessionToken), userId, '2099-01-01 00:00:00');
    if (entitled) {
      database.prepare(`INSERT INTO user_entitlements
        (user_id, feature_key, state, source) VALUES (?, 'advanced', 'active', 'test')`).run(userId);
    }
    sessions[suffix] = { sessionToken, userId };
  }
  const env = {
    DB: sqliteD1(database),
    LEGACY_V1_HOST: 'legacy.example.test',
    MOBILE_CREDENTIAL_SECRET: 'T'.repeat(43),
  };
  const ctx = { waitUntil() {} };
  return {
    database,
    env,
    sessions,
    close() {
      database.close();
    },
    request(path, {
      method = 'GET',
      origin = appOrigin,
      session = null,
      bearer = '',
      deviceId = '',
      csrf = false,
      body,
    } = {}) {
      const headers = {};
      if (session) headers.Cookie = `mrs_session=${session}`;
      if (bearer) headers.Authorization = `Bearer ${bearer}`;
      if (deviceId) headers['X-Medication-Device'] = deviceId;
      if (csrf) {
        headers.Origin = appOrigin;
        headers['X-Medication-CSRF'] = '1';
      }
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return worker.fetch(new Request(`${origin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }), env, ctx);
    },
    async createPair(sessionKey = 'a', overrides = {}) {
      const response = await this.request('/api/sync/pairs', {
        method: 'POST',
        session: sessions[sessionKey].sessionToken,
        csrf: true,
        body: {
          sourceId: `source_${sessionKey}_device_1234`,
          ...validEncryptedSchedule,
          ...overrides,
        },
      });
      return { response, body: await response.json() };
    },
  };
}

test('pair creation derives ownership, requires advanced entitlement, and keeps cookie CSRF', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());

  const unauthenticated = await fixture.request('/api/sync/pairs', {
    method: 'POST',
    csrf: true,
    body: { sourceId: 'unauth_source_1234', ...validEncryptedSchedule },
  });
  assert.equal(unauthenticated.status, 401);

  const free = await fixture.request('/api/sync/pairs', {
    method: 'POST',
    session: fixture.sessions.free.sessionToken,
    csrf: true,
    body: { sourceId: 'free_source_123456', ...validEncryptedSchedule },
  });
  assert.equal(free.status, 403);

  const missingCsrf = await fixture.request('/api/sync/pairs', {
    method: 'POST',
    session: fixture.sessions.a.sessionToken,
    body: { sourceId: 'csrf_source_123456', ...validEncryptedSchedule },
  });
  assert.equal(missingCsrf.status, 403);

  const clientPairId = 'client_chosen_pair_1234';
  const { response, body } = await fixture.createPair('a', {
    pairId: clientPairId,
    userId: fixture.sessions.b.userId,
  });
  assert.equal(response.status, 201);
  assert.match(body.pairId, /^[A-Za-z0-9_-]{16,128}$/);
  assert.notEqual(body.pairId, clientPairId);
  assert.match(body.invitationToken, /^[A-Za-z0-9_-]{40,256}$/);
  const lifetime = Date.parse(body.invitationExpiresAt) - Date.now();
  assert.ok(lifetime > 14 * 60_000 && lifetime <= 15 * 60_000);
  const stored = fixture.database.prepare('SELECT * FROM sync_pairs WHERE pair_id = ?').get(body.pairId);
  assert.equal(stored.user_id, fixture.sessions.a.userId);
  assert.equal(stored.updated_by, 'source_a_device_1234');
  assert.notEqual(stored.invitation_token_hash, body.invitationToken);
});

test('account pair routes are tenant-bound and legacy bearer cannot authorize owned rows', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body } = await fixture.createPair('a');
  const expectedFailure = { error: 'Pairing not found or credentials invalid' };

  const owner = await fixture.request(`/api/sync/pairs/${body.pairId}`, {
    session: fixture.sessions.a.sessionToken,
  });
  assert.equal(owner.status, 200);

  const otherTenant = await fixture.request(`/api/sync/pairs/${body.pairId}`, {
    session: fixture.sessions.b.sessionToken,
  });
  assert.equal(otherTenant.status, 404);
  assert.deepEqual(await otherTenant.json(), expectedFailure);

  const legacyBearer = await fixture.request(`/api/sync/pairs/${body.pairId}`, {
    bearer: body.invitationToken,
  });
  assert.equal(legacyBearer.status, 404);
  assert.deepEqual(await legacyBearer.json(), expectedFailure);

  const otherTenantDelete = await fixture.request(`/api/sync/pairs/${body.pairId}`, {
    method: 'DELETE',
    session: fixture.sessions.b.sessionToken,
    csrf: true,
  });
  assert.equal(otherTenantDelete.status, 404);
  assert.ok(fixture.database.prepare('SELECT pair_id FROM sync_pairs WHERE pair_id = ?').get(body.pairId));
});

test('exact legacy host bearer account sessions cannot authorize account-owned sync', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const legacyOrigin = 'https://legacy.example.test';
  const bearer = fixture.sessions.a.sessionToken;

  const create = await fixture.request('/sync/pairs', {
    method: 'POST',
    origin: legacyOrigin,
    bearer,
    body: { sourceId: 'legacy_host_source_1234', ...validEncryptedSchedule },
  });
  assert.equal(create.status, 401);

  const { body: created } = await fixture.createPair('a');
  for (const request of [
    { method: 'GET' },
    {
      method: 'PUT',
      body: { ...validEncryptedSchedule, baseRevision: 1 },
    },
    { method: 'POST', suffix: '/invitations' },
    { method: 'DELETE' },
  ]) {
    const response = await fixture.request(`/sync/pairs/${created.pairId}${request.suffix || ''}`, {
      origin: legacyOrigin,
      bearer,
      method: request.method,
      body: request.body,
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Pairing not found or credentials invalid' });
  }
  assert.ok(fixture.database.prepare('SELECT pair_id FROM sync_pairs WHERE pair_id = ?').get(created.pairId));
});

test('mobile invitation is one-use and returns a pair-and-device scoped credential', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  const mobileDeviceId = 'mobile_device_1234';
  const claimBody = {
    ...mobileClaim(mobileDeviceId),
    pushEndpoint: 'https://push.example.test/secret-subscription',
  };

  const claim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: claimBody,
  });
  assert.equal(claim.status, 200);
  const claimed = await claim.json();
  assert.equal(claimed.pairId, created.pairId);
  assert.match(claimed.mobileToken, /^[A-Za-z0-9_-]{40,256}$/);
  assert.equal(claimed.ciphertext, validEncryptedSchedule.ciphertext);

  const replay = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: { ...claimBody, claimNonce: randomClaimNonce() },
  });
  assert.equal(replay.status, 410);

  const mobile = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    bearer: claimed.mobileToken,
    deviceId: mobileDeviceId,
  });
  assert.equal(mobile.status, 200);

  for (const credentials of [
    { bearer: claimed.mobileToken, deviceId: 'different_device_1234' },
    { bearer: `${claimed.mobileToken.slice(0, -1)}A`, deviceId: mobileDeviceId },
  ]) {
    const denied = await fixture.request(`/api/sync/pairs/${created.pairId}`, credentials);
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: 'Pairing not found or credentials invalid' });
  }

  const mobileDelete = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'DELETE',
    bearer: claimed.mobileToken,
    deviceId: mobileDeviceId,
  });
  assert.equal(mobileDelete.status, 404);
});

test('account cookie cannot accompany invitation claim and does not consume it', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('b');
  const claimPath = `/api/sync/pairs/${created.pairId}/claim`;
  const mixed = await fixture.request(claimPath, {
    method: 'POST',
    session: fixture.sessions.a.sessionToken,
    bearer: created.invitationToken,
    body: mobileClaim('mixed_mobile_1234'),
  });
  assert.equal(mixed.status, 404);
  assert.deepEqual(await mixed.json(), { error: 'Pairing not found or credentials invalid' });
  const stored = fixture.database.prepare(
    'SELECT invitation_consumed_at, mobile_device_id FROM sync_pairs WHERE pair_id = ?',
  ).get(created.pairId);
  assert.equal(stored.invitation_consumed_at, null);
  assert.equal(stored.mobile_device_id, null);

  const clean = await fixture.request(claimPath, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('mixed_mobile_1234'),
  });
  assert.equal(clean.status, 200);
});

test('mobile credentials reject account cookies and remain scoped to one pair', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: pairA } = await fixture.createPair('a');
  const claim = await fixture.request(`/api/sync/pairs/${pairA.pairId}/claim`, {
    method: 'POST',
    bearer: pairA.invitationToken,
    body: mobileClaim('scoped_mobile_1234'),
  });
  const mobile = await claim.json();
  const { body: pairB } = await fixture.createPair('b');

  const mixedGet = await fixture.request(`/api/sync/pairs/${pairA.pairId}`, {
    session: fixture.sessions.b.sessionToken,
    bearer: mobile.mobileToken,
    deviceId: 'scoped_mobile_1234',
  });
  assert.equal(mixedGet.status, 404);
  assert.deepEqual(await mixedGet.json(), { error: 'Pairing not found or credentials invalid' });

  const mixedPut = await fixture.request(`/api/sync/pairs/${pairA.pairId}`, {
    method: 'PUT',
    session: fixture.sessions.b.sessionToken,
    bearer: mobile.mobileToken,
    deviceId: 'scoped_mobile_1234',
    body: {
      ...validEncryptedSchedule,
      updatedBy: 'scoped_mobile_1234',
      baseRevision: 1,
    },
  });
  assert.equal(mixedPut.status, 404);
  assert.deepEqual(await mixedPut.json(), { error: 'Pairing not found or credentials invalid' });

  const wrongPair = await fixture.request(`/api/sync/pairs/${pairB.pairId}`, {
    bearer: mobile.mobileToken,
    deviceId: 'scoped_mobile_1234',
  });
  assert.equal(wrongPair.status, 404);
  assert.deepEqual(await wrongPair.json(), { error: 'Pairing not found or credentials invalid' });

  const clean = await fixture.request(`/api/sync/pairs/${pairA.pairId}`, {
    bearer: mobile.mobileToken,
    deviceId: 'scoped_mobile_1234',
  });
  assert.equal(clean.status, 200);

  const malformedCookie = await fixture.request(`/api/sync/pairs/${pairA.pairId}`, {
    session: '%ZZ',
    bearer: mobile.mobileToken,
    deviceId: 'scoped_mobile_1234',
  });
  assert.equal(malformedCookie.status, 200);
});

test('entitlement revocation pauses account and mobile sync without blocking owner deletion', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  fixture.database.prepare(`UPDATE user_entitlements SET state = 'revoked'
    WHERE user_id = ? AND feature_key = 'advanced'`).run(fixture.sessions.a.userId);

  const inactiveInvitation = await fixture.request(`/api/sync/pairs/${created.pairId}/invitations`, {
    method: 'POST',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
    body: { previousInvitationToken: created.invitationToken },
  });
  assert.equal(inactiveInvitation.status, 403);
  assert.deepEqual(await inactiveInvitation.json(), { error: 'Cloud sync is not active for this pairing' });

  const inactiveClaim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('inactive_mobile_1234'),
  });
  assert.equal(inactiveClaim.status, 403);
  assert.deepEqual(await inactiveClaim.json(), { error: 'Cloud sync is not active for this pairing' });
  let stored = fixture.database.prepare(
    'SELECT invitation_consumed_at, mobile_device_id FROM sync_pairs WHERE pair_id = ?',
  ).get(created.pairId);
  assert.equal(stored.invitation_consumed_at, null);
  assert.equal(stored.mobile_device_id, null);

  fixture.database.prepare(`UPDATE user_entitlements SET state = 'active'
    WHERE user_id = ? AND feature_key = 'advanced'`).run(fixture.sessions.a.userId);
  const claim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('inactive_mobile_1234'),
  });
  assert.equal(claim.status, 200);
  const mobile = await claim.json();

  fixture.database.prepare(`UPDATE user_entitlements SET valid_until = '2000-01-01 00:00:00'
    WHERE user_id = ? AND feature_key = 'advanced'`).run(fixture.sessions.a.userId);
  for (const response of [
    await fixture.request(`/api/sync/pairs/${created.pairId}`, {
      session: fixture.sessions.a.sessionToken,
    }),
    await fixture.request(`/api/sync/pairs/${created.pairId}`, {
      method: 'PUT',
      session: fixture.sessions.a.sessionToken,
      csrf: true,
      body: { ...validEncryptedSchedule, baseRevision: 1 },
    }),
    await fixture.request(`/api/sync/pairs/${created.pairId}`, {
      bearer: mobile.mobileToken,
      deviceId: 'inactive_mobile_1234',
    }),
    await fixture.request(`/api/sync/pairs/${created.pairId}`, {
      method: 'PUT',
      bearer: mobile.mobileToken,
      deviceId: 'inactive_mobile_1234',
      body: { ...validEncryptedSchedule, baseRevision: 1 },
    }),
  ]) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Cloud sync is not active for this pairing' });
  }
  stored = fixture.database.prepare('SELECT revision FROM sync_pairs WHERE pair_id = ?').get(created.pairId);
  assert.equal(stored.revision, 1);

  const ownerDelete = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'DELETE',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
  });
  assert.equal(ownerDelete.status, 200);
  assert.equal(fixture.database.prepare('SELECT pair_id FROM sync_pairs WHERE pair_id = ?').get(created.pairId), undefined);
});

test('disabled and deletion-pending owners pause claim and scoped mobile sync until reactivated', async t => {
  for (const status of ['disabled', 'deletion_pending']) {
    await t.test(status, async () => {
      const fixture = await workerFixture();
      try {
        const { body: created } = await fixture.createPair('a');
        fixture.database.prepare('UPDATE app_users SET status = ? WHERE user_id = ?')
          .run(status, fixture.sessions.a.userId);

        const blockedClaim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
          method: 'POST',
          bearer: created.invitationToken,
          body: mobileClaim(`${status}_mobile_1234`),
        });
        assert.equal(blockedClaim.status, 403);
        assert.deepEqual(await blockedClaim.json(), { error: 'Cloud sync is not active for this pairing' });
        assert.equal(
          fixture.database.prepare('SELECT invitation_consumed_at FROM sync_pairs WHERE pair_id = ?')
            .get(created.pairId).invitation_consumed_at,
          null,
        );

        fixture.database.prepare("UPDATE app_users SET status = 'active' WHERE user_id = ?")
          .run(fixture.sessions.a.userId);
        const claim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
          method: 'POST',
          bearer: created.invitationToken,
          body: mobileClaim(`${status}_mobile_1234`),
        });
        assert.equal(claim.status, 200);
        const mobile = await claim.json();

        fixture.database.prepare('UPDATE app_users SET status = ? WHERE user_id = ?')
          .run(status, fixture.sessions.a.userId);
        for (const response of [
          await fixture.request(`/api/sync/pairs/${created.pairId}`, {
            bearer: mobile.mobileToken,
            deviceId: `${status}_mobile_1234`,
          }),
          await fixture.request(`/api/sync/pairs/${created.pairId}`, {
            method: 'PUT',
            bearer: mobile.mobileToken,
            deviceId: `${status}_mobile_1234`,
            body: { ...validEncryptedSchedule, baseRevision: 1 },
          }),
        ]) {
          assert.equal(response.status, 403);
          assert.deepEqual(await response.json(), { error: 'Cloud sync is not active for this pairing' });
        }

        fixture.database.prepare("UPDATE app_users SET status = 'active' WHERE user_id = ?")
          .run(fixture.sessions.a.userId);
        const recovered = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
          bearer: mobile.mobileToken,
          deviceId: `${status}_mobile_1234`,
        });
        assert.equal(recovered.status, 200);
      } finally {
        fixture.close();
      }
    });
  }
});

test('new mobile claim is idempotent for the same invitation device and claim nonce', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  const claimBody = mobileClaim('retry_mobile_1234');

  const invalid = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('retry_mobile_1234', 'too-short'),
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    fixture.database.prepare('SELECT invitation_consumed_at FROM sync_pairs WHERE pair_id = ?')
      .get(created.pairId).invitation_consumed_at,
    null,
  );

  const first = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: claimBody,
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.notEqual(firstBody.mobileToken, claimBody.claimNonce);
  assert.notEqual(firstBody.mobileToken, created.invitationToken);

  const retry = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: claimBody,
  });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), firstBody);

  for (const competing of [
    mobileClaim('other_mobile_1234', claimBody.claimNonce),
    mobileClaim(claimBody.mobileDeviceId),
  ]) {
    const response = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
      method: 'POST',
      bearer: created.invitationToken,
      body: competing,
    });
    assert.equal(response.status, 410);
  }
});

test('malformed claim nonce is uniformly rejected before invitation state lookup', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  const malformed = mobileClaim('malformed_mobile_1234', 'too-short');
  const underlyingDb = fixture.env.DB;
  fixture.env.DB = {
    ...underlyingDb,
    prepare(sql) {
      if (/invitation_token_hash/.test(sql)) {
        throw new Error('malformed nonce must not query invitation state');
      }
      return underlyingDb.prepare(sql);
    },
  };

  const validInvitation = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: malformed,
  });
  const unknownInvitation = await fixture.request('/api/sync/pairs/unknown_pair_123456/claim', {
    method: 'POST',
    bearer: 'Z'.repeat(43),
    body: malformed,
  });
  assert.equal(validInvitation.status, 400);
  assert.equal(unknownInvitation.status, 400);
  assert.deepEqual(await validInvitation.json(), { error: 'Invalid claim nonce' });
  assert.deepEqual(await unknownInvitation.json(), { error: 'Invalid claim nonce' });
  fixture.env.DB = underlyingDb;
  assert.equal(
    fixture.database.prepare('SELECT invitation_consumed_at FROM sync_pairs WHERE pair_id = ?')
      .get(created.pairId).invitation_consumed_at,
    null,
  );

  const claimBody = mobileClaim('malformed_mobile_1234');
  const claim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: claimBody,
  });
  assert.equal(claim.status, 200);
  const historical = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: malformed,
  });
  assert.equal(historical.status, 400);
  assert.deepEqual(await historical.json(), { error: 'Invalid claim nonce' });
});

test('missing mobile credential secret fails without consuming invitation', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  delete fixture.env.MOBILE_CREDENTIAL_SECRET;
  const response = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('secret_mobile_1234'),
  });
  assert.equal(response.status, 503);
  assert.equal(
    fixture.database.prepare('SELECT invitation_consumed_at FROM sync_pairs WHERE pair_id = ?')
      .get(created.pairId).invitation_consumed_at,
    null,
  );
});

test('successful claim returns from the atomic update without a credential-bound post-read', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  const underlyingDb = fixture.env.DB;
  fixture.env.DB = {
    ...underlyingDb,
    prepare(sql) {
      if (/^SELECT[\s\S]*mobile_device_id = \? AND mobile_token_hash = \?/i.test(sql.trim())) {
        throw new Error('post-claim credential read must not occur');
      }
      return underlyingDb.prepare(sql);
    },
  };
  const response = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('atomic_mobile_1234'),
  });
  assert.equal(response.status, 200);
  assert.match((await response.json()).mobileToken, /^[A-Za-z0-9_-]{43}$/);
});

test('invitation refresh compare-and-set allows only one concurrent winner', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  const request = () => fixture.request(`/api/sync/pairs/${created.pairId}/invitations`, {
    method: 'POST',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
    body: { previousInvitationToken: created.invitationToken },
  });
  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = responses.find(response => response.status === 200);
  assert.match((await winner.json()).invitationToken, /^[A-Za-z0-9_-]{43}$/);
});

test('account and scoped mobile updates derive updated_by from authenticated device identity', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  const claim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('integrity_mobile_1234'),
  });
  const mobile = await claim.json();

  const accountUpdate = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'PUT',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
    body: { ...validEncryptedSchedule, updatedBy: 'spoofed_account_1234', baseRevision: 1 },
  });
  assert.equal(accountUpdate.status, 200);
  assert.equal(
    fixture.database.prepare('SELECT updated_by FROM sync_pairs WHERE pair_id = ?').get(created.pairId).updated_by,
    'source_a_device_1234',
  );

  const mobileUpdate = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'PUT',
    bearer: mobile.mobileToken,
    deviceId: 'integrity_mobile_1234',
    body: { ...validEncryptedSchedule, updatedBy: 'spoofed_mobile_1234', baseRevision: 2 },
  });
  assert.equal(mobileUpdate.status, 200);
  assert.equal(
    fixture.database.prepare('SELECT updated_by FROM sync_pairs WHERE pair_id = ?').get(created.pairId).updated_by,
    'integrity_mobile_1234',
  );
});

test('legacy claim is atomic for competing devices and idempotent for the winner', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const legacyToken = 'Q'.repeat(43);
  fixture.database.prepare(`INSERT INTO sync_pairs
    (pair_id, source_id, user_id, token_hash, ciphertext, iv, updated_by)
    VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(
    'legacy_race_123456',
    'legacy_race_source',
    await sha256Hex(legacyToken),
    validEncryptedSchedule.ciphertext,
    validEncryptedSchedule.iv,
    validEncryptedSchedule.updatedBy,
  );
  const claim = device => fixture.request('/api/sync/pairs/legacy_race_123456/claim', {
    method: 'POST',
    bearer: legacyToken,
    body: mobileClaim(device),
  });
  const winner = await claim('legacy_winner_1234');
  assert.equal(winner.status, 200);
  const retry = await claim('legacy_winner_1234');
  assert.equal(retry.status, 200);
  const loser = await claim('legacy_loser_12345');
  assert.equal(loser.status, 409);
  assert.equal(
    fixture.database.prepare("SELECT mobile_device_id FROM sync_pairs WHERE pair_id = 'legacy_race_123456'").get().mobile_device_id,
    'legacy_winner_1234',
  );
});

test('expired and incorrect invitations use the same safe not-found response', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  fixture.database.prepare(`UPDATE sync_pairs SET invitation_expires_at = '2000-01-01 00:00:00'
    WHERE pair_id = ?`).run(created.pairId);

  for (const invitationToken of [created.invitationToken, 'Z'.repeat(43)]) {
    const response = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
      method: 'POST',
      bearer: invitationToken,
      body: mobileClaim('mobile_device_1234'),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Pairing not found or credentials invalid' });
  }
});

test('invitation refresh is tenant-scoped and invalidates the previous invitation', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');

  const wrongTenant = await fixture.request(`/api/sync/pairs/${created.pairId}/invitations`, {
    method: 'POST',
    session: fixture.sessions.b.sessionToken,
    csrf: true,
    body: { previousInvitationToken: created.invitationToken },
  });
  assert.equal(wrongTenant.status, 404);

  const refreshedResponse = await fixture.request(`/api/sync/pairs/${created.pairId}/invitations`, {
    method: 'POST',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
    body: { previousInvitationToken: created.invitationToken },
  });
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json();
  assert.notEqual(refreshed.invitationToken, created.invitationToken);

  const staleClaim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim('mobile_device_1234'),
  });
  assert.equal(staleClaim.status, 404);

  const currentClaim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: refreshed.invitationToken,
    body: mobileClaim('mobile_device_1234'),
  });
  assert.equal(currentClaim.status, 200);
});

test('account and mobile updates retain separate scoped authorization predicates', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const { body: created } = await fixture.createPair('a');
  const mobileDeviceId = 'mobile_device_1234';
  const claim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: created.invitationToken,
    body: mobileClaim(mobileDeviceId),
  });
  const claimed = await claim.json();

  const mobileUpdate = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'PUT',
    bearer: claimed.mobileToken,
    deviceId: mobileDeviceId,
    body: {
      ...validEncryptedSchedule,
      ciphertext: 'mobile-encrypted-payload',
      updatedBy: mobileDeviceId,
      baseRevision: 1,
    },
  });
  assert.equal(mobileUpdate.status, 200);
  assert.equal((await mobileUpdate.json()).revision, 2);

  const sourceWithoutCsrf = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'PUT',
    session: fixture.sessions.a.sessionToken,
    body: {
      ...validEncryptedSchedule,
      ciphertext: 'source-encrypted-payload',
      baseRevision: 2,
    },
  });
  assert.equal(sourceWithoutCsrf.status, 403);

  const sourceUpdate = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'PUT',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
    body: {
      ...validEncryptedSchedule,
      ciphertext: 'source-encrypted-payload',
      baseRevision: 2,
    },
  });
  assert.equal(sourceUpdate.status, 200);
  assert.equal((await sourceUpdate.json()).revision, 3);

  const otherTenantUpdate = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'PUT',
    session: fixture.sessions.b.sessionToken,
    csrf: true,
    body: {
      ...validEncryptedSchedule,
      ciphertext: 'tenant-b-encrypted',
      baseRevision: 3,
    },
  });
  assert.equal(otherTenantUpdate.status, 404);
});

test('legacy records remain bearer-compatible only while account owner is null', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const legacyToken = 'L'.repeat(43);
  fixture.database.prepare(`INSERT INTO sync_pairs
    (pair_id, source_id, user_id, token_hash, ciphertext, iv, updated_by)
    VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(
    'legacy_pair_123456',
    'legacy_source_1234',
    await sha256Hex(legacyToken),
    validEncryptedSchedule.ciphertext,
    validEncryptedSchedule.iv,
    validEncryptedSchedule.updatedBy,
  );

  const compatible = await fixture.request('/api/sync/pairs/legacy_pair_123456', {
    bearer: legacyToken,
  });
  assert.equal(compatible.status, 200);

  fixture.database.prepare(`UPDATE sync_pairs SET user_id = ?
    WHERE pair_id = 'legacy_pair_123456'`).run(fixture.sessions.a.userId);
  const blocked = await fixture.request('/api/sync/pairs/legacy_pair_123456', {
    bearer: legacyToken,
  });
  assert.equal(blocked.status, 404);
});

test('pairing audit metadata never records application or credential secrets', async t => {
  const fixture = await workerFixture();
  t.after(() => fixture.close());
  const medicationName = 'Highly Sensitive Medicine';
  const googleCredential = 'google.identity.credential';
  const encryptionKey = 'encryption-key-secret';
  const { body: created } = await fixture.createPair('a');
  const invitationResponse = await fixture.request(`/api/sync/pairs/${created.pairId}/invitations`, {
    method: 'POST',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
    body: { previousInvitationToken: created.invitationToken },
  });
  const invitation = await invitationResponse.json();
  const claim = await fixture.request(`/api/sync/pairs/${created.pairId}/claim`, {
    method: 'POST',
    bearer: invitation.invitationToken,
    body: {
      ...mobileClaim('audit_mobile_1234'),
      pushEndpoint: 'https://push.example.test/audit-secret',
    },
  });
  const claimed = await claim.json();
  const update = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'PUT',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
    body: {
      ...validEncryptedSchedule,
      ciphertext: 'replacement-encrypted-payload',
      baseRevision: 1,
    },
  });
  assert.equal(update.status, 200);
  const revoke = await fixture.request(`/api/sync/pairs/${created.pairId}`, {
    method: 'DELETE',
    session: fixture.sessions.a.sessionToken,
    csrf: true,
  });
  assert.equal(revoke.status, 200);
  const serialized = JSON.stringify(
    fixture.database.prepare('SELECT event_type, metadata_json FROM account_audit_events').all(),
  );
  const auditRows = fixture.database.prepare(
    "SELECT metadata_json FROM account_audit_events WHERE event_type LIKE 'sync_pair_%'",
  ).all();
  for (const row of auditRows) {
    const metadata = JSON.parse(row.metadata_json);
    assert.deepEqual(
      Object.keys(metadata).sort(),
      ['deviceId', 'pairId', 'result', 'revision'],
    );
  }
  assert.deepEqual(
    auditRows.map(row => JSON.parse(row.metadata_json).result),
    ['created', 'invited', 'claimed', 'updated', 'revoked'],
  );
  for (const secret of [
    medicationName,
    validEncryptedSchedule.ciphertext,
    validEncryptedSchedule.iv,
    encryptionKey,
    created.invitationToken,
    invitation.invitationToken,
    claimed.mobileToken,
    googleCredential,
    fixture.sessions.a.sessionToken,
    'https://push.example.test/audit-secret',
  ]) {
    assert.equal(serialized.includes(secret), false, `audit metadata leaked ${secret}`);
  }
});
