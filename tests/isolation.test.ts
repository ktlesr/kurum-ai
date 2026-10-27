// User A/B isolation against a running server (plan §11.1, journey 2).
// Run: SMOKE_URL=http://localhost:3999 pnpm test:isolation   (needs DATABASE_URL, same DB as the server)
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/db.ts";
import { hashPassword, newToken, tokenHash } from "../lib/password.ts";

const BASE = process.env.SMOKE_URL?.replace(/\/$/, "");
const MODEL = (process.env.ALLOWED_MODELS ?? process.env.DEFAULT_MODEL ?? "gemma4:12b").split(",")[0].trim();

test("user B can never see, use or delete user A's document", { skip: !BASE && "SMOKE_URL yok" }, async () => {
  const sql = await db();
  const tag = Date.now().toString(36);
  const users: { id: string; cookie: string }[] = [];
  for (const name of [`iso-a-${tag}`, `iso-b-${tag}`]) {
    const [u] = await sql<{ id: string }[]>`INSERT INTO users (username, pass_hash, status) VALUES (${name}, ${await hashPassword("izolasyon-testi")}, 'active') RETURNING id`;
    const token = newToken();
    await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${u.id}, now() + interval '10 minutes')`;
    users.push({ id: u.id, cookie: `kai_session=${token}` });
  }
  const [A, B] = users;
  const call = (who: { cookie: string } | null, path: string, init: RequestInit = {}) =>
    fetch(BASE + path, { ...init, headers: { origin: BASE!, ...(who ? { cookie: who.cookie } : {}), ...init.headers } });
  const chat = (who: { cookie: string }, body: object) =>
    call(who, "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  try {
    assert.equal((await call(null, "/api/upload")).status, 401, "anonim liste");

    const form = new FormData();
    form.append("file", new Blob(["izolasyon deneme 123\n"], { type: "text/plain" }), "a.txt");
    const up = await call(A, "/api/upload", { method: "POST", body: form });
    const done = (await up.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "done");
    assert.ok(done?.doc?.id, "A yükledi");
    const id: string = done.doc.id;
    assert.equal(done.doc.ownerId, undefined, "ownerId istemciye gitmez");

    const listA = (await (await call(A, "/api/upload")).json()) as { id: string }[];
    const listB = (await (await call(B, "/api/upload")).json()) as { id: string }[];
    assert.deepEqual(listA.map((d) => d.id), [id], "A yalnızca kendi dokümanını görür (eski karantina verisi yok)");
    assert.deepEqual(listB, [], "B, A'nın dokümanını görmez");

    assert.equal((await call(B, `/api/upload?id=${id}`, { method: "DELETE" })).status, 404, "B silemez");
    const msg = [{ role: "user", content: "özetle" }];
    assert.equal((await chat(B, { model: MODEL, fileIds: [id], messages: msg })).status, 409, "B sohbette kullanamaz");
    // 200 with a model server, 503 without one (CI): either way the ownership check let A through.
    assert.ok([200, 503].includes((await chat(A, { model: MODEL, fileIds: [id], messages: msg })).status), "A kullanabilir");
    assert.equal((await chat(B, { model: MODEL, fileIds: ["00000000-0000-4000-8000-000000000000"], messages: msg })).status, 409, "yok olan ile başkasınınki aynı yanıt");

    assert.equal((await chat(A, {})).status, 400, "boş gövde");
    assert.equal((await chat(A, { model: "x:cloud", fileIds: [id], messages: msg })).status, 400, "izin listesi dışı model");

    assert.equal((await call(A, `/api/upload?id=${id}`, { method: "DELETE" })).status, 204, "A siler");
    assert.deepEqual(await (await call(A, "/api/upload")).json(), []);
  } finally {
    await sql`DELETE FROM users WHERE id IN ${sql(users.map((u) => u.id))}`;
    await sql.end();
  }
});
