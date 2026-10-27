// Logs carry no prompt, answer, document text or provider body (plan §4.3, §9). Errors we throw use
// snake_case codes ("ollama_http_500"); anything else (JSON.parse, parser libs…) may quote input, so only its type is logged.
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

export const errCode = (e: unknown) =>
  e instanceof Error ? (CODE.test(e.message) ? e.message : e.name) : "unknown";

export const logError = (scope: string, e: unknown) => console.error(`${scope}: ${errCode(e)}`);
