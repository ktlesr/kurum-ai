// The mail carrying a user's sign-in details, and the list it is sent from. Pure so it can be tested; sending is in
// scripts/send-credentials.ts. The HTML is tables and inline styles: mail clients ignore most else. No remote image, so it
// looks the same with images blocked and tells nobody when it was opened.
import { USERNAME_RE, passwordProblem } from "./password.ts";

export const SIGN_IN_URL = "https://ai.zafer.gov.tr";
export const MAIL_SUBJECT = "Zafer AI hesap bilgileriniz";
export const MAIL_PREVIEW = "Zafer AI'a giriş için kullanıcı adınız ve parolanız";

export interface Recipient { username: string; password: string; email: string; name: string }
export interface RecipientList { recipients: Recipient[]; errors: string[]; warnings: string[] }

const EMAIL_RE = /^[^\s@;,<>"']+@[^\s@;,<>"']+\.[^\s@;,<>"'.]+$/;
const headerOf = (cell: string) => cell.trim().toLocaleLowerCase("tr").replace(/[\s_-]+/g, "");
const COLUMNS: Record<keyof Recipient, string[]> = {
  username: ["kullanıcı", "kullanıcıadı", "kullanici", "kullaniciadi", "username"],
  password: ["parola", "şifre", "sifre", "password"],
  email: ["eposta", "email", "mail"],
  name: ["ad", "adsoyad", "isim", "name"],
};

/** Rows of a sheet, the first one naming the columns. Any problem is reported by line, and nothing should be sent until there are none. */
export function readRecipients(rows: unknown[][]): RecipientList {
  const out: RecipientList = { recipients: [], errors: [], warnings: [] };
  const header = (rows[0] ?? []).map((c) => headerOf(String(c ?? "").replace(/^﻿/, "")));
  const at = (key: keyof Recipient) => header.findIndex((h) => COLUMNS[key].includes(h));
  const where = { username: at("username"), password: at("password"), email: at("email"), name: at("name") };
  for (const key of ["username", "password", "email"] as const) {
    if (where[key] < 0) out.errors.push(`"${COLUMNS[key][0] === "kullanıcı" ? "kullanici" : COLUMNS[key][0]}" sütunu yok.`);
  }
  if (out.errors.length) return out;
  const usernames = new Set<string>();
  const emails = new Set<string>();
  rows.slice(1).forEach((row, i) => {
    const cell = (n: number) => (n < 0 ? "" : String(row[n] ?? "").trim());
    const line = i + 2;
    if (!row.some((c) => String(c ?? "").trim())) return;
    // The panel's list marks a name starting with - or . with a ' so a spreadsheet won't take it for a formula.
    const username = cell(where.username).replace(/^'/, "").toLowerCase();
    // As typed: spaces around a password are part of it, at sign-up and at sign-in.
    const password = String(row[where.password] ?? "");
    const email = cell(where.email).toLowerCase();
    const problems = [
      !USERNAME_RE.test(username) && "kullanıcı adı geçersiz",
      passwordProblem(password),
      !EMAIL_RE.test(email) && "e-posta geçersiz",
      usernames.has(username) && "bu kullanıcı listede iki kez var",
    ].filter(Boolean);
    if (problems.length) return void out.errors.push(`${line}. satır (${username || "adsız"}): ${problems.join(", ")}`);
    if (emails.has(email)) out.warnings.push(`${line}. satır: ${email} adresine birden çok hesap gidecek.`);
    usernames.add(username);
    emails.add(email);
    out.recipients.push({ username, password, email, name: cell(where.name) });
  });
  if (!out.recipients.length && !out.errors.length) out.errors.push("Listede kimse yok.");
  return out;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FONT = "font-family:Arial,Helvetica,sans-serif";
const MONO = "font-family:Consolas,Menlo,'Courier New',monospace";
const field = (label: string, value: string) =>
  `<tr><td style="padding:12px 16px 2px;${FONT};font-size:12px;color:#4e6075">${label}</td></tr><tr><td style="padding:0 16px 12px;${MONO};font-size:16px;font-weight:bold;color:#14263d;white-space:pre-wrap;word-break:break-all">${escapeHtml(value)}</td></tr>`;

/** The site's light theme, as colours spelled out: --bg, --panel, --subtle, --line, --fg, --muted, --accent, --brand. */
export function renderMail(r: Pick<Recipient, "username" | "password" | "name">): string {
  const greeting = r.name ? `Sayın ${escapeHtml(r.name)},` : "Merhaba,";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${MAIL_SUBJECT}</title></head><body style="margin:0;padding:0;background:#f5f8fb"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #d8e2ec;border-radius:8px;border-collapse:separate"><tr><td style="padding:20px 28px;background:#14263d;border-radius:7px 7px 0 0;${FONT};font-size:20px;font-weight:bold;color:#fff">Zafer AI <span style="color:#f2b84b">&#10022;</span><div style="margin-top:2px;font-size:12px;font-weight:normal;color:#d8e2ec">Kurum asistanı</div></td></tr><tr><td style="padding:28px 28px 8px;${FONT};font-size:15px;line-height:1.6;color:#14263d"><p style="margin:0 0 12px">${greeting}</p><p style="margin:0">Zafer AI hesabınız hazır. Aşağıdaki bilgilerle giriş yapabilirsiniz.</p></td></tr><tr><td style="padding:12px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf3f8;border:1px solid #d8e2ec;border-radius:8px;border-collapse:separate">${field("Kullanıcı adı", r.username)}${field("Parola", r.password)}</table></td></tr><tr><td style="padding:12px 28px 20px"><a href="${SIGN_IN_URL}" style="display:inline-block;padding:12px 24px;background:#2e5e8c;border-radius:8px;${FONT};font-size:15px;font-weight:bold;color:#fff;text-decoration:none">Giriş yap</a></td></tr><tr><td style="padding:0 28px 28px;${FONT};font-size:13px;line-height:1.6;color:#4e6075">Bu bilgiler size özeldir, kimseyle paylaşmayın. Bu e-postayı beklemiyorsanız sistem yöneticinize bildirin.</td></tr><tr><td style="padding:16px 28px;border-top:1px solid #d8e2ec;${FONT};font-size:12px;color:#4e6075">Bu e-posta otomatik gönderilmiştir, lütfen yanıtlamayın.</td></tr></table></td></tr></table></body></html>`;
}

/** What the provider said: its answers are XML with a CODE of 0 for success. */
export function readResponse(xml: string) {
  const tag = (name: string) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`))?.[1]?.trim();
  return {
    ok: tag("CODE") === "0",
    /** It answered at all. A gateway's error page in its place says nothing about whether the mail went out. */
    understood: tag("CODE") !== undefined,
    message: [tag("NAME"), tag("DESC"), tag("DETAILS")].filter(Boolean).join(" - ") || "Beklenmeyen cevap",
    token: tag("TOKEN_NO"),
    transactionId: xml.match(/<SEND_EMAIL_SUCCESS[^>]*\sid="([^"]+)"/)?.[1],
    validAddresses: tag("VALID_ADDRESS_COUNT") === undefined ? undefined : Number(tag("VALID_ADDRESS_COUNT")),
    originators: [...xml.matchAll(/<ORIGINATOR\s[^>]*\bid="(\d+)"[^>]*>([^<]*)</g)].map((m) => ({ id: m[1], name: m[2].trim() })),
  };
}
