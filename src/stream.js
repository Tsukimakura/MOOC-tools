import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { imageSignature, sceneDifference } from './media.js';

const memberIds = new WeakMap();

export function resourceSignature(unitId, contentType, timestamp, memberId) {
  // Current platform client formula, cross-checked with mediago's iCourse163 adapter.
  return createHash('md5').update(`${unitId}1${timestamp}88${contentType}mooc${memberId}`).digest('hex');
}

export function normalizeVideoUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' && /(^|\.)(126\.net|163\.com|netease\.com)$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

async function memberId(page) {
  if (memberIds.has(page)) return memberIds.get(page);
  const html = await page.evaluate(async () => {
    const response = await fetch('/home.htm', { credentials: 'include', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`个人主页 HTTP ${response.status}`);
    return response.text();
  });
  const id = html.match(/userId=(\d+)/)?.[1] || html.match(/id\s*:\s*"(\d+)",\s*nickName\s*:/)?.[1];
  if (!id) throw new Error('个人主页没有返回用户编号。');
  memberIds.set(page, id);
  return id;
}

export async function fetchVideoStream(page, unit) {
  if (!/^\d+$/.test(unit.id) || unit.type !== 'video') throw new Error('无效的视频课时编号。');
  const csrf = (await page.browserContext().cookies('https://www.icourse163.org'))
    .find((cookie) => cookie.name === 'NTESSTUDYSI')?.value;
  if (!csrf) throw new Error('缺少课程会话 Cookie。');
  const member = await memberId(page);
  const timestamp = String(Date.now());
  const sign = resourceSignature(unit.id, unit.contentType, timestamp, member);
  const token = await page.evaluate(async ({ csrf, unit, timestamp, sign }) => {
    const response = await fetch(`/web/j/resourceRpcBean.getResourceTokenV2.rpc?csrfKey=${encodeURIComponent(csrf)}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ bizId: unit.id, bizType: '1', contentType: String(unit.contentType), timestamp, sign }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`资源令牌 HTTP ${response.status}`);
    return response.json();
  }, { csrf, unit: { id: unit.id, contentType: unit.contentType }, timestamp, sign });
  const dto = token?.result?.videoSignDto;
  if (!dto?.signature || !dto?.videoId) throw new Error(`资源令牌不可用（${token?.code ?? '未知错误'}）。`);
  const response = await fetch('https://vod.study.163.com/eds/api/v1/vod/video', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://www.icourse163.org/' },
    body: new URLSearchParams({ clientType: '1', signature: dto.signature, videoId: String(dto.videoId) }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`视频资源 HTTP ${response.status}`);
  const data = await response.json();
  const videos = (data?.result?.videos || [])
    .filter((video) => !video.e && ['hls', 'mp4'].includes(video.format))
    .map((video) => ({ ...video, videoUrl: normalizeVideoUrl(video.videoUrl) }))
    .filter((video) => video.videoUrl);
  videos.sort((a, b) => Number(b.quality) - Number(a.quality));
  if (!videos.length) throw new Error('视频资源接口没有提供可用的视频流。');
  return {
    url: videos[0].videoUrl,
    format: videos[0].format,
    duration: Number(dto.duration) || Number(data.result?.duration) || 0,
    captions: (data.result?.srtCaptions || []).map((caption) => normalizeVideoUrl(caption.url)).filter(Boolean)
  };
}

function sanitizeError(value) {
  return String(value || '').replace(/https?:\/\/[^\s]+/g, '[视频地址]').slice(-300).trim();
}

async function runFfmpeg(stream, directory, interval, onProgress) {
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-rw_timeout', '30000000',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2',
    '-i', stream.url, '-an', '-sn', '-vf', `fps=1/${interval}`, '-vsync', 'vfr',
    '-progress', 'pipe:1', '-y', path.join(directory, 'sample-%06d.png')
  ];
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let progress = '';
  let reported = 0;
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.stdout.on('data', (chunk) => {
    progress += chunk.toString();
    const lines = progress.split('\n');
    progress = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('frame=')) continue;
      const frames = Number(line.slice(6));
      const percent = stream.duration ? Math.min(100, Math.floor(frames * interval * 100 / stream.duration)) : 0;
      if (percent >= reported + 10) {
        reported = Math.floor(percent / 10) * 10;
        onProgress?.(reported);
      }
    }
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), Math.max(300_000, stream.duration * 4000));
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0) throw new Error(`ffmpeg 解码失败（退出码 ${code}）：${sanitizeError(stderr)}`);
  } finally { clearTimeout(timeout); }
}

function spreadCandidates(candidates, maximum) {
  if (candidates.length <= maximum) return candidates;
  if (maximum === 1) return [candidates[0]];
  return Array.from({ length: maximum }, (_, index) =>
    candidates[Math.round(index * (candidates.length - 1) / (maximum - 1))]
  );
}

export async function captureStreamFrames(page, stream, assetDir, record, options = {}) {
  const interval = options.interval ?? 2;
  const threshold = options.threshold ?? 1;
  const maxFrames = options.maxFrames ?? 160;
  const minGap = options.minGap ?? 3;
  const maxSilentGap = options.maxSilentGap ?? 60;
  const framePrefix = options.framePrefix || `frame-${Date.now().toString(36)}`;
  const directory = await mkdtemp(path.join(assetDir, '.samples-'));
  try {
    await runFfmpeg(stream, directory, interval, options.onProgress);
    const files = (await readdir(directory)).filter((file) => /^sample-\d+\.png$/.test(file)).sort();
    if (!files.length) throw new Error('ffmpeg 没有产生视频画面。');
    const candidates = [];
    let previousSignature = null;
    let lastCapture = -Infinity;
    for (const [index, file] of files.entries()) {
      const time = Number((index * interval).toFixed(2));
      const png = await readFile(path.join(directory, file));
      const signature = await imageSignature(page.mainFrame(), png);
      const average = signature.reduce((sum, value) => sum + value, 0) / signature.length;
      if (average < 6) continue;
      const changed = sceneDifference(previousSignature, signature) >= threshold;
      const timedFallback = record.cues.length > 0 && time - lastCapture >= maxSilentGap;
      if (time - lastCapture >= minGap && (changed || timedFallback)) {
        candidates.push({ time, file });
        previousSignature = signature;
        lastCapture = time;
      }
    }
    for (const [index, candidate] of spreadCandidates(candidates, maxFrames).entries()) {
      const file = `${framePrefix}-${String(index + 1).padStart(4, '0')}.png`;
      await copyFile(path.join(directory, candidate.file), path.join(assetDir, file));
      record.screenshots.push({ time: candidate.time, file: `assets/${record.id}/${file}` });
    }
    if (candidates.length > maxFrames) record.warnings.push(`画面变化超过截图上限 ${maxFrames} 张，已均匀保留；可用 --max-frames 调整。`);
    return files.length;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
