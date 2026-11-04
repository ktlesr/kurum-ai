import { test } from "node:test";
import assert from "node:assert/strict";
import { derivedNumbers, findCalcs, sourceNumbers, stillUnverified, trNumber } from "./calc.ts";

test("findCalcs: written-out calculations are worked again, Turkish number forms", () => {
  const ok = findCalcs("Toplam: 1.200.000 + 350.500 + 49.500 = 1.600.000 TL (hesaplanan).");
  assert.equal(ok.length, 1);
  assert.ok(ok[0].ok);
  assert.equal(ok[0].said, "1.600.000");
  assert.ok(findCalcs("Artış: (1.500 - 1.200) / 1.200 × 100 = %25")[0].ok);
  assert.ok(findCalcs("Oran: 300 / 1.200 = %25")[0].ok, "a ratio written as a percentage");
  assert.ok(findCalcs("Ortalama 12,5 × 4 = 50")[0].ok);
  assert.ok(findCalcs("1.234,5 + 0,5 = 1.235")[0].ok);
  assert.ok(findCalcs("10 / 3 = 3,33")[0].ok, "rounded to the digits shown");
  // A list number or a dash used as a separator isn't part of the calculation.
  assert.ok(findCalcs("1. 2.000 + 3.000 = 5.000")[0].ok);
  // A word then an operator: maybe a label and a dash, maybe a cut calculation ("500 TL - 100 + 200"); no verdict.
  assert.deepEqual(findCalcs("Personel - 1.200 + 300 = 1.500"), []);
  assert.deepEqual(findCalcs("500 TL - 100 + 200 = 300"), []);
  assert.ok(findCalcs("Personel: 1.200 + 300 = 1.500")[0].ok);
  assert.equal(findCalcs("| Toplam | 100 + 50 = 150 | 2 × 3 = 6 |").filter((c) => c.ok).length, 2);
});

test("findCalcs: a wrong result is caught with what it comes to", () => {
  const [c] = findCalcs("Toplam 1.200 + 300 = 1.600 TL");
  assert.equal(c.ok, false);
  assert.equal(c.actual, 1500);
  assert.equal(trNumber(c.actual), "1.500");
  assert.equal(findCalcs("10 / 3 = 3,4")[0].ok, false);
});

test("findCalcs: Codex review cases — a wrong sum stays wrong, percentages as operands, periods aren't subtractions", () => {
  const [sum] = findCalcs("100 + 200 + 300 = 500");
  assert.equal(sum.ok, false, "not made right by dropping its first term");
  assert.equal(sum.actual, 600);
  assert.ok(findCalcs("200 × %10 = 20")[0].ok);
  assert.equal(findCalcs("200 × %10 = 2.000")[0].ok, false);
  assert.ok(findCalcs("200 × 10% = 20")[0].ok);
  assert.deepEqual(findCalcs("Sözleşme dönemi 2024-2025 = 12 ay"), []);
  assert.deepEqual(findCalcs("Sayfa 10–12 = özet"), []);
  assert.deepEqual(findCalcs("10–12 + 5 = 17"), [], "a range with an en dash isn't cut to its last part");
  assert.equal(findCalcs("100 + 200 = %300")[0].ok, false, "a percentage at the wrong scale");
  assert.equal(findCalcs("(1.500 - 1.200) / 1.200 × 100 = %2500")[0].ok, false, "× 100 already applied: not again");
  assert.deepEqual(findCalcs("10–12 + 5 + 6 = 11"), [], "no part of a left side with a range");
  assert.deepEqual(findCalcs("10 / 0 + 20 + 30 = 50"), [], "no value (÷ 0): no verdict, none for a part of it");
  const [pct] = findCalcs("300 / 1.200 = %30");
  assert.equal(pct.ok, false);
  assert.equal(pct.shown, "%25", "what it comes to, at the scale it was written in");
  assert.equal(findCalcs("1.200 + 300 = 1.600")[0].shown, "1.500");
  // Where the 100 stands decides the scale: in the outer product it is a percentage already, inside brackets it isn't.
  assert.ok(findCalcs("300 / (1.200 × 100) = %0,25")[0].ok);
  assert.ok(findCalcs("100 × 300 / 1.200 = %25")[0].ok);
  assert.ok(findCalcs("(1.500 - 1.200) / 1.200 × 100 = %25")[0].ok);
  // Typeset signs are read, not stopped at: the whole calculation is judged.
  assert.equal(findCalcs("500 − 100 + 200 = 300")[0].ok, false);
  assert.ok(findCalcs("500 − 100 + 200 = 600")[0].ok);
  assert.equal(findCalcs("−100 + 200 = 300")[0].ok, false);
  assert.ok(findCalcs("12 · 3 = 36")[0].ok);
  assert.deepEqual(findCalcs("2^3 + 1 = 9"), [], "a power it can't read: no verdict on a part");
  assert.equal(findCalcs("500 – 100 + 200 = 300")[0].ok, false, "a spaced en dash is a minus");
  assert.ok(findCalcs("500 – 100 + 200 = 600")[0].ok);
  assert.deepEqual(findCalcs("100 + 200 = 300 / 2"), [], "the right side goes on: no verdict");
  for (const s of ["100 + 200 = 300 / -2", "100 + 200 = 300^2", "100 + 200 = 300 2", "100 + 200 = 300*2"]) assert.deepEqual(findCalcs(s), [], s);
  for (const s of ["100 + 200 = 300", "100 + 200 = 300 TL.", "100 + 200 = 300, sonra", "| 100 + 200 = 300 |", "(100 + 200 = 300)", "100 + 200 = 300 (hesaplanan)"]) assert.ok(findCalcs(s)[0]?.ok, s);
  // 100 first and divided is a ratio, not the percentage factor.
  assert.ok(findCalcs("100 / 200 = %50")[0].ok);
  assert.equal(findCalcs("100 / 200 = %0,5")[0].ok, false);
  // Scientific notation isn't cut into a part.
  for (const s of ["100 + 200 = 300e2", "1e3 + 100 = 103", "100 + 200 = 300E-1"]) assert.deepEqual(findCalcs(s), [], s);
  assert.ok(findCalcs("100 + 200 = 300TL")[0].ok, "a glued unit still ends the number");
  // Codex's one-pass list.
  assert.equal(findCalcs("1.000.000.000 + 1.000.000.000 = 2.000.000.002")[0].ok, false, "no relative slack on whole numbers");
  assert.ok(findCalcs("300 / 1.200 × (100) = %25")[0].ok);
  assert.ok(findCalcs("300 / 1.200 × 100,0 = %25")[0].ok);
  assert.equal(findCalcs("300 / 1.200 × (100) = %2500")[0].ok, false);
  assert.deepEqual(findCalcs("500 — 100 + 200 = 300"), [], "an em dash before it: maybe cut");
  for (const s of ["100 + 200 = 300! / 2", "100 + 200 = 300 TL / 2"]) assert.deepEqual(findCalcs(s), [], s);
  assert.ok(findCalcs("100 + 200 = 300 TL, ardından 200 - 50 = 150").every((c) => c.ok), "the next clause is its own");
  assert.equal(findCalcs("1,234 + 0,0005 = 1,2346")[0].shown, "1,2345");
  // Brackets around the whole expression don't change the scale.
  assert.ok(findCalcs("(300 / 1.200 × 100) = %25")[0].ok);
  assert.equal(findCalcs("(300 / 1.200 × 100) = %2500")[0].ok, false);
  assert.equal(findCalcs("(300 / 1.200 × 100) = %2500")[0].shown, "%25");
  assert.ok(findCalcs("2) 10 × 3 = 30")[0].ok, "a list number is left out");
  // A small result is shown with its digits, not rounded to 0.
  const [tiny] = findCalcs("0,001 + 0,002 = 0,004");
  assert.equal(tiny.ok, false);
  assert.equal(tiny.shown, "0,003");
  // "- " at the start is a Markdown bullet or a separator; a negative number is written against its digits.
  assert.ok(findCalcs("- 1.200 + 300 = 1.500")[0].ok);
  assert.ok(findCalcs("-100 + 200 = 100")[0].ok);
  assert.equal(findCalcs("-100 + 200 = 300")[0].ok, false);
  assert.ok(findCalcs("(1.500 - 1.200) / 1.200 * 100 = 25%")[0].ok);
});

test("sourceNumbers + derivedNumbers: a made-up single digit isn't stated by the source", () => {
  const stated = sourceNumbers("Bütçe 100 TL. Belirsiz 12(?) kalem. Tarih 3.");
  assert.ok(stated.has("100") && stated.has("3") && !stated.has("12") && !stated.has("9"));
  assert.equal(derivedNumbers(findCalcs("100 × 9 = 900"), (k) => stated.has(k)).size, 0);
  assert.equal(derivedNumbers(findCalcs("100 × 3 = 300"), (k) => stated.has(k)).size, 1);
  // An unsure date's parts aren't stated either: exactly as verifyNumbers reads the source.
  const dated = sourceNumbers("Tarih 12 Mart 2026(?) ve tutar 100 TL.");
  assert.ok(dated.has("100") && !dated.has("12") && !dated.has("2026"));
  // The percentage's 100 is a scale, not a figure to find; the same number in two notations is one.
  const pct = sourceNumbers("Eski 1.200, yeni 1.500.");
  assert.deepEqual([...derivedNumbers(findCalcs("(1.500 - 1.200) / 1.200 × 100 = %25"), (k) => pct.has(k))], ["25"]);
  const two = sourceNumbers("100 ve 200");
  assert.deepEqual([...derivedNumbers(findCalcs("100 + 200 = 300,0\n300 × 100 = 30.000"), (k) => two.has(k))], ["300", "30000"]);
});

test("derivedNumbers: a right result counts only when its operands are known; two can't vouch for each other", () => {
  const source = new Set(["100", "1200000", "350500"]);
  const inSource = (k: string) => source.has(k);
  const laundered = findCalcs("999 + 100 = 1.099\n1.099 - 100 = 999");
  assert.ok(laundered.every((c) => c.ok));
  assert.equal(derivedNumbers(laundered, inSource).size, 0);
  // A chain from known figures: the total, then a share of it.
  const chain = findCalcs("1.200.000 + 350.500 = 1.550.500\n1.550.500 / 100 = 15.505");
  assert.deepEqual([...derivedNumbers(chain, inSource)], ["1550500", "15505"]);
});

test("eleventh review: functions, % after an operator, malformed numbers, precision, negative percentages", () => {
  assert.deepEqual(findCalcs("log(100 + 200) = 300"), [], "a function glued to the bracket");
  for (const s of ["100 + 200 = 300 TL / %2", "100 + 200 = 300 × %2"]) assert.deepEqual(findCalcs(s), [], s);
  assert.deepEqual(findCalcs("1.234.56 + 100 = 101,234"), [], "a malformed number: no verdict");
  assert.equal(findCalcs("0,12345678901 + 0,00000000001 = 0,12345678903")[0].shown, "0,123456789020".replace(/0$/, ""));
  const [neg] = findCalcs("300 / 1.200 × -100 = %-25");
  assert.ok(neg?.ok, "a negative percentage is read");
});

test("twelfth review: scale is a literal 100, no relative slack, functions, continuations, malformed results", async () => {
  const { verifyNumbers } = await import("./checks.ts");
  const run = (source: string, answer: string) => stillUnverified(verifyNumbers(answer, source).unverified, findCalcs(answer), source);
  // An expression that comes to 100 isn't the percentage scale: its figures must be found.
  assert.deepEqual(run("1.200 ve 300", "1.200 / 300 × (999 - 899) = %400").sort(), ["400", "899", "999"]);
  // A decimal in the source stays that decimal.
  assert.deepEqual(run("12,345 ve 100", "12,345 × 100 = 1.234,5"), []);
  assert.deepEqual(run("12,345 ve 100", "12.345 × 100 = 1.234.500"), ["12.345", "1.234.500"]);
  // No relative slack: a wrong last digit is wrong, at any size.
  assert.equal(findCalcs("1.000.000.000.000 + 1 = 1.000.000.000.002")[0].ok, false);
  assert.equal(findCalcs("0,12345678901 + 0,00000000001 = 0,1234567890201")[0].ok, false);
  for (const s of ["ln (100 + 200) = 300", "100 + 200 = 300 TL / √4", "100 + 200 = 300 mod 2", "100 + 200 = --300", "100 + 200 = %300%"]) {
    assert.deepEqual(findCalcs(s), [], s);
  }
});

test("thirteenth review: the scale is the written 100, ulp-only slack, dates aren't decimals, no unread continuation", async () => {
  const { verifyNumbers } = await import("./checks.ts");
  const run = (source: string, answer: string) => stillUnverified(verifyNumbers(answer, source).unverified, findCalcs(answer), source);
  const [ten] = findCalcs("300 / 1.200 × %10000 = %25");
  assert.deepEqual(ten.scale, [], "%10000 comes to 100 but isn't the written 100");
  assert.ok(run("300 ve 1.200", "300 / 1.200 × %10000 = %25").includes("10000"));
  // Worked exactly: 16 decimals are 16 decimals (fifteenth review).
  assert.equal(findCalcs("0,12345678901 + 0,00000000001 = 0,1234567890200005")[0].ok, false);
  assert.ok(findCalcs("0,12345678901 + 0,00000000001 = 0,1234567890200000")[0].ok);
  assert.equal(findCalcs("0,12345678901 + 0,00000000001 = 0,12345678903")[0].ok, false);
  assert.ok(!sourceNumbers("12.03.2026 ve 1").has("12.03"), "a date's text isn't a decimal");
  assert.ok(run("12.03.2026 ve 1", "12,03 × 1 = 12,03").includes("12,03"));
  for (const s of ["2 + 3 = 5!", "100 + 200 = 300 TL × π"]) assert.deepEqual(findCalcs(s), [], s);
  assert.ok(findCalcs("300 / 1.200 × (+100) = %25")[0]?.ok, "a signed literal scale");
});

test("fourteenth review: unread continuations, malformed thousands, double percent; signs and emphasis read", () => {
  for (const s of ["100 + 200 = 300 x e", "100 + 200 = 300 TL - e", "0,05 + 0,05 = 0.100.000", "0.100.000 + 100 = 100,1", "200 × %10% = 20"]) {
    assert.deepEqual(findCalcs(s), [], s);
  }
  assert.ok(findCalcs("300 / 1.200 × --100 = %25")[0]?.ok, "a sign chain on the scale");
  assert.ok(findCalcs("100 + 200 = +300")[0]?.ok);
  assert.ok(findCalcs("**100 + 200 = 300**")[0]?.ok, "Markdown emphasis");
  assert.equal(findCalcs("**100 + 200 = 400**")[0]?.ok, false);
  // A signed thousands result is read as thousands; figures past 2^53 get no verdict.
  assert.ok(findCalcs("1.000 + 234 = +1.234")[0]?.ok);
  assert.equal(findCalcs("1.000 + 234 = +1.235")[0]?.ok, false);
  const [big] = findCalcs("9.007.199.254.740.992 + 1 = 9.007.199.254.740.992");
  assert.equal(big.ok, false, "past 2^53, worked exactly");
  assert.equal(big.shown, "9.007.199.254.740.993");
});

test("fifteenth review: worked exactly, no floating-point slack at any size or step", () => {
  // Near 10^15 an ulp is a sizeable part of a unit; a step past 2^53 loses the +1; a small divisor magnifies an error.
  assert.equal(findCalcs("1.000.000.000.000.000 + 1 = 1.000.000.000.000.002")[0].ok, false);
  assert.ok(findCalcs("1.000.000.000.000.000 + 1 = 1.000.000.000.000.001")[0].ok);
  assert.equal(findCalcs("1.000.000.000 × 1.000.000.000 + 1 - 1.000.000.000 × 1.000.000.000 = 0")[0].ok, false);
  assert.ok(findCalcs("1.000.000.000 × 1.000.000.000 + 1 - 1.000.000.000 × 1.000.000.000 = 1")[0].ok);
  assert.equal(findCalcs("0,000001 / (100,000001 - 100) = 1,000000003")[0].ok, false);
  assert.ok(findCalcs("0,000001 / (100,000001 - 100) = 1,000000000")[0].ok);
  // Ordinary figures, rounding as written, decimals and percentages.
  assert.ok(findCalcs("0,1 + 0,2 = 0,3")[0]?.ok);
  assert.ok(findCalcs("1 / 3 = 0,33")[0]?.ok);
  assert.equal(findCalcs("2 / 3 = 0,66")[0]?.ok, false);
  assert.equal(findCalcs("2 / 3 = 0,66")[0]?.shown, "0,667");
  assert.ok(findCalcs("(1.550.500 - 1.200.000) / 1.200.000 × 100 = %29,21")[0]?.ok);
  assert.equal(findCalcs("100 - 250 = -150")[0]?.ok, true);
  assert.equal(findCalcs("100 - 250 = -140")[0]?.shown, "-150");
});

test("fifteenth review: source keys are exact; a neighbour past 2^53 isn't the stated figure", async () => {
  const { verifyNumbers } = await import("./checks.ts");
  const src = "9.007.199.254.740.992 ve 10";
  const answer = "9.007.199.254.740.993 + 10 = 9.007.199.254.741.003";
  assert.ok(findCalcs(answer)[0].ok);
  assert.ok(stillUnverified(verifyNumbers(answer, src).unverified, findCalcs(answer), src).length > 0, "a made-up operand keeps it unproven");
  assert.ok(sourceNumbers("12,50 ve 0300").has("12.5") && sourceNumbers("0300").has("300"));
  // A signed result is the same figure as the unsigned one the check reports.
  const run = (src: string, ans: string) => stillUnverified(verifyNumbers(ans, src).unverified, findCalcs(ans), src);
  assert.deepEqual(run("1.000 ve 234", "1.000 + 234 = +1.234"), []);
  assert.deepEqual(run("1.000 ve 2.234", "1.000 - 2.234 = -1.234"), []);
});

test("stillUnverified: through verifyNumbers, as the chat uses it", async () => {
  const { verifyNumbers } = await import("./checks.ts");
  const run = (source: string, answer: string) => stillUnverified(verifyNumbers(answer, source).unverified, findCalcs(answer), source);
  // A date stays flagged though a result happens to equal its first part.
  assert.deepEqual(run("10 ve 2", "10 + 2 = 12\nTarih 12/03/2026."), ["12/03/2026"]);
  // An unsure date's parts aren't operands to build on.
  assert.deepEqual(run("12 Mart 2026(?) ve 100 TL", "12 × 100 = 1.200"), ["1.200"]);
  // A plain derived result is excused; a made-up operand keeps both its result and itself flagged.
  assert.deepEqual(run("Eski 1.200, yeni 1.500.", "(1.500 - 1.200) / 1.200 × 100 = %25"), []);
  assert.deepEqual(run("100", "999 + 100 = 1.099"), ["999", "1.099"]);
});

test("findCalcs: not calculations — a single number, words, a date, division by zero", () => {
  for (const s of ["Bütçe = 1.200.000 TL", "Sayfa 4'te yazar.", "a = b + c", "5 / 0 = 0", "2025 yılı"]) assert.deepEqual(findCalcs(s), [], s);
});

test("findCalcs: a long line of figures doesn't hang", () => {
  const line = Array.from({ length: 400 }, (_, i) => `${i}.${i},${i}`).join(" + ");
  const t0 = Date.now();
  findCalcs(line);
  findCalcs(`${line} = `);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

test("calculate (P6 tool): exact, operands from the document only, the percentage's 100 a scale", async () => {
  const { calculate } = await import("./calc.ts");
  const stated = sourceNumbers("Personel 1.200.000, yatırım 350.500, önceki yıl 1.200 ve bu yıl 1.500");
  assert.deepEqual(calculate("1.200.000 + 350.500", stated), { result: "1.550.500" });
  assert.deepEqual(calculate("(1.500 - 1.200) / 1.200 × 100", stated), { result: "25" });
  assert.deepEqual(calculate("1.500 / 1.200", stated), { result: "1,25" });
  assert.match((calculate("1.500 × 3", stated) as { error: string }).error, /Belgede olmayan sayılar: 3/);
  assert.match((calculate("1.500 / (1.200 - 1.200)", stated) as { error: string }).error, /Sıfıra bölme/);
  assert.ok("error" in calculate("rm -rf /", stated));
  assert.ok("error" in calculate("1.500 +", stated));
});

test("live case: labelled operands are checked; a wrong long sum is caught with its right total", () => {
  const line = "Afyonkarahisar-3 Toplamı: 5027 (Golden 2021) + 4750 (Golden 2022) + 4669 (Golden 2023) + 4696 (Golden 2024) + 4725 (Golden 2025) + 8096 (Starking 2021) + 8505 (Starking 2022) + 7317 (Starking 2023) + 7147 (Starking 2024) + 6698 (Starking 2025) + 192 (Amasya 2021) + 115 (Amasya 2022) + 101 (Amasya 2023) + 66 (Amasya 2024) + 29 (Amasya 2025) + 1643 (Granny Smith 2021) + 1665 (Granny Smith 2022) + 1410 (Granny Smith 2023) + 1355 (Granny Smith 2024) + 686 (Granny Smith 2025) = 53.111 (hesaplanan)";
  const [c] = findCalcs(line);
  assert.equal(c.ok, false);
  assert.equal(c.shown, "68.892");
  assert.ok(findCalcs("Toplam: 100 (bin TL) + 200 (bin TL) = 300 (hesaplanan)")[0].ok);
  assert.deepEqual(findCalcs("5027 (2021) + 4750 (2022) = 9777"), [], "a bracket of figures isn't a label");
  assert.deepEqual(findCalcs("log (100 + 200) = 300"), []);
  // A bracket with arithmetic in it is no label: no verdict, never "right".
  for (const t of ["100 (1 + oran) + 200 = 300", "100 (oran - 1) + 200 = 300", "100 (x 2) + 200 = 300", "100 (oran × 2) + 200 = 300", "100 (%5 pay) + 200 = 300"]) {
    assert.ok(!findCalcs(t).some((c) => c.ok), t);
  }
  assert.ok(findCalcs("5027 (Afyon-Golden) + 2645 (Kütahya-Golden) = 7672")[0].ok);
  // A label keeps the figures apart; a slash between letters is a unit, one by a figure a division.
  assert.ok(!findCalcs("100 (TL)200 + 300 = 100500").some((c) => c.ok));
  assert.equal(findCalcs("100 (TL/yıl) + 200 (TL/yıl) = 400")[0]?.ok, false);
  assert.ok(findCalcs("100 (TL/yıl) + 200 (TL/yıl) = 300")[0]?.ok);
  assert.ok(!findCalcs("100 (oran/2) + 200 = 300").some((c) => c.ok));
  assert.ok(!findCalcs("100 (2/oran) + 200 = 300").some((c) => c.ok));
  // Arithmetic without spaces is no label either.
  for (const t of ["100 (oran-1) + 200 = 300", "100 (2x3) + 200 = 300", "100 (x) + 200 = 300", "100 (a-1) + 200 = 300", "100 (1-a) + 200 = 300", "100 (yıl2) + 200 = 300"]) {
    assert.ok(!findCalcs(t).some((c) => c.ok), t);
  }
});
