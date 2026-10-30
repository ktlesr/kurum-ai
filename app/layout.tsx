import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zafer AI",
  description: "Dokümanlarınız hakkında soru sorun. İşleme kurum sunucusunda yapılır; harici AI servisine gönderilmez.",
  icons: { icon: "/logo.svg", apple: "/apple-icon.png" },
};

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
