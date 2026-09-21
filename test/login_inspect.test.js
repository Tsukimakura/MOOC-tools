import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRequest } from '../scripts/inspect-login.mjs';

function request(url, body, type = 'application/x-www-form-urlencoded') {
  return {
    url: () => url,
    method: () => 'POST',
    headers: () => ({ 'content-type': type }),
    postData: () => body
  };
}

test('登录请求报告仅保留字段名和脱敏路径，不保存凭据值', () => {
  const secret = 'do-not-share-password';
  const token = 'aabbccddeeff00112233445566778899';
  const result = summarizeRequest(request(
    `https://auth.example.org/login/${token}?ticket=${secret}`,
    new URLSearchParams({ username: 'private@example.org', password: secret, nonce: token }).toString()
  ));
  assert.deepEqual(result, {
    method: 'POST', host: 'auth.example.org', path: '/login/[redacted]',
    queryFields: ['ticket'], bodyFields: ['username', 'password', 'nonce']
  });
  assert.doesNotMatch(JSON.stringify(result), /do-not-share-password|aabbccddeeff|private@example/);
});

test('JSON 登录请求只提取顶层字段名', () => {
  const result = summarizeRequest(request('https://auth.example.org/api/login',
    JSON.stringify({ account: 'private@example.org', password: 'secret', captcha: { token: 'secret' } }),
    'application/json'));
  assert.deepEqual(result.bodyFields, ['account', 'password', 'captcha']);
  assert.doesNotMatch(JSON.stringify(result), /private@example|secret/);
});
