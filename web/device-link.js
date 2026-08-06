(() => {
  'use strict';

  // Browser side of the device-authorization grant: the signed-in owner approves
  // the short code shown on a widget so it can obtain an account credential.
  const API = '/api';
  const USER_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  const elements = {
    status: document.querySelector('#linkStatus'),
    form: document.querySelector('#deviceLinkForm'),
    code: document.querySelector('#deviceUserCode'),
    approve: document.querySelector('#approveDevice'),
    signInHint: document.querySelector('#signInHint'),
  };

  // Mirror the worker's normalization: Crockford base32 minus I, L, O, U.
  function normalizeUserCode(value) {
    const stripped = String(value || '').toUpperCase().replace(/[^0-9A-HJKMNP-TV-Z]/g, '');
    return stripped.length === 8 ? `${stripped.slice(0, 4)}-${stripped.slice(4)}` : '';
  }

  function setStatus(message) {
    if (elements.status) elements.status.textContent = message;
  }

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      'Content-Type': 'application/json',
      ...(['GET', 'HEAD'].includes(method) ? {} : { 'X-Medication-CSRF': '1' }),
      ...(options.headers || {}),
    };
    const response = await fetch(`${API}${path}`, {
      ...options, method, headers, credentials: 'same-origin', cache: 'no-store',
    });
    let body = {};
    try { body = await response.json(); } catch { /* generic error below */ }
    if (!response.ok) {
      const error = Error(body.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function approve(rawCode) {
    const userCode = normalizeUserCode(rawCode);
    if (!USER_CODE.test(userCode)) {
      setStatus('Enter the 8-character code shown on your device.');
      return false;
    }
    if (elements.approve) elements.approve.disabled = true;
    setStatus('Approving…');
    try {
      await request('/auth/device/approve', { method: 'POST', body: JSON.stringify({ userCode }) });
      setStatus('Device approved. Return to that device — it will finish linking automatically.');
      if (elements.form) elements.form.hidden = true;
      return true;
    } catch (error) {
      if (error.status === 401) setStatus('Sign in on the app first, then reopen this link.');
      else if (error.status === 403) setStatus('This account does not have cloud sync enabled.');
      else if (error.status === 404) setStatus('That code is invalid, already used, or expired. Start again on your device.');
      else setStatus(error.message);
      if (error.status === 401 && elements.signInHint) elements.signInHint.hidden = false;
      return false;
    } finally {
      if (elements.approve) elements.approve.disabled = false;
    }
  }

  async function init() {
    const prefill = normalizeUserCode(new URLSearchParams(location.search).get('code'));
    if (prefill && elements.code) elements.code.value = prefill;
    try {
      const me = await request('/auth/me');
      if (!me?.features?.cloudSync) {
        setStatus('This account does not have cloud sync enabled. Sign in with an eligible account.');
      } else {
        setStatus(`Signed in as ${me.user?.email || 'your account'}. Confirm the code below, then approve.`);
      }
    } catch (error) {
      if (error.status === 401) {
        setStatus('Please sign in on the app first, then reopen this link.');
        if (elements.signInHint) elements.signInHint.hidden = false;
      } else {
        setStatus('Account service is temporarily unavailable. Try again shortly.');
      }
    }
  }

  if (elements.form) {
    elements.form.addEventListener('submit', event => {
      event.preventDefault();
      void approve(elements.code ? elements.code.value : '');
    });
  }

  // Exposed for tests and for programmatic approval.
  window.MedicationDeviceLink = { approve, normalizeUserCode };

  if (typeof document !== 'undefined' && document.querySelector('#deviceLinkForm')) void init();
})();
