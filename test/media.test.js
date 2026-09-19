import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneDifference } from '../src/media.js';

test('局部课件文字变化能够触发截图，轻微编码波动不会', () => {
  const previous = Array(576).fill(100);
  const newLine = previous.slice();
  for (let index = 0; index < 10; index++) newLine[index] = 160;
  assert.ok(sceneDifference(previous, newLine) >= 3);
  assert.ok(sceneDifference(previous, Array(576).fill(102)) < 3);
});
