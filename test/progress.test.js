import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressReporter } from '../src/progress.js';

test('耗时阶段持续显示名称、进度条与已用时间', () => {
  let output = '';
  const progress = new ProgressReporter({ isTTY: false, write: (value) => { output += value; } });
  try {
    progress.stage('读取视频流');
    progress.percent(40);
    assert.match(output, /读取视频流/);
    assert.match(output, /████░░░░░░.*40%/);
    assert.match(output, /已用 00:00/);
  } finally { progress.stop(); }
});
