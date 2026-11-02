"use client";

import { useActionState } from "react";
import { changePassword, type ChangeState } from "./actions";

const input = "h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";
const label = "text-xs font-medium text-muted";

export function ChangePassword({ username }: { username: string }) {
  const [state, action, pending] = useActionState<ChangeState, FormData>(changePassword, undefined);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* For password managers: which account the new password belongs to. */}
      <input type="text" name="username" value={username} autoComplete="username" readOnly hidden />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>Mevcut parola</span>
        <input name="current" type="password" required autoComplete="current-password" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>Yeni parola <span className="font-normal">(en az 10 karakter)</span></span>
        <input name="next" type="password" required minLength={10} maxLength={256} autoComplete="new-password" className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className={label}>Yeni parola (tekrar)</span>
        <input name="next2" type="password" required autoComplete="new-password" className={input} />
      </label>
      <div aria-live="polite">{state?.error && <p className="text-sm text-danger">{state.error}</p>}</div>
      <button type="submit" disabled={pending} className="mt-1 h-10 rounded-lg bg-accent text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60">
        {pending ? "Lütfen bekleyin…" : "Parolayı değiştir"}
      </button>
    </form>
  );
}
