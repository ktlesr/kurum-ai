"use client";

// Beside the page on a wide screen, a row above it on a phone. A new section is one more line in ITEMS.
import { FolderTree, LayoutDashboard, Settings, Sheet, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/kullanicilar", label: "Kullanıcılar", Icon: Users },
  { href: "/admin/kutuphane", label: "Kütüphane", Icon: FolderTree },
  { href: "/admin/destek", label: "Destek verisi", Icon: Sheet },
  { href: "/admin/ayarlar", label: "Ayarlar", Icon: Settings },
];

export function AdminNav() {
  const at = usePathname();
  return (
    <nav aria-label="Yönetim menüsü" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-side p-2 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
      {ITEMS.map(({ href, label, Icon }) => {
        const on = at === href;
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${on ? "bg-accent-soft text-accent" : "text-muted hover:bg-subtle hover:text-fg"}`}>
            <Icon size={16} /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
