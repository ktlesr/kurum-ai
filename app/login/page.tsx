import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { ThemeToggle } from "../theme-toggle";
import { AuthForm } from "./form";

export const metadata = { title: "Giriş · Zafer AI" };

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <main className="relative flex min-h-full items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <AuthForm />
    </main>
  );
}
