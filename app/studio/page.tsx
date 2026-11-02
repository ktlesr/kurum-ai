import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { ogMeta } from "@/lib/og";
import { Presence } from "../presence";
import Studio from "./studio";

export const metadata: Metadata = { title: "Görsel Stüdyo · Zafer AI", ...ogMeta("studio") };

export default async function StudioPage() {
  const user = await getUser();
  // "from": a shared link's preview (those apps never sign in) still says what the link is.
  if (!user) redirect("/login?from=studio");
  if (user.mustChange) redirect("/hesap");
  return (
    <>
      <Presence />
      <Studio username={user.username} isAdmin={user.role === "admin"} />
    </>
  );
}
