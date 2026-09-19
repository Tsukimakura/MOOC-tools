import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, parseSubtitle } from '../src/subtitles.js';

test('SRT 和 VTT 时间轴解析并去重', () => {
  const srt = '1\n00:00:01,500 --> 00:00:03,000\n第一句\n\n2\n00:01:02,250 --> 00:01:04,000\n<b>第二句</b>\n';
  assert.deepEqual(parseSubtitle(srt), [
    { start: 1.5, end: 3, text: '第一句' },
    { start: 62.25, end: 64, text: '第二句' }
  ]);
  const vtt = 'WEBVTT\n\n00:01.500 --> 00:03.000\n第一句\n\n00:01.500 --> 00:03.000\n第一句';
  assert.equal(parseSubtitle(vtt).length, 1);
  assert.equal(formatTime(3661), '01:01:01');
});
