(() => {
  'use strict';

  const API = '/api';
  const APP_URL = 'https://medication.bytesfx.com/';
  const CREDENTIALS_KEY = 'medication-reminder-sync-v1';
  const PENDING_CLAIM_KEY = 'medication-reminder-pending-claim-v1';
  const PENDING_REFRESH_KEY = 'medication-reminder-pending-refresh-v1';
  const SOURCE_ID_KEY = 'medication-reminder-source-id-v1';
  const MOBILE_ID_KEY = 'medication-reminder-mobile-id-v1';
  const UNPAIRED_KEY = 'medication-reminder-mobile-unpaired-v1';
  const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
  const LEGACY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const status = document.querySelector('#syncStatus');
  const pairButton = document.querySelector('#showQr');
  const copyButton = document.querySelector('#exportSchedule');
  const syncButton = document.querySelector('#importSchedule');
  const unpairButton = document.querySelector('#unpairDevice');
  const installedStandalone = matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const mobileDevice = Boolean(navigator.userAgentData?.mobile)
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const installedMobile = installedStandalone && mobileDevice;

  let pushTimer = 0;
  let syncInProgress = false;
  let changeGeneration = 0;
  let authorityGeneration = 0;
  let accessDecisionGeneration = 0;
  let importGeneration = 0;

  window.addEventListener('medication-access-ready', () => {
    accessDecisionGeneration += 1;
  });
  window.addEventListener('medication-account-changed', () => {
    accessDecisionGeneration += 1;
  });

  function b64(bytes) {
    let binary = '';
    for (const value of bytes) binary += String.fromCharCode(value);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function unb64(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('Invalid base64url value.');
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  const randomId = (length = 24) => b64(crypto.getRandomValues(new Uint8Array(length)));

  function storedJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function authorityTuple(value) {
    if (!value) return '';
    const secret = value.role === 'mobile'
      ? (value.version === 2 ? value.mobileToken : value.token)
      : value.invitationToken || '';
    return [value.version, value.role, value.pairId, value.deviceId, value.ownerUserId || '', secret].join('|');
  }

  function authoritySnapshot(value = credentials()) {
    return { generation: authorityGeneration, tuple: authorityTuple(value) };
  }

  function ownsAuthority(snapshot) {
    return snapshot?.generation === authorityGeneration
      && snapshot.tuple === authorityTuple(credentials());
  }

  function staleOperation() {
    refreshStatus(credentials(), 'A newer pairing action replaced this operation. No changes were applied.');
  }

  function ownsMutationOperation(operation) {
    return operation?.authority
      ? ownsSourceOperation(operation)
      : ownsAuthority(operation);
  }

  function guardedSaveCredentials(value, operation) {
    if (!ownsMutationOperation(operation)) {
      staleOperation();
      return false;
    }
    saveCredentials(value);
    return true;
  }

  function commitScheduleAndCredentials(incoming, value, operation) {
    if (!ownsMutationOperation(operation)) {
      staleOperation();
      return false;
    }
    const previousRaw = localStorage.getItem(CREDENTIALS_KEY);
    try {
      saveCredentials(value);
      window.applySyncedSchedule(incoming);
      return true;
    } catch (error) {
      restoreCredentialsRaw(previousRaw);
      throw error;
    }
  }

  function validEncryptionKey(value) {
    if (!TOKEN_PATTERN.test(value || '')) return false;
    try {
      return unb64(value).length === 32;
    } catch {
      return false;
    }
  }

  function validCommonCredential(value) {
    return value
      && typeof value === 'object'
      && ID_PATTERN.test(value.pairId || '')
      && ID_PATTERN.test(value.deviceId || '')
      && validEncryptionKey(value.encryptionKey)
      && Number.isInteger(value.revision)
      && value.revision > 0
      && typeof value.claimed === 'boolean'
      && typeof value.dirty === 'boolean';
  }

  function validCredentials(value) {
    if (!validCommonCredential(value)) return false;
    const common = ['claimed', 'deviceId', 'dirty', 'encryptionKey', 'pairId', 'revision', 'role', 'version'];
    if (value.version === 1 && value.role === 'mobile') {
      return !Object.hasOwn(value, 'mobileToken')
        && LEGACY_TOKEN_PATTERN.test(value.token || '')
        && Object.keys(value).every(key => [...common, 'token'].includes(key));
    }
    if (value.version === 2 && value.role === 'mobile') {
      return !Object.hasOwn(value, 'token')
        && TOKEN_PATTERN.test(value.mobileToken || '')
        && Object.keys(value).every(key => [...common, 'mobileToken'].includes(key));
    }
    if (value.version === 2 && value.role === 'source') {
      const invitationValid = value.claimed
        ? !Object.hasOwn(value, 'invitationToken') && !Object.hasOwn(value, 'invitationExpiresAt')
        : TOKEN_PATTERN.test(value.invitationToken || '')
          && validExpiryTimestamp(value.invitationExpiresAt);
      return !Object.hasOwn(value, 'token')
        && ID_PATTERN.test(value.sourceId || '')
        && value.sourceId === value.deviceId
        && UUID_PATTERN.test(value.ownerUserId || '')
        && invitationValid
        && Object.keys(value).every(key => [
          ...common,
          'invitationExpiresAt',
          'invitationToken',
          'ownerUserId',
          'sourceId',
        ].includes(key));
    }
    return false;
  }

  function credentials() {
    const value = storedJson(CREDENTIALS_KEY);
    return validCredentials(value) ? value : null;
  }

  function saveCredentials(value) {
    if (!validCredentials(value)) throw Error('The pairing credentials are invalid.');
    const before = authorityTuple(credentials());
    const serialized = JSON.stringify(value);
    localStorage.setItem(CREDENTIALS_KEY, serialized);
    if (localStorage.getItem(CREDENTIALS_KEY) !== serialized) throw Error('Pairing credentials could not be saved.');
    if (before !== authorityTuple(value)) authorityGeneration += 1;
    refreshStatus(value);
  }

  function removeCredentials() {
    const before = authorityTuple(credentials());
    localStorage.removeItem(CREDENTIALS_KEY);
    if (before) authorityGeneration += 1;
  }

  function restoreCredentialsRaw(raw) {
    const before = authorityTuple(credentials());
    if (raw == null) localStorage.removeItem(CREDENTIALS_KEY);
    else localStorage.setItem(CREDENTIALS_KEY, raw);
    const restored = credentials();
    if (authorityTuple(restored) !== before) authorityGeneration += 1;
    refreshStatus(restored);
  }

  function stableId(key) {
    let value = localStorage.getItem(key);
    if (!ID_PATTERN.test(value || '')) {
      value = randomId();
      localStorage.setItem(key, value);
    }
    return value;
  }

  function validFutureExpiry(value) {
    return validExpiryTimestamp(value) && Date.parse(value) > Date.now();
  }

  function validExpiryTimestamp(value) {
    if (typeof value !== 'string' || value.length > 64) return false;
    return Number.isFinite(Date.parse(value));
  }

  function refreshControls(value = credentials()) {
    document.body.classList.toggle('installed-mobile', installedMobile);
    if (status) status.hidden = installedMobile;
    if (installedMobile) {
      pairButton.hidden = true;
      copyButton.hidden = true;
      const paired = value?.role === 'mobile';
      syncButton.hidden = !paired;
      unpairButton.hidden = false;
      unpairButton.textContent = paired ? 'Unpair' : 'Pair Schedule';
      return;
    }
    const connectedSource = value?.role === 'source' && value.claimed === true;
    pairButton.hidden = connectedSource;
    copyButton.hidden = connectedSource;
    syncButton.hidden = false;
    unpairButton.hidden = !value;
    unpairButton.textContent = 'Unpair';
  }

  function refreshStatus(value = credentials(), message = '') {
    if (status) {
      status.classList.remove('is-error');
      status.textContent = message || (!value
        ? (installedMobile
          ? 'No schedule is paired with this mobile app.'
          : 'Schedules are stored privately on this device.')
        : value.role === 'mobile'
          ? `Paired mobile · revision ${value.revision} · encrypted sync ready`
          : `Mobile pairing ready · revision ${value.revision}${value.claimed ? ' · mobile connected' : ' · waiting for mobile scan'}`);
    }
    refreshControls(value);
  }

  function showError(message) {
    if (status) {
      status.textContent = message;
      status.classList.add('is-error');
    }
  }

  function forgetMobileSchedule(
    message = 'Unpaired. All schedules were removed from this mobile app.',
    snapshot = null,
  ) {
    if (snapshot && !ownsAuthority(snapshot)) {
      staleOperation();
      return false;
    }
    removeCredentials();
    localStorage.removeItem(PENDING_CLAIM_KEY);
    localStorage.removeItem(PENDING_REFRESH_KEY);
    localStorage.setItem(UNPAIRED_KEY, '1');
    const persisted = window.clearMedicationSchedule();
    refreshStatus(null, message);
    if (persisted === false) {
      alert('The schedule was cleared from this screen, but the app could not save the unpaired state. Check browser storage permissions before closing the app.');
    }
    return true;
  }

  function validateSchedule(value) {
    if (!value || typeof value !== 'object' || typeof value.timezone !== 'string'
      || value.timezone.length > 100 || !Array.isArray(value.events) || value.events.length > 64) {
      throw Error('The encrypted schedule is invalid.');
    }
    const events = value.events.map(item => {
      if (!item || typeof item !== 'object'
        || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id)
        || typeof item.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
        || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 200
        || !Array.isArray(item.medicines) || !item.medicines.length || item.medicines.length > 32
        || !Array.isArray(item.days) || !item.days.length) {
        throw Error('The encrypted schedule contains an invalid reminder.');
      }
      if (item.medicines.some(medicine => typeof medicine !== 'string'
        || !medicine.trim() || medicine.length > 500)) {
        throw Error('The encrypted schedule contains an invalid medication.');
      }
      const days = item.days.map(day => String(day).toLowerCase())
        .filter(day => /^(daily|mon|tue|wed|thu|fri|sat|sun)$/.test(day));
      if (!days.length) throw Error('The encrypted schedule contains invalid active days.');
      return {
        id: item.id,
        enabled: Boolean(item.enabled),
        time: item.time,
        label: item.label.trim(),
        medicines: item.medicines.map(medicine => medicine.trim()),
        instructions: typeof item.instructions === 'string' ? item.instructions.slice(0, 2000) : '',
        days,
        start_date: typeof item.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.start_date)
          ? item.start_date : null,
        end_date: typeof item.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.end_date)
          ? item.end_date : null,
      };
    });
    return { version: 1, timezone: value.timezone, events };
  }

  function validEncryptedRemote(value) {
    if (!value || typeof value !== 'object'
      || typeof value.iv !== 'string' || typeof value.ciphertext !== 'string'
      || value.ciphertext.length < 16 || value.ciphertext.length > 1_000_000
      || !Number.isInteger(value.revision) || value.revision < 1) {
      throw Error('The encrypted schedule response is invalid.');
    }
    try {
      if (unb64(value.iv).length !== 12 || unb64(value.ciphertext).length < 16) throw Error();
    } catch {
      throw Error('The encrypted schedule response is invalid.');
    }
    return value;
  }

  const importKey = encoded => crypto.subtle.importKey(
    'raw',
    unb64(encoded),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );

  async function encryptSchedule(schedule, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(validateSchedule(schedule)));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), plain);
    return { iv: b64(iv), ciphertext: b64(new Uint8Array(cipher)) };
  }

  async function decryptSchedule(remote, key) {
    try {
      validEncryptedRemote(remote);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(remote.iv) },
        await importKey(key),
        unb64(remote.ciphertext),
      );
      return validateSchedule(JSON.parse(new TextDecoder().decode(plain)));
    } catch {
      throw Error('This pairing link cannot decrypt the schedule. It may be damaged or expired.');
    }
  }

  function mobileAuthorization(value) {
    const token = value.version === 2 ? value.mobileToken : value.token;
    return {
      Authorization: `Bearer ${token}`,
      'X-Medication-Device': value.deviceId,
    };
  }

  function requestHeaders(value, method) {
    if (value?.role === 'mobile') return mobileAuthorization(value);
    return !['GET', 'HEAD'].includes(method) ? { 'X-Medication-CSRF': '1' } : {};
  }

  async function requestJson(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch {
      const error = Error('The sync service could not be reached.');
      error.retryable = true;
      throw error;
    }
    let body = {};
    try {
      if (typeof response.text === 'function') {
        const text = await response.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = {};
          }
        }
      } else if (typeof response.json === 'function') {
        // Test and compatibility response objects may not expose the standard text() API.
        body = await response.json();
      }
    } catch {
      const error = Error('The sync response was interrupted.');
      error.status = response.status;
      error.retryable = true;
      throw error;
    }
    if (!response.ok) {
      const error = Error(`Sync request failed (${response.status}).`);
      error.status = response.status;
      error.verifiedRevocation = response.status === 404
        && body?.error === 'Pairing not found or credentials invalid';
      throw error;
    }
    return body;
  }

  async function api(path, options = {}, value = credentials()) {
    const method = String(options.method || 'GET').toUpperCase();
    return requestJson(`${API}${path}`, {
      ...options,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...requestHeaders(value, method),
        ...(options.headers || {}),
      },
      credentials: value?.role === 'mobile' ? 'omit' : 'same-origin',
      cache: 'no-store',
    });
  }

  async function invitationApi(path, invitationToken, options = {}, deviceId = '') {
    const method = String(options.method || 'GET').toUpperCase();
    return requestJson(`${API}${path}`, {
      ...options,
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${invitationToken}`,
        ...(deviceId ? { 'X-Medication-Device': deviceId } : {}),
        ...(options.headers || {}),
      },
      credentials: 'omit',
      cache: 'no-store',
    });
  }

  function pairingPayload(value) {
    if (value.version === 2) {
      return {
        version: 2,
        pairId: value.pairId,
        invitationToken: value.invitationToken,
        invitationExpiresAt: value.invitationExpiresAt,
        encryptionKey: value.encryptionKey,
      };
    }
    return {
      version: 1,
      pairId: value.pairId,
      token: value.token,
      encryptionKey: value.encryptionKey,
    };
  }

  function pairingLink(value) {
    const payload = b64(new TextEncoder().encode(JSON.stringify(pairingPayload(value))));
    return `${APP_URL}#pair=${payload}`;
  }

  function parseInvitation(raw = location.href) {
    let hash = '';
    try {
      hash = raw.startsWith('#') ? raw : new URL(raw, location.href).hash;
    } catch {
      throw Error('The QR pairing link is invalid or incomplete.');
    }
    if (!hash.startsWith('#pair=')) return null;
    try {
      const value = JSON.parse(new TextDecoder().decode(unb64(hash.slice(6))));
      if (!value || typeof value !== 'object'
        || !ID_PATTERN.test(value.pairId || '')
        || !validEncryptionKey(value.encryptionKey)
        || Object.keys(value).some(key => ![
          'version', 'pairId', 'token', 'invitationToken', 'invitationExpiresAt', 'encryptionKey',
        ].includes(key))) {
        throw Error();
      }
      if (value.version === 1 && LEGACY_TOKEN_PATTERN.test(value.token || '')
        && !Object.hasOwn(value, 'invitationToken')
        && !Object.hasOwn(value, 'invitationExpiresAt')) {
        return value;
      }
      if (value.version === 2 && TOKEN_PATTERN.test(value.invitationToken || '')
        && validFutureExpiry(value.invitationExpiresAt)
        && !Object.hasOwn(value, 'token')) {
        return value;
      }
      throw Error();
    } catch {
      throw Error('The QR pairing link is invalid, incomplete, or expired.');
    }
  }

  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<form method="dialog" class="dialog-card"><div class="dialog-heading"><div><p class="eyebrow">PRIVATE DEVICE LINK</p><h2>Pair one mobile device</h2></div><button class="close-button" aria-label="Close">×</button></div><canvas id="securePairingQr" class="pairing-code"></canvas><p class="pairing-note">Scan with the mobile camera. This invitation expires shortly and can be used once. The encryption key stays inside the QR link.</p><div class="dialog-actions"><button type="button" id="copySecurePairLink" class="secondary-button">Copy link</button><button class="primary-button">Done</button></div></form>';
  document.body.append(dialog);

  const scannerDialog = document.createElement('dialog');
  scannerDialog.innerHTML = '<form method="dialog" class="dialog-card"><div class="dialog-heading"><div><p class="eyebrow">PAIR SCHEDULE</p><h2>Scan pairing QR</h2></div><button class="close-button" aria-label="Close">×</button></div><video id="secureQrCamera" class="qr-reader-video" autoplay playsinline muted></video><p id="secureQrStatus" class="pairing-note">Point the camera at the QR code displayed by the browser or Windows widget.</p><div class="dialog-actions"><button type="button" id="pasteSecurePairLink" class="secondary-button">Paste link</button><button class="primary-button">Cancel</button></div></form>';
  document.body.append(scannerDialog);

  let scannerStream = null;
  let scannerFrame = 0;
  let scannerBusy = false;

  function stopScanner() {
    if (scannerFrame) cancelAnimationFrame(scannerFrame);
    scannerFrame = 0;
    scannerBusy = false;
    if (scannerStream) {
      scannerStream.getTracks().forEach(track => track.stop());
      scannerStream = null;
    }
    scannerDialog.querySelector('#secureQrCamera').srcObject = null;
  }

  async function useScannedPairing(raw) {
    let invitation;
    try {
      invitation = parseInvitation(raw);
    } catch (error) {
      scannerDialog.querySelector('#secureQrStatus').textContent = error.message;
      return false;
    }
    if (!invitation) {
      scannerDialog.querySelector('#secureQrStatus').textContent = 'This is not a Medication Reminder pairing QR code.';
      return false;
    }
    stopScanner();
    scannerDialog.close();
    try {
      await acceptPairing(invitation);
    } catch (error) {
      showError(error.message);
      alert(`Pairing failed: ${error.message}`);
    }
    return true;
  }

  async function openScanner() {
    if (!installedMobile) {
      alert('QR scanning is available from the installed mobile app.');
      return;
    }
    if (!('BarcodeDetector' in window)) {
      const raw = prompt('This device does not provide an in-app QR detector. Paste the private pairing link instead:');
      if (raw) await useScannedPairing(raw);
      return;
    }
    const statusText = scannerDialog.querySelector('#secureQrStatus');
    statusText.textContent = 'Starting camera…';
    scannerDialog.showModal();
    try {
      scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      const video = scannerDialog.querySelector('#secureQrCamera');
      video.srcObject = scannerStream;
      await video.play();
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      statusText.textContent = 'Point the camera at the QR code displayed by the browser or Windows widget.';
      const scan = async () => {
        if (!scannerStream || scannerBusy) return;
        scannerBusy = true;
        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue && await useScannedPairing(codes[0].rawValue)) return;
          }
        } catch {
          statusText.textContent = 'QR scan failed. Keep the code steady and try again.';
        } finally {
          scannerBusy = false;
        }
        if (scannerStream) scannerFrame = requestAnimationFrame(scan);
      };
      scannerFrame = requestAnimationFrame(scan);
    } catch {
      stopScanner();
      scannerDialog.close();
      alert('Camera access is required to scan the pairing QR code. You can allow camera access in the app or browser settings.');
    }
  }

  scannerDialog.addEventListener('close', stopScanner);
  scannerDialog.querySelector('#pasteSecurePairLink').onclick = async () => {
    const raw = prompt('Paste the private pairing link:');
    if (raw) await useScannedPairing(raw);
  };

  function drawQr(text) {
    if (typeof qrcode !== 'function') throw Error('QR generator unavailable.');
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const canvas = dialog.querySelector('#securePairingQr');
    const context = canvas.getContext('2d');
    const count = qr.getModuleCount();
    const size = 360;
    const cell = size / count;
    canvas.width = size;
    canvas.height = size;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    context.fillStyle = '#243044';
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (qr.isDark(row, column)) {
          context.fillRect(
            Math.floor(column * cell),
            Math.floor(row * cell),
            Math.ceil(cell),
            Math.ceil(cell),
          );
        }
      }
    }
  }

  function currentAccountId() {
    const value = window.MedicationAccount?.current?.user?.id;
    return UUID_PATTERN.test(value || '') ? value : '';
  }

  function sourceOperationSnapshot(value = credentials(), ownerUserId = value?.ownerUserId || currentAccountId()) {
    return {
      authority: authoritySnapshot(value),
      accessGeneration: accessDecisionGeneration,
      ownerUserId,
    };
  }

  function ownsSourceOperation(operation) {
    return operation?.accessGeneration === accessDecisionGeneration
      && window.MedicationAccess.mode === 'account'
      && currentAccountId() === operation.ownerUserId
      && ownsAuthority(operation.authority);
  }

  function requireSourceOperation(operation) {
    if (ownsSourceOperation(operation)) return true;
    const error = Error('Your account or pairing changed while this action was running. No changes were applied. Retry from the current account.');
    error.stale = true;
    refreshStatus(credentials(), error.message);
    throw error;
  }

  function requireSourceCloud(value = null) {
    window.MedicationAccess.requireCloud();
    const accountId = currentAccountId();
    if (!accountId) throw Error('Sign in with the original pairing account before using cloud sync.');
    if (value?.role === 'source' && value.ownerUserId !== accountId) {
      throw Error('This pairing belongs to another account. Sign in as the original owner.');
    }
    return accountId;
  }

  async function createPair() {
    const ownerUserId = requireSourceCloud();
    const current = credentials();
    if (current?.role === 'source') requireSourceCloud(current);
    if (current && !confirm('Create a new pairing? The existing mobile link will stop syncing.')) return current;
    const operation = sourceOperationSnapshot(current, ownerUserId);
    refreshStatus(current, 'Creating encrypted pairing…');
    const sourceId = stableId(SOURCE_ID_KEY);
    const encryptionKey = randomId(32);
    const encrypted = await encryptSchedule(window.getMedicationSchedule(), encryptionKey);
    requireSourceOperation(operation);
    const created = await api('/sync/pairs', {
      method: 'POST',
      body: JSON.stringify({ sourceId, ...encrypted }),
    }, null);
    requireSourceOperation(operation);
    if (!ID_PATTERN.test(created?.pairId || '')
      || !TOKEN_PATTERN.test(created?.invitationToken || '')
      || !validFutureExpiry(created?.invitationExpiresAt)
      || created.revision !== 1) {
      throw Error('The pairing service returned an invalid response.');
    }
    const value = {
      version: 2,
      role: 'source',
      pairId: created.pairId,
      invitationToken: created.invitationToken,
      invitationExpiresAt: created.invitationExpiresAt,
      encryptionKey,
      deviceId: sourceId,
      sourceId,
      ownerUserId,
      revision: created.revision,
      claimed: false,
      dirty: false,
    };
    requireSourceOperation(operation);
    saveCredentials(value);
    return value;
  }

  async function currentInvitation(value) {
    requireSourceCloud(value);
    if (value.version !== 2 || value.role !== 'source') {
      throw Error('Create a new account-owned pairing before sharing a mobile invitation.');
    }
    const operation = sourceOperationSnapshot(value);
    requireSourceOperation(operation);
    if (value.claimed) {
      requireSourceOperation(operation);
      localStorage.removeItem(PENDING_REFRESH_KEY);
      throw Error('A mobile device is already connected. Unpair it before creating another invitation.');
    }
    const stalePending = storedJson(PENDING_REFRESH_KEY);
    if (stalePending?.pairId === value.pairId
      && stalePending.previousInvitationToken !== value.invitationToken) {
      localStorage.removeItem(PENDING_REFRESH_KEY);
    }
    if (validFutureExpiry(value.invitationExpiresAt)) return value;
    const existing = storedJson(PENDING_REFRESH_KEY);
    const pending = existing?.version === 1
      && existing.pairId === value.pairId
      && existing.previousInvitationToken === value.invitationToken
      && existing.ownerUserId === value.ownerUserId
      && existing.sourceId === value.sourceId
      && TOKEN_PATTERN.test(existing.refreshNonce || '')
      ? existing
      : {
        version: 1,
        pairId: value.pairId,
        previousInvitationToken: value.invitationToken,
        refreshNonce: randomId(32),
        ownerUserId: value.ownerUserId,
        sourceId: value.sourceId,
      };
    const pendingSerialized = JSON.stringify(pending);
    requireSourceOperation(operation);
    localStorage.setItem(PENDING_REFRESH_KEY, pendingSerialized);
    if (localStorage.getItem(PENDING_REFRESH_KEY) !== pendingSerialized) {
      throw Error('The invitation refresh could not be saved safely.');
    }
    try {
      requireSourceOperation(operation);
      const refreshed = await api(`/sync/pairs/${encodeURIComponent(value.pairId)}/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          previousInvitationToken: pending.previousInvitationToken,
          refreshNonce: pending.refreshNonce,
        }),
      }, value);
      requireSourceOperation(operation);
      if (refreshed?.pairId !== value.pairId
        || !TOKEN_PATTERN.test(refreshed.invitationToken || '')
        || !validFutureExpiry(refreshed.invitationExpiresAt)) {
        throw Error('The pairing service returned an invalid invitation.');
      }
      const updated = {
        ...value,
        invitationToken: refreshed.invitationToken,
        invitationExpiresAt: refreshed.invitationExpiresAt,
      };
      requireSourceOperation(operation);
      saveCredentials(updated);
      const updatedOperation = sourceOperationSnapshot(updated);
      requireSourceOperation(updatedOperation);
      localStorage.removeItem(PENDING_REFRESH_KEY);
      return updated;
    } catch (error) {
      if (error.status === 409) {
        const latest = credentials();
        if (latest?.version === 2 && latest.role === 'source'
          && latest.pairId === value.pairId
          && latest.invitationToken !== pending.previousInvitationToken
          && validFutureExpiry(latest.invitationExpiresAt)) {
          requireSourceOperation(sourceOperationSnapshot(latest));
          localStorage.removeItem(PENDING_REFRESH_KEY);
          return latest;
        }
        requireSourceOperation(operation);
        throw Error('The pairing invitation changed in another browser tab. Reopen pairing and try again.');
      }
      throw error;
    }
  }

  async function showPairing() {
    try {
      requireSourceCloud();
      let value = credentials();
      if (!value || value.role !== 'source') {
        value = await createPair();
        requireSourceOperation(sourceOperationSnapshot(value));
      }
      value = await currentInvitation(value);
      const operation = sourceOperationSnapshot(value);
      requireSourceOperation(operation);
      drawQr(pairingLink(value));
      requireSourceOperation(operation);
      dialog.showModal();
    } catch (error) {
      showError(error.message);
      alert(`Could not create pairing: ${error.message}`);
    }
  }

  async function copyText(text, operation) {
    try {
      requireSourceOperation(operation);
      await navigator.clipboard.writeText(text);
      requireSourceOperation(operation);
      return true;
    } catch (error) {
      if (error?.stale) throw error;
      requireSourceOperation(operation);
      prompt('Copy this private pairing link:', text);
      return false;
    }
  }

  async function copyPairLink() {
    try {
      requireSourceCloud();
      let value = credentials();
      if (!value || value.role !== 'source') {
        value = await createPair();
        requireSourceOperation(sourceOperationSnapshot(value));
      }
      value = await currentInvitation(value);
      const operation = sourceOperationSnapshot(value);
      requireSourceOperation(operation);
      if (await copyText(pairingLink(value), operation)) {
        requireSourceOperation(operation);
        refreshStatus(value, 'Private pairing link copied.');
      }
    } catch (error) {
      showError(error.message);
      alert(`Could not copy pairing link: ${error.message}`);
    }
  }

  async function importScheduleCopy(invitation) {
    requireSourceCloud();
    if (invitation.version !== 1) {
      throw Error('Mobile invitations can only be claimed from the installed mobile app.');
    }
    const operation = {
      generation: ++importGeneration,
      accessGeneration: accessDecisionGeneration,
      scheduleGeneration: changeGeneration,
      accountUserId: currentAccountId(),
      invitationIdentity: [
        invitation.version,
        invitation.pairId,
        invitation.token,
        invitation.encryptionKey,
      ].join('|'),
    };
    if (!confirm('Import the encrypted schedule from the widget and replace this browser’s local schedule?\n\nThis one-time import will not claim the mobile pairing.')) {
      return { terminal: true, imported: false };
    }
    refreshStatus(credentials(), 'Importing encrypted schedule…');
    const remote = await invitationApi(
      `/sync/pairs/${encodeURIComponent(invitation.pairId)}`,
      invitation.token,
    );
    const imported = await decryptSchedule(remote, invitation.encryptionKey);
    const currentInvitationIdentity = [
      invitation.version,
      invitation.pairId,
      invitation.token,
      invitation.encryptionKey,
    ].join('|');
    if (operation.generation !== importGeneration
      || operation.accessGeneration !== accessDecisionGeneration
      || operation.scheduleGeneration !== changeGeneration
      || window.MedicationAccess.mode !== 'account'
      || currentAccountId() !== operation.accountUserId
      || currentInvitationIdentity !== operation.invitationIdentity) {
      const message = 'Your account or local schedule changed while importing. No changes were applied. Reopen the pairing link and retry.';
      refreshStatus(credentials(), message);
      alert(message);
      return { terminal: true, imported: false, stale: true };
    }
    window.applySyncedSchedule(imported);
    refreshStatus(credentials(), `Schedule imported · revision ${remote.revision}`);
    alert(`Schedule imported · revision ${remote.revision}\n\nThis browser now has a private copy. The mobile pairing remains available.`);
    return { terminal: true, imported: true };
  }

  function validPendingClaim(value) {
    return value?.version === 1
      && ID_PATTERN.test(value.pairId || '')
      && TOKEN_PATTERN.test(value.invitationToken || '')
      && validFutureExpiry(value.invitationExpiresAt)
      && validEncryptionKey(value.encryptionKey)
      && ID_PATTERN.test(value.deviceId || '')
      && TOKEN_PATTERN.test(value.claimNonce || '')
      && (value.pushEndpoint === null
        || (typeof value.pushEndpoint === 'string' && value.pushEndpoint.startsWith('https://')));
  }

  function pendingClaim() {
    const value = storedJson(PENDING_CLAIM_KEY);
    return validPendingClaim(value) ? value : null;
  }

  function retainableClaimFailure(error) {
    return error?.retryable === true
      || error.status === 403
      || error.status === 429
      || error.status >= 500;
  }

  async function executePendingClaim(value) {
    const operation = authoritySnapshot();
    refreshStatus(credentials(), 'Securely pairing this mobile…');
    try {
      const remote = await invitationApi(
        `/sync/pairs/${encodeURIComponent(value.pairId)}/claim`,
        value.invitationToken,
        {
          method: 'POST',
          body: JSON.stringify({
            mobileDeviceId: value.deviceId,
            claimNonce: value.claimNonce,
            pushEndpoint: value.pushEndpoint,
          }),
        },
        value.deviceId,
      );
      if (remote?.pairId !== value.pairId
        || !TOKEN_PATTERN.test(remote.mobileToken || '')) {
        const error = Error('The pairing service returned an invalid mobile credential.');
        error.retryable = true;
        throw error;
      }
      let imported;
      try {
        imported = await decryptSchedule(remote, value.encryptionKey);
      } catch (cause) {
        cause.retryable = true;
        throw cause;
      }
      const stored = {
        version: 2,
        role: 'mobile',
        pairId: remote.pairId,
        mobileToken: remote.mobileToken,
        encryptionKey: value.encryptionKey,
        deviceId: value.deviceId,
        revision: remote.revision,
        claimed: true,
        dirty: false,
      };
      if (!ownsAuthority(operation)) {
        staleOperation();
        return false;
      }
      const previousRaw = localStorage.getItem(CREDENTIALS_KEY);
      try {
        saveCredentials(stored);
        const committed = authoritySnapshot(stored);
        window.applySyncedSchedule(imported);
        if (!ownsAuthority(committed)) {
          staleOperation();
          return false;
        }
      } catch {
        try {
          restoreCredentialsRaw(previousRaw);
        } catch {
          // The original write failed before replacing a valid prior credential, or storage is unavailable.
        }
        const error = Error('The paired schedule could not be saved on this device.');
        error.retryable = true;
        throw error;
      }
      localStorage.removeItem(PENDING_CLAIM_KEY);
      window.MedicationAccess.resolvePairedMobile?.();
      alert(`Paired mobile · revision ${remote.revision} · encrypted sync ready\n\nSchedule changes will sync securely while the app is open.`);
      return true;
    } catch (error) {
      if (error?.stale) return false;
      if (!retainableClaimFailure(error)) {
        if (ownsAuthority(operation)) localStorage.removeItem(PENDING_CLAIM_KEY);
        throw Error('Pairing could not be completed. Ask the source owner to create a new invitation. Your existing local schedule was kept.');
      }
      if (error.status === 403) {
        error.userMessage = 'Cloud sync is paused for this pairing. Your existing offline schedule was kept.';
        showError(error.userMessage);
      }
      throw error;
    }
  }

  async function retryPendingClaim() {
    const value = pendingClaim();
    if (!value) throw Error('There is no pending mobile claim to retry.');
    const result = await executePendingClaim(value);
    const raw = window.MedicationAccess.pendingInvitation();
    if (raw) {
      try {
        const invitation = parseInvitation(raw);
        if (invitation?.pairId === value.pairId) consumePendingAccessInvitation();
      } catch {
        // A successful scoped claim is authoritative; malformed unrelated input stays isolated.
      }
    }
    return result;
  }

  async function setupPushEndpoint() {
    let pushEndpoint = null;
    const withTimeout = (promise, milliseconds, fallback = null) => new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(fallback);
        }
      }, milliseconds);
      Promise.resolve(promise).then(value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
    });
    try {
      if ('Notification' in window && Notification.permission === 'default'
        && confirm('Enable medication and schedule-update notifications on this mobile device?')) {
        const setup = document.querySelector('#enableNotifications')?.onclick?.();
        await withTimeout(setup, 8000);
      }
      pushEndpoint = await withTimeout(window.getMedicationPushEndpoint(), 8000);
    } catch {
      pushEndpoint = null;
    }
    return pushEndpoint;
  }

  async function acceptLegacyPairing(invitation, mobileId, pushEndpoint, operation) {
    await invitationApi(
      `/sync/pairs/${encodeURIComponent(invitation.pairId)}/claim`,
      invitation.token,
      {
        method: 'POST',
        body: JSON.stringify({ mobileDeviceId: mobileId, pushEndpoint }),
      },
      mobileId,
    );
    const remote = await invitationApi(
      `/sync/pairs/${encodeURIComponent(invitation.pairId)}`,
      invitation.token,
    );
    const imported = await decryptSchedule(remote, invitation.encryptionKey);
    if (!ownsAuthority(operation)) {
      staleOperation();
      return false;
    }
    const stored = {
      version: 1,
      role: 'mobile',
      pairId: invitation.pairId,
      token: invitation.token,
      encryptionKey: invitation.encryptionKey,
      deviceId: mobileId,
      revision: remote.revision,
      claimed: true,
      dirty: false,
    };
    const previousRaw = localStorage.getItem(CREDENTIALS_KEY);
    try {
      saveCredentials(stored);
      window.applySyncedSchedule(imported);
    } catch (error) {
      restoreCredentialsRaw(previousRaw);
      throw error;
    }
    window.MedicationAccess.resolvePairedMobile?.();
    return true;
  }

  async function acceptPairing(invitation) {
    if (!installedMobile) throw Error('Install the mobile app before claiming a pairing invitation.');
    if (!confirm('Pair this mobile device and replace its local schedule with the encrypted schedule from the source device?')) {
      const existing = pendingClaim();
      if (existing?.pairId === invitation.pairId
        && (invitation.version === 1 || existing.invitationToken === invitation.invitationToken)) {
        localStorage.removeItem(PENDING_CLAIM_KEY);
      }
      return false;
    }
    const operation = authoritySnapshot();
    const mobileId = stableId(MOBILE_ID_KEY);
    const pushEndpoint = await setupPushEndpoint();
    if (!ownsAuthority(operation)) {
      staleOperation();
      return false;
    }
    if (invitation.version === 1) {
      return acceptLegacyPairing(invitation, mobileId, pushEndpoint, operation);
    }
    const existing = pendingClaim();
    const value = existing
      && existing.pairId === invitation.pairId
      && existing.invitationToken === invitation.invitationToken
      && existing.deviceId === mobileId
      ? existing
      : {
        version: 1,
        pairId: invitation.pairId,
        invitationToken: invitation.invitationToken,
        invitationExpiresAt: invitation.invitationExpiresAt,
        encryptionKey: invitation.encryptionKey,
        deviceId: mobileId,
        claimNonce: randomId(32),
        pushEndpoint,
      };
    const serialized = JSON.stringify(value);
    localStorage.setItem(PENDING_CLAIM_KEY, serialized);
    if (localStorage.getItem(PENDING_CLAIM_KEY) !== serialized) {
      throw Error('The pending pairing could not be saved safely.');
    }
    return executePendingClaim(value);
  }

  function sourceAllowed(value, { silent }) {
    try {
      requireSourceCloud(value);
      return true;
    } catch (error) {
      if (!silent) alert(error.message);
      return false;
    }
  }

  async function syncNow({ pushLocal = false, silent = false } = {}) {
    const value = credentials();
    if (!installedMobile && !value && !sourceAllowed(null, { silent })) return;
    if (!value || syncInProgress) {
      if (!value && !silent) alert('Pair a mobile device first.');
      return;
    }
    if (value.role === 'source' && !sourceAllowed(value, { silent })) return;
    const sourceRole = value.role === 'source';
    const generation = changeGeneration;
    let operation = sourceRole ? sourceOperationSnapshot(value) : authoritySnapshot(value);
    const requireCurrentOperation = () => {
      if (sourceRole) return requireSourceOperation(operation);
      if (ownsAuthority(operation)) return true;
      staleOperation();
      return false;
    };
    syncInProgress = true;
    refreshStatus(value, 'Syncing encrypted schedule…');
    try {
      if (!requireCurrentOperation()) return;
      const remote = await api(`/sync/pairs/${encodeURIComponent(value.pairId)}`, {}, value);
      if (!requireCurrentOperation()) return;
      validEncryptedRemote(remote);
      value.claimed = sourceRole ? value.claimed || Boolean(remote.claimed) : Boolean(remote.claimed);
      if (sourceRole && value.claimed
        && (Object.hasOwn(value, 'invitationToken') || Object.hasOwn(value, 'invitationExpiresAt'))) {
        requireSourceOperation(operation);
        delete value.invitationToken;
        delete value.invitationExpiresAt;
        saveCredentials(value);
        operation = sourceOperationSnapshot(value);
        requireSourceOperation(operation);
        localStorage.removeItem(PENDING_REFRESH_KEY);
      }
      if (changeGeneration !== generation) value.dirty = true;
      const remoteChanged = remote.revision !== value.revision && remote.updatedBy !== value.deviceId;
      if (remoteChanged && value.dirty) {
        const overwrite = confirm('Schedule changes were made on both devices.\n\nOK: keep this device’s version and overwrite the other device.\nCancel: use the other device’s version here.');
        if (!overwrite) {
          const imported = await decryptSchedule(remote, value.encryptionKey);
          if (!requireCurrentOperation()) return;
          value.revision = remote.revision;
          value.dirty = false;
          if (!requireCurrentOperation()) return;
          if (!commitScheduleAndCredentials(imported, value, operation)) return;
          if (sourceRole && value.claimed) {
            operation = sourceOperationSnapshot(value);
            requireSourceOperation(operation);
            localStorage.removeItem(PENDING_REFRESH_KEY);
          }
          return;
        }
        value.revision = remote.revision;
      } else if (remoteChanged || (!value.dirty && remote.revision > value.revision)) {
        const imported = await decryptSchedule(remote, value.encryptionKey);
        if (!requireCurrentOperation()) return;
        value.revision = remote.revision;
        value.dirty = false;
        if (!requireCurrentOperation()) return;
        if (!commitScheduleAndCredentials(imported, value, operation)) return;
        if (sourceRole && value.claimed) {
          operation = sourceOperationSnapshot(value);
          requireSourceOperation(operation);
          localStorage.removeItem(PENDING_REFRESH_KEY);
        }
        return;
      }
      if (value.dirty || pushLocal) {
        const encrypted = await encryptSchedule(window.getMedicationSchedule(), value.encryptionKey);
        if (!requireCurrentOperation()) return;
        const updated = await api(`/sync/pairs/${encodeURIComponent(value.pairId)}`, {
          method: 'PUT',
          body: JSON.stringify({ baseRevision: remote.revision, ...encrypted }),
        }, value);
        if (!requireCurrentOperation()) return;
        if (!Number.isInteger(updated?.revision) || updated.revision <= remote.revision) {
          throw Error('The sync service returned an invalid revision.');
        }
        value.revision = updated.revision;
        value.dirty = changeGeneration !== generation;
      } else {
        value.revision = remote.revision;
      }
      if (!requireCurrentOperation()) return;
      if (!guardedSaveCredentials(value, operation)) return;
      if (sourceRole && value.claimed) {
        operation = sourceOperationSnapshot(value);
        requireSourceOperation(operation);
        localStorage.removeItem(PENDING_REFRESH_KEY);
      }
    } catch (error) {
      if (error.status === 403) {
        showError('Cloud sync is paused for this pairing. Your offline schedule and pairing were kept.');
        if (!silent) alert('Cloud sync is not active right now. Your offline schedule was kept.');
        return;
      }
      if (error.verifiedRevocation && value.version === 2 && value.role === 'mobile') {
        if (!ownsAuthority(operation)) {
          staleOperation();
          return;
        }
        forgetMobileSchedule('Pairing was revoked. Local schedules were removed from this mobile app.', operation);
        if (!silent) alert('This pairing was revoked. Pair the devices again to resume sync.');
        return;
      }
      showError(`Sync failed: ${error.message}`);
      if (!silent) alert(`Sync failed: ${error.message}`);
    } finally {
      syncInProgress = false;
      if (credentials()?.dirty) {
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => void syncNow({ pushLocal: true, silent: true }), 1000);
      }
    }
  }

  async function unpair() {
    const value = credentials();
    if (!value) {
      if (installedMobile) await openScanner();
      return;
    }
    const operation = authoritySnapshot(value);
    if (value.role === 'mobile' || installedMobile) {
      const verification = prompt('Unpairing will permanently remove all schedules and taken-state data from this mobile app.\n\nType UNPAIR to continue:');
      if (verification !== 'UNPAIR') return;
      forgetMobileSchedule(undefined, operation);
      return;
    }
    try {
      requireSourceCloud(value);
    } catch (error) {
      alert(error.message);
      return;
    }
    if (!confirm('Unpair this device? This revokes the shared encrypted schedule and stops sync on both devices.')) return;
    try {
      await api(`/sync/pairs/${encodeURIComponent(value.pairId)}`, { method: 'DELETE' }, value);
    } catch (error) {
      alert(error.status === 404
        ? 'Revocation could not be confirmed for this account. The local pairing handle was kept.'
        : `Could not revoke pairing: ${error.message}`);
      return;
    }
    if (!ownsAuthority(operation)) {
      staleOperation();
      return;
    }
    removeCredentials();
    localStorage.removeItem(PENDING_REFRESH_KEY);
    refreshStatus(null, 'Device unpaired. Your local schedule was kept.');
  }

  window.addEventListener('medication-schedule-changed', () => {
    changeGeneration += 1;
    const value = credentials();
    if (!value) return;
    const operation = authoritySnapshot(value);
    value.dirty = true;
    if (!guardedSaveCredentials(value, operation)) return;
    if (value.role === 'source' && !sourceAllowed(value, { silent: true })) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void syncNow({ pushLocal: true, silent: true }), 700);
  });

  window.addEventListener('storage', event => {
    if (event.key === CREDENTIALS_KEY) {
      authorityGeneration += 1;
      const current = credentials();
      const claim = pendingClaim();
      if (claim && claim.pairId !== current?.pairId) localStorage.removeItem(PENDING_CLAIM_KEY);
      const refresh = storedJson(PENDING_REFRESH_KEY);
      if (refresh && (refresh.pairId !== current?.pairId
        || refresh.ownerUserId !== current?.ownerUserId)) {
        localStorage.removeItem(PENDING_REFRESH_KEY);
      }
      refreshStatus(current, 'Pairing state changed in another browser tab.');
    }
  });

  pairButton.onclick = showPairing;
  copyButton.onclick = copyPairLink;
  syncButton.onclick = () => void syncNow();
  unpairButton.onclick = unpair;
  dialog.querySelector('#copySecurePairLink').onclick = () => void copyPairLink();

  refreshStatus();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow({ silent: true });
  });
  window.addEventListener('focus', () => void syncNow({ silent: true }));
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'PAIR_REVOKED' && credentials()?.role === 'mobile') {
      showError('The source reported a pairing change. Open Sync to verify it; your offline schedule was kept.');
    }
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow({ silent: true });
  }, 60_000);

  function consumePendingAccessInvitation() {
    window.MedicationAccess.consumePendingInvitation();
  }

  async function processPendingInvitation() {
    const raw = window.MedicationAccess.pendingInvitation();
    if (!raw) return false;
    let invitation;
    try {
      invitation = parseInvitation(raw);
    } catch (error) {
      consumePendingAccessInvitation();
      showError(error.message);
      alert(error.message);
      return false;
    }
    if (installedMobile) {
      try {
        const result = await acceptPairing(invitation);
        if (result !== undefined) consumePendingAccessInvitation();
      } catch (error) {
        if (!retainableClaimFailure(error)) consumePendingAccessInvitation();
        const message = error.userMessage || error.message;
        showError(message);
        alert(`Pairing failed: ${message}`);
      }
      return true;
    }
    if (window.MedicationAccess.mode !== 'account') return false;
    try {
      const result = await importScheduleCopy(invitation);
      if (result?.terminal) consumePendingAccessInvitation();
    } catch (error) {
      if (!retainableClaimFailure(error)) consumePendingAccessInvitation();
      const message = error.userMessage || error.message;
      showError(message);
      alert(`Pairing failed: ${message}`);
    }
    return true;
  }

  const pendingRaw = window.MedicationAccess.pendingInvitation();
  if (pendingRaw) {
    if (installedMobile || window.MedicationAccess.mode === 'account') {
      void processPendingInvitation();
    } else {
      window.addEventListener('medication-access-ready', event => {
        if (event.detail?.mode === 'account') void processPendingInvitation();
        else if (event.detail?.mode === 'local') {
          showError('Sign in with Google before importing a cloud pairing.');
        }
      });
    }
  } else if (installedMobile && pendingClaim()) {
    setTimeout(() => void retryPendingClaim().catch(error => {
      showError(error.status === 403
        ? 'Cloud sync is paused for this pairing. Your existing offline schedule was kept.'
        : `Pairing retry paused: ${error.message}`);
    }), 0);
  } else if (installedMobile && localStorage.getItem(PENDING_CLAIM_KEY)) {
    localStorage.removeItem(PENDING_CLAIM_KEY);
    showError('The pending pairing invitation expired. Your existing local schedule was kept.');
  } else if (credentials()) {
    setTimeout(() => void syncNow({ silent: true }), 0);
  }

  window.addEventListener('medication-access-ready', event => {
    if (event.detail?.mode === 'account' && credentials()?.role === 'source') {
      void syncNow({ silent: true });
    }
  });
  window.addEventListener('medication-account-changed', () => {
    const value = credentials();
    if (value?.role === 'source' && sourceAllowed(value, { silent: true })) {
      void syncNow({ silent: true });
    }
  });

  window.MedicationSync = {
    createPair,
    syncNow,
    unpair,
    importScheduleCopy,
    retryPendingClaim,
    pairingLink,
    parseInvitation,
  };
})();
