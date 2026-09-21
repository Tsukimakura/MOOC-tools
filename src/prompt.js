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
