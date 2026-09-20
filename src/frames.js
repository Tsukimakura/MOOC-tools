import { sceneDifference } from './media.js';

export function selectStableFrames(frames, options = {}) {
  const threshold = options.threshold ?? 1;
  const minGap = options.minGap ?? 3;
  const maxSilentGap = options.maxSilentGap ?? 60;
  const settleWindow = options.settleWindow ?? 12;
  const settleDuration = options.settleDuration ?? 4;
  const stabilityThreshold = Math.max(0.5, threshold * 0.6);
  const candidates = [];
  let previousSignature = null;
  let lastCapture = -Infinity;
  for (let index = 0; index < frames.length;) {
    const frame = frames[index];
    if (!frame.signature || frame.time - lastCapture < minGap) { index++; continue; }
    const changed = sceneDifference(previousSignature, frame.signature) >= threshold;
    const due = options.hasCues && frame.time - lastCapture >= maxSilentGap;
    if (!changed && !due) { index++; continue; }
    let chosen = index;
    let stableSamples = 0;
    let previous = frame;
    for (let nextIndex = index + 1; nextIndex < frames.length; nextIndex++) {
      const next = frames[nextIndex];
      if (next.time - frame.time > settleWindow) break;
      if (!next.signature) continue;
      chosen = nextIndex;
      stableSamples = sceneDifference(previous.signature, next.signature) < stabilityThreshold ? stableSamples + 1 : 0;
      previous = next;
      if (stableSamples >= 2 && next.time - frame.time >= settleDuration) break;
    }
    const settled = frames[chosen];
    candidates.push(settled);
    previousSignature = settled.signature;
    lastCapture = settled.time;
    index = chosen + 1;
  }
  return candidates;
}

export function spreadCandidates(candidates, maximum) {
  if (candidates.length <= maximum) return candidates;
  if (maximum === 1) return [candidates[0]];
  return Array.from({ length: maximum }, (_, index) =>
    candidates[Math.round(index * (candidates.length - 1) / (maximum - 1))]
  );
}
