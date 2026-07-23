# Browser Account Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit local-only or Google-authenticated entry boundary, enforce account ownership for browser cloud sync, and replace reusable mobile invitations with scoped device credentials without breaking offline reminders or the existing owner widget pairing.

**Architecture:** A new browser access controller keeps medication content privacy-locked until it restores a secure account cookie, recognizes an already-paired installed mobile, or records an explicit local-only choice. The Cloudflare Worker is routed under the application’s `/api` path, stores browser sessions in `Secure`/`HttpOnly` cookies, enforces CSRF and tenant ownership, and exchanges short-lived one-use invitations for pair-scoped mobile credentials. Legacy `user_id IS NULL` widget records remain token-authorized during the compatibility period.

**Tech Stack:** Vanilla JavaScript PWA, Web Crypto AES-GCM, Cloudflare Pages, Cloudflare Workers, D1 SQLite, Google Identity Services, Node test runner, Python unittest, Windows DPAPI widget compatibility, Graphite.

---

## File Map

- Create `worker/migrations/0003_scoped_pairing_credentials.sql`: additive D1 columns and indexes for one-use invitations and mobile credentials.
- Modify `worker/schema.sql`: canonical fresh-install schema matching all migrations.
- Modify `worker/src/auth.js`: cookie session parsing/creation, cookie clearing, and CSRF helpers.
- Modify `worker/src/index.js`: `/api` path normalization, account-owned pair authorization, invitation exchange, and legacy compatibility.
- Modify `worker/wrangler.jsonc`: route `/api/*` on the Pages custom hostname.
- Create `web/access.js`: first-run access state machine, privacy lock, local-only choice, pending invitation custody, and access events.
- Modify `web/account.js`: same-origin cookie API, Google sign-in integration, sign-out data choice, and access-controller integration.
- Modify `web/sync.js`: account-gated source sync, one-use mobile claim, scoped mobile authorization, and authenticated legacy-widget import.
- Modify `web/app.js`: same-origin push API and access-aware cloud controls.
- Modify `web/index.html`: access modal, privacy-lock markup, script ordering, and release version.
- Modify `web/styles.css`: access modal and locked-state styling.
- Modify `web/sw.js`: cache the access controller and advance the cache generation.
- Modify `web/version.json`: advance the release version.
- Modify `web/_headers`: same-origin CSP connectivity and API-safe security headers.
- Create `tests/test_web_access.mjs`: access-state and pending-invitation tests.
- Modify `tests/test_web_account.mjs`: cookie-session, sign-in, and sign-out tests.
- Modify `tests/test_web_sync.mjs`: cloud capability and scoped mobile-claim tests.
- Create `tests/test_worker_sync.mjs`: CSRF, tenant isolation, invitation, device-scope, and legacy compatibility tests.
- Modify `tests/test_worker_auth.mjs`: cookie lifecycle and session restoration tests.
- Modify `README.md`: public browser-first account model and local-only behavior.

## API Contract

Browser account requests use same-origin paths and include cookies:

```text
GET    /api/auth/config
POST   /api/auth/google
GET    /api/auth/me
PATCH  /api/auth/me
DELETE /api/auth/session

POST   /api/sync/pairs
GET    /api/sync/pairs/:pairId
PUT    /api/sync/pairs/:pairId
DELETE /api/sync/pairs/:pairId
POST   /api/sync/pairs/:pairId/invitations
POST   /api/sync/pairs/:pairId/claim
```

Cookie-authenticated mutations include `X-Medication-CSRF: 1`. Mobile requests use
`Authorization: Bearer <mobile credential>` and `X-Medication-Device: <device id>`.
Legacy widget requests retain `Authorization: Bearer <legacy token>` only when the
target record has `user_id IS NULL`.

---

### Task 1: Add the Additive Pairing-Credential Migration

**Files:**
- Create: `worker/migrations/0003_scoped_pairing_credentials.sql`
- Modify: `worker/schema.sql`
- Test: `tests/test_worker_sync.mjs`

- [ ] **Step 1: Write a failing schema-contract test**

Create `tests/test_worker_sync.mjs` with the initial contract:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('scoped pairing migration is additive and indexed', () => {
  const migration = readFileSync('worker/migrations/0003_scoped_pairing_credentials.sql', 'utf8');
  for (const column of [
    'invitation_token_hash',
    'invitation_expires_at',
    'invitation_consumed_at',
    'mobile_token_hash',
    'mobile_claimed_at',
  ]) assert.match(migration, new RegExp(`ADD COLUMN ${column}`));
  assert.match(migration, /idx_sync_pairs_invitation_expiry/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\b/i);
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```powershell
node --test tests/test_worker_sync.mjs
```

Expected: FAIL because `0003_scoped_pairing_credentials.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `worker/migrations/0003_scoped_pairing_credentials.sql`:

```sql
ALTER TABLE sync_pairs ADD COLUMN invitation_token_hash TEXT;
ALTER TABLE sync_pairs ADD COLUMN invitation_expires_at TEXT;
ALTER TABLE sync_pairs ADD COLUMN invitation_consumed_at TEXT;
ALTER TABLE sync_pairs ADD COLUMN mobile_token_hash TEXT;
ALTER TABLE sync_pairs ADD COLUMN mobile_claimed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_sync_pairs_user_id_pair
  ON sync_pairs(user_id, pair_id);
CREATE INDEX IF NOT EXISTS idx_sync_pairs_invitation_expiry
  ON sync_pairs(invitation_expires_at)
  WHERE invitation_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_pairs_mobile_token
  ON sync_pairs(mobile_token_hash)
  WHERE mobile_token_hash IS NOT NULL;
```

- [ ] **Step 4: Update the canonical schema**

Add these fields to `sync_pairs` in `worker/schema.sql` immediately after
`token_hash`/`mobile_device_id`:

```sql
  invitation_token_hash TEXT,
  invitation_expires_at TEXT,
  invitation_consumed_at TEXT,
  mobile_token_hash TEXT,
  mobile_device_id TEXT,
  mobile_claimed_at TEXT,
```

Add the same three indexes declared by migration `0003`.

- [ ] **Step 5: Apply the migration to a local D1 database**

Run from `worker`:

```powershell
npx wrangler d1 execute medication-reminder-push --local --file migrations/0003_scoped_pairing_credentials.sql
```

Expected: successful execution of five `ALTER TABLE` statements and three indexes.

- [ ] **Step 6: Run the contract test**

Run:

```powershell
node --test tests/test_worker_sync.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the migration**

```powershell
git add worker/migrations/0003_scoped_pairing_credentials.sql worker/schema.sql tests/test_worker_sync.mjs
git commit -m "Add scoped mobile pairing schema"
```

---

### Task 2: Move Browser Sessions to Secure Same-Origin Cookies

**Files:**
- Modify: `worker/src/auth.js`
- Modify: `worker/src/index.js`
- Modify: `worker/wrangler.jsonc`
- Test: `tests/test_worker_auth.mjs`

- [ ] **Step 1: Add failing cookie and CSRF tests**

Append tests that exercise exported helpers:

```js
const {
  clearSessionCookie,
  readSessionToken,
  sessionCookie,
  validCsrfRequest,
} = await import('../worker/src/auth.js');

test('browser sessions use a constrained secure cookie', () => {
  const value = sessionCookie('mrs_example', 3600);
  assert.match(value, /^mrs_session=mrs_example;/);
  assert.match(value, /Path=\/api/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.match(value, /SameSite=Strict/);
  assert.match(value, /Max-Age=3600/);
  assert.doesNotMatch(value, /Domain=/);
  assert.match(clearSessionCookie(), /Max-Age=0/);
});

test('session parser accepts the cookie and rejects unrelated values', () => {
  assert.equal(readSessionToken(new Request('https://medication.bytesfx.com/api/auth/me', {
    headers: { Cookie: 'other=x; mrs_session=mrs_token_value' },
  })), 'mrs_token_value');
});

test('state-changing cookie requests require trusted origin and CSRF header', () => {
  const valid = new Request('https://medication.bytesfx.com/api/auth/me', {
    method: 'PATCH',
    headers: { Origin: 'https://medication.bytesfx.com', 'X-Medication-CSRF': '1' },
  });
  const invalid = new Request('https://medication.bytesfx.com/api/auth/me', {
    method: 'PATCH',
    headers: { Origin: 'https://evil.example', 'X-Medication-CSRF': '1' },
  });
  assert.equal(validCsrfRequest(valid), true);
  assert.equal(validCsrfRequest(invalid), false);
});
```

- [ ] **Step 2: Run auth tests and verify the new assertions fail**

Run:

```powershell
node --test tests/test_worker_auth.mjs
```

Expected: FAIL because the cookie/CSRF helpers are not exported.

- [ ] **Step 3: Implement cookie and CSRF helpers**

Add to `worker/src/auth.js`:

```js
const SESSION_COOKIE = 'mrs_session';
const APP_ORIGIN = 'https://medication.bytesfx.com';

export function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  const authorization = request.headers.get('Authorization') || '';
  return authorization.startsWith(`Bearer ${SESSION_PREFIX}`) ? authorization.slice(7) : '';
}

export function validCsrfRequest(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  return request.headers.get('Origin') === APP_ORIGIN
    && request.headers.get('X-Medication-CSRF') === '1';
}
```

Change `authenticateSession()` to call `readSessionToken(request)`. On successful
`POST /auth/google`, return the account view without `sessionToken` and attach:

```js
{ headers: { 'Set-Cookie': sessionCookie(token) } }
```

On `DELETE /auth/session`, attach:

```js
{ headers: { 'Set-Cookie': clearSessionCookie() } }
```

- [ ] **Step 4: Normalize the same-origin `/api` route**

At the start of `worker/src/index.js` `fetch()`:

```js
const url = new URL(request.url);
if (url.pathname === '/api') url.pathname = '/';
else if (url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice(4);
```

Before dispatching a cookie-authenticated mutation:

```js
if (!validCsrfRequest(request)) {
  return json(request, { error: 'Request verification failed.' }, { status: 403 });
}
```

Import `validCsrfRequest` from `auth.js`.
Apply this check to `/auth/google`, `/auth/me` PATCH, `/auth/session` DELETE, and
account-side source pairing mutations. Do not apply cookie CSRF checks to mobile
claim/sync requests that authenticate with a scoped bearer credential; those routes
must reject any accompanying account cookie and use their bearer/device checks only.

- [ ] **Step 5: Route the application API through the Pages hostname**

Add to `worker/wrangler.jsonc`:

```json
"routes": [
  {
    "pattern": "medication.bytesfx.com/api/*",
    "zone_name": "bytesfx.com"
  }
],
```

- [ ] **Step 6: Run auth and Worker build checks**

Run:

```powershell
node --test tests/test_worker_auth.mjs
Set-Location worker
npm test
npm run build
```

Expected: all tests pass and Wrangler dry-run succeeds.

- [ ] **Step 7: Commit secure browser sessions**

```powershell
git add worker/src/auth.js worker/src/index.js worker/wrangler.jsonc tests/test_worker_auth.mjs
git commit -m "Secure browser sessions with same-origin cookies"
```

---

### Task 3: Enforce Tenant-Owned Pairing and Scoped Mobile Claims

**Files:**
- Modify: `worker/src/index.js`
- Modify: `worker/src/auth.js`
- Modify: `tests/test_worker_sync.mjs`

- [ ] **Step 1: Add failing authorization tests**

Extend `tests/test_worker_sync.mjs` with a query-recording D1 fixture:

```js
function fakeDb(resolve) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) { bindings = values; return statement; },
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

test('account pairing lookup binds both pair and tenant', async () => {
  const DB = fakeDb(({ bindings }) => bindings[1] === 'user_b' ? { pair_id: 'pair_b' } : null);
  const pair = await loadAccountPair({ DB }, 'pair_b', 'user_a');
  assert.equal(pair, null);
  assert.match(DB.calls[0].sql, /pair_id = \? AND user_id = \?/);
  assert.deepEqual(DB.calls[0].bindings, ['pair_b', 'user_a']);
});

test('mobile lookup binds pair, device, and hashed mobile credential', async () => {
  const DB = fakeDb(() => null);
  await loadMobilePair({ DB }, 'pair_a', 'device_a', 'hash_a');
  assert.match(DB.calls[0].sql, /pair_id = \?.*mobile_device_id = \?.*mobile_token_hash = \?/s);
  assert.deepEqual(DB.calls[0].bindings, ['pair_a', 'device_a', 'hash_a']);
});

test('invitation consumption is atomic and single-use', async () => {
  let unused = true;
  const DB = fakeDb(({ operation }) => {
    if (operation !== 'run' || !unused) return { meta: { changes: 0 } };
    unused = false;
    return { meta: { changes: 1 } };
  });
  assert.equal(await consumeInvitation({ DB }, invitationFixture), true);
  assert.equal(await consumeInvitation({ DB }, invitationFixture), false);
  assert.match(DB.calls[0].sql, /invitation_consumed_at IS NULL/);
  assert.match(DB.calls[0].sql, /invitation_expires_at > CURRENT_TIMESTAMP/);
});

test('legacy lookup requires a null account owner and legacy token hash', async () => {
  const DB = fakeDb(() => ({ pair_id: 'legacy_pair' }));
  await loadLegacyPair({ DB }, 'legacy_pair', 'legacy_hash');
  assert.match(DB.calls[0].sql, /user_id IS NULL/);
  assert.match(DB.calls[0].sql, /token_hash = \?/);
});
```

Also add route-level response assertions using the Worker `fetch` handler so wrong
tenant, pair, device, credential, expired invitation, and consumed invitation all
return the same safe `404` response except invitation replay, which returns `410`.

- [ ] **Step 2: Run sync tests and verify they fail**

Run:

```powershell
node --test tests/test_worker_sync.mjs
```

Expected: the new tenant and invitation cases fail.

- [ ] **Step 3: Add entitlement and account-pair authorization helpers**

Export a capability helper from `worker/src/auth.js`:

```js
export function hasCloudSync(account) {
  return Boolean(account?.entitlements?.has('advanced'));
}
```

In `worker/src/index.js`, export the query-boundary helpers for tests and use them
from the request handlers:

```js
export async function loadAccountPair(env, pairId, userId) {
  return env.DB.prepare(`SELECT * FROM sync_pairs
    WHERE pair_id = ? AND user_id = ?`).bind(pairId, userId).first();
}

export async function loadMobilePair(env, pairId, deviceId, mobileTokenHash) {
  return env.DB.prepare(`SELECT * FROM sync_pairs
    WHERE pair_id = ? AND mobile_device_id = ? AND mobile_token_hash = ?`)
    .bind(pairId, deviceId, mobileTokenHash).first();
}

export async function loadLegacyPair(env, pairId, legacyTokenHash) {
  return env.DB.prepare(`SELECT * FROM sync_pairs
    WHERE pair_id = ? AND user_id IS NULL AND token_hash = ?`)
    .bind(pairId, legacyTokenHash).first();
}

async function accountPair(request, env, pairId) {
  const account = await authenticateSession(request, env, { touch: false });
  if (!account || !hasCloudSync(account)) return { account, pair: null };
  const pair = await loadAccountPair(env, pairId, account.user.user_id);
  return { account, pair };
}

async function mobilePair(request, env, pairId) {
  const token = bearerToken(request);
  const deviceId = request.headers.get('X-Medication-Device') || '';
  if (!ID_PATTERN.test(pairId) || !ID_PATTERN.test(deviceId) || token.length < 40) return null;
  return loadMobilePair(env, pairId, deviceId, await tokenHash(token));
}
```

Implement and export the atomic invitation update:

```js
export async function consumeInvitation(env, value) {
  const result = await env.DB.prepare(`UPDATE sync_pairs SET
      mobile_token_hash = ?, mobile_device_id = ?,
      mobile_claimed_at = CURRENT_TIMESTAMP,
      invitation_consumed_at = CURRENT_TIMESTAMP
    WHERE pair_id = ? AND invitation_token_hash = ?
      AND invitation_consumed_at IS NULL
      AND invitation_expires_at > CURRENT_TIMESTAMP
      AND mobile_device_id IS NULL`)
    .bind(value.mobileTokenHash, value.mobileDeviceId, value.pairId, value.invitationTokenHash)
    .run();
  return Number(result.meta?.changes || 0) === 1;
}
```

- [ ] **Step 4: Make browser pair creation account-derived**

For authenticated `POST /sync/pairs`:

- require `hasCloudSync(account)`;
- generate `pairId`, invitation token, and 15-minute expiry server-side;
- derive `user_id` only from the session;
- store only token hashes; and
- return the invitation token once.

Use:

```js
const pairId = randomId();
const invitationToken = randomId(32);
const invitationExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
```

Return:

```js
{
  pairId,
  invitationToken,
  invitationExpiresAt,
  revision: 1,
}
```

Reject every unauthenticated `POST /sync/pairs` with `401`. Compatibility applies
only to operations on an already-existing `user_id IS NULL` widget record; a
user-agent string is never treated as authentication. Creating a replacement widget
pair remains blocked until the owner-device authorization flow is implemented.

- [ ] **Step 5: Implement one-use invitation claim**

For `POST /sync/pairs/:pairId/claim`:

1. Hash the bearer invitation.
2. Atomically update only a row whose invitation is unconsumed, unexpired, and
   unclaimed.
3. Generate and hash a new mobile token.
4. Return the mobile token and encrypted schedule in the same response.

The update predicate must include:

```sql
WHERE pair_id = ?
  AND invitation_token_hash = ?
  AND invitation_consumed_at IS NULL
  AND invitation_expires_at > CURRENT_TIMESTAMP
  AND mobile_device_id IS NULL
```

Persist:

```sql
mobile_token_hash = ?,
mobile_device_id = ?,
mobile_claimed_at = CURRENT_TIMESTAMP,
invitation_consumed_at = CURRENT_TIMESTAMP
```

- [ ] **Step 6: Split source and mobile authorization**

For account-owned records:

- browser GET/PUT/DELETE uses `accountPair()`;
- mobile GET/PUT uses `mobilePair()`;
- browser invitation refresh uses
  `POST /sync/pairs/:pairId/invitations`; and
- authorization failure returns `404`.

For legacy `user_id IS NULL` records, retain the current `token_hash` branch. Never
allow a legacy bearer token to authorize an account-owned record.

- [ ] **Step 7: Record secret-free account pairing audit events**

Export the existing audit helper from `worker/src/auth.js` as `recordAudit()` and
call it after account-owned pair creation, invitation issuance, successful mobile
claim, schedule update, and revocation. Metadata is restricted to:

```js
{
  pairId,
  deviceId: deviceId || null,
  revision: Number(revision || 0),
  result: 'created' | 'invited' | 'claimed' | 'updated' | 'revoked',
}
```

Add a test that serializes every audit call and asserts it does not contain the
fixture medication name, ciphertext, IV, encryption key, invitation token, mobile
token, Google credential, session token, or push endpoint.

- [ ] **Step 8: Run tenant and build tests**

Run:

```powershell
node --test tests/test_worker_sync.mjs tests/test_worker_auth.mjs
Set-Location worker
npm test
npm run build
```

Expected: all tenant, invitation, legacy, and build checks pass.

- [ ] **Step 9: Commit the pairing authorization boundary**

```powershell
git add worker/src/index.js worker/src/auth.js tests/test_worker_sync.mjs
git commit -m "Enforce tenant-owned mobile pairing"
```

---

### Task 4: Add the Browser Access Controller

**Files:**
- Create: `web/access.js`
- Modify: `web/index.html`
- Modify: `web/styles.css`
- Test: `tests/test_web_access.mjs`

- [ ] **Step 1: Write failing access-state tests**

Create `tests/test_web_access.mjs` with a VM DOM harness and these assertions:

```js
test('new browser stays privacy locked until a choice is made', () => {
  const app = harness();
  assert.equal(app.document.documentElement.classList.contains('access-pending'), true);
  assert.equal(app.dialog.open, true);
});

test('continue locally unlocks without cloud capability', async () => {
  const app = harness();
  await app.localButton.onclick();
  assert.equal(app.storage.get('medication-reminder-access-mode-v1'), 'local');
  assert.equal(app.window.MedicationAccess.mode, 'local');
  assert.equal(app.document.documentElement.classList.contains('access-pending'), false);
});

test('installed paired mobile bypasses Google gate', () => {
  const app = harness({ installedMobile: true, mobileCredentials: true });
  assert.equal(app.window.MedicationAccess.mode, 'paired-mobile');
  assert.equal(app.dialog.open, false);
});

test('desktop pairing fragment is removed and held only for authenticated continuation', () => {
  const app = harness({ hash: '#pair=private-fragment' });
  assert.equal(app.location.hash, '');
  assert.equal(app.window.MedicationAccess.pendingInvitation(), '#pair=private-fragment');
  assert.equal(app.storage.has('medication-reminder-pending-pair-v1'), false);
});
```

- [ ] **Step 2: Run the access tests and verify they fail**

Run:

```powershell
node --test tests/test_web_access.mjs
```

Expected: FAIL because `web/access.js` and the access modal do not exist.

- [ ] **Step 3: Add privacy-locked HTML and first-run dialog**

Change the root element to:

```html
<html lang="en" class="access-pending">
```

Add before application scripts:

```html
<dialog id="accessDialog" class="access-dialog" aria-labelledby="accessTitle">
  <article class="access-card">
    <p class="eyebrow">PRIVATE BY DEFAULT</p>
    <h1 id="accessTitle">How would you like to use Medication Reminder?</h1>
    <p>Your medicines can stay only on this device, or you can sign in to unlock eligible cloud features.</p>
    <div id="accessGoogleSignIn" class="google-sign-in" aria-label="Sign in with Google"></div>
    <button type="button" id="continueLocally" class="secondary-button">Continue on this device</button>
    <p class="privacy-note">Local-only schedules cannot be paired, synchronized, or recovered on another device.</p>
  </article>
</dialog>
```

- [ ] **Step 4: Implement the access state machine**

Create `web/access.js`:

```js
(() => {
  'use strict';
  const LOCAL_MODE_KEY = 'medication-reminder-access-mode-v1';
  const SYNC_KEY = 'medication-reminder-sync-v1';
  const dialog = document.querySelector('#accessDialog');
  const localButton = document.querySelector('#continueLocally');
  const installed = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  const mobile = Boolean(navigator.userAgentData?.mobile)
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let mode = 'pending';
  let account = null;
  let ready = false;
  let pendingPair = location.hash.startsWith('#pair=') ? location.hash : '';

  if (pendingPair) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }

  function storedMobilePair() {
    try {
      const value = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
      return value?.role === 'mobile'
        && (typeof value.mobileToken === 'string' || typeof value.token === 'string');
    } catch {
      return false;
    }
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('medication-access-ready', {
      detail: { mode, account },
    }));
  }

  function unlock(nextMode, nextAccount = null) {
    mode = nextMode;
    account = nextAccount;
    ready = true;
    document.documentElement.classList.remove('access-pending');
    if (dialog.open) dialog.close();
    emit();
  }

  function showChoice() {
    mode = 'pending';
    account = null;
    ready = false;
    document.documentElement.classList.add('access-pending');
    if (!dialog.open) dialog.showModal();
  }

  function chooseLocal() {
    localStorage.setItem(LOCAL_MODE_KEY, 'local');
    unlock('local');
  }

  function resolveAccount(value) {
    if (!value?.user) throw Error('A verified account is required.');
    localStorage.removeItem(LOCAL_MODE_KEY);
    unlock('account', value);
  }

  function resolveSignedOut() {
    if (installed && mobile && storedMobilePair()) {
      unlock('paired-mobile');
      return;
    }
    if (installed && mobile && pendingPair) {
      unlock('pairing');
      return;
    }
    if (localStorage.getItem(LOCAL_MODE_KEY) === 'local') {
      unlock('local');
      return;
    }
    showChoice();
  }

  function requireCloud() {
    if (mode !== 'account' || !account?.user) {
      throw Error('Sign in with Google before using cloud pairing.');
    }
    if (!account.features?.cloudSync) {
      throw Error('Cloud device sync is not enabled for this account.');
    }
    return true;
  }

  localButton.onclick = chooseLocal;
  if (installed && mobile && storedMobilePair()) unlock('paired-mobile');

  window.MedicationAccess = {
    get mode() { return mode; },
    get ready() { return ready; },
    get signedIn() { return mode === 'account'; },
    get cloudSync() { return Boolean(account?.features?.cloudSync); },
    pendingInvitation() { return pendingPair; },
    consumePendingInvitation() {
      const value = pendingPair;
      pendingPair = '';
      return value;
    },
    resolveAccount,
    resolveSignedOut,
    chooseLocal,
    requireCloud,
    showChoice,
  };
})();
```

The pairing fragment exists only in the module variable and is removed from browser
history before any account or schedule request.

- [ ] **Step 5: Add locked-state and responsive dialog styles**

Add:

```css
.access-pending .shell { visibility: hidden; }
.access-dialog {
  width: min(92vw, 34rem);
  border: 0;
  padding: 0;
  border-radius: 1.5rem;
  color: var(--ink);
  background: transparent;
}
.access-dialog::backdrop { background: rgb(20 32 48 / .62); backdrop-filter: blur(4px); }
.access-card { background: var(--paper); padding: clamp(1.5rem, 5vw, 2.5rem); box-shadow: 0 1.5rem 4rem rgb(24 42 61 / .24); }
.access-card .google-sign-in { min-height: 44px; margin: 1.25rem 0 .75rem; }
.access-card button { width: 100%; }
```

- [ ] **Step 6: Run access tests**

Run:

```powershell
node --check web/access.js
node --test tests/test_web_access.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit the local/account access boundary**

```powershell
git add web/access.js web/index.html web/styles.css tests/test_web_access.mjs
git commit -m "Add explicit local or account access gate"
```

---

### Task 5: Integrate Google Sign-In With the Access Boundary

**Files:**
- Modify: `web/account.js`
- Modify: `web/index.html`
- Test: `tests/test_web_account.mjs`

- [ ] **Step 1: Add failing account-client tests**

Add tests proving:

```js
test('account requests are same-origin and cookie credentialed', async () => {
  const app = accountHarness();
  await app.initialize();
  assert.equal(app.requests[0].url, '/api/auth/config');
  assert.equal(app.requests[0].options.credentials, 'same-origin');
  assert.equal(app.requests[0].options.headers.Authorization, undefined);
});

test('Google sign-in does not persist a JavaScript session token', async () => {
  const app = accountHarness();
  await app.googleCallback({ credential: 'signed-google-id-token' });
  assert.equal(app.storage.has('medication-reminder-account-session-v1'), false);
  assert.equal(app.access.mode, 'account');
});

test('sign-out keep-local returns to explicit local mode', async () => {
  const app = accountHarness({ signedIn: true, signOutChoice: 'keep' });
  await app.signOut();
  assert.equal(app.access.mode, 'local');
  assert.equal(app.clearScheduleCalls, 0);
});
```

- [ ] **Step 2: Run account tests and verify they fail**

Run:

```powershell
node --test tests/test_web_account.mjs
```

Expected: FAIL because the current client uses a cross-origin bearer session.

- [ ] **Step 3: Replace bearer-session storage with cookie requests**

In `web/account.js`:

```js
const API = '/api';

async function request(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    'Content-Type': 'application/json',
    ...(!['GET', 'HEAD'].includes(method) ? { 'X-Medication-CSRF': '1' } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API}${path}`, {
    ...options,
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = Error(body.error || `Account request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}
```

Remove `SESSION_KEY`, `sessionToken`, `storeSession()`, and
`authorizationHeaders()`.

- [ ] **Step 4: Connect account initialization to the access controller**

After `/auth/me` succeeds:

```js
window.MedicationAccess.resolveAccount(account);
```

When there is no valid session:

```js
window.MedicationAccess.resolveSignedOut();
```

Render the same Google button into both `#accessGoogleSignIn` and
`#googleSignIn`. A successful Google callback calls `/auth/google`, receives only the
account view, and resolves account access.

If `/auth/config` or `/auth/me` fails because the network or account service is
unavailable, call `resolveSignedOut()` after showing the service status. This exposes
the local-only choice instead of leaving the application privacy-locked. Do not
silently select local mode.

- [ ] **Step 5: Implement explicit sign-out data handling**

Use a small confirmation dialog with **Keep on this device**, **Erase from this
device**, and **Cancel**. On keep:

```js
await request('/auth/session', { method: 'DELETE' });
window.MedicationAccess.chooseLocal();
```

On erase:

```js
await request('/auth/session', { method: 'DELETE' });
window.clearMedicationSchedule();
window.MedicationAccess.chooseLocal();
```

Do not revoke the remote mobile pairing during sign-out.

- [ ] **Step 6: Run account and access tests**

Run:

```powershell
node --check web/account.js
node --test tests/test_web_account.mjs tests/test_web_access.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit account-gate integration**

```powershell
git add web/account.js web/index.html tests/test_web_account.mjs
git commit -m "Integrate Google account access gate"
```

---

### Task 6: Update Browser and Mobile Synchronization Credentials

**Files:**
- Modify: `web/sync.js`
- Modify: `tests/test_web_sync.mjs`

- [ ] **Step 1: Add failing sync capability tests**

Add:

```js
test('local-only mode cannot create or operate cloud pairing', async () => {
  const app = syncHarness({ accessMode: 'local' });
  await app.pair.onclick();
  assert.equal(app.fetchCount(), 0);
  assert.match(app.alerts.at(-1), /Sign in/);
});

test('account source requests use cookie authorization and CSRF', async () => {
  const app = syncHarness({ accessMode: 'account', cloudSync: true });
  await app.window.MedicationSync.createPair();
  const request = app.requests.find(item => item.url.endsWith('/api/sync/pairs'));
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['X-Medication-CSRF'], '1');
  assert.equal(request.options.headers.Authorization, undefined);
});

test('mobile claim stores only the returned device credential', async () => {
  const app = syncHarness({ installedMobile: true, invitation: validInvitation });
  await app.acceptInvitation();
  const credentials = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(credentials.role, 'mobile');
  assert.equal(credentials.mobileToken, 'returned-mobile-token');
  assert.equal('token' in credentials, false);
  assert.equal('invitationToken' in credentials, false);
});

test('desktop invitation waits for account before decrypting', async () => {
  const app = syncHarness({ accessMode: 'pending', invitation: validInvitation });
  assert.equal(app.appliedSchedules.length, 0);
  app.resolveAccount();
  await app.flush();
  assert.equal(app.appliedSchedules.length, 1);
});
```

- [ ] **Step 2: Run sync tests and verify they fail**

Run:

```powershell
node --test tests/test_web_sync.mjs
```

Expected: FAIL on local gating, cookie authorization, and scoped token storage.

- [ ] **Step 3: Change the API adapter to same-origin dual authorization**

Implement:

```js
const API = '/api';

function requestHeaders(value, method) {
  if (value?.role === 'mobile') {
    return {
      Authorization: `Bearer ${value.mobileToken}`,
      'X-Medication-Device': value.deviceId,
    };
  }
  return !['GET', 'HEAD'].includes(method)
    ? { 'X-Medication-CSRF': '1' }
    : {};
}

async function api(path, options = {}, value = credentials()) {
  const method = options.method || 'GET';
  return fetch(`${API}${path}`, {
    ...options,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...requestHeaders(value, method),
      ...(options.headers || {}),
    },
    credentials: value?.role === 'mobile' ? 'omit' : 'same-origin',
    cache: 'no-store',
  });
}
```

- [ ] **Step 4: Gate source pairing by cloud capability**

At every source entry point call:

```js
window.MedicationAccess.requireCloud();
```

Source creation sends only source/device identifiers and encrypted content. Store the
returned `pairId`, `invitationToken`, and expiry with the local encryption key.
Regenerate an expired invitation through
`POST /sync/pairs/:pairId/invitations` before drawing or copying the QR.

Encode new account-owned invitations as:

```js
{
  version: 2,
  pairId: value.pairId,
  invitationToken: value.invitationToken,
  invitationExpiresAt: value.invitationExpiresAt,
  encryptionKey: value.encryptionKey,
}
```

`parseInvitation()` accepts this version-2 shape and the existing version-1 widget
shape. Version 2 is valid only when `invitationExpiresAt` is a parseable future
timestamp and `invitationToken` meets the token length/pattern constraints.

- [ ] **Step 5: Exchange mobile invitation for a scoped token**

On installed mobile, `acceptPairing()` calls claim once and decrypts the encrypted
payload returned by the claim response. Save:

```js
{
  version: 2,
  role: 'mobile',
  pairId: response.pairId,
  mobileToken: response.mobileToken,
  encryptionKey: invitation.encryptionKey,
  deviceId: mobileId,
  revision: response.revision,
  claimed: true,
  dirty: false,
}
```

Do not retain the invitation token.

Update `credentials()` to accept both:

```js
value.version === 1 && value.role === 'mobile' && typeof value.token === 'string'
```

for legacy installed mobiles, and:

```js
value.version === 2 && value.role === 'mobile' && typeof value.mobileToken === 'string'
```

for account-owned scoped mobile credentials. Source credentials created by the
browser are version 2 and contain no reusable bearer token.

- [ ] **Step 6: Defer desktop imports until authenticated**

Read the invitation through `MedicationAccess.pendingInvitation()`. If the device is
not an installed mobile, wait for `medication-access-ready` and require account mode
before invoking the legacy widget snapshot import. Clear the pending value after
success, cancellation, or terminal failure.

- [ ] **Step 7: Preserve offline mobile behavior**

Initialization must not fetch before rendering the locally stored paired schedule.
Background sync failures update status but never clear a mobile schedule unless the
Worker returns a verified revocation/`404` for the scoped mobile credential.

Treat existing version-1 mobile credentials containing `token` as legacy credentials
only when their relay record has `user_id IS NULL`. Do not rewrite or discard them
during upgrade. New account-owned mobile claims always store version 2 with
`mobileToken`.

- [ ] **Step 8: Run sync regression tests**

Run:

```powershell
node --check web/sync.js
node --test tests/test_web_sync.mjs tests/test_web_access.mjs tests/test_web_account.mjs
```

Expected: PASS, including existing unpair and encrypted-import cases.

- [ ] **Step 9: Commit scoped client synchronization**

```powershell
git add web/sync.js tests/test_web_sync.mjs
git commit -m "Use account and device scoped sync credentials"
```

---

### Task 7: Finish Same-Origin PWA Integration and Release Metadata

**Files:**
- Modify: `web/app.js`
- Modify: `web/index.html`
- Modify: `web/sw.js`
- Modify: `web/version.json`
- Modify: `web/_headers`
- Test: `tests/test_web_access.mjs`
- Test: `tests/test_due_modal.mjs`

- [ ] **Step 1: Add a failing static integration assertion**

Add:

```js
test('PWA loads access control before account and sync clients', () => {
  const html = readFileSync('web/index.html', 'utf8');
  assert.ok(html.indexOf('access.js') < html.indexOf('account.js'));
  assert.ok(html.indexOf('account.js') < html.indexOf('sync.js'));
  assert.match(html, /class="access-pending"/);
});

test('browser APIs are same-origin', () => {
  for (const file of ['web/account.js', 'web/app.js', 'web/sync.js']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /medication-reminder-push\.bmorris0565\.workers\.dev/);
  }
});
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run:

```powershell
node --test tests/test_web_access.mjs
```

Expected: FAIL while `app.js` still uses the Workers domain.

- [ ] **Step 3: Move push endpoints to `/api`**

In `web/app.js`:

```js
const pushApi = '/api';
```

Use `credentials: 'same-origin'` for push API requests. Push subscriptions remain
available in both local and authenticated mode because they contain generic reminder
text and device endpoints, not medication names.

- [ ] **Step 4: Order scripts and advance the release**

Load:

```html
<script src="access.js?v=20260723.17"></script>
<script src="account.js?v=20260723.17"></script>
<script src="sync.js?v=20260723.17"></script>
```

after `app.js`, with `access.js` before both account and sync. Advance:

- application version to `2026.07.23.17`;
- all asset query strings to `20260723.17`; and
- service-worker cache to `medication-reminder-web-v26`.

Add `./access.js?v=20260723.17` to the service-worker asset list.

- [ ] **Step 5: Tighten the Pages security policy**

Remove the Workers domain from `connect-src` because application API calls are now
same-origin. Retain Google Identity and image origins. Add no wildcard sources.

- [ ] **Step 6: Run the complete local test suite**

Run:

```powershell
node --check web/access.js
node --check web/account.js
node --check web/app.js
node --check web/sync.js
node --test tests/*.mjs
python -B -m unittest discover -s tests -p "test_*.py"
Set-Location worker
npm test
npm run build
```

Expected: all JavaScript and Python tests pass; Worker dry-run succeeds.

- [ ] **Step 7: Commit the PWA release integration**

```powershell
git add web/app.js web/index.html web/sw.js web/version.json web/_headers tests
git commit -m "Release account-gated local-first PWA"
```

---

### Task 8: Update Documentation and Graphite

**Files:**
- Modify: `README.md`
- Modify: `graph-out/*`

- [ ] **Step 1: Document the public user flow**

Update `README.md` to state:

```text
Public users begin in the browser or installed PWA. They explicitly choose local-only
use or Google Sign-In. Local-only schedules never leave that device. Account-owned
cloud sync is entitlement-gated and pairs one installed mobile device through a
short-lived invitation. The Windows widget is owner-only and is not a public client.
```

Document `/api` same-origin routing, cookie security attributes, migration `0003`,
mobile scoped credentials, and the legacy widget compatibility boundary.

- [ ] **Step 2: Run Graphite build and validation**

Run:

```powershell
$env:PYTHONPATH='F:\Projects\graphite\src'
C:\Python314\python.exe -B -m graphite build .
C:\Python314\python.exe -B -m graphite validate
C:\Python314\python.exe -B -m graphite check .
```

Expected: graph valid with zero warnings and graph fresh.

- [ ] **Step 3: Commit documentation and graph**

```powershell
git add README.md graph-out
git commit -m "Document browser account security boundary"
```

---

### Task 9: Back Up, Migrate, Deploy, and Verify Production

**Files:**
- No new source files.
- Deployment outputs remain outside the repository.

- [ ] **Step 1: Verify Cloudflare authentication**

Run:

```powershell
npx wrangler whoami
```

Expected: the configured Cloudflare account with Workers, D1, Pages, and route write
permissions.

- [ ] **Step 2: Export a production D1 backup**

Run from `worker`:

```powershell
npx wrangler d1 export medication-reminder-push --remote --output "F:\tmp\medication-reminder-pre-0003.sql"
```

Expected: a non-empty SQL export at the explicit backup path.

- [ ] **Step 3: Apply migration `0003` remotely**

Run:

```powershell
npx wrangler d1 execute medication-reminder-push --remote --file migrations/0003_scoped_pairing_credentials.sql
```

Expected: all additive statements succeed. If any statement fails, stop before
deploying the Worker and inspect the exported schema.

- [ ] **Step 4: Deploy the backward-compatible Worker**

Run from `worker`:

```powershell
npx wrangler deploy
```

Expected: Worker deployment succeeds with the `/api/*` route and scheduled trigger.

- [ ] **Step 5: Verify Worker health and legacy compatibility before Pages deploy**

Run:

```powershell
node -e "fetch('https://medication.bytesfx.com/api/health',{cache:'no-store'}).then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)})"
```

Expected: `200` and an `ok` health payload.

Run the read-only protected widget/relay comparison used by the project, printing
only event summaries and revision metadata. Expected: the existing widget pairing
decrypts and its schedule remains unchanged.

- [ ] **Step 6: Deploy the Pages client**

Run from the repository root:

```powershell
npx wrangler pages deploy web --project-name medication-reminder --branch main --commit-dirty=true
```

Expected: a successful Pages deployment URL.

- [ ] **Step 7: Verify the live release manifest and assets**

Run:

```powershell
node -e "Promise.all(['/version.json','/access.js?v=20260723.17','/account.js?v=20260723.17','/sync.js?v=20260723.17'].map(p=>fetch('https://medication.bytesfx.com'+p,{cache:'no-store'}).then(async r=>[p,r.status,await r.text()]))).then(rows=>{for(const [p,s,b] of rows)console.log(p,s,b.length);if(rows.some(([,s])=>s!==200)||!rows[0][2].includes('2026.07.23.17'))process.exit(1)})"
```

Expected: four `200` responses and release `2026.07.23.17`.

- [ ] **Step 8: Run live browser and mobile acceptance scenarios**

Verify in isolated browser contexts:

1. Fresh private desktop window shows the access modal before medication content.
2. Continue locally creates and edits a schedule without calling `/api/sync`.
3. Local mode displays a sign-in requirement when Pair mobile is selected.
4. Google Sign-In preserves the local schedule and enables entitled cloud controls.
5. Account A cannot access a pair URL created by Account B.
6. A mobile QR invitation claims once; a replay fails.
7. The installed paired mobile reloads offline and displays its retained schedule.
8. Sign-out with Keep retains local reminders and disables cloud controls.
9. Existing owner widget synchronization still reads and updates its legacy record.

Record status codes and user-visible outcomes without recording schedules, tokens,
encryption keys, Google credentials, cookies, or push-subscription values.

- [ ] **Step 9: Run final tests against the deployed source state**

Run:

```powershell
node --test tests/*.mjs
python -B -m unittest discover -s tests -p "test_*.py"
Set-Location worker
npm test
npm run build
```

Expected: all checks pass.

- [ ] **Step 10: Push the complete implementation**

Run:

```powershell
git status --short
git push origin main
```

Expected: clean working tree and `main` pushed successfully.
