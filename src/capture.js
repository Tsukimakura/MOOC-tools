import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { findVideo, imageSignature, overlaySubtitle, seekVideo, subtitleCuesFromPayloads, trackCues, videoDuration } from './media.js';
import { selectStableFrames, spreadCandidates } from './frames.js';
import { dedupeCues, parseSubtitle } from './subtitles.js';
import { mergeQuestions, missingVideoAnchors, questionsFromData, questionsFromDwr, questionsFromPage } from './quiz.js';
import { openUnit } from './browser.js';
import { resourceUrlsFromDwr, subtitleUrlsFromDwr } from './resources.js';

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

function questionPayloads(payloads) {
  const questions = [];
  for (const item of payloads.filter((item) => item.kind === 'question')) {
    try { questions.push(...questionsFromData(JSON.parse(item.text))); }
    catch { questions.push(...questionsFromDwr(item.text)); }
  }
  return questions;
}

async function downloadQuestionImages(api, record, assetDir) {
  let imageIndex = 0;
  for (const question of record.questions) {
    const images = [];
    for (const url of question.images || []) {
      try {
        const resource = await api.resource(url, 8_000_000);
        if (!resource || !/^image\/(?:jpeg|png|webp)/i.test(resource.type)) continue;
        const extension = resource.type.includes('png') ? 'png' : resource.type.includes('webp') ? 'webp' : 'jpg';
        const file = `question-${String(++imageIndex).padStart(3, '0')}.${extension}`;
        await writeFile(path.join(assetDir, file), resource.bytes);
        images.push(`assets/${record.id}/${file}`);
      } catch { /* Unavailable question images are skipped. */ }
    }
    question.images = images;
  }
}

export async function captureUnit(page, api, unit, assetRoot, options = {}) {
  const observer = new NetworkObserver(page);
  const record = { ...unit, screenshots: [], cues: [], questions: [], attachments: [], warnings: [], text: '' };
  const assetDir = path.join(assetRoot, unit.id);
  await mkdir(assetDir, { recursive: true });
  try {
    options.onStage?.('读取课时元数据');
    let dwr = '';
    if (unit.type !== 'quiz') dwr = await api.lessonUnitDwr(unit).catch(() => '');
    if (unit.type === 'video') record.questions = await api.videoQuestions(unit).catch(() => []);
    options.onStage?.('加载课程网页');
    await openUnit(page, unit);
    if (unit.type === 'video') record.captureComplete = await captureVideo(page, api, record, assetDir, options, dwr);
    else if (unit.type === 'document') await captureDocument(page, api, record, assetDir, dwr);
    else await captureQuiz(page, record, assetDir);
  } catch (error) {
    record.warnings.push(`采集失败：${error.message}`);
  }
  await wait(350);
  const payloads = await observer.stop();
  record.cues = dedupeCues([...record.cues, ...subtitleCuesFromPayloads(payloads)]);
  record.questions = mergeQuestions(record.questions, questionPayloads(payloads));
  await downloadQuestionImages(api, record, assetDir);
  const missingAnchors = unit.type === 'video' ? missingVideoAnchors(unit.anchors, record.questions) : [];
  if (missingAnchors.length) record.warnings.push(`视频共有 ${unit.anchors.length} 处驻点小测，仍缺 ${missingAnchors.length} 处；该课时会在下次运行时重试。`);
  const missingAnswers = record.questions.filter((question) => !question.answer).length;
  if (missingAnswers) record.warnings.push(`${missingAnswers} 道题未从当前课程会话获得答案。`);
  if (unit.type === 'video' && !record.cues.length) record.warnings.push('未找到可读取的字幕。');
  if (unit.type === 'quiz' && !record.questions.length) record.warnings.push('此 Quiz 的题目未在当前学习页面显示；未自动开始答题。');
  record.ok = (unit.type !== 'quiz' || record.questions.length > 0) &&
    !missingAnchors.length &&
    record.captureComplete !== false &&
    !record.warnings.some((warning) => warning.startsWith('采集失败：'));
  delete record.captureComplete;
  delete record.contentUrl;
  return record;
}

async function captureVideo(page, api, record, assetDir, options, dwr) {
  const framePrefix = `frame-${randomUUID().slice(0,8)}`;
  const subtitleUrls = subtitleUrlsFromDwr(dwr);
  for (const url of subtitleUrls) {
    try {
      const resource = await api.download(url, 5_000_000);
      if (resource) record.cues.push(...parseSubtitle(resource.bytes.toString('utf8')));
    } catch { /* Subtitle URLs may expire. */ }
  }
  options.onStage?.('等待网页播放器加载');
  let video = await findVideo(page, 20_000);
  if (!video) {
    await page.evaluate((id) => {
      const tab = [...document.querySelectorAll('li[data-id]')].find((element) => element.dataset.id === id);
      tab?.click();
    }, record.id).catch(() => {});
    video = await findVideo(page, 10_000);
  }
  if (!video) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    video = await findVideo(page, 30_000);
  }
  if (!video) {
    record.warnings.push('视频播放器未加载，无法截图。');
    return false;
  }
  const duration = await videoDuration(video.frame);
  if (!duration) {
    record.warnings.push('无法读取视频时长，无法按时间采样截图。');
    return false;
  }
  record.cues.push(...await trackCues(video.frame));
  record.cues = dedupeCues(record.cues);
  const interval = options.interval ?? 2;
  const maxFrames = options.maxFrames ?? 160;
  const samples = [];
  const sampleDir = await mkdtemp(path.join(assetDir, '.browser-samples-'));
  const observedQuestions = [];
  const observedCues = [];
  async function sample(actual) {
    observedQuestions.push(...await questionsFromPage(page, actual));
    const subtitle = await overlaySubtitle(video.frame, actual);
    if (subtitle) observedCues.push(subtitle);
    const element = await video.frame.$('video');
    if (!element) return;
    const png = await element.screenshot({ type: 'png' });
    const signature = await imageSignature(video.frame, png);
    const average = signature.reduce((sum, value) => sum + value, 0) / signature.length;
    if (average < 6) return;
    const file = `sample-${String(samples.length + 1).padStart(6, '0')}.png`;
    await writeFile(path.join(sampleDir, file), png);
    samples.push({ time: actual, file, signature });
  }
  try {
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
      let failedSeeks = 0;
      for (const time of times) {
        const actual = await seekVideo(video.frame, time);
        if (actual === null) {
          failedSeeks++;
          if (failedSeeks < 3) continue;
          record.warnings.push(`连续三次无法定位视频，在 ${time.toFixed(1)} 秒停止截图。`);
          break;
        }
        failedSeeks = 0;
        await wait(160);
        await sample(actual);
      }
    }
    const candidates = selectStableFrames(samples.sort((a, b) => a.time - b.time), { ...options, hasCues: record.cues.length > 0 });
    for (const [index, candidate] of spreadCandidates(candidates, maxFrames).entries()) {
      const file = `${framePrefix}-${String(index + 1).padStart(4, '0')}.png`;
      await copyFile(path.join(sampleDir, candidate.file), path.join(assetDir, file));
      record.screenshots.push({ time: candidate.time, file: `assets/${record.id}/${file}` });
    }
    if (candidates.length > maxFrames) record.warnings.push(`画面变化超过截图上限 ${maxFrames} 张，已均匀保留；可用 --max-frames 调整。`);
    record.questions = mergeQuestions(record.questions, observedQuestions);
    if (!record.cues.length) record.cues = dedupeCues(observedCues.filter((cue, index, all) =>
      index === 0 || cue.text !== all[index - 1].text
    ));
    if (!record.screenshots.length) record.warnings.push('未能截取非黑屏画面。');
    if (options.scanMode !== 'realtime' && !record.questions.length) record.warnings.push('跳播扫描可能无法触发驻点小测；若此视频有小测，可用 --scan-mode realtime 重新采集。');
    return Boolean(record.screenshots.length);
  } finally {
    await rm(sampleDir, { recursive: true, force: true });
  }
}

async function captureDocument(page, api, record, assetDir, dwr) {
  await page.waitForSelector('.m-document, .j-document, .pdfViewer, .m-richText, iframe[src*=".pdf"], embed[type="application/pdf"]', { timeout: 8_000 }).catch(() => {});
  const candidates = [record.contentUrl, ...resourceUrlsFromDwr(dwr)].filter(Boolean);
  for (const url of candidates) {
    try {
      const resource = await api.download(url, 50_000_000);
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
