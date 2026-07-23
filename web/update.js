(() => {
  'use strict';

  const checkButton = document.querySelector('#checkUpdates');
  const versionElement = document.querySelector('#appVersion');
  const currentVersion = versionElement?.textContent?.trim() || 'unknown';
  let registration = null;
  let latestVersion = currentVersion;
  let declinedVersion = '';
  let prompting = false;
  let refreshing = false;
  let checkInProgress = false;
  const offeredWorkers = new WeakSet();

  function offerUpdate(worker, version = latestVersion, force = false) {
    if (!worker || prompting || offeredWorkers.has(worker)
      || (!force && declinedVersion === version)) return false;
    offeredWorkers.add(worker);
    prompting = true;
    const accepted = confirm(`Medication Reminder ${version} is available.\n\nUpdate now?`);
    prompting = false;
    if (!accepted) {
      declinedVersion = version;
      return false;
    }
    declinedVersion = '';
    worker.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  async function fetchRelease() {
    const response = await fetch(`version.json?check=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Release check failed with status ${response.status}`);
    const release = await response.json();
    if (!release || typeof release.version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(release.version)) {
      throw new Error('Cloudflare returned an invalid release manifest');
    }
    return release.version;
  }

  async function checkForUpdate({ manual = false } = {}) {
    if (!registration || checkInProgress) return false;
    checkInProgress = true;
    try {
      latestVersion = await fetchRelease();
      if (latestVersion === currentVersion) {
        if (manual) alert('Medication Reminder is up to date.');
        return false;
      }
      await registration.update();
      if (registration.waiting) return offerUpdate(registration.waiting, latestVersion, manual);
      return true;
    } catch (error) {
      console.warn('Application update check failed', error);
      if (manual) alert('Could not check for updates. Check your connection and try again.');
      return false;
    } finally {
      checkInProgress = false;
    }
  }

  if (!('serviceWorker' in navigator)) {
    if (checkButton) checkButton.disabled = true;
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  navigator.serviceWorker.register('sw.js').then(async value => {
    registration = value;

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          offerUpdate(worker, latestVersion);
        }
      });
    });

    if (checkButton) {
      checkButton.onclick = async () => {
        const original = checkButton.textContent;
        checkButton.disabled = true;
        checkButton.textContent = 'Checking…';
        try {
          await checkForUpdate({ manual: true });
        } finally {
          checkButton.disabled = false;
          checkButton.textContent = original;
        }
      };
    }

    await checkForUpdate();
    window.addEventListener('focus', () => void checkForUpdate());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    }, 60_000);
  }).catch(error => {
    console.warn('Service worker registration failed', error);
    if (checkButton) checkButton.disabled = true;
  });
})();
