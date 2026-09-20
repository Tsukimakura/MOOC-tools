import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStableFrames, spreadCandidates } from '../src/frames.js';

test('动画过渡期间不截图，待画面连续稳定后保存最终状态', () => {
  const signature = (value) => Array.from({ length: 576 }, (_, index) => index < 20 ? value : 100);
  const frames = [
    [0, 100], [2, 100], [4, 100],
    [6, 150], [8, 200], [10, 200], [12, 200]
  ].map(([time, value]) => ({ time, signature: signature(value) }));
  assert.deepEqual(selectStableFrames(frames, { threshold: 1 }).map((frame) => frame.time), [4, 12]);
});

test('截图达到上限时均匀保留开头与结尾', () => {
  assert.deepEqual(spreadCandidates([0, 1, 2, 3, 4], 3), [0, 2, 4]);
});
