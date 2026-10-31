// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { tintSvg } from "./studio-assets.ts";

test("tintSvg: colours go on the brand ramp by lightness; ids, masks' url() and other attributes stay", () => {
  const svg = `<svg><stop stop-color="#000000"/><path fill="#ffee00" clip-path="url(#a)" d="M0 0"/><path fill="none"/><rect id="#123456"/></svg>`;
  const out = tintSvg(svg, "#14263d", "#c8553d");
  assert.ok(out.includes('stop-color="#14263d"'), out); // the darkest takes the main colour
  assert.ok(!out.includes("#ffee00"));
  assert.ok(out.includes('clip-path="url(#a)"') && out.includes('fill="none"') && out.includes('id="#123456"'));
  assert.equal(tintSvg("<svg/>", "#14263d", "#c8553d"), "<svg/>");
});
