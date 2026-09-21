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

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
