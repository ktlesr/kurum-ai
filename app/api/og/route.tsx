// The picture of a shared link. Public, as link-preview apps don't sign in: only the fixed cards of lib/og.ts, no text from the address.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { OG_CARDS, type OgCard } from "@/lib/og";

const file = (name: string) => readFile(path.join(process.cwd(), "public", name));

export async function GET(req: Request) {
  const k = new URL(req.url).searchParams.get("k");
  const card = OG_CARDS[k && Object.hasOwn(OG_CARDS, k) ? (k as OgCard) : "home"];
  const [regular, bold, logo] = await Promise.all([file("fonts/Geist-Regular.ttf"), file("fonts/Geist-Bold.ttf"), file("logo.svg")]);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#14263d", color: "#ffffff", fontFamily: "Geist" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn into the picture, not a page */}
        <img src={`data:image/svg+xml;base64,${logo.toString("base64")}`} width={88} height={88} alt="" />
        <span style={{ fontSize: 40, fontWeight: 700 }}>Zafer AI</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <span style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2 }}>{card.title}</span>
        <span style={{ fontSize: 38, color: "#c9d8e8", lineHeight: 1.35, maxWidth: 980 }}>{card.text}</span>
      </div>
    </div>,
    {
      width: 1200, height: 630,
      fonts: [{ name: "Geist", data: regular, weight: 400, style: "normal" }, { name: "Geist", data: bold, weight: 700, style: "normal" }],
      headers: { "Cache-Control": "public, max-age=86400" },
    },
  );
}
