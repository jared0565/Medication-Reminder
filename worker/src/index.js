import webpush from 'web-push';
import {
  authenticateSession,
  hasCloudSync,
  handleAuthRequest,
  parseSessionCredential,
  recordAudit,
  validCsrfRequest,
} from './auth.js';

const MAX_SYNC_BODY_BYTES = 96 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MOBILE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ALLOWED_ORIGINS = new Set(['https://medication.bytesfx.com', 'https://medication-reminder-8h3.pages.dev']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 120;
const MOBILE_CREDENTIAL_DOMAIN = 'medication-reminder/mobile-credential/v1';
const INVITATION_REFRESH_DOMAIN = 'medication-reminder/invitation-refresh/v1';
const CSRF_PROTECTED_AUTH_ROUTES = new Set([
  'POST /auth/google',
  'PATCH /auth/me',
  'DELETE /auth/session',
]);

export function normalizePathname(pathname) {
  if (pathname === '/api') return '/';
  return pathname.startsWith('/api/') ? pathname.slice(4) : pathname;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return origin && ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function json(request, value, init = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...corsHeaders(request), ...(init.headers || {}) };
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_SYNC_BODY_BYTES) throw new Response('Payload too large', { status: 413 });
  const text = await request.text();
  if (text.length > MAX_SYNC_BODY_BYTES) throw new Response('Payload too large', { status: 413 });
  try { return JSON.parse(text); } catch { throw new Response('Invalid JSON', { status: 400 }); }
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function randomId(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return encodeBase64Url(bytes);
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(
    atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)),
    character => character.charCodeAt(0),
  );
}

function cloudCapabilitySql(userIdExpression) {
  return `EXISTS (
    SELECT 1
    FROM app_users capability_user
    JOIN user_entitlements capability_entitlement
      ON capability_entitlement.user_id = capability_user.user_id
    WHERE capability_user.user_id = ${userIdExpression}
      AND capability_user.status = 'active'
      AND capability_entitlement.feature_key = 'advanced'
      AND capability_entitlement.state = 'active'
      AND capability_entitlement.valid_from <= CURRENT_TIMESTAMP
      AND (capability_entitlement.valid_until IS NULL
        OR capability_entitlement.valid_until > CURRENT_TIMESTAMP)
  )`;
}

const PAIR_CLOUD_CAPABILITY_SQL = cloudCapabilitySql('sync_pairs.user_id');

async function deriveScopedToken(env, parts) {
  const secret = env.MOBILE_CREDENTIAL_SECRET;
  if (!MOBILE_TOKEN_PATTERN.test(secret || '')) throw new Error('mobile_credential_unavailable');
  let secretBytes;
  try {
    secretBytes = decodeBase64Url(secret);
  } catch {
    throw new Error('mobile_credential_unavailable');
  }
  if (secretBytes.length !== 32) throw new Error('mobile_credential_unavailable');
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = parts.join('\0');
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export function deriveMobileToken(env, value) {
  return deriveScopedToken(env, [
    MOBILE_CREDENTIAL_DOMAIN,
    value.pairId,
    value.invitationTokenHash,
    value.mobileDeviceId,
    value.claimNonce,
  ]);
}

export function deriveInvitationToken(env, value) {
  return deriveScopedToken(env, [
    INVITATION_REFRESH_DOMAIN,
    value.pairId,
    value.userId,
    value.previousInvitationTokenHash,
    value.refreshNonce,
  ]);
}

function invitationExpiry(now = Date.now()) {
  const invitationExpiresAt = new Date(now + 15 * 60_000).toISOString();
  return {
    invitationExpiresAt,
    storedInvitationExpiresAt: invitationExpiresAt.replace('T', ' ').replace(/\.\d{3}Z$/, ''),
  };
}

function publicStoredExpiry(value) {
  if (typeof value !== 'string') throw new Error('invalid_invitation_expiry');
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid_invitation_expiry');
  return parsed.toISOString();
}

function bearerToken(request) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  return match?.[1] || '';
}

function validEncryptedPayload(body) {
  return typeof body?.ciphertext === 'string'
    && body.ciphertext.length >= 16
    && body.ciphertext.length <= 80_000
    && typeof body?.iv === 'string'
    && body.iv.length >= 12
    && body.iv.length <= 64;
}

function validLegacyEncryptedBody(body) {
  return validEncryptedPayload(body)
    && typeof body?.updatedBy === 'string'
    && ID_PATTERN.test(body.updatedBy);
}

function validPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && host !== 'localhost' && !host.endsWith('.local') && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && !host.includes(':');
  } catch {
    return false;
  }
}

export async function loadAccountPair(env, pairId, userId) {
  return env.DB.prepare(`SELECT pair_id, source_id, user_id, invitation_token_hash,
      invitation_expires_at, invitation_consumed_at, mobile_device_id,
      mobile_push_endpoint, ciphertext, iv, revision, updated_by, updated_at,
      ${PAIR_CLOUD_CAPABILITY_SQL} AS cloud_sync_active
    FROM sync_pairs
    WHERE pair_id = ? AND user_id = ?`).bind(pairId, userId).first();
}

export async function loadMobilePair(env, pairId, deviceId, mobileTokenHash) {
  return env.DB.prepare(`SELECT pair_id, source_id, user_id, mobile_device_id,
      mobile_push_endpoint, ciphertext, iv, revision, updated_by, updated_at,
      ${PAIR_CLOUD_CAPABILITY_SQL} AS cloud_sync_active
    FROM sync_pairs
    WHERE pair_id = ? AND mobile_device_id = ? AND mobile_token_hash = ?`)
    .bind(pairId, deviceId, mobileTokenHash).first();
}

export async function loadLegacyPair(env, pairId, legacyTokenHash) {
  return env.DB.prepare(`SELECT pair_id, source_id, mobile_device_id,
      mobile_push_endpoint, ciphertext, iv, revision, updated_by, updated_at
    FROM sync_pairs
    WHERE pair_id = ? AND user_id IS NULL AND token_hash = ?`)
    .bind(pairId, legacyTokenHash).first();
}

export async function consumeInvitation(env, value) {
  return env.DB.prepare(`UPDATE sync_pairs SET
      mobile_token_hash = ?, mobile_device_id = ?,
      mobile_push_endpoint = COALESCE(?, mobile_push_endpoint),
      mobile_claimed_at = CURRENT_TIMESTAMP,
      invitation_consumed_at = CURRENT_TIMESTAMP
    WHERE pair_id = ? AND invitation_token_hash = ?
      AND invitation_consumed_at IS NULL
      AND invitation_expires_at > CURRENT_TIMESTAMP
      AND mobile_device_id IS NULL
      AND ${PAIR_CLOUD_CAPABILITY_SQL}
    RETURNING pair_id, source_id, user_id, mobile_device_id, mobile_push_endpoint,
      ciphertext, iv, revision, updated_by, updated_at`)
    .bind(
      value.mobileTokenHash,
      value.mobileDeviceId,
      value.pushEndpoint || null,
      value.pairId,
      value.invitationTokenHash,
    )
    .first();
}

export async function claimLegacyPair(env, value) {
  return env.DB.prepare(`UPDATE sync_pairs SET
      mobile_device_id = ?,
      mobile_push_endpoint = COALESCE(?, mobile_push_endpoint),
      updated_at = CURRENT_TIMESTAMP
    WHERE pair_id = ? AND user_id IS NULL AND token_hash = ?
      AND (mobile_device_id IS NULL OR mobile_device_id = ?)
    RETURNING pair_id, source_id, mobile_device_id, mobile_push_endpoint,
      ciphertext, iv, revision, updated_by, updated_at`)
    .bind(
      value.mobileDeviceId,
      value.pushEndpoint || null,
      value.pairId,
      value.legacyTokenHash,
      value.mobileDeviceId,
    )
    .first();
}

async function loadInvitationState(env, pairId, invitationTokenHash) {
  return env.DB.prepare(`SELECT pair_id, source_id, user_id, invitation_consumed_at,
      invitation_expires_at, mobile_token_hash, mobile_device_id,
      mobile_push_endpoint, ciphertext, iv, revision, updated_by, updated_at,
      invitation_expires_at > CURRENT_TIMESTAMP AS invitation_active,
      ${PAIR_CLOUD_CAPABILITY_SQL} AS cloud_sync_active
    FROM sync_pairs
    WHERE pair_id = ? AND user_id IS NOT NULL AND invitation_token_hash = ?`)
    .bind(pairId, invitationTokenHash).first();
}

function claimedPairResponse(pair, mobileToken) {
  return {
    pairId: pair.pair_id,
    mobileToken,
    ciphertext: pair.ciphertext,
    iv: pair.iv,
    revision: pair.revision,
    updatedBy: pair.updated_by,
    updatedAt: pair.updated_at,
  };
}

async function cookieAccount(request, env, includeEntitlements = true) {
  const credential = parseSessionCredential(request);
  if (credential?.kind !== 'cookie') return null;
  return authenticateSession(request, env, { touch: false, includeEntitlements });
}

async function accountPair(request, env, pairId) {
  const account = await cookieAccount(request, env);
  if (!account) return { account, pair: null };
  return { account, pair: await loadAccountPair(env, pairId, account.user.user_id) };
}

async function activeCloudSyncForUser(env, userId) {
  const row = await env.DB.prepare(
    `SELECT ${cloudCapabilitySql('?')} AS active`,
  ).bind(userId).first();
  return Boolean(Number(row?.active));
}

async function mobilePair(request, env, pairId) {
  const token = bearerToken(request);
  const deviceId = request.headers.get('X-Medication-Device') || '';
  if (!ID_PATTERN.test(pairId) || !ID_PATTERN.test(deviceId) || token.length < 40) return null;
  return loadMobilePair(env, pairId, deviceId, await tokenHash(token));
}

async function safeRecordPairAudit(env, userId, eventType, metadata) {
  try {
    await recordAudit(env, userId, eventType, metadata);
  } catch {
    console.error('sync_pair_audit_failed', { eventType, pairId: metadata.pairId });
  }
}

function pairAuditMetadata(pairId, deviceId, revision, result) {
  return {
    pairId,
    deviceId: deviceId || null,
    revision: Number(revision || 0),
    result,
  };
}

async function enforceRateLimit(request, env, namespace = 'sync', limit = RATE_LIMIT_REQUESTS) {
  const identity = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucketKey = await tokenHash(`${namespace}:${identity}`);
  const now = Date.now();
  const windowStart = now - (now % RATE_LIMIT_WINDOW_MS);
  const row = await env.DB.prepare('SELECT window_start, request_count FROM sync_rate_limits WHERE bucket_key = ?').bind(bucketKey).first();
  if (row && Number(row.window_start) === windowStart && Number(row.request_count) >= limit) return false;
  await env.DB.prepare(`INSERT INTO sync_rate_limits (bucket_key, window_start, request_count) VALUES (?, ?, 1)
    ON CONFLICT(bucket_key) DO UPDATE SET window_start = excluded.window_start,
    request_count = CASE WHEN sync_rate_limits.window_start = excluded.window_start THEN sync_rate_limits.request_count + 1 ELSE 1 END`)
    .bind(bucketKey, windowStart).run();
  return true;
}

async function notifyPairedMobile(env, endpoint, notification = {}) {
  if (!endpoint) return;
  const subscription = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).first();
  if (!subscription) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify({ title: 'Schedule updated', body: 'Open Medication Reminder to securely sync the latest changes.', tag: 'medication-sync-update', url: '/', ...notification }),
    );
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
    else console.error('paired_mobile_notification_failed', { status: error?.statusCode || 0 });
  }
}

const PAIR_AUTHORIZATION_FAILURE = { error: 'Pairing not found or credentials invalid' };

async function handleSync(request, env, url, ctx) {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Medication-CSRF, X-Medication-Device', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' } });
  }
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(request, { error: 'Origin not allowed' }, { status: 403 });
  if (!(await enforceRateLimit(request, env))) return json(request, { error: 'Too many sync requests. Try again shortly.' }, { status: 429, headers: { 'Retry-After': '60' } });

  if (request.method === 'POST' && url.pathname === '/sync/pairs') {
    const account = await cookieAccount(request, env);
    if (!account) return json(request, { error: 'Sign-in required.' }, { status: 401 });
    if (!validCsrfRequest(request)) {
      return json(request, { error: 'Invalid browser request' }, { status: 403 });
    }
    if (!hasCloudSync(account)) return json(request, { error: 'Cloud synchronization is not enabled for this account.' }, { status: 403 });
    const body = await readJson(request);
    if (!ID_PATTERN.test(body?.sourceId || '') || !validEncryptedPayload(body)) {
      return json(request, { error: 'Invalid pairing request' }, { status: 400 });
    }
    const pairId = randomId();
    const invitationToken = randomId(32);
    const { invitationExpiresAt, storedInvitationExpiresAt } = invitationExpiry();
    const invitationTokenHash = await tokenHash(invitationToken);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sync_pairs WHERE source_id = ? AND user_id = ?')
        .bind(body.sourceId, account.user.user_id),
      env.DB.prepare(`INSERT INTO sync_pairs
        (pair_id, source_id, user_id, token_hash, invitation_token_hash, invitation_expires_at,
          ciphertext, iv, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          pairId,
          body.sourceId,
          account.user.user_id,
          invitationTokenHash,
          invitationTokenHash,
          storedInvitationExpiresAt,
          body.ciphertext,
          body.iv,
          body.sourceId,
        ),
    ]);
    await safeRecordPairAudit(
      env,
      account.user.user_id,
      'sync_pair_created',
      pairAuditMetadata(pairId, body.sourceId, 1, 'created'),
    );
    return json(request, { pairId, invitationToken, invitationExpiresAt, revision: 1 }, { status: 201 });
  }

  const match = url.pathname.match(/^\/sync\/pairs\/([A-Za-z0-9_-]{16,128})(?:\/(claim|invitations))?$/);
  if (!match) return null;

  const pairId = match[1];
  if (request.method === 'POST' && match[2] === 'claim') {
    if (await cookieAccount(request, env, false)) {
      return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
    }
    const body = await readJson(request);
    if (!ID_PATTERN.test(body?.mobileDeviceId || '')) return json(request, { error: 'Invalid mobile device identifier' }, { status: 400 });
    if (body.pushEndpoint != null && !validPushEndpoint(body.pushEndpoint)) {
      return json(request, { error: 'Invalid push endpoint' }, { status: 400 });
    }
    if (body.claimNonce != null && !MOBILE_TOKEN_PATTERN.test(body.claimNonce)) {
      return json(request, { error: 'Invalid claim nonce' }, { status: 400 });
    }
    const invitationToken = bearerToken(request);
    if (!invitationToken) return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
    const invitationTokenHash = await tokenHash(invitationToken);

    const legacyPair = await claimLegacyPair(env, {
      pairId,
      legacyTokenHash: invitationTokenHash,
      mobileDeviceId: body.mobileDeviceId,
      pushEndpoint: body.pushEndpoint || null,
    });
    if (legacyPair) {
      return json(request, { ok: true, revision: legacyPair.revision });
    }
    if (await loadLegacyPair(env, pairId, invitationTokenHash)) {
      return json(request, { error: 'This pairing is already claimed by another mobile device' }, { status: 409 });
    }

    const claimNonce = body?.claimNonce;
    if (!MOBILE_TOKEN_PATTERN.test(claimNonce || '')) {
      return json(request, { error: 'Invalid claim nonce' }, { status: 400 });
    }
    const mobileToken = await deriveMobileToken(env, {
      pairId,
      invitationTokenHash,
      mobileDeviceId: body.mobileDeviceId,
      claimNonce,
    });
    const mobileTokenHash = await tokenHash(mobileToken);
    const claimedPair = await consumeInvitation(env, {
      pairId,
      invitationTokenHash,
      mobileTokenHash,
      mobileDeviceId: body.mobileDeviceId,
      pushEndpoint: body.pushEndpoint || null,
    });
    if (!claimedPair) {
      const state = await loadInvitationState(env, pairId, invitationTokenHash);
      if (!state) return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
      const exactRetry = state.invitation_consumed_at
        && state.mobile_device_id === body.mobileDeviceId
        && state.mobile_token_hash === mobileTokenHash;
      if (exactRetry) {
        if (!Number(state.cloud_sync_active)) {
          return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
        }
        return json(request, claimedPairResponse(state, mobileToken));
      }
      if (state.invitation_consumed_at) {
        return json(request, { error: 'Pairing invitation already used' }, { status: 410 });
      }
      if (Number(state.invitation_active) && !Number(state.cloud_sync_active)) {
        return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
      }
      return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
    }
    await safeRecordPairAudit(
      env,
      claimedPair.user_id,
      'sync_pair_claimed',
      pairAuditMetadata(pairId, body.mobileDeviceId, claimedPair.revision, 'claimed'),
    );
    return json(request, claimedPairResponse(claimedPair, mobileToken));
  }

  if (request.method === 'POST' && match[2] === 'invitations') {
    const body = await readJson(request);
    if (!MOBILE_TOKEN_PATTERN.test(body?.previousInvitationToken || '')
      || !MOBILE_TOKEN_PATTERN.test(body?.refreshNonce || '')) {
      return json(request, { error: 'Valid invitation refresh proof required' }, { status: 400 });
    }
    const { account, pair } = await accountPair(request, env, pairId);
    if (!pair) return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
    if (account.credentialKind === 'cookie' && !validCsrfRequest(request)) {
      return json(request, { error: 'Invalid browser request' }, { status: 403 });
    }
    if (!Number(pair.cloud_sync_active)) {
      return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
    }
    if (pair.mobile_device_id) return json(request, { error: 'This pairing already has a mobile device.' }, { status: 409 });
    const previousInvitationTokenHash = await tokenHash(body.previousInvitationToken);
    const invitationToken = await deriveInvitationToken(env, {
      pairId,
      userId: account.user.user_id,
      previousInvitationTokenHash,
      refreshNonce: body.refreshNonce,
    });
    const invitationTokenHash = await tokenHash(invitationToken);
    if (pair.invitation_token_hash === invitationTokenHash) {
      const exactReplay = await env.DB.prepare(`UPDATE sync_pairs SET
          invitation_expires_at = CASE
            WHEN invitation_expires_at IS NULL OR invitation_expires_at <= CURRENT_TIMESTAMP
              THEN datetime(CURRENT_TIMESTAMP, '+15 minutes')
            ELSE invitation_expires_at
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE pair_id = ? AND user_id = ? AND invitation_token_hash = ?
          AND invitation_consumed_at IS NULL
          AND mobile_device_id IS NULL
          AND ${PAIR_CLOUD_CAPABILITY_SQL}
        RETURNING invitation_expires_at`)
        .bind(pairId, account.user.user_id, invitationTokenHash)
        .first();
      if (!exactReplay) {
        if (!(await activeCloudSyncForUser(env, account.user.user_id))) {
          return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
        }
        return json(request, { error: 'Pairing invitation changed. Refresh and try again.' }, { status: 409 });
      }
      return json(request, {
        pairId,
        invitationToken,
        invitationExpiresAt: publicStoredExpiry(exactReplay.invitation_expires_at),
      });
    }
    if (pair.invitation_token_hash !== previousInvitationTokenHash) {
      return json(request, { error: 'Pairing invitation changed. Refresh and try again.' }, { status: 409 });
    }
    const { storedInvitationExpiresAt } = invitationExpiry();
    const result = await env.DB.prepare(`UPDATE sync_pairs SET invitation_token_hash = ?,
      invitation_expires_at = ?, invitation_consumed_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE pair_id = ? AND user_id = ? AND invitation_token_hash = ?
        AND mobile_device_id IS NULL
        AND ${PAIR_CLOUD_CAPABILITY_SQL}
      RETURNING pair_id`)
      .bind(
        invitationTokenHash,
        storedInvitationExpiresAt,
        pairId,
        account.user.user_id,
        previousInvitationTokenHash,
      ).first();
    if (!result) {
      if (!(await activeCloudSyncForUser(env, account.user.user_id))) {
        return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
      }
      return json(request, { error: 'Pairing invitation changed. Refresh and try again.' }, { status: 409 });
    }
    await safeRecordPairAudit(
      env,
      account.user.user_id,
      'sync_pair_invited',
      pairAuditMetadata(pairId, null, pair.revision, 'invited'),
    );
    return json(request, {
      pairId,
      invitationToken,
      invitationExpiresAt: publicStoredExpiry(storedInvitationExpiresAt),
    });
  }

  if (match[2]) return json(request, { error: 'Method not allowed' }, { status: 405 });

  let account = null;
  let pair = null;
  let authorizationKind = '';
  const credential = parseSessionCredential(request);
  if (credential?.kind === 'cookie') {
    const accountResult = await accountPair(request, env, pairId);
    account = accountResult.account;
    pair = accountResult.pair;
    if (account) {
      if (bearerToken(request) || !pair) {
        return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
      }
      authorizationKind = 'account';
    }
  }
  if (!pair) {
    pair = await mobilePair(request, env, pairId);
    if (pair) authorizationKind = 'mobile';
  }
  let legacyTokenHash = '';
  if (!pair) {
    const token = bearerToken(request);
    if (token) {
      legacyTokenHash = await tokenHash(token);
      pair = await loadLegacyPair(env, pairId, legacyTokenHash);
      if (pair) authorizationKind = 'legacy';
    }
  }
  if (!pair) return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });

  if (['GET', 'PUT'].includes(request.method)) {
    const cloudSyncActive = authorizationKind === 'account'
      ? Boolean(Number(pair.cloud_sync_active))
      : authorizationKind === 'mobile'
        ? Boolean(Number(pair.cloud_sync_active))
        : true;
    if (!cloudSyncActive) {
      return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
    }
  }

  if (request.method === 'GET') {
    return json(request, {
      pairId: pair.pair_id,
      ciphertext: pair.ciphertext,
      iv: pair.iv,
      revision: pair.revision,
      updatedBy: pair.updated_by,
      updatedAt: pair.updated_at,
      claimed: Boolean(pair.mobile_device_id),
    });
  }

  if (request.method === 'PUT' && !match[2]) {
    if (authorizationKind === 'account' && account.credentialKind === 'cookie' && !validCsrfRequest(request)) {
      return json(request, { error: 'Invalid browser request' }, { status: 403 });
    }
    const body = await readJson(request);
    const encryptedBodyValid = authorizationKind === 'legacy'
      ? validLegacyEncryptedBody(body)
      : validEncryptedPayload(body);
    if (!Number.isInteger(body?.baseRevision) || body.baseRevision < 1 || !encryptedBodyValid) {
      return json(request, { error: 'Invalid sync update' }, { status: 400 });
    }
    let statement;
    let deviceId = null;
    if (authorizationKind === 'account') {
      statement = env.DB.prepare(`UPDATE sync_pairs SET ciphertext = ?, iv = ?,
        revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE pair_id = ? AND user_id = ? AND revision = ?
          AND ${PAIR_CLOUD_CAPABILITY_SQL}`)
        .bind(body.ciphertext, body.iv, pair.source_id, pairId, account.user.user_id, body.baseRevision);
      deviceId = pair.source_id;
    } else if (authorizationKind === 'mobile') {
      const mobileTokenHash = await tokenHash(bearerToken(request));
      deviceId = request.headers.get('X-Medication-Device');
      statement = env.DB.prepare(`UPDATE sync_pairs SET ciphertext = ?, iv = ?,
        revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE pair_id = ? AND mobile_device_id = ? AND mobile_token_hash = ? AND revision = ?
          AND ${PAIR_CLOUD_CAPABILITY_SQL}`)
        .bind(body.ciphertext, body.iv, deviceId, pairId, deviceId, mobileTokenHash, body.baseRevision);
    } else {
      statement = env.DB.prepare(`UPDATE sync_pairs SET ciphertext = ?, iv = ?,
        revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE pair_id = ? AND user_id IS NULL AND token_hash = ? AND revision = ?`)
        .bind(body.ciphertext, body.iv, body.updatedBy, pairId, legacyTokenHash, body.baseRevision);
    }
    const result = await statement.run();
    if (!result.meta.changes) {
      if (authorizationKind === 'account'
        && !(await activeCloudSyncForUser(env, account.user.user_id))) {
        return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
      }
      if (authorizationKind === 'mobile') {
        const current = await loadMobilePair(
          env,
          pairId,
          deviceId,
          await tokenHash(bearerToken(request)),
        );
        if (current && !Number(current.cloud_sync_active)) {
          return json(request, { error: 'Cloud sync is not active for this pairing' }, { status: 403 });
        }
      }
      return json(request, { error: 'Schedule changed on another device', currentRevision: pair.revision }, { status: 409 });
    }
    if (authorizationKind === 'account' || authorizationKind === 'mobile') {
      await safeRecordPairAudit(
        env,
        authorizationKind === 'account' ? account.user.user_id : pair.user_id,
        'sync_pair_updated',
        pairAuditMetadata(pairId, deviceId, body.baseRevision + 1, 'updated'),
      );
    }
    if (pair.mobile_device_id && authorizationKind !== 'mobile' && pair.mobile_push_endpoint) {
      ctx.waitUntil(notifyPairedMobile(env, pair.mobile_push_endpoint));
    }
    return json(request, { ok: true, revision: body.baseRevision + 1 });
  }

  if (request.method === 'DELETE' && !match[2]) {
    if (authorizationKind === 'mobile') return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
    if (authorizationKind === 'account' && account.credentialKind === 'cookie' && !validCsrfRequest(request)) {
      return json(request, { error: 'Invalid browser request' }, { status: 403 });
    }
    const result = authorizationKind === 'account'
      ? await env.DB.prepare('DELETE FROM sync_pairs WHERE pair_id = ? AND user_id = ?')
        .bind(pairId, account.user.user_id).run()
      : await env.DB.prepare('DELETE FROM sync_pairs WHERE pair_id = ? AND user_id IS NULL AND token_hash = ?')
        .bind(pairId, legacyTokenHash).run();
    if (Number(result.meta?.changes || 0) !== 1) return json(request, PAIR_AUTHORIZATION_FAILURE, { status: 404 });
    if (authorizationKind === 'account') {
      await safeRecordPairAudit(
        env,
        account.user.user_id,
        'sync_pair_revoked',
        pairAuditMetadata(pairId, null, pair.revision, 'revoked'),
      );
    }
    if (pair.mobile_push_endpoint) ctx.waitUntil(notifyPairedMobile(env, pair.mobile_push_endpoint, { title: 'Mobile schedule unpaired', body: 'This pairing ended. Open Medication Reminder to remove the old schedule.', tag: 'medication-pair-revoked', type: 'pair-revoked', url: '/' }));
    return json(request, { ok: true });
  }
  return json(request, { error: 'Method not allowed' }, { status: 405 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isV2ApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/');
    // Temporary v1 rollout branch: only the configured exact legacy hostname
    // and original unprefixed paths retain bearer behavior. Capture before normalization.
    const isLegacyV1Request = !isV2ApiRequest && url.hostname === env.LEGACY_V1_HOST;
    url.pathname = normalizePathname(url.pathname);
    try {
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/auth/')) {
        const origin = request.headers.get('Origin');
        if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Medication-CSRF', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' } });
      }
      if (url.pathname.startsWith('/auth/')) {
        const origin = request.headers.get('Origin');
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(request, { error: 'Origin not allowed' }, { status: 403 });
        if (CSRF_PROTECTED_AUTH_ROUTES.has(`${request.method} ${url.pathname}`)) {
          const credential = parseSessionCredential(request);
          const legacyCookieMutation = isLegacyV1Request
            && ['PATCH', 'DELETE'].includes(request.method)
            && credential?.kind === 'cookie';
          const csrfRequired = !isLegacyV1Request || legacyCookieMutation;
          if (csrfRequired && !validCsrfRequest(request)) {
            return json(request, { error: 'Invalid browser request' }, { status: 403 });
          }
        }
        const response = await handleAuthRequest(request, env, url, {
          json,
          readJson,
          enforceRateLimit,
          apiVersion: isLegacyV1Request ? 1 : 2,
        });
        if (response) return response;
      }
      if (url.pathname.startsWith('/sync/')) {
        const response = await handleSync(request, env, url, ctx);
        if (response) return response;
      }
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } });
      console.error('request_failed', { path: url.pathname, error: String(error) });
      return json(request, { error: 'Service temporarily unavailable' }, { status: 503 });
    }
    if (request.method === 'OPTIONS' && ['/subscriptions', '/vapid-public-key'].includes(url.pathname)) {
      const origin = request.headers.get('Origin');
      if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method === 'GET' && url.pathname === '/health') return json(request, { ok: true, service: 'medication-reminder-push' });
    if (request.method === 'GET' && url.pathname === '/vapid-public-key') return json(request, { publicKey: env.VAPID_PUBLIC_KEY });
    if (request.method === 'POST' && url.pathname === '/subscriptions') {
      const origin = request.headers.get('Origin');
      if (origin && !ALLOWED_ORIGINS.has(origin)) return json(request, { error: 'Origin not allowed' }, { status: 403 });
      if (!(await enforceRateLimit(request, env))) return json(request, { error: 'Too many requests. Try again shortly.' }, { status: 429, headers: { 'Retry-After': '60' } });
      let body;
      try { body = await readJson(request); } catch (error) { if (error instanceof Response) return new Response(error.body, { status: error.status, headers: { ...corsHeaders(request), 'Cache-Control': 'no-store' } }); throw error; }
      const endpointValid = validPushEndpoint(body?.endpoint);
      const keysValid = typeof body?.keys?.p256dh === 'string' && body.keys.p256dh.length <= 512 && typeof body?.keys?.auth === 'string' && body.keys.auth.length <= 512;
      if (!endpointValid || !keysValid) return json(request, { error: 'Invalid push subscription' }, { status: 400 });
      const now = Date.now(), latest = now + 10 * 86_400_000;
      const reminders = (Array.isArray(body.reminders) ? body.reminders : []).slice(0, 32).filter(item => Number.isFinite(Number(item?.dueAt)) && Number(item.dueAt) > now - 60_000 && Number(item.dueAt) <= latest).map(item => ({ dueAt: Number(item.dueAt), title: 'Medication reminder due', body: 'Open Medication Reminder to view the scheduled medicines.', tag: `medication-${Number(item.dueAt)}` }));
      const timezone = typeof body.timezone === 'string' && body.timezone.length <= 100 ? body.timezone : 'UTC';
      await env.DB.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, timezone, reminders) VALUES (?, ?, ?, ?, ?)').bind(body.endpoint, body.keys.p256dh, body.keys.auth, timezone, JSON.stringify(reminders)).run();
      return json(request, { ok: true });
    }
    return json(request, { error: 'Not found' }, { status: 404 });
  },
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM sync_rate_limits WHERE window_start < ?').bind(Date.now() - 86_400_000).run();
    const rows = await env.DB.prepare('SELECT endpoint, p256dh, auth, reminders FROM push_subscriptions').all();
    const now = Date.now();
    for (const row of rows.results || []) {
      let reminders = []; try { reminders = JSON.parse(row.reminders || '[]'); } catch { reminders = []; }
      const due = reminders.filter(item => Number(item.dueAt) <= now);
      if (!due.length) continue;
      try {
        webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        for (const item of due) await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify({ title: item.title || 'Medication due', body: item.body || 'A scheduled reminder is due.', tag: item.tag || `medication-${item.dueAt}`, dueAt: Number(item.dueAt), url: `/?dueAt=${Number(item.dueAt)}` }));
        const remaining = reminders.filter(item => Number(item.dueAt) > now);
        await env.DB.prepare('UPDATE push_subscriptions SET reminders = ?, last_sent_at = CURRENT_TIMESTAMP WHERE endpoint = ?').bind(JSON.stringify(remaining), row.endpoint).run();
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run();
      }
    }
  },
};
