import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

globalThis.crypto ??= webcrypto;
const { resetGoogleKeysForTests, verifyGoogleCredential } = await import('../worker/src/auth.js');

const CLIENT_ID = '2793524917-3ghmb71lup4scgs96a65kf73i9vreed1.apps.googleusercontent.com';
const encoder = new TextEncoder();
const b64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

async function fixture(overrides = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: 'test-key', typ: 'JWT' };
  const claims = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '123456789012345678901',
    email: 'Person@Example.com',
    email_verified: true,
    name: 'Test Person',
    iat: now,
    exp: now + 300,
    ...overrides,
  };
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(unsigned));
  const token = `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
  const fetcher = async () => ({
    ok: true,
    headers: new Headers({ 'Cache-Control': 'max-age=60' }),
    async json() { return { keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }; },
  });
  return { token, fetcher, now };
}

test('Google identity tokens are signature, issuer, audience, expiry, and email verified', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher, now } = await fixture();
  const identity = await verifyGoogleCredential(token, CLIENT_ID, fetcher, now);
  assert.deepEqual(identity, {
    googleSubject: '123456789012345678901',
    email: 'person@example.com',
    displayName: 'Test Person',
    pictureUrl: null,
  });
});

test('a token issued for another OAuth client is rejected', async () => {
  resetGoogleKeysForTests();
  const { token, fetcher, now } = await fixture({ aud: 'attacker.apps.googleusercontent.com' });
  await assert.rejects(() => verifyGoogleCredential(token, CLIENT_ID, fetcher, now), /invalid_google_credential/);
});

test('expired and unverified Google identities are rejected', async () => {
  resetGoogleKeysForTests();
  const expired = await fixture({ exp: 100 });
  await assert.rejects(() => verifyGoogleCredential(expired.token, CLIENT_ID, expired.fetcher, expired.now), /invalid_google_credential/);
  resetGoogleKeysForTests();
  const unverified = await fixture({ email_verified: false });
  await assert.rejects(() => verifyGoogleCredential(unverified.token, CLIENT_ID, unverified.fetcher, unverified.now), /unverified_google_account/);
});
