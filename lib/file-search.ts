// The file finder: which files of the shared folder (and the user's own) a question is about, by name, folder and date —
// "ajans tanıtım klasöründeki en güncel sunum", "ekspertiz raporları en son ne zaman". Names and dates only: nothing is
// read, and only what the person may see is passed in (lib/library filesFor, the folder rules). Pure: tests drive it.

import { foldTr } from "./gallery-search.ts";
import type { ToolDef } from "./provider.ts";

export interface FileEntry {
  path: string;
  size: number;
  /** Last change, ms (the shared folder's file time); none for an upload. */
  mtime?: number;
  /** Its text can be read in a chat (a presentation, an old .doc or a file over the size limit is only listed). */
  readable: boolean;
}

export interface FileQuery { sorgu?: string; klasor?: string; siralama?: "yeni" | "ilgi" }

export const MAX_FOUND = 30;

/** Words about the asking, not the files. */
const STOP = new Set(["ile", "ilgili", "icin", "olan", "en", "son", "guncel", "yeni", "eski", "hangi", "hangisi", "hangileri", "ne", "zaman", "nerede", "var", "mi", "mu", "ve", "veya", "bir", "bu", "su", "ortak", "ortakta", "ortaktaki", "klasor", "klasoru", "klasorde", "klasorunde", "klasorundeki", "klasorleri", "klasorlerinde", "dosya", "dosyasi", "dosyalar", "dosyalari", "belge", "belgeler", "belgesi", "icinde", "icerisinde", "ara", "bul", "listele", "goster", "hazirlanan", "yapilan", "yapilmis"]);
const words = (s: string) => (foldTr(s).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => (w.length >= 3 || /^\d+$/u.test(w)) && !STOP.has(w));
/** "sunumu" finds "Sunum", "kooperatifinin" finds "Kooperatif": a path word at the start of the asked one, or the other way. */
const meets = (asked: string, have: string) => have.startsWith(asked) || (have.length >= 4 && asked.startsWith(have));

const day = (ms: number) => new Date(ms).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });
const sizeOf = (b: number) => (b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Files matching the words (most matched first, then newest), within a folder when one is named (every word of it in
 * the file's folders), or the newest first when asked so. A Markdown table for the model: path, date, size, readable.
 */
export function findFiles(all: readonly FileEntry[], q: FileQuery, max = MAX_FOUND): { text: string; count: number } {
  const asked = words(q.sorgu ?? "");
  const folder = words(q.klasor ?? "");
  const scored = all.flatMap((f) => {
    const dirs = f.path.split("/").slice(0, -1).flatMap(words);
    if (folder.length && !folder.every((w) => dirs.some((d) => meets(w, d)))) return [];
    // A word in the file's own name counts twice one only in its folders ("Sunum/…" names every file under it).
    const name = words(f.path.split("/").pop() ?? "");
    const score = asked.reduce((n, w) => n + (name.some((h) => meets(w, h)) ? 2 : dirs.some((h) => meets(w, h)) ? 1 : 0), 0);
    return asked.length && !score ? [] : [{ f, score }];
  });
  const newest = (a: { f: FileEntry }, b: { f: FileEntry }) => (b.f.mtime ?? 0) - (a.f.mtime ?? 0);
  scored.sort(q.siralama === "yeni" ? newest : (a, b) => b.score - a.score || newest(a, b));
  const shown = scored.slice(0, max);
  const asks = [q.sorgu && `"${q.sorgu}"`, q.klasor && `klasör "${q.klasor}"`].filter(Boolean).join(", ") || "tüm dosyalar";
  if (!shown.length) return { text: `Dosya arama (${asks}): eşleşen dosya yok. Başka kelimelerle ya da klasör adı vermeden yeniden aranabilir.`, count: 0 };
  const rows = shown.map(({ f }) => `| ${f.path.replace(/\|/gu, "\\|")} | ${f.mtime ? day(f.mtime) : "—"} | ${sizeOf(f.size)} | ${f.readable ? "evet" : "hayır"} |`);
  return {
    text: [
      `Dosya arama (${asks}): ${scored.length} dosya eşleşti${scored.length > max ? `, ilk ${max} tanesi` : ""}${q.siralama === "yeni" ? ", en yeni önce" : ""}.`,
      "",
      "| Yol | Son değiştirilme | Boyut | İçeriği okunabilir |",
      "| --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
    count: scored.length,
  };
}

/** dosya_ara as the plain chat runs it: the model's JSON read safely, then findFiles over what this person may see. */
export function filesCall(args: string, all: readonly FileEntry[]): string {
  let a: unknown;
  try {
    a = JSON.parse(args || "{}");
  } catch {
    return "HATA: argümanlar JSON olarak okunamadı.";
  }
  if (!a || typeof a !== "object" || Array.isArray(a)) return "HATA: argümanlar bir JSON nesnesi olmalı.";
  const o = a as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 300) : undefined);
  return findFiles(all, { sorgu: str("sorgu"), klasor: str("klasor"), siralama: o.siralama === "yeni" ? "yeni" : "ilgi" }).text;
}

export const FILES_TOOL: ToolDef = {
  name: "dosya_ara",
  description: "Kurumun ortak klasöründeki ve kullanıcının Belgelerim'deki dosyaları adına, klasörüne ve son değiştirilme tarihine göre arar (yalnızca kullanıcının görebildikleri). İçerik okumaz; yol, tarih, boyut ve içeriğin okunabilir olup olmadığını döndürür.",
  parameters: {
    type: "object",
    properties: {
      sorgu: { type: "string", description: "Dosya ya da klasör adında geçmesi beklenen kelimeler (ör. \"ekspertiz raporu\", \"cumhurbaşkanı yardımcısı sunum\")" },
      klasor: { type: "string", description: "Yalnızca bu klasörün altında ara (ör. \"Ajans Tanıtım ve Brifing/Sunum/2025\")" },
      siralama: { type: "string", enum: ["yeni", "ilgi"], description: "yeni: en son değişen önce; ilgi: en çok eşleşen önce" },
    },
  },
};

/** In the system turn of a plain chat while dosya_ara is offered. */
export const FILES_RULE = `\n\nKurumun ortak klasöründeki ve kullanıcının Belgelerim'deki dosyaların adlarını, klasörlerini ve son değiştirilme tarihlerini dosya_ara aracıyla arayabilirsin: bir dosyayı bulma, bir klasörde ne olduğu, en güncel ya da en son dosya gibi sorularda bu aracı kullan, "erişemem" deme. Bulamazsan başka kelimelerle ya da klasör vermeden bir kez daha ara. Dosyaların içeriğini buradan okuyamazsın; içerik gerekiyorsa kullanıcıya belgeyi yan menüden seçmesini söyle. Tarih, dosyanın son değiştirilme tarihidir; belgenin hazırlandığı tarih olmayabilir, bunu belirt. Sonuçtaki yolları olduğu gibi yaz.`;
