(() => {
  'use strict';

  const LOCAL_MODE_KEY = 'medication-reminder-access-mode-v1';
  const SYNC_KEY = 'medication-reminder-sync-v1';
  const PRIVACY_ERROR = 'For privacy, this pairing link could not be opened safely. Remove it from the address bar and reload.';
  const BASE64URL_ID = /^[A-Za-z0-9_-]{16,128}$/;
  const LEGACY_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
  const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;
  const dialog = document.querySelector('#accessDialog');
  const shell = document.querySelector('#applicationShell');
  const localButton = document.querySelector('#continueLocally');
  const status = document.querySelector('#accessStatus');
  const installed = matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  const mobile = Boolean(navigator.userAgentData?.mobile)
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let mode = 'pending';
  let account = null;
  let ready = false;
  let pendingPair = '';
  let privacyBlocked = false;
  let pairingFragment = location.hash.startsWith('#pair=') ? location.hash : '';

  if (pairingFragment) {
    const cleanUrl = `${location.pathname}${location.search}`;
    let historyScrubbed = false;
    try {
      history.replaceState(null, '', cleanUrl);
      historyScrubbed = location.hash === '';
    } catch {
      historyScrubbed = false;
    }

    if (historyScrubbed) {
      pendingPair = pairingFragment;
    } else {
      privacyBlocked = true;
      try {
        location.replace(cleanUrl);
      } catch {
        window.stop?.();
      }
    }
    pairingFragment = '';
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function removeStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in restricted browser profiles.
    }
  }

  function storedMobilePair() {
    try {
      const value = JSON.parse(readStorage(SYNC_KEY) || 'null');
      const common = value?.role === 'mobile'
        && value.claimed === true
        && BASE64URL_ID.test(value.pairId || '')
        && BASE64URL_ID.test(value.deviceId || '')
        && BASE64URL_32_BYTES.test(value.encryptionKey || '')
        && Number.isInteger(value.revision)
        && value.revision > 0;
      if (!common) return false;
      if (value.version === 1) {
        return !Object.hasOwn(value, 'mobileToken')
          && LEGACY_TOKEN.test(value.token || '');
      }
      if (value.version === 2) {
        return !Object.hasOwn(value, 'token')
          && BASE64URL_32_BYTES.test(value.mobileToken || '');
      }
      return false;
    } catch {
      return false;
    }
  }

  function setStatus(message = '') {
    if (status) status.textContent = message;
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('medication-access-ready', {
      detail: { mode, account },
    }));
  }

  function unlock(nextMode, nextAccount = null) {
    if (privacyBlocked) throw Error('The privacy lock could not be released safely.');
    mode = nextMode;
    account = nextAccount;
    ready = true;
    setStatus('');
    if (shell) shell.hidden = false;
    document.documentElement.classList.remove('access-pending');
    if (dialog?.open) dialog.close();
    emit();
  }

  function focusChoice() {
    queueMicrotask(() => localButton?.focus());
  }

  function showChoice(message = '') {
    mode = 'pending';
    account = null;
    ready = false;
    if (shell) shell.hidden = true;
    if (localButton) localButton.disabled = privacyBlocked;
    setStatus(privacyBlocked ? PRIVACY_ERROR : message);
    document.documentElement.classList.add('access-pending');
    if (dialog && !dialog.open) dialog.showModal();
    focusChoice();
  }

  function chooseLocal() {
    if (privacyBlocked) {
      showChoice();
      return false;
    }
    if (!writeStorage(LOCAL_MODE_KEY, 'local')) {
      showChoice('This browser could not remember your local-only choice. Check its storage settings and try again.');
      return false;
    }
    unlock('local');
    return true;
  }

  function resolveAccount(value) {
    if (privacyBlocked) throw Error('The privacy lock could not be released safely.');
    if (!value?.user) throw Error('A verified account is required.');
    removeStorage(LOCAL_MODE_KEY);
    unlock('account', value);
  }

  function resolveSignedOut(message = '') {
    if (privacyBlocked) {
      showChoice();
      return;
    }
    if (installed && mobile && storedMobilePair()) {
      unlock('paired-mobile');
      return;
    }
    if (readStorage(LOCAL_MODE_KEY) === 'local') {
      unlock('local');
      return;
    }
    showChoice(message);
  }

  function resolvePairedMobile() {
    if (privacyBlocked) throw Error('The privacy lock could not be released safely.');
    if (!installed || !mobile || !storedMobilePair()) {
      throw Error('A claimed mobile pairing is required.');
    }
    unlock('paired-mobile');
  }

  function requireCloud() {
    if (mode !== 'account' || !account?.user) {
      throw Error('Sign in with Google before using cloud pairing.');
    }
    if (!account.features?.cloudSync) {
      throw Error('Cloud device sync is not enabled for this account.');
    }
    return true;
  }

  if (localButton) localButton.onclick = chooseLocal;
  dialog?.addEventListener('cancel', event => {
    if (mode !== 'pending') return;
    event.preventDefault();
    focusChoice();
  });
  dialog?.addEventListener('click', event => {
    if (mode === 'pending' && event.target === dialog) focusChoice();
  });

  window.MedicationAccess = {
    get mode() { return mode; },
    get ready() { return ready; },
    get signedIn() { return mode === 'account'; },
    get cloudSync() { return Boolean(account?.features?.cloudSync); },
    pendingInvitation() { return pendingPair; },
    consumePendingInvitation() {
      const value = pendingPair;
      pendingPair = '';
      return value;
    },
    resolveAccount,
    resolveSignedOut,
    resolvePairedMobile,
    chooseLocal,
    requireCloud,
    showChoice,
  };

  if (privacyBlocked) {
    showChoice();
  } else if (installed && mobile && storedMobilePair()) {
    unlock('paired-mobile');
  } else if (readStorage(LOCAL_MODE_KEY) === 'local') {
    unlock('local');
  } else {
    showChoice();
  }
})();
