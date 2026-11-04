import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exifYear } from "./exif-date.ts";
import { parseRange, videoFrame } from "./video-frame.ts";
import { canSee, parseRules, ruleFindsFolder, ruleFrom, withRule, withoutRule } from "./folder-access.ts";
import { FORGET_AFTER_MS, ScanFailed, goneLongEnough, readWithin, safeToForget, scanFolder } from "./folder-scan.ts";
import { asksMorePhotos, asksPhotos, clarifies, namesPhotos } from "./gallery-intent.ts";
import { countOf, foldTr, kindAsked, nearFolders, searchGallery, termsOf, type GalleryEntry } from "./gallery-search.ts";
import { cleanGallery } from "./local-store.ts";
import { deleteMyTemplate, listMyTemplates, readMyTemplate, saveMyTemplate, cleanFolder } from "./template-store.ts";

const temp = () => mkdtempSync(path.join(tmpdir(), "kai-"));
const opts = { accept: (e: string) => e === "pdf", maxBytes: 10, maxDepth: 2, maxFiles: 2, deadlineMs: 5000 };

test("scan: takes what fits and counts everything it leaves out; subfolders and Turkish names are fine", async () => {
  const d = temp();
  try {
    mkdirSync(path.join(d, "Şablonlar/Word/derin"), { recursive: true });
    writeFileSync(path.join(d, "a.pdf"), "x");
    writeFileSync(path.join(d, "büyük.pdf"), "x".repeat(11));
    writeFileSync(path.join(d, "not.doc"), "x");
    writeFileSync(path.join(d, ".gizli.pdf"), "x");
    writeFileSync(path.join(d, "boş.pdf"), "");
    writeFileSync(path.join(d, "Şablonlar/b.pdf"), "x");
    writeFileSync(path.join(d, "Şablonlar/c.pdf"), "x");
    writeFileSync(path.join(d, "Şablonlar/Word/derin/d.pdf"), "x");
    const r = await scanFolder(d, opts);
    assert.deepEqual(r.files.map((f) => f.path), ["a.pdf", "Şablonlar/b.pdf"]);
    assert.deepEqual(r.skipped, { type: { doc: 1 }, tooBig: 1, tooDeep: 1, overLimit: 1, unreadable: 0 });
    assert.deepEqual(r.dirs, ["Şablonlar", "Şablonlar/Word"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("scan: a link can't lead out of the folder", async (t) => {
  const d = temp();
  const out = temp();
  try {
    writeFileSync(path.join(out, "sir.pdf"), "x");
    try {
      symlinkSync(out, path.join(d, "kisayol"), "junction");
    } catch {
      return t.skip("links need rights on this machine");
    }
    assert.deepEqual((await scanFolder(d, opts)).files, []);
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("scan: a missing or stuck share fails out loud, so the last good list stays", async () => {
  await assert.rejects(scanFolder(path.join(tmpdir(), "yok-boyle-bir-yer"), opts), (e: Error) => e instanceof ScanFailed && e.message === "ENOENT");
  const d = temp();
  try {
    writeFileSync(path.join(d, "a.pdf"), "x");
    await assert.rejects(scanFolder(d, { ...opts, deadlineMs: 0 }), (e: Error) => e instanceof ScanFailed && e.message === "timeout");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("forgetting: not after a partial read, not when much of the list vanished at once", () => {
  const clean = { type: {}, tooBig: 0, tooDeep: 0, overLimit: 0, unreadable: 0 };
  assert.ok(safeToForget(100, 99, clean));
  assert.ok(safeToForget(100, 50, clean));
  assert.ok(!safeToForget(100, 49, clean), "half gone at once: a share half there");
  assert.ok(!safeToForget(100, 0, clean));
  assert.ok(!safeToForget(100, 100, { ...clean, unreadable: 1 }));
  assert.ok(!safeToForget(100, 100, { ...clean, overLimit: 1 }));
  assert.ok(safeToForget(0, 5, clean));
  assert.ok(!goneLongEnough(1000, 1000 + FORGET_AFTER_MS - 1));
  assert.ok(goneLongEnough(1000, 1000 + FORGET_AFTER_MS));
});

test("reading off a share: the reader stops waiting when told or when time is up", async () => {
  const d = temp();
  try {
    writeFileSync(path.join(d, "a"), "merhaba");
    assert.equal(String(await readWithin(path.join(d, "a"), 5000)), "merhaba");
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(readWithin(path.join(d, "a"), 5000, ac.signal));
    await assert.rejects(readWithin(path.join(d, "yok"), 5000));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("access: open without a rule; a rule closes the folder and below; the closest rule decides; admins see all", () => {
  const rules = [{ folder: "ortak/Personel", users: ["ayse"] }, { folder: "ortak/Personel/Duyurular", users: ["ayse", "ali"] }, { folder: "galeri/Gizli", users: [] }];
  const ali = { username: "ali", role: "user" };
  const ayse = { username: "ayse", role: "user" };
  assert.ok(canSee("ortak/Genel/a.pdf", ali, rules));
  assert.ok(!canSee("ortak/Personel/a.pdf", ali, rules));
  assert.ok(canSee("ortak/Personel/a.pdf", ayse, rules));
  assert.ok(canSee("ortak/Personel/Duyurular/a.pdf", ali, rules));
  assert.ok(canSee("ortak/PersonelEski/a.pdf", ali, rules), "a name beginning the same is another folder");
  assert.ok(!canSee("galeri/Gizli/a.jpg", ayse, rules));
  assert.ok(canSee("galeri/Gizli/a.jpg", { username: "x", role: "admin" }, rules));
  // A rule can't miss by a letter's case, or by how the NAS spells a Turkish letter.
  assert.ok(!canSee("ORTAK/personel/a.pdf", ali, rules));
  assert.ok(!canSee("ortak/Şirket/a.pdf".normalize("NFD"), ali, [{ folder: "ortak/Şirket", users: [] }]));
  // The closest rule by what it matches, not by how many bytes its spelling takes.
  const nfd = "ortak/Ş".normalize("NFD");
  assert.ok(nfd.length > "ortak/ş/x".normalize("NFC").length - 2);
  assert.ok(canSee("ortak/ş/x/a.pdf", ali, [{ folder: nfd, users: [] }, { folder: "ortak/ş/x", users: ["ali"] }]));
  assert.ok(ruleFindsFolder({ folder: "ortak/personel", users: [] }, ["ortak/Personel/Alt"]));
  assert.ok(!ruleFindsFolder({ folder: "ortak/yok", users: [] }, ["ortak/Personel"]));
});

test("access rules: forms and saved values", () => {
  assert.deepEqual(ruleFrom(" ortak/ Personel/ ", "Ayşe, ali;ali"), { folder: "ortak/Personel", users: ["ayşe", "ali"] });
  assert.equal(ruleFrom("", "a"), null);
  assert.equal(ruleFrom("ortak/../gizli", "a"), null);
  assert.deepEqual(ruleFrom("x", ""), { folder: "x", users: [] });
  const r = withRule(withRule([], { folder: "b", users: [] }), { folder: "a", users: ["x"] });
  assert.deepEqual(r.map((x) => x.folder), ["a", "b"]);
  assert.deepEqual(withRule(r, { folder: "a", users: [] }).find((x) => x.folder === "a")!.users, []);
  assert.deepEqual(withoutRule(r, "a").map((x) => x.folder), ["b"]);
  assert.deepEqual(parseRules(undefined), []);
  assert.deepEqual(parseRules('[{"folder":"x"},{"users":[]}]'), [{ folder: "x", users: [] }]);
  assert.throws(() => parseRules("{bozuk"));
});

const photo = (p: string, over: Partial<GalleryEntry> = {}): GalleryEntry => ({ id: `g-${p}`, path: p, name: p.split("/").pop()!, size: 1, mtime: Date.UTC(2024, 5, 1), ...over });
const photos = [
  ...Array.from({ length: 10 }, (_, i) => photo(`2025/Uşak Kilim Projesi/IMG_${i}.jpg`)),
  photo("2023/Malatya Fuarı/açılış.jpg"),
  photo("2023/Karışık/IMG_77.jpg", { caption: "Tezgâhta kilim dokuyan iki kadın" }),
  photo("2021/Elazığ Ziyareti/foto.jpg", { year: 2021 }),
];

test("search: the words of the request find the folder, whatever the spelling; asked count; never a made-up file", () => {
  const near = (q: string) => searchGallery(photos, q, { count: 3, thisYear: 2026 });
  const r = near("uşak kilim projesinin resimlerinden 3 tanesini getir");
  assert.equal(r.items.length, 3);
  assert.equal(r.total, 10);
  assert.equal(r.folder, "2025/Uşak Kilim Projesi");
  assert.ok(r.items.every((i) => photos.includes(i)));
  assert.equal(near("usak kilim").total, 10);
  assert.equal(near("USAK KILIM PROJESI").total, 10);
  assert.equal(near("mars üssü resimleri getir").total, 0);
  assert.equal(near("resim getir").total, 0, "no subject: nothing rather than random photos");
});

test("search: what the model saw counts, after names; a folder match comes first", () => {
  const r = searchGallery(photos, "kilim fotoğrafları", { count: 20, thisYear: 2026 });
  assert.equal(r.total, 11);
  assert.ok(r.items.at(-1)!.path.includes("Karışık"));
  assert.equal(searchGallery(photos, "dokuyan kadın", { count: 5, thisYear: 2026 }).items[0].path, "2023/Karışık/IMG_77.jpg");
});

test("search: years, by photo date or folder; going on gives new ones in a steady order", () => {
  assert.equal(searchGallery(photos, "2021 fotoğrafları göster", { count: 5, thisYear: 2026 }).total, 1);
  assert.equal(searchGallery(photos, "geçen yıl kilim resimleri", { count: 20, thisYear: 2026 }).total, 10);
  const a = searchGallery(photos, "uşak kilim", { count: 4, thisYear: 2026 });
  const b = searchGallery(photos, "uşak kilim", { count: 4, offset: 4, thisYear: 2026 });
  assert.equal(new Set([...a.items, ...b.items]).size, 8);
  assert.deepEqual(searchGallery(photos, "uşak kilim", { count: 4, thisYear: 2026 }).items, a.items);
  assert.deepEqual(termsOf("2025 Uşak'taki resimleri", 2026).year, 2025);
  assert.deepEqual(nearFolders(photos, "elazığ kilim kapanış", 2026).length, 2);
});

test("videos: asked for by name, kept apart from photos; ranges for a player", () => {
  const list = [photo("a/Uşak/1.jpg", { kind: "photo" }), photo("a/Uşak/2.mp4", { kind: "video" })];
  assert.equal(kindAsked("uşak videolarını göster"), "video");
  assert.equal(kindAsked("uşak fotoğraflarını getir"), "photo");
  assert.equal(kindAsked("galeriden uşak getir"), undefined);
  const search = (q: string) => searchGallery(list, q, { count: 5, thisYear: 2026, kind: kindAsked(q) }).items.map((i) => i.name);
  assert.deepEqual(search("uşak videolarını göster"), ["2.mp4"]);
  assert.deepEqual(search("uşak resimlerini göster"), ["1.jpg"]);
  assert.ok(asksPhotos("uşak videolarını göster"));
  assert.ok(asksPhotos("fuar videosunu getir"));
  for (const q of ["personel kayıtlarını göster", "2025 yılına ait kayıtları getir"]) assert.ok(!asksPhotos(q), q);
  assert.equal(countOf("2 video göster"), 2);
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=10-20", 100), { start: 10, end: 20 });
  assert.deepEqual(parseRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  for (const bad of ["bytes=200-", "bytes=50-10", "bytes=-", "items=0-1", "bytes=-0"]) assert.equal(parseRange(bad, 100), "bad", bad);
});

test("video still: ffmpeg gives a JPEG; a broken file is an error, not a hang", async (t) => {
  const d = temp();
  try {
    const { execFileSync } = await import("node:child_process");
    const f = path.join(d, "kısa video.mp4");
    try {
      execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1", "-y", f], { windowsHide: true });
    } catch {
      return t.skip("no ffmpeg here");
    }
    const still = await videoFrame(f, 160); // shorter than the usual 3 seconds in
    assert.deepEqual([still[0], still[1]], [0xff, 0xd8]);
    writeFileSync(path.join(d, "bozuk.mp4"), "video degil");
    await assert.rejects(videoFrame(path.join(d, "bozuk.mp4"), 160));
    // A playlist dressed as a video can't lead ffmpeg to other files.
    writeFileSync(path.join(d, "liste.mp4"), `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1,\n${f}\n#EXT-X-ENDLIST\n`);
    await assert.rejects(videoFrame(path.join(d, "liste.mp4"), 160));
    writeFileSync(path.join(d, "birlestir.mp4"), `ffconcat version 1.0\nfile '${f.replace(/\\/g, "/")}'\n`);
    await assert.rejects(videoFrame(path.join(d, "birlestir.mp4"), 160));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("search helpers: Turkish folding and how many", () => {
  assert.equal(foldTr("İĞÜŞÖÇ ıi"), "iguso c ii".replace(" c", "c"));
  assert.equal(countOf("3 tanesini getir"), 3);
  assert.equal(countOf("üç tane göster"), 3);
  assert.equal(countOf("fotoğrafları göster"), 6);
  assert.equal(countOf("999 tane"), 24);
});

test("intent: asking for photos, and only that", () => {
  for (const q of ["uşak kilim projesinin resimlerinden 3 tanesini getir", "bana fuar fotoğraflarını göster", "2025 görsellerini bul", "kilim resmi getirir misin", "galeriden uşak fotoğrafları getir"]) assert.ok(asksPhotos(q), q);
  for (const q of ["belgedeki resimleri göster", "bu fotoğrafta ne var", "kedi resmi çiz", "resim nasıl eklenir göster", "internetten kilim resimleri bul", "raporun özetini göster", "sosyal medya görseli oluştur göster"]) assert.ok(!asksPhotos(q), q);
  for (const q of ["3 tane daha", "daha göster", "5 tane daha getir", "daha fazla", "birkaç tane daha."]) assert.ok(asksMorePhotos(q), q);
  for (const q of ["daha iyi anlat", "bir tane daha soru"]) assert.ok(!asksMorePhotos(q), q);
});

test("a backup can't put anything but photo ids in a reply", () => {
  assert.equal(cleanGallery(null), undefined);
  const id = `g-${"a".repeat(40)}`;
  const g = cleanGallery({ query: "q", shown: 1, total: 2, items: [{ id, name: "a.jpg", folder: "x" }, { id: "../../etc", name: "b" }, { id, name: 5 }] });
  assert.deepEqual(g, { query: "q", shown: 1, total: 2, items: [{ id, name: "a.jpg", folder: "x" }] });
});

function jpegWith(tag: number, date: string, sub: boolean): Uint8Array {
  // A little-endian TIFF inside an APP1: IFD0 → (sub-IFD →) one ASCII date.
  const data = Buffer.alloc(8 + 18 + 18 + 32);
  data.write("II", 0, "latin1");
  data.writeUInt16LE(42, 2);
  data.writeUInt32LE(8, 4);
  data.writeUInt16LE(1, 8);
  const entry = (at: number, t: number, type: number, n: number, value: number) => {
    data.writeUInt16LE(t, at);
    data.writeUInt16LE(type, at + 2);
    data.writeUInt32LE(n, at + 4);
    data.writeUInt32LE(value, at + 8);
  };
  if (sub) {
    entry(10, 0x8769, 4, 1, 26);
    data.writeUInt16LE(1, 26);
    entry(28, tag, 2, date.length + 1, 44);
  } else entry(10, tag, 2, date.length + 1, 44);
  data.write(date, 44, "latin1");
  const app = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), data]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(app.length + 2);
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app, Buffer.from([0xff, 0xda])]));
}

test("exif: the year a photo was taken; anything odd is just 'don't know'", () => {
  assert.equal(exifYear(jpegWith(0x9003, "2019:06:01 10:00:00", true)), 2019);
  assert.equal(exifYear(jpegWith(0x0132, "2020:01:01 00:00:00", false)), 2020);
  assert.equal(exifYear(jpegWith(0x9003, "kirik veri burada 123", true)), undefined);
  assert.equal(exifYear(new Uint8Array([0x89, 0x50])), undefined);
  assert.equal(exifYear(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45])), undefined);
  const cut = jpegWith(0x9003, "2019:06:01 10:00:00", true).subarray(0, 30);
  assert.equal(exifYear(cut), undefined);
});

test("my templates: saved per owner, the same name replaces, another person's id finds nothing, delete cleans up", async () => {
  const root = temp();
  const me = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  try {
    const a = (await saveMyTemplate(me, "../../kötü<ad>.xlsx", "Excel/../Rapor", new Uint8Array([1, 2]), root))!;
    assert.equal(a.name, "....kötüad.xlsx");
    assert.equal(a.folder, "Excel/Rapor");
    const b = (await saveMyTemplate(me, "../../kötü<ad>.xlsx", "Excel/Rapor", new Uint8Array([3]), root))!;
    assert.equal(b.id, a.id);
    assert.deepEqual([...(await readMyTemplate(me, a.id, root))!.bytes], [3]);
    assert.equal(await readMyTemplate(other, a.id, root), null);
    assert.equal(await readMyTemplate(me, "t-../../x", root), null);
    assert.equal(await deleteMyTemplate(other, a.id, root), false);
    assert.equal((await listMyTemplates(me, root)).length, 1);
    assert.equal(await deleteMyTemplate(me, a.id, root), true);
    assert.deepEqual(await listMyTemplates(me, root), []);
    assert.equal(cleanFolder("a/./b/../c"), "a/b/c");
    await assert.rejects(saveMyTemplate("../x", "a", "", new Uint8Array(), root), /bad_owner/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("intent: asking whether there are any, or naming the archive; the asking words aren't searched for", () => {
  const asked = "kütahya domaniç kadın kooperatifi görselleri var mı? video veya resim";
  assert.ok(asksPhotos(asked));
  assert.ok(asksPhotos("zaferortak klasöründeki galeride demek istedim"));
  assert.ok(clarifies("zaferortak klasöründeki galeride demek istedim"));
  for (const q of ["belgede görsel var mı", "bu fotoğrafta ne var", "galeri açılışı için konuşma metni yaz", "sanat galerisi nedir"]) assert.ok(!asksPhotos(q), q);
  assert.deepEqual(termsOf(asked, 2026).terms, ["kutahya", "domanic", "kadin", "kooperatifi"]);
  // The folder needn't name the province: of four words one may miss.
  const list = [photo("Projeler/Domaniç Kadın Kooperatifi/1.jpg"), photo("Projeler/Simav Sera/2.jpg")];
  assert.deepEqual(searchGallery(list, asked, { count: 5, thisYear: 2026 }).items.map((i) => i.name), ["1.jpg"]);
});

test("namesPhotos: photos named without a verb are a gallery request (live: they went to the model)", () => {
  for (const q of [
    "domaniç kadın kooperatifi fotoğrafları", "domaniç kadın kooperatifi fotoları", "domaniç kadın kooperatifiyle ilgili fotolar",
    "domaniç kadın kooperatifinin resimleri", "domaniç kadın kooperatifi görselleri", "uşak fuarı videoları.", "kilim fotoğrafı",
  ]) assert.ok(namesPhotos(q), q);
  for (const q of [
    "fotoğraflar", "raporun görselleri ne anlatıyor", "bu fotoğrafta ne var", "kooperatif için afiş görseli tasarla",
    "belgedeki resimler", "domaniç fotoğrafları nerede?", "fotoğrafları domaniç kooperatifinin", "kooperatif fotoğraflarını kim çekti",
  ]) assert.ok(!namesPhotos(q), q);
});

test("asksPhotos: every polite form of the verb (live: 'bulur musun' went to the model)", () => {
  for (const q of [
    "domaniç kadın kooperatifi ile ilgili fotoğrafları bulur musun", "kilim fotoğraflarını gösterir misiniz", "fuar resimlerini getirir misin",
    "uşak görsellerini listeler misin", "kooperatif fotoğraflarını bulabilir misin", "fuar videolarını gösterebilir misin",
  ]) assert.ok(asksPhotos(q), q);
  for (const q of ["bu fotoğraftaki bulguları anlat", "fotoğraf makinesi nasıl bulunur"]) assert.ok(!asksPhotos(q), q);
});

test("a request the intent accepts finds what it names: its verb, in any polite form, isn't a search term", async () => {
  const { searchGallery } = await import("./gallery-search.ts");
  const all = [{ id: "1", path: "Projeler/Uşak/1.jpg", name: "1.jpg", kind: "photo", size: 1, mtime: 1 }] as never[];
  for (const q of ["uşak görsellerini listeler misin", "uşak fotoğraflarını bulur musun", "uşak resimlerini gösterebilir misiniz", "uşak fotoğrafları"]) {
    assert.equal(searchGallery(all, q, { count: 6, thisYear: 2026 }).items.length, 1, q);
  }
});
