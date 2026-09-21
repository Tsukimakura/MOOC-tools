# 参与开发

欢迎提交课程适配问题、错误修复、测试和文档改进。请仅使用自己有权访问的课程验证功能，并先清除所有个人信息和受限课程内容。

## 开发环境

需要 Node.js 20 或更高版本。涉及视频截图时安装 `ffmpeg`；涉及浏览器登录或补采时安装 Chrome 或 Chromium。

```bash
git clone https://github.com/Tsukimakura/MOOC-tools.git
cd MOOC-tools
npm ci
npm run validate
```

测试使用 Node.js 内置测试运行器，不需要真实账号或网络访问。

## 提交问题

错误报告请尽量包含：

- 工具版本、操作系统、Node.js 版本和执行命令
- 使用的课程代码或公开课程链接，以及资源类型和资源 ID
- 是否已参加对应期次、是否使用 `--api-only`、浏览器或播放器类型
- 完整错误文字和最小复现步骤

不要上传真实账号、密码、Cookie、会话文件、用户编号、带签名的视频链接、HAR、完整接口响应、课程媒体、未公开题目或答案。日志和截图也可能间接包含这些内容。需要展示数据结构时，请保留必要字段并替换所有值；账号示例使用明显虚构的号码和 `.invalid` 域名。

安全漏洞请按照 [SECURITY.md](SECURITY.md) 私密报告，不要公开披露细节。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `bin/mooc-notes.js` | 命令行入口 |
| `src/cli.js` | 参数、交互流程和任务编排 |
| `src/login.js`、`src/direct_login.js` | 会话复用、直接登录和浏览器回退 |
| `src/api.js`、`src/api_capture.js` | 课程接口和接口采集 |
| `src/browser.js`、`src/capture.js` | 浏览器启动和网页补采 |
| `src/stream.js`、`src/frames.js`、`src/media.js` | 视频地址、稳定截图和媒体处理 |
| `src/subtitles.js`、`src/player.js` | 字幕整理和外部播放器启动 |
| `src/quiz.js`、`src/resources.js` | 小测合并和资源解析 |
| `src/render.js` | Markdown 与清单生成 |
| `test/` | 无网络单元测试和流程测试 |

平台请求应放在 `api` 模块，浏览器操作应放在浏览器采集模块。字幕、画面分析和文档生成保持与平台页面实现无关。新增用户流程优先整合到现有交互菜单、`login`、`config` 或 `--mode`，避免增加含义重叠的顶层命令。

## 代码约定

- 使用 ES 模块、2 空格缩进和现有命名风格。
- 对所有外部 URL、文件路径、接口响应和用户输入做边界校验。
- 网络请求限制到明确需要的 HTTPS 主机；重定向和 Cookie 不得扩大权限范围。
- 不在日志、异常、测试快照或仓库文件中写入密码、Cookie、签名和真实个人信息。
- 修复课程差异时添加能表达该差异的最小虚构测试夹具。
- 避免复制页面大对象或完整课程响应；测试只保留验证行为所需字段。
- 用户可见的行为变化需要同步更新 README 和 `CHANGELOG.md`。

## 验证修改

提交前至少运行：

```bash
npm run validate
git diff --check
npm pack --dry-run --ignore-scripts
```

涉及登录、Cookie 或 URL 安全边界时，应增加拒绝无效输入的测试。涉及真实浏览器或平台接口的手动验证只记录结论和脱敏环境，不提交资料目录、抓包或导出内容。

## Git 和 Pull Request

版本遵循[语义化版本](https://semver.org/lang/zh-CN/)。每个提交应只包含一个可独立审查的改动及其必要测试和文档。提交标题使用简短的祈使句，例如 `Fix subtitle timing for comma timestamps`。

Pull Request 请说明：

- 问题和用户可见影响
- 实现方式与关键取舍
- 自动测试及必要的手动验证
- 隐私、兼容性或平台协议方面的风险
- 对应 Issue，以及 README/CHANGELOG 是否已更新

提交前确认 `git status` 中没有 `downloads/`、状态目录、浏览器资料、日志、HAR 或临时调试文件。
