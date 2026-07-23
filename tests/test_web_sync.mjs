import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

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

function installedMobileHarness({ paired = true, mobile = true, standalone = true } = {}) {
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
  };
  let clearCount = 0, fetchCount = 0, promptValue = '', importedSchedule = null;
  const window = {
    navigator,
    BarcodeDetector: class { async detect() { return []; } },
    addEventListener() {},
    getMedicationSchedule: () => ({ timezone: 'Europe/London', events: [] }),
    getMedicationPushEndpoint: async () => null,
    clearMedicationSchedule: () => { clearCount += 1; },
    applySyncedSchedule: value => { importedSchedule = value; },
  };
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
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    location: { href: 'https://medication.bytesfx.com/', hash: '', pathname: '/', search: '' },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: standalone }),
    fetch: () => new Promise(() => {}),
    prompt: () => promptValue,
    confirm: () => true,
    alert() {},
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    btoa,
    atob,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    structuredClone,
    BarcodeDetector: window.BarcodeDetector,
  };
  window.window = window;
  const credentials = {
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
  context.fetch = async () => {
    fetchCount += 1;
    return { ok: true, async json() { return { ok: true }; } };
  };
  return {
    pair, copy, sync, unpair, status, dialogs, storage, context,
    setPrompt: value => { promptValue = value; },
    revokeFromSource: () => serviceWorkerMessageHandler?.({ data: { type: 'PAIR_REVOKED' } }),
    clearCount: () => clearCount,
    fetchCount: () => fetchCount,
    importedSchedule: () => importedSchedule,
  };
}

test('installed mobile exposes only pairing sync controls and safely unpairs', async () => {
  const app = installedMobileHarness();
  assert.equal(app.pair.hidden, true);
  assert.equal(app.copy.hidden, true);
  assert.equal(app.sync.hidden, false);
  assert.equal(app.unpair.hidden, false);
  assert.equal(app.unpair.textContent, 'Unpair');
  assert.equal(app.status.hidden, true);
  assert.equal(app.context.document.body.classList.contains('installed-mobile'), true);

  app.setPrompt('CANCEL');
  await app.unpair.onclick();
  assert.equal(app.fetchCount(), 0);
  assert.ok(app.storage.has('medication-reminder-sync-v1'));

  app.setPrompt('UNPAIR');
  await app.unpair.onclick();
  assert.equal(app.fetchCount(), 1);
  assert.equal(app.clearCount(), 1);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  assert.equal(app.storage.get('medication-reminder-mobile-unpaired-v1'), '1');
  assert.equal(app.sync.hidden, true);
  assert.equal(app.unpair.textContent, 'Pair Schedule');

  await app.unpair.onclick();
  assert.equal(app.dialogs[1].open, true);
});

test('source-side revocation immediately forgets the mobile schedule', () => {
  const app = installedMobileHarness();
  app.revokeFromSource();
  assert.equal(app.clearCount(), 1);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  assert.equal(app.storage.get('medication-reminder-mobile-unpaired-v1'), '1');
  assert.equal(app.sync.hidden, true);
  assert.equal(app.unpair.textContent, 'Pair Schedule');
});

test('an installed mobile with no active pairing clears legacy local data', () => {
  const app = installedMobileHarness({ paired: false });
  assert.equal(app.clearCount(), 1);
  assert.equal(app.storage.get('medication-reminder-mobile-unpaired-v1'), '1');
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

test('desktop pairing links are routed to a non-claiming snapshot import', () => {
  const source = readFileSync('web/sync.js', 'utf8');
  const start = source.indexOf('async function importScheduleCopy');
  const end = source.indexOf('async function acceptPairing', start);
  const importer = source.slice(start, end);

  assert.ok(start >= 0);
  assert.match(importer, /decryptSchedule/);
  assert.match(importer, /applySyncedSchedule/);
  assert.doesNotMatch(importer, /\/claim/);
  assert.doesNotMatch(importer, /saveCredentials/);
  assert.match(source, /mobileDevice\?acceptPairing\(invitation\):importScheduleCopy\(invitation\)/);
});

test('desktop encrypted schedule import works end-to-end without storing pairing credentials', async () => {
  const app = installedMobileHarness({ paired: false, mobile: false, standalone: false });
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
