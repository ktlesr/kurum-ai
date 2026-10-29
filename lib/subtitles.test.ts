// Run: pnpm test. Scene captions → SRT / WebVTT cues, and burnt-in caption wrapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { captionLines, cuesOf, toSrt, toVtt } from "./subtitles.ts";

test("cuesOf: one cue per captioned scene, timed by the durations", () => {
  const cues = cuesOf([{ seconds: 4, caption: "Bölgesel Kalkınma Buluşması" }, { seconds: 3 }, { seconds: 2.5, caption: " 12 Kasım\n\n Kongre Salonu " }]);
  assert.deepEqual(cues, [
    { start: 0, end: 4, text: "Bölgesel Kalkınma Buluşması" },
    { start: 7, end: 9.5, text: "12 Kasım\n\n Kongre Salonu" },
  ]);
  assert.equal(cuesOf([{ seconds: 2, caption: "a\u0000b\u001fc" }])[0].text, "abc");
});

test("toSrt / toVtt: standard timing lines, no blank line inside a cue, no early cue end in VTT", () => {
  const cues = cuesOf([{ seconds: 4, caption: "Birinci" }, { seconds: 3725.5, caption: "İkinci\n\nsatır --> ok" }]);
  assert.equal(toSrt(cues), "1\n00:00:00,000 --> 00:00:04,000\nBirinci\n\n2\n00:00:04,000 --> 01:02:09,500\nİkinci\nsatır --> ok\n");
  assert.equal(toVtt(cues), "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nBirinci\n\n00:00:04.000 --> 01:02:09.500\nİkinci\nsatır → ok\n");
  assert.equal(toSrt([]), "");
});

test("captionLines: wraps to the width, at most two lines, cut with …", () => {
  const m = (s: string) => s.length * 10;
  assert.deepEqual(captionLines("kısa", 300, m), ["kısa"]);
  assert.deepEqual(captionLines("bir iki üç dört beş altı", 140, m), ["bir iki üç", "dört beş altı"]);
  const long = captionLines("kelime ".repeat(30), 120, m);
  assert.equal(long.length, 2);
  assert.ok(long[1].endsWith("…") && m(long[1]) <= 120, long[1]);
});

test("subtitles (review): VTT escapes markup characters; an over-long word still fits", () => {
  assert.equal(toVtt(cuesOf([{ seconds: 1, caption: "<bütçe> & ödenek &amp;" }])), "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n&lt;bütçe> &amp; ödenek &amp;amp;\n");
  const m = (s: string) => s.length * 10;
  const lines = captionLines("x".repeat(240), 120, m);
  assert.equal(lines.length, 1);
  assert.ok(lines.every((l) => m(l) <= 120) && lines[0].endsWith("…"), lines[0]);
  assert.ok(captionLines(`kısa ${"y".repeat(50)} son`, 120, m).every((l) => m(l) <= 120));
});
