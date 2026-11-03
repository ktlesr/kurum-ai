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

/**
 * The workbook text (lib/parse: "## Sheet:" parts, one table each) with only the asked districts' rows: İcmal sheets
 * out, each other sheet's header kept, a row in when one of its cells is the district (for "Merkez" its province too).
 * Sheets with no such row go. Null when nothing matched (not a workbook, or the district isn't in it): read it whole.
 */
export function focusSheets(text: string, places: Place[]): string | null {
  if (!places.length || !/^## Sheet: /m.test(text)) return null;
  const want = places.map((p) => ({ il: low(p.il), ilce: low(p.ilce), merkez: p.ilce === "Merkez" }));
  const kept: string[] = [];
  let rows = 0;
  for (const part of text.split(/(?=^## Sheet: )/m)) {
    if (!part.startsWith("## Sheet: ")) continue; // nothing comes before the first sheet
    const name = part.slice(10, part.indexOf("\n") >>> 0).trim();
    if (SUMMARY.test(low(name))) continue;
    const lines = part.split("\n");
    const table = lines.findIndex((l) => l.startsWith("|"));
    if (table < 0) continue;
    const match = lines.slice(table + 2).filter((l) => {
      if (!l.startsWith("|")) return false;
      const cells = cellsOf(l);
      return want.some((w) => cells.includes(w.ilce) && (!w.merkez || cells.includes(w.il)));
    });
    if (!match.length) continue;
    rows += match.length;
    // The sheet's title and column names, its header and the rows; the totals check under the table was for all rows.
    const head = lines.slice(0, table).filter((l) => !l.startsWith("Satır: "));
    kept.push([...head, lines[table], lines[table + 1], ...match].join("\n"));
  }
  if (!rows) return null;
  const asked = places.map((p) => `${p.ilce} (${p.il})`).join(", ");
  return `> [Kod kontrolü] Belgeden yalnızca ${asked} satırları verildi (${rows} satır; gizli satır ve sütunlar dahil). İcmal ve Genel Analiz sayfaları toplam olduğu için ilçe sorusunda kapsam dışı.\n\n${kept.join("\n\n")}`;
}
