# mooc-notes-cli

将中国大学 MOOC 中自己有权访问的课程，整理成可搜索的图文学习纪要。工具按视频时间线合并字幕、画面变化截图和驻点小测，也采集可见的课后或章节 Quiz 与可下载课件。输出为一个 `notes.md`、一个 `quizzes.md` 和本地附件目录。

> 当前版本为 `0.1.0`。课程页面和接口会变化；首次使用请先用一节课验证输出。工具不会自动开始、提交测验，也不会获取页面未显示的答案。视频截图是按间隔采样，两个采样点之间的短暂画面变化可能遗漏。

## 环境与安装

- Node.js 20 或更新版本
- Chrome 或 Chromium 浏览器
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

# 查看课程目录；优先使用完整链接或 ZJU1-1460402161 形式的课程编号
mooc-notes list 'https://www.icourse163.org/learn/ZJU1-1460402161?tid=1488053496'

# 默认导出整门课程，生成 notes.md、quizzes.md、assets/、manifest.json
mooc-notes export 'ZJU1-1460402161' --output ./downloads/my-course

# 只采集匹配名称或 ID 的资源，适合先试一节
mooc-notes export 'ZJU1-1460402161' --unit '1320673525' --output ./downloads/my-course

# 单独整理驻点小测和课后 Quiz；默认实际播放视频以触发驻点小测
mooc-notes quizzes 'ZJU1-1460402161' --output ./downloads/my-course
```

`export` 默认以 2 秒间隔跳播取帧，速度较快。发现视频中有驻点小测却未被采集时，使用 `--scan-mode realtime --force` 实际播放该课时。实时模式将播放器静音并以 2 倍速播放；遇到需要学员操作的小测会保存当前可见题目并停止该视频的后续扫描。可用 `--interval 1` 提高截图密度，`--threshold` 调整画面变化灵敏度，`--max-frames` 调整每个视频的截图上限。

重复执行会跳过 `manifest.json` 中已采集的资源；`--force` 重新采集。建议先运行 `list` 找到资源 ID，再用 `--unit` 试导出。无图形界面的服务器可在已经登录后使用 `--headless`，首次登录仍需可见浏览器。

## 输出示例

```text
downloads/my-course/
├── notes.md          # 全课学习纪要，字幕、截图、题目按时间排列
├── quizzes.md        # 按章节、课时汇总的题目索引
├── manifest.json     # 断点续跑记录，不包含账号密码或 Cookie
└── assets/
    └── 1320673525/
        ├── frame-0001.png
        └── courseware.pdf
```

每个章节标题都有原课时链接。未提供字幕、课件下载或播放器截图失败时，文档中会写明缺失项。对于课件，工具只尝试下载当前课程提供的 PDF 地址；无法下载时尝试保存页面可见的课件截图或文字。图文与测验只保存在本地，项目仓库不包含课程内容。

## 已知限制

- 登录后才可读取参与课程的目录。纯数字课程 ID 会尝试打开平台的详情页；如果该页没有提供期次，请改用完整课程链接或“学校编号-课程 ID”。
- 字幕依赖平台提供的字幕轨或字幕文件；不做语音识别。
- 画面变化检测基于视频截图采样，无法保证捕获小于采样间隔的变化。播放器禁止定位、视频黑屏或加密渲染时，会继续导出其他内容并标记问题。
- 测验只采集当前会话中可见的题干、选项及已显示的答案和解析。需点击“开始答题”才能显示的 Quiz 不会被自动开启，以免消耗作答机会。
- 默认跳播可能不会触发驻点小测；使用 `quizzes` 或 `--scan-mode realtime` 可实际播放，但若小测阻塞播放，后续小测可能仍需手动操作后再运行。
- 不保证平台改版后选择器和课程目录接口继续可用。建议提交脱敏后的问题报告及课程 URL，帮助适配不同课程。

## 隐私与使用范围

浏览器会话默认保存在用户目录 `~/.local/state/mooc-notes-cli/browser`（遵循 `XDG_STATE_HOME`）。它包含登录状态，不要将该目录、Cookie、HAR 或 `downloads/` 提交到 GitHub。工具不接收账号密码、不向第三方服务上传数据、不自动答题，也不处理视频 DRM。

请只整理自己有权访问、可供个人学习的课程内容，并遵守课程方的使用规则。平台的[教师帮助](https://help.icourse163.org/help-doc/oc-manual4.html)说明视频可含驻点测验与字幕；[官方接口文档](https://docs.icourse163.org/api-doc/get-info.html)说明文档能否下载由课程方设置。

## 开发

```bash
npm ci
npm run check
npm test
```

项目使用原生 ES 模块和 Node 内置测试器。课程目录、采集、字幕、题目、文档生成分模块维护。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

许可证：[MIT](LICENSE)。
