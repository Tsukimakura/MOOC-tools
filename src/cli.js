import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { launchSession } from './browser.js';
import { MoocApi, readSession, saveSession, syncBrowserSession } from './api.js';
import { captureUnit } from './capture.js';
import { captureDocumentApi, captureVideoApi } from './api_capture.js';
import { groupLessons, safeName, selectLessons, selectUnits } from './course.js';
import { openInPlayer, preparePlayerSubtitles, subtitleDirectory } from './player.js';
import { askText, choose } from './prompt.js';
import { ProgressReporter, withProgress } from './progress.js';
import { mergeQuestions, missingVideoAnchors } from './quiz.js';
import { readManifest, saveExport } from './render.js';

const VERSION = '0.8.0';
const HELP = `mooc-notes ${VERSION} — 中国大学 MOOC 图文学习纪要

用法：
  mooc-notes                         交互式菜单：选操作、课程和教学小节
  mooc-notes login                   首次登录并保存本机会话
  mooc-notes [课程] [--mode 模式] [--lesson 小节ID | --unit 资源ID | --all]

模式：notes（默认，图文纪要）、quizzes（小测）、list（目录）、
      courses（账号课程）、video（获取链接后可选择带字幕播放）。
PotPlayer 和 mpv 可在播放器中切换中文、英文、双语字幕（取决于课程提供的字幕）。
无课程参数时在终端中选账号课程或手动输入；默认只采集一个教学小节。

课程示例：ZJU1-1460402161、1460402161、
  https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496

选项：
  --mode MODE          notes、quizzes、list、courses 或 video
  --browser PATH       Chrome/Chromium 可执行文件
  --profile DIR        浏览器本机会话目录；API 会话按此目录隔离
  --headless           需要网页采集时无界面运行
  --api-only           不启动浏览器；网页专属内容会标记缺失
  --player PATH        video 模式获取链接后直接播放；也可设置 MOOC_NOTES_PLAYER 供交互选择
  --subtitle-arg TEXT  其他播放器的字幕参数模板，例如 --sub-file={file}
  --output DIR         导出目录，默认 downloads/课程编号-期次
  --lesson TEXT        导出一个教学小节的全部相关资源
  --unit TEXT          只导出匹配名称或 ID 的单项资源
  --all                明确选择整门课程；默认只选一个教学小节
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
    ['--browser', 'browser'], ['--profile', 'profile'], ['--output', 'output'], ['--player', 'player'], ['--subtitle-arg', 'subtitleArg'],
    ['--unit', 'unit'], ['--lesson', 'lesson'], ['--mode', 'mode'], ['--interval', 'interval'], ['--threshold', 'threshold'], ['--max-frames', 'maxFrames'], ['--scan-mode', 'scanMode']
  ]);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version') options.version = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--api-only') options.apiOnly = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--all') options.all = true;
    else if (names.has(arg)) {
      const value = argv[++index];
      if (!value || (value.startsWith('--') && arg !== '--subtitle-arg')) throw new Error(`${arg} 需要一个值。`);
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
  if ([options.all, options.unit, options.lesson].filter(Boolean).length > 1) {
    throw new Error('--all、--unit 和 --lesson 只能使用其中一个。');
  }
  return { options, positional };
}

async function login(page, profile) {
  await page.goto('https://www.icourse163.org/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  console.log('浏览器已打开。请在其中完成登录，然后回到终端。');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { await prompt.question('登录完成后按 Enter 保存本机会话…'); } finally { prompt.close(); }
  const cookies = await page.browserContext().cookies('https://www.icourse163.org');
  await saveSession(cookies, profile);
  if (!cookies.some((cookie) => cookie.name === 'STUDY_SESS' || cookie.name === 'STUDY_PERSIST')) {
    console.log('会话已保存；未能确认登录状态，运行 courses 可进一步验证。');
  } else console.log('会话已保存。');
}

export function mergeCapturedRecord(previous, record, unit) {
  const saved = previous ? {
    ...record,
    cues: record.cues.length ? record.cues : previous.cues || [],
    screenshots: record.screenshots.length ? record.screenshots : previous.screenshots || [],
    questions: mergeQuestions(record.questions || [], previous.questions || []),
    attachments: record.attachments.length ? record.attachments : previous.attachments || [],
    text: record.text || previous.text || '',
    warnings: record.ok ? record.warnings : [...new Set([...(previous.warnings || []), ...(record.warnings || [])])],
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

async function chooseCourse(api) {
  requireTerminal('未提供课程；请传入课程代码或链接，或在终端中运行交互菜单。');
  let courses = [];
  try { courses = await withProgress('读取账号课程', () => api.accountCourses()); }
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

export async function chooseResources(course, command, options) {
  const allowed = command === 'quizzes' ? new Set(['video', 'quiz']) : new Set(['video', 'quiz', 'document']);
  const candidates = course.units.filter((unit) => allowed.has(unit.type));
  if (!candidates.length) throw new Error('筛选结果中没有可采集的课时。');
  if (options.all) return candidates;
  if (options.unit) {
    const matches = selectUnits(course, options.unit).filter((unit) => allowed.has(unit.type));
    if (!matches.length) throw new Error('指定资源不适用于当前命令。');
    if (matches.length === 1) return matches;
    requireTerminal('资源名称匹配多个结果；请使用精确的资源 ID。');
    return [await choose(matches.map((unit) => ({
      label: `${unit.name} [${unit.type}, ${unit.id}] · ${unit.lesson} · ${unit.chapter}`.replace(/\s+/g, ' '), value: unit
    })), '选择单项资源')];
  }
  let lessons = groupLessons(candidates);
  if (options.lesson) lessons = selectLessons(lessons, options.lesson);
  if (lessons.length === 1) return lessons[0].units;
  requireTerminal('请用 --lesson 指定教学小节、--unit 指定单项资源，或用 --all 导出整门课程。');
  const selected = await choose(lessons.map((lesson) => {
    const counts = ['video', 'document', 'quiz'].map((type) => {
      const number = lesson.units.filter((unit) => unit.type === type).length;
      return number ? `${{ video: '视频', document: '课件', quiz: 'Quiz' }[type]} ${number}` : '';
    }).filter(Boolean).join('、');
    return {
      label: `${lesson.chapter} / ${lesson.lesson} · ${counts}`.replace(/\s+/g, ' '), value: lesson
    };
  }), command === 'quizzes' ? '选择教学小节，收集该节的全部小测' : '选择教学小节，导出全部相关资源');
  return selected.units;
}

async function videoStreamWithRetry(api, unit) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await api.videoStream(unit); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function presentVideoLink(stream, unit, options = {}, ui = {
  choose, askText, openInPlayer, writeLink: (url) => console.log(url), writeStatus: (message) => process.stderr.write(message)
}) {
  ui.writeLink(stream.url);
  const play = Boolean(options.player) || (options.interactive && await ui.choose([
    { label: '仅保留视频链接', value: false },
    { label: '发送到播放器', value: true }
  ], '视频链接已获取，接下来要做什么？'));
  if (!play) return;
  const player = options.player || options.defaultPlayer || await ui.askText('请输入播放器程序路径或命令');
  const subtitles = await options.loadSubtitle?.();
  if (!subtitles) ui.writeStatus('提示：当前课程会话未提供可读取的字幕，将只播放视频。\n');
  else if (typeof subtitles !== 'string') {
    const languages = [subtitles.zh && '中文', subtitles.en && '英文', subtitles.bilingual && '双语']
      .filter(Boolean).join(' / ');
    ui.writeStatus(`可用字幕：${languages || '课程原始字幕'}。\n`);
    if (subtitles.en && !subtitles.zh) ui.writeStatus('提示：当前会话仅获取到英文字幕，无法生成中文和双语字幕。\n');
    if (subtitles.sami && /potplayer/i.test(player)) ui.writeStatus('在 PotPlayer 的字幕语言菜单中选择中文、English 或双语。\n');
    if (subtitles.bilingual && /(?:^|[\\/])mpv(?:\.exe)?$/i.test(player)) ui.writeStatus('在 mpv 中按 j 或 J 切换中文、英文、双语字幕。\n');
  }
  await ui.openInPlayer(player, stream.url, subtitles, options.subtitleArg);
  ui.writeStatus(`已启动播放器：${unit.name}\n`);
}

async function saveApiQuestionImages(api, questions, directory, unitId) {
  let index = 0;
  let complete = true;
  for (const question of questions) {
    const files = [];
    for (const url of question.images || []) {
      const image = await api.resource(url).catch(() => null);
      if (!image) { complete = false; continue; }
      const extension = image.type.includes('png') ? 'png' : image.type.includes('webp') ? 'webp' : 'jpg';
      const name = `question-${String(++index).padStart(3, '0')}.${extension}`;
      const assetDir = path.join(directory, 'assets', unitId);
      await mkdir(assetDir, { recursive: true });
      await writeFile(path.join(assetDir, name), image.bytes);
      files.push(`assets/${unitId}/${name}`);
    }
    question.images = files;
  }
  return complete;
}

export async function main(argv) {
  const { options, positional } = parseArguments(argv);
  if (options.version) { console.log(VERSION); return; }
  if (options.help || (!positional.length && !options.mode && !process.stdin.isTTY)) { console.log(HELP); return; }
  if (positional.length > 1) throw new Error('只能提供一个课程编号或链接。');
  if (['courses', 'list', 'export', 'quizzes', 'video-url', 'play'].includes(positional[0])) {
    throw new Error('旧命令已合并；请使用 mooc-notes [课程] --mode 模式。运行 --help 查看示例。');
  }
  const loginRequested = positional[0] === 'login';
  let command = loginRequested ? 'login' : options.mode || 'notes';
  if (!loginRequested && !positional.length && !options.mode && !options.lesson && !options.unit && !options.all) {
    command = await choose([
      { label: '导出教学小节的图文纪要（含视频与 Quiz）', value: 'notes' },
      { label: '获取教学小节的全部小测', value: 'quizzes' },
      { label: '获取视频链接，可继续发送到播放器', value: 'video' },
      { label: '查看账号课程', value: 'courses' },
      { label: '查看课程目录', value: 'list' },
      { label: '登录中国大学 MOOC', value: 'login' }
    ], '请选择操作');
  }
  const input = loginRequested ? undefined : positional[0];
  if (['url', 'play'].includes(command)) throw new Error('视频链接与播放器操作已合并；请使用 --mode video。');
  if (!['login', 'courses', 'list', 'notes', 'quizzes', 'video'].includes(command)) throw new Error(`未知模式：${command}`);
  if (options.mode && loginRequested) throw new Error('login 不支持 --mode。');
  if (options.all && !['notes', 'quizzes'].includes(command)) throw new Error('--all 只适用于 notes 和 quizzes。');
  if (options.player && command !== 'video') throw new Error('--player 只适用于 video 模式。');
  if (options.subtitleArg && command !== 'video') throw new Error('--subtitle-arg 只适用于 video 模式。');
  if (options.subtitleArg && !options.subtitleArg.includes('{file}')) throw new Error('--subtitle-arg 必须包含 {file} 占位符。');
  if (options.unit && ['login', 'courses'].includes(command)) throw new Error('--unit 不适用于当前命令。');
  if (options.lesson && !['notes', 'quizzes'].includes(command)) throw new Error('--lesson 只适用于 notes 和 quizzes。');
  if (command === 'courses' && input) throw new Error('查看账号课程无需指定课程。');
  if (!['login', 'courses'].includes(command) && !input) requireTerminal('请提供课程代码或链接；交互选择需要在终端中运行。');
  if (['notes', 'quizzes'].includes(command) && !options.unit && !options.lesson && !options.all) {
    requireTerminal('默认只导出一个教学小节；请用 --lesson 指定小节、--unit 指定单项资源，或用 --all 导出整门课程。');
  }
  if (command === 'login' && options.headless) throw new Error('login 需要打开可见浏览器，请移除 --headless。');
  if (command === 'login' && options.apiOnly) throw new Error('login 需要浏览器，请移除 --api-only。');
  options.scanMode ||= command === 'quizzes' && !options.apiOnly ? 'realtime' : 'seek';
  if (options.apiOnly && options.scanMode === 'realtime') throw new Error('--api-only 与 --scan-mode realtime 不能同时使用。');
  if (command === 'login') {
    const { browser, page, userDataDir } = await launchSession(options);
    try { await login(page, userDataDir); } finally { await browser.close(); }
    return;
  }
  let cookies = await readSession(options.profile);
  if (!cookies) {
    if (options.apiOnly) throw new Error('尚无 API 会话；请先运行 mooc-notes login。');
    process.stderr.write('首次迁移已有浏览器会话…\n');
    cookies = await syncBrowserSession(options);
  }
  const api = new MoocApi(cookies);
  let browser;
  let page;
  const getPage = async (progress) => {
    if (!page) {
      progress?.stage('启动浏览器以采集网页内容');
      ({ browser, page } = await launchSession(options));
      progress?.stage('等待课程网页加载');
      await page.goto('https://www.icourse163.org/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    }
    return page;
  };
  try {
    if (command === 'courses') {
      const courses = await withProgress('读取账号课程', () => api.accountCourses());
      if (!courses.length) { console.log('当前账号没有可列出的中国大学 MOOC 课程。'); return; }
      console.log(`当前账号的课程（${courses.length} 门）`);
      for (const [index, course] of courses.entries()) {
        console.log(`${index + 1}. ${course.title} · ${course.slug} · tid=${course.termId}`);
      }
      return;
    }
    const selectedCourse = input || await chooseCourse(api);
    const course = await withProgress('读取课程目录', () => api.course(selectedCourse));
    if (command === 'video') {
      const unit = await chooseVideo(course, options.unit);
      const stream = await withProgress('获取视频授权地址', () => videoStreamWithRetry(api, unit));
      await presentVideoLink(stream, unit, {
        player: options.player,
        defaultPlayer: process.env.MOOC_NOTES_PLAYER,
        interactive: Boolean(process.stdin.isTTY),
        subtitleArg: options.subtitleArg,
        loadSubtitle: () => withProgress('获取同步字幕', () => preparePlayerSubtitles(
          api, unit, stream, subtitleDirectory(options.profile, course, unit)
        ))
      });
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
      const retryAnswers = hasUnanswered && (unit.type === 'quiz' || command === 'quizzes');
      if (complete && !options.force && !retryAnswers && (command !== 'quizzes' || hasQuestions)) {
        console.log(`[${index + 1}/${resources.length}] 跳过已采集：${unit.name}`);
        continue;
      }
      console.log(`[${index + 1}/${resources.length}] 采集 ${unit.type}：${unit.name}`);
      const progress = new ProgressReporter();
      let record;
      try {
        if (unit.type === 'quiz') {
          progress.stage('读取 Quiz 题目与答案');
          let questions = [];
          try { questions = await api.quizQuestions(unit); }
          catch (error) { progress.stage(`Quiz 接口不可用：${error.message}`); }
          if (questions.length && await saveApiQuestionImages(api, questions, directory, unit.id)) {
            const unanswered = questions.filter((question) => !question.answer).length;
            record = {
              ...unit, cues: [], screenshots: [], questions, attachments: [], text: '', ok: true,
              warnings: unanswered ? [`${unanswered} 道题未从当前课程会话获得答案。`] : []
            };
            delete record.contentUrl;
          }
        }
        if (command === 'quizzes' && unit.type === 'video' && unit.anchors?.length) {
          progress.stage('读取视频驻点小测');
          let questions = [];
          try { questions = await api.videoQuestions(unit); }
          catch (error) { progress.stage(`题目接口不可用：${error.message}`); }
          if (missingVideoAnchors(unit.anchors, questions).length === 0 &&
            await saveApiQuestionImages(api, questions, directory, unit.id)) {
            const unanswered = questions.filter((question) => !question.answer).length;
            record = {
              ...unit, cues: [], screenshots: [], questions, attachments: [], text: '', ok: true,
              warnings: unanswered ? [`${unanswered} 道题未从当前课程会话获得答案。`] : []
            };
            delete record.contentUrl;
          }
        }
        if (command === 'notes' && unit.type === 'video' && options.scanMode !== 'realtime') {
          record = await captureVideoApi(api, unit, path.join(directory, 'assets'), {
            ...options, onStage: (stage) => progress.stage(stage), onProgress: (percent) => progress.percent(percent)
          });
          progress.stage('保存视频小测配图');
          if (!await saveApiQuestionImages(api, record.questions, directory, unit.id)) {
            record.warnings.push('部分视频小测配图下载失败。');
            record.ok = false;
          }
        }
        if (command === 'notes' && unit.type === 'document') {
          record = await captureDocumentApi(api, unit, path.join(directory, 'assets'), {
            onStage: (stage) => progress.stage(stage)
          });
        }
        if (!record?.ok && !options.apiOnly) {
          const direct = record;
          try {
            progress.stage('使用课程网页补采内容');
            const fromBrowser = await captureUnit(await getPage(progress), api, unit, path.join(directory, 'assets'), {
              ...options, quizzesOnly: command === 'quizzes',
              onStage: (stage) => progress.stage(stage), onProgress: (percent) => progress.percent(percent)
            });
            record = direct ? mergeCapturedRecord(direct, fromBrowser, unit) : fromBrowser;
          } catch (error) {
            if (!direct) throw error;
            direct.warnings.push(`网页补采失败：${error.message}`);
            record = direct;
          }
        }
        if (!record) record = {
          ...unit, cues: [], screenshots: [], questions: [], attachments: [], text: '', ok: false,
          warnings: ['API 未提供可导出的内容；--api-only 已跳过网页采集。']
        };
        delete record.contentUrl;
        progress.stage('保存学习纪要');
        const saved = mergeCapturedRecord(previous, record, unit);
        manifest.records[unit.id] = saved;
        await saveExport(directory, manifest, course);
        progress.stop();
        console.log(`  字幕 ${saved.cues.length} 条，截图 ${saved.screenshots.length} 张，题目 ${saved.questions.length} 道`);
        for (const warning of saved.warnings) console.log(`  提示：${warning}`);
      } finally { progress.stop(); }
    }
    await saveExport(directory, manifest, course);
    console.log(`完成：${path.join(directory, 'notes.md')}；${path.join(directory, 'quizzes.md')}`);
  } finally {
    if (browser) await browser.close();
  }
}
