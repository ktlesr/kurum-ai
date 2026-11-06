// The chat tool "destek_sorgula" (prompt §5-§6): its input is the query plan (./plan), its output a table the app
// shows itself. The model never computes, sums or rounds a number: it writes the plan, then at most a 2-3 sentence
// comment, and a comment with a number the table doesn't have is not shown (./format unsupportedNumbers).
import type postgres from "postgres";
import type { ToolDef } from "../provider.ts";
import { compileAggregate, compileProjects, metinProblem, whereOf, type Col, type Compiled } from "./compile.ts";
import { formatCell } from "./format.ts";
import { FAMILY_SPELLINGS, matchValue, PLACE_SPELLINGS } from "./match.ts";
import { PLAN, planJsonSchema, readPlan, type Plan } from "./plan.ts";
import { BASIS_LABEL, CONCEPTS, DEFAULT_BASIS, METRICS, resolveMetric, type Basis } from "./semantic.ts";
import type { Snapshot } from "./store.ts";

export const DESTEK_TOOL_NAME = "destek_sorgula";

export interface Catalog {
  aile: string[]; program_kodu: { aile: string; kod: string; n: number }[]; il: string[]; ilce: { il: string; ilce: string }[];
  yil: number[]; ana_yasal_statu: string[]; alt_yasal_statu: string[]; empty: string[];
}

export async function catalogOf(sql: postgres.Sql, s: Snapshot): Promise<Catalog> {
  const id = s.id;
  const col = async (c: string) => (await sql.unsafe(`SELECT DISTINCT ${c} AS v FROM destek.projeler WHERE snapshot_id = $1 AND ${c} IS NOT NULL ORDER BY 1`, [id])).map((r) => r.v as string);
  const codes = await sql<{ aile: string; kod: string; n: number }[]>`SELECT aile, program_kodu AS kod, count(*)::int AS n FROM destek.projeler WHERE snapshot_id = ${id} AND program_kodu IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2`;
  const ilce = await sql<{ il: string; ilce: string }[]>`SELECT DISTINCT il, ilce FROM destek.projeler WHERE snapshot_id = ${id} AND ilce IS NOT NULL ORDER BY 1, 2`;
  const rows = s.report?.rows ?? {};
  return {
    aile: Object.keys(rows), program_kodu: codes, il: await col("il"), ilce, yil: (await col("yil")).map(Number),
    ana_yasal_statu: await col("ana_yasal_statu"), alt_yasal_statu: await col("alt_yasal_statu"),
    empty: Object.entries(rows).filter(([, r]) => r.loaded === 0).map(([a]) => a),
  };
}

const g = globalThis as typeof globalThis & { __destekCatalog?: { id: number; at: number; cat: Promise<Catalog> } };
/** The active version's catalog, kept while that version is active (a new one is a new id). */
export function cachedCatalog(sql: postgres.Sql, s: Snapshot): Promise<Catalog> {
  if (g.__destekCatalog?.id !== s.id) g.__destekCatalog = { id: s.id, at: Date.now(), cat: catalogOf(sql, s).catch((e) => { g.__destekCatalog = undefined; throw e; }) };
  return g.__destekCatalog.cat;
}

/** The tool as the model sees it: the plan schema, and the real values of the loaded version (§5: no rows, only values). */
export function destekTool(s: Snapshot, c: Catalog): ToolDef {
  const codes = c.aile.map((a) => `${a}: ${c.program_kodu.filter((p) => p.aile === a).map((p) => p.kod).join(", ") || "(boş)"}`).join("; ");
  return {
    name: DESTEK_TOOL_NAME,
    description:
      `Ajansın destek takip Excel'inden (${s.file_name}) kesin sayı, toplam, oran, il/ilçe/yıl/program kırılımı, sıralama ve proje bulma. ` +
      `Sayıları SEN hesaplama: soruyu bu aracın sorgu planına çevir, araç tabloyu hesaplar ve kullanıcıya kendisi gösterir. ` +
      `Program aileleri ve kodları: ${codes}. İller: ${c.il.join(", ")}. Yıllar: ${c.yil.join(", ")}. Ana yasal statüler: ${c.ana_yasal_statu.join(", ")}. ` +
      `${c.empty.length ? `Boş (henüz veri yok): ${c.empty.join(", ")}. ` : ""}` +
      `Tutar tabanı: kullanıcı söylemezse "default" (= Def-TL, 2026 fiyatları); "sözleşme" derse sozlesme, "gerçekleşen/nihai" derse nihai. ` +
      `"Proje sayısı" → sozlesme_imzalanan ve gelen_proje. Yıl, Yılı kolonudur (çağrı yılı). ${CONCEPTS}`,
    parameters: planJsonSchema(),
  };
}

export const DESTEK_RULE = `\n\nAjansın destek programlarıyla ilgili sayısal sorularda (proje sayısı, destek tutarı, bütçe, oran, il/ilçe/yıl/program dağılımı, en çok destek alanlar, bir projenin durumu, ödemeler, istihdam) destek_sorgula aracını kullan. Sayıları kendin hesaplama, toplama ya da yuvarlama. Araç tabloyu kullanıcıya kendisi gösterir: tabloyu yeniden yazma; yalnızca 2-3 cümle yorum yaz. Yorumda yalnızca tabloda yazan sayıları, tablodaki yazımıyla aynen kullan (yuvarlama, "milyon" gibi kısaltma, sıra sayısı ya da kendi hesabın yok); tabloda olmayan bir sayı yazarsan yorumun gösterilmez. Soru belirsizse ve araç açıklamasında varsayılanı yoksa clarification alanıyla tek bir soru sor.`;

export interface DestekResult {
  title: string;
  columns: Col[];
  rows: string[][];
  total?: string[];
  footer: string;
  warnings: string[];
  sql: string;
  plan: Plan;
}

/** Runs one tool call: the text for the model, and the table for the page (none when the call didn't get that far). */
/** Raw values (numeric strings) of a run, beside the formatted table: for the gold-set check (tests/destek-gold). */
export interface DestekRaw { rows: Record<string, unknown>[]; total?: Record<string, unknown>; matched: number }

export async function runDestek(sql: postgres.Sql, s: Snapshot | undefined, args: string): Promise<{ out: string; table?: DestekResult; raw?: DestekRaw }> {
  if (!s) return { out: "HATA: destek verisi henüz yüklenmedi; yöneticinin Excel dosyasını Yönetici paneli → Destek verisi sayfasından yüklemesi gerekiyor. Sayı uydurma." };
  const read = readPlan(args);
  if ("error" in read) return { out: read.error };
  const plan = read.plan;
  if (plan.clarification) return { out: `Kullanıcıya şu soruyu sor, tahmin etme: ${plan.clarification}` };
  const cat = await cachedCatalog(sql, s);
  const resolved = resolve(plan, cat);
  if ("error" in resolved) return { out: `HATA (filtre eşleşmedi, veri yokluğu değil): ${resolved.error}. Kullanıcıya doğru adı sor ya da benzerlerden birini kullan.` };
  const { plan: p, notes } = resolved;
  const basis: Basis = p.amount_basis === "default" ? DEFAULT_BASIS : p.amount_basis;

  if (p.type === "metadata") return metadata(s, cat);
  if (p.type === "lookup_project" && !p.filters.metin) return { out: "HATA: lookup_project için filters.metin (başvuru sahibi ya da proje adından kelimeler) gerekli." };
  const noWords = metinProblem(p);
  if (noWords) return { out: noWords };
  const compiled: Compiled | { error: string } = p.type === "aggregate" ? compileAggregate(p, basis, s.id) : compileProjects(p, basis, s.id, p.type === "lookup_project");
  if ("error" in compiled) return { out: compiled.error };

  const { rows, matched, warnings } = await sql.begin("read only", async (tx) => {
    await tx`SET LOCAL statement_timeout = '5s'`;
    const rows = await tx.unsafe(compiled.text, compiled.params as never[]);
    const params: unknown[] = [];
    const where = whereOf(p, s.id, params);
    const [{ n }] = await tx.unsafe(`SELECT count(*)::int AS n FROM destek.v_projeler WHERE ${where}`, params as never[]);
    return { rows, matched: n as number, warnings: await warningsFor(tx, p, s, cat, basis, where, params) };
  });
  const data = rows.filter((r) => Number(r.__total) === 0);
  const totalRow = rows.find((r) => Number(r.__total) !== 0);
  const groups = Number(data[0]?.__groups ?? data.length);
  const cut = data.length < groups;
  const cells = (r: Record<string, unknown>) => compiled.columns.map((c) => formatCell(r[c.key], c.kind));
  const result: DestekResult = {
    title: titleOf(p, basis),
    columns: compiled.columns,
    rows: data.map(cells),
    ...(totalRow ? { total: compiled.columns.map((c, i) => (i === 0 ? (cut ? "Toplam (tüm satırlar)" : "Toplam") : formatCell(totalRow[c.key], c.kind))) } : {}),
    footer: footerOf(p, basis, s, matched),
    warnings: [...(cut ? [`${groups} satırdan ${data.length} tanesi gösteriliyor${totalRow ? "; toplam satırı hepsini kapsar" : ""}.`] : []), ...notes, ...warnings],
    sql: compiled.text,
    plan: p,
  };
  if (!matched) {
    const why = p.filters.aile?.some((a) => cat.empty.includes(a)) ? `${p.filters.aile.filter((a) => cat.empty.includes(a)).join(", ")} tablosu henüz boş şablon (hiçbir satırda İl yok).` : "Filtrelerin hepsi geçerli ama bu kesişimde proje yok (veri yok).";
    return { out: `SONUÇ: 0 proje. ${why}\n${result.footer}`, table: { ...result, warnings: [why, ...result.warnings] }, raw: { rows: data, total: totalRow, matched } };
  }
  return { out: textFor(result), table: result, raw: { rows: data, total: totalRow, matched } };
}

/** The model's values matched to the real ones; families named by a word ("sosyal gelişme") too. */
function resolve(plan: Plan, cat: Catalog): { plan: Plan; notes: string[] } | { error: string } {
  const notes: string[] = [];
  const errors: string[] = [];
  const f = { ...plan.filters };
  const each = (vs: string[] | undefined, cands: string[], words?: Record<string, string>) => {
    if (!vs?.length) return vs;
    const out: string[] = [];
    for (const v of vs) {
      const m = matchValue(v, cands, words);
      if ("error" in m) errors.push(m.error);
      else {
        out.push(m.value);
        if (m.note) notes.push(`${m.note} olarak yorumlandı.`);
      }
    }
    return [...new Set(out)];
  };
  f.aile = each(f.aile, cat.aile, FAMILY_SPELLINGS);
  // A program code given as a family ("SOGEP" in program_kodu): the family.
  if (f.program_kodu?.length) {
    const fams = f.program_kodu.filter((k) => cat.aile.includes(matchFamily(k, cat) ?? "") && !cat.program_kodu.some((p) => p.kod.toLowerCase() === k.toLowerCase()));
    if (fams.length) {
      f.aile = [...new Set([...(f.aile ?? []), ...fams.map((k) => matchFamily(k, cat)!)])];
      f.program_kodu = f.program_kodu.filter((k) => !fams.includes(k));
    }
    f.program_kodu = each(f.program_kodu, [...new Set(cat.program_kodu.map((p) => p.kod))]);
  }
  f.il = each(f.il, cat.il, PLACE_SPELLINGS);
  f.ilce = each(f.ilce, [...new Set(cat.ilce.filter((x) => !f.il?.length || f.il.includes(x.il)).map((x) => x.ilce))]);
  f.ana_yasal_statu = each(f.ana_yasal_statu, cat.ana_yasal_statu);
  f.alt_yasal_statu = each(f.alt_yasal_statu, cat.alt_yasal_statu);
  if (errors.length) return { error: errors.join("; ") };
  return { plan: PLAN.parse({ ...plan, filters: f }), notes };
}

const matchFamily = (k: string, cat: Catalog) => {
  const m = matchValue(k, cat.aile, FAMILY_SPELLINGS);
  return "value" in m ? m.value : undefined;
};

async function warningsFor(tx: postgres.TransactionSql, p: Plan, s: Snapshot, cat: Catalog, basis: Basis, where: string, params: unknown[]): Promise<string[]> {
  const out: string[] = [];
  const scope = await tx.unsafe(`SELECT aile, count(*) FILTER (WHERE liste_grubu IN ('Asil', 'Yedek') AND liste NOT IN ('Asil', 'Yedek'))::int AS liste_var,
      array_agg(DISTINCT program_kodu) FILTER (WHERE aile = 'SOGEP' AND program_kodu NOT ILIKE 'SOGEP%') AS sogep_disi,
      count(*) FILTER (WHERE ana_yasal_statu = 'Özel')::int AS ozel, count(*) FILTER (WHERE ana_yasal_statu = 'Özel Sektör')::int AS ozel_sektor
    FROM destek.v_projeler WHERE ${where} GROUP BY aile`, params as never[]);
  const metrics = (p.metrics.length ? p.metrics : []).map((m) => resolveMetric(m, basis) ?? m);
  const amounts = p.type !== "aggregate" || metrics.some((m) => METRICS[m]?.kind === "amount" || METRICS[m]?.kind === "ratio");
  for (const r of scope) {
    if (r.aile === "SOGEP" && r.sogep_disi?.length && !p.filters.program_kodu?.length) out.push(`SOGEP sayfasının tamamı sayıldı (İcmal gibi): ${r.sogep_disi.join(", ")} dahil.`);
    if (r.aile === "TD" && amounts) out.push(basis === "def" ? "TD (teknik destek): destek, yükleniciye ödenen maliyettir; Def-TL bütçesi ajansın İstatistik sayfasındaki gibi destekle aynı alındı." : "TD (teknik destek): destek, yükleniciye ödenen maliyettir; TD'de bütçe kolonu olmadığı için destek oranı TD hariç hesaplandı.");
    if (r.liste_var && metrics.some((m) => m === "asil_proje" || m === "yedek_proje")) out.push(`${r.aile}: ${r.liste_var} satırda liste "Asıl"/"Asıl-N"/"Yedek-N" yazılmış; İcmal formülü gibi Asil/Yedek sayısına girmedi.`);
    if (r.ozel && r.ozel_sektor && (p.group_by.includes("ana_yasal_statu") || p.filters.ana_yasal_statu?.length)) out.push(`Ana yasal statüde "Özel" (${r.ozel}) ve "Özel Sektör" (${r.ozel_sektor}) ayrı yazılmış; birleştirilmedi.`);
  }
  if (basis !== "def" && amounts && p.filters.yil?.in && p.filters.yil.in.length > 1) out.push("Farklı yılların nominal TL tutarları karşılaştırılıyor; reel karşılaştırma için Def-TL tabanı kullanılabilir.");
  const dq = await tx<{ kind: string; n: number }[]>`SELECT kind, count(*)::int AS n FROM destek.dq_issues WHERE snapshot_id = ${s.id} AND kind IN ('hata_degeri', 'formul_sonucu_yok') AND aile = ANY(${[...new Set(scope.map((r) => r.aile as string))]}::text[]) GROUP BY kind`;
  for (const d of dq) out.push(d.kind === "hata_degeri" ? `Kapsamdaki tablolarda ${d.n} hücrede Excel hata değeri (#DIV/0!, #VALUE!) var; bu hücreler boş sayıldı.` : `${d.n} formül hücresinin kayıtlı sonucu yok; boş sayıldı.`);
  void cat;
  return out;
}

function titleOf(p: Plan, basis: Basis): string {
  const t = { aggregate: "Destek verisi", list_projects: "Projeler", lookup_project: "Proje arama", metadata: "Dosya bilgisi" }[p.type];
  return `${t}${p.group_by.length ? ` · ${p.group_by.join(", ")} kırılımı` : ""} · ${basis === "def" ? "Def-TL" : basis === "nihai" ? "Nihai" : "Sözleşme"}`;
}

function scopeText(p: Plan): string {
  const f = p.filters;
  const parts: string[] = [];
  if (f.aile?.length) parts.push(`Aile=${f.aile.join("/")}`);
  if (f.program_kodu?.length) parts.push(`Program=${f.program_kodu.join("/")}`);
  if (f.yil) parts.push(`Yılı${f.yil.in?.length ? `=${f.yil.in.join("/")}` : ""}${f.yil.gte !== undefined ? `≥${f.yil.gte}` : ""}${f.yil.lte !== undefined ? `≤${f.yil.lte}` : ""}`);
  if (f.il?.length) parts.push(`İl=${f.il.join("/")}`);
  if (f.ilce?.length) parts.push(`İlçe=${f.ilce.join("/")}`);
  if (f.durum?.length) parts.push(`Durum=${f.durum.join("/")}`);
  if (f.ana_yasal_statu?.length) parts.push(`Ana statü=${f.ana_yasal_statu.join("/")}`);
  if (f.alt_yasal_statu?.length) parts.push(`Alt statü=${f.alt_yasal_statu.join("/")}`);
  if (f.sozlesme_imzalanan) parts.push("Sözleşme imzalanan");
  if (f.son_odeme_yili) parts.push(`Son ödeme yılı${f.son_odeme_yili.in?.length ? `=${f.son_odeme_yili.in.join("/")}` : ""}${f.son_odeme_yili.gte !== undefined ? `≥${f.son_odeme_yili.gte}` : ""}${f.son_odeme_yili.lte !== undefined ? `≤${f.son_odeme_yili.lte}` : ""}`);
  if (f.metin) parts.push(`Metin="${f.metin}"`);
  return parts.join(", ") || "tüm aileler";
}

function footerOf(p: Plan, basis: Basis, s: Snapshot, matched: number): string {
  const when = new Date(s.activated_at ?? s.loaded_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
  return `Kapsam: ${scopeText(p)} · Tutar tabanı: ${BASIS_LABEL[basis]} · Kaynak: ${s.file_name} (yükleme: ${when}) · ${matched} proje satırı`;
}

function textFor(r: DestekResult): string {
  const head = `| ${r.columns.map((c) => c.label).join(" | ")} |`;
  const line = `| ${r.columns.map(() => "---").join(" | ")} |`;
  const body = [...r.rows, ...(r.total ? [r.total] : [])].map((row) => `| ${row.join(" | ")} |`);
  return [
    "Tablo hesaplandı ve kullanıcıya uygulama tarafından gösteriliyor (yeniden yazma). Yorumun için değerler:",
    head, line, ...body, r.footer,
    ...(r.warnings.length ? [`Uyarılar: ${r.warnings.join(" ")}`] : []),
  ].join("\n");
}

function metadata(s: Snapshot, c: Catalog): { out: string } {
  const rows = s.report?.rows ?? {};
  return {
    out: [
      `Yüklü sürüm: ${s.file_name} (yükleme: ${new Date(s.activated_at ?? s.loaded_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}).`,
      `Aileler: ${Object.entries(rows).map(([a, r]) => `${a} ${r.loaded} proje${r.loaded ? "" : " (boş şablon)"}`).join(", ")}.`,
      `Program kodları: ${c.program_kodu.map((p) => `${p.kod} (${p.n})`).join(", ")}.`,
      `Yıllar: ${c.yil.join(", ")}. İller: ${c.il.join(", ")}.`,
    ].join("\n"),
  };
}
