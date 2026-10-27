// Docs survive a server restart. CI runs it twice around a restart:
//   SMOKE_PHASE=before → upload as a fresh user, remember it;  restart;  SMOKE_PHASE=after → it's still listed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../lib/db.ts";
import { hashPassword, newToken, tokenHash } from "../lib/password.ts";

const BASE = process.env.SMOKE_URL?.replace(/\/$/, "");
const PHASE = process.env.SMOKE_PHASE;
const STATE = path.join(tmpdir(), "kurumai-restart-test.json");

test(`docs survive restart (${PHASE})`, { skip: !(BASE && PHASE) && "SMOKE_URL/SMOKE_PHASE yok" }, async () => {
  const sql = await db();
  try {
    if (PHASE === "before") {
      const [u] = await sql<{ id: string }[]>`INSERT INTO users (username, pass_hash, status) VALUES (${`restart-${Date.now().toString(36)}`}, ${await hashPassword("yeniden-baslatma")}, 'active') RETURNING id`;
      const token = newToken();
      await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${u.id}, now() + interval '10 minutes')`;
      const form = new FormData();
      form.append("file", new Blob(["kalıcılık 42\n"], { type: "text/plain" }), "k.txt");
      const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: form, headers: { origin: BASE!, cookie: `kai_session=${token}` } });
      const done = (await res.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "done");
      assert.ok(done?.doc?.id);
      writeFileSync(STATE, JSON.stringify({ userId: u.id, token, docId: done.doc.id }));
      // What a crash can leave behind (audit R1/R3): a half-written temp file and a corrupt record.
      // Needs the server's cwd = this repo (true locally and in CI).
      const dir = path.join(".cache", "userdocs", u.id);
      writeFileSync(path.join(dir, "bozuk.json"), '{"id": "yarım');
      writeFileSync(path.join(dir, `${done.doc.id}.json.0000.tmp`), "{");
    } else {
      const { userId, token, docId } = JSON.parse(readFileSync(STATE, "utf8"));
      try {
        const list = (await (await fetch(`${BASE}/api/upload`, { headers: { cookie: `kai_session=${token}` } })).json()) as { id: string }[];
        assert.deepEqual(list.map((d) => d.id), [docId], "yeniden başlatmadan sonra doküman listede; bozuk kayıt ve .tmp artığı onu gizlemedi");
        await fetch(`${BASE}/api/upload?id=${docId}`, { method: "DELETE", headers: { origin: BASE!, cookie: `kai_session=${token}` } });
      } finally {
        await sql`DELETE FROM users WHERE id = ${userId}`;
        rmSync(path.join(".cache", "userdocs", userId), { recursive: true, force: true });
        rmSync(STATE, { force: true });
      }
    }
  } finally {
    await sql.end();
  }
});
