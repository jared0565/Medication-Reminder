import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const flush = () => new Promise(resolve => setImmediate(resolve));

function updateHarness({ remoteVersion = '2026.07.23.14', approve = true } = {}) {
  const worker = {
    state: 'installed',
    messages: [],
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    postMessage(message) { this.messages.push(message); },
  };
  const registration = {
    waiting: worker,
    installing: null,
    updates: 0,
    listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    async update() { this.updates += 1; },
  };
  const checkButton = { textContent: 'Check for updates', disabled: false, onclick: null };
  const versionElement = { textContent: '2026.07.23.13' };
  const windowListeners = {};
  const documentListeners = {};
  let confirmations = 0;
  let reloads = 0;
  const context = {
    navigator: {
      serviceWorker: {
        controller: {},
        addEventListener() {},
        async register() { return registration; },
      },
    },
    document: {
      visibilityState: 'visible',
      querySelector(selector) {
        return selector === '#checkUpdates' ? checkButton : versionElement;
      },
      addEventListener(name, handler) { documentListeners[name] = handler; },
    },
    window: {
      addEventListener(name, handler) { windowListeners[name] = handler; },
    },
    location: { reload() { reloads += 1; } },
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() { return { version: remoteVersion }; },
    }),
    confirm: () => { confirmations += 1; return approve; },
    alert() {},
    console,
    Date,
    setInterval: () => 1,
    setTimeout,
    clearTimeout,
  };
  context.window.window = context.window;
  vm.runInNewContext(readFileSync('web/update.js', 'utf8'), context);
  return {
    worker,
    registration,
    checkButton,
    windowListeners,
    documentListeners,
    confirmations: () => confirmations,
    reloads: () => reloads,
  };
}

test('Cloudflare release discovery asks before activating an update', async () => {
  const app = updateHarness();
  await flush();
  await flush();
  assert.equal(app.registration.updates, 1);
  assert.equal(app.confirmations(), 1);
  assert.equal(app.worker.messages.length, 1);
  assert.equal(app.worker.messages[0].type, 'SKIP_WAITING');
});

test('declined updates are not activated or repeatedly prompted in the same session', async () => {
  const app = updateHarness({ approve: false });
  await flush();
  await flush();
  assert.equal(app.confirmations(), 1);
  assert.equal(app.worker.messages.length, 0);
  app.windowListeners.focus();
  await flush();
  await flush();
  assert.equal(app.confirmations(), 1);
  assert.equal(app.worker.messages.length, 0);
});

test('startup reports no update when Cloudflare version matches the installed app', async () => {
  const app = updateHarness({ remoteVersion: '2026.07.23.13' });
  await flush();
  await flush();
  assert.equal(app.registration.updates, 0);
  assert.equal(app.confirmations(), 0);
  assert.equal(app.worker.messages.length, 0);
});
