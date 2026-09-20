import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureVideoApi } from '../src/api_capture.js';

test('已授权视频流可在不启动浏览器时生成字幕和稳定截图', async (t) => {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) return t.skip('未安装 ffmpeg');
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-api-capture-'));
  try {
    const video = path.join(root, 'sample.mp4');
    const result = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=96x96:rate=2:duration=5', '-c:v', 'mpeg4', '-y', video
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    const api = {
      lessonUnitDwr: async () => '',
      videoQuestions: async () => [],
      videoStream: async () => ({ url: video, duration: 5, captions: ['https://nos.netease.com/oc-caption-srt/test'] }),
      download: async () => ({ bytes: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\n测试字幕\n'), type: 'text/plain' })
    };
    const stages = [];
    const percentages = [];
    const record = await captureVideoApi(api, {
      id: '123', contentId: '456', contentType: 1, type: 'video', anchors: []
    }, path.join(root, 'assets'), {
      interval: 1, onStage: (stage) => stages.push(stage), onProgress: (percent) => percentages.push(percent)
    });
    assert.equal(record.ok, true, record.warnings.join('；'));
    assert.equal(record.cues[0].text, '测试字幕');
    assert.ok(record.screenshots.length > 0);
    assert.ok(stages.some((stage) => stage.includes('画面变化')));
    assert.ok(percentages.includes(100));
    for (const shot of record.screenshots) await stat(path.join(root, shot.file));
  } finally { await rm(root, { recursive: true, force: true }); }
});
