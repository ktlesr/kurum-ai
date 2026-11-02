// İletişim Makinesi's e-mail API. No "server-only": scripts/send-credentials.ts uses it too.
// The API takes everything in the address, which holds a password or a token: no error from here may ever print it.
import { readResponse, renderMail, subjectOf, MAIL_PREVIEW, type MailDetails } from "./credentials-mail.ts";

const API = () => process.env.ILETISIM_API_URL ?? "https://live.iletisimmakinesi.com/api";
// Addresses have a limit. Refused here rather than cut off there.
const MAX_URL = 8000;
const TOKEN_MS = 12 * 60 * 60_000; // The provider's tokens last a day.
let cached: { token: string; until: number } | undefined;

export async function callProvider(path: string, params: Record<string, string>) {
  const url = `${API()}/${path}?${new URLSearchParams(params)}`;
  if (url.length > MAX_URL) throw new Error("İstek çok uzun");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  return readResponse(await response.text());
}

/** Throws with the provider's words when it refuses. */
export async function signIn(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const { ILETISIM_USERNAME: userName, ILETISIM_USERPASS: userPass, ILETISIM_CUSTOMER_CODE: customerCode, ILETISIM_API_KEY: apiKey, ILETISIM_VENDOR_CODE: vendorCode } = process.env;
  if (!userName || !userPass || !customerCode || !apiKey || !vendorCode) throw new Error("ILETISIM_* ayarları eksik");
  const answer = await callProvider("UserGatewayWS/functions/authenticate", { userName, userPass, customerCode, apiKey, vendorCode });
  if (!answer.ok || !answer.token) throw new Error(`Giriş yapılamadı: ${answer.message}`);
  cached = { token: answer.token, until: Date.now() + TOKEN_MS };
  return answer.token;
}

export const sendMailWith = (token: string, originatorId: string, details: MailDetails & { email: string }) =>
  callProvider("EmailGatewayWS/functions/sendEmail", {
    token,
    originatorId,
    emailAddresses: JSON.stringify([details.email]),
    emailSubject: subjectOf(details),
    previewText: MAIL_PREVIEW,
    templateContent: renderMail(details),
  });

export const mailReady = () => !!(process.env.ILETISIM_ORIGINATOR_ID && process.env.ILETISIM_USERNAME && process.env.ILETISIM_USERPASS && process.env.ILETISIM_CUSTOMER_CODE && process.env.ILETISIM_API_KEY && process.env.ILETISIM_VENDOR_CODE);

/**
 * sent: the provider took it for this address. refused: it certainly did not go. unknown: no clear answer, it may have gone.
 * off: not set up on this installation.
 */
export type MailOutcome = "sent" | "refused" | "unknown" | "off";

export async function sendCredentials(details: MailDetails & { email: string }): Promise<MailOutcome> {
  if (!mailReady()) return "off";
  let token: string;
  try {
    token = await signIn();
  } catch (e) {
    // Nothing was sent. Only the error's first words: never the address.
    console.error(`mail: giriş: ${(e as Error).name}: ${/^(Giriş yapılamadı|ILETISIM)/.test((e as Error).message) ? (e as Error).message : ""}`);
    return "refused";
  }
  try {
    const answer = await sendMailWith(token, process.env.ILETISIM_ORIGINATOR_ID!, details);
    if (!answer.understood || (answer.ok && answer.validAddresses === undefined)) return "unknown";
    if (answer.ok && answer.validAddresses === 1) return "sent";
    if (!answer.ok) cached = undefined; // It may be the token; the next mail signs in anew.
    console.error(`mail: reddedildi: ${answer.message}`);
    return "refused";
  } catch (e) {
    console.error(`mail: cevap yok: ${(e as Error).name}`);
    return "unknown";
  }
}
