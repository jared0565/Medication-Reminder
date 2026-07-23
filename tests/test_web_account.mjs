import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync('web/account.js', 'utf8');

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function accountView() {
  return {
    user: {
      id: 'user-1',
      name: 'Example User',
      email: 'user@example.test',
      intendedStartDate: null,
      intendedEndDate: null,
    },
    plan: 'advanced',
    features: { advanced: true, cloudSync: true },
  };
}

function element() {
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    className: '',
    children: [],
    replaceChildren(...children) { this.children = children; },
  };
}

function accountHarness({
  signedIn = false,
  signOutChoice = 'keep',
  configStatus = 200,
  meStatus,
  storageThrows = false,
  clearScheduleResult = true,
  deferGoogle = false,
  googleAvailable = true,
  googleStatuses = [200],
  accessMode = 'pending',
  deferMe = false,
  deleteStatus = 200,
  clearScheduleThrows = false,
} = {}) {
  const elements = new Map([
    ['#accountStatus', element()],
    ['#googleSignIn', element()],
    ['#accessGoogleSignIn', element()],
    ['#signedInAccount', element()],
    ['#accountIdentity', element()],
    ['#accountPlan', element()],
    ['#usageStartDate', element()],
    ['#usageEndDate', element()],
    ['#saveUsagePeriod', element()],
    ['#signOut', element()],
  ]);
  const closeListeners = [];
  const signOutDialog = {
    ...element(),
    open: false,
    returnValue: '',
    addEventListener(type, listener) {
      if (type === 'close') closeListeners.push(listener);
    },
    showModal() {
      this.open = true;
      queueMicrotask(() => {
        this.returnValue = signOutChoice;
        this.open = false;
        for (const listener of closeListeners.splice(0)) listener();
      });
    },
    close(value = '') {
      this.returnValue = value;
      this.open = false;
      for (const listener of closeListeners.splice(0)) listener();
    },
  };
  elements.set('#signOutDialog', signOutDialog);

  const storage = new Map();
  const requests = [];
  const alerts = [];
  let clearScheduleCalls = 0;
  let googleCallback = null;
  let completeGoogleRequest = null;
  let completeMeRequest = null;
  const pendingGoogleStatuses = [...googleStatuses];
  const listeners = new Map();
  const emitWindowEvent = event => {
    for (const listener of listeners.get(event.type) || []) listener(event);
  };
  const access = {
    mode: accessMode,
    account: null,
    rememberedLocal: accessMode === 'local',
    pairedMobile: accessMode === 'paired-mobile',
    locked: accessMode === 'pending',
    emit() {
      emitWindowEvent({
        type: 'medication-access-ready',
        detail: { mode: this.mode, account: this.account },
      });
    },
    resolveAccount(value) {
      this.mode = 'account';
      this.account = value;
      this.rememberedLocal = false;
      this.locked = false;
      this.emit();
    },
    resolveSignedOut() {
      this.account = null;
      if (this.pairedMobile) {
        this.mode = 'paired-mobile';
        this.locked = false;
        this.emit();
      } else if (this.rememberedLocal) {
        this.mode = 'local';
        this.locked = false;
        this.emit();
      } else {
        this.mode = 'pending';
        this.locked = true;
      }
    },
    showChoice(message = '') {
      this.mode = 'pending';
      this.account = null;
      this.locked = true;
      this.message = message;
    },
    chooseLocal() {
      this.mode = 'local';
      this.account = null;
      this.rememberedLocal = true;
      this.locked = false;
      this.emit();
      return true;
    },
    requireCloud() {
      if (this.mode !== 'account') throw Error('Sign in with Google before using cloud pairing.');
      return true;
    },
  };

  const window = {
    MedicationAccess: access,
    google: googleAvailable ? {
      accounts: {
        id: {
          initialize(options) { googleCallback = options.callback; },
          renderButton(target) { target.rendered = true; },
        },
      },
    } : undefined,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) { emitWindowEvent(event); },
    clearMedicationSchedule() {
      clearScheduleCalls += 1;
      if (clearScheduleThrows) throw Error('sensitive storage failure');
      return clearScheduleResult;
    },
  };

  async function fetch(url, options = {}) {
    requests.push({ url, options });
    if (url === '/api/auth/config') {
      return response(configStatus, configStatus === 200
        ? { enabled: true, googleClientId: 'google-client-id' }
        : { error: 'Service unavailable' });
    }
    if (url === '/api/auth/me' && (options.method || 'GET') === 'GET') {
      const status = meStatus ?? (signedIn ? 200 : 401);
      const result = response(status, status === 200 ? accountView() : { error: 'Sign-in required.' });
      if (!deferMe) return result;
      return new Promise(resolve => {
        completeMeRequest = () => resolve(result);
      });
    }
    if (url === '/api/auth/google') {
      const status = pendingGoogleStatuses.shift() ?? 200;
      if (!deferGoogle) {
        return response(status, status === 200
          ? accountView()
          : { error: 'Google sign-in could not be verified.' });
      }
      return new Promise(resolve => {
        completeGoogleRequest = () => resolve(response(status, status === 200
          ? accountView()
          : { error: 'Google sign-in could not be verified.' }));
      });
    }
    if (url === '/api/auth/session') {
      return response(deleteStatus, deleteStatus === 200
        ? { ok: true }
        : { error: 'Session revocation could not be confirmed.' });
    }
    if (url === '/api/auth/me' && options.method === 'PATCH') return response(200, accountView());
    return response(404, { error: 'Not found' });
  }

  const context = {
    window,
    google: window.google,
    document: {
      querySelector(selector) { return elements.get(selector) || null; },
      createElement() { return element(); },
      head: {
        append(script) {
          if (!googleAvailable) queueMicrotask(() => script.onerror?.());
        },
      },
    },
    localStorage: {
      getItem(key) {
        if (storageThrows) throw Error('storage unavailable');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageThrows) throw Error('storage unavailable');
        storage.set(key, String(value));
      },
      removeItem(key) {
        if (storageThrows) throw Error('storage unavailable');
        storage.delete(key);
      },
    },
    navigator: { standalone: false },
    matchMedia: () => ({ matches: false }),
    crypto: webcrypto,
    fetch,
    alert(message) { alerts.push(message); },
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init?.detail; }
    },
    Error,
    JSON,
    Object,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  };
  window.window = window;
  vm.runInNewContext(source, context, { filename: 'web/account.js' });

  return {
    window,
    access,
    requests,
    storage,
    alerts,
    elements,
    async initialize() {
      await window.MedicationAccount.initialized;
    },
    async googleCallback(value = { credential: 'signed-google-id-token' }) {
      await window.MedicationAccount.initialized;
      assert.equal(typeof googleCallback, 'function');
      await googleCallback(value);
    },
    async invokeGoogleCallback(value = { credential: 'signed-google-id-token' }) {
      await window.MedicationAccount.initialized;
      assert.equal(typeof googleCallback, 'function');
      return googleCallback(value);
    },
    completeGoogleRequest() {
      assert.equal(typeof completeGoogleRequest, 'function');
      completeGoogleRequest();
    },
    completeMeRequest() {
      assert.equal(typeof completeMeRequest, 'function');
      completeMeRequest();
    },
    async signOut() {
      await window.MedicationAccount.initialized;
      return window.MedicationAccount.signOut();
    },
    get clearScheduleCalls() { return clearScheduleCalls; },
  };
}

test('account requests are same-origin and cookie credentialed', async () => {
  const app = accountHarness();
  await app.initialize();
  assert.equal(app.requests[0].url, '/api/auth/config');
  assert.equal(app.requests[0].options.credentials, 'same-origin');
  assert.equal(app.requests[0].options.headers.Authorization, undefined);
  assert.equal(app.requests[1].url, '/api/auth/me');
  assert.equal(app.requests[1].options.credentials, 'same-origin');
});

test('cookie mutations include the application CSRF header', async () => {
  const app = accountHarness();
  await app.googleCallback();
  const request = app.requests.find(item => item.url === '/api/auth/google');
  assert.equal(request.options.headers['X-Medication-CSRF'], '1');
  assert.equal(request.options.credentials, 'same-origin');
});

test('Google sign-in does not persist a JavaScript session token', async () => {
  const app = accountHarness();
  await app.googleCallback();
  assert.equal(app.storage.has('medication-reminder-account-session-v1'), false);
  assert.equal(app.access.mode, 'account');
  assert.equal('sessionToken' in app.window.MedicationAccount.current, false);
});

test('Google Identity renders in the access gate and account settings', async () => {
  const app = accountHarness();
  await app.initialize();
  assert.equal(app.elements.get('#accessGoogleSignIn').rendered, true);
  assert.equal(app.elements.get('#googleSignIn').rendered, true);
});

test('repeated Google callbacks share one in-flight account mutation', async () => {
  const app = accountHarness({ deferGoogle: true });
  await app.initialize();
  const first = app.invokeGoogleCallback();
  const second = app.invokeGoogleCallback();
  for (let index = 0; index < 4; index += 1) {
    await new Promise(resolve => queueMicrotask(resolve));
  }
  assert.equal(
    app.requests.filter(item => item.url === '/api/auth/google').length,
    1,
  );
  app.completeGoogleRequest();
  await Promise.all([first, second]);
  assert.equal(app.access.mode, 'account');
});

test('late session restoration cannot override a newer explicit local choice', async () => {
  const app = accountHarness({ signedIn: true, deferMe: true });
  for (let index = 0; index < 4; index += 1) {
    await new Promise(resolve => queueMicrotask(resolve));
  }
  app.access.chooseLocal();
  app.completeMeRequest();
  await app.initialize();
  assert.equal(app.access.mode, 'local');
  assert.equal(app.window.MedicationAccount.current, null);
  assert.equal(app.elements.get('#accountIdentity').textContent, '');
});

test('late Google response cannot override a newer explicit local choice', async () => {
  const app = accountHarness({ deferGoogle: true });
  await app.initialize();
  const signIn = app.invokeGoogleCallback();
  for (let index = 0; index < 4; index += 1) {
    await new Promise(resolve => queueMicrotask(resolve));
  }
  app.access.chooseLocal();
  app.completeGoogleRequest();
  await signIn;
  assert.equal(app.access.mode, 'local');
  assert.equal(app.window.MedicationAccount.current, null);
  assert.equal(app.elements.get('#accountIdentity').textContent, '');
});

test('stored local mode is not overridden by session restoration', async () => {
  const app = accountHarness({ signedIn: true, accessMode: 'local' });
  await app.initialize();
  assert.equal(app.access.mode, 'local');
  assert.equal(app.window.MedicationAccount.current, null);
});

test('paired-mobile mode is not overridden by session restoration', async () => {
  const app = accountHarness({ signedIn: true, accessMode: 'paired-mobile' });
  await app.initialize();
  assert.equal(app.access.mode, 'paired-mobile');
  assert.equal(app.window.MedicationAccount.current, null);
});

test('explicit Google sign-in from local mode succeeds without a newer decision', async () => {
  const app = accountHarness({ accessMode: 'local' });
  await app.initialize();
  await app.googleCallback();
  assert.equal(app.access.mode, 'account');
  assert.ok(app.window.MedicationAccount.current?.user);
});

test('Google sign-in can run again after sign-out keep-local', async () => {
  const app = accountHarness({ signOutChoice: 'keep', googleStatuses: [200, 200] });
  await app.googleCallback();
  assert.equal(app.access.mode, 'account');
  await app.signOut();
  assert.equal(app.access.mode, 'local');
  await app.googleCallback({ credential: 'second-google-id-token' });
  assert.equal(
    app.requests.filter(item => item.url === '/api/auth/google').length,
    2,
  );
  assert.equal(app.access.mode, 'account');
});

test('failed Google sign-in can be retried', async () => {
  const app = accountHarness({ googleStatuses: [401, 200] });
  await app.googleCallback();
  assert.equal(app.access.mode, 'pending');
  await app.googleCallback({ credential: 'retry-google-id-token' });
  assert.equal(
    app.requests.filter(item => item.url === '/api/auth/google').length,
    2,
  );
  assert.equal(app.access.mode, 'account');
});

test('Google library load failure keeps the explicit local choice available', async () => {
  const app = accountHarness({ googleAvailable: false });
  await app.initialize();
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(app.access.mode, 'pending');
  assert.match(app.elements.get('#accountStatus').textContent, /could not load/i);
});

test('account service failure exposes a choice and never auto-selects local mode', async () => {
  const app = accountHarness({ configStatus: 503, meStatus: 503 });
  await app.initialize();
  assert.equal(app.access.mode, 'pending');
  assert.match(app.elements.get('#accountStatus').textContent, /temporarily unavailable/i);
});

test('unavailable browser storage does not prevent account initialization', async () => {
  const app = accountHarness({ storageThrows: true });
  await app.initialize();
  assert.equal(app.access.mode, 'pending');
  assert.equal(app.requests[0].url, '/api/auth/config');
});

test('sign-out keep-local returns to explicit local mode', async () => {
  const app = accountHarness({ signedIn: true, signOutChoice: 'keep' });
  await app.signOut();
  assert.equal(app.access.mode, 'local');
  assert.equal(app.clearScheduleCalls, 0);
  const request = app.requests.find(item => item.url === '/api/auth/session');
  assert.equal(request.options.method, 'DELETE');
  assert.equal(request.options.headers['X-Medication-CSRF'], '1');
});

test('sign-out erase clears local schedule state before entering local mode', async () => {
  const app = accountHarness({ signedIn: true, signOutChoice: 'erase' });
  await app.signOut();
  assert.equal(app.clearScheduleCalls, 1);
  assert.equal(app.access.mode, 'local');
});

test('failed local erase does not claim to have entered local mode', async () => {
  const app = accountHarness({
    signedIn: true,
    signOutChoice: 'erase',
    clearScheduleResult: false,
  });
  await app.initialize();
  app.access.rememberedLocal = true;
  await app.signOut();
  assert.equal(app.clearScheduleCalls, 1);
  assert.equal(app.access.mode, 'pending');
  assert.equal(app.access.locked, true);
  assert.equal(app.window.MedicationAccount.current, null);
  assert.match(app.alerts.at(-1), /could not be erased completely/i);
});

test('thrown local erase remains privacy locked after server logout', async () => {
  const app = accountHarness({
    signedIn: true,
    signOutChoice: 'erase',
    clearScheduleThrows: true,
  });
  await app.initialize();
  app.access.pairedMobile = true;
  await app.signOut();
  assert.equal(app.clearScheduleCalls, 1);
  assert.equal(app.access.mode, 'pending');
  assert.equal(app.access.locked, true);
  assert.equal(app.window.MedicationAccount.current, null);
  assert.match(app.alerts.at(-1), /could not be erased completely/i);
  assert.doesNotMatch(app.alerts.at(-1), /sensitive storage failure/i);
});

test('DELETE failure retains account mode and never clears local data', async () => {
  const app = accountHarness({
    signedIn: true,
    signOutChoice: 'erase',
    deleteStatus: 503,
  });
  await app.signOut();
  assert.equal(app.clearScheduleCalls, 0);
  assert.equal(app.access.mode, 'account');
  assert.equal(app.access.locked, false);
  assert.ok(app.window.MedicationAccount.current?.user);
  assert.match(app.alerts.at(-1), /Could not sign out/i);
});

test('signed-out account events always observe the matching access state', async () => {
  for (const scenario of [
    { choice: 'keep', clearResult: true, mode: 'local', locked: false },
    { choice: 'erase', clearResult: true, mode: 'local', locked: false },
    { choice: 'erase', clearResult: false, mode: 'pending', locked: true },
  ]) {
    const app = accountHarness({
      signedIn: true,
      signOutChoice: scenario.choice,
      clearScheduleResult: scenario.clearResult,
    });
    await app.initialize();
    const observations = [];
    app.window.addEventListener('medication-account-changed', event => {
      if (event.detail !== null) return;
      observations.push({
        mode: app.access.mode,
        locked: app.access.locked,
      });
    });
    await app.signOut();
    assert.deepEqual(observations, [{
      mode: scenario.mode,
      locked: scenario.locked,
    }]);
  }
});

test('sign-out cancel preserves the account and makes no request', async () => {
  const app = accountHarness({ signedIn: true, signOutChoice: 'cancel' });
  await app.signOut();
  assert.equal(app.access.mode, 'account');
  assert.equal(app.requests.some(item => item.url === '/api/auth/session'), false);
});

test('account client contains no reusable session storage or token logging', () => {
  assert.doesNotMatch(source, /medication-reminder-account-session-v1|sessionToken|Authorization\s*:/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
  assert.match(source, /const API = '\/api'/);
  assert.match(source, /request\('\/auth\/config'/);
  assert.match(source, /request\('\/auth\/google'/);
  assert.doesNotMatch(source, /client_secret/i);
});

test('Task 6 compatibility shim remains credential-free and non-deployable alone', async () => {
  const app = accountHarness();
  await app.initialize();
  assert.deepEqual({ ...app.window.MedicationAccount.authorizationHeaders() }, {});
  assert.match(source, /do not deploy Task 5 standalone/);
});

test('sign-out dialog exposes keep, erase, and cancel without remote unpairing', () => {
  const html = readFileSync('web/index.html', 'utf8');
  assert.match(html, /<dialog id="signOutDialog"[^>]*aria-labelledby="signOutTitle"[^>]*aria-describedby="signOutDescription"/);
  assert.match(html, /value="keep"[^>]*>Keep on this device</);
  assert.match(html, /value="erase"[^>]*>Erase from this device</);
  assert.match(html, /value="cancel"[^>]*>Cancel</);
  assert.doesNotMatch(source, /unpair|\/sync\/pairs/);
});

test('security policy permits Google Identity Services while blocking plugins and framing', () => {
  const headers = readFileSync('web/_headers', 'utf8');
  assert.match(headers, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
});
