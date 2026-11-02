// Mails each user their own sign-in details through İletişim Makinesi. Without --gonder nothing leaves this computer.
//
//   node --env-file=.env.dokploy scripts/send-credentials.ts gonderim/liste.csv            check the list, write a preview
//   node --env-file=.env.dokploy scripts/send-credentials.ts --kontrol                     sign in, list the sender names
//   node --env-file=.env.dokploy scripts/send-credentials.ts --test=ben@kurum.gov.tr --gonderici=ID     one sample, made-up details
//   node --env-file=.env.dokploy scripts/send-credentials.ts gonderim/liste.csv --gonderici=ID --gonder --onay=KİŞİ_SAYISI
//
// The list (csv or xlsx) has the columns kullanici, parola, eposta and optionally ad. Keep it in gonderim/: git ignores that
// folder. Sent mails are noted, without passwords, in gonderim/gonderilenler.jsonl, so running again never mails anyone twice.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import XLSX from "xlsx";
import { readRecipients, renderMail } from "../lib/credentials-mail.ts";
import { callProvider, sendMailWith, signIn } from "../lib/iletisim.ts";

const FOLDER = "gonderim";
const LOG = `${FOLDER}/gonderilenler.jsonl`;
const LOCK = `${FOLDER}/gonderim.kilit`;
const EMAIL_SERVICE_ID = "5"; // The provider's number for its e-mail service.

const args = process.argv.slice(2);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => args.includes(`--${name}`);
const file = args.find((a) => !a.startsWith("--"));
const stop = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const signInOrStop = () => signIn().catch((e: Error) => stop(e.message));

mkdirSync(FOLDER, { recursive: true });

if (has("kontrol")) {
  const answer = await callProvider("UserGatewayWS/functions/getOriginators", { token: await signInOrStop(), serviceId: EMAIL_SERVICE_ID });
  if (!answer.ok) stop(`Gönderici adları alınamadı: ${answer.message}`);
  console.log("Giriş başarılı. E-posta gönderici adları:");
  for (const o of answer.originators) console.log(`  ${o.id}  ${o.name}`);
  if (!answer.originators.length) console.log("  (yok; sağlayıcıdan gönderici adı tanımlanmalı)");
  process.exit(0);
}

const originator = option("gonderici");
const testTo = option("test");
if (testTo) {
  if (!originator) stop("--gonderici=ID gerekli. Kimlikleri --kontrol listeler.");
  const answer = await sendMailWith(await signInOrStop(), originator!, { email: testTo, name: "Örnek Kullanıcı", username: "ornek.kullanici", password: "ornek-parola-123" });
  console.log(answer.ok && answer.validAddresses === 1 ? `Örnek gönderildi (işlem ${answer.transactionId}).` : `Gönderilemedi: ${answer.message}`);
  process.exit(answer.ok && answer.validAddresses === 1 ? 0 : 1);
}

if (!file) stop("Kullanım: dosyanın başındaki açıklamaya bakın.");
if (!existsSync(file!)) stop(`Liste bulunamadı: ${file}`);
/** Excel saves a CSV as UTF-8 or as Windows Turkish, depending on which CSV was chosen; a wrong guess would mail a wrong password. */
function decodeCsv(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1254").decode(bytes);
  }
}
const bytes = readFileSync(file!);
const book = /\.xlsx?$/i.test(file!) ? XLSX.read(bytes, { raw: true }) : XLSX.read(decodeCsv(bytes), { type: "string", raw: true });
const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: "" });
const { recipients, errors, warnings } = readRecipients(rows);
for (const w of warnings) console.warn(`Uyarı: ${w}`);
if (errors.length) stop(`Liste düzeltilmeli, kimseye gönderilmedi:\n${errors.map((e) => `  ${e}`).join("\n")}`);

// Two runs at once would both mail everyone. Taken before the record is read, so what is read stays true.
if (has("gonder")) {
  try {
    closeSync(openSync(LOCK, "wx"));
  } catch {
    stop(`Başka bir gönderim çalışıyor. Çalışmıyorsa ${LOCK} dosyasını silin ve önce kaydı kontrol edin.`);
  }
  process.on("exit", () => rmSync(LOCK, { force: true }));
}

const logged = existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { username: string; email: string; status: string }) : [];
const key = (r: { username: string; email: string }) => `${r.username} ${r.email}`;
// A person's last line decides. "gonderilmedi" means the provider refused, so they are still to be mailed.
const last = new Map(logged.map((l) => [key(l), l]));
const unknown = [...last.values()].filter((l) => l.status === "belirsiz");
const waiting = recipients.filter((r) => (last.get(key(r))?.status ?? "gonderilmedi") === "gonderilmedi");

if (!has("gonder")) {
  writeFileSync(`${FOLDER}/onizleme.html`, renderMail({ name: "Örnek Kullanıcı", username: "ornek.kullanici", password: "ornek-parola-123" }));
  console.log(`Liste sağlam: ${recipients.length} kişi, ${waiting.length} kişiye gidecek, ${recipients.length - waiting.length} kişiye daha önce gitmiş.`);
  for (const r of waiting) console.log(`  ${r.username.padEnd(24)} ${r.email}`);
  console.log(`Önizleme: ${FOLDER}/onizleme.html. Hiçbir şey gönderilmedi.`);
  process.exit(0);
}

if (!originator) stop("--gonderici=ID gerekli. Kimlikleri --kontrol listeler.");
if (option("onay") !== String(waiting.length)) stop(`Bu gönderim ${waiting.length} kişiye gidecek. Onay için --onay=${waiting.length} ekleyin.`);
if (unknown.length) stop(`Sonucu belli olmayan gönderim var (${unknown.map((u) => u.username).join(", ")}). Sağlayıcı raporundan bakın; gitmediyse satırlarını ${LOG} dosyasından silip yeniden çalıştırın.`);

const token = await signInOrStop();
let sent = 0;
for (const r of waiting) {
  const note = (status: string, extra: object = {}) => appendFileSync(LOG, `${JSON.stringify({ username: r.username, email: r.email, status, at: new Date().toISOString(), ...extra })}\n`);
  // Noted before it goes: if this program dies between the two, the person is unknown, not unmailed.
  note("belirsiz");
  try {
    const answer = await sendMailWith(token, originator!, r);
    // Cut short or not the provider's: it may have gone out all the same.
    if (!answer.understood || (answer.ok && answer.validAddresses === undefined)) throw new Error("Beklenmeyen cevap");
    if (!answer.ok || answer.validAddresses !== 1) {
      // Running again tries this person again. Most refusals would hit everyone, hence the stop.
      note("gonderilmedi");
      stop(`${r.username}: gönderilemedi (${answer.message}). ${sent} kişiye gitti, durduruldu.`);
    }
    note("gonderildi", { transactionId: answer.transactionId });
    sent++;
    console.log(`${sent}/${waiting.length}  ${r.username}  ${r.email}`);
  } catch (e) {
    // No answer: it may have gone out. Never guessed; it stays unknown until someone looks at the provider's report.
    stop(`${r.username}: cevap alınamadı (${(e as Error).name}), gidip gitmediği belirsiz. ${sent} kişiye gitti, durduruldu.`);
  }
  await new Promise((done) => setTimeout(done, 300));
}
console.log(`Bitti: ${sent} kişiye gönderildi. Kayıt: ${LOG}`);
