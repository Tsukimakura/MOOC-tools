# mooc-notes-cli

将中国大学 MOOC 中自己有权访问的课程，整理成可搜索的图文学习纪要。工具按视频时间线合并字幕、画面变化截图和驻点小测，也采集可见的课后或章节 Quiz 与可下载课件。输出为一个 `notes.md`、一个 `quizzes.md` 和本地附件目录。

> 当前版本为 `0.3.1`。课程页面和接口会变化；首次使用请先用一个教学小节验证输出。工具不会自动开始或提交测验。视频截图按间隔采样，两个采样点之间的短暂变化可能遗漏。

## 环境与安装

- Node.js 20 或更新版本
- Chrome 或 Chromium 浏览器：首次登录、旧会话迁移、视频画面与网页课件采集时使用
- 建议安装 `ffmpeg`：视频流截图的首选方式；未安装时仍会尝试网页播放器
- 已参加的中国大学 MOOC 课程

```bash
npm ci
npm link
mooc-notes --help
```

`puppeteer-core` 不会自动安装浏览器。若 Chrome 不在常见安装位置，设置 `MOOC_NOTES_BROWSER` 为浏览器可执行文件路径，或每次使用 `--browser PATH`。

## 快速开始

```bash
# 首次打开独立浏览器窗口，自己完成登录；会话保存在本机用户目录
mooc-notes login

# 打开交互式菜单：选操作、从账号课程列表中选课，或手动输入课程代码
mooc-notes

# 只列出当前账号中的课程与期次
mooc-notes courses

# 查看课程目录；优先使用完整链接或 ZJU1-1460402161 形式的课程编号
mooc-notes list 'https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496'

# 在终端中选择教学小节，汇总该节视频、课件和 Quiz
mooc-notes export 'ZJU1-1460402161' --output ./downloads/my-course

# 直接指定教学小节，采集该小节的全部资源
mooc-notes export 'ZJU1-1460402161' --lesson 1278585469 --output ./downloads/my-course

# 仅采集一个指定资源，例如一段视频
mooc-notes export 'ZJU1-1460402161' --unit '1320673525' --output ./downloads/my-course

# 明确需要整门课程时才批量采集
mooc-notes export 'ZJU1-1460402161' --all --output ./downloads/my-course

# 单独整理驻点小测和课后 Quiz；优先读取时间锚点，必要时播放视频
mooc-notes quizzes 'ZJU1-1460402161' --unit 1320673525 --output ./downloads/my-course
```

登录后，`courses`、`list`、`video-url`、`play` 直接请求课程接口，不会启动浏览器。课程目录含时间锚点的视频小测和课后 Quiz 也优先直接读取题目、答案和配图；接口缺项时才启动浏览器。`export` 采集视频画面与网页课件时仍会启动浏览器。以前版本的浏览器会话会在首次运行时自动迁移一次；之后这些 API 操作只读取本地会话文件。如果会话失效，重新运行 `mooc-notes login`。

`list`、`export`、`quizzes`、`video-url` 和 `play` 都可省略课程参数，在终端中从账号课程列表选择，也可手动输入课程代码或链接。菜单用 ↑/↓ 滚动选择，直接输入关键词筛选，Enter 确认，Esc 清除筛选或退出；PageUp/PageDown 快速翻动。`export` 和 `quizzes` 的交互菜单按教学小节选择，该节内的视频、课件与 Quiz 一起处理；`--lesson` 可在脚本中指定小节，`--unit` 只选单项资源，`--all` 才批量处理整门课程。

## 在自己的播放器中观看

```bash
# 先用 courses、list 查找课程，再根据课时 ID 取得视频链接
mooc-notes video-url 'ZJU1-1460402161' --unit 1320673525

# 在交互式终端中省略课程和课时，通过菜单选择
mooc-notes video-url

# 直接用 mpv 播放；也可将路径换成 VLC、PotPlayer 等播放器程序
mooc-notes play 'ZJU1-1460402161' --unit 1320673525 --player mpv

# 经常使用同一播放器时，设置环境变量后直接运行
MOOC_NOTES_PLAYER=mpv mooc-notes play 'ZJU1-1460402161' --unit 1320673525
```

`video-url` 仅将 URL 写到标准输出，方便复制或在脚本中传递。`play` 将 URL 作为一个参数交给指定播放器，不经过 shell。播放器需支持平台提供的 HLS 或 MP4 链接；URL 含有会过期的授权参数，失效后重新运行命令即可。`--player` 接受可执行文件路径或系统可找到的命令，亦兼容 `VIDEO_OPENER` 环境变量。菜单的交互方式参考 [PTA-tools](https://github.com/Tsukimakura/PTA-tools)；播放流程参考 [ZJU-live-better 的 getVideoURL.js](https://github.com/5dbwat4/ZJU-live-better/blob/main/classroom.zju/getVideoURL.js)，本项目访问的仍是中国大学 MOOC 课程。

`export` 默认以 2 秒间隔从课程提供的视频流取帧，检测画面变化后等待连续稳定的采样点，再保存截图；需要 `ffmpeg`。当视频流不可用或未安装 `ffmpeg` 时，工具尝试网页播放器。视频流需要读取整节视频，跨境网络较慢时会显示处理进度。`quizzes` 优先直接读取课程公布的驻点时间、题目和答案，并核对驻点数量；缺少题目时才播放视频。课程没有提供答案时会在文档中明确提示。发现视频中有驻点小测却未被采集时，使用 `--scan-mode realtime --force` 实际播放该课时。实时模式将播放器静音并以 2 倍速播放；遇到需要学员操作的小测会保存当前可见题目并停止该视频的后续扫描。可用 `--interval 1` 提高截图密度，`--threshold 0.5` 增加小幅画面变化的截图，`--max-frames` 调整每个视频的截图上限。

重复执行会跳过 `manifest.json` 中已完成的资源；没有截图的视频会继续重试。`--force` 重新采集，并保留先前成功取得的字幕、截图和题目。建议先运行 `list` 找到资源 ID，再用 `--unit` 试导出。无图形界面的服务器可在已经登录后使用 `--headless` 运行网页采集；首次登录仍需可见浏览器。

## 输出示例

```text
downloads/my-course/
├── notes.md          # 全课学习纪要，字幕、截图、题目按时间排列
├── quizzes.md        # 按章节、课时汇总的题目索引
├── manifest.json     # 断点续跑记录，不包含账号密码或 Cookie
└── assets/
    └── 1320673525/
        ├── frame-a1b2c3d4-0001.png
        ├── question-001.jpg
        └── courseware.pdf
```

每个章节标题都有原课时链接。未提供字幕、课件下载或播放器截图失败时，文档中会写明缺失项。对于课件，工具只尝试下载当前课程提供的 PDF 地址；无法下载时尝试保存页面可见的课件截图或文字。图文与测验只保存在本地，项目仓库不包含课程内容。

## 已知限制

- 登录后才可读取参与课程的目录。仅输入课程编号或纯数字 ID 时，工具从当前账号的课程列表解析期次；若课程不在列表中，请使用含 `tid` 的完整链接。
- 账号课程菜单使用个人空间提供的课程列表；若接口因网络故障不可用，交互菜单仍允许手动输入课程代码或链接。
- 字幕依赖平台提供的字幕轨或字幕文件；不做语音识别。
- 画面变化检测基于视频截图采样，无法保证捕获小于采样间隔的变化。视频流或播放器不可访问、视频黑屏或加密渲染时，会继续导出字幕、小测等内容并标记该视频待重试。
- 测验会读取平台已向当前登录会话提供的题干、选项、配图、答案和解析。某些驻点题只有“继续播放”占位文字，没有实际答案；工具会标记缺失。课后 Quiz 优先读取课程接口中的题目与答案；接口未提供时回退页面，且不会自动点击“开始答题”或提交答案。
- 有时间锚点的驻点小测可直接读取。缺少时间锚点时，`quizzes` 或 `--scan-mode realtime` 会实际播放；若小测阻塞播放，后续小测可能仍需手动操作后再运行。
- 不保证平台改版后选择器和课程目录接口继续可用。建议提交脱敏后的问题报告及课程 URL，帮助适配不同课程。

## 隐私与使用范围

浏览器会话默认保存在用户目录 `~/.local/state/mooc-notes-cli/browser`，API 使用的 Cookie 副本保存在同一状态目录下的 `session-*.json`，权限为仅当前用户可读写（遵循 `XDG_STATE_HOME`）。`--profile` 会使用对应的独立 API 会话。它们都包含登录状态，不要将这些文件、Cookie、HAR 或 `downloads/` 提交到 GitHub。工具不接收账号密码、不向第三方服务上传数据、不自动答题，也不处理视频 DRM。

如果要帮助适配尚需网页加载的课后 Quiz，可提供**已完成的 Quiz 结果页**中相关 XHR/DWR 请求的脱敏记录。请先删除 Cookie、CSRF、用户编号、签名、授权视频链接和个人信息；保留请求路径、参数名与匿名化后的响应字段结构即可。无需开启或提交一次新的测验。

请只整理自己有权访问、可供个人学习的课程内容，并遵守课程方的使用规则。平台的[教师帮助](https://help.icourse163.org/help-doc/oc-manual4.html)说明视频可含驻点测验与字幕；[官方接口文档](https://docs.icourse163.org/api-doc/get-info.html)说明文档能否下载由课程方设置。

## 开发

```bash
npm ci
npm run check
npm test
```

项目使用原生 ES 模块和 Node 内置测试器。课程目录、采集、字幕、题目、文档生成分模块维护。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

许可证：[MIT](LICENSE)。
