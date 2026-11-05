// Run: pnpm test (the round trips need LibreOffice: skipped where it isn't installed; run in the image to check them)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Document, Packer, Paragraph } from "docx";
import mammoth from "mammoth";
import PptxGenJS from "pptxgenjs";
import { canConvert, convertLegacy, SOFFICE } from "./convert.ts";
import { pptxText } from "./pptx.ts";

const NO = !canConvert() && "LibreOffice yok";

/** A real old-format file: made new (docx/pptx), then saved old by LibreOffice itself. */
function oldOf(buf: Buffer, from: "docx" | "pptx", to: "doc" | "ppt"): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "conv-"));
  try {
    const input = path.join(dir, `a.${from}`);
    writeFileSync(input, buf);
    const r = spawnSync(SOFFICE, [`-env:UserInstallation=file://${dir}/p`, "--headless", "--convert-to", to, "--outdir", dir, input], { env: { ...process.env, HOME: dir } });
    assert.equal(r.status, 0, String(r.stderr));
    return readFileSync(path.join(dir, `a.${to}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const job = <T>(fn: (dir: string) => Promise<T>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "job-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
};

test("convertLegacy: a .doc comes back as a .docx with its text", { skip: NO }, async () => {
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Kütahya istihdam verisi 2026: 41.200")] }] }));
  const doc = oldOf(docx, "docx", "doc");
  assert.deepEqual([...doc.subarray(0, 4)], [0xd0, 0xcf, 0x11, 0xe0], "a real OLE .doc");
  const back = await job((dir) => convertLegacy(doc, "doc", dir, new AbortController().signal));
  assert.ok(back);
  assert.match((await mammoth.extractRawText({ buffer: back })).value, /Kütahya istihdam verisi 2026: 41\.200/u);
});

test("convertLegacy: a .ppt comes back as a .pptx, read slide by slide", { skip: NO }, async () => {
  const p = new PptxGenJS();
  p.addSlide().addText("Hidrojen fizibilite özeti", { x: 1, y: 1, w: 6, h: 1 });
  p.addSlide().addText("Elektrolizör 20 MW", { x: 1, y: 1, w: 6, h: 1 });
  const ppt = oldOf((await p.write({ outputType: "nodebuffer" })) as Buffer, "pptx", "ppt");
  const back = await job((dir) => convertLegacy(ppt, "ppt", dir, new AbortController().signal));
  assert.ok(back);
  const r = await pptxText(back, 50);
  assert.equal(r.pages, 2);
  assert.match(r.text, /Hidrojen fizibilite özeti[\s\S]*--- Sayfa 2 ---[\s\S]*Elektrolizör 20 MW/u);
});

test("convertLegacy: a file LibreOffice can't read is an error, not an empty document", { skip: NO }, async () => {
  const junk = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(4096, 7)]);
  await assert.rejects(job((dir) => convertLegacy(junk, "doc", dir, new AbortController().signal)));
});

test("convertLegacy: no LibreOffice on the machine → null (the caller says the format isn't supported here)", async () => {
  assert.equal(await job((dir) => convertLegacy(Buffer.from("x"), "doc", dir, new AbortController().signal, path.join(tmpdir(), "yok", "soffice"))), null);
});

test("convertLegacy: the job's profile turns macros off and sends web requests to a closed port; it is taken up", { skip: NO }, async () => {
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("profil")] }] }));
  const doc = oldOf(docx, "docx", "doc");
  await job(async (dir) => {
    assert.ok(await convertLegacy(doc, "doc", dir, new AbortController().signal));
    const xcu = readFileSync(path.join(dir, "profile", "user", "registrymodifications.xcu"), "utf8");
    // LibreOffice rewrote the profile on exit (more items than the 8 written) and kept the settings: they were read.
    assert.ok((xcu.match(/<item /gu) ?? []).length > 8, "rewritten by LibreOffice");
    assert.match(xcu, /DisableMacrosExecution[^]*?<value>true<\/value>/u);
    assert.match(xcu, /ooInetHTTPProxyName[^]*?<value>127\.0\.0\.1<\/value>/u);
    assert.match(xcu, /ooInetProxyType[^]*?<value>1<\/value>/u);
  });
});
