import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeVideoUrl, readFrameSignatures } from '../src/stream.js';

test('平台返回 HTTP 视频地址时升级到 HTTPS，并拒绝其他主机', () => {
  assert.equal(
    normalizeVideoUrl('http://mooc2vod.stu.126.net/nos/hls/lesson.m3u8?token=abc'),
    'https://mooc2vod.stu.126.net/nos/hls/lesson.m3u8?token=abc'
  );
  assert.equal(normalizeVideoUrl('http://127.0.0.1/private.m3u8'), null);
  assert.equal(normalizeVideoUrl('https://not126.net/video.m3u8'), null);
});

test('ffmpeg 在本地分析截图，无需浏览器画布', async (t) => {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) return t.skip('未安装 ffmpeg');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mooc-frame-signature-'));
  try {
    const result = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=96x96:rate=1:duration=3', '-frames:v', '3', '-y', path.join(directory, 'sample-%06d.png')
    ]);
    assert.equal(result.status, 0, result.stderr.toString());
    const frames = await readFrameSignatures(directory, 3);
    assert.equal(frames.length, 3);
    assert.equal(frames[0].length, 576);
    assert.notDeepEqual(frames[0], frames[2]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
