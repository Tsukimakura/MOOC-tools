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
