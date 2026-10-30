"use client";

// Görsel Stüdyo helpers: reading pictures the user picks (checked before decoding), the embedded font, downloads,
// the per-user brand kit. Everything stays in this browser.
import { measurer } from "./fonts";
import { useEffect, useState } from "react";
import { DEFAULT_BRAND, FONT_FAMILY, MAX_PIXELS, rasterSize, safeColor, storedPicture, type Brand, type Content, type Measure, type Picture, type TemplateId } from "@/lib/studio";

export const SAMPLE: Record<TemplateId, Content> = {
  duyuru: { tag: "Duyuru", title: "Yeni hizmet binamız hizmetinizde", subtitle: "Tüm birimlerimiz 1 Kasım itibarıyla tek adreste hizmet veriyor.", detail: "1 Kasım 2026 · Merkez Bina" },
  etkinlik: { tag: "Etkinlik", title: "Bölgesel Kalkınma Buluşması", subtitle: "Yerel yatırımcılar ve kamu kurumları bir araya geliyor.", detail: "12 Kasım 2026 · 10.00 · Kongre Salonu" },
  bilgi: { tag: "Bilgi", title: "%42", subtitle: "Destek başvurularında geçen yıla göre artış.", detail: "Kaynak: 2026 faaliyet raporu" },
  alinti: { tag: "", title: "Kalkınma, bölgenin bütün paydaşlarıyla birlikte yürüttüğümüz ortak bir yolculuktur.", subtitle: "Ad Soyad", detail: "Genel Sekreter" },
};
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_MAX_SIDE = 2400; // larger photos are scaled down once, so exports stay fast and the page light
const THUMB_SIDE = 320; // template cards use small copies, not the full photo and logo four times over
export const EXPORTS = [
  { label: "PNG", mime: "image/png", ext: "png" },
  { label: "JPEG", mime: "image/jpeg", ext: "jpg" },
  { label: "WebP", mime: "image/webp", ext: "webp" },
  { label: "SVG", mime: "image/svg+xml", ext: "svg" },
] as const;

export const brandKey = (u: string) => `kai-studio-brand:${u}`;
export function loadBrand(username: string): Brand {
  try {
    const b = JSON.parse(localStorage.getItem(brandKey(username)) ?? "null") as Partial<Brand> | null;
    if (b) return { primary: safeColor(b.primary, DEFAULT_BRAND.primary), accent: safeColor(b.accent, DEFAULT_BRAND.accent), logo: storedPicture(b.logo) };
  } catch {}
  return DEFAULT_BRAND;
}

export const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
export async function imageOf(src: string, decode = true) {
  const img = new Image();
  await new Promise((ok, no) => {
    img.onload = ok;
    img.onerror = no;
    img.src = src;
  });
  if (decode) await img.decode();
  return img;
}

/** A small raster copy for the template cards only (exports always use the original). */
export async function thumbOf(p: Picture): Promise<Picture> {
  const s = THUMB_SIDE / Math.max(p.w, p.h);
  if (s >= 1) return p;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(p.w * s));
  c.height = Math.max(1, Math.round(p.h * s));
  c.getContext("2d")!.drawImage(await imageOf(p.src), 0, 0, c.width, c.height);
  return { src: c.toDataURL("image/png"), w: c.width, h: c.height };
}
/** Size of an SVG logo without width/height attributes, from its viewBox. */
function svgSize(dataUrl: string) {
  try {
    const m = atob(dataUrl.split(",")[1]).match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return { w: Number(m[1]), h: Number(m[2]) };
  } catch {}
  return { w: 0, h: 0 };
}

export async function readPicture(file: File, kind: "photo" | "logo"): Promise<Picture> {
  const types = kind === "logo" ? ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] : ["image/png", "image/jpeg", "image/webp"];
  if (!types.includes(file.type)) throw new Error(kind === "logo" ? "Logo PNG, JPG, WEBP ya da SVG olmalı." : "Fotoğraf PNG, JPG ya da WEBP olmalı.");
  const max = kind === "logo" ? LOGO_MAX_BYTES : PHOTO_MAX_BYTES;
  if (file.size > max) throw new Error(`${kind === "logo" ? "Logo" : "Fotoğraf"} en fazla ${max / 1024 / 1024} MB olabilir.`);
  // Raster size from the file header, before the browser sees the pixels (a small file can decode to gigabytes).
  if (file.type !== "image/svg+xml") {
    const size = rasterSize(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
    if (!size || !size.w || !size.h) throw new Error("Görsel okunamadı. Dosya bozuk ya da desteklenmeyen biçimde olabilir.");
    if (size.w * size.h > MAX_PIXELS) throw new Error("Görsel çok büyük (en fazla 50 megapiksel).");
  }
  const src = await readAsDataUrl(file);
  const img = await imageOf(src, false).catch(() => {
    throw new Error("Görsel açılamadı.");
  });
  let { naturalWidth: w, naturalHeight: h } = img;
  if (file.type === "image/svg+xml" && (!w || !h)) ({ w, h } = svgSize(src));
  if (!w || !h) throw new Error("Görselin boyutu okunamadı.");
  // The logo is kept byte for byte (plan §6: never altered); a large photo is scaled down once.
  if (kind === "photo" && Math.max(w, h) > PHOTO_MAX_SIDE) {
    const s = PHOTO_MAX_SIDE / Math.max(w, h);
    const c = document.createElement("canvas");
    c.width = Math.round(w * s);
    c.height = Math.round(h * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL("image/jpeg", 0.9), w: c.width, h: c.height };
  }
  return { src, w, h };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The embedded font, once: as a FontFace for measuring and as a data: URL for the SVG (an image can't fetch). */
export function useStudioFont() {
  const [font, setFont] = useState<{ css: string; measure: Measure } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    (async () => {
      const buf = await (await fetch("/fonts/Geist-Variable.woff2")).arrayBuffer();
      const face = new FontFace(FONT_FAMILY, buf, { weight: "100 900" });
      document.fonts.add(await face.load());
      const b64 = await readAsDataUrl(new Blob([buf], { type: "font/woff2" }));
      const measure = measurer();
      if (live) setFont({ css: `@font-face{font-family:${FONT_FAMILY};src:url(${b64}) format("woff2");font-weight:100 900}`, measure });
    })().catch(() => live && setError("Yazı tipi yüklenemedi. Sayfayı yenileyin."));
    return () => {
      live = false;
    };
  }, []);
  return { font, error };
}
