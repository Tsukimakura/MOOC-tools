import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoUrl } from '../src/stream.js';

test('平台返回 HTTP 视频地址时升级到 HTTPS，并拒绝其他主机', () => {
  assert.equal(
    normalizeVideoUrl('http://mooc2vod.stu.126.net/nos/hls/lesson.m3u8?token=abc'),
    'https://mooc2vod.stu.126.net/nos/hls/lesson.m3u8?token=abc'
  );
  assert.equal(normalizeVideoUrl('http://127.0.0.1/private.m3u8'), null);
  assert.equal(normalizeVideoUrl('https://not126.net/video.m3u8'), null);
});
