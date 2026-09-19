const HOST = 'www.icourse163.org';

export function parseCourseInput(input) {
  if (!input) throw new Error('请提供课程链接、课程编号（如 ZJU1-1460402161）或数字课程 ID。');
  const value = input.replaceAll('\\&', '&').trim();
  if (/^\d+$/.test(value)) {
    return { url: `https://${HOST}/course/detail.htm?cid=${value}`, slug: null, termId: null };
  }
  if (/^[a-z\d_]+-\d+$/i.test(value)) {
    return { url: `https://${HOST}/course/${value}`, slug: value, termId: null };
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('课程参数不是有效的中国大学 MOOC 链接或编号。'); }
  if (url.protocol !== 'https:' || url.hostname !== HOST) {
    throw new Error('只接受 https://www.icourse163.org 的课程链接。');
  }
  const match = url.pathname.match(/^\/(?:course|learn)\/([a-z\d_]+-\d+)\/?$/i);
  if (!match) throw new Error('链接应指向 /course/学校-编号 或 /learn/学校-编号。');
  return { url: `https://${HOST}/course/${match[1]}${url.search}`, slug: match[1], termId: url.searchParams.get('tid') };
}

export function normalizeCourse(raw, details = {}) {
  if (!raw || !Array.isArray(raw.chapters)) throw new Error('平台没有返回课程章节；请确认已经参加该期课程。');
  const slug = details.slug || `${details.schoolShortName || 'course'}-${details.courseId || raw.courseId || 'unknown'}`;
  const termId = String(details.termId || raw.id || raw.termId || '');
  const units = [];
  for (const [chapterIndex, chapter] of raw.chapters.entries()) {
    const lessons = chapter.lessons || [];
    for (const [lessonIndex, lesson] of lessons.entries()) {
      for (const [unitIndex, unit] of (lesson.units || []).entries()) {
        const type = unitType(unit);
        if (!type) continue;
        const id = String(unit.id || '');
        if (!/^\d+$/.test(id)) continue;
        units.push({
          id,
          contentId: String(unit.contentId || unit.contentid || ''),
          contentType: Number(unit.contentType),
          type,
          name: String(unit.name || `资源 ${id}`),
          chapter: String(chapter.name || `第 ${chapterIndex + 1} 章`),
          lesson: String(lesson.name || `第 ${lessonIndex + 1} 节`),
          chapterIndex,
          lessonIndex,
          unitIndex,
          lessonId: String(lesson.id || ''),
          contentUrl: typeof unit.contentUrl === 'string' ? unit.contentUrl : '',
          url: unitUrl(slug, termId, lesson.id, id, unit.contentId || unit.contentid)
        });
      }
    }
    const chapterQuizzes = chapter.quizs || chapter.quiz || chapter.tests || [];
    for (const quiz of Array.isArray(chapterQuizzes) ? chapterQuizzes : []) {
      const candidates = Array.isArray(quiz.units) && quiz.units.length ? quiz.units : [quiz];
      for (const candidate of candidates) {
        const id = String(candidate.id || quiz.id || '');
        if (!/^\d+$/.test(id)) continue;
        const quizId = String(quiz.id || id);
        units.push({
          id, contentId: String(candidate.contentId || ''), contentType: 5, type: 'quiz',
          name: String(candidate.name || quiz.name || `章节测验 ${id}`),
          chapter: String(chapter.name || `第 ${chapterIndex + 1} 章`), lesson: '章节测验',
          chapterIndex, lessonIndex: lessons.length, unitIndex: units.length, lessonId: '', contentUrl: '',
          url: `https://${HOST}/learn/${encodeURIComponent(slug)}?tid=${encodeURIComponent(termId)}#/learn/quiz?id=${encodeURIComponent(quizId)}`
        });
      }
    }
  }
  const seen = new Set();
  return {
    slug, termId, title: String(details.title || raw.courseName || raw.name || slug),
    units: units.filter((unit) => {
      if (seen.has(unit.id)) return false;
      seen.add(unit.id);
      return true;
    })
  };
}

export function unitType(unit) {
  const value = Number(unit.contentType);
  if (value === 1) return 'video';
  if (value === 3 || value === 4) return 'document';
  if (value === 5) return 'quiz';
  return null;
}

export function unitUrl(slug, termId, lessonId, unitId, contentId) {
  const query = new URLSearchParams({ type: 'detail', id: String(lessonId || 0), cid: String(unitId) });
  if (contentId) query.set('contentid', String(contentId));
  return `https://${HOST}/learn/${encodeURIComponent(slug)}?tid=${encodeURIComponent(termId)}#/learn/content?${query}`;
}

export function selectUnits(course, selector) {
  if (!selector) return course.units;
  const needle = String(selector).toLocaleLowerCase();
  const matches = course.units.filter((unit) =>
    unit.id === needle || unit.contentId === needle || unit.name.toLocaleLowerCase().includes(needle)
  );
  if (!matches.length) throw new Error(`课程中没有找到课时或资源：${selector}`);
  return matches;
}

export function safeName(value) {
  return String(value).normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'course';
}
