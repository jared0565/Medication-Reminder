import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/device-link.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ search = '', me = { ok: true, status: 200, body: { user: { email: 'owner@example.test' }, features: { cloudSync: true } } } } = {}) {
  const fetchCalls = [];
  const responses = { '/api/auth/me': me };
  const element = () => ({ textContent: '', value: '', hidden: false, disabled: false, _listeners: {},
    addEventListener(name, handler) { this._listeners[name] = handler; } });
  const nodes = {
    '#linkStatus': element(),
    '#deviceLinkForm': element(),
    '#deviceUserCode': element(),
    '#approveDevice': element(),
    '#signInHint': element(),
  };
  nodes['#signInHint'].hidden = true;

  function respond(path, method) {
    if (path === '/api/auth/device/approve') return responses['/api/auth/device/approve'] || { ok: true, status: 200, body: { ok: true } };
    return responses[path] || { ok: false, status: 404, body: { error: 'not found' } };
  }

  const context = {
    URLSearchParams,
    location: { search },
    console,
    setTimeout,
    document: {
      querySelector(selector) { return nodes[selector] || null; },
    },
    async fetch(url, options = {}) {
      const method = String(options.method || 'GET').toUpperCase();
      fetchCalls.push({ url, method, headers: options.headers || {}, body: options.body, credentials: options.credentials });
      const canned = respond(url, method);
      return { ok: canned.ok, status: canned.status, async json() { return canned.body; } };
    },
  };
  context.window = context;
  context.setResponse = (path, value) => { responses[path] = value; };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, nodes, fetchCalls };
}

test('the link page prefills the code and greets a signed-in cloud-sync owner', async () => {
  const { nodes } = harness({ search: '?code=abcd-efgh' });
  await flush();
  assert.equal(nodes['#deviceUserCode'].value, 'ABCD-EFGH');
  assert.match(nodes['#linkStatus'].textContent, /Signed in as owner@example\.test/);
});

test('approving posts the normalized code with the CSRF marker and same-origin credentials', async () => {
  const { context, nodes, fetchCalls } = harness();
  await flush();
  const result = await context.window.MedicationDeviceLink.approve('  abcd efgh ');
  assert.equal(result, true);
  const approve = fetchCalls.find(call => call.url === '/api/auth/device/approve');
  assert.ok(approve, 'approve endpoint was called');
  assert.equal(approve.method, 'POST');
  assert.equal(approve.credentials, 'same-origin');
  assert.equal(approve.headers['X-Medication-CSRF'], '1');
  assert.deepEqual(JSON.parse(approve.body), { userCode: 'ABCD-EFGH' });
  assert.match(nodes['#linkStatus'].textContent, /approved/i);
  assert.equal(nodes['#deviceLinkForm'].hidden, true);
});

test('an invalid or expired code shows a recoverable message and does not hide the form', async () => {
  const h = harness();
  await flush();
  h.context.setResponse('/api/auth/device/approve', { ok: false, status: 404, body: { error: 'gone' } });
  const result = await h.context.window.MedicationDeviceLink.approve('ZZZZ-ZZZZ');
  assert.equal(result, false);
  assert.match(h.nodes['#linkStatus'].textContent, /invalid, already used, or expired/i);
  assert.equal(h.nodes['#deviceLinkForm'].hidden, false);
});

test('a malformed code is rejected client-side without calling the server', async () => {
  const { context, fetchCalls } = harness();
  await flush();
  const before = fetchCalls.length;
  const result = await context.window.MedicationDeviceLink.approve('nope');
  assert.equal(result, false);
  assert.equal(fetchCalls.length, before, 'no approve request is sent for a malformed code');
});

test('a signed-out visitor is told to sign in first and shown the hint', async () => {
  const { nodes } = harness({ me: { ok: false, status: 401, body: { error: 'Sign-in required.' } } });
  await flush();
  assert.match(nodes['#linkStatus'].textContent, /sign in on the app first/i);
  assert.equal(nodes['#signInHint'].hidden, false);
});
