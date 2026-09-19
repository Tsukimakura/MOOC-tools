import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCourse, parseCourseInput, selectUnits } from '../src/course.js';

const input = 'https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496#/learn/content?type=detail&id=1278585470&cid=1320673525';

test('课程链接、编号和数字 ID 解析', () => {
  assert.deepEqual(parseCourseInput(input), {
    url: 'https://www.icourse163.org/course/ZJU1-1460402161?tid=1488053496',
    slug: 'ZJU1-1460402161', termId: '1488053496'
  });
  assert.equal(parseCourseInput('ZJU1-1460402161').slug, 'ZJU1-1460402161');
  assert.equal(parseCourseInput('1460402161').url, 'https://www.icourse163.org/course/detail.htm?cid=1460402161');
  assert.throws(() => parseCourseInput('https://example.com/course/X-1'), /只接受/);
});

test('目录跨章节标准化并生成示例课时链接', () => {
  const raw = { id: 1488053496, chapters: [{ name: 'Lecture 1', lessons: [{ id: 1278585470, name: '1.1', units: [
    { id: 1320673525, contentId: 1217120150, contentType: 1, name: 'Video', anchorQuestions: [{ anchor: 73, questionId: 1388670745 }] },
    { id: 1320673528, contentId: 1258602372, contentType: 5, name: 'Quiz' },
    { id: 3, contentType: 6, name: 'Discussion' }
  ] }], quizs: [{ id: 99, name: 'Chapter quiz', units: [{ id: 100, name: 'Quiz part' }] }] }] };
  const course = normalizeCourse(raw, { slug: 'ZJU1-1460402161', termId: '1488053496', title: 'Algorithms' });
  assert.equal(course.units.length, 3);
  assert.deepEqual(course.units.map((unit) => unit.type), ['video', 'quiz', 'quiz']);
  assert.match(course.units[0].url, /id=1278585470&cid=1320673525&contentid=1217120150/);
  assert.deepEqual(course.units[0].anchors, [{ time: 73, id: '1388670745' }]);
  assert.equal(selectUnits(course, '1320673528')[0].name, 'Quiz');
  assert.match(course.units[2].url, /#\/learn\/quiz\?id=99$/);
});
