import type { MetadataRoute } from "next";

// What makes the site installable: opened from its icon, it has no browser bar and looks like an app.
// No service worker on purpose: nothing of a signed-in user's is kept in a cache, and it needs the server anyway.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zafer AI",
    short_name: "Zafer AI",
    description: "Kurum asistanı ve Görsel Stüdyo",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f8fb",
    theme_color: "#f5f8fb",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Görsel Stüdyo", url: "/studio", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
