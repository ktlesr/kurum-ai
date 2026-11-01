import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ogMeta } from "@/lib/og";
import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    // Shared links need full addresses to their pictures; the real address is known only when running.
    metadataBase: new URL(process.env.APP_ORIGIN || "https://ai.zafer.gov.tr"),
    title: "Zafer AI",
    description: "Dokümanlarınız hakkında soru sorun. İşleme kurum sunucusunda yapılır; harici AI servisine gönderilmez.",
    icons: { icon: "/logo.svg", apple: "/apple-icon.png" },
    ...ogMeta("home"),
  };
}

// Runs before paint. Light by default (plan §3.1); "system" follows the OS; the stored choice wins.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by proxy.ts; the inline theme script must carry it or the CSP blocks it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="tr" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
