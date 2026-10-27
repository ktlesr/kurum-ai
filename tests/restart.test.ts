// Docs survive a server restart. CI runs it twice around a restart:
//   SMOKE_PHASE=before → upload as a fresh user, remember it;  restart;  SMOKE_PHASE=after → it's still listed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../lib/db.ts";
import { hashPassword, newToken, tokenHash } from "../lib/password.ts";

const BASE = process.env.SMOKE_URL?.replace(/\/$/, "");
const PHASE = process.env.SMOKE_PHASE;
const STATE = path.join(tmpdir(), "kurumai-restart-test.json");
// Crash leftovers the server must sweep on start (lib/workspace). Server and test share this cwd.
const CRASHED_JOB = path.join(".cache", "jobs", "job-restart-test");
const orphanExtract = (userId: string) => path.join(".cache", "extract", userId, "d".repeat(64));

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
      // Sentinel: a *valid* doc in a .tmp name. If loadDocs ever stopped skipping *.tmp, it would show up in the list.
      const ghost = { ...done.doc, id: "00000000-0000-4000-8000-00000000beef", ownerId: u.id, text: "yarım yazım" };
      writeFileSync(path.join(dir, `${ghost.id}.json.0000.tmp`), JSON.stringify(ghost));
      mkdirSync(CRASHED_JOB, { recursive: true });
      writeFileSync(path.join(CRASHED_JOB, "input.pdf"), "yarım kalmış yükleme");
      mkdirSync(orphanExtract(u.id), { recursive: true });
    } else {
      const { userId, token, docId } = JSON.parse(readFileSync(STATE, "utf8"));
      try {
        const list = (await (await fetch(`${BASE}/api/upload`, { headers: { cookie: `kai_session=${token}` } })).json()) as { id: string }[];
        assert.deepEqual(list.map((d) => d.id), [docId], "yeniden başlatmadan sonra doküman listede; bozuk kayıt ve .tmp artığı onu gizlemedi");
        assert.ok(!existsSync(CRASHED_JOB), "çökme artığı iş dizini açılışta silindi");
        assert.ok(!existsSync(orphanExtract(userId)), "hiçbir dokümana ait olmayan önbellek açılışta silindi");
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
