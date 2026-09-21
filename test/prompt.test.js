import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { askSecret } from '../src/prompt.js';

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
