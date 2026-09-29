import { cptFor, docs, NUM_CTX, OLLAMA_URL, recordTokens, type Doc } from "@/lib/server";
import { contextBudget, contextRatio, META_SEP, STATUS_SEP, type ChatMeta } from "@/lib/context";
import { verifyNumbers } from "@/lib/checks";
import { EMBED_MODEL, retrieve, TOP_K, windows } from "@/lib/rag";

export const runtime = "nodejs";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

type OllamaMsg = { role: "system" | "user" | "assistant"; content: string };

const SYSTEM = `Yalnızca verilen doküman içeriğine dayanarak cevap ver. Bilgi dokümanda yoksa açıkça "dokümanda bu bilgi yok" de; tahmin yürütme, bilgi uydurma.
Mümkünse sayfa numarasını ("Sayfa 4") ya da sayfa adını ("Sheet: Bütçe") belirt.
Sayıları dokümanda yazdığı gibi aktar; kendin hesap yapma, yuvarlama.
"(?)" ile işaretli sayılar iki bağımsız okumanın uyuşmadığı belirsiz değerlerdir; kullanırsan "belirsiz okuma" diye belirt.
"[Kod kontrolü]" satırları yazılımın okunan değerlerden hesapladığı kontrollerdir; bir kriterin sağlanıp sağlanmadığını söylerken bunları esas al.
"[İkinci okuma …]" bölümleri aynı tablonun görsel modelle yapılmış ikinci okumasıdır.
Sayfa başındaki "(Önceki sayfalardan süren bölüm: …)" notu, o sayfadaki tabloların hangi bölüme (ör. hangi bina ve analiz) ait olduğunu gösterir; bir tabloyu bir bölüme bağlarken bunu esas al.
Kullanıcının dilinde cevap ver. Markdown kullanabilirsin (tablolar dahil).`;

const CLASSIFY = `Aşağıdaki soru bir dokümana soruluyor. Cevaplamak için dokümanın TAMAMINI okumak mı gerekir (özet, genel değerlendirme, tüm maddeleri/rakamları listeleme, tutarlılık kontrolü, karşılaştırma), yoksa dokümandaki BELİRLİ bir bilgiyi bulmak yeterli mi? Yalnızca TÜM ya da BELİRLİ yaz.`;

const SCAN = (q: string, where: string) =>
  `Soru: ${q}

Dokümanın yalnızca bir bölümünü görüyorsun (${where}). Bu bölümde soruyla ilgili olan tüm bilgileri madde madde çıkar: sayfa numarasıyla, sayıları aynen aktararak, yorum katmadan. Soruyla ilgili bir şey yoksa yalnızca "İLGİLİ BİLGİ YOK" yaz.`;

// ponytail: fixed caps; thinking tokens count toward them too
const MAX_ANSWER = 8192;
const MAX_NOTES = 2048;

const fail = (error: string, status: number) => Response.json({ error }, { status });

// gpt-oss cannot switch reasoning off, only down
const thinkParam = (model: string, think: boolean) => (model.startsWith("gpt-oss") ? (think ? "high" : "low") : think);

/**
 * One Ollama chat call, always streamed: long generations would otherwise hit fetch's 5-minute
 * no-data timeout. onText gets answer pieces, onThinking the running count of reasoning chunks.
 */
async function streamChat(
  model: string,
  messages: OllamaMsg[],
  think: boolean,
  signal: AbortSignal,
  onText: (piece: string) => void = () => {},
  onThinking: (n: number) => void = () => {},
  numPredict?: number,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal,
    body: JSON.stringify({
      model,
      stream: true,
      think: thinkParam(model, think),
      // Same num_ctx as every other call: a different value makes Ollama reload the model.
      // Always capped: at temperature 0 a model can fall into a repetition loop and generate until num_ctx
      // (seen: 58k tokens, ~15 min), blocking Ollama for every later request.
      options: { num_ctx: NUM_CTX, temperature: 0, num_predict: numPredict ?? MAX_ANSWER },
      messages,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama hata döndürdü (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let thought = 0;
  const handle = (line: string) => {
    if (!line.trim()) return;
    const j = JSON.parse(line) as { message?: { content?: string; thinking?: string }; error?: string; done?: boolean; done_reason?: string; prompt_eval_count?: number };
    if (j.error) throw new Error(j.error);
    if (j.message?.thinking) onThinking(++thought);
    if (j.message?.content) {
      text += j.message.content;
      onText(j.message.content);
    }
    if (j.done_reason === "length" && text && !numPredict) onText("\n\n…(cevap uzunluk sınırında kesildi)");
    if (j.done && j.prompt_eval_count) recordTokens(model, messages.reduce((n, m) => n + m.content.length, 0), j.prompt_eval_count);
  };
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buf);
  return text;
}

const chatOnce = async (model: string, messages: OllamaMsg[], signal: AbortSignal, numPredict?: number) =>
  (await streamChat(model, messages, false, signal, undefined, undefined, numPredict)).trim();

export async function POST(req: Request) {
  const { model, fileIds, messages, think = false, scope } = (await req.json()) as {
    model: string;
    fileIds: string[];
    messages: Msg[];
    think?: boolean;
    /** "all" = question needs the whole document (suggestion buttons know this); otherwise classified. */
    scope?: "all";
  };

  const selected = fileIds.map((id) => docs.get(id)) as Doc[];
  if (selected.some((d) => !d)) {
    return fail("Dosya sunucuda bulunamadı. Dosyayı kaldırıp tekrar yükleyin.", 409);
  }
  const ok = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
  if (!ok) return fail("Ollama çalışmıyor — `ollama serve` komutunu çalıştırın.", 503);

  const signal = req.signal; // Esc in the UI aborts generation in Ollama too
  const history = messages.slice(-8); // ponytail: last 8 turns only; long chats could still overflow num_ctx
  const question = messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content).join("\n");
  const totalChars = selected.reduce((n, d) => n + d.chars, 0);
  const fits = contextRatio(totalChars, NUM_CTX, cptFor(model)) >= 1;
  const enc = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (s: string) => ctrl.enqueue(enc.encode(s));
      const status = (s: string) => send(STATUS_SEP + s + STATUS_SEP);
      const meta: ChatMeta = { mode: "full", sources: selected.map((d) => d.name), unverified: [], uncertain: [] };
      let answer = "";
      try {
        let context: string;
        let hint = "";
        if (fits) {
          context = selected.map((d) => `<doküman ad="${d.name}">\n${d.text}\n</doküman>`).join("\n\n");
        } else {
          let whole = scope === "all";
          if (!whole) {
            status("Soru türü belirleniyor…");
            whole = /TÜM|TUM/i.test(await chatOnce(model, [{ role: "system", content: CLASSIFY }, { role: "user", content: question }], signal, 5));
          }
          if (whole) {
            // Map: pull what's relevant out of each window. Reduce: answer from those notes.
            const wins = windows(selected, Math.floor(contextBudget(NUM_CTX, cptFor(model)) * 0.85));
            const notes: string[] = [];
            for (const [i, w] of wins.entries()) {
              const where = `${w.doc} · ${w.label}`;
              status(`Doküman bölüm bölüm taranıyor: ${i + 1}/${wins.length} (${where})`);
              const n = await chatOnce(model, [{ role: "system", content: `${SYSTEM}\n\n<bölüm konum="${where}">\n${w.text}\n</bölüm>` }, { role: "user", content: SCAN(question, where) }], signal, MAX_NOTES);
              if (!/İLGİLİ BİLGİ YOK/i.test(n) || n.length > 40) notes.push(`<notlar konum="${where}">\n${n}\n</notlar>`);
            }
            meta.mode = "scan";
            meta.sources = wins.map((w) => (selected.length > 1 ? `${w.doc} · ${w.label}` : w.label));
            hint = `\n\nDoküman bağlama sığmadığı için bölüm bölüm tarandı; aşağıda her bölümden soruyla ilgili çıkarılan notlar var (baştan sona sırayla). Cevabı yalnızca bu notlara dayandır ve TÜM bölümlerin notlarını birleştir; tek bir bölüme odaklanma.`;
            // ponytail: one reduce pass; each section's notes get an equal share of the budget so the end of the
            // document (often the conclusion) isn't the part that gets cut. A second map round would lift the cap.
            const share = Math.floor((contextBudget(NUM_CTX, cptFor(model)) * 0.85) / Math.max(1, notes.length));
            context = notes.map((n) => (n.length > share ? `${n.slice(0, share)}\n…(kısaltıldı)` : n)).join("\n\n") || "(Hiçbir bölümde soruyla ilgili bilgi bulunamadı.)";
          } else {
            status("İlgili bölümler aranıyor…");
            try {
              const chunks = await retrieve(selected, question, signal);
              meta.mode = "rag";
              meta.sources = [...new Set(chunks.map((c) => (selected.length > 1 ? `${c.doc} · ${c.label}` : c.label)))];
              hint = `\n\nAşağıda dokümanın soruyla en ilgili ${TOP_K} bölümü var; dokümanın tamamı değil.`;
              context = chunks.map((c) => `<bölüm doküman="${c.doc}" konum="${c.label}">\n${c.text}\n</bölüm>`).join("\n\n");
            } catch (e) {
              if (signal.aborted) throw e;
              const ratio = contextRatio(totalChars, NUM_CTX, cptFor(model));
              meta.mode = "truncated";
              meta.note = `Parça arama çalışmadı (${EMBED_MODEL}: ${(e as Error).message}); dosyaların yalnızca ilk %${Math.floor(ratio * 100)}'i kullanıldı.`;
              context = selected.map((d) => `<doküman ad="${d.name}">\n${d.text.slice(0, Math.floor(d.chars * ratio))}\n</doküman>`).join("\n\n");
            }
          }
        }
        if (think) status("Düşünüyor…");
        const final: OllamaMsg[] = [{ role: "system", content: `${SYSTEM}${hint}\n\n${context}` }, ...history];
        answer = await streamChat(model, final, think, signal, send, (n) => {
          // Keeps the connection busy and shows the wait isn't stuck.
          if (n % 50 === 0) status(`Düşünüyor… (${n} adım)`);
        });

        // Numbers the user typed count as known too (not earlier answers — they may be the hallucination).
        const source = [...selected.map((d) => d.text), ...messages.filter((m) => m.role === "user").map((m) => m.content)].join("\n");
        Object.assign(meta, verifyNumbers(answer, source));
        send(META_SEP + JSON.stringify(meta));
      } catch (e) {
        if (!signal.aborted) {
          console.error(e);
          send(`\n\n**Hata:** ${(e as Error).message}`);
        }
      }
      try { ctrl.close(); } catch {}
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
