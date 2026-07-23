import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('account client uses the public client ID indirectly and never embeds an OAuth secret', () => {
  const source = readFileSync('web/account.js', 'utf8');
  assert.match(source, /\/auth\/config/);
  assert.match(source, /\/auth\/google/);
  assert.doesNotMatch(source, /client_secret/i);
  assert.match(source, /Bearer \$\{sessionToken\}/);
});

test('pair creation requires server-derived Advanced access and sends the account session', () => {
  const source = readFileSync('web/sync.js', 'utf8');
  assert.match(source, /MedicationAccount\?\.requireAdvanced\(\)/);
  assert.match(source, /MedicationAccount\?\.authorizationHeaders\(\)/);
});

test('security policy permits Google Identity Services while blocking plugins and framing', () => {
  const headers = readFileSync('web/_headers', 'utf8');
  assert.match(headers, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(headers, /object-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
});
