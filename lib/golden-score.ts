// Scoring of the golden test set (scripts/eval-golden.mjs), here so a test holds it to the app's own wording.
// Same number reading as lib/checks normNum: Turkish first.

export const normNum = (s: string) => {
  const dot = s.lastIndexOf("."), comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) return dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  if (/^-?[1-9]\d{0,2}([.,]\d{3})+$/.test(s) && (dot >= 0 || s.indexOf(",") !== comma)) return s.replace(/[.,]/g, "");
  return s.replace(",", ".");
};
const low = (s: string) => s.toLocaleLowerCase("tr").replace(/\s+/g, " ");
const NUMBER = /-?\d+(?:[.,]\d+)*/g;
/** Lower case, every number in one notation ("1.250.000" and "1250000" alike), so text and numbers compare fairly. */
const canon = (s: string) => ` ${low(s).replace(NUMBER, (m) => String(parseFloat(normNum(m))))} `;

/**
 * A required token is in the answer. A bare number must be one of the answer's numbers (20 isn't found in 120, -5
 * isn't 5); a token with words must appear as a whole, numbers normalised ("30 milyon" isn't "30 m²").
 */
export function has(answer: string, token: string): boolean {
  if (/^\s*-?\d+(?:[.,]\d+)*\s*$/.test(token)) return new Set(canon(answer).match(/-?\d+(?:\.\d+)?/g) ?? []).has(canon(token).trim());
  const c = canon(answer);
  const t = canon(token).trim();
  // Not preceded by a sign or a decimal part either: "5 milyon" isn't inside "0.5 milyon" or "-5 milyon".
  return new RegExp(`(^|[^\\p{L}\\p{N}.\\-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|(?!\\.\\d)[^\\p{L}\\p{N}])`, "u").test(c);
}

/**
 * "Not in the document" said up front (first two sentences), not as an aside after giving figures. The app's own two
 * answers count ("Belgede yok.", "Sunulan belge bölümlerinde yok." from app/api/chat/route.ts): the scorer once missed
 * them and marked the app's most exact answer wrong.
 */
const REFUSAL = /(belgede yok|bölümlerinde yok|bulunmuyor|bulunmamaktadır|yer almıyor|yer almamaktadır|belirtilmemiş|belirtilmiyor|bilgi yok|bilgisi yok|geçmiyor|içermiyor|bulunamadı|yer verilmemiş|rastlanmadı|mevcut değil|bilgi bulunmamaktadır)/;
export const refuses = (answer: string) => REFUSAL.test(low(answer).split(/(?<=[.!?])\s/).slice(0, 2).join(" "));

export const citedPages = (answer: string) => [...answer.matchAll(/\bSayfa\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi)].flatMap((m) => (m[2] ? Array.from({ length: Math.min(50, +m[2] - +m[1] + 1) }, (_, i) => +m[1] + i) : [+m[1]]));

/**
 * The request's processing options, as the app's UI sends them (app/chat.tsx send): "deep" reads the whole document
 * with thinking off, so the score measures what users get. Thinking is a separate switch, for comparing models.
 */
export const profileOptions = (profile: string | undefined, think: boolean) => ({ ...(profile === "deep" ? { scope: "all" } : {}), ...(think ? { think: true } : {}) });
