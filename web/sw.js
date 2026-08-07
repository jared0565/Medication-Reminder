const CACHE_PREFIX = 'medication-reminder-web-';
const CACHE = 'medication-reminder-web-v31';
const SHELL_CACHE_KEY = new URL('/', self.location.origin).href;
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=20260807.2',
  './access.js?v=20260807.2',
  './qrcode.js?v=20260807.2',
  './due-modal.js?v=20260807.2',
  './app.js?v=20260807.2',
  './update.js?v=20260807.2',
  './account.js?v=20260807.2',
  './sync.js?v=20260807.2',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isCacheableShellResponse(response) {
  if (!response?.ok || response.status !== 200 || response.type !== 'basic' || response.redirected) {
    return false;
  }
  let finalUrl;
  try {
    finalUrl = new URL(response.url);
  } catch {
    return false;
  }
  return finalUrl.origin === self.location.origin
    && ['/', '/index.html'].includes(finalUrl.pathname);
}

function handleShellNavigation(event) {
  const networkResponse = fetch(event.request);
  const cacheUpdate = networkResponse.then(async response => {
    if (!isCacheableShellResponse(response)) return;
    const cache = await caches.open(CACHE);
    await cache.put(SHELL_CACHE_KEY, response.clone());
  });
  event.waitUntil(cacheUpdate.catch(() => undefined));
  event.respondWith(
    networkResponse.catch(async error => {
      const cached = await caches.match(SHELL_CACHE_KEY);
      if (cached) return cached;
      throw error;
    }),
  );
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const isPrivateApi = sameOrigin
    && (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/'));
  const isReleaseManifest = sameOrigin && requestUrl.pathname === '/version.json';
  if (isPrivateApi || isReleaseManifest) {
    event.respondWith(fetch(event.request));
    return;
  }

  const isShellNavigation = sameOrigin
    && event.request.mode === 'navigate'
    && ['/', '/index.html'].includes(requestUrl.pathname);
  if (isShellNavigation) {
    handleShellNavigation(event);
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request)),
  );
});

function sameOriginPath(candidate, fallback = '/') {
  if (typeof candidate !== 'string' || !candidate) return fallback;
  let resolved;
  try {
    resolved = new URL(candidate, self.location.origin);
  } catch {
    return fallback;
  }
  if (resolved.origin !== self.location.origin) return fallback;
  return `${resolved.pathname}${resolved.search}${resolved.hash}` || fallback;
}

self.addEventListener('push', async function pushHandler(event) {
  let data = {
    title: 'Medication Reminder',
    body: 'A scheduled reminder is due.',
  };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  const tagTime = String(data.tag || '').match(/^medication-(\d+)$/)?.[1];
  const dueAt = Number(data.dueAt || tagTime) || 0;
  const url = sameOriginPath(data.url || (dueAt ? `/?dueAt=${dueAt}` : '/'));

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = list.some(client => client.visibilityState === 'visible');

    // Every push is a chance for the app to converge before it acts. Without this
    // a reminder can alarm for a dose that was already taken on the other device.
    for (const client of list) client.postMessage({ type: 'SYNC_NOW' });
    if (data.type === 'pair-revoked') {
      for (const client of list) client.postMessage({ type: 'PAIR_REVOKED' });
    }

    // A dose update is informational, so it must not interrupt someone already
    // looking at the app — the SYNC_NOW above is all that is needed then. When
    // nothing is visible there is no other way to deliver it, and userVisibleOnly
    // requires a notification anyway.
    if (data.type === 'dose-update' && visible) return;

    await self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || 'medication-reminder',
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = sameOriginPath(event.notification.data?.url || '/');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(client => new URL(client.url).origin === self.location.origin);
      return existing
        ? (existing.focus(), existing.navigate(url))
        : clients.openWindow(url);
    }),
  );
});
