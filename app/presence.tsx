"use client";

import { useEffect } from "react";

/** Tells the server this user has a page open and is looking at it, for the dashboard's "online" count. */
export function Presence() {
  useEffect(() => {
    const ping = () => {
      if (!document.hidden) void fetch("/api/usage", { method: "POST" }).catch(() => {});
    };
    ping();
    const timer = setInterval(ping, 60_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);
  return null;
}

/** One finished piece of studio work, for the dashboard's totals: only that it happened. */
export const trackUsage = (kind: "deck" | "reels" | "social") =>
  void fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }), keepalive: true }).catch(() => {});
