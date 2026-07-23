import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ACCESS_KEY = 'medication-reminder-access-mode-v1';
const SYNC_KEY = 'medication-reminder-sync-v1';

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
  };
}

function harness({
  hash = '',
  installedMobile = false,
  localMode = false,
  mobileCredentials = false,
  mobileCredential = null,
  historyReplaceThrows = false,
  locationReplaceThrows = false,
  storageGetThrows = false,
  storageSetThrows = false,
} = {}) {
  const storage = new Map();
  if (localMode) storage.set(ACCESS_KEY, 'local');
  const storedCredential = mobileCredential || (mobileCredentials
    ? {
      version: 2,
      role: 'mobile',
      pairId: 'p'.repeat(32),
      mobileToken: 'm'.repeat(43),
      encryptionKey: 'e'.repeat(43),
      deviceId: 'd'.repeat(32),
      revision: 1,
      claimed: true,
    }
    : null);
  if (storedCredential) storage.set(SYNC_KEY, JSON.stringify(storedCredential));

  const rootClasses = classList(['access-pending']);
  const shell = { hidden: true };
  const localButton = {
    onclick: null,
    disabled: false,
    focusCount: 0,
    focus() { this.focusCount += 1; },
  };
  const accessStatus = { textContent: '' };
  const dialog = {
    open: false,
    listeners: new Map(),
    showModal() { this.open = true; },
    close() { this.open = false; },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    dispatch(name, event = {}) { this.listeners.get(name)?.(event); },
  };
  const elements = new Map([
    ['#accessDialog', dialog],
    ['#applicationShell', shell],
    ['#continueLocally', localButton],
    ['#accessStatus', accessStatus],
  ]);
  const location = {
    hash,
    pathname: '/reminders',
    search: '?from=test',
    replaceCalls: [],
    replace(url) {
      this.replaceCalls.push(url);
      if (locationReplaceThrows) throw Error('location replacement unavailable');
      this.hash = '';
    },
  };
  const historyCalls = [];
  const events = [];
  let stopCount = 0;
  const window = {
    dispatchEvent(event) { events.push(event); return true; },
    stop() { stopCount += 1; },
  };
  window.window = window;

  const context = {
    window,
    document: {
      documentElement: { classList: rootClasses },
      querySelector(selector) { return elements.get(selector) || null; },
    },
    navigator: {
      standalone: installedMobile,
      userAgent: installedMobile
        ? 'Mozilla/5.0 (Linux; Android 15)'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      userAgentData: { mobile: installedMobile },
    },
    location,
    history: {
      replaceState(state, title, url) {
        historyCalls.push({ state, title, url });
        if (historyReplaceThrows) throw Error('history replacement unavailable');
        location.hash = '';
      },
    },
    localStorage: {
      getItem(key) {
        if (storageGetThrows) throw Error('storage unavailable');
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        if (storageSetThrows) throw Error('storage unavailable');
        storage.set(key, String(value));
      },
      removeItem(key) { storage.delete(key); },
    },
    matchMedia: () => ({ matches: installedMobile }),
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    queueMicrotask(callback) { callback(); },
    console,
  };

  vm.runInNewContext(readFileSync('web/access.js', 'utf8'), context);

  return {
    window,
    document: context.document,
    dialog,
    localButton,
    shell,
    accessStatus,
    storage,
    location,
    historyCalls,
    events,
    stopCount: () => stopCount,
  };
}

test('new browser stays privacy locked until a choice is made', () => {
  const app = harness();
  assert.equal(app.document.documentElement.classList.contains('access-pending'), true);
  assert.equal(app.shell.hidden, true);
  assert.equal(app.dialog.open, true);
  assert.equal(app.window.MedicationAccess.mode, 'pending');
  assert.equal(app.window.MedicationAccess.ready, false);
});

test('continue locally unlocks without cloud capability', async () => {
  const app = harness();
  await app.localButton.onclick();
  assert.equal(app.storage.get(ACCESS_KEY), 'local');
  assert.equal(app.window.MedicationAccess.mode, 'local');
  assert.equal(app.window.MedicationAccess.cloudSync, false);
  assert.equal(app.document.documentElement.classList.contains('access-pending'), false);
  assert.equal(app.shell.hidden, false);
});

test('remembered local choice is restored without becoming account mode', () => {
  const app = harness({ localMode: true });
  assert.equal(app.window.MedicationAccess.mode, 'local');
  assert.equal(app.window.MedicationAccess.signedIn, false);
  assert.equal(app.dialog.open, false);
});

test('installed paired mobile bypasses Google gate', () => {
  const app = harness({ installedMobile: true, mobileCredentials: true });
  assert.equal(app.window.MedicationAccess.mode, 'paired-mobile');
  assert.equal(app.dialog.open, false);
  assert.equal(app.shell.hidden, false);
});

test('only exact valid legacy v1 and scoped v2 mobile credentials unlock', () => {
  const common = {
    role: 'mobile',
    pairId: 'p'.repeat(32),
    encryptionKey: 'e'.repeat(43),
    deviceId: 'd'.repeat(32),
    revision: 1,
    claimed: true,
  };
  const valid = [
    { ...common, version: 1, token: 't'.repeat(43) },
    { ...common, version: 2, mobileToken: 'm'.repeat(43) },
  ];
  for (const credential of valid) {
    const app = harness({ installedMobile: true, mobileCredential: credential });
    assert.equal(app.window.MedicationAccess.mode, 'paired-mobile');
  }

  const invalid = [
    {},
    { ...common, version: 999, token: 't'.repeat(43) },
    { ...common, version: 1, token: '' },
    { ...common, version: 1, token: 'not valid!' },
    { ...common, version: 2, mobileToken: 'm'.repeat(42) },
    { ...common, version: 2, mobileToken: 'not valid!' },
    { ...common, version: 2, mobileToken: 'm'.repeat(43), pairId: '' },
    { ...common, version: 2, mobileToken: 'm'.repeat(43), deviceId: 'short' },
    { ...common, version: 2, mobileToken: 'm'.repeat(43), encryptionKey: 'e'.repeat(42) },
    { ...common, version: 2, mobileToken: 'm'.repeat(43), revision: 0 },
    { ...common, version: 2, mobileToken: 'm'.repeat(43), claimed: false },
    { ...common, version: 2, mobileToken: 'm'.repeat(43), role: 'source' },
  ];
  for (const credential of invalid) {
    const app = harness({ installedMobile: true, mobileCredential: credential });
    assert.equal(app.window.MedicationAccess.mode, 'pending');
    assert.equal(app.shell.hidden, true);
  }
});

test('an installed mobile invitation alone remains privacy locked', () => {
  const app = harness({ installedMobile: true, hash: '#pair=private-fragment' });
  assert.equal(app.window.MedicationAccess.mode, 'pending');
  assert.equal(app.dialog.open, true);
});

test('desktop pairing fragment is scrubbed and held only in module memory', () => {
  const app = harness({ hash: '#pair=private-fragment' });
  assert.equal(app.location.hash, '');
  assert.equal(app.historyCalls[0].url, '/reminders?from=test');
  assert.equal(app.window.MedicationAccess.pendingInvitation(), '#pair=private-fragment');
  assert.equal(app.storage.has('medication-reminder-pending-pair-v1'), false);
  for (const value of app.storage.values()) {
    assert.doesNotMatch(value, /private-fragment/);
  }
});

test('pending invitation consumption is one-use and never enters events', () => {
  const app = harness({ hash: '#pair=private-fragment' });
  assert.equal(app.window.MedicationAccess.consumePendingInvitation(), '#pair=private-fragment');
  assert.equal(app.window.MedicationAccess.consumePendingInvitation(), '');
  assert.equal(app.window.MedicationAccess.pendingInvitation(), '');
  assert.equal(JSON.stringify(app.events).includes('private-fragment'), false);
});

test('history scrub failure uses clean location replacement and remains fail closed', () => {
  const app = harness({
    hash: '#pair=private-fragment',
    historyReplaceThrows: true,
  });
  assert.deepEqual(app.location.replaceCalls, ['/reminders?from=test']);
  assert.equal(app.window.MedicationAccess.pendingInvitation(), '');
  assert.equal(app.window.MedicationAccess.mode, 'pending');
  assert.equal(app.shell.hidden, true);
  assert.equal(app.localButton.disabled, true);
  assert.doesNotMatch(app.accessStatus.textContent, /private-fragment/);
  assert.equal(JSON.stringify(app.events).includes('private-fragment'), false);
});

test('complete URL scrub failure stops loading and cannot be unlocked', () => {
  const app = harness({
    hash: '#pair=private-fragment',
    historyReplaceThrows: true,
    locationReplaceThrows: true,
  });
  assert.equal(app.stopCount(), 1);
  assert.equal(app.location.hash, '#pair=private-fragment');
  assert.equal(app.window.MedicationAccess.pendingInvitation(), '');
  assert.equal(app.window.MedicationAccess.chooseLocal(), false);
  assert.throws(
    () => app.window.MedicationAccess.resolveAccount({ user: { user_id: 'user_123' } }),
    /privacy/i,
  );
  assert.equal(app.shell.hidden, true);
  assert.doesNotMatch(app.accessStatus.textContent, /private-fragment/);
});

test('throwing local storage remains locked and reports a generic local-mode error', () => {
  const app = harness({ storageGetThrows: true, storageSetThrows: true });
  assert.equal(app.window.MedicationAccess.mode, 'pending');
  assert.equal(app.window.MedicationAccess.chooseLocal(), false);
  assert.equal(app.shell.hidden, true);
  assert.match(app.accessStatus.textContent, /could not remember/i);
});

test('privacy dialog cannot be dismissed with escape or its backdrop', () => {
  const app = harness();
  let escapePrevented = false;
  app.dialog.dispatch('cancel', {
    preventDefault() { escapePrevented = true; },
  });
  app.dialog.dispatch('click', { target: app.dialog });
  assert.equal(escapePrevented, true);
  assert.equal(app.dialog.open, true);
  assert.ok(app.localButton.focusCount >= 2);
});

test('account resolution emits a safe access event and enables entitled cloud use', () => {
  const app = harness();
  const account = {
    user: { user_id: 'user_123', display_name: 'Example' },
    features: { cloudSync: true },
  };
  app.window.MedicationAccess.resolveAccount(account);
  assert.equal(app.window.MedicationAccess.mode, 'account');
  assert.equal(app.window.MedicationAccess.requireCloud(), true);
  assert.equal(app.storage.has(ACCESS_KEY), false);
  const event = app.events.at(-1);
  assert.equal(event.type, 'medication-access-ready');
  assert.equal(event.detail.mode, 'account');
  assert.equal(event.detail.account, account);
  assert.equal(JSON.stringify(event.detail).includes('private-fragment'), false);
});

test('cloud operations reject local mode with a safe status message', () => {
  const app = harness({ localMode: true });
  assert.throws(
    () => app.window.MedicationAccess.requireCloud(),
    /Sign in with Google/,
  );
  app.window.MedicationAccess.showChoice('Account access is temporarily unavailable.');
  assert.equal(app.accessStatus.textContent, 'Account access is temporarily unavailable.');
  assert.equal(app.dialog.open, true);
  assert.equal(app.shell.hidden, true);
});

test('access API remains stable for account and sync integrations', () => {
  const app = harness();
  for (const method of [
    'pendingInvitation',
    'consumePendingInvitation',
    'resolveAccount',
    'resolveSignedOut',
    'resolvePairedMobile',
    'chooseLocal',
    'requireCloud',
    'showChoice',
  ]) {
    assert.equal(typeof app.window.MedicationAccess[method], 'function', method);
  }
  assert.equal(typeof app.window.MedicationAccess.mode, 'string');
  assert.equal(typeof app.window.MedicationAccess.ready, 'boolean');
  assert.equal(typeof app.window.MedicationAccess.signedIn, 'boolean');
  assert.equal(typeof app.window.MedicationAccess.cloudSync, 'boolean');
});

test('privacy-lock markup is present before medication content', () => {
  const html = readFileSync('web/index.html', 'utf8');
  const css = readFileSync('web/styles.css', 'utf8');
  const source = readFileSync('web/access.js', 'utf8');
  const firstScript = html.indexOf('<script ');
  const accessScript = html.indexOf('access.js');
  assert.match(html, /<html[^>]*class="access-pending"/);
  assert.ok(html.indexOf('id="accessDialog"') < html.indexOf('class="shell"'));
  assert.match(
    html,
    /<div id="applicationShell" hidden>[\s\S]*class="shell"[\s\S]*id="dueDialog"[\s\S]*<\/div>\s*<script src="access\.js/,
  );
  assert.match(html, /id="accessStatus"[^>]*role="status"/);
  assert.ok(html.indexOf('class="access-pending"') < firstScript);
  assert.ok(html.indexOf('styles.css') < firstScript);
  assert.match(css, /\.access-pending \.shell[^{}]*\{[^{}]*visibility:hidden/);
  assert.equal(source.match(/shell\.hidden = false/g)?.length, 1);
  assert.doesNotMatch(source, /sessionStorage|console\./);
  for (const dependent of ['app.js', 'update.js', 'account.js', 'sync.js']) {
    assert.ok(
      accessScript < html.indexOf(dependent),
      `access.js must execute before ${dependent}`,
    );
  }
});

test('PWA loads access control before every application client', () => {
  const html = readFileSync('web/index.html', 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(scripts[0], 'access.js?v=20260723.17');
  for (const dependent of ['app.js', 'update.js', 'account.js', 'sync.js']) {
    assert.ok(
      scripts.findIndex(value => value.startsWith(`${dependent}?`)) > 0,
      `access.js must execute before ${dependent}`,
    );
  }
  assert.match(html, /<html[^>]*class="access-pending"/);
  assert.match(html, /<div id="applicationShell" hidden>/);
});

test('browser APIs are same-origin and push payloads stay generic', () => {
  for (const file of ['web/account.js', 'web/app.js', 'web/sync.js']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /https?:\/\/[^'"]*workers\.dev/i, file);
  }

  const app = readFileSync('web/app.js', 'utf8');
  assert.match(app, /const pushApi='\/api'/);
  assert.match(app, /credentials:'same-origin'/);
  assert.match(app, /'X-Medication-CSRF':'1'/);
  assert.match(app, /title:'Medication reminder due'/);
  assert.match(app, /body:'Open Medication Reminder to view the scheduled medicines\.'/);
});

test('release metadata and every versioned PWA asset are coherent', () => {
  const html = readFileSync('web/index.html', 'utf8');
  const serviceWorker = readFileSync('web/sw.js', 'utf8');
  const release = JSON.parse(readFileSync('web/version.json', 'utf8'));
  const expectedAssets = [
    'styles.css',
    'access.js',
    'qrcode.js',
    'due-modal.js',
    'app.js',
    'update.js',
    'account.js',
    'sync.js',
  ];

  assert.equal(release.version, '2026.07.23.17');
  assert.match(html, /Medication Reminder v2026\.07\.23\.17/);
  assert.match(html, /id="appVersion">2026\.07\.23\.17</);
  assert.match(serviceWorker, /medication-reminder-web-v26/);
  for (const asset of expectedAssets) {
    assert.match(html, new RegExp(`${asset.replace('.', '\\.')}\\?v=20260723\\.17`), asset);
    assert.match(serviceWorker, new RegExp(`\\./${asset.replace('.', '\\.')}\\?v=20260723\\.17`), asset);
  }
  assert.doesNotMatch(`${html}\n${serviceWorker}`, /20260723\.(?!17)\d+/);
});

test('Pages headers keep API and release responses private with a narrow CSP', () => {
  const headers = readFileSync('web/_headers', 'utf8');
  const csp = headers.match(/Content-Security-Policy: ([^\r\n]+)/)?.[1] || '';

  assert.match(headers, /\/version\.json\s+Cache-Control: no-cache, no-store, must-revalidate/);
  assert.doesNotMatch(headers, /^\/api\/\*/m);
  assert.doesNotMatch(headers, /\/\*\s+Cache-Control:/);
  assert.match(csp, /connect-src 'self' https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /img-src 'self' data: https:\/\/lh3\.googleusercontent\.com/);
  assert.doesNotMatch(csp, /workers\.dev|\*/);
});

test('Pages cache rules are explicit and non-conflicting for every application path', () => {
  const headers = readFileSync('web/_headers', 'utf8');
  const rules = headers.trim().split(/\r?\n(?=\/)/).map(block => {
    const [pattern, ...lines] = block.split(/\r?\n/);
    return {
      pattern,
      cache: lines
        .map(line => line.match(/^\s+Cache-Control:\s*(.+)$/)?.[1])
        .filter(Boolean),
    };
  });
  const catchAll = rules.find(rule => rule.pattern === '/*');
  assert.deepEqual(catchAll?.cache, []);

  for (const path of [
    '/',
    '/index.html',
    '/sw.js',
    '/version.json',
    '/styles.css',
    '/access.js',
    '/qrcode.js',
    '/due-modal.js',
    '/app.js',
    '/update.js',
    '/account.js',
    '/sync.js',
  ]) {
    const exact = rules.filter(rule => rule.pattern === path);
    assert.equal(exact.length, 1, `${path} must have one exact header rule`);
    assert.equal(exact[0].cache.length, 1, `${path} must have one Cache-Control value`);
  }
});
