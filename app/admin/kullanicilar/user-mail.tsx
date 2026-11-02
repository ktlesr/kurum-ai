"use client";

// A user's address in the list, and mailing them a new password. Replacing a password can't be undone, so it asks once more.
import { Check, Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { saveEmail, sendNewPassword } from "../actions";

export function UserMail({ id, username, email, canSend, canEdit }: { id: string; username: string; email: string | null; canSend: boolean; canEdit: boolean }) {
  const [value, setValue] = useState(email ?? "");
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, startSave] = useTransition();
  const [sending, startSend] = useTransition();
  const changed = value.trim().toLowerCase() !== (email ?? "");

  const save = () => startSave(async () => setNote(await saveEmail(id, value)));
  const send = () => {
    setAsking(false);
    startSend(async () => setNote(await sendNewPassword(id)));
  };

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          type="email"
          value={value}
          onChange={(e) => { setValue(e.target.value); setNote(null); setAsking(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && changed) save(); }}
          aria-label={`${username} e-postası`}
          readOnly={!canEdit}
          title={canEdit ? undefined : "Başka bir yöneticinin e-postası değiştirilemez"}
          placeholder="e-posta yok"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-xs outline-none placeholder:text-muted focus:border-accent"
        />
        {changed ? (
          <button type="button" onClick={save} disabled={saving} className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-line px-2.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Kaydet
          </button>
        ) : canSend && email && (
          asking ? (
            <>
              <button type="button" onClick={send} className="h-8 shrink-0 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg hover:opacity-90">Eski parola geçersiz olacak: gönder</button>
              <button type="button" onClick={() => setAsking(false)} className="h-8 shrink-0 rounded-md border border-line px-2.5 text-xs font-medium hover:bg-subtle">Vazgeç</button>
            </>
          ) : (
            <button type="button" onClick={() => { setNote(null); setAsking(true); }} disabled={sending} className="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-line px-2.5 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50">
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Yeni parola gönder
            </button>
          )
        )}
      </div>
      {note && <p role="status" className={`mt-1 text-xs ${note.ok ? "text-ok" : "text-danger"}`}>{note.message}</p>}
    </div>
  );
}
