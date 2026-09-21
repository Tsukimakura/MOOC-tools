import { parseSubtitle } from './subtitles.js';

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

export function subtitleUrlsFromDwr(text) {
  const direct = [];
  for (const match of String(text || '').matchAll(/\.nosKey\s*=\s*"((?:\\.|[^"\\])*)"/g)) {
    const key = decodeDwr(match[1]);
    if (/^[A-Za-z0-9_-]{8,256}$/.test(key)) direct.push(`https://nos.netease.com/oc-caption-srt/${key}`);
  }
  const legacy = resourceUrlsFromDwr(text).filter((url) => /\.(?:srt|vtt)(?:[?#]|$)|caption|subtitle|downloadVideoSrt/i.test(url));
  return [...new Set([...direct, ...legacy])];
}

export async function downloadSubtitleTracks(api, urls, limit = Infinity) {
  const tracks = [];
  const seen = new Set();
  for (const url of new Set(urls.filter(Boolean))) {
    try {
      const resource = await api.download(url, 5_000_000);
      const cues = resource ? parseSubtitle(resource.bytes.toString('utf8')) : [];
      if (!cues.length) continue;
      const key = JSON.stringify(cues);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(cues);
      if (tracks.length >= limit) break;
    } catch { /* An expired or unavailable track does not block the other tracks. */ }
  }
  return tracks;
}
