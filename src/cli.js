import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { launchSession, loadAccountCourses, loadCourse } from './browser.js';
import { captureUnit } from './capture.js';
import { safeName, selectUnits } from './course.js';
import { openInPlayer } from './player.js';
import { askText, choose } from './prompt.js';
import { mergeQuestions, missingVideoAnchors } from './quiz.js';
import { readManifest, saveExport } from './render.js';
import { fetchVideoStream } from './stream.js';

const VERSION = '0.2.0';
const HELP = `mooc-notes ${VERSION} — 中国大学 MOOC 图文学习纪要

用法：
  mooc-notes                 交互式菜单：选课程、课时与操作
  mooc-notes login [--browser 路径] [--profile 目录]
  mooc-notes courses         列出当前账号中的课程
  mooc-notes list [课程链接|课程编号|数字ID]
  mooc-notes export [课程] [--unit 课时ID | --all] [--output 目录]
  mooc-notes quizzes [课程] [--unit 课时ID | --all] [--output 目录]
  mooc-notes video-url [课程] [--unit 视频名称或ID]
  mooc-notes play [课程] [--unit 视频名称或ID] [--player PATH]

省略课程时在终端中选择账号课程，或手动输入课程代码；省略视频课时时在终端中选择。
video-url 只向标准输出写入视频链接，便于复制或传给播放器。

选项：
  --browser PATH       Chrome/Chromium 可执行文件
  --profile DIR        浏览器本机会话目录
  --headless           使用已有会话无界面运行
  --player PATH        play 使用的播放器；也可设置 MOOC_NOTES_PLAYER
  --output DIR         导出目录，默认 downloads/课程编号-期次
  --unit TEXT          只导出匹配名称或 ID 的课时资源
  --all                明确选择整门课程；默认只选一节课
  --interval SEC       视频截图采样间隔，默认 2 秒
  --threshold NUMBER   画面变化阈值，默认 1
  --max-frames NUMBER  每个视频截图上限，默认 160
  --scan-mode MODE     seek（快速跳播，默认）或 realtime（实际播放，适合驻点小测）
  --force              重新采集已完成的资源
  --help               显示帮助
  --version            显示版本`;

function parseArguments(argv) {
  const options = {};
  const positional = [];
  const names = new Map([
    ['--browser', 'browser'], ['--profile', 'profile'], ['--output', 'output'], ['--player', 'player'],
    ['--unit', 'unit'], ['--interval', 'interval'], ['--threshold', 'threshold'], ['--max-frames', 'maxFrames'], ['--scan-mode', 'scanMode']
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version') options.version = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--all') options.all = true;
    else if (names.has(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要一个值。`);
      options[names.get(arg)] = value;
    } else if (arg.startsWith('-')) throw new Error(`未知选项：${arg}`);
    else positional.push(arg);
  }
  for (const [key, min, max] of [['interval', 0.25, 60], ['threshold', 0, 255], ['maxFrames', 1, 2000]]) {
    if (options[key] === undefined) continue;
    const value = Number(options[key]);
    if (!Number.isFinite(value) || value < min || value > max || (key === 'maxFrames' && !Number.isInteger(value))) {
      throw new Error(`--${key === 'maxFrames' ? 'max-frames' : key} 必须在 ${min}–${max} 之间。`);
    }
    options[key] = value;
  }
  if (options.scanMode && !['seek', 'realtime'].includes(options.scanMode)) throw new Error('--scan-mode 只能是 seek 或 realtime。');
  if (options.all && options.unit) throw new Error('--all 和 --unit 不能同时使用。');
  return { options, positional };
}

async function login(page) {
  await page.goto('https://www.icourse163.org/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  console.log('浏览器已打开。请在其中完成登录，然后回到终端。');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { await prompt.question('登录完成后按 Enter 保存本机会话…'); } finally { prompt.close(); }
  const cookies = await page.browserContext().cookies('https://www.icourse163.org');
  if (!cookies.some((cookie) => cookie.name === 'STUDY_SESS' || cookie.name === 'STUDY_PERSIST')) {
    console.log('浏览器会话已保存；未能确认登录状态，运行 list 可进一步验证。');
  } else console.log('浏览器会话已保存。');
}

export function mergeCapturedRecord(previous, record, unit) {
  const saved = previous ? {
    ...record,
    cues: record.cues.length ? record.cues : previous.cues || [],
    screenshots: record.screenshots.length ? record.screenshots : previous.screenshots || [],
    questions: mergeQuestions(record.questions || [], previous.questions || []),
    attachments: record.attachments.length ? record.attachments : previous.attachments || [],
    text: record.text || previous.text || '',
    ok: record.ok || Boolean(previous.ok && (unit.type !== 'video' || previous.screenshots?.length))
  } : record;
  if (unit.type === 'video' && missingVideoAnchors(unit.anchors, saved.questions).length) saved.ok = false;
  saved.warnings = saved.warnings.filter((warning) =>
    !(warning === '未找到可读取的字幕。' && saved.cues.length) &&
    !(warning === '视频播放器未加载，无法截图。' && saved.screenshots.length) &&
    !(warning.startsWith('跳播扫描可能') && saved.questions.length) &&
    !(warning.includes('处驻点小测，仍缺') && !missingVideoAnchors(unit.anchors, saved.questions).length) &&
    !(warning.includes('道题未从当前课程会话获得答案') && saved.questions.every((question) => question.answer))
  );
  return saved;
}

function requireTerminal(message) {
  if (!process.stdin.isTTY) throw new Error(message);
}

async function chooseCourse(page) {
  requireTerminal('未提供课程；请传入课程代码或链接，或在终端中运行交互菜单。');
  process.stderr.write('正在读取账号中的课程…\n');
  let courses = [];
  try { courses = await loadAccountCourses(page); }
  catch (error) { process.stderr.write(`账号课程列表暂不可用：${error.message}\n`); }
  if (!courses.length) return askText('请输入课程代码或链接');
  const selected = await choose(courses.map((course) => ({
    label: `${course.title} · ${course.slug} · tid=${course.termId}`,
    value: course.url
  })), '选择课程', { manualLabel: '手动输入课程代码或链接' });
  return selected || askText('请输入课程代码或链接');
}

async function chooseVideo(course, selector) {
  const matches = (selector ? selectUnits(course, selector) : course.units).filter((unit) => unit.type === 'video');
  if (!matches.length) throw new Error('筛选结果中没有视频课时。');
  if (matches.length === 1) return matches[0];
  requireTerminal('请用 --unit 指定唯一的视频课时，或在终端中选择。');
  return choose(matches.map((unit) => ({
    label: `${unit.name} [${unit.id}] · ${unit.lesson} · ${unit.chapter}`.replace(/\s+/g, ' '),
    value: unit
  })), '选择视频课时');
}

async function chooseResources(course, command, options) {
  const allowed = command === 'quizzes' ? new Set(['video', 'quiz']) : new Set(['video', 'quiz', 'document']);
  const candidates = (options.unit ? selectUnits(course, options.unit) : course.units)
    .filter((unit) => allowed.has(unit.type));
  if (!candidates.length) throw new Error('筛选结果中没有可采集的课时。');
  if (options.all) return candidates;
  if (options.unit && candidates.length === 1) return candidates;
  requireTerminal('请用 --unit 指定一节课，或用 --all 明确导出整门课程。');
  const unit = await choose(candidates.map((item) => ({
    label: `${item.name} [${{ video: '视频', quiz: '小测', document: '课件' }[item.type]}, ${item.id}] · ${item.lesson} · ${item.chapter}`.replace(/\s+/g, ' '),
    value: item
  })), command === 'quizzes' ? '选择包含小测的课时' : '选择要导出的课时');
  return [unit];
}

async function videoStreamWithRetry(page, unit) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetchVideoStream(page, unit); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function main(argv) {
  const { options, positional } = parseArguments(argv);
  if (options.version) { console.log(VERSION); return; }
  if (options.help || (!positional.length && !process.stdin.isTTY)) { console.log(HELP); return; }
  const [commandArgument, input] = positional;
  const command = commandArgument || await choose([
    { label: '导出一节课的图文纪要', value: 'export' },
    { label: '获取一节课的小测', value: 'quizzes' },
    { label: '获取视频链接', value: 'video-url' },
    { label: '用自己的播放器播放', value: 'play' },
    { label: '查看账号课程', value: 'courses' },
    { label: '登录中国大学 MOOC', value: 'login' }
  ], '请选择操作');
  if (!['login', 'courses', 'list', 'export', 'quizzes', 'video-url', 'play'].includes(command)) throw new Error(`未知命令：${command}`);
  if (options.all && !['export', 'quizzes'].includes(command)) throw new Error('--all 只适用于 export 和 quizzes。');
  if (options.player && command !== 'play') throw new Error('--player 只适用于 play。');
  if (options.unit && ['login', 'courses'].includes(command)) throw new Error('--unit 不适用于当前命令。');
  if (!['login', 'courses'].includes(command) && !input) requireTerminal('请提供课程代码或链接；交互选择需要在终端中运行。');
  if (['export', 'quizzes'].includes(command) && !options.unit && !options.all) {
    requireTerminal('默认只导出一节课；请用 --unit 指定课时，或用 --all 明确导出整门课程。');
  }
  if (positional.length > (['login', 'courses'].includes(command) ? 1 : 2)) throw new Error('命令中有多余的位置参数。');
  if (command === 'login' && options.headless) throw new Error('login 需要打开可见浏览器，请移除 --headless。');
  options.scanMode ||= command === 'quizzes' ? 'realtime' : 'seek';
  const { browser, page } = await launchSession(options);
  try {
    if (command === 'login') { await login(page); return; }
    if (command === 'courses') {
      const courses = await loadAccountCourses(page);
      if (!courses.length) { console.log('当前账号没有可列出的中国大学 MOOC 课程。'); return; }
      console.log(`当前账号的课程（${courses.length} 门）`);
      for (const [index, course] of courses.entries()) {
        console.log(`${index + 1}. ${course.title} · ${course.slug} · tid=${course.termId}`);
      }
      return;
    }
    const course = await loadCourse(page, input || await chooseCourse(page));
    if (command === 'video-url' || command === 'play') {
      const unit = await chooseVideo(course, options.unit);
      let player;
      if (command === 'play') {
        player = options.player || process.env.MOOC_NOTES_PLAYER || process.env.VIDEO_OPENER;
        if (!player) {
          requireTerminal('请用 --player PATH 或 MOOC_NOTES_PLAYER 指定播放器。');
          player = await askText('请输入播放器程序路径或命令');
        }
      }
      const stream = await videoStreamWithRetry(page, unit);
      if (command === 'video-url') console.log(stream.url);
      else {
        await openInPlayer(player, stream.url);
        console.log(`已启动播放器：${unit.name}`);
      }
      return;
    }
    if (command === 'list') {
      const selected = selectUnits(course, options.unit);
      console.log(`${course.title} (${course.slug}, tid=${course.termId})`);
      for (const unit of selected) console.log(`${unit.id}\t${unit.type}\t${unit.chapter} / ${unit.lesson} / ${unit.name}`);
      return;
    }
    const resources = await chooseResources(course, command, options);
    const directory = path.resolve(options.output || path.join('downloads', safeName(`${course.slug}-${course.termId}`)));
    const manifest = await readManifest(directory, course);
    for (const [index, unit] of resources.entries()) {
      const previous = manifest.records[unit.id];
      const hasQuestions = Boolean(previous?.questions?.length);
      const hasUnanswered = Boolean(previous?.questions?.some((question) => !question.answer));
      const complete = previous?.ok === true && (unit.type !== 'video' || Boolean(previous.screenshots?.length) || (command === 'quizzes' && hasQuestions));
      if (complete && !options.force && (command !== 'quizzes' || hasQuestions && !hasUnanswered)) {
        console.log(`[${index + 1}/${resources.length}] 跳过已采集：${unit.name}`);
        continue;
      }
      console.log(`[${index + 1}/${resources.length}] 采集 ${unit.type}：${unit.name}`);
      const record = await captureUnit(page, unit, path.join(directory, 'assets'), {
        ...options,
        quizzesOnly: command === 'quizzes',
        onProgress: (percent) => console.log(`  视频流处理 ${percent}%`)
      });
      const saved = mergeCapturedRecord(previous, record, unit);
      manifest.records[unit.id] = saved;
      await saveExport(directory, manifest, course);
      console.log(`  字幕 ${saved.cues.length} 条，截图 ${saved.screenshots.length} 张，题目 ${saved.questions.length} 道`);
      for (const warning of saved.warnings) console.log(`  提示：${warning}`);
    }
    await saveExport(directory, manifest, course);
    console.log(`完成：${path.join(directory, 'notes.md')}；${path.join(directory, 'quizzes.md')}`);
  } finally {
    await browser.close();
  }
}
