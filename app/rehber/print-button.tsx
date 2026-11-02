"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} title="Yazdır ya da PDF olarak kaydet" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:bg-subtle hover:text-fg">
      <Printer size={16} /> <span className="hidden sm:inline">Yazdır / PDF</span>
    </button>
  );
}
