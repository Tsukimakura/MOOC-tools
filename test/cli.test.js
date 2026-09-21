import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseResources, main, mergeCapturedRecord, presentVideoLink } from '../src/cli.js';

test('统一命令显示模式与课程样例，并指出旧命令替代方式', async () => {
  const original = console.log;
  let help = '';
  try {
    console.log = (message) => { help = message; };
    await main(['--help']);
  } finally { console.log = original; }
  assert.match(help, /mooc-notes \[课程\] \[--mode 模式\]/);
  assert.match(help, /ZJU1-1460402161\?tid=1488053496/);
  assert.match(help, /video（获取课程视频，可选择带字幕播放）/);
  assert.match(help, /mooc-notes config --player PATH/);
  assert.match(help, /mooc-notes login --manual/);
  assert.doesNotMatch(help, /quizzes（小测）|notes、quizzes/);
  assert.doesNotMatch(help, /courses（账号课程）|list（目录）/);
  await assert.rejects(main(['export']), /旧命令已合并/);
  await assert.rejects(main(['courses']), /已并入选课流程/);
  await assert.rejects(main(['ZJU1-1460402161', '--mode', 'unknown']), /未知模式/);
  await assert.rejects(main(['ZJU1-1460402161', '--mode', 'list']), /未知模式/);
  await assert.rejects(main(['ZJU1-1460402161', '--mode', 'quizzes']), /未知模式/);
  await assert.rejects(main(['ZJU1-1460402161', '--mode', 'url']), /请使用 --mode video/);
  await assert.rejects(main(['ZJU1-1460402161', '--mode', 'notes', '--player', 'mpv']), /只适用于 video 和 config 模式/);
  await assert.rejects(main(['ZJU1-1460402161', '--manual']), /只适用于 login 模式/);
  await assert.rejects(main(['ZJU1-1460402161', '--mode', 'video', '--subtitle-arg', '--subtitle']), /必须包含 \{file\}/);
});

test('获取视频链接后按选择播放，非交互调用不会等待输入', async () => {
  const url = 'https://vod.study.163.com/video.m3u8';
  const stream = { url };
  const unit = { name: '示例视频' };
  const calls = [];
  const ui = {
    writeLink: (value) => calls.push(['link', value]),
    writeStatus: (value) => calls.push(['status', value]),
    choose: async () => { calls.push(['choose']); return 'default'; },
    askText: async () => { calls.push(['ask']); return 'mpv'; },
    openInPlayer: async (player, value, subtitle, subtitleArg) => { calls.push(['open', player, value, subtitle, subtitleArg]); }
  };
  const loadSubtitle = async () => { calls.push(['subtitle']); return '/tmp/test-subtitle.srt'; };
  await presentVideoLink(stream, unit, { interactive: false, loadSubtitle }, ui);
  assert.deepEqual(calls, [['link', url]]);

  calls.length = 0;
  await presentVideoLink(stream, unit, { interactive: true, defaultPlayer: 'mpv', loadSubtitle }, ui);
  assert.deepEqual(calls, [['link', url], ['choose'], ['subtitle'], ['open', 'mpv', url, '/tmp/test-subtitle.srt', undefined], ['status', '已启动播放器：示例视频\n']]);

  calls.length = 0;
  await presentVideoLink(stream, unit, { interactive: false, player: 'vlc', loadSubtitle }, ui);
  assert.deepEqual(calls, [['link', url], ['subtitle'], ['open', 'vlc', url, '/tmp/test-subtitle.srt', undefined], ['status', '已启动播放器：示例视频\n']]);

  calls.length = 0;
  await presentVideoLink(stream, unit, { interactive: true, loadSubtitle }, { ...ui, choose: async () => 'link' });
  assert.deepEqual(calls, [['link', url]]);

  calls.length = 0;
  await presentVideoLink(stream, unit, { interactive: true, loadSubtitle, subtitleArg: '--sub={file}' },
    { ...ui, choose: async () => { calls.push(['choose']); return 'other'; } });
  assert.deepEqual(calls, [['link', url], ['choose'], ['ask'], ['subtitle'], ['open', 'mpv', url, '/tmp/test-subtitle.srt', '--sub={file}'], ['status', '已启动播放器：示例视频\n']]);

  calls.length = 0;
  await presentVideoLink(stream, unit, { interactive: true, defaultPlayer: 'vlc', loadSubtitle },
    { ...ui, choose: async () => { calls.push(['choose']); return 'other'; } });
  assert.deepEqual(calls, [['link', url], ['choose'], ['ask'], ['subtitle'],
    ['open', 'mpv', url, '/tmp/test-subtitle.srt', undefined], ['status', '已启动播放器：示例视频\n']]);

  calls.length = 0;
  await presentVideoLink(stream, unit, { interactive: false, player: 'mpv', loadSubtitle: async () => null }, ui);
  assert.deepEqual(calls, [['link', url], ['status', '提示：当前课程会话未提供可读取的字幕，将只播放视频。\n'],
    ['open', 'mpv', url, null, undefined], ['status', '已启动播放器：示例视频\n']]);

  calls.length = 0;
  const subtitles = { zh: '/tmp/zh.srt', en: '/tmp/en.srt', bilingual: '/tmp/bilingual.srt', sami: '/tmp/all.smi' };
  await presentVideoLink(stream, unit, { player: 'PotPlayerMini64.exe', loadSubtitle: async () => subtitles }, ui);
  assert.deepEqual(calls, [['link', url], ['status', '可用字幕：中文 / 英文 / 双语。\n'],
    ['status', '在 PotPlayer 的字幕语言菜单中选择中文、English 或双语。\n'],
    ['open', 'PotPlayerMini64.exe', url, subtitles, undefined], ['status', '已启动播放器：示例视频\n']]);

  calls.length = 0;
  await presentVideoLink(stream, unit, { player: 'mpv', loadSubtitle: async () => ({ en: '/tmp/en.srt' }) }, ui);
  assert.deepEqual(calls, [['link', url], ['status', '可用字幕：英文。\n'],
    ['status', '提示：当前会话仅获取到英文字幕，无法生成中文和双语字幕。\n'],
    ['open', 'mpv', url, { en: '/tmp/en.srt' }, undefined], ['status', '已启动播放器：示例视频\n']]);
});

test('视频流程可以设置和修改默认播放器，临时播放器不会写入配置', async () => {
  const calls = [];
  let menu;
  let action = 'set-default';
  const ui = {
    writeLink: () => {},
    writeStatus: (message) => calls.push(['status', message]),
    choose: async (choices) => { menu = choices; return action; },
    askText: async () => 'mpv',
    openInPlayer: async (player) => calls.push(['open', player])
  };
  const savePlayer = async (player) => calls.push(['save', player]);
  const stream = { url: 'https://example.invalid/video.m3u8' };
  const unit = { name: '示例视频' };

  await presentVideoLink(stream, unit, { interactive: true, savePlayer, loadSubtitle: async () => null }, ui);
  assert.ok(menu.some(({ label, value }) => value === 'set-default' && label === '设置默认播放器并播放'));
  assert.deepEqual(calls.slice(0, 2), [['save', 'mpv'], ['status', '默认播放器已保存。\n']]);
  assert.ok(calls.some(([name, value]) => name === 'open' && value === 'mpv'));

  calls.length = 0;
  await presentVideoLink(stream, unit, {
    interactive: true, defaultPlayer: 'vlc', environmentPlayerOverride: true,
    savePlayer, loadSubtitle: async () => null
  }, ui);
  assert.ok(menu.some(({ label, value }) => value === 'set-default' && label === '修改默认播放器并播放'));
  assert.deepEqual(calls.slice(0, 3), [
    ['save', 'mpv'], ['status', '默认播放器已保存。\n'],
    ['status', '提示：MOOC_NOTES_PLAYER 环境变量仍会覆盖本地默认播放器。\n']
  ]);

  calls.length = 0;
  action = 'other';
  await presentVideoLink(stream, unit, { interactive: true, defaultPlayer: 'vlc', savePlayer, loadSubtitle: async () => null }, ui);
  assert.ok(menu.some(({ label, value }) => value === 'other' && label.includes('不保存')));
  assert.ok(calls.some(([name, value]) => name === 'open' && value === 'mpv'));
  assert.ok(!calls.some(([name]) => name === 'save'));
});

test('图文导出按教学小节包含所有视频和 Quiz，单项资源仍可精确选择', async () => {
  const base = { chapterIndex: 1, chapter: '第二章', lessonIndex: 0, lesson: '2.1 红黑树', lessonId: '101' };
  const units = [
    { ...base, id: '1', type: 'video', name: '定义' },
    { ...base, id: '2', type: 'video', name: '高度' },
    { ...base, id: '3', type: 'quiz', name: 'Quiz 2.1' },
    { ...base, id: '4', lessonIndex: 1, lesson: '2.2 操作', lessonId: '102', type: 'video', name: '插入' }
  ];
  const course = { units };
  assert.deepEqual((await chooseResources(course, { lesson: '101' })).map((unit) => unit.id), ['1', '2', '3']);
  assert.deepEqual((await chooseResources(course, { unit: '3' })).map((unit) => unit.id), ['3']);
});

test('重试失败时保留已经采集到的字幕，并继续标记视频待重试', () => {
  const previous = {
    ok: false, cues: [{ start: 1, end: 2, text: '已有字幕' }],
    screenshots: [], questions: [], attachments: [], text: '', warnings: []
  };
  const current = {
    ok: false, cues: [], screenshots: [], questions: [], attachments: [], text: '',
    warnings: ['视频播放器未加载，无法截图。', '未找到可读取的字幕。']
  };
  const saved = mergeCapturedRecord(previous, current, { type: 'video' });
  assert.equal(saved.ok, false);
  assert.deepEqual(saved.cues, previous.cues);
  assert.deepEqual(saved.warnings, ['视频播放器未加载，无法截图。']);
});

test('重新采集时保留已有小测，采集到截图后覆盖旧的空截图', () => {
  const previous = {
    ok: true, cues: [], screenshots: [], questions: [{ title: '题目 A', options: [], time: 5 }],
    attachments: [], text: '', warnings: []
  };
  const current = {
    ok: true, cues: [], screenshots: [{ time: 1, file: 'frame.png' }], questions: [],
    attachments: [], text: '', warnings: []
  };
  const saved = mergeCapturedRecord(previous, current, { type: 'video' });
  assert.equal(saved.ok, true);
  assert.equal(saved.screenshots.length, 1);
  assert.equal(saved.questions.length, 1);
});

test('新的驻点时间覆盖旧记录中误判的零秒', () => {
  const base = { cues: [], screenshots: [], attachments: [], text: '', warnings: [] };
  const previous = { ...base, ok: false, questions: [{ title: '题目 A', options: [], time: 0 }] };
  const current = { ...base, ok: true, questions: [{ title: '题目 A', options: [], time: 73 }] };
  const saved = mergeCapturedRecord(previous, current, { type: 'video' });
  assert.equal(saved.questions[0].time, 73);
});

test('已有截图不会掩盖仍缺失的驻点小测', () => {
  const base = { cues: [], screenshots: [{ time: 0, file: 'frame.png' }], attachments: [], text: '', warnings: [] };
  const previous = { ...base, ok: true, questions: [{ id: '1', title: '题目 A', time: 10 }] };
  const current = { ...base, ok: false, questions: [], warnings: ['视频共有 2 处驻点小测，仍缺 1 处；该课时会在下次运行时重试。'] };
  const saved = mergeCapturedRecord(previous, current, { type: 'video', anchors: [{ id: '1', time: 10 }, { id: '2', time: 30 }] });
  assert.equal(saved.ok, false);
});

test('API 与网页均失败时保留两条不同原因', () => {
  const base = { cues: [], screenshots: [], questions: [], attachments: [], text: '', ok: false };
  const direct = { ...base, warnings: ['视频流采集失败：CDN 无进度'] };
  const browser = { ...base, warnings: ['视频播放器未加载，无法截图。'] };
  const merged = mergeCapturedRecord(direct, browser, { type: 'video', anchors: [] });
  assert.deepEqual(merged.warnings, ['视频流采集失败：CDN 无进度', '视频播放器未加载，无法截图。']);
});
