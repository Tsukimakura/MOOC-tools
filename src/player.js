import { spawn } from 'node:child_process';
import { normalizeVideoUrl } from './stream.js';

export async function openInPlayer(executable, url) {
  if (!executable?.trim()) throw new Error('请用 --player PATH 或 MOOC_NOTES_PLAYER 指定播放器。');
  if (!normalizeVideoUrl(url)) throw new Error('视频链接无效，无法交给播放器。');
  const child = spawn(executable, [url], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (error) => reject(new Error(`无法启动播放器 ${executable}：${error.message}`)));
  });
  child.unref();
}
