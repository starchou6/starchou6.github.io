# 本地桥接

在你的 Windows 电脑上运行，把博客访客的问题交给 Codex CLI 回答。安装和配置步骤见 [ai-worker/README.md](../ai-worker/README.md#2-在-windows-上运行本地桥接)。

- `bridge.mjs`：桥接程序，只依赖 Node.js 22+ 自带的功能
- `config.example.json`：配置模板，复制为 `config.json` 后填写（`config.json` 不会被提交）
- `start-bridge.bat`：双击启动
