// The gold set's expected values (prompt §7, rule 7): computed here from the parsed rows in plain TypeScript, with
// exact decimals (BigInt), WITHOUT the plan compiler, its SQL or lib/destek/semantic. The definitions are written again
// from the İcmal formulas (lib/destek/semantic says the same in SQL); if the two ever disagree, a gold test fails.
import type { ProjectRow } from "../lib/destek/load.ts";

const SCALE = BigInt(20);
const ONE = BigInt(10) ** SCALE;

/** "12220320.5" → scaled BigInt (12 decimals). */
export function dec(s: string | null | undefined): bigint {
  if (s === null || s === undefined || s === "") return BigInt(0);
  let t = s.trim();
  if (/e/i.test(t)) t = Number(t).toFixed(Number(SCALE));
  const neg = t.startsWith("-");
  if (neg) t = t.slice(1);
  const [i, f = ""] = t.split(".");
  const v = BigInt(i || "0") * ONE + BigInt((f + "0".repeat(Number(SCALE))).slice(0, Number(SCALE)) || "0");
  return neg ? -v : v;
}

export const show = (v: bigint): string => {
  const neg = v < BigInt(0);
  const a = neg ? -v : v;
  const f = (a % ONE).toString().padStart(Number(SCALE), "0").replace(/0+$/u, "");
  return `${neg ? "-" : ""}${a / ONE}${f ? `.${f}` : ""}`;
};

type R = ProjectRow;
const v = (r: R, c: keyof R["values"]) => r.values[c] ?? null;
const signed = (r: R) => v(r, "imzaladi") === "Evet";
export type Basis = "sozlesme" | "nihai" | "def";

const destekOf = (r: R, b: Basis) => (b === "sozlesme" ? (signed(r) ? v(r, "sozlesme_destek") : null) : b === "nihai" ? v(r, "nihai_uygun_destek") : v(r, "def_destek"));
const butceOf = (r: R, b: Basis) => (b === "sozlesme" ? (signed(r) ? v(r, "sozlesme_butce") : null) : b === "nihai" ? v(r, "nihai_fiili_butce") : r.aile === "TD" ? v(r, "def_destek") : v(r, "def_fiili_butce"));
const esOf = (r: R, b: Basis) => (b === "sozlesme" ? (signed(r) ? v(r, "sozlesme_es_finansman") : null) : b === "nihai" ? v(r, "nihai_fiili_es_finansman") : null);

const cnt = (p: (r: R) => boolean) => (rs: R[]) => ({ n: BigInt(rs.filter(p).length) * ONE });
const total = (f: (r: R) => string | null, p: (r: R) => boolean = () => true) => (rs: R[]) => ({ n: rs.filter(p).reduce((a, r) => a + dec(f(r)), BigInt(0)) });
const ratio = (a: (rs: R[]) => { n: bigint }, b: (rs: R[]) => { n: bigint }) => (rs: R[]) => ({ n: a(rs).n, d: b(rs).n });

/** metric name (as the engine names it, resolved to a basis) → independent computation. */
export function metricFn(name: string): (rs: R[]) => { n: bigint; d?: bigint } {
  const basarili = cnt((r) => v(r, "degerlendirme") === "Başarılı");
  const gelen = cnt(() => true);
  const nihai = cnt((r) => signed(r) && (v(r, "durum") === "Devam Ediyor" || v(r, "durum") === "Tamamlandı"));
  const fixed: Record<string, (rs: R[]) => { n: bigint; d?: bigint }> = {
    gelen_proje: gelen,
    on_incelemede_elenen: cnt((r) => v(r, "on_inceleme") === "Başarısız"),
    basarili_proje: basarili,
    basarisiz_proje: (rs) => ({ n: gelen(rs).n - basarili(rs).n }),
    asil_proje: cnt((r) => v(r, "liste") === "Asil"),
    yedek_proje: cnt((r) => v(r, "liste") === "Yedek"),
    hak_kazanan: cnt((r) => v(r, "hak_kazandi") === "Evet"),
    sozlesme_imzalanan: cnt(signed),
    fesih_edilen: cnt((r) => signed(r) && v(r, "fesih") === "Evet"),
    devam_eden: cnt((r) => signed(r) && v(r, "durum") === "Devam Ediyor"),
    tamamlanan: cnt((r) => signed(r) && v(r, "durum") === "Tamamlandı"),
    nihai_desteklenen: nihai,
    istihdam: total((r) => v(r, "istihdam")),
    belge_sayisi: total((r) => v(r, "belge_sayisi")),
    makine_ekipman: total((r) => v(r, "makine_ekipman")),
    fizibilite_sayisi: total((r) => v(r, "fizibilite_sayisi")),
    yararlanici_sayisi: total((r) => v(r, "yararlanici_sayisi")),
    destek_bakiyesi: total((r) => v(r, "destek_bakiyesi"), (r) => v(r, "durum") === "Devam Ediyor"),
    nihai_uygun_butce: total((r) => v(r, "nihai_uygun_butce")),
    nihai_uygun_es_finansman: total((r) => v(r, "nihai_uygun_es_finansman")),
    basari_orani: ratio(basarili, gelen),
    destek_alma_orani: ratio(nihai, gelen),
  };
  if (fixed[name]) return fixed[name];
  const m = /^(destek|butce|es_finansman|destek_orani)_(sozlesme|nihai|def)$/u.exec(name);
  if (!m) throw new Error(`bağımsız hesapta tanımsız metrik: ${name}`);
  const b = m[2] as Basis;
  if (m[1] === "destek") return total((r) => destekOf(r, b));
  if (m[1] === "butce") return total((r) => butceOf(r, b));
  if (m[1] === "es_finansman") return total((r) => esOf(r, b));
  return ratio(total((r) => destekOf(r, b), (r) => butceOf(r, b) !== null), total((r) => butceOf(r, b)));
}

/** Group key of a row for the engine's dimension names. */
export function dimOf(r: R, d: string, lastPay: (r: R) => string | null): string {
  if (d === "aile") return r.aile;
  if (d === "liste") {
    const l = v(r, "liste");
    return l && /^as[iı]l/iu.test(l) ? "Asil" : l && /^yedek/iu.test(l) ? "Yedek" : String(l);
  }
  if (d === "son_odeme_yili") return String(lastPay(r)?.slice(0, 4) ?? null);
  return String(v(r, d as keyof R["values"]));
}

export const lastPayment = (r: R): string | null =>
  r.payments.filter((p) => p.tur !== "iade" && p.tutar !== null && dec(p.tutar) !== BigInt(0) && p.tarih).map((p) => p.tarih!).sort().at(-1) ?? null;

/** Expected aggregate: group key ("a|b") → metric → value as a decimal string (ratios to 10 places, truncated). */
export function expectAggregate(rows: R[], keep: (r: R) => boolean, groupBy: string[], metrics: string[]): Map<string, Record<string, string>> {
  const groups = new Map<string, R[]>();
  for (const r of rows.filter(keep)) {
    const k = groupBy.map((d) => dimOf(r, d, lastPayment)).join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = new Map<string, Record<string, string>>();
  const all = rows.filter(keep);
  for (const [k, rs] of [...groups, ...(groupBy.length ? [["__total", all] as [string, R[]]] : [])]) {
    const o: Record<string, string> = {};
    for (const m of metrics) {
      const x = metricFn(m)(rs);
      o[m] = x.d === undefined ? show(x.n) : x.d === BigInt(0) ? "null" : show((x.n * ONE) / x.d);
    }
    out.set(k, o);
  }
  return out;
}

/** Engine value → the form above (ratios truncated to 20 places like show(); exact decimals as they are). */
export function engineValue(raw: unknown, ratioKind: boolean): string {
  if (raw === null || raw === undefined) return "null";
  const s = String(raw);
  if (!ratioKind) return show(dec(s));
  const [i, f = ""] = s.split(".");
  return show(dec(`${i}.${f.slice(0, Number(SCALE))}`));
}

/** Two ratio strings equal to within a few units of the 20th decimal (division rounding differs between the two sides). */
export const closeRatio = (a: string, b: string) => a === b || (a !== "null" && b !== "null" && (dec(a) - dec(b) <= BigInt(10) ** BigInt(8) && dec(b) - dec(a) <= BigInt(10) ** BigInt(8)));

// Formatting of the expected values, written again here (half-up rounding, "." thousands, "," decimals), so the gold
// table the user sees is checked without the engine's formatter or any value written into this repository.
const group3 = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
const halfUp = (n: bigint, d: bigint) => (n * BigInt(2) + d) / (d * BigInt(2));
export function fmtExpected(x: { n: bigint; d?: bigint }, kind: "count" | "amount" | "ratio"): string {
  if (kind === "ratio") {
    if (!x.d) return "";
    const q = halfUp(x.n * BigInt(10000), x.d);
    return `%${group3(String(q / BigInt(100)))},${String(q % BigInt(100)).padStart(2, "0")}`;
  }
  if (kind === "count") return group3(String(x.n / ONE));
  const q = halfUp(x.n, ONE / BigInt(100));
  return `${group3(String(q / BigInt(100)))},${String(q % BigInt(100)).padStart(2, "0")}`;
}

/** Expected formatted table: group key → [group value, …metric cells], total under "__total" with "Toplam". */
export function expectTable(rows: R[], keep: (r: R) => boolean, groupBy: string, metrics: { name: string; kind: "count" | "amount" | "ratio" }[]): Map<string, string[]> {
  const kept = rows.filter(keep);
  const groups = new Map<string, R[]>();
  for (const r of kept) groups.set(dimOf(r, groupBy, lastPayment), [...(groups.get(dimOf(r, groupBy, lastPayment)) ?? []), r]);
  const out = new Map<string, string[]>();
  for (const [k, rs] of [...groups, ["__total", kept] as [string, R[]]]) out.set(k, [k === "__total" ? "Toplam" : k, ...metrics.map((m) => fmtExpected(metricFn(m.name)(rs), m.kind))]);
  return out;
}
