// The "browser" container (deploy/compose.yml): headless Chromium behind a Playwright server that the app connects
// to (WEB_BROWSER=ws://browser:3100/…). It sits on an internal network with no route out; every page context the app
// opens goes through the app's guard proxy (lib/browser.ts). Nothing else lives here: no documents, keys or database.
import net from "node:net";
import { networkInterfaces } from "node:os";
import { chromium } from "playwright-core";

// Fail closed: this container is the boundary only while it has no way out of its own. If a deployment tool joins
// it to another network (a route to the internet, the database or the host), it doesn't serve at all; the app then
// reads pages without running their scripts.
const reaches = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 3000 });
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("timeout", () => (s.destroy(), resolve(false)));
    s.on("error", () => resolve(false));
  });
const leaks = [];
// Structure first: exactly one network besides loopback (the internal "browsing" one). A second network, whatever
// is on it, means this container isn't where the compose file put it.
const nets = Object.entries(networkInterfaces()).filter(([, list]) => (list ?? []).some((a) => !a.internal));
if (nets.length !== 1) leaks.push(`${nets.length} ağ arayüzü (${nets.map(([n]) => n).join(", ")}), 1 olmalı`);
// Then reachability, for a single network that isn't internal after all.
for (const [host, port] of [["1.1.1.1", 443], ["8.8.8.8", 53], ["example.com", 443], ["db", 5432], ["host.docker.internal", 11434]]) {
  if (await reaches(host, port)) leaks.push(`${host}:${port}`);
}

if (leaks.length) {
  console.error(
    `tarayıcı başlatılmadı, konteyner yalıtılmış değil: ${leaks.join(", ")}. ` +
      `"browser" servisi yalnızca "browsing" iç ağında olmalı (Dokploy'da Isolated Deployments kapalı).`,
  );
  setInterval(() => {}, 1 << 30); // stay up without serving, so the deployment doesn't restart-loop
  process.on("SIGTERM", () => process.exit(0));
} else {
  const server = await chromium.launchServer({
    executablePath: "/usr/bin/chromium",
    headless: true,
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 3100,
    wsPath: process.env.WS_PATH || "/kai",
    // Docker's default seccomp profile doesn't let Chromium build its sandbox; this container is the boundary
    // instead (internal network, no capabilities, read-only filesystem, nothing worth taking).
    chromiumSandbox: false,
    // Same flags as CHROMIUM_ARGS in lib/browser.ts: traffic stays on the proxy (no QUIC, no non-proxied UDP, no DoH).
    args: [
      "--disable-quic",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--disable-features=DnsOverHttps,MediaRouter,DialMediaRouteProvider",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--mute-audio",
    ],
  });
  console.log("tarayıcı hazır");
  const stop = () => server.close().then(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
