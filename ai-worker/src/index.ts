import { DurableObject } from "cloudflare:workers";

export interface Env {
  // Shared secret the local bridge presents when it connects.
  BRIDGE_TOKEN: string;
  // Comma-separated list of origins allowed to call this worker.
  ALLOWED_ORIGINS: string;
  // Questions each IP may ask per day (UTC).
  DAILY_LIMIT: string;
  HUB: DurableObjectNamespace<Hub>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1000;
const ANSWER_TIMEOUT_MS = 120_000;

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
// answer, and the per-IP daily counters.
export class Hub extends DurableObject<Env> {
  private pending = new Map<string, (answer: { answer?: string; error?: string }) => void>();
  private counterDay = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer the bridge's keepalive pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private bridge(): WebSocket | undefined {
    return this.ctx.getWebSockets("bridge")[0];
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
    return new Response(null, { status: 101, webSocket: client });
  }

  private async countToday(ip: string): Promise<boolean> {
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
    const key = `count:${today}:${ip}`;
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    if (used >= Number(this.env.DAILY_LIMIT)) return false;
    await this.ctx.storage.put(key, used + 1);
    return true;
  }

  private async ask(request: Request): Promise<Response> {
    const { ip, messages } = (await request.json()) as { ip: string; messages: ChatMessage[] };
    const bridge = this.bridge();
    if (!bridge) return json({ error: "The assistant is offline right now." }, 503);
    if (!(await this.countToday(ip))) {
      return json({ error: "You've reached today's question limit. Please come back tomorrow." }, 429);
    }

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

    return result.answer ? json({ answer: result.answer }, 200) : json({ error: result.error }, 502);
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
