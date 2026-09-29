// Deterministic guards against misreads and hallucinated numbers. Pure functions, no imports.

const NUM = /-?\d+(?:[.,]\d+)*/g;

/** "1.234.567" → "1234567", "94,7" → "94.7" */
export function normNum(s: string): string {
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return s.replace(/\./g, "");
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
  const m = cell.replace(/\(\?\)/g, "").match(/-?\d+(?:[.,]\d+)?/);
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


/** Numbers in an answer that don't appear in the sources. Single digits are skipped (list markers, "DD-2"). */
export function verifyNumbers(answer: string, source: string): { unverified: string[]; uncertain: string[] } {
  const known = new Set<string>();
  const shaky = new Set<string>();
  for (const m of source.matchAll(/-?\d+(?:[.,]\d+)*(\(\?\))?/g)) {
    const n = normNum(m[0].replace("(?)", ""));
    (m[1] ? shaky : known).add(n);
  }
  const unverified = new Set<string>();
  const uncertain = new Set<string>();
  for (const [raw] of answer.matchAll(NUM)) {
    const n = normNum(raw).replace(/^-/, "");
    if (/^\d$/.test(n) || known.has(n) || known.has("-" + n)) continue;
    (shaky.has(n) ? uncertain : unverified).add(raw);
  }
  return { unverified: [...unverified], uncertain: [...uncertain] };
}
