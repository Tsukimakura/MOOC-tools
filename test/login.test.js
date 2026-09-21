import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCourseSession, LOGIN_URL, login } from '../src/login.js';

const session = [
  { name: 'NTESSTUDYSI', value: 'csrf' },
  { name: 'STUDY_SESS', value: 'session' }
];

function fakeBrowser(cookies) {
  const result = { closed: false, page: { browserContext: () => ({ cookies: async () => cookies.value }), frames: () => [] } };
  result.browser = { close: async () => { result.closed = true; } };
  result.userDataDir = '/tmp/example-profile';
  return result;
}

test('登录使用专用登录页，并优先复用现有课程会话', async () => {
  assert.match(LOGIN_URL, /\/member\/login\.htm/);
  assert.equal(hasCourseSession(session), true);
  assert.equal(hasCourseSession([{ name: 'NTESSTUDYSI' }]), false);
  const result = await login({}, {}, {
    readSession: async () => session,
    verifySession: async () => true,
    withProgress: async (_label, action) => action(),
    launchSession: async () => { throw new Error('不应启动浏览器'); }
  });
  assert.match(result, /已有有效的本地会话/);
});

test('配置的账号先尝试无界面登录，成功后保存并关闭浏览器', async () => {
  const state = { value: [] };
  const background = fakeBrowser(state);
  const saved = [];
  const launched = [];
  const result = await login({}, { username: 'example', password: 'secret' }, {
    readSession: async () => null,
    launchSession: async (options) => { launched.push(options.headless); return background; },
    openLoginPage: async () => {},
    fillPasswordForm: async (_page, _credentials, submit) => { if (submit) state.value = session; return true; },
    verifySession: async () => true,
    saveSession: async (...args) => saved.push(args),
    withProgress: async (_label, action) => action()
  });
  assert.match(result, /自动登录成功/);
  assert.deepEqual(launched, [true]);
  assert.equal(background.closed, true);
  assert.deepEqual(saved[0][0], session);
});

test('需要人工验证时打开登录页，检测成功后保存并关闭浏览器', async () => {
  const background = fakeBrowser({ value: [] });
  const visible = fakeBrowser({ value: [] });
  const launched = [];
  const saved = [];
  const result = await login({}, { username: 'example', password: 'secret' }, {
    readSession: async () => null,
    launchSession: async (options) => { launched.push(options.headless); return options.headless ? background : visible; },
    openLoginPage: async () => {},
    fillPasswordForm: async (_page, _credentials, submit) => !submit,
    waitForSession: async (page) => page === visible.page ? session : null,
    verifySession: async () => true,
    saveSession: async (...args) => saved.push(args),
    withProgress: async (_label, action) => action()
  });
  assert.match(result, /会话已保存/);
  assert.deepEqual(launched, [true, false]);
  assert.equal(background.closed, true);
  assert.equal(visible.closed, true);
  assert.deepEqual(saved[0][0], session);
});

test('强制重新登录只清理课程认证 Cookie', async () => {
  const state = { value: [...session, { name: 'PREFERENCE', value: 'keep' }] };
  const background = fakeBrowser(state);
  const deleted = [];
  background.page.browserContext = () => ({
    cookies: async () => state.value,
    deleteCookie: async (...items) => {
      for (const item of items) {
        assert.equal(typeof item.value, 'string');
        deleted.push(item.name);
      }
      state.value = [];
    }
  });
  await login({ force: true }, { username: 'example', password: 'secret' }, {
    launchSession: async () => background,
    openLoginPage: async () => {},
    fillPasswordForm: async () => { state.value = session; return true; },
    verifySession: async () => true,
    saveSession: async () => {},
    withProgress: async (_label, action) => action()
  });
  assert.deepEqual(deleted.sort(), ['NTESSTUDYSI', 'STUDY_SESS']);
  assert.equal(background.closed, true);
});

test('浏览器资料中的会话失效时清理旧认证并重新尝试登录', async () => {
  const state = { value: session };
  const background = fakeBrowser(state);
  let cleared = false;
  background.page.browserContext = () => ({
    cookies: async () => state.value,
    deleteCookie: async () => { state.value = []; cleared = true; }
  });
  await login({}, { username: 'example', password: 'secret' }, {
    readSession: async () => null,
    verifySession: async () => cleared,
    launchSession: async () => background,
    openLoginPage: async () => {},
    fillPasswordForm: async () => { assert.equal(cleared, true); state.value = session; return true; },
    saveSession: async () => {},
    withProgress: async (_label, action) => action()
  });
  assert.equal(cleared, true);
});

test('人工登录只有通过课程会话验证后才保存和关闭', async () => {
  const background = fakeBrowser({ value: [] });
  const visible = fakeBrowser({ value: [] });
  const saved = [];
  let candidates = 0;
  await login({}, {}, {
    readSession: async () => null,
    launchSession: async (options) => options.headless ? background : visible,
    openLoginPage: async () => {},
    waitForSession: async () => [
      { name: 'NTESSTUDYSI', value: `csrf-${++candidates}` },
      { name: 'STUDY_SESS', value: `session-${candidates}` }
    ],
    verifySession: async () => candidates > 1,
    saveSession: async (cookies) => saved.push(cookies),
    withProgress: async (_label, action) => action()
  });
  assert.equal(candidates, 2);
  assert.equal(saved.length, 1);
  assert.equal(saved[0][1].value, 'session-2');
  assert.equal(visible.closed, true);
});
