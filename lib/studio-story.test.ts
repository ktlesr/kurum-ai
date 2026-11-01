import assert from "node:assert/strict";
import test from "node:test";
import { SCENE_SECONDS } from "./studio-video.ts";
import { albumTemplate, parseStory, reelsScene, reelsTransition, storySize, type StoryPage } from "./studio-story.ts";

const json = (rows: object[], key = "sahneler") => JSON.stringify({ [key]: rows });
const row = (rol: string, baslik: string, altBaslik = "", detay = "", etiket = "") => ({ rol, baslik, altBaslik, detay, etiket });

test("the story comes back in order, with first and last by their place", () => {
  const r = parseStory(json([row("bilgi", "İlk"), row("acilis", "Orta"), row("bilgi", "Son")]), "reels", 0, "")!;
  assert.deepEqual(r.pages.map((p) => [p.role, p.title]), [["acilis", "İlk"], ["bilgi", "Orta"], ["kapanis", "Son"]]);
  assert.equal(r.cut, false);
});

test("an exact count is kept to; repeats, empty titles and rubbish go", () => {
  const rows = [row("acilis", "A"), row("bilgi", "B"), row("bilgi", "b"), row("bilgi", ""), row("bilgi", "C"), row("kapanis", "D")];
  assert.deepEqual(parseStory(json(rows), "album", 2, "")!.pages.map((p) => p.title), ["A", "B"]);
  assert.deepEqual(parseStory(json(rows), "album", 0, "")!.pages.map((p) => p.title), ["A", "B", "C", "D"]);
  assert.equal(parseStory("Üzgünüm, yazamadım.", "reels", 0, ""), null);
  assert.equal(parseStory(json([]), "reels", 0, ""), null);
});

test("an answer cut at the length limit keeps what is whole and says so", () => {
  const whole = json([row("acilis", "A"), row("bilgi", "B"), row("bilgi", "C")]);
  const r = parseStory(whole.slice(0, whole.lastIndexOf('"baslik"') + 12), "reels", 0, "")!;
  assert.deepEqual(r.pages.map((p) => p.title), ["A", "B"]);
  assert.equal(r.cut, true);
  // Braces and quotes inside a text don't confuse it; prose around the JSON neither.
  const tricky = 'Elbette: ```json\n{"sahneler":[{"rol":"acilis","baslik":"a } \\" [ b"},{"rol":"bilgi","baslik":"c"}]}\n```';
  assert.deepEqual(parseStory(tricky, "reels", 0, "")!.pages.map((p) => p.title), ['a } " [ b', "c"]);
});

test("a figure or a quotation not in what was given isn't shown as one", () => {
  const known = "Destek başvuruları %42 arttı. Ali Veli: Kalkınma birlikte yürüttüğümüz bir yolculuktur.";
  const r = parseStory(json([
    row("acilis", "Başlangıç"),
    row("rakam", "%42", "Başvuru artışı"),
    row("rakam", "%77", "Uydurma"),
    row("rakam", "Çok arttı"),
    row("soz", "Kalkınma birlikte yürüttüğümüz bir yolculuktur", "Ali Veli"),
    row("soz", "Hiç söylenmemiş bir söz", "Ali Veli"),
    row("kapanis", "Başvurun"),
  ]), "reels", 0, known)!;
  assert.deepEqual(r.pages.map((p) => p.role), ["acilis", "rakam", "bilgi", "bilgi", "soz", "bilgi", "kapanis"]);
  assert.deepEqual(r.unverified, [2], "the invented figure is pointed out");
});

test("a figure counts only whole", () => {
  const r = parseStory(json([row("acilis", "A"), row("rakam", "%42", "Oran"), row("rakam", "142", "Katılımcı"), row("kapanis", "Z")]), "reels", 0, "Katılımcı sayısı 142 oldu.")!;
  assert.deepEqual(r.pages.map((p) => p.role), ["acilis", "bilgi", "rakam", "kapanis"]);
  assert.deepEqual(r.unverified, [1]);
});

test("figures in a text are checked too; steps number themselves", () => {
  const r = parseStory(json([
    row("acilis", "Başvuru"),
    row("adim", "Hesap açın", "12 Kasım'a kadar"),
    row("adim", "Formu doldurun"),
    row("kapanis", "Başlayın", "", "kurum.gov.tr"),
  ]), "reels", 0, "Başvuru rehberi")!;
  assert.deepEqual(r.pages.filter((p) => p.role === "adim").map((p) => p.tag), ["1", "2"]);
  assert.deepEqual(r.unverified, [1]);
  const lone = parseStory(json([row("acilis", "A"), row("adim", "Tek"), row("kapanis", "Z")]), "reels", 0, "")!;
  assert.equal(lone.pages[1].role, "bilgi");
});

test("a scene stays long enough to read, on a length a scene can have", () => {
  const page = (role: StoryPage["role"], title: string, subtitle = ""): StoryPage => ({ role, tag: "", title, subtitle, detail: "" });
  const short = reelsScene(page("acilis", "Bunu kaçırmayın"));
  assert.equal(short.template, "kanca");
  assert.equal(short.seconds, 2);
  const long = reelsScene(page("bilgi", "Başvurular artık tek adresten alınıyor", "Süreç kırk beş günden yirmi güne iniyor ve bütün belgeler sistem üzerinden tek seferde yükleniyor."));
  assert.ok(long.seconds >= 8 && SCENE_SECONDS.includes(long.seconds));
  assert.equal(reelsScene(page("kapanis", "Hemen başvurun")).template, "kapanis");
  assert.ok(long.caption.includes(" — "));
  assert.equal(reelsTransition([page("adim", "A")]), "slide");
  assert.equal(reelsTransition([page("bilgi", "A")]), "wipe");
});

test("the images of a post share the chosen template, figures and quotations their own", () => {
  const page = (role: StoryPage["role"]): StoryPage => ({ role, tag: "", title: "A", subtitle: "", detail: "" });
  assert.equal(albumTemplate(page("bilgi"), "manset", false), "manset");
  assert.equal(albumTemplate(page("rakam"), "manset", false), "etki");
  assert.equal(albumTemplate(page("soz"), "duyuru", true), "alinti");
  assert.match(storySize("reels", 5), /Tam 5 sahne/);
  assert.match(storySize("album", 0), /arasında/);
});
