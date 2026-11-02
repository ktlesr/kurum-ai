// What the same tokens would have cost on a paid cloud service (admin dashboard). Only a comparison: nothing is billed.

export type TokenPrice = {
  /** The service compared with. */
  label: string;
  /** USD per million tokens. */
  input: number;
  output: number;
  /** TRY per USD. */
  usdTry: number;
  /** YYYY-MM-DD: when these figures were looked up. */
  at: string;
};

// platform.claude.com/docs/en/about-claude/pricing (standard rates, no caching) and TCMB's selling rate, both as of the date below.
export const DEFAULT_PRICE: TokenPrice = { label: "Claude Sonnet 5.5", input: 2, output: 10, usdTry: 49.8644, at: "2026-10-30" };

const number = (v: unknown) => (typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : typeof v === "number" ? v : NaN);
const LIMIT = 1_000_000;
const inRange = (n: number, min: number) => Number.isFinite(n) && n >= min && n <= LIMIT;

/** A valid price, or what is wrong in words for the admin. Takes unknowns: a server action can be called with anything. */
export function checkPrice(x: { label?: unknown; input?: unknown; output?: unknown; usdTry?: unknown }, at: string): TokenPrice | string {
  const label = typeof x.label === "string" ? x.label.trim() : "";
  if (!label || label.length > 60) return "Karşılaştırılan hizmetin adı 1-60 karakter olmalı.";
  const [input, output, usdTry] = [number(x.input), number(x.output), number(x.usdTry)];
  if (!inRange(input, 0) || !inRange(output, 0)) return "Token fiyatı geçersiz.";
  if (!inRange(usdTry, 0.01)) return "Dolar kuru geçersiz.";
  return { label, input, output, usdTry, at };
}

/** The saved price; anything unreadable falls back to the default rather than showing a wrong figure. */
export function readPrice(raw: string | undefined): TokenPrice {
  if (!raw) return DEFAULT_PRICE;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const p = checkPrice(j, typeof j.at === "string" ? j.at : DEFAULT_PRICE.at);
    return typeof p === "string" ? DEFAULT_PRICE : p;
  } catch {
    return DEFAULT_PRICE;
  }
}

export const costUsd = (tokensIn: number, tokensOut: number, p: TokenPrice) => (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
