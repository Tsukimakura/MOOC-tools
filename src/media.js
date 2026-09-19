import { dedupeCues, parseSubtitle } from './subtitles.js';

export function sceneDifference(previous, current) {
  if (!previous || !current || previous.length !== current.length) return Infinity;
  let total = 0;
  for (let i = 0; i < current.length; i++) total += Math.abs(current[i] - previous[i]);
  return total / current.length;
}

export async function imageSignature(frame, png) {
  const base64 = Buffer.from(png).toString('base64');
  return frame.evaluate(async (encoded) => {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, bitmap.width * 0.06, bitmap.height * 0.06, bitmap.width * 0.88, bitmap.height * 0.88, 0, 0, 24, 24);
    bitmap.close();
    const pixels = context.getImageData(0, 0, 24, 24).data;
    const values = [];
    for (let i = 0; i < pixels.length; i += 4) {
      values.push(Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]));
    }
    return values;
  }, base64);
}

export async function findVideo(page, timeoutMs = 12_000) {
  const until = Date.now() + timeoutMs;
  do {
    for (const frame of page.frames()) {
      try {
        const element = await frame.$('video');
        if (element) return { frame, element };
      } catch { /* A detached frame may be replaced while loading. */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  } while (Date.now() < until);
  return null;
}

export async function videoDuration(frame) {
  return frame.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return null;
    if (!Number.isFinite(video.duration) || !video.duration) {
      video.muted = true;
      video.play().catch(() => {});
      await Promise.race([
        new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true })),
        new Promise((resolve) => setTimeout(resolve, 8000))
      ]);
      video.pause();
    }
    return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  });
}

export async function seekVideo(frame, target) {
  return frame.evaluate(async (target) => {
    const video = document.querySelector('video');
    if (!video || !Number.isFinite(video.duration)) return null;
    video.pause();
    const goal = Math.min(Math.max(0, target), Math.max(0, video.duration - 0.1));
    if (Math.abs(video.currentTime - goal) < 0.2) return video.currentTime;
    return Promise.race([
      new Promise((resolve) => {
        video.addEventListener('seeked', () => resolve(video.currentTime), { once: true });
        try { video.currentTime = goal; } catch { resolve(null); }
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 6000))
    ]);
  }, target);
}

export async function trackCues(frame) {
  return frame.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return [];
    for (const track of video.textTracks) if (track.mode === 'disabled') track.mode = 'hidden';
    await new Promise((resolve) => setTimeout(resolve, 350));
    const result = [];
    for (const track of video.textTracks) {
      for (const cue of track.cues || []) result.push({ start: cue.startTime, end: cue.endTime, text: cue.text });
    }
    return result;
  }).then(dedupeCues);
}

export async function overlaySubtitle(frame, time) {
  try {
    const text = await frame.evaluate(() => {
      const selectors = '.vjs-text-track-display, .subtitle, .caption, .cc-text, [class*="subtitleText"]';
      const elements = [...document.querySelectorAll(selectors)].filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length;
      });
      return elements.map((element) => element.innerText.trim()).filter(Boolean).sort((a, b) => a.length - b.length)[0] || '';
    });
    return text ? { start: time, end: time + 2, text } : null;
  } catch { return null; }
}

export function subtitleCuesFromPayloads(payloads) {
  const cues = [];
  for (const item of payloads) {
    if (item.kind !== 'subtitle') continue;
    cues.push(...parseSubtitle(item.text));
    try {
      const data = JSON.parse(item.text);
      const stack = [data];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) { stack.push(...node); continue; }
        const start = Number(node.startTime ?? node.start ?? node.begin);
        const end = Number(node.endTime ?? node.end ?? node.finish);
        const text = node.text ?? node.content ?? node.subtitle;
        if (Number.isFinite(start) && Number.isFinite(end) && typeof text === 'string') {
          const scale = end > 4 * 3600 ? 1000 : 1;
          cues.push({ start: start / scale, end: end / scale, text });
        }
        else stack.push(...Object.values(node).filter((value) => typeof value === 'object'));
      }
    } catch { /* The payload may be SRT or VTT. */ }
  }
  return dedupeCues(cues);
}
