// "Uşak kilim projesinin resimlerinden 3 tanesini getir": photos from the archive, not a question for the model. Stays narrow: a
// wrong yes takes a question away from the chat. "Belgedeki resmi anlat", "resim çiz", "bu fotoğrafta ne var" aren't requests.
const NOUN = "(?:resim|resmi|fotoğraf|foto|görsel|galeri|video|film|klip|klib)";
const VERB = "(?:getir|göster|bul|listele)(?:ir|in|iniz|sene|ebilir|abilir|ir misin|ir misiniz|ebilir misin|abilir misin)?";
const ABOUT_A_FILE = /(?:belge|dosya|pdf|word|excel|sunum|internet|web|google|sayfa|site)/u;
const ABOUT_MAKING = /(?:\bçiz|\boluştur|\btasarla|\büret|\bhazırla|\byap\b)/u;
const QUESTION = /(?:\bnedir\b|\bnasıl\b|\bneden\b|\bne var\b|\bkim\b|\bkaç\b.*\bvar\b)/u;

export function asksPhotos(message: string): boolean {
  const q = message.toLocaleLowerCase("tr").trim();
  if (!q || q.length > 300 || ABOUT_A_FILE.test(q) || ABOUT_MAKING.test(q) || QUESTION.test(q)) return false;
  return new RegExp(`(?<![\\p{L}])${NOUN}[\\p{L}]*(?:\\s+\\S+){0,5}?\\s+${VERB}(?=[\\s.,!?]|$)`, "u").test(q);
}

/** "3 tane daha", "daha fazla göster": goes on with the photos just shown. */
export function asksMorePhotos(message: string): boolean {
  return /^(?:\d{1,2}\s*(?:tane\s*)?|bir\s*kaç\s*(?:tane\s*)?|birkaç\s*(?:tane\s*)?)?daha(?:\s+fazla)?(?:\s+(?:tane|resim|fotoğraf|foto|görsel|video))?(?:\s+(?:göster|getir|bul))?\s*[.!?]*$/u.test(message.toLocaleLowerCase("tr").trim());
}
