import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { launchSession } from '../src/browser.js';
import { hasCourseSession, LOGIN_URL } from '../src/login.js';

const ORIGIN = 'https://www.icourse163.org';
const TIMEOUT_MS = 5 * 60_000;

function safeFieldName(name) {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : '[redacted]';
}

function bodyFields(request) {
  const body = request.postData();
  if (!body) return [];
  const type = request.headers()['content-type'] || '';
  try {
    if (type.includes('application/json')) {
      const data = JSON.parse(body);
      return data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).map(safeFieldName) : [];
    }
    if (type.includes('application/x-www-form-urlencoded')) {
      return [...new Set(new URLSearchParams(body).keys())].map(safeFieldName);
    }
    if (type.includes('multipart/form-data')) {
      return [...new Set([...body.matchAll(/name="([^"]+)"/g)].map((match) => match[1]))].map(safeFieldName);
    }
  } catch { /* A malformed body is left out of the report. */ }
  return [];
}

export function summarizeRequest(request) {
  const url = new URL(request.url());
  const pathname = url.pathname.split('/').map((segment, index, segments) =>
    /^\d{5,}$|^[a-f0-9-]{16,}$/i.test(segment) || segment.length > 40 || /@|%40/i.test(segment) ||
    /^(?:users?|profiles?)$/i.test(segments[index - 1] || '')
      ? '[redacted]' : segment
  ).join('/');
  return {
    method: request.method(),
    host: url.hostname,
    path: pathname,
    queryFields: [...new Set(url.searchParams.keys())].map(safeFieldName),
    bodyFields: bodyFields(request)
  };
}

export async function inspectLogin({ launch = launchSession, timeoutMs = TIMEOUT_MS } = {}) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'mooc-login-inspect-'));
  const report = [];
  const tracked = new WeakMap();
  const attached = new WeakSet();
  let browser;
  let loggedIn = false;
  let failure;
  try {
    const session = await launch({ profile, headless: false });
    browser = session.browser;
    const attach = (page) => {
      if (attached.has(page)) return;
      attached.add(page);
      page.on('request', (request) => {
        const method = request.method();
        const relevant = method !== 'GET' || request.isNavigationRequest?.() ||
          /login|auth|passport|session|oauth|sso/i.test(new URL(request.url()).pathname);
        if (!relevant || report.length >= 300) return;
        const entry = summarizeRequest(request);
        report.push(entry);
        tracked.set(request, entry);
      });
      page.on('response', (response) => {
        const entry = tracked.get(response.request());
        if (entry) entry.status = response.status();
      });
    };
    for (const page of await browser.pages()) attach(page);
    browser.on('targetcreated', async (target) => {
      const page = await target.page().catch(() => null);
      if (page) attach(page);
    });
    try { await session.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }); }
    catch (error) {
      if (!/Timeout/i.test(error.name) || !session.page.url().startsWith('https://www.icourse163.org/member/login.htm')) throw error;
    }
    process.stderr.write('请在浏览器完成一次登录；检测到课程会话后会自动关闭并生成脱敏报告。\n');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (session.page.isClosed()) break;
      const cookies = await session.page.browserContext().cookies(ORIGIN);
      if (hasCourseSession(cookies)) { loggedIn = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    failure = error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
  }
  const file = path.join(os.tmpdir(), `mooc-login-inspection-${Date.now()}.json`);
  await writeFile(file, JSON.stringify({ version: 1, loggedIn, requests: report }, null, 2), { mode: 0o600, flag: 'wx' });
  if (failure) throw new Error(`登录页检测未完成（${failure.name}）；已保存已观察到的请求结构：${file}`);
  return { file, loggedIn };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  inspectLogin().then(({ file, loggedIn }) => {
    process.stdout.write(`${loggedIn ? '检测到登录会话' : '未检测到登录会话'}；脱敏报告：${file}\n`);
  }).catch((error) => {
    process.stderr.write(`错误：${error.message}\n`);
    process.exitCode = 1;
  });
}
