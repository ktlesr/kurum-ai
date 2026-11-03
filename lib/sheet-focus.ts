// A question about one district of the agency's region (TR33: Afyonkarahisar, Kütahya, Manisa, Uşak) needs only that
// district's rows: the support workbooks run to millions of characters, read whole they take the model many minutes.
// Rules from the agency (user, 2026-11-03): the "İcmal" sheets are province totals over grouped district rows, out of
// scope for a district question; filters and row/column groups are only how the file was last viewed (the İlçe column
// itself sits in a hidden group), so every row and column is read. No "server-only": the test drives it.

const DISTRICTS: Record<string, string[]> = {
  Afyonkarahisar: ["Başmakçı", "Bayat", "Bolvadin", "Çay", "Çobanlar", "Dazkırı", "Dinar", "Emirdağ", "Evciler", "Hocalar", "İhsaniye", "İscehisar", "Kızılören", "Sandıklı", "Sinanpaşa", "Sultandağı", "Şuhut"],
  Kütahya: ["Altıntaş", "Aslanapa", "Çavdarhisar", "Domaniç", "Dumlupınar", "Emet", "Gediz", "Hisarcık", "Pazarlar", "Simav", "Şaphane", "Tavşanlı"],
  Manisa: ["Ahmetli", "Akhisar", "Alaşehir", "Demirci", "Gölmarmara", "Gördes", "Kırkağaç", "Köprübaşı", "Kula", "Salihli", "Sarıgöl", "Saruhanlı", "Selendi", "Soma", "Şehzadeler", "Turgutlu", "Yunusemre"],
  Uşak: ["Banaz", "Eşme", "Karahallı", "Sivaslı", "Ulubey"],
};
/** Also an everyday word or another thing's name: a district only when the request says it is about districts. */
const AMBIGUOUS = new Set(["Bayat", "Çay", "Dinar", "Emet", "Gediz", "Kula", "Soma", "Pazarlar", "Hocalar", "Evciler", "Demirci"]);
const PROVINCE_NAMES: [string, string][] = [["Afyonkarahisar", "Afyonkarahisar"], ["Afyon", "Afyonkarahisar"], ["Kütahya", "Kütahya"], ["Manisa", "Manisa"], ["Uşak", "Uşak"]];

export interface Place { il: string; ilce: string }
/** Sheets of totals, not of projects: "İcmal" (province totals over grouped district rows) and "Genel Analiz" (each district's totals across programmes, headed by programme names, not columns). */
const SUMMARY = /icmal|genel analiz/;

const low = (s: string) => s.toLocaleLowerCase("tr");
/** The name as a word: not inside another word; a suffix only after an apostrophe ("Banaz'a"), as Turkish writes it. */
const nameAt = (text: string, name: string) => new RegExp(`(?<!\\p{L})${low(name)}(?![\\p{L}])`, "gu");

/** The districts the request asks about, with their province. */
export function districtsAsked(request: string): Place[] {
  const q = low(request);
  const aboutDistricts = /(?<!\p{L})ilçe/u.test(q);
  const out: Place[] = [];
  for (const [il, names] of Object.entries(DISTRICTS)) {
    for (const ilce of names) {
      for (const m of q.matchAll(nameAt(q, ilce))) {
        // Written as a name (capital first letter in what the user typed), or the request is about districts.
        const typed = request.slice(m.index, m.index + ilce.length);
        const asName = typed[0] !== low(typed[0]);
        if ((asName && !AMBIGUOUS.has(ilce)) || aboutDistricts) {
          out.push({ il, ilce });
          break;
        }
      }
    }
  }
  // "Merkez" is a district of every province: only with the province named right before it ("Uşak Merkez", "Uşak merkez ilçesi").
  for (const [name, il] of PROVINCE_NAMES) {
    if (new RegExp(`(?<!\\p{L})${low(name)}(?:'[\\p{L}]+)?\\s+merkez`, "u").test(q) && !out.some((p) => p.il === il && p.ilce === "Merkez")) out.push({ il, ilce: "Merkez" });
  }
  return out;
}

/** A table row's cells, as lib/parse writes them ("| a | b |", a "|" inside a cell escaped). */
const cellsOf = (line: string) => line.slice(1, -1).split(/(?<!\\)\|/).map((c) => low(c.replace(/\\\|/g, "|").trim()));

/** A workbook's rows that `match`, each sheet with its title and header; sheets with none go. */
function keepRows(text: string, match: (cells: string[]) => boolean, skip: (sheet: string) => boolean = () => false) {
  const kept: string[] = [];
  let rows = 0;
  for (const part of text.split(/(?=^## Sheet: )/m)) {
    if (!part.startsWith("## Sheet: ")) continue; // nothing comes before the first sheet
    if (skip(low(part.slice(10, part.indexOf("\n") >>> 0).trim()))) continue;
    const lines = part.split("\n");
    const table = lines.findIndex((l) => l.startsWith("|"));
    if (table < 0) continue;
    const found = lines.slice(table + 2).filter((l) => l.startsWith("|") && match(cellsOf(l)));
    if (!found.length) continue;
    rows += found.length;
    // The sheet's title and column names, its header and the rows; the totals check under the table was for all rows.
    const head = lines.slice(0, table).filter((l) => !l.startsWith("Satır: "));
    kept.push([...head, lines[table], lines[table + 1], ...found].join("\n"));
  }
  return { kept, rows };
}

/**
 * The workbook text (lib/parse: "## Sheet:" parts, one table each) with only the asked districts' rows: İcmal sheets
 * out, each other sheet's header kept, a row in when one of its cells is the district (for "Merkez" its province too).
 * Sheets with no such row go. Null when nothing matched (not a workbook, or the district isn't in it): read it whole.
 */
export function focusSheets(text: string, places: Place[]): string | null {
  if (!places.length || !/^## Sheet: /m.test(text)) return null;
  const want = places.map((p) => ({ il: low(p.il), ilce: low(p.ilce), merkez: p.ilce === "Merkez" }));
  const { kept, rows } = keepRows(text, (cells) => want.some((w) => cells.includes(w.ilce) && (!w.merkez || cells.includes(w.il))), (n) => SUMMARY.test(n));
  if (!rows) return null;
  const asked = places.map((p) => `${p.ilce} (${p.il})`).join(", ");
  return `> [Kod kontrolü] Belgeden yalnızca ${asked} satırları verildi (${rows} satır; gizli satır ve sütunlar dahil). İcmal ve Genel Analiz sayfaları toplam olduğu için ilçe sorusunda kapsam dışı.\n\n${kept.join("\n\n")}`;
}

/** The question in the document's terms: the model's reading of it from general knowledge (chat route UNDERSTAND). */
export interface Reading { meaning: string; names: string[] }

/** The model's {"anlam","adlar"} answer; anything else is no reading. Names are bounded: they become search terms. */
export function parseReading(raw: string): Reading | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const j = JSON.parse(json) as { anlam?: unknown; adlar?: unknown };
    const names = Array.isArray(j.adlar) ? j.adlar.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 60) : [];
    return { meaning: typeof j.anlam === "string" ? j.anlam.trim().slice(0, 500) : "", names: [...new Set(names)].slice(0, 40) };
  } catch {
    return null;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The workbook's rows about the named things (a cell holds the name as a word: "Uşak", "Uşak-64", "UŞAK İL TOPLAMI"),
 * every sheet kept. For a question about a few places or products in a workbook too big to read whole: all their rows,
 * not the few chunks a keyword search would pick. Null when nothing matched: read as before.
 */
export function rowsNamed(text: string, names: string[]): string | null {
  if (!names.length || !/^## Sheet: /m.test(text)) return null;
  const res = names.map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(low(n))}(?![\\p{L}])`, "u"));
  const { kept, rows } = keepRows(text, (cells) => cells.some((c) => res.some((r) => r.test(c))));
  if (!rows) return null;
  return `> [Kod kontrolü] Belge bağlama sığmadığı için yalnızca şu adların geçtiği satırlar verildi: ${names.join(", ")} (${rows} satır; gizli satır ve sütunlar dahil).\n\n${kept.join("\n\n")}`;
}
