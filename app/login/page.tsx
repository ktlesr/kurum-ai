import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ogMeta } from "@/lib/og";
import { getUser } from "@/lib/auth";
import { ThemeToggle } from "../theme-toggle";
import { AuthForm } from "./form";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }): Promise<Metadata> {
  return { title: "Giriş · Zafer AI", ...ogMeta((await searchParams).from === "studio" ? "studio" : "home") };
}

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <main className="relative flex min-h-full items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <AuthForm />
    </main>
  );
}
