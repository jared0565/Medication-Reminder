const CACHE_PREFIX = 'medication-reminder-web-';
const CACHE = 'medication-reminder-web-v26';
const SHELL_CACHE_KEY = new URL('/', self.location.origin).href;
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=20260723.17',
  './access.js?v=20260723.17',
  './qrcode.js?v=20260723.17',
  './due-modal.js?v=20260723.17',
  './app.js?v=20260723.17',
  './update.js?v=20260723.17',
  './account.js?v=20260723.17',
  './sync.js?v=20260723.17',
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

self.addEventListener('push', event => {
  let data = {
    title: 'Medication Reminder',
    body: 'A scheduled reminder is due.',
  };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  const tagTime = String(data.tag || '').match(/^medication-(\d+)$/)?.[1];
  const dueAt = Number(data.dueAt || tagTime) || 0;
  const url = data.url || (dueAt ? `/?dueAt=${dueAt}` : '/');
  const notification = self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag || 'medication-reminder',
    data: { url },
  });
  const notifyClients = data.type === 'pair-revoked'
    ? self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => list.forEach(client => client.postMessage({ type: 'PAIR_REVOKED' })))
    : Promise.resolve();
  event.waitUntil(Promise.all([notification, notifyClients]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(client => new URL(client.url).origin === self.location.origin);
      return existing
        ? (existing.focus(), existing.navigate(url))
        : clients.openWindow(url);
    }),
  );
});
