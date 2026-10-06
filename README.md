# mooc-notes-cli

将自己已参加的中国大学 MOOC 课程整理为可检索的 Markdown 学习纪要。工具按视频时间线同步字幕、稳定画面和驻点小测，也会整理课后 Quiz 与可下载课件。

## 功能

| 功能 | 说明 |
| --- | --- |
| 图文纪要 | 按章节和时间线合并字幕、截图、课件、驻点小测与课后 Quiz |
| 稳定截图 | 从授权视频流检测画面变化，等待动画趋于稳定后保存完整画面 |
| 小测索引 | 同步生成 `quizzes.md`，可按教学小节集中查看题目、答案和解析 |
| 课程视频 | 获取当前会话可播放的视频链接，可交给 PotPlayer、mpv、VLC 等播放器 |
| 多语言字幕 | 课程同时提供中英文字幕时，可切换中文、English 和双语字幕 |
| 断点续跑 | 保存采集清单，重复运行时跳过已完成资源并保留已有结果 |

工具会让你勾选一个或多个教学小节，避免误下载整门课程。只有明确传入 `--all` 才处理全部已发布资源。

## 环境要求

- [Node.js](https://nodejs.org/) 20 或更高版本
- `ffmpeg`：视频截图所需
- Chrome 或 Chromium：首次手动登录、验证和网页补采所需

`puppeteer-core` 不会自行下载浏览器。浏览器不在常见位置时，设置 `MOOC_NOTES_BROWSER`，或在命令中传入 `--browser PATH`。

## 安装

从源码安装：

```bash
git clone https://github.com/Tsukimakura/MOOC-tools.git
cd MOOC-tools
npm ci
npm link
mooc-notes --help
```

## 快速开始

```bash
# 可选：保存手机号或邮箱、密码、下载根目录以及默认播放器
mooc-notes config

# 优先复用会话或直接登录；需要验证时自动打开专用登录页
mooc-notes login

# 打开交互菜单，依次选择功能、课程和一个或多个教学小节
mooc-notes
```

交互菜单支持方向键和关键词筛选。选择教学小节时按 Space 勾选或取消、Enter 确认，按 Ctrl+A 可选择当前筛选结果。选课列表来自当前账号，也可手动输入课程代码或完整链接。

## 登录

| 命令 | 使用场景 |
| --- | --- |
| `mooc-notes login` | 复用已有会话；有本地手机号或邮箱密码时先尝试 HTTPS 直接登录 |
| `mooc-notes login --force` | 忽略已有会话，重新登录或切换账号 |
| `mooc-notes login --manual` | 直接打开专用登录页，使用爱课程、校园用户、二维码或第三方账号 |

直接登录按照登录页当前使用的协议，在本机完成密码加密、短时计算验证和 Cookie 同步。平台要求图片验证码、滑块、短信或账号保护验证时，工具会打开[中国大学 MOOC 登录页](https://www.icourse163.org/member/login.htm)，预填可用信息。检测到课程会话后会保存会话并自动关闭浏览器。

`mooc-notes config` 可设置或清除本地账号密码，也可设置默认下载根目录和播放器。密码输入不回显，但选择保存时会以明文写入仅当前用户可读的配置文件。若不希望保存密码，可设置环境变量：

```bash
export MOOC_NOTES_USERNAME='手机号或邮箱'
export MOOC_NOTES_PASSWORD='密码'
mooc-notes login
```

使用爱课程、校园账号、二维码或第三方账号时，运行 `mooc-notes login --manual` 并在浏览器中选择对应入口。该模式会清除工具浏览器资料中的旧认证 Cookie，但不会删除本地账号密码配置。

平台面向机构提供的[单点登录接口](https://docs.icourse163.org/api-doc/login-intergration.html)需要机构应用密钥，不能替代个人账号登录。登录页协议变化时，直接登录会回退到浏览器。

## 命令行

```text
mooc-notes
mooc-notes login [--force | --manual]
mooc-notes config [--player PATH | --output DIR]
mooc-notes [课程] [--mode notes|video] [--lesson ID ... | --unit ID | --all]
```

| 模式 | 用途 |
| --- | --- |
| `notes`（默认） | 导出字幕、稳定截图、课件和全部可获取小测 |
| `video` | 获取一个视频的授权链接，并可选择带字幕播放 |

课程参数支持以下格式：

- 课程代码：`ZJU1-1460402161`
- 纯数字课程 ID：`1460402161`
- 含期次的完整链接：`https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496`

课程代码或数字 ID 需要当前账号已参加课程，工具会从账号课程列表解析期次。完整链接中的 `tid` 会直接指定期次。这些示例是公开课程标识，不含账号信息。

### 导出图文纪要

```bash
# 导出单项资源
mooc-notes 'https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496' \
  --unit 1320673525

# 导出整个教学小节，包含其中视频驻点小测和课后 Quiz
mooc-notes 1460402161 --mode notes --lesson 1278585470

# 一次导出多个教学小节；也可直接在交互菜单中勾选
mooc-notes 1460402161 --mode notes \
  --lesson 1278585470 --lesson 1278585471

# 明确导出整门课程
mooc-notes ZJU1-1460402161 --mode notes --all
```

`--unit` 选单项资源，`--lesson` 选教学小节且可重复使用，`--all` 选整门课程。`--force` 会重新采集已有资源。

默认下载根目录可在交互设置中修改，也可直接设置：

```bash
# 后续课程保存到 /data/mooc/<英文课程名或课程代码>/
mooc-notes config --output /data/mooc

# 只临时覆盖一次，并把当前课程直接保存到指定目录
mooc-notes ZJU1-1460402161 --lesson 1278585470 --output /data/one-course

# 环境变量临时覆盖已保存的下载根目录
MOOC_NOTES_OUTPUT=/data/mooc mooc-notes ZJU1-1460402161 --lesson 1278585470
```

视频采样可用 `--interval SEC`、`--threshold NUMBER` 和 `--max-frames NUMBER` 调整。`--scan-mode realtime` 会在浏览器中实际播放，适合检查接口未提供的驻点小测。`--api-only` 会禁止网页补采。完整参数见 `mooc-notes --help`。

### 获取课程视频

```bash
# 交互选择播放器，也可当场设置或修改默认播放器
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525

# 直接使用 mpv 或 VLC
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525 --player mpv
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525 --player vlc

# WSL 调用 Windows PotPlayer，路径按实际安装位置修改
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525 \
  --player '/mnt/c/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe'
```

交互终端可选择仅输出链接、使用默认播放器、修改默认播放器，或临时使用其他播放器。非交互运行只输出链接，便于接入脚本。`MOOC_NOTES_PLAYER` 可临时覆盖本地默认播放器。

课程同时提供中英文字幕时，PotPlayer 会收到一个包含「中文 / English / 双语」选项的 SMI 文件；mpv 会加载三条字幕轨，可按 `j` 或 `J` 切换；VLC 和通过 `--subtitle-arg` 配置的其他播放器默认加载中文 SRT。只有一种字幕时仅生成对应轨道。本功能同步课程字幕，不进行语音识别或机器翻译。

## 输出

默认输出到 `downloads/<英文课程名或课程代码>/`。英文课程名会直接用于目录；课程名含中文时使用课程代码。目录名不包含自动生成的日期或中文。同名目录已经属于另一期课程时，工具会追加 `tid` 防止覆盖。

```text
downloads/<英文课程名或课程代码>/
├── README.md           # 已导出教学小节的入口索引
├── notes.md            # 当前课程所有已导出内容的合并纪要
├── quizzes.md          # 当前课程所有已获取小测的合并索引
├── manifest.json       # 断点续跑记录
├── lessons/
│   ├── 02-01[-<英文章节名>-<英文小节名>]/
│   │   ├── notes.md    # 只包含该教学小节
│   │   └── quizzes.md  # 只包含该教学小节的小测
│   └── ...
└── assets/
    └── <资源ID>/       # 视频截图、题目配图和课件
```

每次采集都会根据 `manifest.json` 重建课程合并文档，并为每个教学小节写入独立目录。随后下载同一课程的其他小节时，已经保存的小节仍会保留；重复下载同一资源时只有该资源会按断点状态跳过或在 `--force` 下更新。

工具会读取下载根目录中的 `manifest.json` 识别课程。已经生成的课程和教学小节目录会继续原地使用，不会自动重命名。`manifest.json` 使用课程代码和期次 ID 校验身份，因此分多次下载同一课程的不同章节时，会累积到同一份课程索引和合并纪要中；已有资源只有在使用 `--force` 时才会重新采集。

课程列表、目录、视频链接、字幕、驻点题和课件优先通过课程接口获取。视频截图通常由 `ffmpeg` 完成；接口或媒体处理缺项时才启动浏览器补采。终端会显示采集阶段、耗时和可计算进度时的进度条。

## 配置和隐私

默认状态目录为：

- Linux：`~/.local/state/mooc-notes-cli/`
- 设置了 `XDG_STATE_HOME` 时：`$XDG_STATE_HOME/mooc-notes-cli/`

其中可能包含 `config.json`、`session-*.json`、`browser/` 和播放器字幕。会话文件只保留课程请求所需 Cookie，仍等同于登录状态。不要分享状态目录、授权视频链接、抓包记录或 `downloads/`。

项目已忽略本地下载、配置、会话、浏览器资料、HAR 和日志。提交问题前仍应检查附件，删除 Cookie、签名、用户编号、账号、课程媒体和题目答案。测试数据请使用虚构账号及 `.invalid` 域名。

本工具只整理当前账号有权访问、可供个人学习的内容，不会开始或提交测验。请遵守课程方规则。

## 常见问题

### 为什么仍然打开浏览器？

首次登录、平台要求验证码或账号保护、接口缺少内容以及启用实时扫描时都可能需要浏览器。只允许接口采集可传入 `--api-only`；无法从接口获得的内容会在纪要中标明缺失。

### 为什么没有字幕、答案或截图？

字幕和答案取决于平台是否向当前会话开放。截图还需要可用的授权视频流和 `ffmpeg`。先确认已参加正确期次并重新登录，再查看终端中的具体提示。网络较慢时请求会自动重试，但授权链接过期后需要重新运行。

### 为什么播放器链接之后失效？

平台返回的是有时效的授权地址。重新运行视频模式即可取得新链接。

## 开发与贡献

```bash
npm ci
npm run validate
npm pack --dry-run --ignore-scripts
```

提交规范、模块结构和隐私检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私密报告；版本变化见 [CHANGELOG.md](CHANGELOG.md)。项目采用 [MIT License](LICENSE)。
