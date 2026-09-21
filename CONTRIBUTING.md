# 参与开发

欢迎提交不同课程页面的适配问题、修复和测试。请先运行 `npm ci`、`npm run check`、`npm test`。

提交问题时请提供课程链接、资源 ID、命令及报错，说明是否已参加课程。请删去 Cookie、账号信息、完整课程 DTO、题目答案和课程媒体文件。测试样例应使用自行编写的虚构内容。

代码风格为 2 空格缩进、ES 模块。将平台请求放在 `src/api.js`，接口采集放在 `src/api_capture.js`，网页补采放在 `src/browser.js` 与 `src/capture.js`。DWR 资源地址解析放在 `src/resources.js`，字幕和文档生成保持与平台无关。修复跨课程问题时增加针对真实结构差异的最小测试。CLI 只保留交互入口、`login` 和 `--mode`；新增功能优先整合到现有菜单。

版本遵循语义化版本。用户可见的变化请更新 `CHANGELOG.md`。每个提交只包含一个可独立审查的改动及其必要的测试和文档；提交说明用简短的动词开头，例如 `Fix subtitle timing for comma timestamps`。
