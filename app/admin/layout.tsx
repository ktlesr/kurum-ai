import { LogOut } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { logout } from "../login/actions";
import { Logo } from "../logo";
import { Presence } from "../presence";
import { ThemeToggle } from "../theme-toggle";
import { TopLinks } from "../top-links";
import { AdminNav } from "./nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdmin();
  return (
    <div className="flex h-full flex-col bg-bg">
      <Presence />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 md:px-4">
        <Logo size={26} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Yönetim</span>
        <TopLinks chat studio />
        <ThemeToggle />
        <span className="hidden max-w-32 truncate text-sm text-muted sm:inline" title={me.username}>{me.username}</span>
        <form action={logout}>
          <button className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg" aria-label="Çıkış yap" title="Çıkış yap"><LogOut size={16} /></button>
        </form>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <AdminNav />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
