"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isQuotaError, makeBackup, MAX_BACKUP_BYTES, openStore, parseBackup, sortChats, type LocalStore, type StoredChat } from "@/lib/local-store";

const UNDO_MS = 8000;

/**
 * The user's chats in this browser (IndexedDB), kept in sync across tabs with a BroadcastChannel.
 * onChanged fires for every chat changed outside the normal send flow (another tab, a restore), so an open chat
 * can be reloaded.
 */
export function useChats(user: string, onChanged: (id: string) => void) {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredChat | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean; usage?: number; quota?: number } | null>(null);
  // Every write awaits this: a question sent before the database finished opening is still saved.
  const store = useRef<Promise<LocalStore> | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; });

  const reload = useCallback(async () => {
    const s = await store.current?.catch(() => null);
    if (s) setChats(sortChats(await s.list()));
  }, []);

  const refreshStorage = useCallback(async () => {
    if (!navigator.storage?.estimate) return;
    const [persisted, { usage, quota }] = await Promise.all([navigator.storage.persisted?.() ?? false, navigator.storage.estimate()]);
    setStorage({ persisted, usage, quota });
  }, []);

  useEffect(() => {
    const ch = new BroadcastChannel(`kurum-ai:${user}`);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<{ ids?: string[] }>) => {
      reload();
      for (const id of e.data.ids ?? []) changed.current(id);
    };
    store.current = openStore(user);
    store.current.then(
      () => { reload(); refreshStorage(); },
      () => setError("Tarayıcı depolaması açılamadı (gizli pencere ya da depolama kapalı olabilir). Sohbetler kaydedilmeyecek."),
    );
    return () => ch.close();
  }, [user, reload, refreshStorage]);

  /** Runs a write, reports failure in the banner, tells the other tabs which chats changed. */
  const write = useCallback(async (fn: (s: LocalStore) => Promise<void>, ids: string[]) => {
    try {
      const s = await store.current!;
      await fn(s);
      setError(null);
    } catch (e) {
      setError(isQuotaError(e) ? "Tarayıcı depolama alanı dolu: eski sohbetleri silin ya da yedek alıp temizleyin." : "Sohbet kaydedilemedi.");
      return false;
    }
    channel.current?.postMessage({ ids });
    reload();
    return true;
  }, [reload]);

  /** Read-modify-write of one chat; fn gets the stored copy (or undefined for a new chat). */
  const upsert = useCallback(async (id: string, fn: (cur: StoredChat | undefined) => StoredChat) => {
    const ok = await write((s) => s.upsert(id, fn), [id]);
    // First real save: ask the browser not to evict this origin's data under storage pressure.
    if (ok && storage && !storage.persisted) navigator.storage?.persist?.().then(refreshStorage, () => {});
    return ok;
  }, [write, storage, refreshStorage]);

  const patch = useCallback(
    (id: string, p: Partial<StoredChat>) => write((s) => s.upsert(id, (cur) => {
      if (!cur) throw new Error("gone");
      return { ...cur, ...p };
    }), [id]),
    [write],
  );

  /** Hidden at once, really deleted after the undo window. A closed tab in between keeps the chat (safe side). */
  const remove = useCallback((chat: StoredChat) => {
    clearTimeout(deleteTimer.current);
    if (pendingDelete) write((s) => s.remove(pendingDelete.id), [pendingDelete.id]);
    setPendingDelete(chat);
    setChats((cs) => cs.filter((c) => c.id !== chat.id));
    deleteTimer.current = setTimeout(() => {
      write((s) => s.remove(chat.id), [chat.id]);
      setPendingDelete(null);
    }, UNDO_MS);
  }, [pendingDelete, write]);

  const undoDelete = useCallback(() => {
    clearTimeout(deleteTimer.current);
    setPendingDelete(null);
    reload();
  }, [reload]);

  const exportBackup = useCallback(async () => {
    const s = await store.current?.catch(() => null);
    if (!s) return;
    const blob = new Blob([JSON.stringify(makeBackup(await s.list()))], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kurum-ai-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  /** Returns a user-facing result line. */
  const importBackup = useCallback(async (file: File): Promise<string> => {
    if (file.size > MAX_BACKUP_BYTES) return "Yedek dosyası çok büyük.";
    const parsed = parseBackup(await file.text());
    if (typeof parsed === "string") return parsed;
    let fresh: StoredChat[] = [];
    if (!(await write(async (s) => { fresh = await s.mergeIn(parsed); }, parsed.map((c) => c.id)))) return "Yedek yüklenemedi.";
    // This tab too: an open chat that the backup replaced must show the restored version.
    for (const c of fresh) changed.current(c.id);
    refreshStorage();
    return `${fresh.length} sohbet geri yüklendi${parsed.length > fresh.length ? ` (${parsed.length - fresh.length} tanesi zaten güncel)` : ""}.`;
  }, [write, refreshStorage]);

  const get = useCallback(async (id: string) => (await store.current?.catch(() => null))?.get(id), []);

  return { chats, error, storage, pendingDelete, upsert, patch, remove, undoDelete, exportBackup, importBackup, get };
}
