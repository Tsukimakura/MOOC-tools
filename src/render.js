import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { formatTime } from './subtitles.js';

const line = (value) => String(value ?? '').replace(/\s+/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_{}\[\]()#+!|]/g, '\\$&').trim();
const heading = line;

export async function readManifest(directory, course) {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.schema !== 1 || manifest.course.slug !== course.slug || manifest.course.termId !== course.termId) {
      throw new Error('输出目录属于另一门课程或不兼容的版本。');
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return { schema: 1, course: { slug: course.slug, termId: course.termId, title: course.title }, records: {} };
    throw error;
  }
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}

function renderQuestion(question, index) {
  const lines = [`**题 ${index + 1}：${line(question.title)}**`];
  for (const image of question.images || []) lines.push(`![题 ${index + 1} 配图](${image})`);
  for (const option of question.options || []) lines.push(`- ${line(option)}`);
  lines.push(question.answer ? `- 课程提供的答案：${line(question.answer)}` : '- 答案：当前会话未获取到');
  if (question.explanation) lines.push(`- 课程提供的解析：${line(question.explanation)}`);
  return lines.join('\n');
}

export function renderNotes(course, records) {
  const lines = [
    `# ${heading(course.title)}：学习纪要`, '',
    `课程：${line(course.slug)}　期次：${line(course.termId)}`, '',
    `来源：[中国大学 MOOC](https://www.icourse163.org/course/${encodeURIComponent(course.slug)}?tid=${encodeURIComponent(course.termId)})`, '',
    '本文件按视频时间线排列字幕、截图和驻点小测；课后 Quiz 列在相应课时之后。', '',
    '## 目录', ''
  ];
  for (const record of records) lines.push(`- [${line(record.chapter)} / ${line(record.lesson)} / ${line(record.name)}](#unit-${record.id})`);
  for (const record of records) {
    lines.push('', `---`, '', `<a id="unit-${record.id}"></a>`, `## ${heading(record.chapter)} / ${heading(record.lesson)} / ${heading(record.name)}`, '',
      `类型：${record.type === 'video' ? '视频' : record.type === 'quiz' ? 'Quiz' : '课件'}　[打开原课时](${record.url})`, '');
    for (const warning of record.warnings || []) lines.push(`> 缺失或提示：${line(warning)}`, '');
    const events = [];
    for (const shot of record.screenshots || []) events.push({ type: 'image', time: shot.time, value: shot });
    for (const cue of record.cues || []) events.push({ type: 'subtitle', time: cue.start, value: cue });
    for (const [index, question] of (record.questions || []).entries()) events.push({ type: 'quiz', time: question.time, index, value: question });
    events.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || ({ image: 0, subtitle: 1, quiz: 2 }[a.type] - { image: 0, subtitle: 1, quiz: 2 }[b.type]));
    for (const event of events) {
      const time = event.time === null || event.time === undefined ? '' : `**[${formatTime(event.time)}]** `;
      if (event.type === 'image') lines.push(`${time}视频画面`, '', `![${formatTime(event.time)} 视频画面](${event.value.file})`, '');
      if (event.type === 'subtitle') lines.push(`${time}${line(event.value.text)}`, '');
      if (event.type === 'quiz') lines.push(`${time}${record.type === 'quiz' ? '课后 Quiz' : '驻点小测'}`, '', renderQuestion(event.value, event.index), '');
    }
    for (const attachment of record.attachments || []) {
      if (attachment.endsWith('.pdf')) lines.push(`[下载课件 PDF](${attachment})`, '');
      else lines.push(`![${record.type === 'quiz' ? 'Quiz 页面截图' : '课件截图'}](${attachment})`, '');
    }
    if (record.text && !record.questions?.length) lines.push('### 页面文字', '', line(record.text), '');
    if (!events.length && !record.attachments?.length && !record.text) lines.push('此课时没有可导出的内容。', '');
  }
  return `${lines.join('\n').trim()}\n`;
}

export function renderQuizIndex(course, records) {
  const lines = [`# ${heading(course.title)}：小测索引`, '', '按章节、课时列出已获取的驻点小测和课后 Quiz。', ''];
  let count = 0;
  let currentLesson = '';
  for (const record of records) {
    if (!record.questions?.length) continue;
    count += record.questions.length;
    const lesson = `${record.chapter} / ${record.lesson}`;
    if (lesson !== currentLesson) {
      lines.push(`## ${heading(lesson)}`, '');
      currentLesson = lesson;
    }
    lines.push(`### ${heading(record.name)}（${record.type === 'quiz' ? '课后 Quiz' : '驻点小测'}）`, '',
      `[查看学习纪要](notes.md#unit-${record.id}) · [打开原课时](${record.url})`, '');
    for (const [index, question] of record.questions.entries()) {
      const time = question.time == null ? '' : `[${formatTime(question.time)}] `;
      lines.push(`${index + 1}. ${time}${line(question.title)}`);
      for (const image of question.images || []) lines.push(`   ![题 ${index + 1} 配图](${image})`);
      for (const option of question.options || []) lines.push(`   - ${line(option)}`);
      lines.push(question.answer ? `   - 课程提供的答案：${line(question.answer)}` : '   - 答案：当前会话未获取到');
      if (question.explanation) lines.push(`   - 课程提供的解析：${line(question.explanation)}`);
    }
    lines.push('');
  }
  if (!count) lines.push('暂未获取到小测题目。', '');
  return `${lines.join('\n').trim()}\n`;
}

export async function saveExport(directory, manifest, course) {
  const records = course.units.map((unit) => manifest.records[unit.id]).filter(Boolean);
  await atomicWrite(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await atomicWrite(path.join(directory, 'notes.md'), renderNotes(course, records));
  await atomicWrite(path.join(directory, 'quizzes.md'), renderQuizIndex(course, records));
}
