// Calculations the answer writes out ("1.200.000 + 350.500 = 1.550.500"), worked again in code (plan P4). A right result
// whose operands are all known is a derived figure, not one missing from the source (derivedNumbers); a wrong one is
// named with what it comes to. No eval: a small parser over numbers, + - × / and brackets. No "server-only".
//
// One rule above all: a verdict only where the whole calculation is in view. Wherever the left side may be a cut part
// of a longer one, or the right side may go on, there is no verdict: a missed check costs little, a false "right"
// launders a number.

import { findDates, knownNumbers, normNum } from "./checks.ts";

/** `actual` and `shown`: what the left side comes to, at the scale the result was written in ("%25", not 0,25). */
export interface Calc {
  expr: string; said: string; actual: number; shown: string; ok: boolean;
  /** The numbers to find in the source; `scale`: the 100 that makes a percentage, a factor rather than a figure. */
  operands: string[]; scale: string[];
}

const NUM = String.raw`\d+(?:[.,]\d+)*`;
// The number right after "=" (one pass, anchored: no backtracking over long lines of figures).
const RESULT = new RegExp(String.raw`^\s*(?:≈\s*)?([-+]?\s*%?\s*[-+]?\s*${NUM}\s*%?)`, "u");
/** A number in one of the forms people write ("1.234.567", "1.234,56", "1,234.56", "12,5"); "1.234.56" isn't one. */
// Grouped thousands start with 1-9 ("0.100.000" is no number anyone writes).
const WELL_FORMED = /^(?:[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)$/u;
/** What a calculation's left side may hold; scanned back from "=", character by character. */
const EXPR_CHAR = /[\d.,\s+\-–×x*/÷()%]/u;
/** Where a calculation may start: the line's start, a word (a label), a colon, a table bar, a quote, another "=". */
const START = /[\p{L}:|>=_"'“”‘’]/u;
const MAX_LINE = 2000;

type Tok = { n: number; at: number; pct: boolean } | { op: string };
const isOp = (t: Tok | undefined, o: string) => !!t && "op" in t && t.op === o;

/** The expression's tokens, its numbers as written; null when it isn't one (or holds a range like "2024-2025"). */
function tokens(expr: string): { toks: Tok[]; operands: string[] } | null {
  // A dash with no space either side between two numbers is a range or a period, not a subtraction.
  if (/\d[-–]\d/u.test(expr)) return null;
  const toks: Tok[] = [];
  const operands: string[] = [];
  // A number with a percent sign on either side is a percentage of something: "200 × %10" is 20.
  const re = new RegExp(String.raw`\s*(?:(%\s*)?(${NUM})(\s*%)?|([-+×x*/÷()]))`, "gyu");
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(expr))) {
    at = re.lastIndex;
    if (m[2]) {
      if (m[1] && m[3]) return null; // "%10%": a percent sign on both sides is no one number
      if (!WELL_FORMED.test(m[2])) return null; // read only in part by parseFloat: no verdict
      const n = parseFloat(normNum(m[2]));
      toks.push({ n: m[1] || m[3] ? n / 100 : n, at: operands.length, pct: !!(m[1] || m[3]) });
      operands.push(m[2]);
    } else toks.push({ op: { "×": "*", x: "*", "÷": "/" }[m[4]] ?? m[4] });
  }
  return expr.slice(at).trim() ? null : { toks, operands };
}

/** Value of the tokens, or null when they don't form an expression; NaN for one with no value (÷ 0). */
function evaluate(t: Tok[]): number | null {
  let i = 0;
  const op = (o: string) => isOp(t[i], o) && ++i > 0;
  const factor = (): number | null => {
    if (op("-")) {
      const v = factor();
      return v === null ? null : -v;
    }
    if (op("+")) return factor(); // "+100"
    if (op("(")) {
      const v = sum();
      return v !== null && op(")") ? v : null;
    }
    const x = t[i];
    if (x && "n" in x) {
      i++;
      return x.n;
    }
    return null;
  };
  const product = (): number | null => {
    let v = factor();
    while (v !== null) {
      if (op("*")) {
        const r = factor();
        v = r === null ? null : v * r;
      } else if (op("/")) {
        const r = factor();
        v = r === null ? null : r === 0 ? NaN : v / r;
      } else break;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null) {
      if (op("+")) {
        const r = product();
        v = r === null ? null : v + r;
      } else if (op("-")) {
        const r = product();
        v = r === null ? null : v - r;
      } else break;
    }
    return v;
  };
  const v = sum();
  return v !== null && i === t.length ? v : null;
}

/** The index past the bracket that closes the one at `i`, or -1. */
function closing(t: Tok[], i: number): number {
  for (let depth = 0, j = i; j < t.length; j++) {
    if (isOp(t[j], "(")) depth++;
    else if (isOp(t[j], ")") && --depth === 0) return j + 1;
  }
  return -1;
}

/**
 * The expression is already a percentage: its outermost product has a factor of 100 ("(a - b) / b × 100", "100 × a / b",
 * "a / b × (100)", "× 100,0"), not one inside brackets ("300 / (1.200 × 100)") nor a divisor ("100 / 200" is a ratio).
 * Returns that factor's operand positions (a scale, not a figure from the document), or null.
 */
function percentFactor(all: Tok[]): number[] | null {
  let t = all;
  while (isOp(t[0], "(") && closing(t, 0) === t.length) t = t.slice(1, -1); // brackets around the whole change nothing
  // The outermost product's factors, each with the operator before it; a sum at the top level isn't one product.
  const parts: { op: string | null; toks: Tok[] }[] = [{ op: null, toks: [] }];
  for (let i = 0; i < t.length; ) {
    const x = t[i];
    if (isOp(x, "(")) {
      const end = closing(t, i);
      if (end < 0) return null;
      parts.at(-1)!.toks.push(...t.slice(i, end));
      i = end;
      continue;
    }
    if (isOp(x, "*") || isOp(x, "/")) parts.push({ op: (x as { op: string }).op, toks: [] });
    // A binary + or - (after a number or a bracket) makes a sum; a sign ("--100", "(+100)") doesn't.
    else if ((isOp(x, "+") || isOp(x, "-")) && parts.at(-1)!.toks.some((y) => "n" in y || isOp(y, ")"))) return null;
    else parts.at(-1)!.toks.push(x);
    i++;
  }
  for (const [k, p] of parts.entries()) {
    const multiplied = p.op === "*" || (k === 0 && parts[1]?.op === "*");
    // The literal number 100, maybe bracketed or signed: "(999 - 899)" comes to 100 too, but its figures are figures.
    const nums = p.toks.filter((x) => "n" in x) as { n: number; at: number; pct: boolean }[];
    const literal = nums.length === 1 && !nums[0].pct && p.toks.every((x) => "n" in x || isOp(x, "(") || isOp(x, ")") || isOp(x, "-") || isOp(x, "+"));
    if (multiplied && literal && Math.abs(evaluate(p.toks) ?? 0) === 100) return [nums[0].at];
  }
  return null;
}

const decimalsOf = (said: string) => {
  const n = normNum(said.replace(/[%\s+-]/g, ""));
  return n.includes(".") ? n.length - n.indexOf(".") - 1 : 0;
};

/** Same figure within the precision it was written with ("1.235" for 1234,5; "12,5" for 12.4999); no more slack. */
function close(actual: number, said: string): boolean {
  // The sign apart, so "+1.234" is read as the thousands it is ("+1.234" alone isn't a form normNum knows).
  const n = (said.replace(/[%\s]/g, "").startsWith("-") ? -1 : 1) * parseFloat(normNum(said.replace(/[%\s+-]/g, "")));
  // Half a unit of the last written digit; the rest only floating-point noise (a few ulps), never a figure's worth.
  return Math.abs(actual - n) <= 0.5 * 10 ** -decimalsOf(said) + 4 * Number.EPSILON * Math.abs(actual);
}

/** "1.550.500" as the answer would write it, one digit finer than the result it corrects ("0,003", "1,2345"). */
export function trNumber(n: number, said = ""): string {
  const s = n.toLocaleString("tr-TR", { maximumFractionDigits: Math.min(20, Math.max(2, decimalsOf(said) + 1)) });
  return /^-?0$/.test(s) && n !== 0 ? n.toLocaleString("tr-TR", { maximumSignificantDigits: 4 }) : s;
}

/** Every written-out calculation in the answer, worked again. */
export function findCalcs(answer: string): Calc[] {
  const out: Calc[] = [];
  for (const raw of answer.split("\n")) {
    if (raw.length > MAX_LINE) continue;
    // Typeset signs as the plain ones: "−" (minus sign), "‒" (figure dash), "·" and "⋅" (dot operators); an en dash with
    // spaces around it is a minus too ("500 – 100"), one between digits stays a range ("10–12").
    // Markdown emphasis ("**100 + 200 = 300**") is no multiplication.
    const line = raw.replace(/\*\*|__/gu, " ").replace(/[−‒]/gu, "-").replace(/\s–\s/gu, " - ").replace(/[·⋅]/gu, "×");
    for (let eq = line.indexOf("="); eq >= 0; eq = line.indexOf("=", eq + 1)) {
      const r = RESULT.exec(line.slice(eq + 1));
      if (!r) continue;
      // The right side ends with the number only when what follows plainly ends it (the line's end, a word, a closing
      // mark, a sentence sign) and nothing up to the next clause carries the calculation on ("= 300 TL / 2", "= 300! / 2",
      // "= 300e2").
      const after = line.slice(eq + 1 + r[0].length);
      // ("!" isn't among the ends: "= 5!" is a factorial.)
      if (!/^(?:\s*$|\s*\p{L}|\s*[)\]|]|\s*[.,;:](?!\d)|\s*\(\s*\p{L})/u.test(after) || /^[eE][+-]?\d/u.test(after)) continue;
      // Any figure in the rest of the clause ("= 300 TL / √4", "= 300 mod 2") may belong to the calculation: no verdict.
      const clause = after.split(/[,;|=]|\.\s/u)[0];
      // A figure or a sign of arithmetic, a minus or a lone "x" included ("= 300 TL - e", "= 300 x e"): maybe more of it.
      if (/[\d√π∞^!×*/÷+<>-]|(?:^|\s)x(?:\s|$)/u.test(clause)) continue;
      // The result is one number: one sign at most, one percent sign at most ("--300", "%300%" aren't).
      const said = r[1].trim();
      if ((said.match(/[-+]/g)?.length ?? 0) > 1 || (said.match(/%/g)?.length ?? 0) > 1) continue;
      if (!WELL_FORMED.test(said.replace(/[%\s+-]/g, ""))) continue;
      let from = eq;
      while (from > 0 && EXPR_CHAR.test(line[from - 1])) from--;
      // The calculation must start somewhere plain: the line's start, a label word, a colon, a table bar… A stop at
      // anything else (an em dash, a power sign, a root) or at a letter glued to the first number ("1e3") may cut it.
      const before = line[from - 1];
      // A word glued to the left side ("1e3 + …", "log(100 + 200)") is a function or a notation, not a label.
      if (from > 0 && (!START.test(before) || (/\p{L}/u.test(before) && !/^\s/u.test(line.slice(from))))) continue;
      // A word then a bracket ("ln (100 + 200)"): maybe a function of it, maybe a label; no verdict either way.
      if (from > 0 && /\p{L}/u.test(before) && /^\s*\(/u.test(line.slice(from))) continue;
      // A dash with a space after it at the start of the line is a Markdown bullet, not a minus sign (a negative number
      // is written against its digits, "-100").
      let left = line.slice(from, eq);
      if (from === 0) left = left.replace(/^\s*[-–]\s+/u, " ");
      // A word with an operator right after it ("500 TL - 100 + 200", "Personel - 1.200 + 300"): a cut calculation or
      // a label and a dash; either way no verdict on what's left.
      else if (/^\s*[-–+×x*/÷]/u.test(left)) continue;
      // An opening bracket around the whole equation ("(100 + 200 = 300)") isn't the expression's own.
      if (/^\s*\(/u.test(left) && (left.match(/\(/g)?.length ?? 0) > (left.match(/\)/g)?.length ?? 0)) left = left.replace(/^\s*\(/u, " ");
      // A range or period anywhere on the left ("10–12 + 5 + 6"): no part of it is a calculation.
      if (/\d[-–]\d/u.test(left)) continue;
      // The scan may take in a list number ("1. 2.000 + 3.000", "2) 10 × 3"): that prefix, and nothing else, may be left
      // out when the whole isn't an expression. A wrong sum isn't made right by dropping a term.
      const listed =/^\s*\d{1,3}[.)]\s+/u.exec(left);
      for (const expr of [left.trim(), ...(listed ? [left.slice(listed[0].length).trim()] : [])]) {
        const t = tokens(expr);
        if (!t || t.operands.length < 2) continue;
        const v = evaluate(t.toks);
        if (v === null) continue; // not an expression: maybe without the list number it is
        if (!Number.isFinite(v)) break; // an expression with no value (÷ 0): no verdict, and none for a part of it
        // Beyond what a double holds exactly (2^53) a last digit can't be told apart: no verdict on such figures.
        const big = (x: number) => Math.abs(x) > Number.MAX_SAFE_INTEGER / 2;
        if (big(v) || t.toks.some((x) => "n" in x && big(x.n)) || big(parseFloat(normNum(said.replace(/[%\s+-]/g, ""))))) break;
        // A percentage result: the ratio times 100 ("300 / 1.200 = %25"), or the expression already multiplied by 100
        // ("… × 100 = %25"), whose 100 is a scale, not a figure to find in the document.
        const scale = said.includes("%") ? percentFactor(t.toks) : null;
        const value = said.includes("%") && !scale ? v * 100 : v;
        out.push({
          expr: `${expr} = ${said}`, said, actual: value, ok: close(value, said),
          shown: `${said.includes("%") ? "%" : ""}${trNumber(value, said)}`,
          operands: t.operands.filter((_, k) => !scale?.includes(k)),
          scale: t.operands.filter((_, k) => scale?.includes(k)),
        });
        break;
      }
    }
  }
  return out;
}

/** A number as derivedNumbers compares it: one value, one key ("300", "300,0" and "300.0" alike; sign and % aside). */
const key = (raw: string) => String(parseFloat(normNum(raw.replace(/[%\s]/g, "")).replace(/^-/, "")));
export { key as numberKey };

/**
 * The numbers the source states, as derivedNumbers compares them: exactly those verifyNumbers knows (lib/checks
 * knownNumbers: plain numbers and date parts, none marked unsure), single digits included, one key per value.
 */
export const sourceNumbers = (source: string): Set<string> =>
  // Already in normNum form ("12.345" is twelve point three): read as it is, not normalised a second time.
  new Set([...knownNumbers(source)].flatMap((k) => (/^-?\d+(?:\.\d+)?$/.test(k) ? [String(parseFloat(k.replace(/^-/, "")))] : [])));

/**
 * verifyNumbers' "not in the source" list less the results derived from the source (derivedNumbers). Only plain numbers
 * are excused: a date ("12/03/2026") isn't a result, whatever its first part comes to.
 */
export function stillUnverified(unverified: string[], calcs: Calc[], source: string): string[] {
  const stated = sourceNumbers(source);
  const derived = derivedNumbers(calcs, (k) => stated.has(k));
  // The 100 of a right percentage is its scale, written by the answer, not a figure taken from the document.
  for (const c of calcs) if (c.ok) for (const s of c.scale) derived.add(key(s));
  return unverified.filter((n) => findDates(n).length > 0 || !derived.has(key(n)));
}

/**
 * The results that count as derived: right, and every operand either in the source (`inSource`) or itself such a result
 * (a chain: a total, then its share). A made-up operand keeps its results unproven, so two calculations can't vouch for
 * each other ("999 + 100 = 1.099", "1.099 - 100 = 999").
 */
export function derivedNumbers(calcs: Calc[], inSource: (key: string) => boolean): Set<string> {
  const derived = new Set<string>();
  const known = (raw: string) => inSource(key(raw)) || derived.has(key(raw));
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of calcs) {
      if (c.ok && !derived.has(key(c.said)) && c.operands.every(known)) {
        derived.add(key(c.said));
        grew = true;
      }
    }
  }
  return derived;
}
