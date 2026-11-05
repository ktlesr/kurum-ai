// Content search over the shared folder: every readable file's text, cut into the same sections the chats read
// (lib/chunk), kept in Postgres full-text search (lib/doc-indexer fills it in the background). This file is the pure
// part: what goes into the index, how a question becomes a query, how hits are ranked and shown, and the two SQL
// statements, given a client: node --test covers it, tests/doc-index-eval.test.ts against a real Postgres.
import type postgres from "postgres";
import { chunkText } from "./chunk.ts";
import { FORGET_AFTER_MS } from "./folder-scan.ts";
import { words } from "./file-search.ts";
import { foldTr } from "./gallery-search.ts";
import type { ToolDef } from "./provider.ts";

/** Bump when what goes into a row changes: every file is indexed again. */
export const INDEXING = "i2"; // i2: workbooks read with their Excel row numbers

export interface IndexRow { ord: number; label: string; body: string; pathFold: string; bodyFold: string }

/**
 * One row per section, with the folded text Postgres indexes (simple config: no language rules, we fold ourselves).
 * NUL is taken out: a PDF's text can hold it, and Postgres text can't.
 */
export function indexRows(path: string, text: string): IndexRow[] {
  const pathFold = foldTr(path.replace(/[/_.-]+/gu, " "));
  return chunkText(path, text.replace(/\u0000/gu, "")).map((c, ord) => ({ ord, label: c.label, body: c.text, pathFold, bodyFold: foldTr(`${c.label} ${c.text}`) }));
}

/** Endings, folded, longest first: plural, possessive, case, the passive participle ("gönder-ilen"). */
const ENDINGS = ["larindan", "lerinden", "larinda", "lerinde", "larini", "lerini", "larin", "lerin", "lari", "leri", "lar", "ler", "ilen", "ulan", "inda", "inde", "unda", "unde", "ndan", "nden", "nin", "nun", "dan", "den", "nda", "nde", "yla", "yle", "ya", "ye", "si", "su", "da", "de", "in", "un", "a", "e", "i", "u"];

/**
 * A folded word's searched start: endings taken off (a few rounds, never below four letters), then a last consonant that softens
 * consonant ("bakanlığ-a" → "bakanli", which "bakanlık" and "bakanlığı" both start with). Searched as a prefix, so what
 * is left too long still finds its word. ponytail: a light suffix stripper, not a morphological analyser (Zemberek);
 * add one if the eval shows misses this can't fix.
 */
export function stem(w: string): string {
  if (/^\d+$/u.test(w)) return w;
  let s = w;
  for (let round = 0; round < 3; round++) {
    const end = ENDINGS.find((e) => s.endsWith(e) && s.length - e.length >= 4);
    if (!end) break;
    s = s.slice(0, -end.length);
  }
  return s.length >= 5 && /[gdbckpt]$/u.test(s) ? s.slice(0, -1) : s;
}

/** The searched stems of a question: its words (lib/file-search, without the asking ones), each by its start. */
export function stems(question: string): string[] {
  return [...new Set(words(question).map(stem))].slice(0, 12);
}

/** to_tsquery text: every stem as a prefix. Only [a-z0-9] reach it (stems are folded words), so no query syntax can. */
export function tsQuery(st: string[], op: "&" | "|"): string {
  return st.map((s) => s.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).map((s) => `${s}:*`).join(` ${op} `);
}

export interface Hit { fileId: string; path: string; label: string; body: string; pathFold: string; bodyFold: string; rank: number }

const has = (fold: string, s: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${s}`, "u").test(fold);

/**
 * Files best first: a file counts by its best section; a section by how many of the asked stems it (or its file's path)
 * holds, then by Postgres' rank. A file's own name and folders count: "Bakanlığa Giden/2026" names every file under it.
 */
export function rankFiles(hits: Hit[], st: string[], max = 8): { path: string; fileId: string; sections: Hit[] }[] {
  const scored = hits.map((h) => ({ h, n: st.filter((s) => has(h.bodyFold, s) || has(h.pathFold, s)).length }));
  scored.sort((a, b) => b.n - a.n || b.h.rank - a.h.rank);
  const files = new Map<string, { path: string; fileId: string; sections: Hit[] }>();
  for (const { h } of scored) {
    const f = files.get(h.fileId) ?? files.set(h.fileId, { path: h.path, fileId: h.fileId, sections: [] }).get(h.fileId)!;
    if (f.sections.length < 2) f.sections.push(h);
  }
  return [...files.values()].slice(0, max);
}

/** The part of a section around the asked words, on the original text (folding keeps the length of Turkish letters). */
export function snippet(body: string, st: string[], size = 420): string {
  const fold = foldTr(body);
  // foldTr maps one letter to one letter except "i̇" (two code units → one): positions are only approximate then, fine.
  const at = st.map((s) => fold.search(new RegExp(`(^|[^\\p{L}\\p{N}])${s}`, "u"))).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(at - Math.round(size / 3), body.length - size));
  const cut = body.slice(start, start + size).replace(/\s+/gu, " ").trim();
  return `${start > 0 ? "…" : ""}${cut}${start + size < body.length ? "…" : ""}`;
}

export interface Coverage { indexed: number; total: number; failed: number }

/** What the model reads back: where each file was found and the words around it, and how much of the folder is in. */
export function hitsText(question: string, files: ReturnType<typeof rankFiles>, st: string[], cov: Coverage): string {
  const scope =
    cov.indexed < cov.total
      ? `Dizin: görebildiğin ${cov.total} okunabilir dosyanın ${cov.indexed} tanesi tarandı${cov.failed ? `, ${cov.failed} tanesi okunamadı` : ""}; taranmamış dosyaların içeriği bu aramada yok, "hepsine baktım" deme.`
      : `Dizin: görebildiğin ${cov.total} okunabilir dosyanın tamamı tarandı${cov.failed ? ` (${cov.failed} tanesi okunamadı)` : ""}.`;
  if (!files.length) return `İçerik araması ("${question}"): eşleşen bölüm yok. ${scope} Başka kelimelerle (eş anlamlılarla) bir kez daha aranabilir.`;
  const blocks = files.map((f, i) =>
    [`${i + 1}. ${f.path}`, ...f.sections.map((s) => `   [${s.label}] ${snippet(s.body, st).replace(/\n/gu, " ")}`)].join("\n"),
  );
  return [`İçerik araması ("${question}"): ${files.length} dosyada eşleşme, en uygun önce. ${scope}`, "", ...blocks].join("\n");
}

export const CONTENT_TOOL: ToolDef = {
  name: "belge_ara",
  description:
    "Kurumun ortak klasöründeki dosyaların İÇİNDE (metin, tablo hücreleri) arar; yalnızca kullanıcının görebildikleri. Hangi dosyanın hangi sayfasında ya da tablo sayfasında geçtiğini ve çevresindeki metni döndürür.",
  parameters: {
    type: "object",
    properties: {
      sorgu: { type: "string", description: "Belgenin içinde geçmesi beklenen kelimeler; eş anlamlıları da ekle (ör. \"Kütahya istihdam 2026\", \"giden gönderilen yazı bakanlık\")" },
    },
    required: ["sorgu"],
  },
};

export const CONTENT_RULE = `\n\nOrtak klasördeki belgelerin içinde geçen bir bilgiyi (bir rakam, isim, konu, hangi belgede geçtiği) aramak için belge_ara aracını kullan; dosyanın adını ya da tarihini arıyorsan dosya_ara'yı. Sonuçtaki alıntılar belgenin kendi metnidir: cevabı onlara dayandır, dosya yolunu ve [sayfa/bölüm] yerini yaz. Alıntıda olmayan bilgiyi uydurma; ayrıntı gerekiyorsa kullanıcıya dosyanın adını yazarak sormasını ya da belgeyi yan menüden seçmesini söyle.`;

/** The model's arguments read safely. */
export function contentArgs(args: string): string | { error: string } {
  let a: unknown;
  try {
    a = JSON.parse(args || "{}");
  } catch {
    return { error: "HATA: argümanlar JSON olarak okunamadı." };
  }
  const q = a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>).sorgu : undefined;
  if (typeof q !== "string" || !stems(q).length) return { error: "HATA: sorgu boş; belgede geçmesi beklenen kelimeleri yaz." };
  return q.slice(0, 300);
}

/** A file's sections replace its old ones, and its mark says which version they are: one transaction, never half of each. */
export async function storeFile(sql: postgres.Sql, fileId: string, version: string, rows: IndexRow[]) {
  const pathFold = rows[0]?.pathFold ?? "";
  await sql.begin(async (tx) => {
    await tx`DELETE FROM doc_sections WHERE file_id = ${fileId}`;
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      await tx`
        INSERT INTO doc_sections (file_id, ord, label, body, tsv)
        SELECT ${fileId}, t.o, t.l, t.b, setweight(to_tsvector('simple', ${pathFold}), 'A') || to_tsvector('simple', t.f)
        FROM unnest(${tx.array(part.map((r) => r.ord))}::int[], ${tx.array(part.map((r) => r.label))}::text[], ${tx.array(part.map((r) => r.body))}::text[], ${tx.array(part.map((r) => r.bodyFold))}::text[]) AS t(o, l, b, f)`;
    }
    await tx`
      INSERT INTO doc_files (file_id, version, status, error, fails) VALUES (${fileId}, ${version}, 'ok', NULL, 0)
      ON CONFLICT (file_id) DO UPDATE SET version = EXCLUDED.version, status = 'ok', error = NULL, fails = 0, at = now()`;
  });
}

type Row = { file_id: string; label: string; body: string; rank: number };
async function query(sql: postgres.Sql, ids: string[], q: string): Promise<Row[]> {
  if (!ids.length || !q) return [];
  return sql<Row[]>`
    SELECT file_id, label, body, rank FROM (
      SELECT s.file_id, s.label, s.body, ts_rank(s.tsv, q) AS rank,
        row_number() OVER (PARTITION BY s.file_id ORDER BY ts_rank(s.tsv, q) DESC) AS n
      FROM doc_sections s, to_tsquery('simple', ${q}) q
      WHERE s.tsv @@ q AND s.file_id = ANY(${sql.array(ids)}::text[])
    ) t
    -- A few sections per file: a long file matching through its folder name can't fill the list on its own.
    WHERE n <= 3 ORDER BY rank DESC LIMIT 300`;
}

/**
 * Search over the given files only (id → path: what this person may see, at its indexed version). Every asked stem in a
 * section first; when that finds few files, any of them too. `verify` (the live check of lib/doc-indexer) gets the best
 * files, twice as many as shown, and says which are still as indexed: only those are shown.
 */
export async function searchFiles(sql: postgres.Sql, files: Map<string, string>, question: string, cov: Coverage, max = 8, verify?: (ids: string[]) => Promise<Set<string>>) {
  const st = stems(question);
  const ids = [...files.keys()];
  const toHits = (rows: Row[]): Hit[] =>
    rows.flatMap((r) => {
      const p = files.get(r.file_id);
      return p ? [{ fileId: r.file_id, path: p, label: r.label, body: r.body, pathFold: foldTr(p), bodyFold: foldTr(`${r.label} ${r.body}`), rank: Number(r.rank) }] : [];
    });
  let hits = toHits(await query(sql, ids, tsQuery(st, "&")));
  if (st.length > 1 && new Set(hits.map((h) => h.fileId)).size < max) {
    const seen = new Set(hits.map((h) => `${h.fileId}:${h.label}:${h.body.length}`));
    hits = [...hits, ...toHits(await query(sql, ids, tsQuery(st, "|"))).filter((h) => !seen.has(`${h.fileId}:${h.label}:${h.body.length}`))];
  }
  const best = rankFiles(hits, st, verify ? max * 2 : max);
  const ok = verify && best.length ? await verify(best.map((f) => f.fileId)) : null;
  const found = (ok ? best.filter((f) => ok.has(f.fileId)) : best).slice(0, max);
  return { files: found, text: hitsText(question, found, st, cov) };
}

/**
 * Someone waits for what a background read holds: a Docling run (an upload, a chat opening a file) or a model slot (a
 * chat answering). The read's own calls, run asBackground (lib/limits), are never counted: "in use", or its own vision
 * calls queued behind each other, would be the read itself. The read then stops and is done again later.
 * ponytail: a chat that finds a slot free runs beside the read's vision call meanwhile; fine at two slots.
 */
export const someoneWaits = (docling: { queued: number }, model: { queued: number }) => docling.queued > 0 || model.queued > 0;

/**
 * The share's own rule for what is gone (lib/folder-scan): given the files of a scan that may be taken as the folder's
 * contents, the others are marked missing (since now, if not already); back in the folder, the mark goes; missing for
 * FORGET_AFTER_MS, the file's sections and mark are deleted. Returns the deleted ids.
 */
export async function forgetGone(sql: postgres.Sql, live: string[], now = new Date()): Promise<string[]> {
  return sql.begin(async (tx) => {
    const ids = tx.array(live);
    await tx`UPDATE doc_files SET gone_since = NULL WHERE gone_since IS NOT NULL AND file_id = ANY(${ids}::text[])`;
    await tx`UPDATE doc_files SET gone_since = ${now} WHERE gone_since IS NULL AND NOT (file_id = ANY(${ids}::text[]))`;
    const old = await tx<{ file_id: string }[]>`
      DELETE FROM doc_files WHERE gone_since <= ${new Date(now.getTime() - FORGET_AFTER_MS)} RETURNING file_id`;
    const gone = old.map((r) => r.file_id);
    if (gone.length) await tx`DELETE FROM doc_sections WHERE file_id = ANY(${tx.array(gone)}::text[])`;
    return gone;
  });
}
