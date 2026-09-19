import path from 'node:path';
import { isIP } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { findVideo, imageSignature, overlaySubtitle, sceneDifference, seekVideo, subtitleCuesFromPayloads, trackCues, videoDuration } from './media.js';
import { dedupeCues, parseSubtitle } from './subtitles.js';
import { mergeQuestions, questionsFromData, questionsFromPage } from './quiz.js';
import { openUnit } from './browser.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class NetworkObserver {
  constructor(page) {
    this.page = page;
    this.payloads = [];
    this.pending = new Set();
    this.handler = (response) => {
      const url = response.url();
      if (!/\.(?:srt|vtt)(?:[?#]|$)|subtitle|caption|quiz|question|test/i.test(url)) return;
      const task = (async () => {
        try {
          const body = await response.text();
          if (body.length > 2_000_000) return;
          const kind = /\.(?:srt|vtt)(?:[?#]|$)|subtitle|caption/i.test(url) ? 'subtitle' : 'question';
          this.payloads.push({ kind, url, text: body });
        } catch { /* Binary and blocked responses are ignored. */ }
      })();
      this.pending.add(task);
      task.finally(() => this.pending.delete(task));
    };
    page.on('response', this.handler);
  }

  async stop() {
    this.page.off('response', this.handler);
    await Promise.allSettled([...this.pending]);
    return this.payloads;
  }
}

function decodeDwr(value) {
  try { return JSON.parse(`"${value}"`); } catch { return value.replaceAll('\\/', '/'); }
}

export function resourceUrlsFromDwr(text) {
  const matches = [];
  const pattern = /(?:\burl|\btextOrigUrl|\btextUrl)\s*[:=]\s*"((?:\\.|[^"\\])*)"/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    const url = decodeDwr(match[1]);
    if (/^https?:\/\//.test(url)) matches.push(url);
  }
  return [...new Set(matches)];
}

export async function fetchUnitDwr(page, unit) {
  if (!/^\d+$/.test(unit.id) || !/^\d+$/.test(unit.contentId)) return '';
  const cookies = await page.browserContext().cookies('https://www.icourse163.org');
  const csrf = cookies.find((cookie) => cookie.name === 'NTESSTUDYSI')?.value;
  if (!csrf) return '';
  return page.evaluate(async ({ unit, csrf }) => {
    const session = document.cookie.match(/(?:^|;\s*)JSESSIONID=([^;]+)/)?.[1] || '${scriptSessionId}';
    const body = [
      'callCount=1', `scriptSessionId=${session}190`, 'c0-scriptName=CourseBean',
      'c0-methodName=getLessonUnitLearnVo', 'c0-id=0',
      `c0-param0=number:${unit.contentId}`, `c0-param1=number:${unit.contentType}`,
      'c0-param2=number:0', `c0-param3=number:${unit.id}`, `batchId=${Date.now()}`
    ].join('\n');
    const response = await fetch(`/dwr/call/plaincall/CourseBean.getLessonUnitLearnVo.dwr?csrfKey=${encodeURIComponent(csrf)}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body
    });
    return response.ok ? response.text() : '';
  }, { unit: { id: unit.id, contentId: unit.contentId, contentType: unit.contentType }, csrf }).catch(() => '');
}

function allowedResource(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !isIP(parsed.hostname) &&
      /(^|\.)(icourse163\.org|163\.com|126\.net|127\.net|netease\.com)$/.test(parsed.hostname);
  } catch { return false; }
}

export async function fetchResource(page, url, limit = 50_000_000) {
  let current;
  try {
    const parsed = new URL(url, 'https://www.icourse163.org');
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    current = parsed.href;
  } catch { return null; }
  if (!allowedResource(current)) return null;
  for (let redirects = 0; redirects < 4; redirects++) {
    const cookies = await page.browserContext().cookies(current);
    const headers = { Referer: 'https://www.icourse163.org/' };
    if (cookies.length) headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const response = await fetch(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      const redirected = new URL(location, current);
      if (redirected.protocol === 'http:') redirected.protocol = 'https:';
      current = redirected.href;
      if (!allowedResource(current)) return null;
      continue;
    }
    if (!response.ok || Number(response.headers.get('content-length') || 0) > limit) return null;
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > limit) {
        await response.body.cancel().catch(() => {});
        return null;
      }
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type') || '' };
  }
  return null;
}

function questionPayloads(payloads) {
  const questions = [];
  for (const item of payloads.filter((item) => item.kind === 'question')) {
    try { questions.push(...questionsFromData(JSON.parse(item.text))); } catch { /* Some endpoints use DWR JavaScript. */ }
  }
  return questions;
}

export async function captureUnit(page, unit, assetRoot, options = {}) {
  const observer = new NetworkObserver(page);
  const record = { ...unit, screenshots: [], cues: [], questions: [], attachments: [], warnings: [], text: '' };
  const assetDir = path.join(assetRoot, unit.id);
  await mkdir(assetDir, { recursive: true });
  try {
    await openUnit(page, unit);
    let dwr = '';
    if (unit.type !== 'quiz') dwr = await fetchUnitDwr(page, unit);
    if (unit.type === 'video') await captureVideo(page, record, assetDir, options, dwr);
    else if (unit.type === 'document') await captureDocument(page, record, assetDir, dwr);
    else await captureQuiz(page, record, assetDir);
  } catch (error) {
    record.warnings.push(`采集失败：${error.message}`);
  }
  await wait(350);
  const payloads = await observer.stop();
  record.cues = dedupeCues([...record.cues, ...subtitleCuesFromPayloads(payloads)]);
  record.questions = mergeQuestions(record.questions, questionPayloads(payloads));
  if (unit.type === 'video' && !record.cues.length) record.warnings.push('未找到可读取的字幕。');
  if (unit.type === 'quiz' && !record.questions.length) record.warnings.push('此 Quiz 的题目未在当前学习页面显示；未自动开始答题。');
  record.ok = !record.warnings.some((warning) => warning.startsWith('采集失败：'));
  delete record.contentUrl;
  return record;
}

async function captureVideo(page, record, assetDir, options, dwr) {
  const video = await findVideo(page);
  if (!video) {
    record.warnings.push('视频播放器未加载，无法截图。');
    return;
  }
  const duration = await videoDuration(video.frame);
  if (!duration) {
    record.warnings.push('无法读取视频时长，无法按时间采样截图。');
    return;
  }
  const subtitleUrls = resourceUrlsFromDwr(dwr).filter((url) => /\.(?:srt|vtt)(?:[?#]|$)/i.test(url));
  for (const url of subtitleUrls) {
    try {
      const resource = await fetchResource(page, url, 5_000_000);
      if (resource) record.cues.push(...parseSubtitle(resource.bytes.toString('utf8')));
    } catch { /* Subtitle URLs may expire. */ }
  }
  record.cues.push(...await trackCues(video.frame));
  record.cues = dedupeCues(record.cues);
  const interval = options.interval ?? 2;
  const maxFrames = options.maxFrames ?? 160;
  const minGap = options.minGap ?? 3;
  const maxSilentGap = options.maxSilentGap ?? 60;
  const threshold = options.threshold ?? 12;
  let lastSignature = null;
  let lastCapture = -Infinity;
  const observedQuestions = [];
  const observedCues = [];
  async function sample(actual) {
    observedQuestions.push(...await questionsFromPage(page, actual));
    const subtitle = await overlaySubtitle(video.frame, actual);
    if (subtitle) observedCues.push(subtitle);
    if (options.quizzesOnly || record.screenshots.length >= maxFrames) return;
    const png = await video.element.screenshot({ type: 'png' });
    const signature = await imageSignature(video.frame, png);
    const average = signature.reduce((sum, value) => sum + value, 0) / signature.length;
    if (average < 6) return;
    const changed = sceneDifference(lastSignature, signature) >= threshold;
    const timedFallback = record.cues.length > 0 && actual - lastCapture >= maxSilentGap;
    if (actual - lastCapture >= minGap && (changed || timedFallback)) {
      const file = `frame-${String(record.screenshots.length + 1).padStart(4, '0')}.png`;
      await writeFile(path.join(assetDir, file), png);
      record.screenshots.push({ time: actual, file: `assets/${record.id}/${file}` });
      lastSignature = signature;
      lastCapture = actual;
    }
  }
  if (options.scanMode === 'realtime') {
    const started = await video.frame.evaluate(async () => {
      const player = document.querySelector('video');
      player.muted = true;
      player.playbackRate = 2;
      try { await player.play(); return true; } catch { return false; }
    });
    if (!started) record.warnings.push('浏览器不允许自动播放；可在可见浏览器中手动启动视频。');
    let lastTime = -Infinity;
    let stalled = 0;
    const deadline = Date.now() + (duration * 1000) + 60_000;
    while (Date.now() < deadline) {
      const state = await video.frame.evaluate(() => {
        const player = document.querySelector('video');
        return { time: player.currentTime, paused: player.paused, ended: player.ended };
      });
      if (state.time - lastTime >= interval || lastTime === -Infinity) {
        await sample(state.time);
        lastTime = state.time;
        stalled = 0;
      } else if (state.paused) {
        observedQuestions.push(...await questionsFromPage(page, state.time));
        stalled++;
      }
      if (state.ended || state.time >= duration - 0.3) break;
      if (stalled >= 5) {
        record.warnings.push(`视频在 ${state.time.toFixed(1)} 秒暂停；若是驻点小测，题目已尽量保存，后续画面未扫描。`);
        break;
      }
      await wait(1000);
    }
  } else {
    const targets = new Set([0]);
    for (let time = interval; time < duration; time += interval) targets.add(Number(time.toFixed(2)));
    for (const cue of record.cues) if (cue.start < duration) targets.add(Math.max(0, Number(cue.start.toFixed(2))));
    const times = [...targets].sort((a, b) => a - b);
    for (const time of times) {
      const actual = await seekVideo(video.frame, time);
      if (actual === null) {
        record.warnings.push(`在 ${time.toFixed(1)} 秒无法定位视频；后续截图未采集。`);
        break;
      }
      await wait(160);
      await sample(actual);
    }
  }
  record.questions = mergeQuestions(observedQuestions);
  if (!record.cues.length) record.cues = dedupeCues(observedCues.filter((cue, index, all) =>
    index === 0 || cue.text !== all[index - 1].text
  ));
  if (!options.quizzesOnly && record.screenshots.length >= maxFrames) record.warnings.push(`截图达到上限 ${maxFrames} 张；可用 --max-frames 调整。`);
  if (!options.quizzesOnly && !record.screenshots.length) record.warnings.push('未能截取非黑屏画面。');
  if (options.scanMode !== 'realtime' && !record.questions.length) record.warnings.push('跳播扫描可能无法触发驻点小测；若此视频有小测，可用 --scan-mode realtime 重新采集。');
}

async function captureDocument(page, record, assetDir, dwr) {
  await page.waitForSelector('.m-document, .j-document, .pdfViewer, .m-richText, iframe[src*=".pdf"], embed[type="application/pdf"]', { timeout: 8_000 }).catch(() => {});
  const candidates = [record.contentUrl, ...resourceUrlsFromDwr(dwr)].filter(Boolean);
  for (const url of candidates) {
    try {
      const resource = await fetchResource(page, url);
      if (resource && (resource.type.includes('pdf') || resource.bytes.subarray(0, 4).toString() === '%PDF')) {
        const file = 'courseware.pdf';
        await writeFile(path.join(assetDir, file), resource.bytes);
        record.attachments.push(`assets/${record.id}/${file}`);
        return;
      }
    } catch { /* Continue to the visible document fallback. */ }
  }
  record.text = await page.evaluate(() => {
    const root = document.querySelector('.m-document, .j-document, .m-lessonUnit, .m-richText') || document.querySelector('main');
    return root?.innerText?.trim().slice(0, 30_000) || '';
  }).catch(() => '');
  const target = await page.$('.m-document, .j-document, .pdfViewer, .m-richText, iframe[src*=".pdf"], embed[type="application/pdf"]');
  if (target) {
    try {
      const file = 'courseware.png';
      await target.screenshot({ path: path.join(assetDir, file), type: 'png' });
      record.attachments.push(`assets/${record.id}/${file}`);
      return;
    } catch { /* The viewer may use a detached iframe. */ }
  }
  if (!record.text) record.warnings.push('课件无可下载地址，页面也没有可读取的文字或截图。');
}

async function captureQuiz(page, record, assetDir) {
  await page.waitForSelector('.j-list, .m-test, .m-quiz, .u-questionItem, .j-questionItem', { timeout: 8_000 }).catch(() => {});
  record.questions = await questionsFromPage(page);
  record.text = await page.evaluate(() => {
    const root = document.querySelector('.m-test, .m-quiz, .j-test, .m-questionList') || document.querySelector('main');
    return root?.innerText?.trim().slice(0, 30_000) || '';
  }).catch(() => '');
  const target = await page.$('.j-list, .m-test, .m-quiz, .m-questionList');
  if (target) {
    try {
      const file = 'quiz.png';
      await target.screenshot({ path: path.join(assetDir, file), type: 'png' });
      record.attachments.push(`assets/${record.id}/${file}`);
    } catch { /* Some question containers are replaced while rendering. */ }
  }
}
