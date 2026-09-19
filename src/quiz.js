function plain(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}

function imageUrls(html) {
  if (typeof html !== 'string') return [];
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)]
    .map((match) => match[2].replaceAll('&amp;', '&'));
}

// DWR responses are JavaScript assignments. Read only literal values and object links;
// never execute code returned by the learning platform.
export function questionsFromDwr(source) {
  const variables = new Map();
  for (const match of String(source).matchAll(/\bvar\s+s(\d+)\s*=\s*(\[\]|\{\})\s*;/g)) {
    variables.set(match[1], match[2] === '[]' ? [] : Object.create(null));
  }
  const assignment = /\bs(\d+)(?:\.([A-Za-z_$][\w$]*)|\[(\d+)\])\s*=\s*("(?:\\.|[^"\\])*"|s\d+|null|true|false|-?\d+(?:\.\d+)?)\s*;/g;
  for (const match of String(source).matchAll(assignment)) {
    const target = variables.get(match[1]);
    const key = match[2] ?? match[3];
    if (!target || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const raw = match[4];
    let value;
    if (/^s\d+$/.test(raw)) value = variables.get(raw.slice(1));
    else if (raw.startsWith('"')) {
      try { value = JSON.parse(raw.replaceAll("\\'", "'")); } catch { continue; }
    } else if (raw === 'null') value = null;
    else if (raw === 'true' || raw === 'false') value = raw === 'true';
    else value = Number(raw);
    target[key] = value;
  }
  return questionsFromData([...variables.values()]);
}

export function dedupeQuestions(questions) {
  const seen = new Set();
  return questions.filter((question) => {
    const title = plain(question.title);
    if (!title || title.length < 3) return false;
    const key = `${title}|${(question.options || []).map(plain).join('|')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Network payloads can expose question text and options before the UI lays them out.
// Answer fields are intentionally ignored: only answers actually shown on screen are exported.
export function questionsFromData(data, time = null) {
  const found = [];
  const visited = new Set();
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12 || visited.has(node)) return;
    visited.add(node);
    const options = node.optionDtos || node.options || node.choices || node.optionList;
    const title = node.plainTextTitle || node.questionTitle || node.title || node.stem;
    if (title && (Array.isArray(options) || node.optionNumber != null || node.testId != null)) {
      const rawOptions = Array.isArray(options) ? options : [];
      const question = {
        id: String(node.id ?? ''),
        title: plain(title),
        options: rawOptions.map((option) => plain(typeof option === 'string' ? option : option.content || option.text || option.title)).filter(Boolean),
        images: [...new Set([...(imageUrls(node.title)), ...rawOptions.flatMap((option) => imageUrls(typeof option === 'string' ? option : option.content || option.text || option.title))])],
        answer: '', explanation: '',
        time: Number.isFinite(time) ? time : normalizeTime(node)
      };
      if (question.title) found.push(question);
    }
    if (Array.isArray(node)) node.forEach((item) => walk(item, depth + 1));
    else for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(data, 0);
  return dedupeQuestions(found);
}

function normalizeTime(node) {
  for (const key of ['videoTime', 'pauseTime', 'questionTime', 'showTime', 'position']) {
    if (node[key] === null || node[key] === undefined || node[key] === '') continue;
    const value = Number(node[key]);
    if (Number.isFinite(value) && value >= 0) return value > 24 * 3600 ? value / 1000 : value;
  }
  return null;
}

export async function questionsFromPage(page, time = null) {
  const results = [];
  for (const frame of page.frames()) {
    try {
      const questions = await frame.evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };
        const text = (element) => element?.innerText?.replace(/\s+/g, ' ').trim() || '';
        const selectors = '.u-questionItem, .m-choiceQuestion, .m-subjectiveQuestion, .m-fillblankQuestion, .j-questionItem, .m-videoQuestion, .m-videoQuiz, .m-videoTest, [data-question-id]';
        let nodes = [...document.querySelectorAll(selectors)].filter(visible);
        if (!nodes.length) nodes = [...document.querySelectorAll('.j-list > * > *')].filter(visible);
        const roots = nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
        return roots.slice(0, 200).map((root) => {
          const optionNodes = [...root.querySelectorAll('.optionCnt, .choices > li, .options > li, .j-option, label')].filter(visible);
          const options = [...new Set(optionNodes.map(text).filter(Boolean))];
          const titleNode = root.querySelector('.questionTitle, .question-title, .j-title, .title, .stem, .f-richEditorText');
          let title = text(titleNode);
          if (!title) {
            title = text(root);
            for (const option of options) title = title.replace(option, '');
            title = title.trim();
          }
          const answerNode = [...root.querySelectorAll('.answer, .correctAnswer, .j-answer')].find(visible);
          const explanationNode = [...root.querySelectorAll('.analysis, .explanation, .j-analysis, .analysisInfo')].find(visible);
          return { title, options, images: [...root.querySelectorAll('img')].map((image) => image.getAttribute('src')).filter(Boolean), answer: text(answerNode), explanation: text(explanationNode) };
        });
      });
      results.push(...questions.map((question) => ({ ...question, time })));
    } catch { /* Detached or cross-origin frames are skipped. */ }
  }
  return dedupeQuestions(results);
}

export function mergeQuestions(...groups) {
  const map = new Map();
  for (const question of groups.flat()) {
    const key = plain(question.title);
    if (!key) continue;
    const previous = map.get(key);
    map.set(key, previous ? {
      ...previous,
      options: previous.options?.length ? previous.options : question.options,
      images: [...new Set([...(previous.images || []), ...(question.images || [])])],
      answer: previous.answer || question.answer || '',
      explanation: previous.explanation || question.explanation || '',
      time: previous.time ?? question.time ?? null
    } : question);
  }
  return [...map.values()];
}
