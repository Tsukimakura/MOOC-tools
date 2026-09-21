import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';

function truncateLabel(value, columns) {
  const text = value.replace(/\s+/g, ' ');
  let result = '';
  let width = 0;
  for (const character of text) {
    const size = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff00-\uffe6]/u.test(character) ? 2 : 1;
    if (width + size > columns - 1) return `${result}…`;
    result += character;
    width += size;
  }
  return result;
}

function chooseWithArrows(choices, title, { manualLabel, input, output }) {
  const entries = manualLabel ? [...choices, { label: manualLabel, value: null }] : choices;
  let query = '';
  let selected = 0;
  const previousRawMode = input.isRaw;
  const filtered = () => entries.filter((entry) => entry.value === null || entry.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const render = () => {
    const visible = filtered();
    const rows = Math.max(5, Math.min(18, (output.rows || 24) - 7));
    const start = Math.max(0, Math.min(selected - Math.floor(rows / 2), visible.length - rows));
    const width = Math.max(30, (output.columns || 80) - 5);
    output.write('\x1b[2J\x1b[H');
    output.write(`${title}\n\n`);
    output.write('↑/↓ 选择 · Enter 确认 · 直接输入筛选 · Esc 清除/退出\n');
    output.write(`筛选：${query || '全部'}\n\n`);
    if (!visible.length) output.write('没有匹配项。\n');
    for (const [offset, entry] of visible.slice(start, start + rows).entries()) {
      const index = start + offset;
      const label = truncateLabel(entry.label, width);
      output.write(index === selected ? `\x1b[7m› ${label}\x1b[0m\n` : `  ${label}\n`);
    }
    output.write(`\n${visible.length ? `${selected + 1}/${visible.length}` : '0/0'} · PageUp/PageDown 快速滚动\n`);
  };
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?1049h\x1b[?25l');
  render();
  return new Promise((resolve, reject) => {
    const finish = (value, error) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write('\x1b[?25h\x1b[?1049l');
      if (error) reject(error);
      else resolve(value);
    };
    const onKey = (character, key = {}) => {
      const visible = filtered();
      if (key.ctrl && key.name === 'c') return finish(null, new Error('已取消操作。'));
      if (key.name === 'escape') {
        if (query) { query = ''; selected = 0; render(); return; }
        return finish(null, new Error('已取消操作。'));
      }
      if (key.name === 'up' || key.name === 'down') {
        selected = Math.max(0, Math.min(visible.length - 1, selected + (key.name === 'up' ? -1 : 1)));
      } else if (key.name === 'pageup' || key.name === 'pagedown') {
        selected = Math.max(0, Math.min(visible.length - 1, selected + (key.name === 'pageup' ? -10 : 10)));
      } else if (key.name === 'home') selected = 0;
      else if (key.name === 'end') selected = Math.max(0, visible.length - 1);
      else if (key.name === 'return' || key.name === 'enter') {
        if (visible.length) return finish(visible[selected].value);
      } else if (key.name === 'backspace') {
        query = query.slice(0, -1);
        selected = 0;
      } else if (character && !key.ctrl && !key.meta && character.length === 1 && character >= ' ') {
        if (character !== '/' || query) query += character;
        selected = 0;
      }
      render();
    };
    input.on('keypress', onKey);
  });
}

function chooseManyWithArrows(choices, title, { input, output }) {
  let query = '';
  let cursor = 0;
  const selected = new Set();
  const previousRawMode = input.isRaw;
  const filtered = () => choices.map((entry, index) => ({ entry, index })).filter(({ entry }) =>
    entry.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const render = () => {
    const visible = filtered();
    const rows = Math.max(5, Math.min(18, (output.rows || 24) - 8));
    const start = Math.max(0, Math.min(cursor - Math.floor(rows / 2), visible.length - rows));
    const width = Math.max(30, (output.columns || 80) - 9);
    output.write('\x1b[2J\x1b[H');
    output.write(`${title}\n\n`);
    output.write('↑/↓ 移动 · Space 选择/取消 · Enter 确认 · Ctrl+A 全选当前结果\n');
    output.write(`直接输入筛选 · Esc 清除/退出 · 筛选：${query || '全部'}\n\n`);
    if (!visible.length) output.write('没有匹配项。\n');
    for (const [offset, item] of visible.slice(start, start + rows).entries()) {
      const position = start + offset;
      const checked = selected.has(item.index) ? '[×]' : '[ ]';
      const label = `${checked} ${truncateLabel(item.entry.label, width)}`;
      output.write(position === cursor ? `\x1b[7m› ${label}\x1b[0m\n` : `  ${label}\n`);
    }
    output.write(`\n已选 ${selected.size} 项 · ${visible.length ? `${cursor + 1}/${visible.length}` : '0/0'}\n`);
  };
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?1049h\x1b[?25l');
  render();
  return new Promise((resolve, reject) => {
    const finish = (value, error) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write('\x1b[?25h\x1b[?1049l');
      if (error) reject(error);
      else resolve(value);
    };
    const onKey = (character, key = {}) => {
      const visible = filtered();
      if (key.ctrl && key.name === 'c') return finish(null, new Error('已取消操作。'));
      if (key.ctrl && key.name === 'a') {
        const allSelected = visible.length && visible.every(({ index }) => selected.has(index));
        for (const { index } of visible) allSelected ? selected.delete(index) : selected.add(index);
      } else if (key.name === 'escape') {
        if (query) { query = ''; cursor = 0; render(); return; }
        return finish(null, new Error('已取消操作。'));
      } else if (key.name === 'up' || key.name === 'down') {
        cursor = Math.max(0, Math.min(visible.length - 1, cursor + (key.name === 'up' ? -1 : 1)));
      } else if (key.name === 'pageup' || key.name === 'pagedown') {
        cursor = Math.max(0, Math.min(visible.length - 1, cursor + (key.name === 'pageup' ? -10 : 10)));
      } else if (key.name === 'home') cursor = 0;
      else if (key.name === 'end') cursor = Math.max(0, visible.length - 1);
      else if (key.name === 'space') {
        if (visible[cursor]) {
          const index = visible[cursor].index;
          selected.has(index) ? selected.delete(index) : selected.add(index);
        }
      } else if (key.name === 'return' || key.name === 'enter') {
        if (selected.size) return finish(choices.filter((_, index) => selected.has(index)).map(({ value }) => value));
        output.write('\x07');
      } else if (key.name === 'backspace') {
        query = query.slice(0, -1);
        cursor = 0;
      } else if (character && !key.ctrl && !key.meta && character.length === 1 && character > ' ') {
        query += character;
        cursor = 0;
      }
      render();
    };
    input.on('keypress', onKey);
  });
}

export function parseNumberSelection(value, maximum) {
  const answer = String(value).trim().toLocaleLowerCase();
  if (answer === 'all' || answer === 'a') return Array.from({ length: maximum }, (_, index) => index);
  const selected = new Set();
  for (const part of answer.split(',').map((item) => item.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('请输入编号、范围（如 2-5）或 all。');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > maximum) throw new Error('选择编号超出当前列表范围。');
    for (let index = start; index <= end; index++) selected.add(index - 1);
  }
  if (!selected.size) throw new Error('请至少选择一项。');
  return [...selected].sort((a, b) => a - b);
}

export async function choose(choices, title, { manualLabel, input = process.stdin, output = process.stderr } = {}) {
  if (!choices.length && !manualLabel) throw new Error('没有可选项目。');
  if (input.isTTY && output.isTTY && typeof input.setRawMode === 'function') {
    return chooseWithArrows(choices, title, { manualLabel, input, output });
  }
  const prompt = createInterface({ input, output });
  let filtered = choices;
  let page = 0;
  const pageSize = 15;
  try {
    while (true) {
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      page = Math.min(page, pages - 1);
      output.write(`\n${title}（第 ${page + 1}/${pages} 页）\n`);
      for (const [offset, choice] of filtered.slice(page * pageSize, (page + 1) * pageSize).entries()) {
        output.write(`  ${page * pageSize + offset + 1}. ${choice.label}\n`);
      }
      if (manualLabel) output.write(`  0. ${manualLabel}\n`);
      output.write('输入编号；n/p 翻页，/关键词 搜索，c 清除筛选，q 退出。\n');
      let answer;
      try { answer = (await prompt.question('> ')).trim(); }
      catch { throw new Error('已取消操作。'); }
      if (answer.toLowerCase() === 'q') throw new Error('已取消操作。');
      if (answer === '0' && manualLabel) return null;
      if (answer.toLowerCase() === 'n') { page = Math.min(page + 1, pages - 1); continue; }
      if (answer.toLowerCase() === 'p') { page = Math.max(page - 1, 0); continue; }
      if (answer.toLowerCase() === 'c') { filtered = choices; page = 0; continue; }
      if (answer.startsWith('/')) {
        const query = answer.slice(1).trim().toLocaleLowerCase();
        filtered = choices.filter((choice) => choice.label.toLocaleLowerCase().includes(query));
        page = 0;
        if (!filtered.length) output.write('没有匹配项；输入 c 恢复完整列表。\n');
        continue;
      }
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= filtered.length) return filtered[index - 1].value;
      output.write('请输入显示的编号，或使用提示中的操作。\n');
    }
  } finally { prompt.close(); }
}

export async function chooseMany(choices, title, { input = process.stdin, output = process.stderr } = {}) {
  if (!choices.length) throw new Error('没有可选项目。');
  if (input.isTTY && output.isTTY && typeof input.setRawMode === 'function') {
    return chooseManyWithArrows(choices, title, { input, output });
  }
  const prompt = createInterface({ input, output });
  let filtered = choices;
  try {
    while (true) {
      output.write(`\n${title}\n`);
      for (const [index, choice] of filtered.entries()) output.write(`  ${index + 1}. ${choice.label}\n`);
      output.write('输入多个编号或范围（如 1,3-5）；all 全选，/关键词 筛选，c 清除，q 退出。\n');
      let answer;
      try { answer = (await prompt.question('> ')).trim(); }
      catch { throw new Error('已取消操作。'); }
      if (answer.toLocaleLowerCase() === 'q') throw new Error('已取消操作。');
      if (answer.toLocaleLowerCase() === 'c') { filtered = choices; continue; }
      if (answer.startsWith('/')) {
        const query = answer.slice(1).trim().toLocaleLowerCase();
        filtered = choices.filter((choice) => choice.label.toLocaleLowerCase().includes(query));
        if (!filtered.length) output.write('没有匹配项；输入 c 恢复完整列表。\n');
        continue;
      }
      try { return parseNumberSelection(answer, filtered.length).map((index) => filtered[index].value); }
      catch (error) { output.write(`${error.message}\n`); }
    }
  } finally { prompt.close(); }
}

export async function askText(message, { input = process.stdin, output = process.stderr } = {}) {
  const prompt = createInterface({ input, output });
  try {
    while (true) {
      let value;
      try { value = (await prompt.question(`${message}：`)).trim(); }
      catch { throw new Error('已取消操作。'); }
      if (value) return value;
      output.write('请输入内容。\n');
    }
  } finally { prompt.close(); }
}

export async function askSecret(message, { input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') throw new Error('密码输入需要交互终端。');
  const previousRawMode = input.isRaw;
  let value = '';
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`${message}（输入不回显）：`);
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onKey = (character, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('已取消操作。'));
      if (key.name === 'return' || key.name === 'enter') {
        if (value) return finish();
        output.write('密码不能为空，请继续输入：');
      } else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (character && !key.ctrl && !key.meta && character >= ' ') value += character;
    };
    input.on('keypress', onKey);
  });
}
