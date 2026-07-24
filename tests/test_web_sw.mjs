import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'https://medication.example';
const SHELL_KEY = `${ORIGIN}/`;
const flush = () => new Promise(resolve => setImmediate(resolve));

class FakeResponse {
  constructor({
    body = '',
    ok = true,
    redirected = false,
    status = 200,
    type = 'basic',
    url = SHELL_KEY,
  } = {}) {
    this.body = body;
    this.ok = ok;
    this.redirected = redirected;
    this.status = status;
    this.type = type;
    this.url = url;
  }

  clone() {
    return new FakeResponse({
      body: this.body,
      ok: this.ok,
      redirected: this.redirected,
      status: this.status,
      type: this.type,
      url: this.url,
    });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function serviceWorkerHarness({ fetchImpl, putImpl } = {}) {
  const handlers = new Map();
  const cacheEntries = new Map();
  const cacheNames = ['medication-reminder-web-v24', 'unrelated-app-cache'];
  const puts = [];
  const matches = [];
  const deletes = [];
  const navigations = [];
  const cache = {
    async addAll() {},
    async put(key, response) {
      const normalized = typeof key === 'string' ? key : key.url;
      puts.push({ key: normalized, response });
      if (putImpl) await putImpl(normalized, response);
      cacheEntries.set(normalized, response);
    },
  };
  const caches = {
    async open() { return cache; },
    async keys() { return [...cacheNames]; },
    async delete(name) { deletes.push(name); return true; },
    async match(key) {
      const normalized = typeof key === 'string' ? key : key.url;
      matches.push(normalized);
      return cacheEntries.get(normalized);
    },
  };
  const client = {
    url: SHELL_KEY,
    async focus() {},
    async navigate(url) { navigations.push(url); },
  };
  const notifications = [];
  const self = {
    location: { origin: ORIGIN },
    clients: {
      async claim() {},
      async matchAll() { return [client]; },
      async openWindow(url) { navigations.push(url); },
    },
    addEventListener(name, handler) { handlers.set(name, handler); },
    skipWaiting() {},
    registration: {
      async showNotification(title, options) {
        notifications.push({ title, options });
      },
    },
  };
  const context = {
    URL,
    caches,
    clients: self.clients,
    fetch: fetchImpl || (async () => { throw Error('offline'); }),
    self,
    console,
  };
  vm.runInNewContext(readFileSync('web/sw.js', 'utf8'), context);

  async function dispatchFetch(path, { mode = 'navigate' } = {}) {
    const waitPromises = [];
    const request = {
      method: 'GET',
      mode,
      url: new URL(path, ORIGIN).href,
    };
    let responsePromise;
    handlers.get('fetch')({
      request,
      respondWith(value) { responsePromise = Promise.resolve(value); },
      waitUntil(value) { waitPromises.push(Promise.resolve(value)); },
    });
    return {
      request,
      response: responsePromise,
      waitPromises,
      wait: () => Promise.all(waitPromises),
    };
  }

  async function dispatchPush(payload) {
    const waitPromises = [];
    handlers.get('push')({
      data: { json() { return payload; } },
      waitUntil(value) { waitPromises.push(Promise.resolve(value)); },
    });
    await Promise.all(waitPromises);
  }

  return {
    cacheEntries,
    deletes,
    dispatchFetch,
    dispatchPush,
    handlers,
    matches,
    navigations,
    notifications,
    puts,
  };
}

test('successful shell navigation caches only the canonical root for the full event lifetime', async () => {
  const putGate = deferred();
  const response = new FakeResponse({ body: 'fresh shell' });
  const app = serviceWorkerHarness({
    fetchImpl: async () => response,
    putImpl: async () => putGate.promise,
  });
  const event = await app.dispatchFetch('/?dueAt=1784803200000');

  assert.equal(event.waitPromises.length, 1);
  await flush();
  assert.deepEqual(app.puts.map(item => item.key), [SHELL_KEY]);
  assert.equal(app.puts.some(item => item.key.includes('dueAt')), false);

  let lifetimeFinished = false;
  event.wait().then(() => { lifetimeFinished = true; });
  await flush();
  assert.equal(lifetimeFinished, false);
  putGate.resolve();
  assert.equal(await event.response, response);
  await event.wait();
  assert.equal(lifetimeFinished, true);
});

test('invalid shell network responses are returned but never cached', async t => {
  for (const [name, response] of [
    ['404', new FakeResponse({ ok: false, status: 404 })],
    ['500', new FakeResponse({ ok: false, status: 500 })],
    ['redirect', new FakeResponse({ redirected: true, url: 'https://login.example/' })],
    ['unexpected same-origin path', new FakeResponse({ url: `${ORIGIN}/sign-in` })],
    ['opaque', new FakeResponse({ type: 'opaque', url: '' })],
  ]) {
    await t.test(name, async () => {
      const app = serviceWorkerHarness({ fetchImpl: async () => response });
      const event = await app.dispatchFetch('/index.html?source=notification');
      assert.equal(await event.response, response);
      await event.wait();
      assert.deepEqual(app.puts, []);
    });
  }
});

test('offline notification navigation retains dueAt in the browser and falls back to canonical shell', async () => {
  const cached = new FakeResponse({ body: 'offline shell' });
  const app = serviceWorkerHarness();
  app.cacheEntries.set(SHELL_KEY, cached);
  const clickWaits = [];
  app.handlers.get('notificationclick')({
    notification: {
      data: { url: '/?dueAt=1784803200000' },
      close() {},
    },
    waitUntil(value) { clickWaits.push(Promise.resolve(value)); },
  });
  await Promise.all(clickWaits);
  assert.deepEqual(app.navigations, ['/?dueAt=1784803200000']);

  const event = await app.dispatchFetch(app.navigations[0]);
  assert.equal(await event.response, cached);
  await event.wait();
  assert.deepEqual(app.matches, [SHELL_KEY]);
  assert.equal(app.matches.some(key => key.includes('dueAt')), false);
});

test('push notification urls are constrained to the app origin', async t => {
  await t.test('cross-origin payload url falls back to the canonical shell', async () => {
    const app = serviceWorkerHarness();
    await app.dispatchPush({ title: 'Reminder', url: 'https://evil.example/steal' });
    assert.equal(app.notifications.length, 1);
    assert.equal(app.notifications[0].options.data.url, '/');

    app.handlers.get('notificationclick')({
      notification: { data: app.notifications[0].options.data, close() {} },
      waitUntil() {},
    });
    await flush();
    assert.equal(app.navigations.some(url => url.includes('evil.example')), false);
  });

  await t.test('javascript scheme payload url falls back to the canonical shell', async () => {
    const app = serviceWorkerHarness();
    await app.dispatchPush({ title: 'Reminder', url: 'javascript:alert(1)' });
    assert.equal(app.notifications[0].options.data.url, '/');
  });

  await t.test('same-origin dueAt deep link is preserved as a path', async () => {
    const app = serviceWorkerHarness();
    await app.dispatchPush({ title: 'Reminder', tag: 'medication-1784803200000' });
    assert.equal(app.notifications[0].options.data.url, '/?dueAt=1784803200000');
  });

  await t.test('protocol-relative cross-origin url falls back to the canonical shell', async () => {
    const app = serviceWorkerHarness();
    await app.dispatchPush({ title: 'Reminder', url: '//evil.example/steal' });
    assert.equal(app.notifications[0].options.data.url, '/');
  });
});

test('activation removes only stale Medication Reminder cache generations', async () => {
  const app = serviceWorkerHarness();
  const waits = [];
  app.handlers.get('activate')({
    waitUntil(value) { waits.push(Promise.resolve(value)); },
  });
  await Promise.all(waits);
  assert.deepEqual(app.deletes, ['medication-reminder-web-v24']);
});
