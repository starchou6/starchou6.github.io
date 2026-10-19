import { DurableObject } from "cloudflare:workers";
import { AnswerCache } from "./answer-cache";

export interface Env {
  // Shared secret the local bridge presents when it connects.
  BRIDGE_TOKEN: string;
  // Comma-separated list of origins allowed to call this worker.
  ALLOWED_ORIGINS: string;
  // Questions each IP (IPv6: each /64) may ask per day (UTC), and questions
  // the whole site may send to the bridge per day. Cached answers don't count.
  DAILY_LIMIT: string;
  GLOBAL_DAILY_LIMIT: string;
  // Public URL of the blog; the cache is emptied when its /index.json changes.
  BLOG_URL: string;
  // How similar (cosine, 0-1) a question must be to a cached one to reuse its answer.
  SIMILARITY_THRESHOLD: string;
  AI: Ai;
  HUB: DurableObjectNamespace<Hub>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1000;
const ANSWER_TIMEOUT_MS = 120_000;
// The bridge pings every 30s; a bridge silent for longer than this (e.g. its
// computer went to sleep) is treated as offline.
const BRIDGE_STALE_MS = 90_000;

// True when the answer links anywhere other than the blog. Such answers
// aren't cached, so one visitor can't plant a link that others are shown.
function linksOutsideBlog(answer: string, blogUrl: string): boolean {
  const blogHost = new URL(blogUrl).host;
  for (const match of answer.matchAll(/https?:\/\/[^\s)\]>"']+/g)) {
    try {
      if (new URL(match[0]).host !== blogHost) return true;
    } catch {
      return true;
    }
  }
  return false;
}

// IPv6 users can switch addresses within their /64 at will, so they are
// counted per /64 network.
function clientKey(ip: string): string {
  // IPv4, including IPv4-mapped IPv6 such as ::ffff:203.0.113.5.
  if (!ip.includes(":") || ip.includes(".")) return ip;
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":")}::/64`;
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
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

// One instance holds the bridge's WebSocket, the questions waiting for an
// answer, the per-IP daily counters and the answer cache.
export class Hub extends DurableObject<Env> {
  private pending = new Map<string, (answer: { answer?: string; error?: string }) => void>();
  private counterDay = "";
  private cache: AnswerCache;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer the bridge's keepalive pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.cache = new AnswerCache(ctx.storage.sql, env.AI, env.BLOG_URL, Number(env.SIMILARITY_THRESHOLD));
  }

  private bridge(): WebSocket | undefined {
    const ws = this.ctx.getWebSockets("bridge")[0];
    if (!ws) return undefined;
    const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime();
    const connectedAt = (ws.deserializeAttachment() as { connectedAt: number } | null)?.connectedAt ?? 0;
    return Date.now() - Math.max(lastPing ?? 0, connectedAt) < BRIDGE_STALE_MS ? ws : undefined;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/connect":
        return this.acceptBridge();
      case "/status":
        return json({ online: Boolean(this.bridge()) }, 200);
      case "/ask":
        return this.ask(request);
      default:
        return json({ error: "Not found" }, 404);
    }
  }

  private acceptBridge(): Response {
    // A new bridge replaces any stale connection.
    for (const ws of this.ctx.getWebSockets("bridge")) ws.close(1000, "Replaced");
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, ["bridge"]);
    server.serializeAttachment({ connectedAt: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Counts a question against the visitor's and the site's daily limits.
  // Returns the counter keys to refund if the question isn't answered, or an
  // error message when a limit is reached.
  private async countToday(ip: string): Promise<{ keys: string[] } | { error: string }> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.counterDay !== today) {
      // Drop counters from earlier days.
      const old = await this.ctx.storage.list({ prefix: "count:" });
      const stale = [...old.keys()].filter((k) => !k.startsWith(`count:${today}:`));
      for (let i = 0; i < stale.length; i += 128) {
        await this.ctx.storage.delete(stale.slice(i, i + 128));
      }
      this.counterDay = today;
    }
    const visitorKey = `count:${today}:${clientKey(ip)}`;
    const siteKey = `count:${today}:*`;
    const [visitor = 0, site = 0] = await Promise.all([
      this.ctx.storage.get<number>(visitorKey),
      this.ctx.storage.get<number>(siteKey),
    ]);
    if (visitor >= Number(this.env.DAILY_LIMIT)) {
      return { error: "You've reached today's question limit. Please come back tomorrow." };
    }
    if (site >= Number(this.env.GLOBAL_DAILY_LIMIT)) {
      return { error: "The assistant has answered all it can for today. Please come back tomorrow." };
    }
    await this.ctx.storage.put({ [visitorKey]: visitor + 1, [siteKey]: site + 1 });
    return { keys: [visitorKey, siteKey] };
  }

  private async refund(keys: string[]): Promise<void> {
    for (const key of keys) {
      const used = (await this.ctx.storage.get<number>(key)) ?? 0;
      if (used > 0) await this.ctx.storage.put(key, used - 1);
    }
  }

  private async ask(request: Request): Promise<Response> {
    const { ip, messages } = (await request.json()) as { ip: string; messages: ChatMessage[] };

    // Only a conversation's opening question is cached; follow-ups depend on
    // what was said before.
    let vector: Float32Array | null = null;
    if (messages.length === 1) {
      const question = messages[0].content;
      try {
        vector = await this.cache.embed(question);
        const hit = await this.cache.lookup(vector);
        if (hit) {
          console.log(`Cache hit (${hit.similarity.toFixed(3)}): "${question}" ~ "${hit.question}"`);
          return json({ answer: hit.answer }, 200);
        }
      } catch (error) {
        // Without the cache, the question still goes to the bridge.
        console.error("Answer cache unavailable:", error);
        vector = null;
      }
    }

    const bridge = this.bridge();
    if (!bridge) return json({ error: "The assistant is offline right now." }, 503);
    const counted = await this.countToday(ip);
    if ("error" in counted) return json({ error: counted.error }, 429);

    const id = crypto.randomUUID();
    const result = await new Promise<{ answer?: string; error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: "The assistant took too long to answer, please try again." });
      }, ANSWER_TIMEOUT_MS);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(r);
      });
      bridge.send(JSON.stringify({ type: "ask", id, messages }));
    });

    if (!result.answer) {
      await this.refund(counted.keys);
      return json({ error: result.error }, 502);
    }
    if (vector && !linksOutsideBlog(result.answer, this.env.BLOG_URL)) {
      this.cache.store(messages[0].content, result.answer, vector);
    }
    return json({ answer: result.answer }, 200);
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let data: { type?: string; id?: string; answer?: string; error?: string };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (data.type === "answer" && data.id) {
      this.pending.get(data.id)?.({ answer: data.answer, error: data.error });
    }
  }

  async webSocketClose(): Promise<void> {
    if (this.bridge()) return;
    for (const resolve of this.pending.values()) {
      resolve({ error: "The assistant went offline, please try again later." });
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hub = env.HUB.get(env.HUB.idFromName("main"));

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return json({ error: "Expected a WebSocket" }, 426);
      }
      if (request.headers.get("Authorization") !== `Bearer ${env.BRIDGE_TOKEN}`) {
        return json({ error: "Unauthorized" }, 401);
      }
      return hub.fetch("https://hub/connect", request);
    }

    const cors = corsHeaders(request.headers.get("Origin"), env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!cors["Access-Control-Allow-Origin"]) {
      return json({ error: "Origin not allowed" }, 403, cors);
    }

    if (url.pathname === "/status" && request.method === "GET") {
      const res = await hub.fetch("https://hub/status");
      return json(await res.json(), 200, { ...cors, "Cache-Control": "no-store" });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      let messages: ChatMessage[] | null;
      try {
        messages = parseMessages(await request.json());
      } catch {
        messages = null;
      }
      if (!messages) return json({ error: "Invalid request" }, 400, cors);

      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const res = await hub.fetch("https://hub/ask", {
        method: "POST",
        body: JSON.stringify({ ip, messages }),
      });
      return json(await res.json(), res.status, cors);
    }

    return json({ error: "Not found" }, 404, cors);
  },
};
