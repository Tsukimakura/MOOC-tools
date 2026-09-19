function plain(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
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
    if (title && Array.isArray(options)) {
      const question = {
        title: plain(title),
        options: options.map((option) => plain(typeof option === 'string' ? option : option.content || option.text || option.title)).filter(Boolean),
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
          return { title, options, answer: text(answerNode), explanation: text(explanationNode) };
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
      answer: previous.answer || question.answer || '',
      explanation: previous.explanation || question.explanation || '',
      time: previous.time ?? question.time ?? null
    } : question);
  }
  return [...map.values()];
}
