// Gate (audit S12): nothing from runtime data, local venvs, the pilot stack or env files may reach the build output.
// Run after `next build`: node scripts/check-trace.mjs
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BAD = /(^|[\/])(\.cache|\.venv-docling|kurum-ai|\.env[^\/]*)([\/]|$)/;
const hits = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (BAD.test(path.relative(".next", p))) hits.push(p);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".nft.json")) {
      for (const f of JSON.parse(readFileSync(p, "utf8")).files) if (BAD.test(path.normalize(path.join(path.dirname(p), f)))) hits.push(`${p} → ${f}`);
    }
  }
};
walk(".next");
if (hits.length) {
  console.error(`trace kapısı: ${hits.length} yasak yol\n${hits.slice(0, 20).join("\n")}`);
  process.exit(1);
}
console.log("trace kapısı: temiz");
