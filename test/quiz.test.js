import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuestions, questionsFromData } from '../src/quiz.js';
import { resourceUrlsFromDwr } from '../src/capture.js';

test('接口题目只保留题干与选项，答案须页面可见', () => {
  const fromNetwork = questionsFromData({ result: { questions: [{
    title: '<p>2 + 2 等于？</p>', optionDtos: [
      { content: 'A. 3', answer: false }, { content: 'B. 4', answer: true }
    ], stdAnswer: 'B', analyse: '因为 2 + 2 = 4', pauseTime: 12
  }] } });
  assert.deepEqual(fromNetwork, [{ title: '2 + 2 等于？', options: ['A. 3', 'B. 4'], answer: '', explanation: '', time: 12 }]);
  const merged = mergeQuestions(fromNetwork, [{ title: '2 + 2 等于？', options: [], answer: 'B', explanation: '可见解析', time: 12 }]);
  assert.equal(merged[0].answer, 'B');
  assert.equal(merged[0].options.length, 2);
});

test('只从 DWR 元数据提取资源 URL，不执行返回的脚本', () => {
  const body = 'var s0={url:"https://edu-image.nosdn.127.net/sub.srt",textOrigUrl:"https://www.icourse163.org/a.pdf"};';
  assert.deepEqual(resourceUrlsFromDwr(body), ['https://edu-image.nosdn.127.net/sub.srt', 'https://www.icourse163.org/a.pdf']);
});
