import { MoocApi, readSession, saveSession } from './api.js';
import { launchSession } from './browser.js';
import { withProgress } from './progress.js';

export const LOGIN_URL = 'https://www.icourse163.org/member/login.htm#/webLoginIndex';
const ORIGIN = 'https://www.icourse163.org';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AUTH_COOKIES = new Set([
  'NTESSTUDYSI', 'STUDY_INFO', 'STUDY_SESS', 'STUDY_PERSIST',
  'NTES_YD_SESS', 'NTES_YD_PASSPORT', 'JSESSIONID'
]);

export function hasCourseSession(cookies) {
  const names = new Set(cookies.map((cookie) => cookie.name));
  return names.has('NTESSTUDYSI') && ['STUDY_SESS', 'STUDY_PERSIST', 'NTES_YD_SESS', 'NTES_YD_PASSPORT']
    .some((name) => names.has(name));
}

function sessionMarker(cookies) {
  return cookies.filter((cookie) => ['NTESSTUDYSI', 'STUDY_SESS', 'STUDY_PERSIST', 'NTES_YD_SESS', 'NTES_YD_PASSPORT'].includes(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`).sort().join(';');
}

async function cookiesFor(page) {
  return page.browserContext().cookies(ORIGIN);
}

async function verifySession(cookies) {
  try {
    const manualRedirect = (url, options) => fetch(url, { ...options, redirect: 'manual' });
    return await new MoocApi(cookies, manualRedirect, { timeout: 10_000, retries: 0 }).sessionActive();
  } catch (error) {
    if (/会话无效|缺少课程会话|平台接口 HTTP 30[1278]|not valid JSON|Unexpected token/i.test(error.message)) return false;
    return null;
  }
}

async function waitForSession(page, previousMarker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed?.()) throw new Error('登录浏览器已关闭，未保存新会话。');
    const cookies = await cookiesFor(page);
    if (hasCourseSession(cookies) && sessionMarker(cookies) !== previousMarker) return cookies;
    await wait(1000);
  }
  return null;
}

async function revealPasswordForm(page) {
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(() => {
        const visible = (element) => element.getClientRects().length > 0;
        const tabs = [...document.querySelectorAll('button, a, [role="tab"], [role="button"], span')];
        const tab = tabs.find((element) => visible(element) &&
          /^(?:账号密码登录|密码登录|邮箱登录|使用密码登录|Password login)$/i.test(element.textContent.trim()));
        tab?.click();
      });
    } catch { /* A cross-origin frame may disappear while the page loads. */ }
  }
}

async function fillPasswordForm(page, credentials, submit) {
  await revealPasswordForm(page);
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const frame of page.frames()) {
      try {
        const inputs = await frame.$$('input');
        const fields = await Promise.all(inputs.map((input) => input.evaluate((element) => ({
          type: (element.type || '').toLowerCase(),
          label: `${element.name} ${element.id} ${element.placeholder} ${element.autocomplete}`.toLowerCase(),
          visible: element.getClientRects().length > 0
        }))));
        const passwordIndex = fields.findIndex((field) => field.visible && field.type === 'password');
        if (passwordIndex < 0) continue;
        const candidates = fields.map((field, index) => ({ field, index }))
          .filter(({ field }) => field.visible && ['text', 'email', 'tel'].includes(field.type) &&
            !/验证码|短信|captcha|verify|code|otp/.test(field.label));
        candidates.sort((a, b) => Number(/账号|手机|邮箱|用户名|user|email|phone|account/.test(b.field.label)) -
          Number(/账号|手机|邮箱|用户名|user|email|phone|account/.test(a.field.label)) ||
          Math.abs(a.index - passwordIndex) - Math.abs(b.index - passwordIndex));
        if (!candidates.length) continue;
        const username = inputs[candidates[0].index];
        const password = inputs[passwordIndex];
        await username.click({ clickCount: 3 });
        await username.type(credentials.username);
        await password.click({ clickCount: 3 });
        await password.type(credentials.password);
        if (submit) {
          const clicked = await password.evaluate((element) => {
            let container = element.closest('form') || element.parentElement;
            for (let depth = 0; container && depth < 5; depth++, container = container.parentElement) {
              const button = [...container.querySelectorAll('button, input[type="submit"], [role="button"], a')]
                .find((candidate) => candidate.getClientRects().length > 0 &&
                  /^(?:登录|立即登录|登\s*录|log in|sign in)$/i.test(
                    (candidate.textContent || candidate.value || '').trim()
                  ));
              if (button) { button.click(); return true; }
            }
            return false;
          });
          if (!clicked) await password.press('Enter');
        }
        return true;
      } catch { /* Another frame or login method may still be loading. */ }
    }
    await wait(1000);
  }
  return false;
}

async function openLoginPage(page) {
  try { await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }); }
  catch (error) {
    if (!/Timeout/i.test(error.name) || !page.url().startsWith('https://www.icourse163.org/member/login.htm')) throw error;
  }
}

export async function login(options = {}, credentials = {}, dependencies = {}) {
  const launch = dependencies.launchSession || launchSession;
  const read = dependencies.readSession || readSession;
  const save = dependencies.saveSession || saveSession;
  const progress = dependencies.withProgress || withProgress;
  const verify = dependencies.verifySession || verifySession;
  const fill = dependencies.fillPasswordForm || fillPasswordForm;
  const open = dependencies.openLoginPage || openLoginPage;
  const awaitSession = dependencies.waitForSession || waitForSession;
  if (!options.force) {
    const existing = await read(options.profile);
    if (existing && hasCourseSession(existing)) {
      const valid = await progress('检查已有登录会话', () => verify(existing));
      if (valid === true) return '已有有效的本地会话；如需切换账号，运行 mooc-notes login --force。';
      if (valid === null) return '已有本地会话，但平台暂不可达，无法验证登录状态；可稍后重试。';
    }
  }
  const background = await launch({ ...options, headless: true });
  try {
    const stored = await cookiesFor(background.page);
    let clearStored = Boolean(options.force);
    if (!options.force && hasCourseSession(stored)) {
      const valid = await progress('检查浏览器登录会话', () => verify(stored));
      if (valid !== false) {
        await save(stored, background.userDataDir);
        return valid === true ? '已从浏览器资料恢复登录会话。' :
          '已恢复浏览器会话，但平台暂不可达，无法验证登录状态。';
      }
      clearStored = true;
    }
    if (clearStored) {
      const authentication = stored.filter((cookie) => AUTH_COOKIES.has(cookie.name));
      if (authentication.length) await background.page.browserContext().deleteCookie(
        ...authentication
      );
    }
    if (credentials.username && credentials.password) {
      const cookies = await progress('尝试使用本地账号登录', async () => {
        await open(background.page);
        const previous = sessionMarker(await cookiesFor(background.page));
        if (!(await fill(background.page, credentials, true))) return null;
        return awaitSession(background.page, previous, 20_000);
      }).catch(() => null);
      if (cookies) {
        const valid = await progress('验证登录状态', () => verify(cookies));
        if (valid !== false) {
          await save(cookies, background.userDataDir);
          return valid === true ? '自动登录成功，会话已保存。' :
            '已保存新会话，但平台暂不可达，无法验证课程权限。';
        }
      }
    }
  } finally { await background.browser.close(); }

  const visible = await launch({ ...options, headless: false });
  try {
    await open(visible.page);
    const previous = sessionMarker(await cookiesFor(visible.page));
    if (credentials.username && credentials.password) {
      await fill(visible.page, credentials, false).catch(() => false);
    }
    process.stderr.write('请在登录页完成验证码或手动登录；检测成功后会自动保存会话并关闭浏览器。\n');
    const deadline = Date.now() + 10 * 60_000;
    let marker = previous;
    while (Date.now() < deadline) {
      const cookies = await progress('等待登录完成', () =>
        awaitSession(visible.page, marker, deadline - Date.now()));
      if (!cookies) break;
      const valid = await progress('验证登录状态', () => verify(cookies));
      if (valid !== false) {
        await save(cookies, visible.userDataDir);
        return valid === true ? '会话已保存。' :
          '已保存新会话，但平台暂不可达，无法验证课程权限。';
      }
      marker = sessionMarker(cookies);
      process.stderr.write('已检测到 Cookie，但课程会话仍无效；请继续在浏览器中完成登录。\n');
    }
    throw new Error('10 分钟内未检测到有效登录；请重新运行 mooc-notes login。');
  } finally { await visible.browser.close(); }
}
