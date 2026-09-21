import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MoocApi, readSession, saveSession, sessionPath } from '../src/api.js';
import { memberIdFromCookies } from '../src/auth.js';

const cookies = [
  { name: 'NTESSTUDYSI', value: 'csrf-test', domain: '.icourse163.org', path: '/', secure: true },
  { name: 'STUDY_SESS', value: 'secret-test', domain: '.icourse163.org', path: '/', secure: true },
  { name: 'THE_LAST_LOGIN_MOBILE', value: 'redacted', domain: 'reg.icourse163.org', path: '/', secure: true }
];

test('从学习会话 Cookie 读取用户编号，不依赖个人主页 HTML', () => {
  assert.equal(memberIdFromCookies([{ name: 'STUDY_INFO', value: encodeURIComponent('name|0|123456789|extra') }]), '123456789');
  assert.equal(memberIdFromCookies([{ name: 'NETEASE_WDA_UID', value: '#123456789|extra' }]), '123456789');
  assert.equal(memberIdFromCookies([{ name: 'STUDY_INFO', value: 'invalid' }]), null);
});

test('有学习会话 Cookie 时获取用户编号不会访问重定向的个人主页', async () => {
  const api = new MoocApi([...cookies, {
    name: 'STUDY_INFO', value: encodeURIComponent('name|0|123456789|extra'),
    domain: '.icourse163.org', path: '/'
  }], async () => { throw new Error('不应请求个人主页'); });
  assert.equal(await api.getMemberId(), '123456789');
});

test('API 会话文件仅保存平台 Cookie，且只有当前用户可读', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-api-test-'));
  const oldState = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const profile = path.join(root, 'profile');
    await saveSession(cookies, profile);
    const file = sessionPath(profile);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).cookies.length, 2);
    assert.equal((await readSession(profile)).length, 2);
  } finally {
    if (oldState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldState;
    await rm(root, { recursive: true, force: true });
  }
});

test('读取旧会话时删除多余 Cookie 并收紧文件权限', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-session-test-'));
  const oldState = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    const profile = path.join(root, 'profile');
    const file = sessionPath(profile);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, cookies }), { mode: 0o644 });
    assert.equal((await readSession(profile)).length, 2);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).cookies.length, 2);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    if (oldState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldState;
    await rm(root, { recursive: true, force: true });
  }
});

test('课程、视频和驻点题直接调用接口并带当前会话', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url);
    calls.push({ target, options });
    if (target.pathname.endsWith('getMyLearnedCoursePanelList.rpc')) return Response.json({
      result: { result: [{ id: 42, name: '测试课程', termPanel: { id: 91 }, schoolPanel: { shortName: 'TEST' } }], pagination: { totalPageCount: 1 } }
    });
    if (target.pathname.endsWith('getLastLearnedMocTermDto.rpc')) return Response.json({
      result: { mocTermDto: { id: 91, chapters: [{ lessons: [{ id: 10, units: [
        { id: 11, contentId: 12, contentType: 1, name: '视频', anchorQuestions: [{ anchor: 73, questionId: 123 }] },
        { id: 13, contentId: 14, contentType: 5, name: '课后 Quiz' }
      ] }] }] } }
    });
    if (target.pathname === '/home.htm') return new Response('<a href="?userId=456">me</a>');
    if (target.pathname.endsWith('getResourceTokenV2.rpc')) return Response.json({
      result: { videoSignDto: { signature: 'sig', videoId: 88, duration: 500 } }
    });
    if (target.pathname === '/eds/api/v1/vod/video') return Response.json({
      result: { videos: [{ format: 'hls', videoUrl: 'http://mooc2vod.stu.126.net/video.m3u8', quality: 2 }] }
    });
    if (target.pathname.endsWith('MocQuizBean.fetchQuestions.dwr')) return new Response(
      'var s0=[];var s1={};s0[0]=s1;s1.id=123;s1.optionNumber=0;s1.plainTextTitle="测试题目";s1.stdAnswer="答案";'
    );
    if (target.pathname.endsWith('CourseBean.getLessonUnitLearnVo.dwr')) return new Response(
      'var s0=[];var s1={};s0[0]=s1;s1.id=321;s1.optionNumber=0;s1.plainTextTitle="课后题目";s1.stdAnswer="课后答案";'
    );
    throw new Error(`意外请求：${target}`);
  };
  const api = new MoocApi(cookies, fetchImpl);
  assert.equal(await api.sessionActive(), true);
  const course = await api.course('TEST-42');
  const unit = course.units[0];
  const stream = await api.videoStream(unit);
  const questions = await api.videoQuestions(unit);
  const quizQuestions = await api.quizQuestions(course.units[1]);
  assert.equal(course.termId, '91');
  assert.equal(stream.url, 'https://mooc2vod.stu.126.net/video.m3u8');
  assert.deepEqual(questions.map(({ time, answer }) => ({ time, answer })), [{ time: 73, answer: '答案' }]);
  assert.deepEqual(quizQuestions.map(({ id, answer }) => ({ id, answer })), [{ id: '321', answer: '课后答案' }]);
  assert.equal(calls.filter(({ target }) => target.hostname === 'www.icourse163.org').every(({ options }) => options.headers.Cookie.includes('STUDY_SESS=secret-test')), true);
  assert.equal(calls.find(({ target }) => target.hostname === 'vod.study.163.com').options.headers.Cookie, undefined);
});

test('图片请求拦截跳转到非平台主机', async () => {
  const api = new MoocApi(cookies, async () => new Response(null, { status: 302, headers: { Location: 'https://example.com/private' } }));
  assert.equal(await api.resource('https://edu-image.nosdn.127.net/test.jpg'), null);
  assert.equal(await api.resource('http://127.0.0.1/test.jpg'), null);
});
