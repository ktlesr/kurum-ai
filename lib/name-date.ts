// The date a file's name or folders give ("Mart 2026", "2026_03_31", "31.03.2026", "2026 Q1", "1. çeyrek 2026", "2026"):
// for "the latest report" a name says more than the file time, which a copy or a restore from backup changes. Pure.
import { foldTr } from "./gallery-search.ts";

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const MONTH = `(${MONTHS.join("|")})`;
const ROMAN = ["i", "ii", "iii", "iv"];

export interface NameDate {
  /** Sortable: year·10000 + month·100 + day, the missing parts 0 (a year alone sorts before its months). */
  key: number;
  /** As a person reads it: "31.03.2026", "Mart 2026", "2026 1. çeyrek", "2026". */
  shown: string;
  from: "dosya adı" | "klasör adı";
}

const valid = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");
const TR_MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** The most precise date in one name (a day before a quarter before a month before a year). Day-first, the Turkish way. */
export function dateIn(name: string): Omit<NameDate, "from"> | null {
  // Underscores and any run of spaces as one space: every rule below then reads every way of spacing a name alike.
  const s = ` ${foldTr(name).replace(/[_\s]+/gu, " ").trim()} `;
  // Not inside a longer run of numbers either: "32.01.2026" is no "Ocak 2026", only a mistyped day.
  const B = "(?<![\\p{L}\\p{N}])(?<!\\d[.\\-])";
  const E = "(?![\\p{L}\\p{N}])(?![.\\-]\\d)";
  const found: Omit<NameDate, "from">[] = [];
  // Every way a day can be read, overlapping ones too (a lookahead finds a match at every start), with where it stands.
  // A whole day is no part of a longer number (plain word edges), and has the same separator twice ("31.03.2026",
  // "2026-03-31"): a span "01.01.2026-31.03.2026" or "2026-01-15-2026-03-31" gives both its ends.
  const B0 = "(?<![\\p{L}\\p{N}])";
  const E0 = "(?![\\p{L}\\p{N}])";
  type Cand = { at: number; end: number; y: number; m: number; d: number };
  const cands: Cand[] = [];
  const read = (re: string, ymd: (g: string[]) => [number, number, number]) => {
    for (const m of s.matchAll(new RegExp(`${B0}(?=(${re})${E0})`, "gu"))) {
      const [y, mo, d] = ymd(m.slice(2) as string[]);
      cands.push({ at: m.index!, end: m.index! + m[1].length, y, m: mo, d });
    }
  };
  read("(\\d{1,2})([.\\- ])(\\d{1,2})\\3(\\d{4})", (g) => [+g[3], +g[2], +g[0]]);
  read("(\\d{4})([.\\- ])(\\d{1,2})\\3(\\d{1,2})", (g) => [+g[0], +g[2], +g[3]]);
  read(`(\\d{1,2}) ${MONTH} (\\d{4})`, (g) => [+g[2], MONTHS.indexOf(g[1]) + 1, +g[0]]);
  const good = cands.filter((c) => valid(c.y, c.m, c.d));
  for (const c of good) found.push({ key: c.y * 10000 + c.m * 100 + c.d, shown: `${pad(c.d)}.${pad(c.m)}.${c.y}` });
  // A day written but not in the calendar ("31 Şubat 2026", "2026_02_30") makes the name give no date at all: it is
  // mistyped, and its month alone would still decide the order. Not a reading that only overlaps a real day ("01-15-2026"
  // inside "2026-01-15-2026-03-31"): that is the real day read wrong.
  const overlaps = (c: Cand) => good.some((g) => c.at < g.end && g.at < c.end);
  if (cands.some((c) => !valid(c.y, c.m, c.d) && !overlaps(c))) return null;
  const month = (y: number, m: number) => valid(y, m, 1) && found.push({ key: y * 10000 + m * 100, shown: `${TR_MONTHS[m - 1]} ${y}` });
  if (!found.length) {
    // Quarters before months: "2026 2. çeyrek" is no "Şubat 2026". "2026 Q1", "Q1 2026", "1. çeyrek 2026", "2026 I. dönem";
    // the key at the quarter's last month.
    const quarter = (y: number, q: number) => q >= 1 && q <= 4 && valid(y, 1, 1) && found.push({ key: y * 10000 + q * 300, shown: `${y} ${q}. çeyrek` });
    // A quarter ("Q1", "1. çeyrek", "I. dönem") goes with the year beside it, else with the name's only year.
    const Q = "(?:q([1-4])|([1-4]|i{1,3}|iv)\\.? ?(?:ceyrek|donem))";
    const qOf = (m: RegExpMatchArray, at: number) => (m[at] ? +m[at] : /\d/u.test(m[at + 1]) ? +m[at + 1] : ROMAN.indexOf(m[at + 1]) + 1);
    // Each quarter takes the year written right beside it (before, then after); else the year in effect where it stands,
    // reading left to right (the last one before it: "2025 Q4 - 2026 Q1-Q2" → Q2 of 2026); else the first after it.
    const years = [...s.matchAll(/(?<![\p{L}\p{N}])(\d{4})(?![\p{L}\p{N}])/gu)].map((m) => ({ y: m[1], at: m.index!, end: m.index! + 4 })).filter((x) => valid(+x.y, 1, 1)); // 1800 is no year here
    // A plain word edge here: "Q1-Q2" is a span of quarters, not digits run together.
    for (const m of s.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${Q}(?![\\p{L}\\p{N}])`, "gu"))) {
      const start = m.index!, stop = start + m[0].length;
      const beside = years.find((x) => x.end <= start && /^ ?$/u.test(s.slice(x.end, start))) ?? years.find((x) => x.at >= stop && /^ ?$/u.test(s.slice(stop, x.at)));
      const y = beside ?? years.filter((x) => x.end <= start).at(-1) ?? years.find((x) => x.at >= stop);
      if (y) quarter(+y.y, qOf(m, 1));
    }
  }
  if (!found.length) {
    // A month in digits: after "." or "-", or two digits after a space ("2026 03"; "2026 3 nüsha" is no month).
    for (const m of s.matchAll(new RegExp(`${B}(\\d{4})(?:[.\\-](\\d{1,2})| (\\d{2}))${E}`, "gu"))) month(+m[1], +(m[2] ?? m[3]));
    for (const m of s.matchAll(new RegExp(`${B}(?:(\\d{1,2})[.\\-]|(\\d{2}) )(\\d{4})${E}`, "gu"))) month(+m[3], +(m[1] ?? m[2]));
    for (const m of s.matchAll(new RegExp(`${B}${MONTH}[ \\-]*(\\d{4}|\\d{2})${E}`, "gu"))) month(m[2].length === 2 ? 2000 + +m[2] : +m[2], MONTHS.indexOf(m[1]) + 1);
    for (const m of s.matchAll(new RegExp(`${B}(\\d{4})[ \\-]*${MONTH}${E}`, "gu"))) month(+m[1], MONTHS.indexOf(m[2]) + 1);
  }
  const year = (y: string) => valid(+y, 1, 1) && found.push({ key: +y * 10000, shown: y });
  // A span of years ("Stratejik Plan 2024-2028"): its end.
  if (!found.length) for (const m of s.matchAll(new RegExp(`${B}(\\d{4}) ?[\\-–] ?(\\d{4})${E}`, "gu"))) year(m[2]);
  if (!found.length) for (const m of s.matchAll(new RegExp(`${B}(\\d{4})${E}`, "gu"))) year(m[1]);
  // The latest of what one name says.
  return found.sort((a, b) => b.key - a.key)[0] ?? null;
}

/** The file's own name first, then its folders from the nearest up. */
export function nameDate(path: string): NameDate | null {
  const parts = path.split("/");
  const file = parts.pop()!.replace(/\.[^.]+$/u, "");
  const own = dateIn(file);
  if (own) return { ...own, from: "dosya adı" };
  for (const dir of parts.reverse()) {
    const d = dateIn(dir);
    if (d) return { ...d, from: "klasör adı" };
  }
  return null;
}

/** Today as a key (Istanbul), to tell a plan or forecast for a later date from what is already past. */
export const todayKey = (now = Date.now()) => {
  const [d, m, y] = new Date(now).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" }).split(".").map(Number);
  return y * 10000 + m * 100 + d;
};
