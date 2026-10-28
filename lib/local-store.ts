// Local workspace (plan §4.2): chats live in this browser's IndexedDB, one database per user, never on the server.
// Pure helpers (backup parsing, merge, search) are separate from the thin IndexedDB layer so node --test covers them.
import type { ChatMeta } from "./context";

/** Bump with a new step in `upgrade` whenever the stored shape changes. */
export const SCHEMA_VERSION = 1;
const BACKUP_KIND = "kurum-ai-yedek";
/** Untrusted file: caps so a hostile or broken backup can't lock the tab. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_CHATS = 5000;

export interface Message {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  meta?: ChatMeta;
  status?: string;
  /** Live answer only: when the question was sent (ms), for the waiting counter. */
  startedAt?: number;
  /** Seconds until the first word and until the answer was complete. */
  timing?: { first?: number; total: number };
}

export interface StoredChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  model?: string;
  /** Server doc ids that were in context, for the record. */
  docIds: string[];
  messages: Message[];
}

export interface Backup {
  kind: typeof BACKUP_KIND;
  schema: number;
  exportedAt: number;
  chats: StoredChat[];
}

export const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || "Yeni sohbet";
};

/** Pinned first, then most recently used. */
export const sortChats = (chats: StoredChat[]) =>
  [...chats].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);

/** Case- and dotted-i-insensitive substring search over titles and message text. */
export function searchChats(chats: StoredChat[], q: string): StoredChat[] {
  const norm = (s: string) => s.toLocaleLowerCase("tr");
  const needle = norm(q.trim());
  if (!needle) return chats;
  return chats.filter((c) => norm(c.title).includes(needle) || c.messages.some((m) => norm(m.content).includes(needle)));
}

export const makeBackup = (chats: StoredChat[]): Backup => ({ kind: BACKUP_KIND, schema: SCHEMA_VERSION, exportedAt: Date.now(), chats });

const isMessage = (m: unknown): m is Message => {
  const x = m as Message;
  return !!x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string";
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);

/** Rebuilt from known fields only; anything malformed is dropped (the answer stays, its notes go). */
const secs = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
function cleanTiming(t: unknown): Message["timing"] {
  if (typeof t !== "object" || t === null) return undefined;
  const { first, total } = t as Record<string, unknown>;
  return secs(total) ? { total, ...(secs(first) ? { first } : {}) } : undefined;
}

/** A page link from a backup: a parseable http(s) URL, or it's dropped (the page shows and opens it). */
const webUrl = (u: unknown): u is string => {
  if (typeof u !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(u).protocol);
  } catch {
    return false;
  }
};

function cleanMeta(m: unknown): ChatMeta | undefined {
  const x = m as Partial<ChatMeta> | null;
  if (!x || typeof x !== "object" || !["full", "rag", "scan", "truncated"].includes(x.mode as string)) return undefined;
  return {
    mode: x.mode!,
    sources: strings(x.sources),
    unverified: strings(x.unverified),
    uncertain: strings(x.uncertain),
    ...(typeof x.note === "string" ? { note: x.note } : {}),
    ...(Array.isArray(x.web) ? { web: x.web.filter((w) => webUrl(w?.url)).map((w) => ({ url: w.url, title: typeof w.title === "string" ? w.title : "" })) } : {}),
  };
}

/** A backup file is untrusted input: validate every record, keep only known fields. Error text is user-facing. */
export function parseBackup(text: string): StoredChat[] | string {
  if (text.length > MAX_BACKUP_BYTES) return "Yedek dosyası çok büyük.";
  let j: Partial<Backup>;
  try {
    j = JSON.parse(text);
  } catch {
    return "Dosya okunamadı (geçerli bir yedek değil).";
  }
  if (j?.kind !== BACKUP_KIND || !Array.isArray(j.chats)) return "Bu dosya bir Kurum AI yedeği değil.";
  if (typeof j.schema !== "number" || j.schema > SCHEMA_VERSION) return "Yedek bu sürümden daha yeni bir sürümle alınmış.";
  if (j.chats.length > MAX_CHATS) return "Yedekte çok fazla sohbet var.";
  const out = new Map<string, StoredChat>();
  for (const c of j.chats) {
    if (!c || typeof c.id !== "string" || typeof c.title !== "string" || !Number.isFinite(c.createdAt) || !Number.isFinite(c.updatedAt) || !Array.isArray(c.messages) || !c.messages.every(isMessage)) {
      return "Yedekte bozuk bir sohbet kaydı var; hiçbir şey içe aktarılmadı.";
    }
    // The same id twice: keep the newest copy.
    if ((out.get(c.id)?.updatedAt ?? -Infinity) >= c.updatedAt) continue;
    out.set(c.id, {
      id: c.id,
      title: c.title.slice(0, 200),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      pinned: !!c.pinned,
      model: typeof c.model === "string" ? c.model : undefined,
      docIds: Array.isArray(c.docIds) ? c.docIds.filter((d): d is string => typeof d === "string") : [],
      // Drop transient fields (status) and keep meta only as stored.
      messages: c.messages.map(({ role, content, error, meta, timing }) => {
        const m = cleanMeta(meta);
        const t = cleanTiming(timing);
        return { role, content, ...(error ? { error: true } : {}), ...(m ? { meta: m } : {}), ...(t ? { timing: t } : {}) };
      }),
    });
  }
  return [...out.values()];
}

/** Restore merges: a chat is written only if it is new here or the backup's copy is newer. Nothing is deleted. */
export function mergeChats(existing: StoredChat[], incoming: StoredChat[]): StoredChat[] {
  const have = new Map(existing.map((c) => [c.id, c.updatedAt]));
  return incoming.filter((c) => !have.has(c.id) || c.updatedAt > have.get(c.id)!);
}

// --- IndexedDB (browser only) ---

const STORE = "chats";

/** Schema steps, each run once per database in order. Version 1: the chats store. */
function upgrade(db: IDBDatabase, from: number) {
  if (from < 1) db.createObjectStore(STORE, { keyPath: "id" });
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((ok, fail) => { tx.oncomplete = () => ok(); tx.onerror = tx.onabort = () => fail(tx.error); });

export interface LocalStore {
  list(): Promise<StoredChat[]>;
  get(id: string): Promise<StoredChat | undefined>;
  remove(id: string): Promise<void>;
  /** Read-modify-write in one transaction: concurrent edits (rename, pin, another tab) aren't overwritten by a stale copy. */
  upsert(id: string, fn: (cur: StoredChat | undefined) => StoredChat): Promise<void>;
  /** Restore: compare and write in one transaction, all or nothing. Returns what was written. */
  mergeIn(incoming: StoredChat[]): Promise<StoredChat[]>;
}

/** One database per user: a shared browser profile never mixes two accounts' chats. */
export async function openStore(user: string): Promise<LocalStore> {
  const open = indexedDB.open(`kurum-ai:${user}`, SCHEMA_VERSION);
  open.onupgradeneeded = (e) => upgrade(open.result, e.oldVersion);
  const db = await req(open);
  // Another tab opened a newer schema: let it upgrade, this tab reloads.
  db.onversionchange = () => { db.close(); location.reload(); };
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode);
  /** Runs `work` inside a readwrite transaction; any throw aborts it, so nothing partial is committed. */
  const write = async (work: (s: IDBObjectStore, t: IDBTransaction) => void) => {
    const t = tx("readwrite");
    const finished = done(t);
    try {
      work(t.objectStore(STORE), t);
    } catch (e) {
      t.abort();
      await finished.catch(() => {});
      throw e;
    }
    await finished;
  };
  return {
    list: () => req(tx("readonly").objectStore(STORE).getAll() as IDBRequest<StoredChat[]>),
    get: (id) => req(tx("readonly").objectStore(STORE).get(id) as IDBRequest<StoredChat | undefined>),
    remove: (id) => write((s) => s.delete(id)),
    upsert: (id, fn) =>
      write((s, t) => {
        const g = s.get(id);
        g.onsuccess = () => {
          try {
            s.put(fn(g.result as StoredChat | undefined));
          } catch {
            t.abort();
          }
        };
      }),
    async mergeIn(incoming) {
      let fresh: StoredChat[] = [];
      await write((s, t) => {
        const all = s.getAll();
        all.onsuccess = () => {
          try {
            fresh = mergeChats(all.result as StoredChat[], incoming);
            for (const c of fresh) s.put(c);
          } catch {
            t.abort();
          }
        };
      });
      return fresh;
    },
  };
}

export const isQuotaError = (e: unknown) => e instanceof DOMException && e.name === "QuotaExceededError";
