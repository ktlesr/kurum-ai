"use client";

import { useActionState, useState } from "react";
import { login, signup, type FormState } from "./actions";

const input = "h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";

export function AuthForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loginState, loginAction, loggingIn] = useActionState<FormState, FormData>(login, undefined);
  const [signupState, signupAction, signingUp] = useActionState<FormState, FormData>(signup, undefined);
  const isLogin = mode === "login";
  const state = isLogin ? loginState : signupState;
  const pending = isLogin ? loggingIn : signingUp;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Kurum AI</h1>
        <p className="mt-1 text-sm text-muted">{isLogin ? "Kurum hesabınızla oturum açın" : "Yeni hesap isteği"}</p>
      </div>
      <form action={isLogin ? loginAction : signupAction} className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted">Kullanıcı adı</span>
          <input name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} className={input} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted">Parola</span>
          <input name="password" type="password" required autoComplete={isLogin ? "current-password" : "new-password"} minLength={isLogin ? undefined : 10} className={input} />
        </label>
        {!isLogin && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted">Parola (tekrar)</span>
            <input name="password2" type="password" required autoComplete="new-password" className={input} />
          </label>
        )}
        <div aria-live="polite">
          {state?.error && <p className="text-sm text-danger">{state.error}</p>}
          {state?.info && <p className="text-sm text-accent">{state.info}</p>}
        </div>
        <button type="submit" disabled={pending} className="mt-1 h-10 rounded-lg bg-accent text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60">
          {pending ? "Lütfen bekleyin…" : isLogin ? "Giriş yap" : "Hesap iste"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {isLogin ? "Hesabınız yok mu? " : "Hesabınız var mı? "}
        <button type="button" onClick={() => setMode(isLogin ? "signup" : "login")} className="font-medium text-accent hover:underline">
          {isLogin ? "Hesap isteyin" : "Giriş yapın"}
        </button>
      </p>
    </div>
  );
}
