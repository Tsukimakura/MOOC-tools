import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import {
  directPasswordLogin, encryptLoginPayload, LoginCookieJar, solveProof
} from '../src/direct_login.js';

const KEY = Buffer.from('BC60B8B9E4FFEFFA219E5AD77F11F9E2', 'hex');

function decrypt(value) {
  const decipher = createDecipheriv('sm4-ecb', KEY, null);
  decipher.setAutoPadding(true);
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(value, 'hex')), decipher.final()
  ]).toString('utf8'));
}

function jsonResponse(value, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(value), { headers });
}

test('登录请求使用网页当前采用的 SM4 编码', () => {
  assert.equal(encryptLoginPayload({}), '8d7db43f9974d58fa5dc2fb18b0a8421');
  assert.deepEqual(decrypt(encryptLoginPayload({ pd: 'imooc', channel: 1 })), {
    pd: 'imooc', channel: 1
  });
});

test('Cookie 容器遵守域、路径和安全属性', () => {
  const jar = new LoginCookieJar();
  jar.setFromHeader('one=1; Domain=.icourse163.org; Path=/; Secure; HttpOnly',
    'https://reg.icourse163.org/dl/zj/yd/ini');
  jar.setFromHeader('two=2; Path=/dl', 'https://reg.icourse163.org/dl/zj/yd/ini');
  assert.match(jar.header('https://www.icourse163.org/learn'), /one=1/);
  assert.doesNotMatch(jar.header('https://www.icourse163.org/learn'), /two=2/);
  assert.match(jar.header('https://reg.icourse163.org/dl/test'), /two=2/);
  assert.doesNotMatch(jar.header('http://www.icourse163.org/'), /one=1/);
});

test('短时计算题生成可复核的提交参数', async () => {
  const proof = await solveProof({
    needCheck: true, hashFunc: 'SHA256', sid: 'sid', maxTime: 1000,
    args: { puzzle: 'puzzle', target: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }
  });
  assert.equal(proof.sid, 'sid');
  assert.equal(proof.runTimes, 1);
  assert.deepEqual(JSON.parse(proof.args), {
    pow: '3d61d6e7e14d1ebda8b4d9152ff557328bf443803c2e40c03771f725e56d9bf4', n: 1
  });
});

test('手机号密码通过 HTTP 登录并收集课程会话', async () => {
  const calls = [];
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    calls.push({ url, options });
    if (options.method === 'GET') return new Response('<!doctype html>');
    const body = JSON.parse(options.body);
    const payload = decrypt(body.encParams);
    if (url.pathname.endsWith('/ini')) return jsonResponse({ ret: '201', capFlag: 0, pv: false });
    if (url.pathname.endsWith('/gt')) return jsonResponse({ ret: '201', tk: 'ticket' });
    if (url.pathname.endsWith('/pwd/l')) {
      assert.equal(payload.un, '10000000000');
      assert.notEqual(payload.pw, 'test-password');
      assert.equal(payload.tk, 'ticket');
      return jsonResponse({
        ret: '201', nextUrls: ['https://reg.icourse163.org/dl/common/setCookie?ticket=a%2Fb']
      }, [
        'NTESSTUDYSI=csrf; Domain=.icourse163.org; Path=/; Secure; HttpOnly',
        'STUDY_SESS=session; Domain=.icourse163.org; Path=/; Secure; HttpOnly'
      ]);
    }
    throw new Error(`意外请求：${url}`);
  };
  const result = await directPasswordLogin({
    username: '10000000000', password: 'test-password'
  }, { fetchImpl });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.cookies.map(({ name }) => name).sort(), ['NTESSTUDYSI', 'STUDY_SESS']);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 3);
  const sync = calls.find(({ url }) => url.pathname.endsWith('/common/setCookie'));
  assert.deepEqual(decrypt(sync.url.searchParams.get('encParams')), { ticket: 'a%2Fb' });
});

test('平台要求验证码时停止密码请求并交给浏览器', async () => {
  const paths = [];
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    paths.push(url.pathname);
    if (options.method === 'GET') return new Response('<!doctype html>');
    return jsonResponse({ ret: '201', capFlag: 4, pv: true });
  };
  const result = await directPasswordLogin({
    username: '10000000000', password: 'test-password'
  }, { fetchImpl });
  assert.equal(result.status, 'challenge');
  assert.equal(paths.some((path) => path.endsWith('/pwd/l')), false);
});

test('邮箱账号使用邮箱登录端点', async () => {
  const paths = [];
  const fetchImpl = async (urlValue, options) => {
    const url = new URL(urlValue);
    paths.push(url.pathname);
    if (options.method === 'GET') return new Response('<!doctype html>');
    if (url.pathname.endsWith('/ini')) return jsonResponse({ ret: '201', capFlag: 0, pv: false });
    if (url.pathname.endsWith('/gt')) return jsonResponse({ ret: '201', tk: 'ticket' });
    return jsonResponse({ ret: '201' }, [
      'NTESSTUDYSI=csrf; Domain=.icourse163.org; Path=/; Secure',
      'STUDY_SESS=session; Domain=.icourse163.org; Path=/; Secure'
    ]);
  };
  const result = await directPasswordLogin({
    username: 'user@example.invalid', password: 'test-password'
  }, { fetchImpl });
  assert.equal(result.status, 'success');
  assert.equal(paths.some((path) => path === '/dl/zj/mail/l'), true);
  assert.equal(paths.some((path) => path.includes('/yd/')), false);
});
