# mooc-notes-cli

把自己已参加的中国大学 MOOC 课程整理成 Markdown 学习纪要。工具按视频时间线合并字幕、稳定画面截图和驻点小测，也整理课后 Quiz 与可获取的课件。另有小测索引，便于按教学小节查找。

## 安装

需要 Node.js 20+。视频截图需要 `ffmpeg`；首次登录和网页补采需要 Chrome 或 Chromium。

```bash
npm ci
npm link
mooc-notes --help
```

`puppeteer-core` 不会安装浏览器。浏览器不在常见位置时，可设置 `MOOC_NOTES_BROWSER` 或使用 `--browser PATH`。

## 使用

```bash
mooc-notes config  # 按需设置账号密码和默认播放器
mooc-notes login   # 优先复用会话或自动登录；需要验证时打开登录页
mooc-notes login --manual  # 直接打开登录页，选择任意手动登录方式
mooc-notes         # 交互菜单：选操作、课程、教学小节
```

菜单支持方向键、关键词筛选与 Enter 确认。选课时会显示账号课程，也可以手动输入课程 ID 或链接；选择教学小节或视频时会显示相应目录。**默认只处理一个教学小节**；只有 `--all` 才处理整门课程。

`config` 可在本机保存登录账号、密码和播放器路径。也可用 `mooc-notes config --player '/mnt/c/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe'` 直接设置默认播放器。密码输入不回显；如果不希望保存密码，可同时设置环境变量 `MOOC_NOTES_USERNAME` 和 `MOOC_NOTES_PASSWORD`，登录时会优先使用它们。配置文件保存在用户状态目录 `mooc-notes-cli/config.json`，不是项目目录；密码以明文保存在只有当前用户可读的文件中。运行 `mooc-notes config` 可以清除已保存的账号密码。

`login` 先检查已有会话。配置了手机号或邮箱和密码时，工具会按照登录页当前使用的协议直接发送 HTTPS 请求，并在本机完成密码加密、短时计算验证和登录 Cookie 同步；成功时不会启动浏览器。如果平台要求图片验证码、滑块、短信或账号保护验证，工具会直接打开中国大学 MOOC 的[专用登录页](https://www.icourse163.org/member/login.htm)，预填可用信息，供你完成验证。检测到课程会话后会自动保存并关闭浏览器，不再要求回终端按 Enter。其他账号格式或直接请求暂不可用时，也会回退到同一登录页。切换账号或强制重新登录用 `mooc-notes login --force`。

使用爱课程、校园用户、二维码或第三方账号时，运行 `mooc-notes login --manual`。该命令跳过已有 API 会话、配置账号和自动登录，清除工具浏览器资料中的旧认证 Cookie 后直接打开登录页。你可以在页面选择任意登录方式；登录成功后工具自动保存新会话并关闭浏览器。本机保存的账号密码配置不会被删除。

这里使用的是平台登录页公开加载的个人账号登录流程。平台文档中的[单点登录接口](https://docs.icourse163.org/api-doc/login-intergration.html)需要分配给机构的应用密钥，不适合个人账号。登录页协议发生变化时，直接登录会安全回退到浏览器，不会把明文密码写入日志或错误信息。

脚本中使用统一格式 `mooc-notes [课程] --mode 模式`。模式如下：

| 模式 | 用途 |
| --- | --- |
| `notes`（默认） | 导出字幕、截图、课件和小测 |
| `video`（获取课程视频） | 获取一个视频的授权链接，再选择是否交给播放器 |

课程参数示例：

- 课程编号：`ZJU1-1460402161`
- 纯数字课程 ID：`1460402161`
- 含期次的完整链接：`https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496`

课程编号或纯数字 ID 需要当前账号已参加课程，工具会从账号课程列表解析期次。完整链接中的 `tid` 可直接指定期次。以上是公开课程标识示例，不是账号标识；课程可用性仍取决于当前登录会话。

```bash
# 导出一段指定视频；也可用 --lesson 1278585470 导出整个教学小节
mooc-notes 'https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496' --unit 1320673525

# 导出整个教学小节，包含视频驻点小测与课后 Quiz；题目也会汇总到 quizzes.md
mooc-notes 1460402161 --mode notes --lesson 1278585470

# 获取课程视频；在交互终端中可设置或修改默认播放器并播放
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525

# 在脚本中指定播放器，获取链接后直接播放并加载课程字幕
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525 --player mpv

# 使用 VLC
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525 --player vlc

# 在 WSL 中临时使用 Windows 版 PotPlayer（按实际安装路径调整）
mooc-notes ZJU1-1460402161 --mode video --unit 1320673525 \
  --player '/mnt/c/Program Files/DAUM/PotPlayer/PotPlayerMini64.exe'
```

`--unit` 选单项资源，`--lesson` 选一个教学小节，`--all` 明确选整门课程。`--output DIR` 更改输出目录；`--force` 重新采集已有资源。使用 `--api-only` 可禁止网页补采。视频采样可用 `--interval SEC`、`--threshold NUMBER` 和 `--max-frames NUMBER` 调整；`--scan-mode realtime` 在浏览器中实际播放，适合检查接口未提供的驻点小测。查看完整参数运行 `mooc-notes --help`。

## 输出与工作方式

默认输出到 `downloads/<课程编号>-<期次>/`：

```text
downloads/<课程编号>-<期次>/
├── notes.md       # 按章节、课时与时间线排列的图文纪要
├── quizzes.md     # 按教学小节查找题目的索引
├── manifest.json  # 断点续跑记录
└── assets/         # 截图、题目配图与课件
```

课程列表、目录、视频链接、字幕、驻点题和可下载课件优先通过当前会话的课程接口获取。通常用 `ffmpeg` 从授权视频流取帧，检测画面变化并等待画面稳定后保存；接口或媒体处理缺项时才按需打开浏览器补采。终端会显示采集阶段、已用时间，以及可计算进度时的进度条。重复运行会跳过已完成资源，并保留先前取得的字幕、截图和题目。

`video` 模式先将链接写到标准输出。交互终端可选择仅保留链接、用已配置的默认播放器播放、直接设置或修改默认播放器并播放，或临时使用其他播放器而不保存。非交互运行只输出链接，适合复制或接入脚本。指定 `--player PATH` 会在获取链接后直接播放；交互选择时，`MOOC_NOTES_PLAYER` 可临时覆盖本地保存的默认播放器。若设置了该环境变量，在视频流程中修改本地默认播放器后，后续运行仍会优先使用环境变量，终端会给出提示。

选择播放后，工具会读取该课时所有可用的课程字幕轨，并按内容识别中文、英文。两种字幕都有时，还会按起止时间合成双语字幕（上方中文、下方英文）。PotPlayer 使用一个含「中文 / English / 双语」选项的多语言 SMI 文件，在播放器的字幕语言菜单中切换；[mpv](https://mpv.io/manual/stable/) 会加载三条独立字幕轨，按 `j` 或 `J` 切换。[VLC](https://docs.videolan.me/vlc-user/desktop/3.0/en/basic/subtitles.html) 和 `--subtitle-arg` 自定义播放器默认加载中文 SRT，可在播放器中手动添加保存的英文或双语 SRT。若当前课程会话只提供英文，工具会明确提示，无法凭空生成中文或双语字幕。这是课程字幕同步播放，不是语音实时转写或机器翻译。

若没有可读取的课程字幕，会提示并继续播放视频。字幕文件保存在用户状态目录 `mooc-notes-cli/subtitles/`，仅当前用户可读；播放器退出后仍保留，供再次播放使用。在 WSL 中调用 `.exe` 播放器时，工具通过 `wslpath` 转换字幕路径。播放器需要支持平台返回的 HLS 或 MP4；授权链接过期后重新获取即可。

## 限制与隐私

- 字幕依赖课程提供的字幕轨，不做语音识别。按间隔采样可能遗漏短暂画面变化；动画较多时可减小 `--interval`。视频流、课件或 Quiz 未向当前会话开放时，会在纪要中标明缺失。
- 工具只保存课程已向当前会话提供的题目、答案和解析，不会开始或提交测验。部分答案或无锚点的驻点题可能无法获取；实时播放遇到必须手动操作的小测时，后续扫描可能中断。
- API 会话保存在用户状态目录的 `mooc-notes-cli/session-*.json`，浏览器资料位于其 `browser/` 子目录；可用 `XDG_STATE_HOME` 和 `--profile` 调整。登录配置保存在同目录的 `config.json`。会话文件仅保留课程请求需要的 Cookie，仍代表登录状态；配置文件可能含有明文密码。不要分享这些文件、授权视频链接、抓包记录或 `downloads/`。
- 本项目忽略本地下载、浏览器资料和日志。提交问题时请先删除 Cookie、用户编号、签名、个人信息和课程媒体文件。测试样例请使用虚构数据。

仅整理自己有权访问且可供个人学习的内容，并遵守课程方规则。

## 开发

```bash
npm ci
npm run check
npm test
```

源码按接口请求、采集、字幕/画面处理与文档生成分模块维护。贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。许可证：[MIT](LICENSE)。
