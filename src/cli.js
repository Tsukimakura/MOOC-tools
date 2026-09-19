import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { launchSession, loadCourse } from './browser.js';
import { captureUnit } from './capture.js';
import { safeName, selectUnits } from './course.js';
import { mergeQuestions } from './quiz.js';
import { readManifest, saveExport } from './render.js';

const HELP = `mooc-notes 0.1.0 — 中国大学 MOOC 图文学习纪要

用法：
  mooc-notes login [--browser 路径] [--profile 目录]
  mooc-notes list <课程链接|课程编号|数字ID> [--headless]
  mooc-notes export <课程> [--unit 名称或ID] [--output 目录]
  mooc-notes quizzes <课程> [--unit 名称或ID] [--output 目录]

选项：
  --browser PATH       Chrome/Chromium 可执行文件
  --profile DIR        浏览器本机会话目录
  --headless           使用已有会话无界面运行
  --output DIR         导出目录，默认 downloads/课程编号-期次
  --unit TEXT          只导出匹配名称或 ID 的课时资源
  --interval SEC       视频截图采样间隔，默认 2 秒
  --threshold NUMBER   画面变化阈值，默认 12
  --max-frames NUMBER  每个视频截图上限，默认 160
  --scan-mode MODE     seek（快速跳播，默认）或 realtime（实际播放，适合驻点小测）
  --force              重新采集已完成的资源
  --help               显示帮助
  --version            显示版本`;

function parseArguments(argv) {
  const options = {};
  const positional = [];
  const names = new Map([
    ['--browser', 'browser'], ['--profile', 'profile'], ['--output', 'output'],
    ['--unit', 'unit'], ['--interval', 'interval'], ['--threshold', 'threshold'], ['--max-frames', 'maxFrames'], ['--scan-mode', 'scanMode']
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version') options.version = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--force') options.force = true;
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

export async function main(argv) {
  const { options, positional } = parseArguments(argv);
  if (options.version) { console.log('0.1.0'); return; }
  if (options.help || !positional.length) { console.log(HELP); return; }
  const [command, input] = positional;
  if (!['login', 'list', 'export', 'quizzes'].includes(command)) throw new Error(`未知命令：${command}`);
  if (command !== 'login' && !input) throw new Error(`${command} 需要课程链接或编号。`);
  if (positional.length > (command === 'login' ? 1 : 2)) throw new Error('命令中有多余的位置参数。');
  if (command === 'login' && options.headless) throw new Error('login 需要打开可见浏览器，请移除 --headless。');
  options.scanMode ||= command === 'quizzes' ? 'realtime' : 'seek';
  const { browser, page } = await launchSession(options);
  try {
    if (command === 'login') { await login(page); return; }
    const course = await loadCourse(page, input);
    const selected = selectUnits(course, options.unit);
    if (command === 'list') {
      console.log(`${course.title} (${course.slug}, tid=${course.termId})`);
      for (const unit of selected) console.log(`${unit.id}\t${unit.type}\t${unit.chapter} / ${unit.lesson} / ${unit.name}`);
      return;
    }
    const directory = path.resolve(options.output || path.join('downloads', safeName(`${course.slug}-${course.termId}`)));
    const manifest = await readManifest(directory, course);
    const resources = command === 'quizzes' ? selected.filter((unit) => unit.type === 'video' || unit.type === 'quiz') : selected;
    if (!resources.length) throw new Error('筛选结果没有可采集的小测或视频。');
    for (const [index, unit] of resources.entries()) {
      const previous = manifest.records[unit.id];
      const hasQuestions = Boolean(previous?.questions?.length);
      if (previous?.ok !== false && previous && !options.force && (command !== 'quizzes' || hasQuestions)) {
        console.log(`[${index + 1}/${resources.length}] 跳过已采集：${unit.name}`);
        continue;
      }
      console.log(`[${index + 1}/${resources.length}] 采集 ${unit.type}：${unit.name}`);
      const record = await captureUnit(page, unit, path.join(directory, 'assets'), { ...options, quizzesOnly: command === 'quizzes' });
      manifest.records[unit.id] = command === 'quizzes' && previous ? {
        ...previous,
        questions: mergeQuestions(previous.questions || [], record.questions || []),
        warnings: [...new Set([...(previous.warnings || []), ...record.warnings])].filter((warning) =>
          !warning.startsWith('跳播扫描可能') || !(record.questions || []).length
        ),
        ok: record.ok
      } : record;
      await saveExport(directory, manifest, course);
      console.log(`  字幕 ${record.cues.length} 条，截图 ${record.screenshots.length} 张，题目 ${record.questions.length} 道`);
      for (const warning of record.warnings) console.log(`  提示：${warning}`);
    }
    await saveExport(directory, manifest, course);
    console.log(`完成：${path.join(directory, 'notes.md')}；${path.join(directory, 'quizzes.md')}`);
  } finally {
    await browser.close();
  }
}
