import webpush from 'web-push';
import { authenticateSession, handleAuthRequest } from './auth.js';

const MAX_SYNC_BODY_BYTES = 96 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const ALLOWED_ORIGINS = new Set(['https://medication.bytesfx.com', 'https://medication-reminder-8h3.pages.dev']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 120;

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

function validEncryptedBody(body) {
  return typeof body?.ciphertext === 'string' && body.ciphertext.length >= 16 && body.ciphertext.length <= 80_000 && typeof body?.iv === 'string' && body.iv.length >= 12 && body.iv.length <= 64 && typeof body?.updatedBy === 'string' && ID_PATTERN.test(body.updatedBy);
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

async function authenticatedPair(request, env, pairId) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!ID_PATTERN.test(pairId) || token.length < 32 || token.length > 256) return null;
  return env.DB.prepare('SELECT pair_id, source_id, mobile_device_id, mobile_push_endpoint, ciphertext, iv, revision, updated_by, updated_at FROM sync_pairs WHERE pair_id = ? AND token_hash = ?').bind(pairId, await tokenHash(token)).first();
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

async function handleSync(request, env, url, ctx) {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' } });
  }
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(request, { error: 'Origin not allowed' }, { status: 403 });
  if (!(await enforceRateLimit(request, env))) return json(request, { error: 'Too many sync requests. Try again shortly.' }, { status: 429, headers: { 'Retry-After': '60' } });
  if (request.method === 'POST' && url.pathname === '/sync/pairs') {
    const body = await readJson(request);
    if (!ID_PATTERN.test(body?.pairId || '') || !ID_PATTERN.test(body?.sourceId || '') || typeof body?.token !== 'string' || body.token.length < 32 || body.token.length > 256 || !validEncryptedBody(body)) return json(request, { error: 'Invalid pairing request' }, { status: 400 });
    const account = await authenticateSession(request, env, { touch: false });
    if (request.headers.has('Authorization') && !account) return json(request, { error: 'Your account session has expired. Sign in again.' }, { status: 401 });
    const hash = await tokenHash(body.token);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sync_pairs WHERE source_id = ?').bind(body.sourceId),
      env.DB.prepare('INSERT INTO sync_pairs (pair_id, source_id, user_id, token_hash, ciphertext, iv, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(body.pairId, body.sourceId, account?.user.user_id || null, hash, body.ciphertext, body.iv, body.updatedBy),
    ]);
    return json(request, { ok: true, pairId: body.pairId, revision: 1 }, { status: 201 });
  }
  const match = url.pathname.match(/^\/sync\/pairs\/([A-Za-z0-9_-]{16,128})(?:\/(claim))?$/);
  if (!match) return null;
  const pair = await authenticatedPair(request, env, match[1]);
  if (!pair) return json(request, { error: 'Pairing not found or credentials invalid' }, { status: 404 });
  if (request.method === 'POST' && match[2] === 'claim') {
    const body = await readJson(request);
    if (!ID_PATTERN.test(body?.mobileDeviceId || '')) return json(request, { error: 'Invalid mobile device identifier' }, { status: 400 });
    if (body.pushEndpoint != null && (typeof body.pushEndpoint !== 'string' || body.pushEndpoint.length > 4096 || !body.pushEndpoint.startsWith('https://'))) return json(request, { error: 'Invalid push endpoint' }, { status: 400 });
    if (pair.mobile_device_id && pair.mobile_device_id !== body.mobileDeviceId) return json(request, { error: 'This pairing is already claimed by another mobile device' }, { status: 409 });
    await env.DB.prepare('UPDATE sync_pairs SET mobile_device_id = ?, mobile_push_endpoint = COALESCE(?, mobile_push_endpoint), updated_at = CURRENT_TIMESTAMP WHERE pair_id = ?').bind(body.mobileDeviceId, body.pushEndpoint || null, pair.pair_id).run();
    return json(request, { ok: true, revision: pair.revision });
  }
  if (request.method === 'GET' && !match[2]) return json(request, { pairId: pair.pair_id, ciphertext: pair.ciphertext, iv: pair.iv, revision: pair.revision, updatedBy: pair.updated_by, updatedAt: pair.updated_at, claimed: Boolean(pair.mobile_device_id) });
  if (request.method === 'PUT' && !match[2]) {
    const body = await readJson(request);
    if (!Number.isInteger(body?.baseRevision) || body.baseRevision < 1 || !validEncryptedBody(body)) return json(request, { error: 'Invalid sync update' }, { status: 400 });
    const result = await env.DB.prepare('UPDATE sync_pairs SET ciphertext = ?, iv = ?, revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE pair_id = ? AND token_hash = ? AND revision = ?').bind(body.ciphertext, body.iv, body.updatedBy, pair.pair_id, await tokenHash((request.headers.get('Authorization') || '').slice(7)), body.baseRevision).run();
    if (!result.meta.changes) return json(request, { error: 'Schedule changed on another device', currentRevision: pair.revision }, { status: 409 });
    if (pair.mobile_device_id && body.updatedBy !== pair.mobile_device_id && pair.mobile_push_endpoint) ctx.waitUntil(notifyPairedMobile(env, pair.mobile_push_endpoint));
    return json(request, { ok: true, revision: body.baseRevision + 1 });
  }
  if (request.method === 'DELETE' && !match[2]) {
    await env.DB.prepare('DELETE FROM sync_pairs WHERE pair_id = ?').bind(pair.pair_id).run();
    if (pair.mobile_push_endpoint) ctx.waitUntil(notifyPairedMobile(env, pair.mobile_push_endpoint, { title: 'Mobile schedule unpaired', body: 'This pairing ended. Open Medication Reminder to remove the old schedule.', tag: 'medication-pair-revoked', type: 'pair-revoked', url: '/' }));
    return json(request, { ok: true });
  }
  return json(request, { error: 'Method not allowed' }, { status: 405 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/auth/')) {
        const origin = request.headers.get('Origin');
        if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' } });
      }
      if (url.pathname.startsWith('/auth/')) {
        const origin = request.headers.get('Origin');
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(request, { error: 'Origin not allowed' }, { status: 403 });
        const response = await handleAuthRequest(request, env, url, { json, readJson, enforceRateLimit });
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
        for (const item of due) await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify({ title: item.title || 'Medication due', body: item.body || 'A scheduled reminder is due.', tag: item.tag || `medication-${item.dueAt}` }));
        const remaining = reminders.filter(item => Number(item.dueAt) > now);
        await env.DB.prepare('UPDATE push_subscriptions SET reminders = ?, last_sent_at = CURRENT_TIMESTAMP WHERE endpoint = ?').bind(JSON.stringify(remaining), row.endpoint).run();
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run();
      }
    }
  },
};
