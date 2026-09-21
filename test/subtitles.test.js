import test from 'node:test';
import assert from 'node:assert/strict';
import { bilingualCues, formatSami, formatSrt, formatTime, parseSubtitle } from '../src/subtitles.js';

test('SRT 和 VTT 时间轴解析并去重', () => {
  const srt = '1\n00:00:01,500 --> 00:00:03,000\n第一句\n\n2\n00:01:02,250 --> 00:01:04,000\n<b>第二句</b>\n';
  assert.deepEqual(parseSubtitle(srt), [
    { start: 1.5, end: 3, text: '第一句' },
    { start: 62.25, end: 64, text: '第二句' }
  ]);
  const vtt = 'WEBVTT\n\n00:01.500 --> 00:03.000\n第一句\n\n00:01.500 --> 00:03.000\n第一句';
  assert.equal(parseSubtitle(vtt).length, 1);
  assert.equal(formatTime(3661), '01:01:01');
  assert.equal(formatSrt([{ start: 1.5, end: 3.025, text: '第一句' }]),
    '1\n00:00:01,500 --> 00:00:03,025\n第一句\n\n');
});

test('双语字幕按两条轨道的起止时间拼接，并在无文字时清屏', () => {
  const zh = [{ start: 1, end: 3, text: '中文<&' }];
  const en = [{ start: 2, end: 4, text: 'English' }];
  assert.deepEqual(bilingualCues(zh, en), [
    { start: 1, end: 2, text: '中文<&' },
    { start: 2, end: 3, text: '中文<&\nEnglish' },
    { start: 3, end: 4, text: 'English' }
  ]);
  const sami = formatSami(zh, en);
  assert.match(sami, /<SYNC Start=2000>[\s\S]*?<P Class=MULCC>中文&lt;&amp;<BR>English<\/P>/);
  assert.match(sami, /<SYNC Start=4000>[\s\S]*?<P Class=MULCC>&nbsp;<\/P>/);
});
