import Anthropic from "@anthropic-ai/sdk";

export interface Env {
  ANTHROPIC_API_KEY: string;
  // Public URL of the blog, e.g. https://starchou6.github.io
  BLOG_URL: string;
  // Comma-separated list of origins allowed to call this worker.
  ALLOWED_ORIGINS: string;
  MODEL?: string;
  // Optional Cloudflare rate limiting binding (see wrangler.toml).
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

interface Post {
  title: string;
  content: string;
  permalink: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1000;
// Upper bound for blog text sent to the model per request. When the blog
// grows past this, only the posts most related to the question are sent.
const MAX_CONTEXT_CHARS = 200_000;
const INDEX_TTL_MS = 10 * 60 * 1000;

let indexCache: { posts: Post[]; fetchedAt: number } | null = null;

async function loadPosts(env: Env): Promise<Post[]> {
  if (indexCache && Date.now() - indexCache.fetchedAt < INDEX_TTL_MS) {
    return indexCache.posts;
  }
  // PaperMod already publishes every page as /index.json for its search page.
  const res = await fetch(new URL("/index.json", env.BLOG_URL).toString());
  if (!res.ok) throw new Error(`Failed to load blog index: ${res.status}`);
  const posts = (await res.json()) as Post[];
  indexCache = { posts, fetchedAt: Date.now() };
  return posts;
}

// Lowercased words plus CJK character bigrams, so scoring works for
// English, Chinese and Japanese questions alike.
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9][a-z0-9.#+-]*/g) ?? []) {
    if (word.length > 1) tokens.add(word);
  }
  const cjk = lower.match(/[぀-ヿ㐀-鿿]+/g) ?? [];
  for (const run of cjk) {
    for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

function selectPosts(posts: Post[], question: string): Post[] {
  const total = posts.reduce((n, p) => n + p.content.length, 0);
  if (total <= MAX_CONTEXT_CHARS) return posts;

  const q = tokenize(question);
  const scored = posts.map((post) => {
    const t = tokenize(`${post.title} ${post.title} ${post.content}`);
    let score = 0;
    for (const token of q) if (t.has(token)) score++;
    return { post, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const selected: Post[] = [];
  let used = 0;
  for (const { post } of scored) {
    if (used + post.content.length > MAX_CONTEXT_CHARS) continue;
    selected.push(post);
    used += post.content.length;
  }
  return selected;
}

function buildSystemPrompt(posts: Post[]): string {
  const docs = posts
    .map(
      (p, i) =>
        `<post index="${i + 1}">\n<title>${p.title}</title>\n<url>${p.permalink}</url>\n<content>\n${p.content}\n</content>\n</post>`,
    )
    .join("\n\n");

  return `You are the Q&A assistant on Zhou Jing's tech blog. Visitors ask you questions about the blog's posts and about the author.

Answer using only the blog content below. When you use a post, link to it with a Markdown link to its URL. If the content does not cover the question, say so briefly and suggest a related post if one exists; do not make up facts about the author or the posts. Reply in the language the visitor writes in. Keep answers short and conversational: a few sentences, or a short list when steps are involved.

<blog>
${docs}
</blog>`;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const messages = raw.slice(-MAX_MESSAGES).map((m) => ({
    role: m?.role,
    content: typeof m?.content === "string" ? m.content.trim().slice(0, MAX_MESSAGE_CHARS) : "",
  }));
  // The conversation must start with the visitor, alternate, and end with a question.
  if (messages[0]?.role !== "user") messages.shift();
  const valid = messages.every(
    (m, i) => m.content && m.role === (i % 2 === 0 ? "user" : "assistant"),
  );
  if (!valid || messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return null;
  }
  return messages as ChatMessage[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }
    if (!cors["Access-Control-Allow-Origin"]) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }

    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Too many requests, please try again later." }, 429, cors);
    }

    let messages: ChatMessage[] | null;
    try {
      messages = parseMessages(await request.json());
    } catch {
      messages = null;
    }
    if (!messages) return json({ error: "Invalid request" }, 400, cors);

    try {
      const posts = await loadPosts(env);
      const question = messages[messages.length - 1].content;
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

      const response = await client.beta.messages.create({
        model: env.MODEL || "claude-opus-5-5",
        max_tokens: 4000,
        output_config: { effort: "low" },
        // Retry on the server-defined fallback model if the request is declined.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [
          {
            type: "text",
            text: buildSystemPrompt(selectPosts(posts, question)),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
      });

      if (response.stop_reason === "refusal") {
        return json({ answer: "Sorry, I can't help with that question." }, 200, cors);
      }
      const answer = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("")
        .trim();
      return json({ answer }, 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        return json({ error: "The assistant is busy, please try again later." }, 503, cors);
      }
      console.error(error);
      return json({ error: "Something went wrong, please try again later." }, 500, cors);
    }
  },
};
