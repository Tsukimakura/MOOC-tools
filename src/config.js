import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

export function configPath() {
  const stateRoot = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state');
  return path.join(stateRoot, 'mooc-notes-cli', 'config.json');
}

export async function readConfig() {
  const file = configPath();
  let content;
  try { content = await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`本地配置无法读取（${error.code || '未知错误'}）。`);
  }
  let data;
  try { data = JSON.parse(content); }
  catch { throw new Error('本地配置不是有效的 JSON；请检查本地配置文件。'); }
  if (data?.version !== 1 || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('本地配置格式无效；请重新运行 mooc-notes config。');
  }
  for (const key of ['player', 'username', 'password']) {
    if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error(`本地配置中的 ${key} 必须是文本。`);
  }
  if (((await stat(file)).mode & 0o777) !== 0o600) await chmod(file, 0o600);
  return Object.fromEntries(['player', 'username', 'password']
    .filter((key) => data[key]).map((key) => [key, data[key]]));
}

export async function updateConfig(changes) {
  let current;
  try { current = await readConfig(); }
  catch (error) {
    if (!/本地配置不是有效的 JSON|本地配置格式无效|本地配置中的/.test(error.message)) throw error;
    current = {};
  }
  for (const [key, value] of Object.entries(changes)) {
    if (!['player', 'username', 'password'].includes(key)) throw new Error(`不支持的配置项：${key}`);
    if (value === null) delete current[key];
    else if (typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value)) {
      current[key] = key === 'password' ? value : value.trim();
    }
    else throw new Error(`${key} 需要非空文本。`);
  }
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, ...current }, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return current;
}
