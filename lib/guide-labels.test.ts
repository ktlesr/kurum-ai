import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// The guide names buttons and messages as they appear on screen. A renamed one must not leave it telling people to look for
// something that isn't there.
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) && !/test\./.test(e.name) ? [`${dir}/${e.name}`] : []));

test("every label in the guide exists in the code", () => {
  const guide = readFileSync("app/rehber/page.tsx", "utf8");
  const code = ["app", "lib"].flatMap(walk).filter((f) => !f.includes("rehber")).map((f) => readFileSync(f, "utf8")).join("\n");
  const fromTags = [...guide.matchAll(/<L>([^<{]+)<\/L>/g)].map((m) => m[1]);
  const fromTable = [...guide.matchAll(/\["([^"]+)", "[^"]+"\],/g)].map((m) => m[1]).filter((s) => /[.:]$/.test(s));
  assert.ok(fromTags.length > 80);
  // Line breaks or escapes in the code can split a label; these compare what a person would read.
  const missing = [...fromTags, ...fromTable].filter((label) => !code.includes(label) && !code.includes(label.replaceAll("'", "\\'")));
  assert.deepEqual(missing, []);
});
