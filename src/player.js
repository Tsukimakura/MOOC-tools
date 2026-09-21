import { createHash } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { sessionPath } from './api.js';
import { downloadSubtitleTracks, subtitleUrlsFromDwr } from './resources.js';
import { normalizeVideoUrl } from './stream.js';
import { formatSrt } from './subtitles.js';

const execFile = promisify(execFileCallback);

function playerName(executable) {
  return executable.split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/, '');
}

export function playerArguments(executable, url, subtitleFile, subtitleArg) {
  if (!subtitleFile) return [url];
  if (subtitleArg) {
    if (!subtitleArg.includes('{file}')) throw new Error('--subtitle-arg 必须包含 {file} 占位符。');
    return [subtitleArg.replaceAll('{file}', subtitleFile), url];
  }
  const name = playerName(executable);
  if (name === 'mpv' || name === 'vlc' || name === 'cvlc') return [`--sub-file=${subtitleFile}`, url];
  // PotPlayer's bundled CmdLine64.txt documents: PotPlayerMini64.exe "file" [options].
  if (['potplayermini64', 'potplayermini', 'potplayer'].includes(name)) return [url, `/sub=${subtitleFile}`];
  throw new Error('此播放器的字幕参数未知；请改用 mpv/VLC/PotPlayer，或用 --subtitle-arg 指定含 {file} 的参数模板。');
}

async function playerSubtitlePath(executable, subtitleFile) {
  if (!subtitleFile || process.platform !== 'linux' || !/\.exe$/i.test(executable)) return subtitleFile;
  try {
    const { stdout } = await execFile('wslpath', ['-w', subtitleFile]);
    return stdout.trim();
  } catch {
    throw new Error('Windows 播放器需要 wslpath 转换字幕路径；请安装 WSL 工具或使用 Linux 播放器。');
  }
}

export function subtitleDirectory(profile, course, unit) {
  const session = sessionPath(profile);
  const key = createHash('sha256').update(`${course.slug}:${course.termId}:${unit.id}`).digest('hex').slice(0, 20);
  return path.join(path.dirname(session), 'subtitles', path.basename(session, '.json'), key);
}

export async function preparePlayerSubtitle(api, unit, stream, directory) {
  let dwr = '';
  try { dwr = await api.lessonUnitDwr(unit); } catch { /* Stream captions may still be available. */ }
  const urls = [...subtitleUrlsFromDwr(dwr), ...(stream.captions || [])];
  const [cues] = await downloadSubtitleTracks(api, urls, 1);
  if (!cues) return null;
  const content = formatSrt(cues);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 20);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `subtitle-${hash}.srt`);
  try { await writeFile(file, content, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await chmod(file, 0o600);
  return file;
}

export async function openInPlayer(executable, url, subtitleFile = null, subtitleArg) {
  if (!executable?.trim()) throw new Error('请用 --player PATH 或 MOOC_NOTES_PLAYER 指定播放器。');
  if (!normalizeVideoUrl(url)) throw new Error('视频链接无效，无法交给播放器。');
  const subtitlePath = await playerSubtitlePath(executable, subtitleFile);
  const args = playerArguments(executable, url, subtitlePath, subtitleArg);
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (error) => reject(new Error(`无法启动播放器 ${executable}：${error.message}`)));
  });
  child.unref();
}
