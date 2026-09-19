import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readManifest, renderNotes, renderQuizIndex, saveExport } from '../src/render.js';

const course = { slug: 'TEST-1', termId: '2', title: '演示课', units: [{ id: '3' }] };
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
  } finally { await rm(directory, { recursive: true, force: true }); }
});
