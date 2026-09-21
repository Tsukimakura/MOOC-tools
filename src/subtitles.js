export function parseTimestamp(value) {
  const parts = String(value).replace(',', '.').trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  return seconds >= 0 ? seconds : null;
}

export function parseSubtitle(text) {
  if (typeof text !== 'string') return [];
  const blocks = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;
    const [startPart, endPart] = lines[timingIndex].split('-->');
    const start = parseTimestamp(startPart);
    const end = parseTimestamp(endPart?.trim().split(/\s+/)[0]);
    const content = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/g, '').trim();
    if (start !== null && end !== null && end >= start && content) cues.push({ start, end, text: content });
  }
  return dedupeCues(cues);
}

export function dedupeCues(cues) {
  const seen = new Set();
  return cues.filter((cue) => {
    const key = `${Math.round(cue.start * 10)}:${cue.text.trim()}`;
    if (!cue.text?.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.start - b.start);
}

function srtTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const secs = Math.floor(total / 1000) % 60;
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function formatSrt(cues) {
  if (!cues.length) return '';
  return `${cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`).join('\n\n')}\n\n`;
}

function subtitleTimeline(tracks) {
  const events = new Map();
  const active = Object.fromEntries(Object.keys(tracks).map((language) => [language, new Map()]));
  for (const [language, cues] of Object.entries(tracks)) {
    for (const [index, cue] of cues.entries()) {
      const start = Math.round(cue.start * 1000);
      const end = Math.round(cue.end * 1000);
      if (start < 0 || end <= start) continue;
      if (!events.has(start)) events.set(start, []);
      if (!events.has(end)) events.set(end, []);
      events.get(start).push({ language, index, text: cue.text, start: true });
      events.get(end).push({ language, index, start: false });
    }
  }
  return [...events.keys()].sort((a, b) => a - b).map((time) => {
    for (const event of events.get(time)) if (!event.start) active[event.language].delete(event.index);
    for (const event of events.get(time)) if (event.start) active[event.language].set(event.index, event.text);
    return {
      time,
      text: Object.fromEntries(Object.entries(active).map(([language, cues]) =>
        [language, [...cues.values()].join('\n')]))
    };
  });
}

export function bilingualCues(chinese, english) {
  const timeline = subtitleTimeline({ zh: chinese, en: english });
  const combined = [];
  for (let index = 0; index < timeline.length - 1; index++) {
    const start = timeline[index].time / 1000;
    const end = timeline[index + 1].time / 1000;
    const text = [timeline[index].text.zh, timeline[index].text.en].filter(Boolean).join('\n');
    if (!text || end <= start) continue;
    const previous = combined.at(-1);
    if (previous?.text === text && previous.end === start) previous.end = end;
    else combined.push({ start, end, text });
  }
  return combined;
}

function escapeSami(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\n', '<BR>') || '&nbsp;';
}

export function formatSami(chinese, english) {
  const tracks = { ZHCC: chinese, ENCC: english, MULCC: bilingualCues(chinese, english) };
  const timeline = subtitleTimeline(tracks);
  const syncs = timeline.map(({ time, text }) => `<SYNC Start=${time}>\n${Object.entries(text)
    .map(([language, content]) => `<P Class=${language}>${escapeSami(content)}</P>`).join('\n')}`).join('\n');
  return `\uFEFF<SAMI>\n<HEAD>\n<META http-equiv="Content-Type" content="text/html; charset=utf-8">\n<STYLE TYPE="text/css">\n<!--\n.ZHCC {Name: 中文; lang: zh-CN; SAMIType: CC;}\n.ENCC {Name: English; lang: en-US; SAMIType: CC;}\n.MULCC {Name: 双语; lang: mul; SAMIType: CC;}\n-->\n</STYLE>\n</HEAD>\n<BODY>\n${syncs}\n</BODY>\n</SAMI>\n`;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
