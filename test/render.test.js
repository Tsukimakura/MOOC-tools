import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lessonDirectoryName, readManifest, renderNotes, renderQuizIndex, saveExport } from '../src/render.js';

const course = { slug: 'TEST-1', termId: '2', title: '演示课', termName: '2026 秋季', units: [{ id: '3' }] };
const record = {
  id: '3', type: 'video', chapter: '第一章', lesson: '第一节', name: '绪论',
  url: 'https://www.icourse163.org/learn/TEST-1?tid=2#/learn/content?cid=3',
  screenshots: [{ time: 10, file: 'assets/3/frame-0001.png' }],
  cues: [{ start: 9, end: 11, text: '先说这句话' }],
  questions: [{ time: 12, title: '小测问题？', options: ['A', 'B'], answer: '', explanation: '' }],
  attachments: [], warnings: [], text: '', ok: true
};

test('字幕、截图、小测按时间排序，索引可回链到课程纪要', () => {
  const notes = renderNotes(course, [record]);
  assert.ok(notes.indexOf('先说这句话') < notes.indexOf('frame-0001.png'));
  assert.ok(notes.indexOf('frame-0001.png') < notes.indexOf('小测问题？'));
  assert.match(notes, /<a id="unit-3"><\/a>/);
  assert.match(notes, /答案：当前会话未获取到/);
  assert.match(renderQuizIndex(course, [record]), /notes\.md#unit-3/);
});

test('完整导出在中断后可读取清单继续', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mooc-notes-test-'));
  try {
    const manifest = await readManifest(directory, course);
    manifest.records[record.id] = record;
    await saveExport(directory, manifest, course);
    assert.equal((await readManifest(directory, course)).records['3'].questions.length, 1);
    assert.match(await readFile(path.join(directory, 'quizzes.md'), 'utf8'), /小测问题？/);
    const lessonDirectory = path.join(directory, 'lessons', lessonDirectoryName(record));
    assert.match(await readFile(path.join(directory, 'README.md'), 'utf8'), /图文纪要/);
    assert.match(await readFile(path.join(directory, 'README.md'), 'utf8'), /期次：2026 秋季/);
    assert.equal(lessonDirectoryName(record), '01-01');
    assert.match(await readFile(path.join(lessonDirectory, 'notes.md'), 'utf8'), /\.\.\/\.\.\/assets\/3\/frame-0001\.png/);
    assert.match(await readFile(path.join(lessonDirectory, 'quizzes.md'), 'utf8'), /小测问题？/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('不同教学小节分别生成文档且保留课程合并纪要', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mooc-notes-lessons-'));
  const another = {
    ...record, id: '4', lessonId: '22', lessonIndex: 1, lesson: '第二节', name: '继续学习',
    screenshots: [], cues: [{ start: 1, end: 2, text: '第二节字幕' }], questions: []
  };
  const completeCourse = { ...course, units: [course.units[0], { id: '4' }] };
  try {
    const manifest = await readManifest(directory, completeCourse);
    manifest.records[record.id] = record;
    await saveExport(directory, manifest, completeCourse);
    manifest.records[another.id] = another;
    await saveExport(directory, manifest, completeCourse);
    const firstNotes = await readFile(path.join(directory, 'lessons', lessonDirectoryName(record), 'notes.md'), 'utf8');
    const secondNotes = await readFile(path.join(directory, 'lessons', lessonDirectoryName(another), 'notes.md'), 'utf8');
    const combined = await readFile(path.join(directory, 'notes.md'), 'utf8');
    assert.match(firstNotes, /先说这句话/);
    assert.doesNotMatch(firstNotes, /第二节字幕/);
    assert.match(secondNotes, /第二节字幕/);
    assert.match(combined, /先说这句话/);
    assert.match(combined, /第二节字幕/);
    assert.deepEqual([lessonDirectoryName(record), lessonDirectoryName(another)], ['01-01', '01-02']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('已有教学小节目录原地复用且不重命名', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mooc-notes-existing-'));
  const existingName = '01-01-第一章-第一节';
  try {
    const existing = path.join(directory, 'lessons', existingName);
    await mkdir(existing, { recursive: true });
    await writeFile(path.join(existing, 'marker'), 'kept');
    const manifest = await readManifest(directory, course);
    manifest.records[record.id] = record;
    await saveExport(directory, manifest, course);
    assert.equal(await readFile(path.join(existing, 'marker'), 'utf8'), 'kept');
    await assert.rejects(access(path.join(directory, 'lessons', '01-01')));
    assert.match(await readFile(path.join(directory, 'README.md'), 'utf8'), /01-01-%E7%AC%AC%E4%B8%80%E7%AB%A0-%E7%AC%AC%E4%B8%80%E8%8A%82/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
