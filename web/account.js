(() => {
  'use strict';

  const API = '/api';
  const DEVICE_KEY = 'medication-reminder-account-device-v1';
  const SERVICE_UNAVAILABLE = 'Account service is temporarily unavailable. You can continue on this device.';
  const GOOGLE_UNAVAILABLE = 'Google Sign-In is temporarily unavailable. You can continue on this device.';
  const elements = {
    status: document.querySelector('#accountStatus'),
    googleTargets: [
      document.querySelector('#accessGoogleSignIn'),
      document.querySelector('#googleSignIn'),
    ].filter(Boolean),
    signedIn: document.querySelector('#signedInAccount'),
    identity: document.querySelector('#accountIdentity'),
    plan: document.querySelector('#accountPlan'),
    start: document.querySelector('#usageStartDate'),
    end: document.querySelector('#usageEndDate'),
    save: document.querySelector('#saveUsagePeriod'),
    signOut: document.querySelector('#signOut'),
    signOutDialog: document.querySelector('#signOutDialog'),
  };

  let account = null;
  let clientId = '';
  let deviceId = crypto.randomUUID();
  let authEpoch = 0;
  let googleInitializedFor = '';
  let googleLoadPromise = null;
  let signInPromise = null;
  let signOutPromise = null;
  let accessDecisionGeneration = 0;

  window.addEventListener('medication-access-ready', () => {
    accessDecisionGeneration += 1;
  });

  try {
    const storedDeviceId = localStorage.getItem(DEVICE_KEY);
    if (typeof storedDeviceId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storedDeviceId)) {
      deviceId = storedDeviceId;
    } else {
      localStorage.setItem(DEVICE_KEY, deviceId);
    }
  } catch {
    // A transient device identifier is safe when storage is restricted.
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      'Content-Type': 'application/json',
      ...(!['GET', 'HEAD'].includes(method) ? { 'X-Medication-CSRF': '1' } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(`${API}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      // Safe generic errors below cover non-JSON upstream failures.
    }
    if (!response.ok) {
      const error = Error(body.error || `Account request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function setAccountStatus(message) {
    if (elements.status) elements.status.textContent = message;
  }

  function validAccountView(value) {
    return Boolean(value?.user
      && typeof value.user.name === 'string'
      && typeof value.user.email === 'string');
  }

  function accessDecisionSnapshot() {
    return {
      generation: accessDecisionGeneration,
      mode: window.MedicationAccess.mode,
    };
  }

  function accessDecisionIsCurrent(snapshot) {
    return snapshot.generation === accessDecisionGeneration
      && snapshot.mode === window.MedicationAccess.mode;
  }

  function remainSignedOut(message = '') {
    account = null;
    setAccountStatus(message);
    render();
    if (clientId) void loadGoogleLibrary();
  }

  function emitAccountChanged() {
    window.dispatchEvent(new CustomEvent('medication-account-changed', {
      detail: account,
    }));
  }

  function render() {
    const signedIn = Boolean(account?.user);
    for (const target of elements.googleTargets) target.hidden = signedIn;
    if (elements.signedIn) elements.signedIn.hidden = !signedIn;
    if (elements.plan) elements.plan.hidden = !signedIn;

    if (!signedIn) {
      if (elements.identity) elements.identity.textContent = '';
      if (elements.start) elements.start.value = '';
      if (elements.end) elements.end.value = '';
      if (!elements.status?.textContent) {
        setAccountStatus(clientId
          ? 'Sign in to keep eligible cloud features tied to your account. Your schedule stays local unless you pair a device.'
          : GOOGLE_UNAVAILABLE);
      }
      emitAccountChanged();
      return;
    }

    if (elements.identity) {
      elements.identity.textContent = `${account.user.name} · ${account.user.email}`;
    }
    if (elements.plan) {
      elements.plan.textContent = account.plan === 'advanced' ? 'Advanced access' : 'Free access';
      elements.plan.className = `plan-badge ${account.plan === 'advanced' ? 'is-advanced' : ''}`;
    }
    if (elements.start) elements.start.value = account.user.intendedStartDate || '';
    if (elements.end) elements.end.value = account.user.intendedEndDate || '';
    setAccountStatus('Signed in securely. Medication details remain encrypted during paired-device sync.');
    emitAccountChanged();
  }

  function renderGoogleButtons() {
    const identity = window.google?.accounts?.id;
    if (!clientId || !identity || account) return false;
    if (googleInitializedFor !== clientId) {
      identity.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
        ux_mode: 'popup',
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleInitializedFor = clientId;
    }
    for (const target of elements.googleTargets) {
      target.replaceChildren();
      identity.renderButton(target, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        logo_alignment: 'left',
      });
    }
    return true;
  }

  function identityLoadFailed() {
    googleLoadPromise = null;
    setAccountStatus('Google Sign-In could not load. Check the connection or continue on this device.');
    window.MedicationAccess.resolveSignedOut(
      'Google Sign-In could not load. Check the connection or continue on this device.',
    );
  }

  function loadGoogleLibrary() {
    if (!clientId || account) return Promise.resolve(false);
    if (renderGoogleButtons()) return Promise.resolve(true);
    if (googleLoadPromise) return googleLoadPromise;

    googleLoadPromise = new Promise(resolve => {
      const script = document.querySelector('#googleIdentityScript')
        || document.createElement('script');
      let settled = false;
      const finish = loaded => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!loaded || !renderGoogleButtons()) {
          identityLoadFailed();
          resolve(false);
          return;
        }
        resolve(true);
      };
      const timeout = setTimeout(() => finish(false), 15_000);
      script.id = 'googleIdentityScript';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      if (!script.parentNode) document.head.append(script);
    });
    return googleLoadPromise;
  }

  async function handleGoogleCredential(result) {
    if (account || signInPromise || typeof result?.credential !== 'string' || !result.credential) {
      return signInPromise || false;
    }
    const decision = accessDecisionSnapshot();
    const epoch = ++authEpoch;
    setAccountStatus('Verifying your Google account…');
    const attempt = (async () => {
      try {
        const installed = matchMedia('(display-mode: standalone)').matches
          || navigator.standalone === true;
        const response = await request('/auth/google', {
          method: 'POST',
          body: JSON.stringify({
            credential: result.credential,
            device: {
              id: deviceId,
              type: installed ? 'pwa' : 'browser',
              name: installed ? 'Installed mobile app' : 'Web browser',
            },
          }),
        });
        if (epoch !== authEpoch) return false;
        if (!accessDecisionIsCurrent(decision)) {
          remainSignedOut();
          return false;
        }
        if (!validAccountView(response)) throw Error('The account service returned an invalid response.');
        account = response;
        window.MedicationAccess.resolveAccount(account);
        render();
        return true;
      } catch (error) {
        if (epoch !== authEpoch) return false;
        if (!accessDecisionIsCurrent(decision)) {
          remainSignedOut();
          return false;
        }
        account = null;
        setAccountStatus(error.message);
        render();
        window.MedicationAccess.resolveSignedOut(error.message);
        void loadGoogleLibrary();
        return false;
      } finally {
        if (signInPromise === attempt) signInPromise = null;
      }
    })();
    signInPromise = attempt;
    return attempt;
  }

  async function initialize() {
    const epoch = authEpoch;
    const decision = accessDecisionSnapshot();
    let configUnavailable = false;
    try {
      const config = await request('/auth/config');
      if (epoch !== authEpoch) return;
      clientId = config.enabled && typeof config.googleClientId === 'string'
        ? config.googleClientId
        : '';
    } catch {
      if (epoch !== authEpoch) return;
      clientId = '';
      configUnavailable = true;
    }

    try {
      const restored = await request('/auth/me');
      if (epoch !== authEpoch) return;
      if (decision.mode !== 'pending' || !accessDecisionIsCurrent(decision)) {
        remainSignedOut();
        return;
      }
      if (!validAccountView(restored)) throw Error('The account service returned an invalid response.');
      account = restored;
      window.MedicationAccess.resolveAccount(account);
      render();
      return;
    } catch (error) {
      if (epoch !== authEpoch) return;
      if (decision.mode !== 'pending' || !accessDecisionIsCurrent(decision)) {
        remainSignedOut();
        return;
      }
      account = null;
      const unavailable = configUnavailable || error.status !== 401;
      const message = unavailable
        ? SERVICE_UNAVAILABLE
        : clientId
          ? 'Sign in with Google or continue on this device.'
          : GOOGLE_UNAVAILABLE;
      setAccountStatus(message);
      render();
      window.MedicationAccess.resolveSignedOut(message);
      if (clientId) void loadGoogleLibrary();
    }
  }

  function chooseSignOutAction() {
    const dialog = elements.signOutDialog;
    if (!dialog?.showModal) return Promise.resolve('cancel');
    return new Promise(resolve => {
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', () => {
        resolve(['keep', 'erase'].includes(dialog.returnValue) ? dialog.returnValue : 'cancel');
      }, { once: true });
      try {
        dialog.showModal();
      } catch {
        resolve('cancel');
      }
    });
  }

  async function signOut() {
    if (signOutPromise) return signOutPromise;
    signOutPromise = (async () => {
      const choice = await chooseSignOutAction();
      if (choice === 'cancel') return false;
      if (choice === 'erase' && typeof window.clearMedicationSchedule !== 'function') {
        alert('Local data cannot be erased safely right now. Nothing was changed.');
        return false;
      }

      if (elements.signOut) elements.signOut.disabled = true;
      ++authEpoch;
      try {
        await request('/auth/session', { method: 'DELETE' });
      } catch (error) {
        setAccountStatus(error.message);
        alert(`Could not sign out: ${error.message}`);
        return false;
      }

      account = null;

      if (choice === 'erase') {
        window.MedicationAccess.showChoice('Erasing local data from this device…');
        let cleared = false;
        try {
          cleared = window.clearMedicationSchedule() === true;
        } catch {
          cleared = false;
        }
        if (!cleared) {
          const message = 'Local data could not be erased completely. Check browser storage before continuing.';
          setAccountStatus(message);
          window.MedicationAccess.showChoice(message);
          render();
          alert('Signed out, but local data could not be erased completely.');
          return false;
        }
      }

      const selected = window.MedicationAccess.chooseLocal();
      if (selected === false) {
        setAccountStatus('Signed out. Choose how to continue on this device.');
        render();
        return false;
      }
      setAccountStatus('');
      render();
      if (clientId) void loadGoogleLibrary();
      return true;
    })();
    try {
      return await signOutPromise;
    } finally {
      if (elements.signOut) elements.signOut.disabled = false;
      signOutPromise = null;
    }
  }

  if (elements.save) {
    elements.save.onclick = async () => {
      elements.save.disabled = true;
      const epoch = authEpoch;
      try {
        const updated = await request('/auth/me', {
          method: 'PATCH',
          body: JSON.stringify({
            intendedStartDate: elements.start?.value || null,
            intendedEndDate: elements.end?.value || null,
          }),
        });
        if (epoch !== authEpoch) return;
        if (!validAccountView(updated)) throw Error('The account service returned an invalid response.');
        account = updated;
        window.MedicationAccess.resolveAccount(account);
        render();
        alert('Usage period saved.');
      } catch (error) {
        if (epoch === authEpoch) alert(error.message);
      } finally {
        elements.save.disabled = false;
      }
    };
  }

  if (elements.signOut) elements.signOut.onclick = signOut;

  const initialized = initialize();
  window.MedicationAccount = {
    get current() { return account; },
    get signedIn() { return Boolean(account?.user); },
    get advanced() { return Boolean(account?.features?.advanced); },
    initialized,
    signOut,
    // Transitional only: Task 6 replaces this; do not deploy Task 5 standalone.
    // It deliberately exposes no credential.
    authorizationHeaders() { return {}; },
    requireAdvanced() {
      return window.MedicationAccess.requireCloud();
    },
  };
})();
