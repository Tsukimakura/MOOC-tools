import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { playerArguments, preparePlayerSubtitles, subtitleDirectory } from '../src/player.js';

test('mpv、VLC、PotPlayer 和自定义播放器收到视频与同步字幕参数', () => {
  const url = 'https://vod.study.163.com/video.m3u8';
  const file = '/tmp/subtitle.srt';
  assert.deepEqual(playerArguments('mpv', url, file), [`--sub-file=${file}`, url]);
  assert.deepEqual(playerArguments('C:\\Program Files\\VideoLAN\\VLC\\vlc.exe', url, file), [`--sub-file=${file}`, url]);
  const windowsSubtitle = '\\\\wsl.localhost\\Ubuntu\\tmp\\subtitle.srt';
  assert.deepEqual(playerArguments('/mnt/c/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe', url, windowsSubtitle),
    [url, `/sub=${windowsSubtitle}`]);
  assert.deepEqual(playerArguments('other-player', url, file, '--subtitle={file}'), [`--subtitle=${file}`, url]);
  const files = { zh: '/tmp/zh.srt', en: '/tmp/en.srt', bilingual: '/tmp/bilingual.srt', sami: '/tmp/all.smi' };
  assert.deepEqual(playerArguments('mpv', url, files), [
    '--sub-file=/tmp/zh.srt', '--sub-file=/tmp/en.srt', '--sub-file=/tmp/bilingual.srt', url
  ]);
  assert.deepEqual(playerArguments('PotPlayerMini64.exe', url, files), [url, '/sub=/tmp/all.smi']);
  assert.deepEqual(playerArguments('vlc', url, files), ['--sub-file=/tmp/zh.srt', url]);
  assert.deepEqual(playerArguments('other-player', url, files, '--subtitle={file}'), ['--subtitle=/tmp/zh.srt', url]);
  assert.deepEqual(playerArguments('other-player', url, null), [url]);
  assert.throws(() => playerArguments('other-player', url, file), /字幕参数未知/);
  assert.throws(() => playerArguments('other-player', url, file, '--subtitle'), /必须包含 \{file\}/);
});

test('课时字幕回退到视频流，保存可复用且仅当前用户可读的 SRT', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-player-subtitle-'));
  try {
    const requests = [];
    const api = {
      lessonUnitDwr: async () => 's1.nosKey="ABCDEFGH1234";',
      download: async (url) => {
        requests.push(url);
        if (url.includes('ABCDEFGH1234')) return null;
        return { bytes: Buffer.from('WEBVTT\n\n00:01.500 --> 00:03.025\n测试字幕\n') };
      }
    };
    const unit = { id: '11' };
    const stream = { captions: ['https://nos.netease.com/oc-caption-srt/stream'] };
    const directory = path.join(root, 'subtitles');
    const files = await preparePlayerSubtitles(api, unit, stream, directory);
    assert.equal(path.dirname(files.zh), directory);
    assert.equal(await readFile(files.zh, 'utf8'), '1\n00:00:01,500 --> 00:00:03,025\n测试字幕\n\n');
    assert.equal((await stat(files.zh)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal(requests.length, 2);
    assert.deepEqual(await preparePlayerSubtitles(api, unit, stream, directory), files);
    assert.notEqual(subtitleDirectory('/tmp/profile-a', { slug: 'TEST-42', termId: '9' }, unit),
      subtitleDirectory('/tmp/profile-b', { slug: 'TEST-42', termId: '9' }, unit));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('无可读取字幕时不创建空文件', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-player-empty-'));
  try {
    const api = { lessonUnitDwr: async () => '', download: async () => null };
    const file = await preparePlayerSubtitles(api, { id: '11' }, { captions: [] }, path.join(root, 'subtitles'));
    assert.equal(file, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('下载中英文轨道并生成可切换的 PotPlayer SMI 与双语 SRT', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-player-languages-'));
  try {
    const api = {
      lessonUnitDwr: async () => 's1.nosKey="CHINESE1234";s2.nosKey="ENGLISH1234";',
      download: async (url) => ({ bytes: Buffer.from(url.includes('CHINESE') ?
        '1\n00:00:01,000 --> 00:00:03,000\n中文 <示例> & 内容\n' :
        '1\n00:00:02,000 --> 00:00:04,000\nEnglish example\n') })
    };
    const files = await preparePlayerSubtitles(api, { id: '12' }, { captions: [] }, root);
    assert.deepEqual(Object.keys(files).sort(), ['bilingual', 'en', 'sami', 'zh']);
    assert.match(await readFile(files.bilingual, 'utf8'), /00:00:02,000 --> 00:00:03,000\n中文  & 内容\nEnglish example/);
    const sami = await readFile(files.sami, 'utf8');
    assert.match(sami, /Name: 中文/);
    assert.match(sami, /Name: English/);
    assert.match(sami, /Name: 双语/);
    assert.match(sami, /<SYNC Start=3000>[\s\S]*<P Class=ZHCC>&nbsp;<\/P>/);
    assert.equal((await stat(files.sami)).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});
