import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { logout } from "../login/actions";
import { ThemeToggle } from "../theme-toggle";
import { BetaBadge, Logo } from "../logo";
import { ChangePassword } from "./form";

export const metadata: Metadata = { title: "Parola · Zafer AI" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ degisti?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const changed = (await searchParams).degisti === "1" && !user.mustChange;
  return (
    <main className="relative flex min-h-full items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-3 flex justify-center"><Logo size={48} /></div>
          <h1 className="flex items-center justify-center gap-2 text-xl font-semibold tracking-tight">Zafer AI <BetaBadge /></h1>
          <p className="mt-1 text-sm text-muted">{user.mustChange ? "Devam etmek için parolanızı değiştirin" : "Parolanızı değiştirin"}</p>
          <p className="mt-1 text-xs text-muted">{user.username}</p>
        </div>
        {changed ? (
          <p role="status" className="rounded-xl border border-line bg-panel p-5 text-center text-sm font-medium text-ok">Parolanız değiştirildi.</p>
        ) : (
          <ChangePassword username={user.username} />
        )}
        <div className="mt-4 flex items-center justify-center gap-4 text-sm">
          {!user.mustChange && <Link href="/" className="font-medium text-accent hover:underline">Sohbete dön</Link>}
          <form action={logout}><button className="font-medium text-muted hover:text-fg hover:underline">Çıkış yap</button></form>
        </div>
      </div>
    </main>
  );
}
