// The app's sections in the top bar.
import { LayoutDashboard, MessageSquare, Palette } from "lucide-react";
import Link from "next/link";

const link = "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted transition-colors hover:bg-subtle hover:text-fg";

export function TopLinks({ isAdmin, chat, studio }: { isAdmin?: boolean; chat?: boolean; studio?: boolean }) {
  return (
    <nav aria-label="Bölümler" className="flex shrink-0 items-center gap-0.5">
      {chat && <Link href="/" className={link} aria-label="Asistan" title="Asistan"><MessageSquare size={16} /> <span className="hidden lg:inline">Asistan</span></Link>}
      {studio && <a href="/studio" className={link} aria-label="Görsel Stüdyo" title="Görsel Stüdyo"><Palette size={16} /> <span className="hidden lg:inline">Görsel Stüdyo</span></a>}
      {isAdmin && <a href="/admin" className={link} aria-label="Yönetim" title="Yönetim"><LayoutDashboard size={16} /> <span className="hidden lg:inline">Yönetim</span></a>}
    </nav>
  );
}
