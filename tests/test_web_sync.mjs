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

function installedMobileHarness() {
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
  const navigator = {
    userAgent: 'Mozilla/5.0 (Linux; Android 15)',
    userAgentData: { mobile: true },
    mediaDevices: {
      async getUserMedia() {
        return { getTracks: () => [{ stop() {} }] };
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
      body: { append(node) { dialogs.push(node); } },
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
  storage.set('medication-reminder-sync-v1', JSON.stringify(credentials));
  vm.runInNewContext(readFileSync('web/sync.js', 'utf8'), context);
  context.fetch = async () => {
    fetchCount += 1;
    return { ok: true, async json() { return { ok: true }; } };
  };
  return {
    pair, copy, sync, unpair, dialogs, storage, context,
    setPrompt: value => { promptValue = value; },
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

  app.setPrompt('CANCEL');
  await app.unpair.onclick();
  assert.equal(app.fetchCount(), 0);
  assert.ok(app.storage.has('medication-reminder-sync-v1'));

  app.setPrompt('UNPAIR');
  await app.unpair.onclick();
  assert.equal(app.fetchCount(), 1);
  assert.equal(app.clearCount(), 1);
  assert.equal(app.storage.has('medication-reminder-sync-v1'), false);
  assert.equal(app.sync.hidden, true);
  assert.equal(app.unpair.textContent, 'Pair Schedule');

  await app.unpair.onclick();
  assert.equal(app.dialogs[1].open, true);
});
