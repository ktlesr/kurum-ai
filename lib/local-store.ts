// Local workspace (plan §4.2): chats live in this browser's IndexedDB, one database per user, never on the server.
// Pure helpers (backup parsing, merge, search) are separate from the thin IndexedDB layer so node --test covers them.
import type { ChatMeta } from "./context";

/** Bump with a new step in `upgrade` whenever the stored shape changes. */
export const SCHEMA_VERSION = 1;
const BACKUP_KIND = "kurum-ai-yedek";

export interface Message {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  meta?: ChatMeta;
  status?: string;
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

/** A backup file is untrusted input: validate every record, keep only known fields. Error text is user-facing. */
export function parseBackup(text: string): StoredChat[] | string {
  let j: Partial<Backup>;
  try {
    j = JSON.parse(text);
  } catch {
    return "Dosya okunamadı (geçerli bir yedek değil).";
  }
  if (j?.kind !== BACKUP_KIND || !Array.isArray(j.chats)) return "Bu dosya bir Kurum AI yedeği değil.";
  if (typeof j.schema !== "number" || j.schema > SCHEMA_VERSION) return "Yedek bu sürümden daha yeni bir sürümle alınmış.";
  const out: StoredChat[] = [];
  for (const c of j.chats) {
    if (!c || typeof c.id !== "string" || typeof c.title !== "string" || !Number.isFinite(c.createdAt) || !Number.isFinite(c.updatedAt) || !Array.isArray(c.messages) || !c.messages.every(isMessage)) {
      return "Yedekte bozuk bir sohbet kaydı var; hiçbir şey içe aktarılmadı.";
    }
    out.push({
      id: c.id,
      title: c.title.slice(0, 200),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      pinned: !!c.pinned,
      model: typeof c.model === "string" ? c.model : undefined,
      docIds: Array.isArray(c.docIds) ? c.docIds.filter((d): d is string => typeof d === "string") : [],
      // Drop transient fields (status) and keep meta only as stored.
      messages: c.messages.map(({ role, content, error, meta }) => ({ role, content, ...(error ? { error: true } : {}), ...(meta ? { meta } : {}) })),
    });
  }
  return out;
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
  put(chat: StoredChat): Promise<void>;
  remove(id: string): Promise<void>;
  /** Writes all of them in one transaction: all or nothing. */
  putMany(chats: StoredChat[]): Promise<void>;
}

/** One database per user: a shared browser profile never mixes two accounts' chats. */
export async function openStore(user: string): Promise<LocalStore> {
  const open = indexedDB.open(`kurum-ai:${user}`, SCHEMA_VERSION);
  open.onupgradeneeded = (e) => upgrade(open.result, e.oldVersion);
  const db = await req(open);
  // Another tab opened a newer schema: let it upgrade, this tab reloads.
  db.onversionchange = () => { db.close(); location.reload(); };
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode);
  return {
    list: () => req(tx("readonly").objectStore(STORE).getAll() as IDBRequest<StoredChat[]>),
    get: (id) => req(tx("readonly").objectStore(STORE).get(id) as IDBRequest<StoredChat | undefined>),
    async put(chat) {
      const t = tx("readwrite");
      t.objectStore(STORE).put(chat);
      await done(t);
    },
    async remove(id) {
      const t = tx("readwrite");
      t.objectStore(STORE).delete(id);
      await done(t);
    },
    async putMany(chats) {
      const t = tx("readwrite");
      for (const c of chats) t.objectStore(STORE).put(c);
      await done(t);
    },
  };
}

export const isQuotaError = (e: unknown) => e instanceof DOMException && e.name === "QuotaExceededError";
