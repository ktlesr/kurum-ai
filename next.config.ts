import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server for the container image (Dockerfile): .next/standalone/server.js + traced node_modules.
  output: "standalone",
  // Runtime data and local model files must never land in a build/standalone output (audit S12).
  outputFileTracingExcludes: { "*": [".cache/**", ".venv-docling/**", "kurum-ai/**", ".env*"] },
  // playwright-core (lib/browser.ts) reads its own JSON files at runtime; the tracer only follows the JS.
  outputFileTracingIncludes: { "/api/chat": ["./node_modules/playwright-core/**/*", "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*"] },
  // CSP is per-request (nonce) in proxy.ts; these are static and cover API routes too.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Ignored over plain http. But a hostname that once answered over HTTPS stays HTTPS-only in that browser for a year.
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
