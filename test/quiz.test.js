import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuestions, questionsFromData, questionsFromDwr } from '../src/quiz.js';
import { fetchVideoQuestions, resourceUrlsFromDwr, subtitleUrlsFromDwr } from '../src/capture.js';

test('接口题目只保留题干与选项，答案须页面可见', () => {
  const fromNetwork = questionsFromData({ result: { questions: [{
    title: '<p>2 + 2 等于？</p>', optionDtos: [
      { content: 'A. 3', answer: false }, { content: 'B. 4', answer: true }
    ], stdAnswer: 'B', analyse: '因为 2 + 2 = 4', pauseTime: 12
  }] } });
  assert.deepEqual(fromNetwork, [{ id: '', title: '2 + 2 等于？', options: ['A. 3', 'B. 4'], images: [], answer: '', explanation: '', time: 12 }]);
  const merged = mergeQuestions(fromNetwork, [{ title: '2 + 2 等于？', options: [], answer: 'B', explanation: '可见解析', time: 12 }]);
  assert.equal(merged[0].answer, 'B');
  assert.equal(merged[0].options.length, 2);
});

test('安全解析 DWR 中没有选项的驻点题和配图，不导出隐藏答案', () => {
  const body = `var s0=[];var s1={};s0[0]=s1;s1.optionNumber=0;s1.position=null;s1.plainTextTitle="为什么需要旋转？";s1.title="<img src=\\"http://edu-image.nosdn.127.net/a.jpg\\"><p>为什么需要旋转？</p>";s1.stdAnswer="隐藏答案";dwr.engine._remoteHandleCallback('1','0',{questions:s0});`;
  assert.deepEqual(questionsFromDwr(body), [{
    id: '', title: '为什么需要旋转？', options: [], images: ['http://edu-image.nosdn.127.net/a.jpg'],
    answer: '', explanation: '', time: null
  }]);
});

test('独立读取驻点题时使用课程目录中的视频时间', async () => {
  const body = 'var s0=[];var s1={};s0[0]=s1;s1.id=123;s1.optionNumber=0;s1.plainTextTitle="旋转后是什么颜色？";';
  const page = {
    browserContext: () => ({ cookies: async () => [{ name: 'NTESSTUDYSI', value: 'test' }] }),
    evaluate: async () => body
  };
  const questions = await fetchVideoQuestions(page, { id: '10', anchors: [{ id: '123', time: 73 }] });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].time, 73);
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
