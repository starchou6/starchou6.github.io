# 博客 AI 问答

访客在博客右下角的聊天框提问，答案由你 Windows 电脑上的 Codex CLI（用你的 ChatGPT 账号登录）生成。

```
访客浏览器 ──> Cloudflare Worker（本目录） <══ WebSocket ══ 你电脑上的 local-bridge ──> Codex CLI
```

- **Worker**（`ai-worker/`）：接收访客的问题，按 IP 每天限 20 次，再通过 WebSocket 转给你的电脑。它不保存任何 API Key。
- **本地桥接**（`local-bridge/`）：在你电脑上运行，主动连上 Worker（不用开端口，也不用内网穿透）。收到问题后读取博客的 `/index.json`，把文章和问题交给 `codex exec`，再把答案传回去。
- **聊天框**：页面打开时会先问 Worker 你的电脑在不在线，不在线就不显示按钮。
- **答案缓存**：对话的第一个问题如果和以前问过的相同或意思相近，直接返回之前的答案，不再请求你的电脑，也不计入每天的次数。详见下面的"答案缓存"。

## 部署步骤

### 1. 部署 Worker（一次性）

需要一个免费的 Cloudflare 账号。

```bash
cd ai-worker
npm install
npx wrangler login
npx wrangler secret put BRIDGE_TOKEN   # 粘贴一串随机字符，比如 node -e "console.log(crypto.randomUUID())" 的输出
npx wrangler deploy
```

`wrangler deploy` 会输出 Worker 地址，比如 `https://blog-ai-qa.<你的子域名>.workers.dev`。

### 2. 在 Windows 上运行本地桥接

1. 安装 [Node.js](https://nodejs.org/) 22 或更新版本。
2. 安装 Codex CLI 并用 ChatGPT 账号登录：
   ```powershell
   npm install -g @openai/codex
   codex login
   ```
3. 把 `local-bridge\config.example.json` 复制为 `config.json`，填入：
   - `workerUrl`：第 1 步的 Worker 地址
   - `bridgeToken`：第 1 步设置的 `BRIDGE_TOKEN`
   - `codexModel`：想用的模型。留空则用 Codex 的默认模型；想用能力低一点、更快的模型，可以在 `codex` 里输入 `/model` 查看可选的名字
   - `reasoningEffort`：推理强度，默认 `low`
4. 双击 `start-bridge.bat`，看到 `Connected` 就说明连上了。

想开机自动运行，可以按 `Win + R`，输入 `shell:startup`，把 `start-bridge.bat` 的快捷方式放进去。

### 3. 打开博客上的聊天框

在 `hugo.toml` 里填上 Worker 地址，然后推送到 `main`：

```toml
[params.aiChat]
  endpoint = "https://blog-ai-qa.<你的子域名>.workers.dev"
```

## 设置

`ai-worker/wrangler.toml`：

| 设置 | 含义 |
| --- | --- |
| `ALLOWED_ORIGINS` | 允许调用 Worker 的网站，用逗号分隔。`http://localhost:1313` 用于本地 `hugo server`。 |
| `DAILY_LIMIT` | 每个 IP 每天（UTC）最多提问次数，默认 20。命中缓存的问题不计入。 |
| `BLOG_URL` | 博客地址。Worker 定期读取这里的 `/index.json`，内容一变就清空缓存。 |
| `SIMILARITY_THRESHOLD` | 两个问题相似到什么程度才复用答案（0 到 1），默认 0.9。调低会更常命中，但更容易把不同的问题当成同一个。 |

## 答案缓存

- **怎么判断相似**：用 Cloudflare Workers AI 的多语言向量模型 `@cf/baai/bge-m3` 把问题转成向量，再算余弦相似度。它通过 `wrangler.toml` 里的 `[ai]` 绑定调用，不需要 API Key，每天的免费额度对博客问答绰绰有余。
- **缓存哪些问题**：只缓存对话里的第一个问题。追问要结合前面的对话，不会走缓存。
- **什么时候清空**：Worker 每 5 分钟检查一次博客的 `/index.json`，发新文章或修改文章后，旧答案会全部清掉。缓存最多保留 2000 条，超过后删除最早的。
- **调相似度**：运行 `npx wrangler tail` 可以看到每次命中的相似度和匹配到的原问题，比如 `Cache hit (0.934): "如何发布博客" ~ "怎么部署这个博客？"`。如果命中太少，就调低 `SIMILARITY_THRESHOLD`；如果答非所问，就调高。改完重新 `npx wrangler deploy`。
- 向量模型出错时会跳过缓存，问题照常交给你的电脑回答。

## 需要知道的事

- **账号风险**：用个人 ChatGPT 订阅给博客访客提供服务，可能不符合 OpenAI 的使用条款，账号有被限制的可能。
- **安全**：Codex 是能执行命令的 Agent。桥接以只读沙箱（`--sandbox read-only`）、不加载你的 Codex 配置（`--ignore-user-config`）的方式，在一个空的临时文件夹里运行它，并在提示词里要求它只回答问题。这能降低访客通过提问让它在你电脑上做事的风险，但无法完全排除。
- **速度**：问题一个一个排队处理，每个问题都要启动一次 Codex，通常要等几秒到十几秒。超过 2 分钟没有答案会提示访客重试。
- **只运行一个桥接**：同时开两个桥接，它们会互相把对方挤下线。

## 本地开发

```bash
cd ai-worker
echo "BRIDGE_TOKEN=dev" > .dev.vars
npm run dev          # Worker 运行在 http://localhost:8787
```

把 `config.json` 的 `workerUrl` 改成 `http://localhost:8787`、`bridgeToken` 改成 `dev`，运行 `node bridge.mjs`，再在仓库根目录运行：

```bash
HUGO_PARAMS_AICHAT_ENDPOINT=http://localhost:8787 hugo server
```

`npm run typecheck` 检查 Worker 的 TypeScript。
