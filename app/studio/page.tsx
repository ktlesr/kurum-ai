import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Studio from "./studio";

export const metadata: Metadata = { title: "Görsel Stüdyo · Zafer AI" };

export default async function StudioPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <Studio username={user.username} />;
}
