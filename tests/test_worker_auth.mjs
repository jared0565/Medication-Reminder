import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

globalThis.crypto ??= webcrypto;
const auth = await import('../worker/src/auth.js');
const workerModule = await import('../worker/src/index.js');
const {
  handleAuthRequest,
  resetGoogleKeysForTests,
  verifyGoogleCredential,
} = auth;
const worker = workerModule.default;

const CLIENT_ID = '2793524917-3ghmb71lup4scgs96a65kf73i9vreed1.apps.googleusercontent.com';
const LEGACY_V1_HOST = 'medication-reminder-push.bmorris0565.workers.dev';
const encoder = new TextEncoder();
const b64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const sha256Hex = async value => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

async function fixture(overrides = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'test-key', typ: 'JWT' };
  const claims = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '123456789012345678901',
    email: 'Person@Example.com',
    email_verified: true,
    name: 'Test Person',
    iat: now,
    exp: now + 300,
    ...overrides,
  };
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(unsigned));
  const token = `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
  const fetcher = async () => ({
    ok: true,
    headers: new Headers({ 'Cache-Control': 'max-age=60' }),
    async json() { return { keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }; },
  });
  return { token, fetcher, now };
}

function json(_request, value, init = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

function authDatabase({
  sessionToken,
  auditFailure = false,
  entitlementsFailure = false,
  lastSeenFailure = false,
  sessionDeleteFailure = false,
  sessionLookupFailure = false,
} = {}) {
  const user = {
    user_id: 'user-1',
    email_normalized: 'person@example.com',
    display_name: 'Test Person',
    picture_url: null,
    intended_start_date: null,
    intended_end_date: null,
    status: 'active',
    session_hash: sessionToken ? 'stored-session-hash' : undefined,
  };
  const calls = [];

  return {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (sql.includes('FROM app_sessions')) {
            if (sessionLookupFailure) throw new Error('session lookup unavailable');
            if (!sessionToken) return null;
            const expectedHash = await sha256Hex(sessionToken);
            return this.values[0] === expectedHash
              ? { ...user, session_hash: expectedHash }
              : null;
          }
          if (sql.includes('WHERE google_subject = ?')) return { user_id: user.user_id };
          if (sql.includes('FROM app_users WHERE user_id = ?')) return user;
          return null;
        },
        async all() {
          if (entitlementsFailure && sql.includes('FROM user_entitlements')) {
            throw new Error('entitlements unavailable');
          }
          if (sql.includes('FROM user_entitlements')) return { results: [] };
          return { results: [] };
        },
        async run() {
          calls.push({ sql, values: this.values });
          if (lastSeenFailure && sql.includes('UPDATE app_sessions SET last_seen_at')) {
            throw new Error('last seen unavailable');
          }
          if (sessionDeleteFailure && sql.includes('DELETE FROM app_sessions WHERE session_hash = ?')) {
            throw new Error('session delete unavailable');
          }
          if (auditFailure && sql.includes('INSERT INTO account_audit_events')) {
            throw new Error('audit unavailable');
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      calls.push(...statements.map(statement => ({ sql: statement.sql, values: statement.values })));
      return statements.map(() => ({ success: true }));
    },
  };
}

test('session cookies are scoped and hardened without a Domain attribute', () => {
  assert.equal(typeof auth.sessionCookie, 'function');
  const cookie = auth.sessionCookie('mrs_example', 3600);
  assert.match(cookie, /^mrs_session=mrs_example;/);
  for (const attribute of ['Path=/api', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=3600']) {
    assert.ok(cookie.includes(attribute), `expected ${attribute} in ${cookie}`);
  }
  assert.doesNotMatch(cookie, /(?:^|;\s*)Domain=/i);
});

test('session cookies fail closed when Max-Age is Infinity', () => {
  assert.ok(auth.sessionCookie('mrs_example', Infinity).includes('Max-Age=0'));
});

test('session cookies fail closed when Max-Age is NaN', () => {
  assert.ok(auth.sessionCookie('mrs_example', Number.NaN).includes('Max-Age=0'));
});

test('session cookies clamp a negative Max-Age to zero', () => {
  assert.ok(auth.sessionCookie('mrs_example', -1).includes('Max-Age=0'));
});

test('session cookies truncate a finite decimal Max-Age', () => {
  assert.ok(auth.sessionCookie('mrs_example', 42.9).includes('Max-Age=42'));
});

test('session cookies clamp an oversized Max-Age to the session TTL', () => {
  const sessionTtlSeconds = 30 * 24 * 60 * 60;
  assert.ok(auth.sessionCookie('mrs_example', sessionTtlSeconds + 1).includes(`Max-Age=${sessionTtlSeconds}`));
});

test('clearing the session cookie retains its security and path attributes', () => {
  assert.equal(typeof auth.clearSessionCookie, 'function');
  const cookie = auth.clearSessionCookie();
  for (const attribute of ['mrs_session=', 'Path=/api', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=0']) {
    assert.ok(cookie.includes(attribute), `expected ${attribute} in ${cookie}`);
  }
  assert.doesNotMatch(cookie, /(?:^|;\s*)Domain=/i);
});

test('session tokens prefer the cookie and retain the bearer migration fallback', () => {
  assert.equal(typeof auth.readSessionToken, 'function');
  const cookieToken = `mrs_${'c'.repeat(43)}`;
  const bearerToken = `mrs_${'b'.repeat(43)}`;
  const cookieRequest = new Request('https://example.test/api/auth/me', {
    headers: {
      Cookie: `theme=dark; mrs_session=${cookieToken}; locale=en-GB`,
      Authorization: `Bearer ${cookieToken}`,
    },
  });
  assert.equal(auth.readSessionToken(cookieRequest), cookieToken);

  const bearerRequest = new Request('https://example.test/auth/me', {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.equal(auth.readSessionToken(bearerRequest), bearerToken);
});

test('malformed or unrelated cookies do not block a valid bearer migration token', () => {
  assert.equal(typeof auth.readSessionToken, 'function');
  const bearerToken = `mrs_${'b'.repeat(43)}`;
  const request = new Request('https://example.test/auth/me', {
    headers: {
      Cookie: 'mrs_session=%E0%A4%A; unrelated=value',
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  assert.equal(auth.readSessionToken(request), bearerToken);
});

test('session credential parser rejects duplicate session cookie names', () => {
  assert.equal(typeof auth.parseSessionCredential, 'function');
  const token = `mrs_${'a'.repeat(43)}`;
  const request = new Request('https://example.test/api/auth/me', {
    headers: {
      Cookie: `mrs_session=${token}; theme=dark; mrs_session=${token}`,
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(auth.parseSessionCredential(request), null);
});

test('session credential parser strictly rejects malformed cookie values', () => {
  assert.equal(typeof auth.parseSessionCredential, 'function');
  for (const value of ['mrs_short', 'not-a-session', 'mrs_%20', '%E0%A4%A']) {
    const request = new Request('https://example.test/api/auth/me', {
      headers: { Cookie: `mrs_session=${value}` },
    });
    assert.equal(auth.parseSessionCredential(request), null);
  }
});

test('a malformed session cookie does not suppress a valid migration bearer', () => {
  assert.equal(typeof auth.parseSessionCredential, 'function');
  const token = `mrs_${'b'.repeat(43)}`;
  const request = new Request('https://example.test/auth/me', {
    headers: {
      Cookie: 'mrs_session=mrs_short',
      Authorization: `Bearer ${token}`,
    },
  });
  assert.deepEqual(auth.parseSessionCredential(request), { kind: 'bearer', token });
});

test('conflicting valid cookie and bearer credentials fail closed', () => {
  assert.equal(typeof auth.parseSessionCredential, 'function');
  const cookieToken = `mrs_${'c'.repeat(43)}`;
  const bearerToken = `mrs_${'b'.repeat(43)}`;
  const request = new Request('https://example.test/api/auth/me', {
    headers: {
      Cookie: `mrs_session=${cookieToken}`,
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  assert.equal(auth.parseSessionCredential(request), null);
});

test('identical valid cookie and bearer credentials resolve to the cookie kind', () => {
  assert.equal(typeof auth.parseSessionCredential, 'function');
  const token = `mrs_${'a'.repeat(43)}`;
  const request = new Request('https://example.test/api/auth/me', {
    headers: {
      Cookie: `mrs_session=${token}`,
      Authorization: `Bearer ${token}`,
    },
  });
  assert.deepEqual(auth.parseSessionCredential(request), { kind: 'cookie', token });
});

test('session lookup only authenticates the token hash configured by the DB fixture', async () => {
  const storedToken = `mrs_${'a'.repeat(43)}`;
  const differentToken = `mrs_${'b'.repeat(43)}`;
  const request = new Request('https://example.test/auth/me', {
    headers: { Authorization: `Bearer ${differentToken}` },
  });
  const account = await auth.authenticateSession(
    request,
    { DB: authDatabase({ sessionToken: storedToken }) },
    { touch: false },
  );
  assert.equal(account, null);
});

test('CSRF validation allows safe methods without headers', () => {
  assert.equal(typeof auth.validCsrfRequest, 'function');
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(auth.validCsrfRequest(new Request('https://example.test/api/auth/me', { method })), true);
  }
});

test('CSRF validation requires the exact app origin and marker for mutations', () => {
  assert.equal(typeof auth.validCsrfRequest, 'function');
  const valid = new Request('https://example.test/api/auth/me', {
    method: 'PATCH',
    headers: { Origin: 'https://medication.bytesfx.com', 'X-Medication-CSRF': '1' },
  });
  assert.equal(auth.validCsrfRequest(valid), true);

  for (const headers of [
    { 'X-Medication-CSRF': '1' },
    { Origin: 'https://medication.bytesfx.com' },
    { Origin: 'https://medication.bytesfx.com/', 'X-Medication-CSRF': '1' },
    { Origin: 'https://medication.bytesfx.com', 'X-Medication-CSRF': 'true' },
  ]) {
    assert.equal(auth.validCsrfRequest(new Request('https://example.test/api/auth/me', { method: 'PATCH', headers })), false);
  }
});

test('Google sign-in sets a secure session cookie without exposing session secrets', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    const request = new Request('https://medication.bytesfx.com/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: token }),
    });
    const database = authDatabase();
    const response = await handleAuthRequest(
      request,
      { DB: database, GOOGLE_CLIENT_ID: CLIENT_ID },
      new URL('https://medication.bytesfx.com/auth/google'),
      {
        json,
        readJson: currentRequest => currentRequest.json(),
        enforceRateLimit: async () => true,
        apiVersion: 2,
      },
    );
    assert.equal(response.status, 200);
    const cookie = response.headers.get('Set-Cookie');
    assert.match(cookie, /^mrs_session=mrs_/);
    assert.ok(cookie.includes('Path=/api'));
    assert.ok(cookie.includes('HttpOnly'));
    const body = await response.json();
    assert.equal(body.sessionToken, undefined);
    assert.equal(body.expiresAt, undefined);
    assert.equal(body.user.email, 'person@example.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sign-out clears the hardened session cookie', async () => {
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const database = authDatabase({ sessionToken });
  const request = new Request('https://medication.bytesfx.com/api/auth/session', {
    method: 'DELETE',
    headers: { Cookie: `mrs_session=${sessionToken}` },
  });
  const response = await handleAuthRequest(
    request,
    { DB: database },
    new URL('https://medication.bytesfx.com/auth/session'),
    {
      json,
      readJson: currentRequest => currentRequest.json(),
      enforceRateLimit: async () => true,
      apiVersion: 2,
    },
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get('Set-Cookie');
  assert.ok(cookie.includes('mrs_session='));
  assert.ok(cookie.includes('Path=/api'));
  assert.ok(cookie.includes('HttpOnly'));
  assert.ok(cookie.includes('Secure'));
  assert.ok(cookie.includes('SameSite=Strict'));
  assert.ok(cookie.includes('Max-Age=0'));
});

test('v2 Google sign-in requires CSRF and returns only the cookie-based account contract', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    const request = new Request('https://medication.bytesfx.com/api/auth/google', {
      method: 'POST',
      headers: {
        Origin: 'https://medication.bytesfx.com',
        'X-Medication-CSRF': '1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credential: token }),
    });
    const response = await worker.fetch(
      request,
      { DB: authDatabase(), GOOGLE_CLIENT_ID: CLIENT_ID },
      { waitUntil() {} },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Set-Cookie') || '', /^mrs_session=mrs_/);
    const body = await response.json();
    assert.equal(body.sessionToken, undefined);
    assert.equal(body.expiresAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy v1 Google sign-in keeps the deployed bearer-client response contract without CSRF', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    const request = new Request(`https://${LEGACY_V1_HOST}/auth/google`, {
      method: 'POST',
      headers: {
        Origin: 'https://medication.bytesfx.com',
        Cookie: `mrs_session=mrs_${'s'.repeat(43)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credential: token }),
    });
    const response = await worker.fetch(
      request,
      { DB: authDatabase(), GOOGLE_CLIENT_ID: CLIENT_ID, LEGACY_V1_HOST },
      { waitUntil() {} },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Set-Cookie'), null);
    const body = await response.json();
    assert.match(body.sessionToken, /^mrs_[A-Za-z0-9_-]{43}$/);
    assert.equal(typeof body.expiresAt, 'string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unrelated and preview-like workers.dev hosts cannot enter the legacy v1 Google contract', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher } = await fixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    for (const hostname of [
      'unrelated.workers.dev',
      'preview-medication-reminder-push.bmorris0565.workers.dev',
    ]) {
      const request = new Request(`https://${hostname}/auth/google`, {
        method: 'POST',
        headers: {
          Origin: 'https://medication.bytesfx.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credential: token }),
      });
      const response = await worker.fetch(
        request,
        { DB: authDatabase(), GOOGLE_CLIENT_ID: CLIENT_ID, LEGACY_V1_HOST },
        { waitUntil() {} },
      );
      assert.equal(response.status, 403, hostname);
      assert.equal((await response.json()).sessionToken, undefined, hostname);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy v1 bearer PATCH remains compatible without CSRF', async () => {
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const request = new Request(`https://${LEGACY_V1_HOST}/auth/me`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ intendedStartDate: '2026-08-01', intendedEndDate: '2026-08-31' }),
  });
  const response = await worker.fetch(
    request,
    { DB: authDatabase({ sessionToken }), LEGACY_V1_HOST },
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.intendedStartDate, '2026-08-01');
});

test('legacy v1 cookie PATCH requires CSRF based on parsed credential kind', async () => {
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const request = new Request(`https://${LEGACY_V1_HOST}/auth/me`, {
    method: 'PATCH',
    headers: {
      Cookie: `mrs_session=${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ intendedStartDate: null, intendedEndDate: null }),
  });
  const response = await worker.fetch(
    request,
    { DB: authDatabase({ sessionToken }), LEGACY_V1_HOST },
    { waitUntil() {} },
  );
  assert.equal(response.status, 403);
});

test('legacy v1 cookie PATCH succeeds with the exact CSRF proof', async () => {
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const request = new Request(`https://${LEGACY_V1_HOST}/auth/me`, {
    method: 'PATCH',
    headers: {
      Cookie: `mrs_session=${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
      'X-Medication-CSRF': '1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ intendedStartDate: null, intendedEndDate: null }),
  });
  const response = await worker.fetch(
    request,
    { DB: authDatabase({ sessionToken }), LEGACY_V1_HOST },
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
});

test('expired or revoked v2 session logout is idempotent and clears the cookie', async () => {
  const expiredToken = `mrs_${'e'.repeat(43)}`;
  const request = new Request('https://medication.bytesfx.com/api/auth/session', {
    method: 'DELETE',
    headers: {
      Cookie: `mrs_session=${expiredToken}`,
      Origin: 'https://medication.bytesfx.com',
      'X-Medication-CSRF': '1',
    },
  });
  const response = await worker.fetch(request, { DB: authDatabase() }, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.ok((response.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
});

test('session lookup failure returns 503 while still clearing the cookie', async t => {
  t.mock.method(console, 'error', () => {});
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const database = authDatabase({ sessionToken, sessionLookupFailure: true });
  const request = new Request('https://medication.bytesfx.com/api/auth/session', {
    method: 'DELETE',
    headers: {
      Cookie: `mrs_session=${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
      'X-Medication-CSRF': '1',
    },
  });
  const response = await worker.fetch(request, { DB: database }, { waitUntil() {} });
  assert.equal(response.status, 503);
  assert.ok((response.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
  assert.match((await response.json()).error, /revocation could not be confirmed/i);
  assert.deepEqual(
    console.error.mock.calls.map(call => call.arguments),
    [['session_sign_out_lookup_failed']],
  );
});

test('audit failure does not prevent valid v2 logout from clearing the cookie', async t => {
  t.mock.method(console, 'warn', () => {});
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const database = authDatabase({ sessionToken, auditFailure: true });
  const request = new Request('https://medication.bytesfx.com/api/auth/session', {
    method: 'DELETE',
    headers: {
      Cookie: `mrs_session=${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
      'X-Medication-CSRF': '1',
    },
  });
  const response = await worker.fetch(request, { DB: database }, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.ok((response.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
  assert.deepEqual(
    console.warn.mock.calls.map(call => call.arguments),
    [['session_sign_out_audit_failed']],
  );
});

test('session deletion failure returns 503, clears the cookie, and skips audit', async t => {
  t.mock.method(console, 'error', () => {});
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const database = authDatabase({ sessionToken, sessionDeleteFailure: true });
  const request = new Request('https://medication.bytesfx.com/api/auth/session', {
    method: 'DELETE',
    headers: {
      Cookie: `mrs_session=${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
      'X-Medication-CSRF': '1',
    },
  });
  const response = await worker.fetch(request, { DB: database }, { waitUntil() {} });
  assert.equal(response.status, 503);
  assert.ok((response.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
  assert.match((await response.json()).error, /revocation could not be confirmed/i);
  assert.equal(database.calls.some(call => call.sql.includes('INSERT INTO account_audit_events')), false);
  assert.deepEqual(
    console.error.mock.calls.map(call => call.arguments),
    [['session_sign_out_revocation_failed']],
  );
});

test('valid v2 cookie logout deletes the server session and clears the cookie', async () => {
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const database = authDatabase({ sessionToken });
  const request = new Request('https://medication.bytesfx.com/api/auth/session', {
    method: 'DELETE',
    headers: {
      Cookie: `mrs_session=${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
      'X-Medication-CSRF': '1',
    },
  });
  const response = await worker.fetch(request, { DB: database }, { waitUntil() {} });
  assert.equal(response.status, 200);
  const deleteCall = database.calls.find(call => call.sql.includes('DELETE FROM app_sessions WHERE session_hash = ?'));
  assert.deepEqual(deleteCall?.values, [await sha256Hex(sessionToken)]);
  assert.ok((response.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
});

test('logout revocation does not depend on last-seen or entitlement work', async () => {
  const sessionToken = `mrs_${'a'.repeat(43)}`;
  const database = authDatabase({
    sessionToken,
    entitlementsFailure: true,
    lastSeenFailure: true,
  });
  const request = new Request('https://medication.bytesfx.com/api/auth/session', {
    method: 'DELETE',
    headers: {
      Cookie: `mrs_session=${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
      'X-Medication-CSRF': '1',
    },
  });
  const response = await worker.fetch(request, { DB: database }, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.ok(database.calls.some(call => call.sql.includes('DELETE FROM app_sessions WHERE session_hash = ?')));
  assert.ok((response.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
});

test('legacy v1 bearer logout deletes the session without CSRF and stays 200 compatible', async () => {
  const sessionToken = `mrs_${'b'.repeat(43)}`;
  const database = authDatabase({ sessionToken });
  const request = new Request(`https://${LEGACY_V1_HOST}/auth/session`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      Origin: 'https://medication.bytesfx.com',
    },
  });
  const response = await worker.fetch(request, { DB: database, LEGACY_V1_HOST }, { waitUntil() {} });
  assert.equal(response.status, 200);
  const deleteCall = database.calls.find(call => call.sql.includes('DELETE FROM app_sessions WHERE session_hash = ?'));
  assert.deepEqual(deleteCall?.values, [await sha256Hex(sessionToken)]);
  assert.ok((response.headers.get('Set-Cookie') || '').includes('Max-Age=0'));
});

test('protected browser auth mutations are rejected before route dispatch without valid CSRF headers', async () => {
  for (const [method, path] of [
    ['POST', '/api/auth/google'],
    ['PATCH', '/api/auth/me'],
    ['DELETE', '/api/auth/session'],
  ]) {
    const request = new Request(`https://medication.bytesfx.com${path}`, { method });
    const response = await worker.fetch(request, {}, { waitUntil() {} });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
});

test('v2 account routes reject valid legacy bearer sessions even with valid browser CSRF proof', async () => {
  const sessionToken = `mrs_${'b'.repeat(43)}`;
  for (const [method, path, body] of [
    ['GET', '/api/auth/me', undefined],
    ['PATCH', '/api/auth/me', JSON.stringify({
      intendedStartDate: '2026-08-01',
      intendedEndDate: '2026-08-31',
    })],
    ['DELETE', '/api/auth/session', undefined],
  ]) {
    const database = authDatabase({ sessionToken });
    const headers = {
      Authorization: `Bearer ${sessionToken}`,
    };
    if (method !== 'GET') {
      headers.Origin = 'https://medication.bytesfx.com';
      headers['X-Medication-CSRF'] = '1';
      if (body) headers['Content-Type'] = 'application/json';
    }
    const request = new Request(`https://medication.bytesfx.com${path}`, {
      method,
      headers,
      body,
    });
    const response = await worker.fetch(
      request,
      { DB: database, LEGACY_V1_HOST },
      { waitUntil() {} },
    );
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: 'Sign-in required.' });
    assert.equal(database.calls.length, 0, `${method} ${path} must reject before session lookup`);
  }
});

test('api-prefixed auth remains cookie-only on the exact legacy host', async () => {
  const sessionToken = `mrs_${'b'.repeat(43)}`;
  const database = authDatabase({ sessionToken });
  const request = new Request(`https://${LEGACY_V1_HOST}/api/auth/me`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const response = await worker.fetch(
    request,
    { DB: database, LEGACY_V1_HOST },
    { waitUntil() {} },
  );
  assert.equal(response.status, 401);
  assert.equal(database.calls.length, 0);
});

test('exact legacy host /api auth requests cannot downgrade into the legacy v1 contract', async () => {
  const request = new Request(`https://${LEGACY_V1_HOST}/api/auth/google`, {
    method: 'POST',
  });
  const response = await worker.fetch(request, { LEGACY_V1_HOST }, { waitUntil() {} });
  assert.equal(response.status, 403);
});

test('auth preflight allows the CSRF marker for the workers.dev migration path', async () => {
  const request = new Request('https://legacy-worker.example/api/auth/google', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://medication.bytesfx.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-medication-csrf',
    },
  });
  const response = await worker.fetch(request, {}, { waitUntil() {} });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /(?:^|,\s*)X-Medication-CSRF(?:,|$)/i);
});

test('API-prefixed paths normalize while legacy and similarly prefixed paths are preserved', async () => {
  assert.equal(typeof workerModule.normalizePathname, 'function');
  assert.equal(workerModule.normalizePathname('/api'), '/');
  assert.equal(workerModule.normalizePathname('/api/health'), '/health');
  assert.equal(workerModule.normalizePathname('/health'), '/health');
  assert.equal(workerModule.normalizePathname('/apian/health'), '/apian/health');

  const response = await worker.fetch(
    new Request('https://medication.bytesfx.com/api/health'),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'medication-reminder-push' });
});

test('Google identity tokens are signature, issuer, audience, expiry, and email verified', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher, now } = await fixture();
  const identity = await verifyGoogleCredential(token, CLIENT_ID, fetcher, now);
  assert.deepEqual(identity, {
    googleSubject: '123456789012345678901',
    email: 'person@example.com',
    displayName: 'Test Person',
    pictureUrl: null,
  });
});

test('a token issued for another OAuth client is rejected', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher, now } = await fixture({ aud: 'attacker.apps.googleusercontent.com' });
  await assert.rejects(() => verifyGoogleCredential(token, CLIENT_ID, fetcher, now), /invalid_google_credential/);
});

test('expired and unverified Google identities are rejected', async () => {
  resetGoogleKeysForTests();
  const expired = await fixture({ exp: 100 });
  await assert.rejects(() => verifyGoogleCredential(expired.token, CLIENT_ID, expired.fetcher, expired.now), /invalid_google_credential/);
  resetGoogleKeysForTests();
  const unverified = await fixture({ email_verified: false });
  await assert.rejects(() => verifyGoogleCredential(unverified.token, CLIENT_ID, unverified.fetcher, unverified.now), /unverified_google_account/);
});
