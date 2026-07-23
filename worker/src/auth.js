const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_PREFIX = 'mrs_';
export const SESSION_COOKIE = 'mrs_session';
export const APP_ORIGIN = 'https://medication.bytesfx.com';
const SESSION_TOKEN_PATTERN = /^mrs_[A-Za-z0-9_-]{43}$/;
const MAX_CREDENTIAL_LENGTH = 8192;
const MAX_NAME_LENGTH = 120;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

let jwksCache = { expiresAt: 0, keys: [] };

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), character => character.charCodeAt(0));
  return bytes;
}

function parseJsonPart(value) {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
  } catch {
    throw new Error('invalid_google_credential');
  }
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(byteLength = 32) {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  const normalizedMaxAge = Number.isFinite(maxAge)
    ? Math.min(SESSION_TTL_SECONDS, Math.max(0, Math.trunc(maxAge)))
    : 0;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${normalizedMaxAge}`;
}

export function clearSessionCookie() {
  return sessionCookie('', 0);
}

export function parseSessionCredential(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const sessionCookieValues = [];
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    sessionCookieValues.push(part.slice(separator + 1).trim());
  }
  if (sessionCookieValues.length > 1) return null;

  let cookieToken = null;
  if (sessionCookieValues.length === 1) {
    try {
      const decoded = decodeURIComponent(sessionCookieValues[0]);
      if (SESSION_TOKEN_PATTERN.test(decoded)) cookieToken = decoded;
    } catch {
      // A malformed single cookie may fall back to a valid migration bearer.
    }
  }

  const authorization = request.headers.get('Authorization') || '';
  const bearerMatch = authorization.match(/^Bearer (mrs_[A-Za-z0-9_-]{43})$/);
  const bearerToken = bearerMatch?.[1] || null;
  if (cookieToken && bearerToken) {
    return cookieToken === bearerToken ? { kind: 'cookie', token: cookieToken } : null;
  }
  if (cookieToken) return { kind: 'cookie', token: cookieToken };
  if (bearerToken) return { kind: 'bearer', token: bearerToken };
  return null;
}

export function readSessionToken(request) {
  return parseSessionCredential(request)?.token || '';
}

export function validCsrfRequest(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  return request.headers.get('Origin') === APP_ORIGIN
    && request.headers.get('X-Medication-CSRF') === '1';
}

function cacheSeconds(response) {
  const match = (response.headers.get('Cache-Control') || '').match(/max-age=(\d+)/i);
  return Math.min(Math.max(Number(match?.[1] || 300), 60), 3600);
}

async function googleKeys(fetcher = fetch) {
  if (jwksCache.expiresAt > Date.now() && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetcher(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' }, cf: { cacheTtl: 300 } });
  if (!response.ok) throw new Error('google_keys_unavailable');
  const body = await response.json();
  if (!Array.isArray(body?.keys) || !body.keys.length) throw new Error('google_keys_unavailable');
  jwksCache = { keys: body.keys, expiresAt: Date.now() + cacheSeconds(response) * 1000 };
  return jwksCache.keys;
}

export async function verifyGoogleCredential(credential, clientId, fetcher = fetch, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > MAX_CREDENTIAL_LENGTH || typeof clientId !== 'string' || !clientId) {
    throw new Error('invalid_google_credential');
  }
  const parts = credential.split('.');
  if (parts.length !== 3) throw new Error('invalid_google_credential');
  const header = parseJsonPart(parts[0]);
  const claims = parseJsonPart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('invalid_google_credential');
  const jwk = (await googleKeys(fetcher)).find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) {
    jwksCache = { expiresAt: 0, keys: [] };
    throw new Error('google_signing_key_not_found');
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const validSignature = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const audienceValid = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  if (!validSignature || !GOOGLE_ISSUERS.has(claims.iss) || !audienceValid || !Number.isFinite(claims.exp) || claims.exp < nowSeconds - 60 || (claims.iat && claims.iat > nowSeconds + 300)) {
    throw new Error('invalid_google_credential');
  }
  if (typeof claims.sub !== 'string' || !/^\d{6,64}$/.test(claims.sub) || claims.email_verified !== true || typeof claims.email !== 'string') {
    throw new Error('unverified_google_account');
  }
  const email = claims.email.trim().toLowerCase();
  if (email.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('unverified_google_account');
  return {
    googleSubject: claims.sub,
    email,
    displayName: String(claims.name || email.split('@')[0]).trim().slice(0, MAX_NAME_LENGTH),
    pictureUrl: typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture.slice(0, 2048) : null,
  };
}

async function activeEntitlements(env, userId) {
  const result = await env.DB.prepare(`SELECT feature_key FROM user_entitlements
    WHERE user_id = ? AND state = 'active' AND valid_from <= CURRENT_TIMESTAMP
    AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP)`).bind(userId).all();
  return new Set((result.results || []).map(row => row.feature_key));
}

function accountView(user, entitlements) {
  return {
    user: {
      id: user.user_id,
      email: user.email_normalized,
      name: user.display_name,
      picture: user.picture_url,
      intendedStartDate: user.intended_start_date,
      intendedEndDate: user.intended_end_date,
    },
    plan: entitlements.has('advanced') ? 'advanced' : 'free',
    features: { advanced: entitlements.has('advanced'), cloudSync: entitlements.has('advanced') },
  };
}

export async function authenticateSession(
  request,
  env,
  { touch = true, includeEntitlements = true } = {},
) {
  const credential = parseSessionCredential(request);
  if (!credential) return null;
  const { token } = credential;
  const sessionHash = await sha256(token);
  const user = await env.DB.prepare(`SELECT u.user_id, u.email_normalized, u.display_name, u.picture_url,
      u.intended_start_date, u.intended_end_date, u.status, s.session_hash
    FROM app_sessions s JOIN app_users u ON u.user_id = s.user_id
    WHERE s.session_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.status = 'active'`).bind(sessionHash).first();
  if (!user) return null;
  if (touch) await env.DB.prepare('UPDATE app_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_hash = ?').bind(sessionHash).run();
  return {
    user,
    sessionHash,
    credentialKind: credential.kind,
    entitlements: includeEntitlements ? await activeEntitlements(env, user.user_id) : new Set(),
  };
}

function validOptionalDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error('invalid_usage_dates');
  return value;
}

async function audit(env, userId, eventType, metadata = {}) {
  await env.DB.prepare('INSERT INTO account_audit_events (event_id, user_id, event_type, metadata_json) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId || null, eventType, JSON.stringify(metadata).slice(0, 4000)).run();
}

export async function handleAuthRequest(request, env, url, helpers) {
  const {
    json,
    readJson,
    enforceRateLimit,
    apiVersion = 2,
  } = helpers;
  if (request.method === 'GET' && url.pathname === '/auth/config') {
    return json(request, { googleClientId: env.GOOGLE_CLIENT_ID || '', enabled: Boolean(env.GOOGLE_CLIENT_ID) });
  }
  if (request.method === 'POST' && url.pathname === '/auth/google') {
    if (!(await enforceRateLimit(request, env, 'auth', 20))) return json(request, { error: 'Too many sign-in attempts. Try again shortly.' }, { status: 429 });
    const body = await readJson(request);
    let identity;
    try {
      identity = await verifyGoogleCredential(body?.credential, env.GOOGLE_CLIENT_ID);
    } catch (error) {
      console.warn('google_sign_in_rejected', { reason: error.message });
      return json(request, { error: 'Google sign-in could not be verified.' }, { status: 401 });
    }
    const existing = await env.DB.prepare('SELECT user_id FROM app_users WHERE google_subject = ?').bind(identity.googleSubject).first();
    const userId = existing?.user_id || crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO app_users (user_id, google_subject, email_normalized, display_name, picture_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(google_subject) DO UPDATE SET email_normalized = excluded.email_normalized,
      display_name = excluded.display_name, picture_url = excluded.picture_url,
      updated_at = CURRENT_TIMESTAMP, last_login_at = CURRENT_TIMESTAMP`)
      .bind(userId, identity.googleSubject, identity.email, identity.displayName, identity.pictureUrl).run();
    const ownerEmail = String(env.OWNER_EMAIL || '').trim().toLowerCase();
    if (ownerEmail && identity.email === ownerEmail) {
      await env.DB.prepare(`INSERT INTO user_entitlements (user_id, feature_key, state, source)
        VALUES (?, 'advanced', 'active', 'owner_bootstrap')
        ON CONFLICT(user_id, feature_key) DO UPDATE SET state = 'active', valid_until = NULL,
        source = 'owner_bootstrap', updated_at = CURRENT_TIMESTAMP`).bind(userId).run();
    }
    if (body?.device && typeof body.device.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.device.id)
      && ['browser', 'pwa', 'windows', 'unknown'].includes(body.device.type)) {
      const deviceName = typeof body.device.name === 'string' ? body.device.name.trim().slice(0, 80) : null;
      await env.DB.prepare(`INSERT INTO user_devices (device_id, user_id, device_type, display_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
        device_type = excluded.device_type, display_name = excluded.display_name,
        last_seen_at = CURRENT_TIMESTAMP WHERE user_devices.user_id = excluded.user_id`)
        .bind(body.device.id, userId, body.device.type, deviceName).run();
    }
    const token = `${SESSION_PREFIX}${randomToken()}`;
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM app_sessions WHERE expires_at <= CURRENT_TIMESTAMP'),
      env.DB.prepare('INSERT INTO app_sessions (session_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, expiresAt),
    ]);
    const user = await env.DB.prepare(`SELECT user_id, email_normalized, display_name, picture_url,
      intended_start_date, intended_end_date FROM app_users WHERE user_id = ?`).bind(userId).first();
    const entitlements = await activeEntitlements(env, userId);
    await audit(env, userId, 'google_sign_in');
    // Temporary v1 compatibility. index.js assigns v1 only to original,
    // unprefixed workers.dev auth routes; /api requests can never enter here.
    if (apiVersion === 1) {
      return json(request, {
        ...accountView(user, entitlements),
        sessionToken: token,
        expiresAt,
      });
    }
    return json(request, accountView(user, entitlements), {
      headers: { 'Set-Cookie': sessionCookie(token) },
    });
  }
  if (!['/auth/me', '/auth/session'].includes(url.pathname)) return null;
  if (request.method === 'DELETE' && url.pathname === '/auth/session') {
    let account;
    try {
      account = await authenticateSession(request, env, {
        touch: false,
        includeEntitlements: false,
      });
    } catch {
      console.error('session_sign_out_lookup_failed');
      return json(request, { error: 'Session revocation could not be confirmed.' }, {
        status: 503,
        headers: { 'Set-Cookie': clearSessionCookie() },
      });
    }
    if (account) {
      try {
        await env.DB.prepare('DELETE FROM app_sessions WHERE session_hash = ?').bind(account.sessionHash).run();
      } catch {
        console.error('session_sign_out_revocation_failed');
        return json(request, { error: 'Session revocation could not be confirmed.' }, {
          status: 503,
          headers: { 'Set-Cookie': clearSessionCookie() },
        });
      }
      try {
        await audit(env, account.user.user_id, 'signed_out');
      } catch {
        console.warn('session_sign_out_audit_failed');
      }
    }
    return json(request, { ok: true }, {
      headers: { 'Set-Cookie': clearSessionCookie() },
    });
  }
  const account = await authenticateSession(request, env);
  if (!account) return json(request, { error: 'Sign-in required.' }, { status: 401 });
  if (request.method === 'GET' && url.pathname === '/auth/me') return json(request, accountView(account.user, account.entitlements));
  if (request.method === 'PATCH' && url.pathname === '/auth/me') {
    const body = await readJson(request);
    let startDate;
    let endDate;
    try {
      startDate = validOptionalDate(body?.intendedStartDate);
      endDate = validOptionalDate(body?.intendedEndDate);
      if (startDate && endDate && startDate > endDate) throw new Error('invalid_usage_dates');
    } catch {
      return json(request, { error: 'Enter a valid usage period. The end date must not precede the start date.' }, { status: 400 });
    }
    await env.DB.prepare(`UPDATE app_users SET intended_start_date = ?, intended_end_date = ?,
      updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).bind(startDate, endDate, account.user.user_id).run();
    await audit(env, account.user.user_id, 'usage_period_updated', { startDate, endDate });
    const user = { ...account.user, intended_start_date: startDate, intended_end_date: endDate };
    return json(request, accountView(user, account.entitlements));
  }
  return json(request, { error: 'Method not allowed' }, { status: 405 });
}

export function resetGoogleKeysForTests() {
  jwksCache = { expiresAt: 0, keys: [] };
}
