import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resourceUrlsFromDwr, subtitleUrlsFromDwr } from './resources.js';
import { captureStreamFrames } from './stream.js';
import { dedupeCues, parseSubtitle } from './subtitles.js';
import { missingVideoAnchors } from './quiz.js';

function newRecord(unit) {
  const record = { ...unit, screenshots: [], cues: [], questions: [], attachments: [], warnings: [], text: '', ok: false };
  delete record.contentUrl;
  return record;
}

async function subtitleCues(api, urls) {
  const cues = [];
  for (const url of [...new Set(urls)]) {
    try {
      const resource = await api.download(url, 5_000_000);
      if (resource) cues.push(...parseSubtitle(resource.bytes.toString('utf8')));
    } catch { /* Try the next subtitle track. */ }
  }
  return dedupeCues(cues);
}

export async function captureVideoApi(api, unit, assetRoot, options = {}) {
  const record = newRecord(unit);
  const assetDir = path.join(assetRoot, unit.id);
  await mkdir(assetDir, { recursive: true });
  options.onStage?.('读取课时字幕与驻点题');
  let dwr = '';
  try { dwr = await api.lessonUnitDwr(unit); }
  catch (error) { record.warnings.push(`课时元数据不可用：${error.message}`); }
  try { record.questions = await api.videoQuestions(unit); }
  catch (error) { record.warnings.push(`驻点题接口不可用：${error.message}`); }
  record.cues = await subtitleCues(api, subtitleUrlsFromDwr(dwr));
  try {
    options.onStage?.('获取视频授权地址');
    const stream = await api.videoStream(unit);
    if (!record.cues.length) record.cues = await subtitleCues(api, stream.captions);
    await captureStreamFrames(stream, assetDir, record, {
      ...options, framePrefix: `frame-${randomUUID().slice(0, 8)}`
    });
  } catch (error) {
    record.warnings.push(`视频流采集失败：${error.message}`);
  }
  const missingAnchors = missingVideoAnchors(unit.anchors, record.questions);
  if (missingAnchors.length) record.warnings.push(`视频共有 ${unit.anchors.length} 处驻点小测，仍缺 ${missingAnchors.length} 处。`);
  const missingAnswers = record.questions.filter((question) => !question.answer).length;
  if (missingAnswers) record.warnings.push(`${missingAnswers} 道题未从当前课程会话获得答案。`);
  if (!record.cues.length) record.warnings.push('未找到可读取的字幕。');
  if (!record.screenshots.length) record.warnings.push('未获取到视频截图。');
  record.ok = Boolean(record.screenshots.length && record.cues.length && !missingAnchors.length);
  return record;
}

export async function captureDocumentApi(api, unit, assetRoot, options = {}) {
  const record = newRecord(unit);
  const assetDir = path.join(assetRoot, unit.id);
  await mkdir(assetDir, { recursive: true });
  options.onStage?.('查找可下载课件');
  let dwr = '';
  try { dwr = await api.lessonUnitDwr(unit); }
  catch (error) { record.warnings.push(`课件元数据不可用：${error.message}`); }
  for (const url of [unit.contentUrl, ...resourceUrlsFromDwr(dwr)].filter(Boolean)) {
    try {
      const resource = await api.download(url, 50_000_000);
      if (!resource || resource.bytes.subarray(0, 4).toString() !== '%PDF') continue;
      await writeFile(path.join(assetDir, 'courseware.pdf'), resource.bytes);
      record.attachments.push(`assets/${unit.id}/courseware.pdf`);
      record.ok = true;
      return record;
    } catch { /* Continue to other courseware URLs. */ }
  }
  record.warnings.push('没有可直接下载的 PDF，尝试网页课件。');
  return record;
}
