// Reading quality flags (plan §5.2): signs that the extracted text isn't the document's text — image-only pages that
// need OCR, Turkish letters decoded with the wrong code page, unreadable characters, pages of symbols. Each becomes a
// short note on the document, so the user knows which answers to double-check. Pure; node --test covers it.

const visible = (s: string) => s.replace(/\s/g, "").length;
const pageList = (ps: number[]) => (ps.length > 8 ? `${ps.slice(0, 8).join(", ")} …` : ps.join(", "));

/** Pages by their "--- Sayfa N ---" markers (PDF, DOCX via Docling); [] when the text has none. */
function pagesOf(text: string): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  const re = /^--- Sayfa (\d+) ---$/gm;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => out.push({ n: Number(m[1]), text: text.slice(m.index! + m[0].length, marks[i + 1]?.index ?? text.length) }));
  return out;
}

export function qualityNotes(text: string): string[] {
  const notes: string[] = [];
  const pages = pagesOf(text);
  if (pages.length >= 2) {
    const counts = pages.map((p) => visible(p.text));
    const sorted = [...counts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Mostly text, a few nearly empty pages: those are images (a scan, a chart, a signed page) the text layer lacks.
    const empty = pages.filter((_, i) => counts[i] < 20).map((p) => p.n);
    if (median >= 200 && empty.length) notes.push(`Sayfa ${pageList(empty)} neredeyse boş okundu: görüntü (taranmış sayfa, grafik) olabilir; bu sayfalardaki bilgi cevaplara girmeyebilir.`);
    // A page of symbols, not words or figures: a broken font encoding or a table turned into noise. Dot leaders of
    // a table of contents ("Giriş ........ 3") and rules ("-----") are layout, not noise; number tables are fine.
    const noisy = pages
      .filter((p) => {
        const t = p.text.replace(/[.…\-_=·]{3,}/g, ""); // a plain class run: no backtracking, no stack depth
        const v = visible(t);
        return v > 200 && (t.match(/[\p{L}\p{N}]/gu)?.length ?? 0) / v < 0.45;
      })
      .map((p) => p.n);
    if (noisy.length) notes.push(`Sayfa ${pageList(noisy)} düzgün okunamamış olabilir (metinde çok sayıda simge var); bu sayfalara dayanan cevapları orijinalden kontrol edin.`);
  }
  // Turkish read with the wrong code page: "Ý þ ð" (Windows-1254 shown as 1252) or "Ã§ Ã¼ Ä±" (UTF-8 shown as Latin-1).
  const latin = (text.match(/[ÝÞÐýþð]/g) ?? []).length;
  const turkish = (text.match(/[ığşİĞŞ]/g) ?? []).length;
  const utf8 = (text.match(/Ã[\u0080-¿§¶¼¤]|Ä[\u0080-¿±°]|Å[\u0080-¿]/g) ?? []).length;
  if ((latin >= 5 && latin > turkish) || utf8 >= 5) notes.push("Türkçe harfler bozuk görünüyor (ör. Ý, þ, ð ya da Ã§): dosya farklı bir karakter kodlamasıyla kaydedilmiş olabilir. Arama ve cevaplarda bu kelimeler eşleşmeyebilir.");
  const bad = (text.match(/�/g) ?? []).length;
  if (bad >= 5) notes.push(`Metinde ${bad} okunamayan karakter (�) var; bazı kelimeler eksik okunmuş olabilir.`);
  return notes;
}
