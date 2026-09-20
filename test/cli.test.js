import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseResources, mergeCapturedRecord } from '../src/cli.js';

test('图文导出按教学小节包含所有视频和 Quiz，单项资源仍可精确选择', async () => {
  const base = { chapterIndex: 1, chapter: '第二章', lessonIndex: 0, lesson: '2.1 红黑树', lessonId: '101' };
  const units = [
    { ...base, id: '1', type: 'video', name: '定义' },
    { ...base, id: '2', type: 'video', name: '高度' },
    { ...base, id: '3', type: 'quiz', name: 'Quiz 2.1' },
    { ...base, id: '4', lessonIndex: 1, lesson: '2.2 操作', lessonId: '102', type: 'video', name: '插入' }
  ];
  const course = { units };
  assert.deepEqual((await chooseResources(course, 'export', { lesson: '101' })).map((unit) => unit.id), ['1', '2', '3']);
  assert.deepEqual((await chooseResources(course, 'export', { unit: '3' })).map((unit) => unit.id), ['3']);
  assert.deepEqual((await chooseResources(course, 'quizzes', { lesson: '101' })).map((unit) => unit.id), ['1', '2', '3']);
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
