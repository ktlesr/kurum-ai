"use client";

import { Download, Loader2, UserPlus, Users } from "lucide-react";
import { useActionState, useState } from "react";
import { createUser, createUsersBulk, type CreateResult } from "../actions";

const field = "h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm outline-none placeholder:text-muted focus:border-accent";
const primary = "flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40";

/** Generated passwords are shown once, here: the server only keeps their hash. */
function Results({ result }: { result: CreateResult }) {
  if (result.error) return <p role="alert" className="mt-3 text-sm text-danger">{result.error}</p>;
  if (!result.rows?.length) return null;
  const made = result.rows.filter((r) => r.ok);
  const passwords = made.filter((r) => r.password);
  const saveList = () => {
    const url = URL.createObjectURL(new Blob([`﻿kullanici;parola\n${passwords.map((r) => `${r.username};${r.password}`).join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "yeni-kullanicilar.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="mt-3 space-y-2" role="status">
      <p className="text-sm"><span className="font-medium text-ok">{made.length} kullanıcı oluşturuldu.</span>{result.rows.length > made.length && <span className="text-danger"> {result.rows.length - made.length} satır atlandı.</span>}</p>
      {passwords.length > 0 && <p className="rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-fg">Üretilen parolalar yalnızca şimdi görünür. Sayfadan ayrılmadan kaydedip kullanıcılara iletin.</p>}
      <div className="max-h-60 overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={i} className="border-t border-line first:border-t-0">
                <td className="whitespace-nowrap px-3 py-1.5">{r.username || "(boş)"}</td>
                <td className={`px-3 py-1.5 ${r.ok ? "font-mono text-xs" : "text-xs text-danger"}`}>{r.ok ? (r.password ?? "Girilen parola") : r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {passwords.length > 0 && <button type="button" onClick={saveList} className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium hover:border-accent hover:text-accent"><Download size={14} /> Listeyi CSV olarak indir</button>}
    </div>
  );
}

export function CreateUsers() {
  const [tab, setTab] = useState<"one" | "many">("one");
  const [one, oneAction, onePending] = useActionState(createUser, {});
  const [many, manyAction, manyPending] = useActionState(createUsersBulk, {});
  const [list, setList] = useState("");
  const tabs = [["one", "Tek kullanıcı", UserPlus], ["many", "Toplu oluştur", Users]] as const;
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div role="group" aria-label="Oluşturma biçimi" className="mb-4 inline-grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium ${tab === id ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === "one" ? (
        <form action={oneAction}>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
            <label className="block text-xs font-medium">Kullanıcı adı
              <input name="username" required autoComplete="off" spellCheck={false} maxLength={32} placeholder="ör. ayse.yilmaz" className={`${field} mt-1 font-normal`} />
            </label>
            <label className="block text-xs font-medium">Parola <span className="font-normal text-muted">(boşsa üretilir)</span>
              <input name="password" type="password" autoComplete="new-password" maxLength={256} className={`${field} mt-1 font-normal`} />
            </label>
            <label className="block text-xs font-medium">Rol
              <select name="role" defaultValue="user" className={`${field} mt-1 font-normal`}>
                <option value="user">Kullanıcı</option>
                <option value="admin">Yönetici</option>
              </select>
            </label>
            <button disabled={onePending} className={primary}>{onePending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Oluştur</button>
          </div>
          <Results result={one} />
        </form>
      ) : (
        <form action={manyAction}>
          <label className="block text-xs font-medium">Her satıra bir kullanıcı: <span className="font-mono font-normal">kullanici</span> ya da <span className="font-mono font-normal">kullanici;parola</span>
            <textarea name="list" value={list} onChange={(e) => setList(e.target.value)} rows={6} required spellCheck={false} placeholder={"ayse.yilmaz\nmehmet.kaya;en-az-10-karakter"} className="mt-1 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 font-mono text-sm font-normal outline-none placeholder:text-muted focus:border-accent" />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button disabled={manyPending || !list.trim()} className={primary}>{manyPending ? <Loader2 size={15} className="animate-spin" /> : <Users size={15} />} Hepsini oluştur</button>
            <label className="flex h-9 cursor-pointer items-center rounded-lg border border-line px-3 text-sm hover:border-accent hover:text-accent focus-within:ring-2 focus-within:ring-accent/40">
              CSV ya da metin dosyasından al
              <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => { void e.target.files?.[0]?.text().then(setList); e.target.value = ""; }} />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">Parolası yazılmayanlara parola üretilir. Var olan kullanıcılar değiştirilmez. Oluşturulanlar hemen etkin olur.</p>
          <Results result={many} />
        </form>
      )}
    </section>
  );
}
