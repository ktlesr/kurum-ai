import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Runtime data and local model files must never land in a build/standalone output (audit S12).
  outputFileTracingExcludes: { "*": [".cache/**", ".venv-docling/**", "kurum-ai/**", ".env*"] },
};

export default nextConfig;
