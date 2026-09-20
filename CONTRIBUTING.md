# 参与开发

欢迎提交不同课程页面的适配问题、修复和测试。请先运行 `npm ci`、`npm run check`、`npm test`。

提交问题时请提供课程链接、资源 ID、命令及报错，说明是否已参加课程。请删去 Cookie、账号信息、完整课程 DTO、题目答案和课程媒体文件。测试样例应使用自行编写的虚构内容。

代码风格为 2 空格缩进、ES 模块。将平台 API 适配逻辑放在 `src/api.js`，网页采集逻辑放在 `src/browser.js`、`src/capture.js` 或 `src/quiz.js`；字幕和文档生成保持与平台无关。修复跨课程问题时增加针对真实结构差异的最小测试。

版本遵循语义化版本。用户可见的变化请更新 `CHANGELOG.md`，提交说明用简短的动词开头，例如 `Fix subtitle timing for comma timestamps`。
