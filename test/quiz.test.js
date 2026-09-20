import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuestions, missingVideoAnchors, questionsFromData, questionsFromDwr } from '../src/quiz.js';
import { resourceUrlsFromDwr, subtitleUrlsFromDwr } from '../src/resources.js';

test('接口题目保留课程提供的答案、解析和选项', () => {
  const fromNetwork = questionsFromData({ result: { questions: [{
    title: '<p>2 + 2 等于？</p>', optionDtos: [
      { content: 'A. 3', answer: false }, { content: 'B. 4', answer: true }
    ], stdAnswer: 'B', analyse: '因为 2 + 2 = 4', pauseTime: 12
  }] } });
  assert.deepEqual(fromNetwork, [{ id: '', title: '2 + 2 等于？', options: ['A. 3', 'B. 4'], images: [], answer: 'B', explanation: '因为 2 + 2 = 4', time: 12 }]);
  const merged = mergeQuestions(fromNetwork, [{ title: '2 + 2 等于？', options: [], answer: 'B', explanation: '可见解析', time: 12 }]);
  assert.equal(merged[0].answer, 'B');
  assert.equal(merged[0].options.length, 2);
});

test('安全解析 DWR 中没有选项的驻点题、配图和答案', () => {
  const body = `var s0=[];var s1={};s0[0]=s1;s1.optionNumber=0;s1.position=null;s1.plainTextTitle="为什么需要旋转？";s1.title="<img src=\\"http://edu-image.nosdn.127.net/a.jpg\\"><p>为什么需要旋转？</p>";s1.stdAnswer="隐藏答案";dwr.engine._remoteHandleCallback('1','0',{questions:s0});`;
  assert.deepEqual(questionsFromDwr(body), [{
    id: '', title: '为什么需要旋转？', options: [], images: ['http://edu-image.nosdn.127.net/a.jpg'],
    answer: '隐藏答案', explanation: '', time: null
  }]);
});

test('同名但不同编号的驻点题保持分开，并可从选项标记推导答案', () => {
  const questions = questionsFromData([{ id: 1, title: '同一个问题', optionDtos: [{ content: '甲' }, { content: '乙', correct: true }] },
    { id: 2, title: '同一个问题', optionDtos: [{ content: '丙' }, { content: '丁' }] }]);
  assert.equal(mergeQuestions(questions).length, 2);
  assert.equal(questions[0].answer, 'B. 乙');
});

test('网页题干带题号时可与接口题目合并并补上答案', () => {
  const [question] = mergeQuestions(
    [{ id: '123', title: '红黑树性质是什么？', options: ['红', '黑'], answer: '黑', time: null }],
    [{ id: '', title: '1 红黑树性质是什么？', options: ['A.', 'B.'], answer: '', time: null }]
  );
  assert.equal(question.id, '123');
  assert.equal(question.answer, '黑');
  assert.equal(mergeQuestions([question]).length, 1);
});

test('无选项驻点题的继续播放占位文字不作为答案', () => {
  const [question] = questionsFromData({ id: 7, plainTextTitle: '为什么要旋转？', optionNumber: 0, stdAnswer: "Let's continue..." });
  assert.equal(question.answer, '');
  assert.equal(mergeQuestions([question], [{ ...question, answer: "Let's continue..." }])[0].answer, '');
});

test('按驻点编号或时间检查遗漏的题目', () => {
  const anchors = [{ id: '1', time: 10 }, { id: '2', time: 30 }, { id: '3', time: 50 }];
  assert.deepEqual(missingVideoAnchors(anchors, [{ id: '1', time: null }, { id: '', time: 31 }]), [anchors[2]]);
});

test('只从 DWR 元数据提取资源 URL，不执行返回的脚本', () => {
  const body = 'var s0={url:"https://edu-image.nosdn.127.net/sub.srt",textOrigUrl:"https://www.icourse163.org/a.pdf"};';
  assert.deepEqual(resourceUrlsFromDwr(body), ['https://edu-image.nosdn.127.net/sub.srt', 'https://www.icourse163.org/a.pdf']);
});

test('从 DWR 的字幕对象键生成 NOS 地址并过滤非法键', () => {
  const body = 's1.nosKey="ABC123456789";s2.nosKey="../invalid";s3.url="http://www.icourse163.org/video/downloadVideoSrt.htm?srcKey=abc";';
  assert.deepEqual(subtitleUrlsFromDwr(body), [
    'https://nos.netease.com/oc-caption-srt/ABC123456789',
    'http://www.icourse163.org/video/downloadVideoSrt.htm?srcKey=abc'
  ]);
});
