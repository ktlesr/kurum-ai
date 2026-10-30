// Theme library of the studio: a colour pair from Open Color (MIT) and a heading/body font pair from the app's library.
import { OPEN_COLOR } from "./studio-assets.ts";

const c = (hue: string, i: number) => OPEN_COLOR[hue][i];
export interface Theme { name: string; primary: string; accent: string; head: string; body: string; mood: string }
export const THEMES: Theme[] = [
  { name: "Lacivert", mood: "Kurumsal", primary: "#14263d", accent: "#2e5e8c", head: "montserrat", body: "inter" },
  { name: "Okyanus", mood: "Kurumsal", primary: c("blue", 9), accent: c("cyan", 9), head: "poppins", body: "open-sans" },
  { name: "Çelik", mood: "Kurumsal", primary: c("gray", 9), accent: c("blue", 8), head: "manrope", body: "inter" },
  { name: "Çivit", mood: "Kurumsal", primary: c("indigo", 9), accent: c("violet", 6), head: "dm-sans", body: "work-sans" },
  { name: "Bordo", mood: "Resmî", primary: "#4a1424", accent: "#c8102e", head: "playfair-display", body: "lato" },
  { name: "Kömür", mood: "Resmî", primary: c("gray", 9), accent: c("gray", 7), head: "merriweather", body: "open-sans" },
  { name: "Altın", mood: "Resmî", primary: c("gray", 9), accent: c("yellow", 5), head: "lora", body: "lato" },
  { name: "Erik", mood: "Resmî", primary: c("grape", 9), accent: c("pink", 8), head: "playfair-display", body: "raleway" },
  { name: "Orman", mood: "Doğa", primary: "#0f3d2e", accent: "#1a7a50", head: "rubik", body: "nunito" },
  { name: "Zümrüt", mood: "Doğa", primary: c("teal", 9), accent: "#24763a", head: "work-sans", body: "inter" },
  { name: "Zeytin", mood: "Doğa", primary: "#3f6b0a", accent: "#24763a", head: "lora", body: "nunito" },
  { name: "Turkuaz", mood: "Doğa", primary: c("cyan", 9), accent: c("teal", 9), head: "raleway", body: "lato" },
  { name: "Gün batımı", mood: "Canlı", primary: "#c2410c", accent: c("red", 8), head: "oswald", body: "roboto" },
  { name: "Gül", mood: "Canlı", primary: c("pink", 9), accent: c("grape", 7), head: "poppins", body: "nunito" },
  { name: "Mor", mood: "Canlı", primary: c("violet", 9), accent: c("pink", 7), head: "bebas-neue", body: "poppins" },
  { name: "Kırmızı", mood: "Canlı", primary: c("red", 9), accent: "#c2410c", head: "anton", body: "roboto" },
];
