import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, validBridgeToken, validAction } from '../tgcloud/lib/validation.js';
import { OWNER_USER_ID, isOwner } from '../tgcloud/lib/config.js';
test('owner locked until configured', () => {
  assert.equal(OWNER_USER_ID, 0);
  assert.equal(isOwner(0), false);
  assert.equal(isOwner(123), false);
});
test('public HTTPS domain only', () => {
  assert.equal(normalizeBaseUrl('https://stream.example.org'), 'https://stream.example.org');
  for (const url of [
    'http://stream.example.org','https://127.0.0.1','https://localhost',
    'https://foo.internal','https://stream.example.org:80',
    'https://stream.example.org/path','https://bad:pass@stream.example.org',
    'https://-a.example.org','https://stream.example.org?q=1'
  ]) assert.throws(() => normalizeBaseUrl(url));
});
test('bridge token validation', () => {
  assert.ok(validBridgeToken('f'.repeat(64)));
  assert.ok(!validBridgeToken('f'.repeat(63)));
  assert.ok(!validBridgeToken('x'.repeat(64)));
});
test('action allowlist', () => {
  assert.ok(validAction('main', 'start'));
  assert.ok(validAction('channel_2', 'stop'));
  assert.ok(!validAction('../etc', 'start'));
  assert.ok(!validAction('main', 'delete'));
});
