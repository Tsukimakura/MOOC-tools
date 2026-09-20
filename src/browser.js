import os from 'node:os';
import path from 'node:path';
import { access, mkdir, readdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { normalizeAccountCourses, normalizeCourse, parseCourseInput } from './course.js';

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function browserExecutable(explicit) {
  if (explicit) {
    if (!(await exists(explicit))) throw new Error(`浏览器不存在：${explicit}`);
    return explicit;
  }
  const candidates = [
    process.env.MOOC_NOTES_BROWSER,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe')
  ].filter(Boolean);
  const cache = path.join(os.homedir(), '.cache/puppeteer/chrome');
  try {
    const versions = (await readdir(cache)).sort().reverse();
    for (const version of versions) candidates.push(path.join(cache, version, 'chrome-linux64/chrome'));
  } catch { /* Puppeteer cache is optional. */ }
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('找不到 Chrome/Chromium。安装浏览器后设置 MOOC_NOTES_BROWSER 为可执行文件路径。');
}

export function defaultProfile() {
  const stateRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state');
  return path.join(stateRoot, 'mooc-notes-cli/browser');
}

export async function launchSession(options = {}) {
  const userDataDir = path.resolve(options.profile || defaultProfile());
  await mkdir(userDataDir, { recursive: true, mode: 0o700 });
  const browser = await puppeteer.launch({
    executablePath: await browserExecutable(options.browser),
    userDataDir,
    headless: Boolean(options.headless),
    defaultViewport: { width: 1440, height: 900 },
    args: ['--disable-dev-shm-usage']
  });
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  page.setDefaultTimeout(15_000);
  return { browser, page, userDataDir };
}

async function navigate(page, url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }); }
    catch (error) {
      lastError = error;
      if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|Failed to fetch/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function loadCourse(page, input) {
  const parsed = parseCourseInput(input);
  await navigate(page, parsed.url);
  await page.waitForFunction(() => Boolean(window.termDto || window.moocTermDto), { timeout: 15_000 }).catch(() => {});
  const details = await page.evaluate(() => ({
    title: window.courseDto?.name || document.title?.replace(/_中国大学MOOC.*$/, '') || '',
    courseId: window.courseDto?.id || '',
    schoolShortName: window.schoolDto?.shortName || '',
    termId: window.moocTermDto?.id || window.termDto?.id || window.termDto?.termId || ''
  }));
  const termId = parsed.termId || String(details.termId || '');
  if (!termId || !/^\d+$/.test(termId)) throw new Error('无法识别课程期次；请使用含 tid 的课程链接。');
  const cookies = await page.browserContext().cookies('https://www.icourse163.org');
  const csrf = cookies.find((cookie) => cookie.name === 'NTESSTUDYSI')?.value || '';
  if (!csrf) throw new Error('缺少课程会话 Cookie；请先运行 mooc-notes login。');
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await page.evaluate(async ({ termId, csrf }) => {
        const body = new URLSearchParams({ termId });
        const result = await fetch(`/web/j/courseBean.getLastLearnedMocTermDto.rpc?csrfKey=${encodeURIComponent(csrf)}`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
        });
        if (!result.ok) throw new Error(`课程目录接口返回 HTTP ${result.status}`);
        return result.json();
      }, { termId, csrf });
      break;
    } catch (error) {
      if (attempt === 2 || !/Failed to fetch|ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  const raw = response?.result?.mocTermDto || response?.result?.termDto || null;
  if (!raw) throw new Error('课程目录不可用。请确认已登录、参加此期课程，并检查 tid；平台可能调整了接口。');
  const course = normalizeCourse(raw, { ...details, slug: parsed.slug || `${details.schoolShortName}-${details.courseId}`, termId });
  if (!course.units.length) throw new Error('课程目录中没有已发布的视频、文档或测验。');
  return course;
}

export async function loadAccountCourses(page) {
  if (!page.url().startsWith('https://www.icourse163.org/')) {
    await navigate(page, 'https://www.icourse163.org/');
  }
  const cookies = await page.browserContext().cookies('https://www.icourse163.org');
  const csrf = cookies.find((cookie) => cookie.name === 'NTESSTUDYSI')?.value;
  if (!csrf) throw new Error('缺少课程会话 Cookie；请先运行 mooc-notes login。');
  const items = [];
  let totalPages = 1;
  for (let pageNumber = 1; pageNumber <= Math.min(totalPages, 100); pageNumber++) {
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        data = await page.evaluate(async ({ csrf, pageNumber }) => {
          const response = await fetch(`/web/j/learnerCourseRpcBean.getMyLearnedCoursePanelList.rpc?csrfKey=${encodeURIComponent(csrf)}`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ type: '30', p: String(pageNumber), psize: '50', courseType: '1' }),
            signal: AbortSignal.timeout(30_000)
          });
          if (!response.ok) throw new Error(`个人课程接口 HTTP ${response.status}`);
          return response.json();
        }, { csrf, pageNumber });
        if (!Array.isArray(data?.result?.result)) throw new Error(`个人课程接口未返回课程列表（${data?.code ?? '未知错误'}）。`);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
    items.push(...data.result.result);
    totalPages = Number(data.result.pagination?.totlePageCount ?? data.result.pagination?.totalPageCount ?? 1) || 1;
  }
  return normalizeAccountCourses(items);
}

export async function openUnit(page, unit) {
  await navigate(page, unit.url);
  await new Promise((resolve) => setTimeout(resolve, 900));
}
