// The query plan (prompt §5): the chat tool's input IS this plan, so the model's tool call is the planner (no second
// model call). Checked with zod; anything unknown is refused with a message the model gets back once.
import { z } from "zod";
import { DIM_NAMES, METRIC_NAMES } from "./semantic.ts";

const years = z.object({
  in: z.array(z.number().int().min(1990).max(2100)).max(40).optional().describe("Bu yıllar"),
  gte: z.number().int().min(1990).max(2100).optional().describe("Bu yıl ve sonrası"),
  lte: z.number().int().min(1990).max(2100).optional().describe("Bu yıl ve öncesi"),
}).strict();
const names = (what: string) => z.array(z.string().min(1).max(80)).max(30).optional().describe(what);

export const PLAN = z.object({
  type: z.enum(["aggregate", "list_projects", "lookup_project", "metadata"]).describe(
    "aggregate: sayım/toplam/oran (gruplu ya da değil); list_projects: proje satırları (sıralı, ör. en çok destek alan 10 proje); lookup_project: adıyla bir proje/başvuru sahibi bulma; metadata: dosyada hangi yıllar, programlar, iller var, hangi sürüm yüklü"),
  filters: z.object({
    aile: names("Program ailesi (sayfa): PTÇ, GPD, FND, FKD, DFD-FZD, TD, SOGEP, Diğer"),
    program_kodu: names("Program kısaltması, ör. SOGEP25, 2021 TD, BPHGMDP"),
    yil: years.optional().describe("Yılı kolonu: programın/çağrının yılı (ödeme yılı değil)"),
    il: names("İl adı"),
    ilce: names("İlçe adı"),
    durum: z.array(z.enum(["Tamamlandı", "Devam Ediyor", "U.D."])).max(3).optional().describe("Proje tamamlanma durumu"),
    ana_yasal_statu: names("Ana yasal statü, ör. Kamu, STK, Özel Sektör, Kooperatif"),
    alt_yasal_statu: names("Alt yasal statü, ör. Belediye"),
    sozlesme_imzalanan: z.boolean().optional().describe("true: yalnızca sözleşme imzalanmış projeler"),
    son_odeme_yili: years.optional().describe("Son ödemenin yapıldığı yıl"),
    metin: z.string().min(2).max(120).optional().describe("Başvuru sahibi, proje adı ya da yüklenici adında geçen kelimeler"),
  }).strict().default({}),
  group_by: z.array(z.enum(DIM_NAMES as [string, ...string[]])).max(3).default([]).describe("Gruplanacak boyutlar (aggregate)"),
  metrics: z.array(z.enum(METRIC_NAMES as [string, ...string[]])).max(12).default([]).describe("Hesaplanacak metrikler (aggregate); destek/butce/es_finansman/destek_orani amount_basis'e göre"),
  amount_basis: z.enum(["default", "sozlesme", "nihai", "def"]).default("default").describe("Tutar tabanı; kullanıcı söylemediyse default"),
  order_by: z.array(z.object({ field: z.string().min(1).max(60), dir: z.enum(["asc", "desc"]).default("desc") }).strict()).max(3).default([]),
  limit: z.number().int().min(1).max(200).optional(),
  include_total_row: z.boolean().default(true),
  clarification: z.string().max(300).optional().describe("Soru belirsizse ve varsayılanı yoksa: kullanıcıya sorulacak tek soru (başka alan doldurma)"),
}).strict();

export type Plan = z.infer<typeof PLAN>;

/** The tool's parameters: the plan's JSON Schema (draft-07, no $refs: one object the chat server passes as is). */
export function planJsonSchema(): object {
  const s = z.toJSONSchema(PLAN, { target: "draft-7", io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** The model's arguments read: the plan, or a message saying exactly what is wrong. */
export function readPlan(args: string): { plan: Plan } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(args || "{}");
  } catch {
    return { error: "HATA: argümanlar JSON olarak okunamadı." };
  }
  const r = PLAN.safeParse(raw);
  if (r.success) return { plan: r.data };
  const msg = r.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "plan"}: ${i.message}`).join("; ");
  return { error: `HATA: sorgu planı geçersiz (${msg}). Geçerli metrikler: ${METRIC_NAMES.join(", ")}. Boyutlar: ${DIM_NAMES.join(", ")}.` };
}
