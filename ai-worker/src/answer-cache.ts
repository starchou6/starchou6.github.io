// Remembers answers to visitors' opening questions so that the same or a
// similar question is answered from the cache instead of the local bridge.
// Similarity is cosine similarity between Workers AI embeddings.

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const MAX_ENTRIES = 2000;
// How often to check whether the blog's posts changed.
const VERSION_CHECK_MS = 5 * 60 * 1000;

export interface CacheHit {
  answer: string;
  question: string;
  similarity: number;
}

interface Entry {
  id: number;
  question: string;
  answer: string;
  vector: Float32Array;
}

export class AnswerCache {
  private entries: Entry[] | null = null;
  private versionCheckedAt = 0;

  constructor(
    private sql: SqlStorage,
    private ai: Ai,
    private blogUrl: string,
    private threshold: number,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      vector BLOB NOT NULL
    )`);
    sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  async embed(question: string): Promise<Float32Array> {
    const out = await this.ai.run(EMBEDDING_MODEL, { text: [question] });
    const vector = "data" in out ? out.data?.[0] : undefined;
    if (!vector) throw new Error("Embedding model returned no vector");
    return normalize(Float32Array.from(vector));
  }

  async lookup(vector: Float32Array): Promise<CacheHit | null> {
    await this.dropIfPostsChanged();
    let best: CacheHit | null = null;
    for (const entry of this.load()) {
      const similarity = dot(vector, entry.vector);
      if (!best || similarity > best.similarity) {
        best = { answer: entry.answer, question: entry.question, similarity };
      }
    }
    return best && best.similarity >= this.threshold ? best : null;
  }

  store(question: string, answer: string, vector: Float32Array): void {
    const entries = this.load();
    const row = this.sql
      .exec<{ id: number }>(
        "INSERT INTO answers (question, answer, vector) VALUES (?, ?, ?) RETURNING id",
        question,
        answer,
        vector.buffer,
      )
      .one();
    entries.push({ id: row.id, question, answer, vector });

    if (entries.length > MAX_ENTRIES) {
      const removed = entries.splice(0, entries.length - MAX_ENTRIES);
      this.sql.exec("DELETE FROM answers WHERE id <= ?", removed[removed.length - 1].id);
    }
  }

  private load(): Entry[] {
    if (!this.entries) {
      this.entries = this.sql
        .exec<{ id: number; question: string; answer: string; vector: ArrayBuffer }>(
          "SELECT id, question, answer, vector FROM answers ORDER BY id",
        )
        .toArray()
        .map((r) => ({ ...r, vector: new Float32Array(r.vector) }));
    }
    return this.entries;
  }

  // Answers may be out of date once a post is added or edited, so the cache
  // is emptied whenever the blog's /index.json changes.
  private async dropIfPostsChanged(): Promise<void> {
    if (Date.now() - this.versionCheckedAt < VERSION_CHECK_MS) return;

    let version: string;
    try {
      const res = await fetch(new URL("/index.json", this.blogUrl).toString());
      if (!res.ok) return;
      const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
      version = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return;
    }
    this.versionCheckedAt = Date.now();

    const stored = this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'posts_version'")
      .toArray()[0]?.value;
    if (stored === version) return;

    if (stored !== undefined) console.log("Blog posts changed; clearing cached answers");
    this.sql.exec("DELETE FROM answers");
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('posts_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      version,
    );
    this.entries = [];
  }
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
