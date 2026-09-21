import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { isIP } from 'node:net';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { defaultProfile, launchSession } from './browser.js';
import { normalizeAccountCourses, normalizeCourse, parseCourseInput } from './course.js';
import { resourceSignature, normalizeVideoUrl } from './stream.js';
import { questionsFromDwr } from './quiz.js';
import { memberIdFromCookies } from './auth.js';

const ORIGIN = 'https://www.icourse163.org';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SESSION_COOKIES = new Set([
  'NTESSTUDYSI', 'STUDY_INFO', 'STUDY_SESS', 'STUDY_PERSIST',
  'NETEASE_WDA_UID', 'JSESSIONID', 'NTES_YD_SESS', 'NTES_YD_PASSPORT', 'EDUWEBDEVICE'
]);

export function sessionPath(profile = defaultProfile()) {
  const stateRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state');
  const key = createHash('sha256').update(path.resolve(profile)).digest('hex').slice(0, 12);
  return path.join(stateRoot, 'mooc-notes-cli', `session-${key}.json`);
}

function validCookie(cookie) {
  return cookie && SESSION_COOKIES.has(cookie.name) && typeof cookie.value === 'string' &&
    ['.icourse163.org', 'icourse163.org', 'www.icourse163.org'].includes(cookie.domain);
}

export async function saveSession(cookies, profile) {
  const selected = cookies.filter(validCookie);
  if (!selected.some((cookie) => cookie.name === 'NTESSTUDYSI')) throw new Error('未找到课程会话；请先运行 mooc-notes login。');
  const file = sessionPath(profile);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, cookies: selected }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return selected;
}

export async function readSession(profile) {
  try {
    const data = JSON.parse(await readFile(sessionPath(profile), 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.cookies)) throw new Error('会话文件格式无效。');
    const cookies = data.cookies.filter(validCookie).filter((cookie) => !cookie.expires || cookie.expires < 0 || cookie.expires > Date.now() / 1000);
    if (!cookies.some((cookie) => cookie.name === 'NTESSTUDYSI')) return null;
    if (cookies.length !== data.cookies.length || ((await stat(sessionPath(profile))).mode & 0o777) !== 0o600) {
      await saveSession(cookies, profile);
    }
    return cookies;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function syncBrowserSession(options = {}) {
  const profile = path.resolve(options.profile || defaultProfile());
  const existing = await stat(profile).catch(() => null);
  if (!existing?.isDirectory()) throw new Error('尚未登录；请先运行 mooc-notes login。');
  const { browser, page } = await launchSession({ ...options, headless: true });
  try {
    const cookies = await page.browserContext().cookies(ORIGIN);
    return await saveSession(cookies, options.profile);
  } finally { await browser.close(); }
}

function cookieHeader(cookies, url) {
  const parsed = new URL(url);
  const now = Date.now() / 1000;
  return cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, '');
    return (parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)) &&
      parsed.pathname.startsWith(cookie.path || '/') &&
      (!cookie.secure || parsed.protocol === 'https:') &&
      (!cookie.expires || cookie.expires < 0 || cookie.expires > now);
  }).map(({ name, value }) => `${name}=${value}`).join('; ');
}

export class MoocApi {
  constructor(cookies, fetchImpl = fetch, { timeout = 30_000, retries = 2 } = {}) {
    this.cookies = cookies.filter(validCookie);
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.retries = retries;
    this.memberId = null;
  }

  csrf() {
    const value = this.cookies.find((cookie) => cookie.name === 'NTESSTUDYSI')?.value;
    if (!value) throw new Error('缺少课程会话；请运行 mooc-notes login。');
    return value;
  }

  async request(url, { method = 'GET', body, timeout = this.timeout, retries = this.retries, auth = true, text = false } = {}) {
    const target = new URL(url, ORIGIN);
    if (target.protocol !== 'https:' || !['www.icourse163.org', 'vod.study.163.com'].includes(target.hostname)) {
      throw new Error('不支持的 API 主机。');
    }
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const headers = { Referer: `${ORIGIN}/` };
        if (method === 'POST') {
          headers.Origin = ORIGIN;
          headers['Content-Type'] = typeof body === 'string' ? 'text/plain' : 'application/x-www-form-urlencoded';
        }
        if (auth) headers.Cookie = cookieHeader(this.cookies, target.href);
        const response = await this.fetch(target, {
          method, headers, body, signal: AbortSignal.timeout(timeout), redirect: 'error'
        });
        if (response.status === 401 || response.status === 403) throw new Error(`课程会话无效（HTTP ${response.status}）；请运行 mooc-notes login。`);
        if (!response.ok) throw new Error(`平台接口 HTTP ${response.status}`);
        return text ? response.text() : response.json();
      } catch (error) {
        lastError = error;
        if (attempt === retries || !/fetch failed|network|timed out|timeout|ECONNRESET|HTTP 5\d\d/i.test(error.message)) break;
        await wait(800 * (attempt + 1));
      }
    }
    throw lastError;
  }

  rpc(name, params) {
    return this.request(`/web/j/${name}.rpc?csrfKey=${encodeURIComponent(this.csrf())}`, {
      method: 'POST', body: new URLSearchParams(params)
    });
  }

  async sessionActive() {
    const data = await this.rpc('learnerCourseRpcBean.getMyLearnedCoursePanelList', {
      type: '30', p: '1', psize: '1', courseType: '1'
    });
    return Array.isArray(data?.result?.result);
  }

  async accountCourses() {
    const items = [];
    let total = 1;
    for (let page = 1; page <= Math.min(total, 100); page++) {
      const data = await this.rpc('learnerCourseRpcBean.getMyLearnedCoursePanelList', {
        type: '30', p: String(page), psize: '50', courseType: '1'
      });
      if (!Array.isArray(data?.result?.result)) throw new Error(`账号课程接口没有返回列表（${data?.code ?? '未知错误'}）；请重新登录或稍后重试。`);
      items.push(...data.result.result);
      total = Number(data.result.pagination?.totlePageCount ?? data.result.pagination?.totalPageCount ?? 1) || 1;
    }
    return normalizeAccountCourses(items);
  }

  async course(input) {
    const parsed = parseCourseInput(input);
    let account;
    if (!parsed.termId) {
      const courses = await this.accountCourses();
      const id = parsed.slug?.match(/-(\d+)$/)?.[1] || parsed.url.match(/cid=(\d+)/)?.[1];
      account = courses.find((item) => item.slug === parsed.slug) ||
        courses.find((item) => item.slug.endsWith(`-${id}`));
      if (!account) throw new Error('账号课程中找不到该课程的期次；请确认已参加课程，或传入包含 tid 的完整链接。');
    } else {
      account = { slug: parsed.slug, termId: parsed.termId, title: '' };
    }
    const data = await this.rpc('courseBean.getLastLearnedMocTermDto', { termId: account.termId });
    const raw = data?.result?.mocTermDto || data?.result?.termDto;
    if (!raw) throw new Error('课程目录不可用。请确认已登录、参加此期课程，并检查 tid；平台可能调整了接口。');
    const course = normalizeCourse(raw, { slug: account.slug, termId: account.termId, title: account.title });
    if (!course.units.length) throw new Error('课程目录中没有已发布的视频、文档或测验。');
    return course;
  }

  async getMemberId() {
    if (this.memberId) return this.memberId;
    const cookieId = memberIdFromCookies(this.cookies);
    if (cookieId) { this.memberId = cookieId; return cookieId; }
    let html = '';
    try { html = await this.request('/home.htm', { text: true }); } catch { /* Some sessions redirect HTML pages while RPC remains usable. */ }
    const id = html.match(/userId=(\d+)/)?.[1] || html.match(/id\s*:\s*"(\d+)",\s*nickName\s*:/)?.[1];
    if (!id) throw new Error('会话中没有可用的用户编号；请重新运行 mooc-notes login。');
    this.memberId = id;
    return id;
  }

  async videoStream(unit) {
    if (!/^\d+$/.test(unit.id) || unit.type !== 'video') throw new Error('无效的视频课时编号。');
    const timestamp = String(Date.now());
    const sign = resourceSignature(unit.id, unit.contentType, timestamp, await this.getMemberId());
    const token = await this.rpc('resourceRpcBean.getResourceTokenV2', {
      bizId: unit.id, bizType: '1', contentType: String(unit.contentType), timestamp, sign
    });
    const dto = token?.result?.videoSignDto;
    if (!dto?.signature || !dto?.videoId) throw new Error(`资源令牌不可用（${token?.code ?? '未知错误'}）。`);
    const data = await this.request('https://vod.study.163.com/eds/api/v1/vod/video', {
      method: 'POST', auth: false,
      body: new URLSearchParams({ clientType: '1', signature: dto.signature, videoId: String(dto.videoId) })
    });
    const videos = (data?.result?.videos || [])
      .filter((video) => !video.e && ['hls', 'mp4'].includes(video.format))
      .map((video) => ({ ...video, videoUrl: normalizeVideoUrl(video.videoUrl) }))
      .filter((video) => video.videoUrl)
      .sort((a, b) => Number(b.quality) - Number(a.quality));
    if (!videos.length) throw new Error('视频资源接口没有提供可用的视频流。');
    return {
      url: videos[0].videoUrl, format: videos[0].format,
      duration: Number(dto.duration) || Number(data.result?.duration) || 0,
      captions: (data.result?.srtCaptions || []).map((caption) => normalizeVideoUrl(caption.url)).filter(Boolean)
    };
  }

  async videoQuestions(unit) {
    const anchors = (unit.anchors || []).filter((item) => Number.isFinite(item.time) && /^\d+$/.test(item.id));
    if (!anchors.length) return [];
    const lines = [
      'callCount=1', 'scriptSessionId=${scriptSessionId}190', 'c0-scriptName=MocQuizBean',
      'c0-methodName=fetchQuestions', 'c0-id=0',
      'c0-param0=Object_Object:{id:reference:c0-e1,anchorQuestions:reference:c0-e2}',
      `c0-e1=number:${unit.id}`
    ];
    let next = 3;
    const objects = [];
    const nested = [];
    for (const anchor of anchors) {
      const timeRef = `c0-e${next++}`;
      const idRef = `c0-e${next++}`;
      const objectRef = `c0-e${next++}`;
      nested.push(`${timeRef}=number:${anchor.time}`, `${idRef}=number:${anchor.id}`,
        `${objectRef}=Object_Object:{anchor:reference:${timeRef},questionId:reference:${idRef}}`);
      objects.push(`reference:${objectRef}`);
    }
    lines.push(`c0-e2=Array:[${objects.join(',')}]`, ...nested, `batchId=${Date.now()}`);
    const times = new Map(anchors.map((item) => [item.id, item.time]));
    let questions = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const dwr = await this.request(`/dwr/call/plaincall/MocQuizBean.fetchQuestions.dwr?csrfKey=${encodeURIComponent(this.csrf())}`, {
        method: 'POST', body: lines.join('\n'), text: true
      });
      questions = questionsFromDwr(dwr).map((question, index) => ({
        ...question, time: times.get(question.id) ?? anchors[index]?.time ?? null
      }));
      if (questions.length >= anchors.length) break;
      if (attempt < 2) await wait(500 * (attempt + 1));
    }
    return questions;
  }

  async lessonUnitDwr(unit) {
    if (!/^\d+$/.test(unit.id) || !/^\d+$/.test(unit.contentId)) return '';
    const session = this.cookies.find((cookie) => cookie.name === 'JSESSIONID')?.value || '${scriptSessionId}';
    const body = [
      'callCount=1', `scriptSessionId=${session}190`, 'c0-scriptName=CourseBean',
      'c0-methodName=getLessonUnitLearnVo', 'c0-id=0',
      `c0-param0=number:${unit.contentId}`, `c0-param1=number:${unit.contentType}`,
      'c0-param2=number:0', `c0-param3=number:${unit.id}`, `batchId=${Date.now()}`
    ].join('\n');
    return this.request(`/dwr/call/plaincall/CourseBean.getLessonUnitLearnVo.dwr?csrfKey=${encodeURIComponent(this.csrf())}`, {
      method: 'POST', body, text: true
    });
  }

  async quizQuestions(unit) {
    if (unit.type !== 'quiz') return [];
    return questionsFromDwr(await this.lessonUnitDwr(unit));
  }

  async download(url, limit = 8_000_000) {
    let current = new URL(url, ORIGIN);
    for (let redirects = 0; redirects < 4; redirects++) {
      if (current.protocol === 'http:') current.protocol = 'https:';
      if (current.protocol !== 'https:' || isIP(current.hostname) ||
        !/(^|\.)(icourse163\.org|163\.com|126\.net|127\.net|netease\.com)$/.test(current.hostname)) return null;
      const response = await this.fetch(current, {
        headers: { Referer: `${ORIGIN}/`, Cookie: cookieHeader(this.cookies, current.href) },
        redirect: 'manual', signal: AbortSignal.timeout(30_000)
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        current = new URL(location, current);
        continue;
      }
      if (!response.ok || Number(response.headers.get('content-length') || 0) > limit) return null;
      const type = response.headers.get('content-type') || '';
      const chunks = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > limit) return null;
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks), type };
    }
    return null;
  }

  async resource(url, limit = 8_000_000) {
    const resource = await this.download(url, limit);
    return /^image\/(?:jpeg|png|webp)/i.test(resource?.type || '') ? resource : null;
  }
}
