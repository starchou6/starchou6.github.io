# Blog AI Q&A Worker

A Cloudflare Worker that answers visitors' questions about the blog with Claude.
The blog is static, so the API key can't live in the page; the chat widget calls
this worker, and the worker calls the Claude API.

How it works:

- It reads the blog's posts from `/index.json`, which PaperMod already publishes
  for its search page, and caches them for 10 minutes. New posts are picked up
  automatically after a deploy.
- Every request sends the posts to Claude as context and asks it to answer only
  from them, linking the posts it uses. If the blog outgrows
  `MAX_CONTEXT_CHARS`, only the posts most related to the question are sent.
- Only origins in `ALLOWED_ORIGINS` may call it, each IP gets 10 questions per
  minute, and conversations are capped at 10 messages of 1000 characters.

## Deploy

You need a Cloudflare account and a Claude API key from
https://platform.claude.com.

```bash
cd ai-worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when asked
npx wrangler deploy
```

`wrangler deploy` prints the worker URL, such as
`https://blog-ai-qa.<your-subdomain>.workers.dev`. Put it in `hugo.toml`:

```toml
[params.aiChat]
  endpoint = "https://blog-ai-qa.<your-subdomain>.workers.dev"
```

Push to `main`, and the chat button appears in the bottom-right corner of every
page.

## Configuration

`wrangler.toml` holds the settings:

| Setting | Meaning |
| --- | --- |
| `BLOG_URL` | Where the blog is published; `/index.json` is read from here. |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the worker. `http://localhost:1313` lets `hugo server` use it. |
| `MODEL` | Claude model to use. Defaults to `claude-opus-5-5`. |
| `[[ratelimits]]` | Questions allowed per IP per minute. |

To cap monthly spend, set a limit in the Claude Console.

## Local development

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars
npm run dev    # worker on http://localhost:8787
# in another terminal, from the repo root:
HUGO_PARAMS_AICHAT_ENDPOINT=http://localhost:8787 hugo server
```

`npm run typecheck` checks the TypeScript.
