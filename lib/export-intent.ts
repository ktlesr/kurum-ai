// Whether a message asks for its answer as a file ("bunu word olarak ver", "özeti pdf hazırla"), in which formats, and whether
// there is a question in it or it only means the answer before it. A wrong yes turns a question into a file, so it stays narrow:
// a document merely being talked about ("pdf'teki tablo", "excel dosyasını özetle", "word nasıl kaydedilir") is not a request.
import type { FileFormat } from "./export-doc.ts";

const NAMES: [FileFormat, string][] = [
  ["docx", "microsoft word|word|docx|\\.docx|doc"],
  ["pdf", "pdf|\\.pdf"],
  ["xlsx", "microsoft excel|excel|xlsx|\\.xlsx|xls"],
  ["md", "markdown|\\.md|md"],
  ["txt", "düz metin|metin dosyası|\\.txt|txt"],
  ["json", "\\.json|json"],
];
const L = "\\p{L}\\p{N}";
// Whole words only: "verilerini" is not "ver", "yazılımı" is not "yaz".
const ACTION = "(?:(?:ver|indir|indirt|hazırla|oluştur|çıkar|yap|kaydet|kayded|dönüştür|çevir|aktar|gönder|yaz|üret|al|dök|sun)(?:[ıiuü]n|[ıiuü]r|[ae]r|[ıiuü]n[ıiuü]z|ebilir|abilir|ebilirsin|abilirsin|ir misin|[ıiuü]r m[ıiuü]s[ıiuü]n)?|istiyorum|isterim)";
/** After the format's name: "… olarak", "… formatında", "… dosyası", then or without those a verb that makes something. */
const JOIN = "(?:['’]?(?:y?[ae]|[ıiuü]))?\\s*(?:(?:olarak|formatında|formatinda|biçiminde|biciminde|dosyası olarak|dosyasi olarak|belgesi olarak|çıktısı olarak)(?:\\s+" + ACTION + ")?(?=[^\\p{L}]|$)|(?:dosyası|dosyasi|belgesi|belgesini|dosyasını|çıktısı|çıktı)\\s+" + ACTION + "(?=[^\\p{L}]|$)|" + ACTION + "(?=[^\\p{L}]|$))";
/** Questions about the formats, or a file already there. */
const NOT_A_REQUEST = /(?:\bnasıl\b|\bnedir\b|\bneden\b|\bniçin\b|\bfarkı?\b|\bmümkün mü\b|\s(?:mı|mi|mu|mü)\s*\??$|olarak\s+(?:yükle|gelen|gönderdi|kayıtlı|paylaş|ekledi|attı))/u;
/** What only points at the answer before it. */
const FILLER = /(?:^|[^\p{L}])(?:bunu|şunu|bunları|şunları|bu|şu|o|onu|cevabı|cevabını|cevap|yanıtı|yanıtını|yanıt|son|önceki|yukarıdaki|üstteki|sonucu|sonuçları|metni|metin|içeriği|tabloyu|tabloları|tablo|özeti|listeyi|hepsini|tamamını|tümünü|lütfen|rica|ederim|şimdi|da|de|ve|veya|ya|ile|bir|dosya|dosyası|dosyasını|dosyaya|olarak|formatında|biçiminde|şeklinde|halinde|indirilebilir|indir|indirmek|indireyim|ver|verir|misin|misiniz|musun|yap|hazırla|oluştur|çıkar|kaydet|dönüştür|çevir|aktar|gönder|istiyorum|isterim|al|için|ayrıca)(?=$|[^\p{L}])/gu;

export interface ExportRequest { formats: FileFormat[]; /** The message without the file request; empty: it means the answer before it. */ rest: string }

export function exportRequest(message: string): ExportRequest | null {
  const text = message.trim();
  if (!text || text.length > 2000) return null;
  const q = text.toLocaleLowerCase("tr");
  // A question counts only where it is about the format, from its name on: "KOSGEB'e nasıl başvurulur, PDF olarak ver" asks
  // for a file; "pdf olarak nasıl veririm" doesn't.
  const fromThereOn = (at: number) => {
    const ends = [".", "?", "!", "\n"].map((c) => q.indexOf(c, at)).filter((i) => i >= 0);
    return q.slice(at, ends.length ? Math.min(...ends) : q.length);
  };
  const spans: [number, number][] = [];
  const asked: FileFormat[] = [];
  // The file request itself: the format, what joins it, the verb.
  for (const [format, names] of NAMES) {
    const re = new RegExp(`(?<![${L}.])(?:${names})${JOIN}`, "gu");
    for (const m of q.matchAll(re)) {
      if (NOT_A_REQUEST.test(fromThereOn(m.index))) continue;
      asked.push(format);
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  if (!asked.length) return null;
  // Others listed just before it: "word ve pdf olarak".
  for (const [format, names] of NAMES) {
    const re = new RegExp(`(?<![${L}.])(?:${names})(?:\\s*(?:,|ve|veya|ya da|\\+|/)\\s*)`, "gu");
    for (const m of q.matchAll(re)) {
      const end = m.index + m[0].length;
      if (spans.some(([a]) => a === end) || spans.some(([, b]) => b === m.index)) {
        if (!asked.includes(format)) asked.push(format);
        spans.push([m.index, end]);
      }
    }
  }
  // Widen until no list link is left out (three formats in a row).
  for (let again = true; again; ) {
    again = false;
    for (const [format, names] of NAMES) {
      const re = new RegExp(`(?<![${L}.])(?:${names})(?:\\s*(?:,|ve|veya|ya da|\\+|/)\\s*)`, "gu");
      for (const m of q.matchAll(re)) {
        const end = m.index + m[0].length;
        if (spans.some(([a]) => a === end) && !spans.some(([a, b]) => a === m.index && b === end)) {
          if (!asked.includes(format)) asked.push(format);
          spans.push([m.index, end]);
          again = true;
        }
      }
    }
  }
  let rest = "";
  let at = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (a > at) rest += `${text.slice(at, a)} `;
    at = Math.max(at, b);
  }
  rest += text.slice(at);
  // What held the request to the sentence goes with it.
  rest = rest.replace(/\s+/g, " ").replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, "").replace(/\s+(?:ve|ile|lütfen|ayrıca)$/iu, "").trim();
  const left = rest.toLocaleLowerCase("tr").replace(FILLER, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return { formats: [...new Set(asked)], rest: left ? rest : "" };
}
