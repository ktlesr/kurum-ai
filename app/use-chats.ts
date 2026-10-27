"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isQuotaError, makeBackup, mergeChats, openStore, parseBackup, sortChats, type LocalStore, type StoredChat } from "@/lib/local-store";

const UNDO_MS = 8000;

/**
 * The user's chats in this browser (IndexedDB), kept in sync across tabs with a BroadcastChannel.
 * onExternalChange fires when another tab changed a chat, so an open chat can be reloaded.
 */
export function useChats(user: string, onExternalChange: (id: string) => void) {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredChat | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean; usage?: number; quota?: number } | null>(null);
  const store = useRef<LocalStore | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const external = useRef(onExternalChange);
  useEffect(() => { external.current = onExternalChange; });

  const reload = useCallback(async () => {
    if (store.current) setChats(sortChats(await store.current.list()));
  }, []);

  const refreshStorage = useCallback(async () => {
    if (!navigator.storage?.estimate) return;
    const [persisted, { usage, quota }] = await Promise.all([navigator.storage.persisted?.() ?? false, navigator.storage.estimate()]);
    setStorage({ persisted, usage, quota });
  }, []);

  useEffect(() => {
    let alive = true;
    const ch = new BroadcastChannel(`kurum-ai:${user}`);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<{ id?: string }>) => {
      reload();
      if (e.data.id) external.current(e.data.id);
    };
    openStore(user)
      .then((s) => {
        if (!alive) return;
        store.current = s;
        reload();
        refreshStorage();
      })
      .catch(() => setError("Tarayıcı depolaması açılamadı (gizli pencere ya da depolama kapalı olabilir). Sohbetler kaydedilmeyecek."));
    return () => {
      alive = false;
      ch.close();
    };
  }, [user, reload, refreshStorage]);

  const write = useCallback(async (fn: (s: LocalStore) => Promise<void>, id?: string) => {
    if (!store.current) return false;
    try {
      await fn(store.current);
      setError(null);
    } catch (e) {
      setError(isQuotaError(e) ? "Tarayıcı depolama alanı dolu: eski sohbetleri silin ya da yedek alıp temizleyin." : "Sohbet kaydedilemedi.");
      return false;
    }
    channel.current?.postMessage({ id });
    reload();
    return true;
  }, [reload]);

  const save = useCallback(async (chat: StoredChat) => {
    const ok = await write((s) => s.put(chat), chat.id);
    // First real save: ask the browser not to evict this origin's data under storage pressure.
    if (ok && storage && !storage.persisted) navigator.storage?.persist?.().then(refreshStorage, () => {});
    return ok;
  }, [write, storage, refreshStorage]);

  const patch = useCallback(async (id: string, p: Partial<StoredChat>) => {
    const cur = await store.current?.get(id);
    if (cur) await write((s) => s.put({ ...cur, ...p }), id);
  }, [write]);

  /** Hidden at once, really deleted after the undo window. A closed tab in between keeps the chat (safe side). */
  const remove = useCallback((chat: StoredChat) => {
    clearTimeout(deleteTimer.current);
    if (pendingDelete) write((s) => s.remove(pendingDelete.id), pendingDelete.id);
    setPendingDelete(chat);
    setChats((cs) => cs.filter((c) => c.id !== chat.id));
    deleteTimer.current = setTimeout(() => {
      write((s) => s.remove(chat.id), chat.id);
      setPendingDelete(null);
    }, UNDO_MS);
  }, [pendingDelete, write]);

  const undoDelete = useCallback(() => {
    clearTimeout(deleteTimer.current);
    setPendingDelete(null);
    reload();
  }, [reload]);

  const exportBackup = useCallback(async () => {
    if (!store.current) return;
    const blob = new Blob([JSON.stringify(makeBackup(await store.current.list()))], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kurum-ai-yedek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  /** Returns a user-facing result line. */
  const importBackup = useCallback(async (file: File): Promise<string> => {
    if (!store.current) return "Tarayıcı depolaması açık değil.";
    const parsed = parseBackup(await file.text());
    if (typeof parsed === "string") return parsed;
    const fresh = mergeChats(await store.current.list(), parsed);
    if (!(await write((s) => s.putMany(fresh)))) return "Yedek yüklenemedi.";
    refreshStorage();
    return `${fresh.length} sohbet geri yüklendi${parsed.length > fresh.length ? ` (${parsed.length - fresh.length} tanesi zaten güncel)` : ""}.`;
  }, [write, refreshStorage]);

  const get = useCallback((id: string) => store.current?.get(id), []);

  return { chats, error, storage, pendingDelete, save, patch, remove, undoDelete, exportBackup, importBackup, get };
}
