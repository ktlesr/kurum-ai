// Turkish number formats (prompt §6): 12.220.320,00 · %62,76 · 13. Numbers arrive as Postgres numeric strings and are
// formatted from the string itself (Intl formats a decimal string exactly; no float on the way). And the check that
// keeps the model's comment honest: every number in it must be one the tool returned.
import type { Col } from "./compile.ts";

const AMOUNT = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const RATIO = new Intl.NumberFormat("tr-TR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Intl.NumberFormat.format takes a decimal string exactly (ES2023); its TypeScript type still says number.
type Exact = (v: string) => string;
const f = (nf: Intl.NumberFormat, v: string) => (nf.format as unknown as Exact)(v);

export function formatCell(v: unknown, kind: Col["kind"]): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  switch (kind) {
    case "amount": return f(AMOUNT, s);
    case "count": return f(COUNT, s);
    case "number": return f(NUMBER, s);
    case "ratio": return f(RATIO, s);
    case "date": return /^\d{4}-\d{2}-\d{2}$/u.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : s;
    default: return s;
  }
}

/**
 * Numbers as written in Turkish text: "12.220.320,00", "%62,76", "62,76", "13", "2025", each as a canonical decimal.
 * A sign belongs to the number ("-100,00" is not "100,00"; "2-3" is two numbers), and so does an exponent ("1e9").
 * A dot is a thousands separator only in groups of three ("12.220.320"); any other dot is a decimal point and the
 * number stays whole ("3.9" is 3.9, never "3" and "9"), so it can't pass as two numbers the table happens to have.
 */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  // A decimal written without its 0 (".5", "%.9", ",5") is a number too; a scale word after it ("3 milyon",
  // "12,2 milyar", "5 bin") is part of it: "3 milyon" is 3000000, never the table's 3.
  const NUM = /(?<![\p{L}\p{N}.,])([-−])?(?:(\d{1,3}(?:\.\d{3})+)(?![.\d])|(\d+)(?:\.(\d+))?|[.,](\d+))(?:,(\d+))?(?:[eE]([+-]?\d+))?(?:\s*(bin|milyon|milyar|trilyon))?/giu;
  for (const m of text.matchAll(NUM)) {
    const int = (m[2] ?? m[3] ?? "0").replace(/\./g, "");
    const dot = m[4] ?? m[5];
    // "3.9" (dot decimal) and "3,9" (comma decimal) are the same number; both a dot and a comma part: kept as written.
    if (dot !== undefined && m[6] !== undefined) {
      out.push(`${m[1] ? "-" : ""}${int}.${dot}_${m[6]}${m[8] ? ` ${m[8]}` : ""}`);
      continue;
    }
    const value = scaled(int, (dot ?? m[6] ?? "").replace(/0+$/u, ""), SCALE[(m[8] ?? "").toLocaleLowerCase("tr")] ?? 0);
    const sign = m[1] && value !== "0" ? "-" : "";
    out.push(`${sign}${value}${m[7] ? `e${Number(m[7])}` : ""}`);
  }
  return out;
}

const SCALE: Record<string, number> = { bin: 3, milyon: 6, milyar: 9, trilyon: 12 };

/** int.frac × 10^shift as a canonical decimal string ("12", "2", 6 → "12200000"). */
function scaled(int: string, frac: string, shift: number): string {
  const point = int.length + shift;
  const whole = (int + frac).padEnd(point, "0");
  const i = BigInt(whole.slice(0, point) || "0").toString();
  const f = whole.slice(point).replace(/0+$/u, "");
  return f ? `${i}.${f}` : i;
}

/** The comment check (prompt §6): numbers of the comment that the tool's text doesn't have. None is let through. */
export function unsupportedNumbers(comment: string, toolTexts: string[]): string[] {
  const known = new Set(toolTexts.flatMap(numbersIn));
  return [...new Set(numbersIn(comment))].filter((n) => !known.has(n));
}

/** Whether an answer's text is held back: the support tool was called (a table or only an error came back) and the text has a number none of its results has. */
export const commentHidden = (answer: string, toolOuts: string[]): boolean => toolOuts.length > 0 && unsupportedNumbers(answer, toolOuts).length > 0;
