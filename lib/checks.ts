// Deterministic guards against misreads and hallucinated numbers. Pure functions, no imports.

const NUM = /-?\d+(?:[.,]\d+)*/g;

/**
 * Turkish first, English tolerated: "1.234,56" → "1234.56", "1.234.567" → "1234567", "1.234" → "1234",
 * "94,7" → "94.7", "1,234.56" → "1234.56", "12.5" → "12.5". With both separators the last one is the decimal.
 */
export function normNum(s: string): string {
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) return dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  // Grouped thousands: any dots ("1.234"), or several commas ("1,234,567"). One comma stays a decimal ("12,345").
  // A leading 0 is never a thousands group: "0.123" is a decimal.
  if (/^-?[1-9]\d{0,2}([.,]\d{3})+$/.test(s) && (dot >= 0 || s.indexOf(",") !== comma)) return s.replace(/[.,]/g, "");
  return s.replace(",", ".");
}

const toFloat = (s: string) => parseFloat(normNum(s));

/**
 * Two independent readings of the same image → numbers in `a` that `b` doesn't confirm get "(?)".
 * LCS over the number sequences, so an extra/missing row doesn't shift everything.
 */
export function markUncertain(a: string, b: string): { text: string; uncertain: number; total: number } {
  const ta = [...a.matchAll(NUM)];
  const tb = [...b.matchAll(NUM)].map((m) => normNum(m[0]));
  const na = ta.map((m) => normNum(m[0]));
  // ponytail: O(n·m) table; fine for a page strip (hundreds of numbers)
  const dp = Array.from({ length: na.length + 1 }, () => new Uint16Array(tb.length + 1));
  for (let i = na.length - 1; i >= 0; i--)
    for (let j = tb.length - 1; j >= 0; j--)
      dp[i][j] = na[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const bad = new Set<number>();
  for (let i = 0, j = 0; i < na.length; ) {
    if (j < tb.length && na[i] === tb[j]) { i++; j++; }
    else if (j < tb.length && dp[i][j + 1] > dp[i + 1][j]) j++;
    else bad.add(i++);
  }
  let text = "";
  let last = 0;
  ta.forEach((m, i) => {
    const end = m.index! + m[0].length;
    text += a.slice(last, end) + (bad.has(i) ? "(?)" : "");
    last = end;
  });
  return { text: text + a.slice(last), uncertain: bad.size, total: na.length };
}

type Row = string[];

function tables(md: string): { title: string; rows: Row[] }[] {
  const out: { title: string; rows: Row[] }[] = [];
  let title = "";
  let cur: Row[] | null = null;
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (t.startsWith("|")) {
      if (!cur) out.push({ title, rows: (cur = []) });
      if (!/^\|[\s:|-]+\|?$/.test(t)) cur.push(t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    } else {
      cur = null;
      if (t) title = t.replace(/^[#*\s]+|[*\s]+$/g, "");
    }
  }
  return out;
}

const firstNum = (cell: string) => {
  const m = cell.replace(/\(\?\)/g, "").match(/-?\d+(?:[.,]\d+)*/);
  return m ? toFloat(m[0]) : null;
};

/**
 * "Maksimum" row must equal the column max of the rows above it. Only columns whose every cell was read
 * (no blanks) and confirmed (no "(?)") are checked, so a mismatch points at the report, not the OCR.
 */
export function checkMaxRows(md: string): string[] {
  const notes: string[] = [];
  for (const { title, rows } of tables(md)) {
    const mi = rows.findIndex((r) => /^maks/i.test(r[0] ?? ""));
    if (mi < 1) continue;
    const data = rows.slice(0, mi).filter((r) => r.slice(1).some((c) => firstNum(c) !== null));
    const bad: string[] = [];
    for (let j = 1; j < rows[mi].length; j++) {
      const cells = [rows[mi][j], ...data.map((r) => r[j] ?? "")];
      if (cells.some((c) => !c || c.includes("(?)"))) continue;
      const stated = firstNum(rows[mi][j]);
      const vals = data.map((r) => firstNum(r[j])).filter((v): v is number => v !== null);
      if (stated === null || vals.length !== data.length) continue;
      const max = Math.max(...vals);
      if (Math.abs(max - stated) > 1e-9) bad.push(`${j + 1}. sütun: Maksimum ${stated}, satırlardan ${max}`);
    }
    if (bad.length)
      notes.push(`> [Kod kontrolü] "${title || "Tablo"}": Maksimum satırı, iki okumayla doğrulanmış satır değerleriyle uyuşmuyor (${bad.join("; ")}). Raporda hata olabilir; orijinal sayfadan kontrol edin.`);
  }
  return notes;
}

const THRESHOLDS: [RegExp, "<=" | "<"][] = [
  [/en fazla\s*%\s*(\d+(?:[.,]\d+)?)/i, "<="],
  [/%\s*(\d+(?:[.,]\d+)?)\S*\s+aşmamalı/i, "<="],
  [/%\s*(\d+(?:[.,]\d+)?)\S*\s+altında/i, "<"],
];

/** Rows like "…en fazla %20'si… | %88.6 | x" → recompute pass/fail and compare with the report's mark. */
export function checkCriteria(md: string): string[] {
  const notes: string[] = [];
  for (const { title, rows } of tables(md)) {
    let where = title && !title.startsWith("[") ? ` · ${title.replace(/\s*:$/, "")}` : "";
    for (const r of rows) {
      // A row with a single filled cell is a sub-title inside the table (vision readings do this).
      const filled = r.filter(Boolean);
      if (filled.length === 1 && !/%/.test(filled[0])) where = ` · ${filled[0].replace(/\*\*|\s*:$/g, "").trim()}`;
      const ki = r.findIndex((c) => THRESHOLDS.some(([re]) => re.test(c)));
      if (ki < 0) continue;
      const [re, op] = THRESHOLDS.find(([rx]) => rx.test(r[ki]))!;
      const limit = toFloat(r[ki].match(re)![1]);
      const resCell = r.find((c, i) => i !== ki && /%\s*\d|\d\s*%/.test(c));
      if (!resCell) continue;
      const value = firstNum(resCell)!;
      const ok = op === "<=" ? value <= limit : value < limit;
      const markCell = r.find((c, i) => i !== ki && /^(x|×|✗|√|✓|✔)$/i.test(c));
      const reportOk = markCell ? /^(√|✓|✔)$/.test(markCell) : null;
      const verdict = ok ? "SAĞLIYOR" : "SAĞLAMIYOR";
      const agree =
        reportOk === null ? "rapordaki işaret okunamadı" : reportOk === ok ? `rapordaki işaret (${markCell}) ile tutarlı` : `TUTARSIZ: rapor ${markCell} diyor`;
      const uncertain = resCell.includes("(?)") ? " (sonuç değeri belirsiz okundu)" : "";
      notes.push(`> [Kod kontrolü${where}] "${r[ki].slice(0, 90)}": sonuç %${value}, eşik ${op === "<=" ? "≤" : "<"} %${limit} → ${verdict}; ${agree}${uncertain}.`);
    }
  }
  return notes;
}


/**
 * A table cell's number, or null if the cell isn't just a number: Turkish/English separators, "(1.234)" and "−5"
 * negative, currency and % around it, a footnote mark after it ("1.234*", "1.234¹", "1.234 (2)"). "-" alone is 0.
 */
export function cellNumber(cell: string): number | null {
  const c = cell.replace(/\(\?\)/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (/^[-–—]$/.test(c)) return 0;
  const m = /^(\()?\s*([-−–])?\s*(?:TL|TRY|USD|EUR|₺|\$|€|%)?\s*(\d+(?:[.,]\d+)*)\s*(?:TL|TRY|USD|EUR|₺|\$|€|%)?\s*(\))?\s*(?:[*¹²³⁴⁵⁶⁷⁸⁹⁰]+|\(\d\))?$/i.exec(c);
  if (!m || !!m[1] !== !!m[4]) return null;
  const v = toFloat(m[3]);
  return m[1] || m[2] ? -v : v;
}

/** Digits after the decimal separator as normNum reads them ("1.234,5" → 1, "1.234" → 0). */
const decimals = (cell: string) => {
  const m = cell.match(/\d+(?:[.,]\d+)*/);
  const n = m ? normNum(m[0]) : "";
  return n.includes(".") ? n.length - n.indexOf(".") - 1 : 0;
};
const fmtTr = (v: number, d: number) => v.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** "Toplam", "Ara toplam", "Genel toplam", "Toplam tutar (TL)"… but not "Toplam kalite yönetimi". */
const TOTAL_LABEL = /^(genel\s+|ara\s+)?toplam(\s+(tutar|bütçe|maliyet|gider|harcama|değer|miktar|proje\s+bütçesi))?(\s*\(.*\))?$|^total$/;
/** Columns whose values aren't amounts that add up: rates, unit prices, percentages of something else. */
const NOT_ADDITIVE = /oran|yüzde|%|birim\s*fiyat|fiyat|endeks|katsayı|puan|ortalama|artış|değişim/;
const SHARE = /\bpay\b|payı|yüzde|%|dağılım|oran/; // a share only when its total is 100
const isYear = (c: string) => /^(19|20)\d{2}$/.test(c.trim());

/**
 * "Toplam" / "Ara toplam" / "Genel toplam" rows recomputed from the rows above them, column by column; share columns
 * checked as amount ÷ total. Plan §5.2: sums are done by code, not by the model. Ambiguity means no note, never a
 * guess: a wrong "tutarlı" is worse than silence.
 * - A total sums the item rows since the previous total row. "Genel toplam" (or a "Toplam" after "Ara toplam"s) sums
 *   the earlier totals plus the rows between the last of them and itself (KDV, indirim…).
 * - "Tutarlı" only for the plain sum. A mismatch is reported only when no row equals the sum of the rows right under
 *   it (then the table may list parents and their sub-items, and the structure can't be told from the numbers).
 * - Only columns whose every cell is a number and none uncertain "(?)"; rates and prices are never summed; a row
 *   without a text label is a header (years) or unknown, and an unknown one stops the check.
 */
export function checkTotals(md: string): string[] {
  const notes: string[] = [];
  let budget = 2_000_000; // parent-row search steps across all tables (a hostile file can't make it quadratic)
  for (const { title, rows } of tables(md)) {
    const clean = (c: string) => c.replace(/\*\*/g, "").trim();
    // The label: the first text cell (a "No" column before it is a number).
    const labelAt = (r: Row) => r.findIndex((c) => clean(c) && cellNumber(c) === null);
    const label = (r: Row) => clean(r[labelAt(r)] ?? "").replace(/\s*:\s*$/, "");
    const kind = (r: Row) => {
      const l = label(r).toLocaleLowerCase("tr").replace(/\s+/g, " ");
      return TOTAL_LABEL.test(l) ? (l.startsWith("genel") ? "grand" : l.startsWith("ara") ? "sub" : "total") : null;
    };
    const head = (j: number) => clean(rows[0]?.[j] ?? "") || `${j + 1}. sütun`;
    const name = `"${title || "Tablo"}"`;
    const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, x) => a + x).filter((r) => !kind(rows[r]));
    let start = 1; // row 0 is the header
    let prev: number[] = []; // total rows a later grand total adds up
    let prevHasSub = false;
    for (let i = 1; i < rows.length; i++) {
      const k = kind(rows[i]);
      if (!k) continue;
      const items = range(start, i);
      const upper = k === "grand" || (k === "total" && prevHasSub);
      const seg = upper && prev.length ? [...prev, ...items] : items;
      // Totals pile up for the next grand total; a "Toplam" over "Ara toplam"s replaces them; a grand total ends all.
      if (k === "grand") prev = [];
      else if (k === "total" && prevHasSub) prev = [i];
      else prev.push(i);
      prevHasSub = k === "sub" || (prevHasSub && k !== "grand" && k !== "total");
      start = i + 1;
      // Year header rows (no label, only years) aren't items; any other unlabelled row makes the table unclear.
      const body = seg.filter((r) => !(labelAt(rows[r]) < 0 && rows[r].every((c) => !clean(c) || isYear(c))));
      if (body.length < 2 || body.some((r) => labelAt(rows[r]) < 0)) continue;
      const bad: string[] = [];
      const shareBad: string[] = [];
      let checked = 0;
      let shares = 0;
      for (let j = labelAt(rows[i]) + 1; j < rows[i].length; j++) {
        const h = head(j).toLocaleLowerCase("tr");
        const cell = rows[i][j] ?? "";
        const stated = cellNumber(cell);
        const cells = body.map((r) => rows[r][j] ?? "");
        if (stated === null || cell.includes("(?)") || cells.some((c) => c.includes("(?)") || cellNumber(c) === null)) continue;
        const vals = cells.map((c) => cellNumber(c)!);
        const d = cells.reduce((m, c) => Math.max(m, decimals(c)), decimals(cell));
        const tol = (n: number) => (n + 1) * 0.5 * 10 ** -d + 1e-9;
        const share = SHARE.test(h) && Math.abs(stated - 100) <= tol(vals.length);
        if (NOT_ADDITIVE.test(h) && !share) continue; // a "%" column is summed only when its total is 100
        const sum = vals.reduce((s, v) => s + v, 0);
        if (Math.abs(sum - stated) <= tol(vals.length)) checked++;
        else {
          // Could a row be the sum of the next ones (parent and sub-items)? Then the numbers alone can't decide.
          // One work budget for the whole document: once spent, every further mismatch is left unreported (unsure).
          let nested = budget <= 0;
          for (let a = 0; a < (vals.length <= 400 ? vals.length : 0) && !nested; a++) {
            let s = 0;
            for (let b = a + 1; b < vals.length; b++) {
              if (--budget <= 0) {
                nested = true;
                break;
              }
              s += vals[b];
              if (b - a >= 2 && Math.abs(s - vals[a]) <= tol(b - a)) {
                nested = true;
                break;
              }
            }
          }
          if (nested) continue;
          checked++;
          bad.push(`${head(j)}: tabloda ${clean(cell)}, satırların toplamı ${fmtTr(sum, d)}`);
        }
        // Share column: amounts in the column just before, total of shares 100 (so its meaning is established).
        if (!share || j - 1 <= labelAt(rows[i])) continue;
        const total = cellNumber(rows[i][j - 1] ?? "");
        const amounts = body.map((r) => cellNumber(rows[r][j - 1] ?? ""));
        const unsure = [rows[i][j - 1] ?? "", ...body.map((r) => rows[r][j - 1] ?? "")].some((c) => c.includes("(?)"));
        if (!total || unsure || amounts.some((a) => a === null) || NOT_ADDITIVE.test(head(j - 1).toLocaleLowerCase("tr"))) continue;
        const pd = cells.reduce((m, c) => Math.max(m, decimals(c)), 0);
        shares++;
        body.forEach((r, x) => {
          const want = (amounts[x]! / total) * 100;
          if (Math.abs(want - vals[x]) > 0.5 * 10 ** -pd + 0.05) shareBad.push(`${label(rows[r])}: tabloda %${fmtTr(vals[x], pd)}, hesaplanan %${fmtTr(want, Math.max(1, pd))}`);
        });
      }
      if (!checked && !shares) continue;
      const what = `"${label(rows[i])}" satırı`;
      if (checked)
        notes.push(
          bad.length
            ? `> [Kod kontrolü] ${name}: ${what} üstündeki satırların toplamıyla uyuşmuyor (${bad.join("; ")}). Raporda ya da okumada hata olabilir; orijinal sayfadan kontrol edin.`
            : `> [Kod kontrolü] ${name}: ${what} üstündeki satırların toplamıyla tutarlı (${checked} sütun kodla toplandı).`,
        );
      if (shareBad.length) notes.push(`> [Kod kontrolü] ${name}: pay sütunu tutarlarla uyuşmuyor (${shareBad.slice(0, 5).join("; ")}${shareBad.length > 5 ? "; …" : ""}).`);
      else if (shares) notes.push(`> [Kod kontrolü] ${name}: pay sütunu (tutar ÷ ${label(rows[i]).toLocaleLowerCase("tr")}) tutarlı.`);
    }
  }
  return notes;
}

const MONTHS = ["ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık"];
const DATE = new RegExp(
  `(?<![\\d.,/])(?:(\\d{1,2})[./](\\d{1,2})[./](\\d{4})|(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{4}))(?![\\d\\p{L}])`,
  "gu",
);

/** Dates in a text (01.11.2026, 2026-11-01, 1 Kasım 2026) as "d.m.yyyy" keys with where they are. */
export function findDates(text: string): { key: string; index: number; length: number }[] {
  // Turkish lowercase keeps the length (İ→i, I→ı), so indexes stay valid for the original text.
  const low = text.toLocaleLowerCase("tr");
  const src = low.length === text.length ? low : text;
  const out: { key: string; index: number; length: number }[] = [];
  for (const m of src.matchAll(DATE)) {
    const [d, mo, y] = m[1] ? [m[1], m[2], m[3]] : m[4] ? [m[6], m[5], m[4]] : [m[7], String(MONTHS.indexOf(m[8]) + 1), m[9]];
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) continue;
    out.push({ key: `${+d}.${+mo}.${y}`, index: m.index!, length: m[0].length });
  }
  return out;
}

/** Numbers in an answer that don't appear in the sources. Single digits are skipped (list markers, "DD-2"). */
export function verifyNumbers(answer: string, source: string): { unverified: string[]; uncertain: string[] } {
  const known = new Set<string>();
  const shaky = new Set<string>();
  // Dates match by day, month and year whatever the format; their parts count as known numbers ("2026 yılında").
  // A date the second reading didn't confirm ("(?)" right after it) stays uncertain, parts included, so its text
  // is blanked before the plain number scan below.
  const dates = new Set<string>();
  const shakyDates = new Set<string>();
  const pieces: string[] = []; // the source with uncertain dates blanked, built in one pass
  let at = 0;
  for (const { key, index, length } of findDates(source)) {
    const unsure = source.startsWith("(?)", index + length);
    (unsure ? shakyDates : dates).add(key);
    for (const p of key.split(".")) (unsure ? shaky : known).add(String(+p));
    if (unsure) {
      pieces.push(source.slice(at, index), " ");
      at = index + length + 3;
    }
  }
  const plain = pieces.join("") + source.slice(at);
  for (const m of plain.matchAll(/-?\d+(?:[.,]\d+)*(\(\?\))?/g)) {
    const n = normNum(m[0].replace("(?)", ""));
    (m[1] ? shaky : known).add(n);
  }
  const unverified = new Set<string>();
  const uncertain = new Set<string>();
  let rest = "";
  let last = 0;
  for (const d of findDates(answer)) {
    const raw = answer.slice(d.index, d.index + d.length);
    if (!dates.has(d.key)) (shakyDates.has(d.key) ? uncertain : unverified).add(raw);
    rest += answer.slice(last, d.index) + " ";
    last = d.index + d.length;
  }
  answer = rest + answer.slice(last);
  for (const [raw] of answer.matchAll(NUM)) {
    const n = normNum(raw).replace(/^-/, "");
    if (/^\d$/.test(n) || known.has(n) || known.has("-" + n)) continue;
    (shaky.has(n) ? uncertain : unverified).add(raw);
  }
  return { unverified: [...unverified], uncertain: [...uncertain] };
}

/**
 * Comparison tables: a number in a document's column that this document doesn't have but another one does, i.e. a
 * figure put under the wrong document (the typical comparison mistake). A column belongs to a document when its
 * header names it (with or without the extension). Numbers in no document at all are verifyNumbers' job.
 */
export function checkColumns(answer: string, docs: { name: string; text: string }[]): string[] {
  if (docs.length < 2) return [];
  const nums = docs.map((d) => new Set([...d.text.matchAll(NUM)].map((m) => normNum(m[0]).replace(/^-/, ""))));
  const base = (n: string) => n.toLocaleLowerCase("tr").replace(/\.[a-z0-9]+$/i, "");
  // Best match wins: the exact name/base (3) over a header containing the full name (2) over one containing a base
  // of 4+ letters (1), so "rapor-ek.pdf" isn't claimed by "rapor.pdf" too. A tie (a header naming two documents)
  // belongs to neither. The fixed helper columns of the compare prompt are never a document's.
  const docOf = (header: string) => {
    const h = header.toLocaleLowerCase("tr");
    if (h === "konu" || h === "fark") return -1;
    const score = (n: string): number => {
      const full = n.toLocaleLowerCase("tr");
      return h === full || h === base(n) ? 3 : h.includes(full) ? 2 : base(n).length >= 4 && h.includes(base(n)) ? 1 : 0;
    };
    const scores = docs.map((d) => score(d.name));
    const best = Math.max(...scores);
    return best > 0 && scores.filter((x) => x === best).length === 1 ? scores.indexOf(best) : -1;
  };
  // GFM rows: outer pipes optional, "\|" is a pipe inside a cell.
  const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const out = new Set<string>();
  const lines = answer.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes("|") || !lines[i + 1].includes("-") || !SEP.test(lines[i + 1])) continue;
    const cols = cells(lines[i]).map(docOf);
    for (let r = i + 2; r < lines.length && lines[r].includes("|") && lines[r].trim(); r++) {
      cells(lines[r]).forEach((cell, c) => {
        const d = cols[c];
        if (d === undefined || d < 0) return;
        // Page references aren't figures.
        for (const [raw] of cell.replace(/sayfa\s+\d+(\s*[-–]\s*\d+)?/gi, "").matchAll(NUM)) {
          const n = normNum(raw).replace(/^-/, "");
          if (/^\d$/.test(n) || nums[d].has(n)) continue;
          const other = docs.filter((_, k) => k !== d && nums[k].has(n)).map((x) => x.name);
          if (other.length) out.add(`${raw}: ${docs[d].name} sütununda, ama yalnızca ${other.join(", ")} içinde geçiyor`);
        }
      });
    }
  }
  return [...out];
}

/** Page numbers a document's text has markers for. */
export const pageNumbers = (text: string) => [...text.matchAll(/^--- Sayfa (\d+) ---$/gm)].map((m) => Number(m[1]));

/**
 * "Sayfa N" references in an answer that no selected document has (plan §5.3: a made-up page number is never
 * accepted). Ranges ("Sayfa 3–5") check both ends. Checked only when every document has page markers; a DOCX or
 * TXT without them can't say which pages exist.
 */
export function checkPages(answer: string, docTexts: string[]): string[] {
  const sets = docTexts.map((t) => new Set(pageNumbers(t).map(String)));
  if (!sets.length || sets.some((s) => !s.size)) return [];
  const bad = new Set<string>();
  for (const m of answer.matchAll(/\bSayfa\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi)) {
    for (const n of [m[1], m[2]]) if (n && !sets.some((s) => s.has(String(Number(n))))) bad.add(`Sayfa ${Number(n)}`);
  }
  return [...bad];
}

/**
 * Drops Docling's image placeholders and normalises separator rows. Equal neighbouring cells are kept: the markdown
 * can't tell a merged cell's repeat from two real equal values, and losing real data is worse than a repeat (N4).
 */
export function compactTables(md: string): string {
  return md
    .replace(/\s*<!-- image -->/g, "")
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|")) return line;
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) return `|${" --- |".repeat(cells.length)}`;
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
}

/**
 * A model stuck repeating itself: the last 150 words use at most 10 different ones, or the last 60 repeat a pattern
 * of 1-4 words exactly. Real prose and tables don't: their rows have labels and numbers that differ.
 * ponytail: word count only; a loop over more than 10 different words runs on to the length cap.
 */
export function isLooping(text: string): boolean {
  const tail = text.slice(-3000).toLocaleLowerCase("tr");
  const words = tail.match(/\p{L}{2,}/gu) ?? [];
  if (words.length >= 150 && new Set(words.slice(-150)).size <= 10) return true;
  // Numbers and single letters count here: they're what makes a table's rows differ.
  const last = (tail.match(/\p{N}+|\p{L}+/gu) ?? []).slice(-60);
  return last.length === 60 && last.some((w) => /\p{L}{2}/u.test(w)) && [1, 2, 3, 4].some((n) => last.every((w, i) => i < n || w === last[i - n]));
}
