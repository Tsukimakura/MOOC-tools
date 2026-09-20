import os from 'node:os';
import path from 'node:path';
import { access, mkdir, readdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

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

export async function openUnit(page, unit) {
  await navigate(page, unit.url);
  await new Promise((resolve) => setTimeout(resolve, 900));
}
