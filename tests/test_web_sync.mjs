import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const ACCOUNT_USER_ID = '00000000-0000-4000-8000-000000000001';

function control() {
  return { hidden: false, textContent: '', onclick: null, disabled: false };
}

function dialog() {
  const children = new Map();
  const canvas = { getContext: () => ({ fillRect() {}, fillStyle: '' }) };
  const video = { readyState: 2, srcObject: null, async play() {} };
  const status = { textContent: '' };
  children.set('#securePairingQr', canvas);
  children.set('#copySecurePairLink', control());
  children.set('#secureQrCamera', video);
  children.set('#secureQrStatus', status);
  children.set('#pasteSecurePairLink', control());
  return {
    open: false,
    innerHTML: '',
    listeners: {},
    querySelector(selector) { return children.get(selector) || control(); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.close?.(); },
  };
}

function installedMobileHarness({
  paired = true,
  mobile = true,
  standalone = true,
  storedCredentials = null,
  accessMode = mobile && standalone ? 'paired-mobile' : 'account',
  cloudSync = true,
  pendingInvitation = '',
  fetchHandler = null,
  accountUserId = ACCOUNT_USER_ID,
  storageFailureKey = '',
  scheduleApplyFailure = false,
  decryptGate = null,
  encryptGate = null,
  clipboardHandler = null,
  confirmHandler = null,
} = {}) {
  const storage = new Map();
  const pair = control(), copy = control(), sync = control(), unpair = control();
  const status = { textContent: '', classList: { add() {}, remove() {} } };
  const dialogs = [];
  const elements = new Map([
    ['#syncStatus', status],
    ['#showQr', pair],
    ['#exportSchedule', copy],
    ['#importSchedule', sync],
    ['#unpairDevice', unpair],
  ]);
  let serviceWorkerMessageHandler = null;
  const navigator = {
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 15)' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    userAgentData: { mobile },
    mediaDevices: {
      async getUserMedia() {
        return { getTracks: () => [{ stop() {} }] };
      },
    },
    serviceWorker: {
      addEventListener(name, handler) {
        if (name === 'message') serviceWorkerMessageHandler = handler;
      },
    },
    clipboard: {
      writeText: text => clipboardHandler ? clipboardHandler(text) : Promise.resolve(),
    },
  };
  let clearCount = 0, fetchCount = 0, promptValue = '', importedSchedule = null;
  const requests = [], alerts = [], confirmations = [], windowListeners = new Map();
  const scheduledTimers = [];
  const recordingSetTimeout = (handler, delay, ...args) => {
    scheduledTimers.push({ delay });
    const handle = setTimeout(handler, delay, ...args);
    handle?.unref?.();
    return handle;
  };
  let harnessReady = false;
  let consumedInvitation = false;
  let failedStorageKey = storageFailureKey;
  let applyShouldFail = scheduleApplyFailure;
  const medicationAccess = {
    mode: accessMode,
    ready: accessMode !== 'pending',
    cloudSync,
    pendingInvitation: () => consumedInvitation ? '' : pendingInvitation,
    consumePendingInvitation() {
      consumedInvitation = true;
      return pendingInvitation;
    },
    requireCloud() {
      if (this.mode !== 'account') throw Error('Sign in with Google before using cloud pairing.');
      if (!this.cloudSync) throw Error('Cloud device sync is not enabled for this account.');
      return true;
    },
  };
  const window = {
    navigator,
    BarcodeDetector: class { async detect() { return []; } },
    MedicationAccess: medicationAccess,
    MedicationAccount: {
      current: accessMode === 'account' ? { user: { id: accountUserId } } : null,
    },
    addEventListener(name, handler) {
      const values = windowListeners.get(name) || [];
      values.push(handler);
      windowListeners.set(name, values);
    },
    dispatchEvent(event) {
      for (const handler of windowListeners.get(event.type) || []) handler(event);
    },
    getMedicationSchedule: () => ({ timezone: 'Europe/London', events: [] }),
    getMedicationPushEndpoint: async () => null,
    clearMedicationSchedule: () => { clearCount += 1; },
    applySyncedSchedule: value => {
      if (applyShouldFail) throw Error('schedule persistence failed');
      importedSchedule = value;
    },
  };
  const harnessCrypto = decryptGate || encryptGate ? {
    getRandomValues: value => webcrypto.getRandomValues(value),
    subtle: {
      importKey: (...args) => webcrypto.subtle.importKey(...args),
      encrypt: (...args) => encryptGate
        ? encryptGate(() => webcrypto.subtle.encrypt(...args))
        : webcrypto.subtle.encrypt(...args),
      decrypt: (...args) => decryptGate
        ? decryptGate(() => webcrypto.subtle.decrypt(...args))
        : webcrypto.subtle.decrypt(...args),
    },
  } : webcrypto;
  const context = {
    window,
    navigator,
    document: {
      body: {
        append(node) { dialogs.push(node); },
        classList: {
          values: new Set(),
          toggle(name, enabled) { enabled ? this.values.add(name) : this.values.delete(name); },
          contains(name) { return this.values.has(name); },
        },
      },
      visibilityState: 'hidden',
      querySelector(selector) { return elements.get(selector) || control(); },
      createElement() { return dialog(); },
      addEventListener() {},
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => {
        if (key === failedStorageKey) throw Error('storage unavailable');
        storage.set(key, value);
      },
      removeItem: key => storage.delete(key),
    },
    location: { href: 'https://medication.bytesfx.com/', hash: '', pathname: '/', search: '' },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: standalone }),
    fetch: async (url, options = {}) => {
      fetchCount += 1;
      requests.push({ url, options });
      if (fetchHandler) return fetchHandler(url, options);
      if (harnessReady) return { ok: true, status: 200, async json() { return { ok: true }; } };
      return new Promise(() => {});
    },
    prompt: () => promptValue,
    confirm: message => {
      confirmations.push(message);
      return confirmHandler ? confirmHandler(message) : true;
    },
    alert: message => alerts.push(message),
    console,
    crypto: harnessCrypto,
    TextEncoder,
    TextDecoder,
    URL,
    btoa,
    atob,
    encodeURIComponent,
    setTimeout: recordingSetTimeout,
    clearTimeout,
    setInterval: () => 1,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    structuredClone,
    Math,
    BarcodeDetector: window.BarcodeDetector,
    qrcode: () => ({
      addData() {},
      make() {},
      getModuleCount: () => 1,
      isDark: () => false,
    }),
  };
  window.window = window;
  const credentials = storedCredentials || {
    version: 1,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    token: 't'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 1,
    claimed: true,
    dirty: false,
  };
  if (paired) storage.set('medication-reminder-sync-v1', JSON.stringify(credentials));
  vm.runInNewContext(readFileSync('web/sync.js', 'utf8'), context);
  harnessReady = true;
  return {
    pair, copy, sync, unpair, status, dialogs, storage, context,
    setPrompt: value => { promptValue = value; },
    revokeFromSource: () => serviceWorkerMessageHandler?.({ data: { type: 'PAIR_REVOKED' } }),
    clearCount: () => clearCount,
    fetchCount: () => fetchCount,
    requests,
    alerts,
    confirmations,
    scheduledTimers,
    pendingInvitationConsumed: () => consumedInvitation,
    failStorageFor: key => { failedStorageKey = key; },
    failScheduleApply: value => { applyShouldFail = value; },
    dispatchStorage: key => window.dispatchEvent({ type: 'storage', key }),
    transitionAccess(mode, userId = accountUserId) {
      medicationAccess.mode = mode;
      medicationAccess.ready = true;
      window.MedicationAccount.current = mode === 'account' ? { user: { id: userId } } : null;
      window.dispatchEvent({ type: 'medication-access-ready', detail: { mode } });
    },
    switchAccount(userId) {
      window.MedicationAccount.current = { user: { id: userId } };
      window.dispatchEvent({ type: 'medication-account-changed', detail: window.MedicationAccount.current });
    },
    dispatchScheduleChange: () => window.dispatchEvent({ type: 'medication-schedule-changed' }),
    resolveAccount() {
      medicationAccess.mode = 'account';
      medicationAccess.ready = true;
      window.MedicationAccount.current = { user: { id: accountUserId } };
      window.dispatchEvent({ type: 'medication-access-ready', detail: { mode: 'account' } });
    },
    flush: async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    },
    importedSchedule: () => importedSchedule,
  };
}

async function encryptedRemote(encryptionKey, overrides = {}) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(encryptionKey, 'base64url'),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const schedule = { version: 1, timezone: 'Europe/London', events: [] };
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(schedule)),
  ));
  return {
    revision: 1,
    updatedBy: 's'.repeat(32),
    claimed: false,
    iv: Buffer.from(iv).toString('base64url'),
    ciphertext: Buffer.from(ciphertext).toString('base64url'),
    ...overrides,
  };
}

function sourceCredentials(overrides = {}) {
  return {
    version: 2,
    role: 'source',
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: 'a'.repeat(43),
    ownerUserId: ACCOUNT_USER_ID,
    sourceId: 's'.repeat(32),
    deviceId: 's'.repeat(32),
    revision: 1,
    claimed: false,
    dirty: false,
    ...overrides,
  };
}

test('installed mobile exposes only pairing sync controls and safely unpairs', async () => {
  const app = installedMobileHarness();
  assert.equal(app.pair.hidden, true);
  assert.equal(app.copy.hidden, true);
  assert.equal(app.sync.hidden, false);
  assert.equal(app.unpair.hidden, false);
  assert.equal(app.unpair.textContent, 'Unpair');
  assert.equal(app.status.hidden, false);
  assert.equal(app.context.document.body.classList.contains('installed-mobile'), true);

  app.setPrompt('CANCEL');
  await app.unpair.onclick();
  assert.equal(app.fetchCount(), 0);
  assert.ok(app.storage.has('medication-reminder-sync-v1'));

  app.setPrompt('UNPAIR');
  await app.unpair.onclick();
  assert.equal(app.fetchCount(), 0);
  assert.equal(app.clearCount(), 1);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  assert.equal(app.storage.get('medication-reminder-mobile-unpaired-v1'), '1');
  assert.equal(app.sync.hidden, true);
  assert.equal(app.unpair.textContent, 'Pair Schedule');

  await app.unpair.onclick();
  assert.equal(app.dialogs[1].open, true);
});

test('installed mobile keeps a visible status surface for persistent sync failures', async () => {
  const scoped = {
    version: 2,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: false,
  };
  const app = installedMobileHarness({
    storedCredentials: scoped,
    fetchHandler: async () => ({
      ok: false,
      status: 403,
      async json() { return { error: 'Cloud sync is not active for this pairing' }; },
    }),
  });
  assert.equal(app.status.hidden, false);
  await app.context.window.MedicationSync.syncNow({ silent: true });
  assert.equal(app.status.hidden, false);
  assert.match(app.status.textContent, /paused|not active/i);
});

test('an unauthenticated service-worker message cannot erase an offline mobile schedule', () => {
  const app = installedMobileHarness();
  app.revokeFromSource();
  assert.equal(app.clearCount(), 0);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), true);
  assert.equal(app.sync.hidden, false);
  assert.equal(app.unpair.textContent, 'Unpair');
});

test('an installed mobile with no active pairing does not erase local data implicitly', () => {
  const app = installedMobileHarness({ paired: false });
  assert.equal(app.clearCount(), 0);
  assert.equal(app.storage.has('medication-reminder-mobile-unpaired-v1'), false);
  assert.equal(app.sync.hidden, true);
  assert.equal(app.unpair.textContent, 'Pair Schedule');
});

test('an explicitly unpaired mobile stays empty after app reload', () => {
  const storage = new Map([
    ['medication-reminder-mobile-unpaired-v1', '1'],
    ['medication-reminder-schedule-v1', JSON.stringify({
      timezone: 'Europe/London',
      events: [{ id: 'stale', time: '08:00', label: 'Stale schedule' }],
    })],
  ]);
  const context = {
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
    },
    Intl,
    JSON,
    console,
    structuredClone,
  };
  const initialization = readFileSync('web/app.js', 'utf8').split('const $=')[0];
  vm.runInNewContext(`${initialization};globalThis.loadedSchedule=schedule;`, context);
  assert.equal(context.loadedSchedule.events.length, 0);
  assert.equal(JSON.parse(storage.get('medication-reminder-schedule-v1')).events.length, 0);
});

test('a new visitor starts with an empty private schedule', () => {
  const storage = new Map();
  const context = {
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
    },
    Intl,
    JSON,
    console,
    structuredClone,
  };
  const initialization = readFileSync('web/app.js', 'utf8').split('const $=')[0];
  vm.runInNewContext(`${initialization};globalThis.loadedSchedule=schedule;`, context);
  assert.equal(context.loadedSchedule.events.length, 0);
});

test('atomic synced schedule persistence keeps the old in-memory schedule on storage failure', () => {
  const source = readFileSync('web/app.js', 'utf8');
  const match = source.match(/window\.applySyncedSchedule=incoming=>\{[\s\S]*?\};\r?\nwindow\.clearMedicationSchedule/);
  assert.ok(match);
  const implementation = match[0].replace(/\r?\nwindow\.clearMedicationSchedule$/, '');
  const window = {};
  const context = {
    window,
    structuredClone,
    JSON,
    Error,
    console: { error() {} },
    alert() {},
    localStorage: {
      setItem() { throw Error('quota'); },
      removeItem() {},
    },
  };
  vm.runInNewContext(`
    let schedule={version:1,timezone:'Europe/London',events:[{id:'old'}]};
    const key='medication-reminder-schedule-v1',unpairedKey='unpaired';
    function renderAll(){}
    function validateScheduleShape(value){return value}
    async function syncPushSubscription(){}
    ${implementation}
    try { window.applySyncedSchedule({version:1,timezone:'Europe/London',events:[{id:'new'}]}); } catch {}
    globalThis.result=schedule;
  `, context);
  assert.equal(context.result.events[0].id, 'old');
});

function runAppBoot(storage) {
  const context = {
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, value),
    },
    Intl,
    JSON,
    console,
    structuredClone,
  };
  const initialization = readFileSync('web/app.js', 'utf8').split('const $=')[0];
  vm.runInNewContext(
    `${initialization};`
    + 'globalThis.loadedSchedule=schedule;'
    + 'globalThis.loadedWarning=scheduleLoadWarning;'
    + 'globalThis.normalizeDays=normalizeDays;'
    + 'globalThis.validateEventShape=validateEventShape;'
    + 'globalThis.validateScheduleShape=validateScheduleShape;',
    context,
  );
  return context;
}

test('a corrupt stored schedule falls back to an empty schedule with a visible warning', () => {
  for (const corrupt of [
    JSON.stringify({ timezone: 'Europe/London', events: [{ id: 'x', time: 'not-a-time', label: '', medicines: [], days: ['whoknows'] }] }),
    JSON.stringify('just a string'),
    JSON.stringify({ timezone: 'Europe/London', events: 'not-an-array' }),
    JSON.stringify({ timezone: 'Europe/London', events: [{ id: 'y', time: '08:00', label: 'L', medicines: ['A'], days: ['funday'] }] }),
  ]) {
    const storage = new Map([['medication-reminder-schedule-v1', corrupt]]);
    const context = runAppBoot(storage);
    assert.equal(context.loadedSchedule.events.length, 0);
    assert.match(context.loadedWarning, /reset|could not/i);
  }
});

test('a valid stored schedule loads unchanged and normalizes legacy day names at boot', () => {
  const stored = {
    timezone: 'Europe/London',
    events: [{ id: 'm', enabled: true, time: '08:00', label: 'Morning', medicines: ['A'], instructions: '', days: ['monday'], start_date: null, end_date: null }],
  };
  const storage = new Map([['medication-reminder-schedule-v1', JSON.stringify(stored)]]);
  const context = runAppBoot(storage);
  assert.equal(context.loadedWarning, '');
  assert.equal(context.loadedSchedule.events.length, 1);
  assert.equal(context.loadedSchedule.events[0].label, 'Morning');
  assert.deepEqual([...context.loadedSchedule.events[0].days], ['mon']);
});

test('the shared schedule validator rejects malformed imports and the sync import path guards on it', () => {
  const context = runAppBoot(new Map());
  assert.equal(context.validateScheduleShape(null), null);
  assert.equal(context.validateScheduleShape({ timezone: 'Europe/London', events: [{ id: 'x' }] }), null);
  assert.equal(context.validateScheduleShape({ timezone: 'Europe/London', events: 'nope' }), null);
  const ok = context.validateScheduleShape({
    timezone: 'Europe/London',
    events: [{ id: 'm', time: '08:00', label: 'Morning', medicines: ['A'], days: ['monday'] }],
  });
  assert.ok(ok);
  assert.deepEqual([...ok.events[0].days], ['mon']);
  const appSource = readFileSync('web/app.js', 'utf8');
  assert.match(appSource, /window\.applySyncedSchedule=incoming=>\{if\(!validateScheduleShape\(incoming\)\)/);
});

test('saveEditor normalizes day tokens and enforces the sync validator caps', () => {
  const context = runAppBoot(new Map());
  assert.deepEqual([...context.normalizeDays('monday, Tue , WED')], ['mon', 'tue', 'wed']);
  assert.deepEqual([...context.normalizeDays('daily')], ['daily']);
  assert.deepEqual([...context.normalizeDays(['sun', 'sunday'])], ['sun']);
  assert.equal(context.normalizeDays('someday'), null);
  assert.equal(context.normalizeDays(''), null);

  const many = Array.from({ length: 33 }, (_, index) => `Medicine ${index}`);
  assert.equal(context.validateEventShape({ id: 'e', time: '08:00', label: 'L', medicines: many, days: ['daily'] }), null);
  assert.ok(context.validateEventShape({ id: 'e', time: '08:00', label: 'L', medicines: many.slice(0, 32), days: ['daily'] }));

  const src = readFileSync('web/app.js', 'utf8');
  const saveEditor = src.match(/function saveEditor\(\)\{[^\n]*return true\}/)[0];
  assert.match(saveEditor, /medicines\.length>32/);
  assert.match(saveEditor, /schedule\.events\.length>=64/);
  assert.match(saveEditor, /normalizeDays\(\$\('#eventDays'\)\.value\)/);
  assert.match(saveEditor, /validateEventShape\(/);
});

test('active() and the notification dedup key use the local calendar day, not UTC', () => {
  const src = readFileSync('web/app.js', 'utf8');
  const localDateKey = src.match(/const localDateKey=[^\n]*/)[0];
  const active = src.match(/function active\(e,d=new Date\(\)\)\{[^\n]*\}/)[0];
  const context = { Date, String };
  vm.runInNewContext(
    `${localDateKey}\n${active}\nglobalThis.active=active;globalThis.localDateKey=localDateKey;`,
    context,
  );
  // A user east of UTC just before midnight: local day is the 15th, UTC day is still the 14th.
  const fakeDate = {
    getDay: () => 1,
    getFullYear: () => 2026,
    getMonth: () => 0,
    getDate: () => 15,
    toISOString: () => '2026-01-14T23:30:00.000Z',
  };
  assert.equal(context.localDateKey(fakeDate), '2026-01-15');
  const event = { enabled: true, days: ['mon'], start_date: '2026-01-15', end_date: null };
  // Local day (15th) is on/after the start date; the old UTC comparison (14th) would exclude it.
  assert.equal(context.active(event, fakeDate), true);
  assert.match(src, /const now=new Date\(\),today=localDateKey\(now\)/);
  assert.match(src, /const iso=localDateKey\(d\)/);
});

test('the dead plaintext pairing path is removed while the encrypted flow stays intact', () => {
  const src = readFileSync('web/app.js', 'utf8');
  assert.doesNotMatch(src, /decodePairingPayload/);
  assert.doesNotMatch(src, /renderPairingQr/);
  assert.doesNotMatch(src, /const pairFromUrl=new URLSearchParams/);
  assert.doesNotMatch(src, /id="scanQr"/);
  assert.doesNotMatch(src, /schedule=data\.schedule/);
  const sync = readFileSync('web/sync.js', 'utf8');
  assert.match(sync, /pairButton\.onclick = showPairing/);
  assert.match(sync, /copyButton\.onclick = copyPairLink/);
  assert.match(sync, /syncButton\.onclick = \(\) => void syncNow\(\)/);
});

test('the push subscription is refreshed on open, visibility regain, and a daily timer', () => {
  const src = readFileSync('web/app.js', 'utf8');
  assert.match(src, /window\.addEventListener\('focus',\(\)=>void syncPushSubscription\(\)\)/);
  assert.match(src, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.visibilityState==='visible'\)void syncPushSubscription\(\)\}\)/);
  assert.match(src, /setInterval\(\(\)=>\{if\(document\.visibilityState==='visible'\)void syncPushSubscription\(\)\},86400000\)/);
});

test('desktop pairing links are routed to a non-claiming snapshot import', () => {
  const source = readFileSync('web/sync.js', 'utf8');
  const start = source.indexOf('async function importScheduleCopy');
  const end = source.indexOf('function validPendingClaim', start);
  const importer = source.slice(start, end);

  assert.ok(start >= 0);
  assert.match(importer, /decryptSchedule/);
  assert.match(importer, /applySyncedSchedule/);
  assert.doesNotMatch(importer, /\/claim/);
  assert.doesNotMatch(importer, /saveCredentials/);
  assert.match(source, /installedMobile[\s\S]*acceptPairing\(invitation\)/);
});

test('desktop encrypted schedule import works end-to-end without storing pairing credentials', async () => {
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    accessMode: 'account',
    cloudSync: true,
  });
  const schedule = {
    version: 1,
    timezone: 'Europe/London',
    events: [{
      id: 'morning',
      enabled: true,
      time: '07:00',
      label: 'Morning medicines',
      medicines: ['Medicine A', 'Medicine B'],
      instructions: 'With water',
      days: ['daily'],
      start_date: null,
      end_date: null,
    }],
  };
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify(schedule)),
  ));
  const encode = bytes => Buffer.from(bytes).toString('base64url');
  let requestedUrl = '';
  app.context.fetch = async url => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return { revision: 7, iv: encode(iv), ciphertext: encode(encrypted) };
      },
    };
  };

  await app.context.window.MedicationSync.importScheduleCopy({
    version: 1,
    pairId: 'p'.repeat(32),
    token: 't'.repeat(43),
    encryptionKey: encode(key),
  });

  assert.equal(app.importedSchedule().events[0].label, 'Morning medicines');
  assert.match(requestedUrl, /\/sync\/pairs\/p{32}$/);
  assert.doesNotMatch(requestedUrl, /\/claim$/);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
});

test('deferred desktop import cannot overwrite after access, account, or schedule authority changes', async t => {
  const otherAccountId = '00000000-0000-4000-8000-000000000002';
  for (const scenario of ['local transition', 'account switch', 'schedule edit']) {
    await t.test(scenario, async () => {
      const key = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      const remote = await encryptedRemote(key);
      let resolveRequest;
      let releaseDecrypt;
      let decryptStarted = false;
      const app = installedMobileHarness({
        paired: false,
        mobile: false,
        standalone: false,
        accessMode: 'account',
        fetchHandler: scenario === 'schedule edit'
          ? async () => ({ ok: true, status: 200, async json() { return remote; } })
          : () => new Promise(resolve => { resolveRequest = resolve; }),
        decryptGate: scenario === 'schedule edit' ? continuation => {
          decryptStarted = true;
          return new Promise((resolve, reject) => {
            releaseDecrypt = () => continuation().then(resolve, reject);
          });
        } : null,
      });
      const importing = app.context.window.MedicationSync.importScheduleCopy({
        version: 1,
        pairId: 'p'.repeat(32),
        token: 't'.repeat(43),
        encryptionKey: key,
      });
      await app.flush();
      if (scenario === 'local transition') app.transitionAccess('local');
      if (scenario === 'account switch') app.switchAccount(otherAccountId);
      if (scenario === 'schedule edit') {
        assert.equal(decryptStarted, true);
        app.dispatchScheduleChange();
        releaseDecrypt();
      } else {
        resolveRequest({ ok: true, status: 200, async json() { return remote; } });
      }
      const result = await importing;
      assert.equal(result.terminal, true);
      assert.equal(result.imported, false);
      assert.equal(app.importedSchedule(), null);
      assert.match(app.alerts.at(-1), /changed|retry/i);
    });
  }
});

test('local-only mode cannot create or operate a cloud pairing', async () => {
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    accessMode: 'local',
  });
  await app.pair.onclick();
  await app.context.window.MedicationSync.syncNow();
  assert.equal(app.fetchCount(), 0);
  assert.match(app.alerts.at(-1), /Sign in/);
});

test('account source requests use same-origin cookies and CSRF without bearer authorization', async () => {
  const created = {
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    revision: 1,
  };
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    fetchHandler: async () => ({
      ok: true,
      status: 201,
      async json() { return created; },
    }),
  });
  await app.context.window.MedicationSync.createPair();
  const request = app.requests.find(item => item.url.endsWith('/api/sync/pairs'));
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['X-Medication-CSRF'], '1');
  assert.equal(request.options.headers.Authorization, undefined);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['ciphertext', 'iv', 'sourceId']);
  const saved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(saved.version, 2);
  assert.equal(saved.ownerUserId, ACCOUNT_USER_ID);
  assert.equal('token' in saved, false);
});

test('version-2 pairing links carry only invitation material and treat client expiry as advisory', async () => {
  const future = new Date(Date.now() + 600_000).toISOString();
  const source = {
    version: 2,
    role: 'source',
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: future,
    encryptionKey: 'a'.repeat(43),
    ownerUserId: ACCOUNT_USER_ID,
    sourceId: 's'.repeat(32),
    deviceId: 's'.repeat(32),
    revision: 1,
    claimed: false,
    dirty: false,
  };
  const app = installedMobileHarness({
    storedCredentials: source,
    mobile: false,
    standalone: false,
    accessMode: 'account',
  });
  const link = app.context.window.MedicationSync.pairingLink(source);
  const decoded = JSON.parse(Buffer.from(new URL(link).hash.slice(6), 'base64url').toString());
  assert.deepEqual(Object.keys(decoded).sort(), [
    'encryptionKey', 'invitationExpiresAt', 'invitationToken', 'pairId', 'version',
  ]);
  // A merely-past expiry (e.g. a skewed local clock) is advisory: the link still parses
  // and the server's claim response drives the authoritative verdict.
  const clientExpired = { ...decoded, invitationExpiresAt: new Date(Date.now() - 1000).toISOString() };
  const clientExpiredLink = `https://medication.bytesfx.com/#pair=${Buffer.from(JSON.stringify(clientExpired)).toString('base64url')}`;
  const parsed = app.context.window.MedicationSync.parseInvitation(clientExpiredLink);
  assert.equal(parsed.invitationToken, clientExpired.invitationToken);
  // A structurally invalid expiry is still rejected outright.
  const malformed = { ...decoded, invitationExpiresAt: 'not-a-real-timestamp' };
  const malformedLink = `https://medication.bytesfx.com/#pair=${Buffer.from(JSON.stringify(malformed)).toString('base64url')}`;
  assert.throws(() => app.context.window.MedicationSync.parseInvitation(malformedLink), /invalid|expired/i);
});

test('mobile claim sends a stable nonce and stores only the returned scoped credential', async () => {
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const schedule = { version: 1, timezone: 'Europe/London', events: [] };
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify(schedule)),
  ));
  let attempt = 0;
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: Buffer.from(key).toString('base64url'),
  };
  const app = installedMobileHarness({
    paired: false,
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
    fetchHandler: async () => {
      attempt += 1;
      if (attempt === 1) throw Error('network unavailable');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            pairId: invitation.pairId,
            mobileToken: 'm'.repeat(43),
            revision: 1,
            iv: Buffer.from(iv).toString('base64url'),
            ciphertext: Buffer.from(ciphertext).toString('base64url'),
          };
        },
      };
    },
  });
  await app.flush();
  const pending = JSON.parse(app.storage.get('medication-reminder-pending-claim-v1'));
  assert.match(pending.claimNonce, /^[A-Za-z0-9_-]{43}$/);
  const firstBody = JSON.parse(app.requests[0].options.body);
  assert.equal(firstBody.claimNonce, pending.claimNonce);
  await app.context.window.MedicationSync.retryPendingClaim();
  const secondBody = JSON.parse(app.requests[1].options.body);
  assert.equal(secondBody.claimNonce, firstBody.claimNonce);
  assert.equal(app.requests[1].options.headers.Authorization, `Bearer ${invitation.invitationToken}`);
  assert.equal(app.requests[1].options.headers['X-Medication-Device'], pending.deviceId);
  assert.equal(app.requests[1].options.credentials, 'omit');
  const saved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(saved.mobileToken, 'm'.repeat(43));
  assert.equal('token' in saved, false);
  assert.equal('invitationToken' in saved, false);
  assert.equal(app.storage.has('medication-reminder-pending-claim-v1'), false);
});

test('claim response body stream failure retains the exact tuple for deterministic retry', async () => {
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    new TextEncoder().encode(JSON.stringify({ version: 1, timezone: 'Europe/London', events: [] })),
  ));
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: Buffer.from(key).toString('base64url'),
  };
  let attempt = 0;
  const app = installedMobileHarness({
    paired: false,
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
    fetchHandler: async () => {
      attempt += 1;
      if (attempt === 1) {
        return {
          ok: true,
          status: 200,
          async text() { throw Error('stream reset after server response'); },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            pairId: invitation.pairId,
            mobileToken: 'm'.repeat(43),
            revision: 1,
            iv: Buffer.from(iv).toString('base64url'),
            ciphertext: Buffer.from(ciphertext).toString('base64url'),
          });
        },
      };
    },
  });
  await app.flush();
  const retained = JSON.parse(app.storage.get('medication-reminder-pending-claim-v1'));
  assert.match(retained.claimNonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(app.pendingInvitationConsumed(), false);
  const firstBody = JSON.parse(app.requests[0].options.body);
  await app.context.window.MedicationSync.retryPendingClaim();
  const retryBody = JSON.parse(app.requests[1].options.body);
  assert.equal(retryBody.claimNonce, firstBody.claimNonce);
  assert.equal(retryBody.mobileDeviceId, firstBody.mobileDeviceId);
  assert.equal(app.storage.has('medication-reminder-pending-claim-v1'), false);
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).mobileToken, 'm'.repeat(43));
});

test('unsupported desktop version-2 invitation is terminal and consumed after account readiness', async () => {
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: 'a'.repeat(43),
  };
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    accessMode: 'pending',
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
  });
  await app.flush();
  assert.equal(app.pendingInvitationConsumed(), false);
  app.resolveAccount();
  await app.flush();
  assert.equal(app.pendingInvitationConsumed(), true);
  assert.equal(app.fetchCount(), 0);
});

test('structurally invalid successful claim retains pending custody and preserves prior local pairing', async () => {
  const existing = {
    version: 2,
    role: 'mobile',
    pairId: 'x'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 3,
    claimed: true,
    dirty: false,
  };
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: 'a'.repeat(43),
  };
  const app = installedMobileHarness({
    storedCredentials: existing,
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
    fetchHandler: async () => ({
      ok: true,
      status: 200,
      async json() { return { pairId: invitation.pairId, mobileToken: 'too-short' }; },
    }),
  });
  await app.flush();
  assert.equal(app.storage.has('medication-reminder-pending-claim-v1'), true);
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).pairId, existing.pairId);
  assert.equal(app.clearCount(), 0);
  assert.equal(app.pendingInvitationConsumed(), false);
});

test('fully read malformed successful claim JSON remains ambiguous and retains custody', async () => {
  const existing = {
    version: 2,
    role: 'mobile',
    pairId: 'x'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 3,
    claimed: true,
    dirty: false,
  };
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: 'a'.repeat(43),
  };
  const app = installedMobileHarness({
    storedCredentials: existing,
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
    fetchHandler: async () => ({
      ok: true,
      status: 200,
      async text() { return '{"pairId":'; },
    }),
  });
  await app.flush();
  assert.equal(app.storage.has('medication-reminder-pending-claim-v1'), true);
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).pairId, existing.pairId);
  assert.equal(app.clearCount(), 0);
  assert.equal(app.pendingInvitationConsumed(), false);
});

test('successful claim decryption failure retains custody and preserves prior local pairing', async () => {
  const existing = {
    version: 2,
    role: 'mobile',
    pairId: 'x'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 3,
    claimed: true,
    dirty: false,
  };
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: 'a'.repeat(43),
  };
  const app = installedMobileHarness({
    storedCredentials: existing,
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
    fetchHandler: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          pairId: invitation.pairId,
          mobileToken: 'n'.repeat(43),
          revision: 1,
          iv: 'b'.repeat(16),
          ciphertext: 'c'.repeat(32),
        };
      },
    }),
  });
  await app.flush();
  assert.equal(app.storage.has('medication-reminder-pending-claim-v1'), true);
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).pairId, existing.pairId);
  assert.equal(app.clearCount(), 0);
  assert.equal(app.pendingInvitationConsumed(), false);
});

test('retryable claim HTTP statuses retain the exact pending tuple', async t => {
  for (const status of [403, 429, 503]) {
    await t.test(String(status), async () => {
      const invitation = {
        version: 2,
        pairId: 'p'.repeat(32),
        invitationToken: 'i'.repeat(43),
        invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        encryptionKey: 'a'.repeat(43),
      };
      const app = installedMobileHarness({
        paired: false,
        pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
        fetchHandler: async () => ({
          ok: false,
          status,
          async json() { return { error: 'safe worker failure' }; },
        }),
      });
      await app.flush();
      const retained = JSON.parse(app.storage.get('medication-reminder-pending-claim-v1'));
      assert.equal(retained.invitationToken, invitation.invitationToken);
      assert.match(retained.claimNonce, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(app.pendingInvitationConsumed(), false);
      if (status === 403) assert.match(app.status.textContent, /paused|not active/i);
    });
  }
});

test('claim local commit failures restore prior credentials and retain retry custody', async t => {
  const existing = {
    version: 2, role: 'mobile', pairId: 'x'.repeat(32), mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43), deviceId: 'd'.repeat(32), revision: 3, claimed: true, dirty: false,
  };
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: 'a'.repeat(43),
  };
  const response = await encryptedRemote(invitation.encryptionKey, {
    pairId: invitation.pairId,
    mobileToken: 'n'.repeat(43),
  });
  for (const failure of ['credentials', 'schedule']) {
    await t.test(failure, async () => {
      const app = installedMobileHarness({
        storedCredentials: existing,
        pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
        storageFailureKey: failure === 'credentials' ? 'medication-reminder-sync-v1' : '',
        scheduleApplyFailure: failure === 'schedule',
        fetchHandler: async () => ({ ok: true, status: 200, async json() { return response; } }),
      });
      await app.flush();
      assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).pairId, existing.pairId);
      assert.equal(app.storage.has('medication-reminder-pending-claim-v1'), true);
      assert.equal(app.importedSchedule(), null);
      assert.equal(app.clearCount(), 0);
      assert.equal(app.pendingInvitationConsumed(), false);
    });
  }
});

test('inactive cloud 403 pauses sync without erasing schedule or credentials', async () => {
  const scoped = {
    version: 2,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: false,
  };
  const app = installedMobileHarness({
    storedCredentials: scoped,
    fetchHandler: async () => ({
      ok: false,
      status: 403,
      async json() { return { error: 'Cloud sync is not active for this pairing' }; },
    }),
  });
  await app.context.window.MedicationSync.syncNow();
  assert.equal(app.clearCount(), 0);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), true);
  assert.match(app.status.textContent, /paused|not active/i);
});

test('retryable sync failures back off exponentially and reset after a success', async () => {
  const scoped = {
    version: 2,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: true,
  };
  let failing = true;
  const app = installedMobileHarness({
    paired: false,
    fetchHandler: async (_url, options) => {
      if (failing) return { ok: false, status: 503, async json() { return { error: 'unavailable' }; } };
      if (options.method === 'PUT') return { ok: true, status: 200, async json() { return { revision: 999 }; } };
      return {
        ok: true,
        status: 200,
        async json() {
          return await encryptedRemote(scoped.encryptionKey, {
            revision: 2,
            updatedBy: scoped.deviceId,
            claimed: true,
          });
        },
      };
    },
  });
  app.storage.set('medication-reminder-sync-v1', JSON.stringify(scoped));
  app.dispatchStorage('medication-reminder-sync-v1');
  app.scheduledTimers.length = 0;

  await app.context.window.MedicationSync.syncNow();
  await app.context.window.MedicationSync.syncNow();
  await app.context.window.MedicationSync.syncNow();
  const growth = app.scheduledTimers.map(timer => timer.delay);
  assert.equal(growth.length, 3);
  assert.ok(growth[0] >= 1000, `first delay ${growth[0]} should be at least the base`);
  assert.ok(growth[1] > growth[0], 'second failure should wait longer than the first');
  assert.ok(growth[2] > growth[1], 'third failure should wait longer than the second');
  assert.ok(growth[2] <= 300_000, 'backoff is capped at five minutes');

  failing = false;
  await app.context.window.MedicationSync.syncNow();
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).dirty, false);

  failing = true;
  app.dispatchScheduleChange();
  app.scheduledTimers.length = 0;
  await app.context.window.MedicationSync.syncNow();
  const afterReset = app.scheduledTimers.map(timer => timer.delay).filter(delay => delay >= 1000).at(-1);
  assert.ok(afterReset < 2000, `after a success the backoff resets to the base window (${afterReset})`);
});

test('non-retryable sync failures do not schedule a background retry', async t => {
  const scoped = {
    version: 2,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: true,
  };

  await t.test('403 entitlement failure stops the retry loop', async () => {
    const app = installedMobileHarness({
      paired: false,
      fetchHandler: async () => ({
        ok: false,
        status: 403,
        async json() { return { error: 'Cloud sync is not active for this pairing' }; },
      }),
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(scoped));
    app.dispatchStorage('medication-reminder-sync-v1');
    app.scheduledTimers.length = 0;
    await app.context.window.MedicationSync.syncNow({ silent: true });
    assert.deepEqual(app.scheduledTimers, []);
    assert.match(app.status.textContent, /paused|not active/i);
  });

  await t.test('a locally invalid schedule stops the retry loop', async () => {
    const app = installedMobileHarness({
      paired: false,
      fetchHandler: async (_url, options) => {
        if (options.method === 'PUT') return { ok: true, status: 200, async json() { return { revision: 3 }; } };
        return {
          ok: true,
          status: 200,
          async json() {
            return await encryptedRemote(scoped.encryptionKey, {
              revision: 2,
              updatedBy: scoped.deviceId,
              claimed: true,
            });
          },
        };
      },
    });
    app.context.window.getMedicationSchedule = () => ({
      timezone: 'Europe/London',
      events: [{ id: 'bad', time: '99:99', label: '', medicines: [], days: [] }],
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(scoped));
    app.dispatchStorage('medication-reminder-sync-v1');
    app.scheduledTimers.length = 0;
    await app.context.window.MedicationSync.syncNow({ silent: true });
    assert.deepEqual(app.scheduledTimers, []);
    assert.match(app.status.textContent, /failed|invalid/i);
  });
});

test('a stable device id storage failure surfaces a storage-specific message', async () => {
  const created = {
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    revision: 1,
  };
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    storageFailureKey: 'medication-reminder-source-id-v1',
    fetchHandler: async () => ({ ok: true, status: 201, async json() { return created; } }),
  });
  await assert.rejects(
    app.context.window.MedicationSync.createPair(),
    /identifier|storage|permission/i,
  );
  assert.equal(app.fetchCount(), 0);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
});

test('a source pairing deleted on the server stops looping and offers to discard the stale handle', async t => {
  const verified404 = async () => ({
    ok: false,
    status: 404,
    async json() { return { error: 'Pairing not found or credentials invalid' }; },
  });

  await t.test('silent sync stops retrying and keeps the local schedule and handle', async () => {
    const source = sourceCredentials({ claimed: true, invitationToken: undefined, invitationExpiresAt: undefined });
    delete source.invitationToken;
    delete source.invitationExpiresAt;
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      fetchHandler: verified404,
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
    app.dispatchStorage('medication-reminder-sync-v1');
    app.scheduledTimers.length = 0;
    await app.context.window.MedicationSync.syncNow({ silent: true });
    assert.deepEqual(app.scheduledTimers, []);
    assert.equal(app.storage.has('medication-reminder-sync-v1'), true);
    assert.match(app.status.textContent, /no longer exists|stopped/i);
  });

  await t.test('an interactive sync prompts to discard the stale pairing but keeps the schedule', async () => {
    const source = sourceCredentials({ claimed: true });
    delete source.invitationToken;
    delete source.invitationExpiresAt;
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      confirmHandler: () => true,
      fetchHandler: verified404,
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
    app.dispatchStorage('medication-reminder-sync-v1');
    await app.context.window.MedicationSync.syncNow();
    assert.equal(app.confirmations.some(message => /deleted on the server|discard/i.test(message)), true);
    assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
    assert.equal(app.clearCount(), 0);
  });
});

test('a silent sync conflict is never auto-resolved and preserves both sides until chosen', async () => {
  const scoped = {
    version: 2,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: true,
  };
  const remote = await encryptedRemote(scoped.encryptionKey, {
    revision: 5,
    updatedBy: 'another_device_000000000000',
    claimed: true,
  });
  const app = installedMobileHarness({
    paired: false,
    fetchHandler: async (_url, options) => options.method === 'PUT'
      ? { ok: true, status: 200, async json() { return { revision: 6 }; } }
      : { ok: true, status: 200, async json() { return remote; } },
  });
  app.storage.set('medication-reminder-sync-v1', JSON.stringify(scoped));
  app.dispatchStorage('medication-reminder-sync-v1');

  await app.context.window.MedicationSync.syncNow({ silent: true });
  // No confirm() from a background sync, no discard of either side.
  assert.equal(app.confirmations.some(message => /both devices|overwrite/i.test(message)), false);
  assert.equal(app.importedSchedule(), null);
  assert.equal(app.requests.some(request => request.options.method === 'PUT'), false);
  assert.equal(app.context.window.MedicationSync.hasPendingConflict(), true);
  const preserved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(preserved.dirty, true);
  assert.equal(preserved.revision, 2);
  assert.equal(app.dialogs[2].open, true);

  // The user chooses the remote version; only now is the local side replaced.
  await app.context.window.MedicationSync.resolveConflict('remote');
  assert.notEqual(app.importedSchedule(), null);
  const resolved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(resolved.revision, 5);
  assert.equal(resolved.dirty, false);
  assert.equal(app.context.window.MedicationSync.hasPendingConflict(), false);
});

test('scoped mobile sync binds bearer to the exact device and clears only on verified 404', async () => {
  const scoped = {
    version: 2,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: false,
  };
  const app = installedMobileHarness({
    storedCredentials: scoped,
    fetchHandler: async () => ({
      ok: false,
      status: 404,
      async json() { return { error: 'Pairing not found or credentials invalid' }; },
    }),
  });
  await app.context.window.MedicationSync.syncNow();
  assert.equal(app.requests[0].options.headers.Authorization, `Bearer ${scoped.mobileToken}`);
  assert.equal(app.requests[0].options.headers['X-Medication-Device'], scoped.deviceId);
  assert.equal(app.requests[0].options.credentials, 'omit');
  assert.equal(app.clearCount(), 1);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), false);

  const unverified = installedMobileHarness({
    storedCredentials: scoped,
    fetchHandler: async () => ({
      ok: false,
      status: 404,
      async json() { return {}; },
    }),
  });
  await unverified.context.window.MedicationSync.syncNow();
  assert.equal(unverified.clearCount(), 0);
  assert.equal(unverified.storage.has('medication-reminder-sync-v1'), true);
});

test('network and server failures retain scoped and legacy offline mobile credentials', async t => {
  for (const storedCredentials of [{
    version: 2,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: false,
  }, {
    version: 1,
    role: 'mobile',
    pairId: 'p'.repeat(32),
    token: 't'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 2,
    claimed: true,
    dirty: false,
  }]) {
    await t.test(`version ${storedCredentials.version}`, async () => {
      const app = installedMobileHarness({
        storedCredentials,
        fetchHandler: async () => ({
          ok: false,
          status: 503,
          async json() { return { error: 'Temporarily unavailable' }; },
        }),
      });
      await app.context.window.MedicationSync.syncNow();
      assert.equal(app.clearCount(), 0);
      assert.equal(app.storage.has('medication-reminder-sync-v1'), true);
    });
  }
});

test('expired source invitations refresh with cookie CSRF compare-and-set input', async () => {
  const source = {
    version: 2,
    role: 'source',
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() - 1000).toISOString(),
    encryptionKey: 'a'.repeat(43),
    ownerUserId: ACCOUNT_USER_ID,
    sourceId: 's'.repeat(32),
    deviceId: 's'.repeat(32),
    revision: 1,
    claimed: false,
    dirty: false,
  };
  const app = installedMobileHarness({
    storedCredentials: source,
    mobile: false,
    standalone: false,
    accessMode: 'account',
    fetchHandler: async url => {
      assert.match(url, /\/api\/sync\/pairs\/p{32}\/invitations$/);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            pairId: source.pairId,
            invitationToken: 'n'.repeat(43),
            invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          };
        },
      };
    },
  });
  await app.copy.onclick();
  const request = app.requests[0];
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['X-Medication-CSRF'], '1');
  assert.equal(request.options.headers.Authorization, undefined);
  const refreshBody = JSON.parse(request.options.body);
  assert.equal(refreshBody.previousInvitationToken, source.invitationToken);
  assert.match(refreshBody.refreshNonce, /^[A-Za-z0-9_-]{43}$/);
  const saved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(saved.invitationToken, 'n'.repeat(43));
  assert.equal(app.storage.has('medication-reminder-pending-refresh-v1'), false);
});

test('a consumed competing invitation is terminal without erasing an unrelated schedule', async () => {
  const existing = {
    version: 2,
    role: 'mobile',
    pairId: 'x'.repeat(32),
    mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 3,
    claimed: true,
    dirty: false,
  };
  const invitation = {
    version: 2,
    pairId: 'p'.repeat(32),
    invitationToken: 'i'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    encryptionKey: 'a'.repeat(43),
  };
  const app = installedMobileHarness({
    storedCredentials: existing,
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
    fetchHandler: async () => ({
      ok: false,
      status: 410,
      async json() { return { error: 'Pairing invitation already used' }; },
    }),
  });
  await app.flush();
  assert.equal(app.clearCount(), 0);
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).pairId, existing.pairId);
  assert.equal(app.storage.has('medication-reminder-pending-claim-v1'), false);
});

test('desktop invitation waits for account readiness before importing', async () => {
  const key = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const invitation = {
    version: 1,
    pairId: 'p'.repeat(32),
    token: 't'.repeat(43),
    encryptionKey: key,
  };
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    accessMode: 'pending',
    pendingInvitation: `#pair=${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`,
  });
  await app.flush();
  assert.equal(app.fetchCount(), 0);
  app.resolveAccount();
  await app.flush();
  assert.equal(app.fetchCount(), 1);
});

test('late scoped 404 cannot clear a pairing created in another tab', async () => {
  const oldPair = {
    version: 2, role: 'mobile', pairId: 'o'.repeat(32), mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43), deviceId: 'd'.repeat(32), revision: 1, claimed: true, dirty: false,
  };
  const newPair = {
    ...oldPair, pairId: 'n'.repeat(32), mobileToken: 'z'.repeat(43),
  };
  let resolveRequest;
  const app = installedMobileHarness({
    storedCredentials: oldPair,
    fetchHandler: () => new Promise(resolve => { resolveRequest = resolve; }),
  });
  const syncing = app.context.window.MedicationSync.syncNow();
  await app.flush();
  app.storage.set('medication-reminder-sync-v1', JSON.stringify(newPair));
  app.dispatchStorage('medication-reminder-sync-v1');
  resolveRequest({
    ok: false,
    status: 404,
    async json() { return { error: 'Pairing not found or credentials invalid' }; },
  });
  await syncing;
  assert.equal(app.clearCount(), 0);
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).pairId, newPair.pairId);
});

test('late GET and PUT completions cannot restore credentials after explicit unpair', async t => {
  const mobile = {
    version: 2, role: 'mobile', pairId: 'p'.repeat(32), mobileToken: 'm'.repeat(43),
    encryptionKey: 'a'.repeat(43), deviceId: 'd'.repeat(32), revision: 1, claimed: true, dirty: false,
  };
  await t.test('GET', async () => {
    let resolveGet;
    const app = installedMobileHarness({
      storedCredentials: mobile,
      fetchHandler: () => new Promise(resolve => { resolveGet = resolve; }),
    });
    const syncing = app.context.window.MedicationSync.syncNow();
    await app.flush();
    app.setPrompt('UNPAIR');
    await app.unpair.onclick();
    resolveGet({
      ok: false,
      status: 404,
      async json() { return { error: 'Pairing not found or credentials invalid' }; },
    });
    await syncing;
    assert.equal(app.clearCount(), 1);
    assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  });

  await t.test('PUT', async () => {
    const remote = await encryptedRemote(mobile.encryptionKey);
    let resolvePut;
    let calls = 0;
    const app = installedMobileHarness({
      storedCredentials: mobile,
      fetchHandler: async () => {
        calls += 1;
        if (calls === 1) return { ok: true, status: 200, async json() { return remote; } };
        return new Promise(resolve => { resolvePut = resolve; });
      },
    });
    const syncing = app.context.window.MedicationSync.syncNow({ pushLocal: true });
    while (!resolvePut) await app.flush();
    app.setPrompt('UNPAIR');
    await app.unpair.onclick();
    resolvePut({ ok: true, status: 200, async json() { return { revision: 2 }; } });
    await syncing;
    assert.equal(app.clearCount(), 1);
    assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  });
});

test('source credentials are account-bound and ambiguous delete 404 retains the handle', async () => {
  const source = sourceCredentials();
  const otherAccount = installedMobileHarness({
    storedCredentials: source,
    mobile: false,
    standalone: false,
    accountUserId: '00000000-0000-4000-8000-000000000002',
  });
  await otherAccount.context.window.MedicationSync.syncNow();
  await otherAccount.unpair.onclick();
  assert.equal(otherAccount.fetchCount(), 0);
  assert.equal(otherAccount.storage.has('medication-reminder-sync-v1'), true);
  assert.match(otherAccount.alerts.at(-1), /original owner|another account/i);

  const owner = installedMobileHarness({
    storedCredentials: source,
    mobile: false,
    standalone: false,
    fetchHandler: async () => ({
      ok: false,
      status: 404,
      async json() { return { error: 'Pairing not found or credentials invalid' }; },
    }),
  });
  await owner.unpair.onclick();
  assert.equal(owner.storage.has('medication-reminder-sync-v1'), true);
  assert.match(owner.alerts.at(-1), /could not be confirmed/i);
});

test('source creation cannot cross account epochs before request or after response', async t => {
  const created = {
    pairId: 'n'.repeat(32),
    invitationToken: 'z'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
    revision: 1,
  };
  const otherAccountId = '00000000-0000-4000-8000-000000000002';

  await t.test('account switch while encryption is pending prevents POST', async () => {
    let releaseEncryption;
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      encryptGate: continuation => new Promise((resolve, reject) => {
        releaseEncryption = () => continuation().then(resolve, reject);
      }),
      fetchHandler: async () => ({ ok: true, status: 201, async json() { return created; } }),
    });
    const creating = app.context.window.MedicationSync.createPair();
    await app.flush();
    app.switchAccount(otherAccountId);
    releaseEncryption();
    await assert.rejects(creating, /changed|account|stale/i);
    assert.equal(app.fetchCount(), 0);
    assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  });

  await t.test('account switch after POST prevents credential storage', async () => {
    let resolvePost;
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      fetchHandler: () => new Promise(resolve => { resolvePost = resolve; }),
    });
    const creating = app.context.window.MedicationSync.createPair();
    while (!resolvePost) await app.flush();
    app.switchAccount(otherAccountId);
    resolvePost({ ok: true, status: 201, async json() { return created; } });
    await assert.rejects(creating, /changed|account|stale/i);
    assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  });
});

test('source sync cannot cross sign-out or account-switch boundaries', async t => {
  const source = sourceCredentials();
  const remote = await encryptedRemote(source.encryptionKey, {
    revision: 2,
    updatedBy: 'other_source_device_1234',
  });
  const otherAccountId = '00000000-0000-4000-8000-000000000002';

  await t.test('sign-out while GET is pending', async () => {
    let resolveGet;
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      fetchHandler: () => new Promise(resolve => { resolveGet = resolve; }),
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
    app.dispatchStorage('medication-reminder-sync-v1');
    const syncing = app.context.window.MedicationSync.syncNow();
    await app.flush();
    app.transitionAccess('local');
    resolveGet({ ok: true, status: 200, async json() { return remote; } });
    await syncing;
    assert.equal(app.importedSchedule(), null);
    assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).revision, 1);
  });

  await t.test('account switch while decrypt is pending', async () => {
    let releaseDecrypt;
    let decryptStarted = false;
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      decryptGate: continuation => {
        decryptStarted = true;
        return new Promise((resolve, reject) => {
          releaseDecrypt = () => continuation().then(resolve, reject);
        });
      },
      fetchHandler: async () => ({ ok: true, status: 200, async json() { return remote; } }),
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
    app.dispatchStorage('medication-reminder-sync-v1');
    const syncing = app.context.window.MedicationSync.syncNow();
    while (!decryptStarted) await app.flush();
    app.switchAccount(otherAccountId);
    releaseDecrypt();
    await syncing;
    assert.equal(app.importedSchedule(), null);
    assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).revision, 1);
  });

  await t.test('account switch while PUT is pending', async () => {
    const dirtySource = sourceCredentials({ dirty: true });
    const currentRemote = await encryptedRemote(dirtySource.encryptionKey);
    let resolvePut;
    let calls = 0;
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      fetchHandler: async () => {
        calls += 1;
        if (calls === 1) {
          return { ok: true, status: 200, async json() { return currentRemote; } };
        }
        return new Promise(resolve => { resolvePut = resolve; });
      },
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(dirtySource));
    app.dispatchStorage('medication-reminder-sync-v1');
    const syncing = app.context.window.MedicationSync.syncNow();
    while (!resolvePut) await app.flush();
    app.switchAccount(otherAccountId);
    resolvePut({ ok: true, status: 200, async json() { return { revision: 2 }; } });
    await syncing;
    const saved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
    app.storage.set('medication-reminder-sync-v1', JSON.stringify({ ...saved, dirty: false }));
    assert.equal(saved.revision, 1);
    assert.equal(saved.dirty, true);
  });
});

test('offline source edits stay dirty and resume only for the original owner', async t => {
  const ownerId = ACCOUNT_USER_ID;
  const otherAccountId = '00000000-0000-4000-8000-000000000002';

  async function waitForPut(app) {
    for (let attempt = 0; attempt < 20
      && !app.requests.some(request => request.options.method === 'PUT'); attempt += 1) {
      await app.flush();
    }
    assert.equal(app.requests.some(request => request.options.method === 'PUT'), true);
  }

  await t.test('sign-out edit persists dirty and uploads when the same owner returns', async () => {
    const source = sourceCredentials();
    const remote = await encryptedRemote(source.encryptionKey);
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      fetchHandler: async (_url, options) => options.method === 'PUT'
        ? { ok: true, status: 200, async json() { return { revision: 2 }; } }
        : { ok: true, status: 200, async json() { return remote; } },
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
    app.dispatchStorage('medication-reminder-sync-v1');
    app.transitionAccess('local');
    app.dispatchScheduleChange();
    assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).dirty, true);
    assert.equal(app.fetchCount(), 0);
    app.transitionAccess('account', ownerId);
    await waitForPut(app);
  });

  await t.test('remote revision change surfaces a non-destructive conflict before any upload', async () => {
    const source = sourceCredentials();
    const remote = await encryptedRemote(source.encryptionKey, {
      revision: 2,
      updatedBy: 'other_source_device_1234',
    });
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      fetchHandler: async (_url, options) => options.method === 'PUT'
        ? { ok: true, status: 200, async json() { return { revision: 3 }; } }
        : { ok: true, status: 200, async json() { return remote; } },
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
    app.dispatchStorage('medication-reminder-sync-v1');
    app.transitionAccess('local');
    app.dispatchScheduleChange();
    app.transitionAccess('account', ownerId);
    await app.flush();
    await app.flush();
    // A background sync must neither block on confirm() nor discard either side.
    assert.equal(app.confirmations.some(message => /both devices|overwrite/i.test(message)), false);
    assert.equal(app.requests.some(request => request.options.method === 'PUT'), false);
    assert.equal(app.context.window.MedicationSync.hasPendingConflict(), true);
    const preserved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
    assert.equal(preserved.dirty, true);
    assert.equal(preserved.revision, 1);
    // The user explicitly keeps this device; only then does it upload over the remote base.
    await app.context.window.MedicationSync.resolveConflict('keep');
    const put = app.requests.find(request => request.options.method === 'PUT');
    assert.ok(put);
    assert.equal(JSON.parse(put.options.body).baseRevision, 2);
    assert.equal(app.context.window.MedicationSync.hasPendingConflict(), false);
  });

  await t.test('wrong-account edit never syncs until the original owner returns', async () => {
    const source = sourceCredentials();
    const remote = await encryptedRemote(source.encryptionKey);
    const app = installedMobileHarness({
      paired: false,
      mobile: false,
      standalone: false,
      fetchHandler: async (_url, options) => options.method === 'PUT'
        ? { ok: true, status: 200, async json() { return { revision: 2 }; } }
        : { ok: true, status: 200, async json() { return remote; } },
    });
    app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
    app.dispatchStorage('medication-reminder-sync-v1');
    app.switchAccount(otherAccountId);
    app.dispatchScheduleChange();
    assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).dirty, true);
    assert.equal(app.fetchCount(), 0);
    app.switchAccount(ownerId);
    await waitForPut(app);
  });
});

test('source invitation refresh cannot display or copy after an account transition', async t => {
  const source = sourceCredentials({
    invitationExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const refreshed = {
    pairId: source.pairId,
    invitationToken: 'r'.repeat(43),
    invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const otherAccountId = '00000000-0000-4000-8000-000000000002';

  for (const action of ['QR', 'clipboard']) {
    await t.test(action, async () => {
      let resolveRefresh;
      const copied = [];
      const app = installedMobileHarness({
        paired: false,
        mobile: false,
        standalone: false,
        clipboardHandler: async text => { copied.push(text); },
        fetchHandler: () => new Promise(resolve => { resolveRefresh = resolve; }),
      });
      app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
      app.dispatchStorage('medication-reminder-sync-v1');
      const sharing = action === 'QR' ? app.pair.onclick() : app.copy.onclick();
      await app.flush();
      app.switchAccount(otherAccountId);
      resolveRefresh({ ok: true, status: 200, async json() { return refreshed; } });
      await sharing;
      assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).invitationToken, source.invitationToken);
      assert.equal(app.dialogs[0].open, false);
      assert.deepEqual(copied, []);
    });
  }
});

test('unchanged source authority still displays and copies the current invitation', async () => {
  const source = sourceCredentials();
  const copied = [];
  const app = installedMobileHarness({
    storedCredentials: source,
    mobile: false,
    standalone: false,
    clipboardHandler: async text => { copied.push(text); },
    fetchHandler: async () => ({
      ok: true,
      status: 200,
      async json() { return await encryptedRemote(source.encryptionKey); },
    }),
  });
  await app.pair.onclick();
  await app.copy.onclick();
  assert.equal(app.dialogs[0].open, true);
  assert.equal(copied.length, 1);
  assert.match(copied[0], /#pair=/);
});

test('late source revocation success cannot clear a replacement pairing from another tab', async () => {
  const oldPair = sourceCredentials();
  const newPair = sourceCredentials({
    pairId: 'n'.repeat(32),
    invitationToken: 'z'.repeat(43),
  });
  let resolveDelete;
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    fetchHandler: () => new Promise(resolve => { resolveDelete = resolve; }),
  });
  app.storage.set('medication-reminder-sync-v1', JSON.stringify(oldPair));
  const revoking = app.unpair.onclick();
  await app.flush();
  app.storage.set('medication-reminder-sync-v1', JSON.stringify(newPair));
  app.dispatchStorage('medication-reminder-sync-v1');
  resolveDelete({ ok: true, status: 204, async json() { return {}; } });
  await revoking;
  assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).pairId, newPair.pairId);
});

test('claimed source retires invitation material and hides invitation controls', async () => {
  const source = sourceCredentials();
  const remote = await encryptedRemote(source.encryptionKey, { claimed: true });
  const app = installedMobileHarness({
    storedCredentials: source,
    mobile: false,
    standalone: false,
    fetchHandler: async () => ({ ok: true, status: 200, async json() { return remote; } }),
  });
  await app.context.window.MedicationSync.syncNow();
  const saved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(saved.claimed, true);
  assert.equal('invitationToken' in saved, false);
  assert.equal('invitationExpiresAt' in saved, false);
  assert.equal(app.pair.hidden, true);
  assert.equal(app.copy.hidden, true);
  assert.equal(app.sync.hidden, false);
  assert.equal(app.unpair.hidden, false);
});

test('claimed source invitation is retired before a later dirty PUT failure', async () => {
  const source = sourceCredentials({ dirty: true });
  const remote = await encryptedRemote(source.encryptionKey, { claimed: true });
  let calls = 0;
  const app = installedMobileHarness({
    paired: false,
    mobile: false,
    standalone: false,
    fetchHandler: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, status: 200, async json() { return remote; } };
      return {
        ok: false,
        status: 503,
        async json() { return { error: 'temporarily unavailable' }; },
      };
    },
  });
  app.storage.set('medication-reminder-sync-v1', JSON.stringify(source));
  app.storage.set('medication-reminder-pending-refresh-v1', JSON.stringify({
    version: 1,
    pairId: source.pairId,
    previousInvitationToken: source.invitationToken,
    refreshNonce: 'R'.repeat(43),
    ownerUserId: source.ownerUserId,
    sourceId: source.sourceId,
  }));
  app.dispatchStorage('medication-reminder-sync-v1');
  await app.context.window.MedicationSync.syncNow();
  const saved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  app.storage.set('medication-reminder-sync-v1', JSON.stringify({ ...saved, dirty: false }));
  assert.equal(calls, 2);
  assert.equal(saved.claimed, true);
  assert.equal('invitationToken' in saved, false);
  assert.equal('invitationExpiresAt' in saved, false);
  assert.equal(app.storage.has('medication-reminder-pending-refresh-v1'), false);
  assert.equal(app.pair.hidden, true);
  assert.equal(app.copy.hidden, true);
});

test('invitation refresh retries exact nonce after lost response and local save failure', async t => {
  for (const failure of ['stream', 'storage']) {
    await t.test(failure, async () => {
      const source = sourceCredentials({
        invitationExpiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      let calls = 0;
      const app = installedMobileHarness({
        storedCredentials: source,
        mobile: false,
        standalone: false,
        storageFailureKey: failure === 'storage' ? 'medication-reminder-sync-v1' : '',
        fetchHandler: async () => {
          calls += 1;
          if (failure === 'stream' && calls === 1) {
            return { ok: true, status: 200, async text() { throw Error('lost body'); } };
          }
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                pairId: source.pairId,
                invitationToken: 'n'.repeat(43),
                invitationExpiresAt: new Date(Date.now() + 600_000).toISOString(),
              };
            },
          };
        },
      });
      await app.copy.onclick();
      const pending = JSON.parse(app.storage.get('medication-reminder-pending-refresh-v1'));
      const first = JSON.parse(app.requests[0].options.body);
      assert.equal(pending.refreshNonce, first.refreshNonce);
      if (failure === 'storage') app.failStorageFor('');
      await app.copy.onclick();
      const second = JSON.parse(app.requests[1].options.body);
      assert.equal(second.refreshNonce, first.refreshNonce);
      assert.equal(app.storage.has('medication-reminder-pending-refresh-v1'), false);
      assert.equal(JSON.parse(app.storage.get('medication-reminder-sync-v1')).invitationToken, 'n'.repeat(43));
    });
  }
});

test('delayed invitation refresh replay accepts renewed future expiry and clears custody', async () => {
  const source = sourceCredentials({
    invitationExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const renewedExpiry = new Date(Date.now() + 15 * 60_000).toISOString();
  let calls = 0;
  const app = installedMobileHarness({
    storedCredentials: source,
    mobile: false,
    standalone: false,
    fetchHandler: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: true, status: 200, async text() { throw Error('response lost'); } };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            pairId: source.pairId,
            invitationToken: 'r'.repeat(43),
            invitationExpiresAt: renewedExpiry,
          };
        },
      };
    },
  });
  await app.copy.onclick();
  const pending = JSON.parse(app.storage.get('medication-reminder-pending-refresh-v1'));
  await app.copy.onclick();
  const bodies = app.requests.map(request => JSON.parse(request.options.body));
  assert.equal(bodies[1].refreshNonce, pending.refreshNonce);
  assert.equal(bodies[1].previousInvitationToken, pending.previousInvitationToken);
  const saved = JSON.parse(app.storage.get('medication-reminder-sync-v1'));
  assert.equal(saved.invitationToken, 'r'.repeat(43));
  assert.equal(saved.invitationExpiresAt, renewedExpiry);
  assert.equal(app.storage.has('medication-reminder-pending-refresh-v1'), false);
});
