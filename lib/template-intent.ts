// "Bilgileri şablona aktar", "bu formu belgeden doldur": a template to fill, in words. Stays narrow: a wrong yes takes a question
// away from the chat. Talk about a template ("şablon nedir", "şablondaki tarih ne"), "form işlemleri" and "formu doldurma" aren't requests.
const NOUN = "(?:şablon|sablon|template|boş form|form)";
const CASE = "(?:un|unu|umu|umuzu|a|u|ü|ı|i|e|ya|ye|yu|yü|yı|yi|ma|me|muza|ları|leri|lara|lere|daki)?";
// The verb as a request only: "doldur", "doldurun", "doldurabilir misin", "doldurur musun", "doldurmak". Not "doldurma", "işlemleri", "yazılımı".
const VERB = "(?:aktar|doldur|işle|geçir|yerleştir|yaz)(?:y?[ıiuü]n(?:[ıiuü]z)?|y?[ae]bilir\\p{L}*|[ıiuü]?r|[ae]r|m[ae]k|m[ae]n[ıi]\\p{L}*)?";

export function asksTemplateFill(message: string): boolean {
  const q = message.toLocaleLowerCase("tr").trim();
  if (!q || q.length > 2000) return false;
  if (/(?:^|\s)(?:nedir|nasıl|neden|niçin)(?:\s|\?|$)/u.test(q)) return false;
  // "Formu doldurma, eksikleri yaz": told not to, whatever verb comes later.
  if (/(?<!\p{L})(?:aktar|doldur|geçir|yerleştir)m[ae](?:y\p{L}*)?(?=[\s.,;!?]|$)/u.test(q)) return false;
  // Only a request for doing it: "şablona aktar", "şablonu doldur", "bilgileri … şablona yaz".
  return new RegExp(`(?<![\\p{L}])${NOUN}${CASE}(?![\\p{L}])(?:\\s+\\S+){0,6}?\\s+${VERB}(?=[\\s.,!?]|$)`, "u").test(q)
    || new RegExp(`(?<![\\p{L}])${VERB}\\s+(?:\\S+\\s+){0,3}${NOUN}${CASE}(?![\\p{L}])`, "u").test(q);
}
