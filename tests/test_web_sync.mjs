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

function installedMobileHarness({ paired = true } = {}) {
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
    userAgent: 'Mozilla/5.0 (Linux; Android 15)',
    userAgentData: { mobile: true },
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
  let clearCount = 0, fetchCount = 0, promptValue = '';
  const window = {
    navigator,
    BarcodeDetector: class { async detect() { return []; } },
    addEventListener() {},
    getMedicationSchedule: () => ({ timezone: 'Europe/London', events: [] }),
    getMedicationPushEndpoint: async () => null,
    clearMedicationSchedule: () => { clearCount += 1; },
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
    matchMedia: () => ({ matches: true }),
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
