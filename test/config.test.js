import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configPath, readConfig, updateConfig } from '../src/config.js';
import { main } from '../src/cli.js';

test('本地配置保存在用户状态目录，支持更新播放器与清除账号', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-config-test-'));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    await updateConfig({ player: '/opt/player', username: 'example', password: 'secret with spaces ' });
    assert.deepEqual(await readConfig(), {
      player: '/opt/player', username: 'example', password: 'secret with spaces '
    });
    assert.equal((await stat(configPath())).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(configPath()))).mode & 0o777, 0o700);
    await updateConfig({ username: null, password: null });
    assert.deepEqual(await readConfig(), { player: '/opt/player' });
    assert.doesNotMatch(await readFile(configPath(), 'utf8'), /secret/);
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('可用单条命令保存默认播放器，无需登录或交互终端', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-player-setting-'));
  const previous = process.env.XDG_STATE_HOME;
  const log = console.log;
  process.env.XDG_STATE_HOME = root;
  console.log = () => {};
  try {
    await main(['config', '--player', '/opt/PotPlayer.exe']);
    assert.equal((await readConfig()).player, '/opt/PotPlayer.exe');
  } finally {
    console.log = log;
    if (previous === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('损坏的本地配置不会在错误消息中泄露密码', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mooc-config-invalid-'));
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    await updateConfig({ player: 'mpv' });
    await writeFile(configPath(), '{"password":"sensitive-example",', { mode: 0o600 });
    await assert.rejects(readConfig(), (error) =>
      /不是有效的 JSON/.test(error.message) && !error.message.includes('sensitive-example'));
    await updateConfig({ player: 'mpv' });
    assert.deepEqual(await readConfig(), { player: 'mpv' });
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});
