import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { askSecret, chooseMany, parseNumberSelection } from '../src/prompt.js';

test('多选编号支持单项、范围、去重和全选', () => {
  assert.deepEqual(parseNumberSelection('1, 3-5, 3', 6), [0, 2, 3, 4]);
  assert.deepEqual(parseNumberSelection('all', 3), [0, 1, 2]);
  assert.throws(() => parseNumberSelection('2-7', 6), /超出/);
  assert.throws(() => parseNumberSelection('', 6), /至少选择/);
});

test('交互多选用空格勾选并按原目录顺序返回', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  output.isTTY = true;
  input.setRawMode = (value) => { input.isRaw = value; };
  const answer = chooseMany([
    { label: '第一节', value: 'lesson-1' },
    { label: '第二节', value: 'lesson-2' },
    { label: '第三节', value: 'lesson-3' }
  ], '选择教学小节', { input, output });
  input.emit('keypress', ' ', { name: 'space' });
  input.emit('keypress', '', { name: 'down' });
  input.emit('keypress', '', { name: 'down' });
  input.emit('keypress', ' ', { name: 'space' });
  input.emit('keypress', '\r', { name: 'return' });
  assert.deepEqual(await answer, ['lesson-1', 'lesson-3']);
  assert.equal(input.isRaw, false);
});

test('密码输入不回显并恢复终端模式', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let displayed = '';
  output.on('data', (chunk) => { displayed += chunk.toString(); });
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  const answer = askSecret('密码', { input, output });
  for (const character of 'example-secret') input.emit('keypress', character, { name: character });
  input.emit('keypress', '\r', { name: 'return' });
  assert.equal(await answer, 'example-secret');
  assert.equal(input.isRaw, false);
  assert.doesNotMatch(displayed, /example-secret/);
});
